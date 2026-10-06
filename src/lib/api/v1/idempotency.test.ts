import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  claimIdempotencyKey,
  hashRequestBody,
  readIdempotencyKey,
  releaseIdempotencyKey,
  saveIdempotentResponse,
} from './idempotency';
import { makeIdempotencyDb } from './idempotency-test-db';

const request = (key?: string) =>
  new Request('http://localhost/api/v1/broadcasts', {
    method: 'POST',
    headers: key === undefined ? {} : { 'Idempotency-Key': key },
  });

afterEach(() => vi.useRealTimers());

describe('readIdempotencyKey', () => {
  it('is null when the header is absent', () => {
    expect(readIdempotencyKey(request())).toBeNull();
  });

  it('returns the key, trimmed', () => {
    expect(readIdempotencyKey(request('  order-123 '))).toBe('order-123');
  });

  it.each(['', '   ', 'has space', 'x'.repeat(256), 'tab\tkey'])(
    'rejects %j with a 400',
    (bad) => {
      expect(() => readIdempotencyKey(request(bad))).toThrow(
        expect.objectContaining({ code: 'bad_request', status: 400 })
      );
    }
  );
});

describe('hashRequestBody', () => {
  it('is the same for the same body and different for another', () => {
    expect(hashRequestBody({ a: 1 })).toBe(hashRequestBody({ a: 1 }));
    expect(hashRequestBody({ a: 1 })).not.toBe(hashRequestBody({ a: 2 }));
  });
});

describe('claimIdempotencyKey', () => {
  it('lets the first request with a key through', async () => {
    const { db, rows } = makeIdempotencyDb();

    expect(await claimIdempotencyKey(db, 'acc', 'k1', 'h1')).toEqual({ kind: 'new' });
    expect(rows).toHaveLength(1);
  });

  it('says busy while the first request has no response yet', async () => {
    const { db } = makeIdempotencyDb();
    await claimIdempotencyKey(db, 'acc', 'k1', 'h1');

    expect(await claimIdempotencyKey(db, 'acc', 'k1', 'h1')).toEqual({ kind: 'busy' });
  });

  it('hands back the stored response to a retry of the same request', async () => {
    const { db } = makeIdempotencyDb();
    await claimIdempotencyKey(db, 'acc', 'k1', 'h1');
    await saveIdempotentResponse(db, 'acc', 'k1', 202, { data: { broadcast_id: 'b-1' } });

    expect(await claimIdempotencyKey(db, 'acc', 'k1', 'h1')).toEqual({
      kind: 'replay',
      status: 202,
      body: { data: { broadcast_id: 'b-1' } },
    });
  });

  it('refuses the same key with a different body', async () => {
    const { db } = makeIdempotencyDb();
    await claimIdempotencyKey(db, 'acc', 'k1', 'h1');
    await saveIdempotentResponse(db, 'acc', 'k1', 202, {});

    expect(await claimIdempotencyKey(db, 'acc', 'k1', 'other')).toEqual({ kind: 'mismatch' });
  });

  it('keeps accounts apart: another account may use the same key', async () => {
    const { db } = makeIdempotencyDb();
    await claimIdempotencyKey(db, 'acc-1', 'k1', 'h1');

    expect(await claimIdempotencyKey(db, 'acc-2', 'k1', 'h1')).toEqual({ kind: 'new' });
  });

  it('lets a key be used again after it is released', async () => {
    const { db } = makeIdempotencyDb();
    await claimIdempotencyKey(db, 'acc', 'k1', 'h1');
    await releaseIdempotencyKey(db, 'acc', 'k1');

    expect(await claimIdempotencyKey(db, 'acc', 'k1', 'h2')).toEqual({ kind: 'new' });
  });

  it('forgets keys after 24 hours', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-07T08:00:00Z'));
    const { db } = makeIdempotencyDb();
    await claimIdempotencyKey(db, 'acc', 'k1', 'h1');
    await saveIdempotentResponse(db, 'acc', 'k1', 202, {});

    vi.setSystemTime(new Date('2026-10-08T08:00:01Z'));

    expect(await claimIdempotencyKey(db, 'acc', 'k1', 'h1')).toEqual({ kind: 'new' });
  });
});
