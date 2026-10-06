import { beforeEach, describe, expect, it, vi } from 'vitest';

import { makeIdempotencyDb } from '@/lib/api/v1/idempotency-test-db';

const after = vi.hoisted(() => vi.fn());
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after,
}));

const idem = makeIdempotencyDb();
vi.mock('@/lib/auth/api-context', () => ({
  requireApiKey: async () => ({ supabase: idem.db, accountId: 'acc-1' }),
}));
vi.mock('@/lib/api/v1/contacts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/v1/contacts')>()),
  resolveAuditUserId: async () => 'user-1',
}));

const createBroadcast = vi.hoisted(() => vi.fn());
const deliverBroadcast = vi.hoisted(() => vi.fn());
vi.mock('@/lib/whatsapp/broadcast-core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/whatsapp/broadcast-core')>()),
  createBroadcast,
  deliverBroadcast,
}));

import { BroadcastError } from '@/lib/whatsapp/broadcast-core';
import { POST } from './route';

const BODY = {
  template_name: 'promo',
  recipients: [{ to: '+14155550123' }, { to: '+14155550124' }],
};

function post(body: unknown, key?: string) {
  return POST(
    new Request('http://localhost/api/v1/broadcasts', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(key ? { 'Idempotency-Key': key } : {}),
      },
      body: JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  idem.rows.length = 0;
  after.mockReset();
  deliverBroadcast.mockReset();
  createBroadcast.mockReset();
  createBroadcast.mockResolvedValue({
    broadcastId: 'b-1',
    planned: [{}, {}],
    rejected: 0,
  });
});

describe('POST /api/v1/broadcasts', () => {
  it('creates a broadcast on every request when no key is sent', async () => {
    await post(BODY);
    await post(BODY);

    expect(createBroadcast).toHaveBeenCalledTimes(2);
  });

  it('answers a retry with the same key from the first response, creating nothing', async () => {
    const first = await post(BODY, 'order-1');
    const retry = await post(BODY, 'order-1');

    expect(first.status).toBe(202);
    expect(retry.status).toBe(202);
    expect(retry.headers.get('Idempotent-Replayed')).toBe('true');
    expect(await retry.json()).toEqual(await first.json());
    expect(createBroadcast).toHaveBeenCalledTimes(1);
    expect(after).toHaveBeenCalledTimes(1);
  });

  it('refuses the same key with a different body (422), creating nothing', async () => {
    await post(BODY, 'order-1');
    const res = await post({ ...BODY, name: 'something else' }, 'order-1');

    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe('idempotency_key_reused');
    expect(createBroadcast).toHaveBeenCalledTimes(1);
  });

  it('answers 409 while the first request with the key is still running', async () => {
    let finish!: () => void;
    createBroadcast.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = () => resolve({ broadcastId: 'b-1', planned: [{}], rejected: 0 });
      })
    );

    const first = post(BODY, 'order-1');
    await vi.waitFor(() => expect(createBroadcast).toHaveBeenCalledTimes(1));
    const second = await post(BODY, 'order-1');
    finish();
    await first;

    expect(second.status).toBe(409);
    expect((await second.json()).error.code).toBe('request_in_progress');
    expect(createBroadcast).toHaveBeenCalledTimes(1);
  });

  it('frees the key when the request fails, so the caller can try again', async () => {
    createBroadcast.mockRejectedValueOnce(
      new BroadcastError('whatsapp_not_configured', 'not set up', 400)
    );

    const failed = await post(BODY, 'order-1');
    const retry = await post(BODY, 'order-1');

    expect(failed.status).toBe(400);
    expect(retry.status).toBe(202);
    expect(createBroadcast).toHaveBeenCalledTimes(2);
  });

  it('rejects a malformed key with a 400 before doing anything', async () => {
    const res = await post(BODY, 'has space');

    expect(res.status).toBe(400);
    expect(createBroadcast).not.toHaveBeenCalled();
  });
});
