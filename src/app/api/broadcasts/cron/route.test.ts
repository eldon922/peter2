import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// next's real `after` needs a live request; here it just records the callback.
const after = vi.hoisted(() => vi.fn());
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after,
}));

const planScheduledBroadcast = vi.hoisted(() => vi.fn());
const deliverBroadcast = vi.hoisted(() => vi.fn());
const finalizeBroadcastStatus = vi.hoisted(() => vi.fn());
vi.mock('@/lib/whatsapp/broadcast-core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/whatsapp/broadcast-core')>()),
  planScheduledBroadcast,
  deliverBroadcast,
  finalizeBroadcastStatus,
}));

// The route reads the due list with
//   from().select().eq().lte().order().limit()
// and awaits the `limit` call.
const admin = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@/lib/flows/admin-client', () => ({ supabaseAdmin: () => admin }));

import { BroadcastError } from '@/lib/whatsapp/broadcast-core';
import { GET } from './route';

let due: { data: unknown[] | null; error: { message: string } | null };
let filters: [string, string, unknown][];

function request(secret?: string) {
  return new Request('http://localhost/api/broadcasts/cron', {
    headers: secret === undefined ? {} : { 'x-cron-secret': secret },
  });
}

const plan = (planned: number) => ({
  broadcastId: 'b',
  planned: Array.from({ length: planned }, (_, i) => ({ recipientRowId: `r${i}` })),
});

beforeEach(() => {
  process.env.AUTOMATION_CRON_SECRET = 'shh';
  due = { data: [], error: null };
  filters = [];
  const chain = {
    select: () => chain,
    eq: (col: string, val: unknown) => (filters.push(['eq', col, val]), chain),
    lte: (col: string, val: unknown) => (filters.push(['lte', col, val]), chain),
    order: () => chain,
    limit: () => Promise.resolve(due),
  };
  admin.from.mockImplementation(() => chain);
  planScheduledBroadcast.mockReset();
  planScheduledBroadcast.mockResolvedValue(plan(2));
});

afterEach(() => {
  delete process.env.AUTOMATION_CRON_SECRET;
  vi.restoreAllMocks();
});

describe('GET /api/broadcasts/cron', () => {
  it('503s until the shared secret is configured', async () => {
    delete process.env.AUTOMATION_CRON_SECRET;
    expect((await GET(request('shh'))).status).toBe(503);
  });

  it('401s without the right secret and reads nothing', async () => {
    expect((await GET(request())).status).toBe(401);
    expect((await GET(request('nope'))).status).toBe(401);
    expect(admin.from).not.toHaveBeenCalled();
  });

  it('starts every due broadcast and hands each plan to the fan-out', async () => {
    due = {
      data: [
        { id: 'b-1', account_id: 'acc-1' },
        { id: 'b-2', account_id: 'acc-2' },
      ],
      error: null,
    };

    const res = await GET(request('shh'));

    expect(await res.json()).toEqual({ started: 2 });
    expect(planScheduledBroadcast).toHaveBeenCalledWith(admin, 'acc-1', 'b-1');
    expect(planScheduledBroadcast).toHaveBeenCalledWith(admin, 'acc-2', 'b-2');
    expect(after).toHaveBeenCalledTimes(2);
    // Only scheduled broadcasts whose time has come.
    expect(filters).toContainEqual(['eq', 'status', 'scheduled']);
    expect(filters).toContainEqual(['lte', 'scheduled_at', expect.any(String)]);
  });

  it('skips one that was started or cancelled first, without logging an error', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    due = {
      data: [
        { id: 'b-1', account_id: 'acc-1' },
        { id: 'b-2', account_id: 'acc-1' },
      ],
      error: null,
    };
    planScheduledBroadcast.mockRejectedValueOnce(
      new BroadcastError('conflict', 'no longer scheduled', 409)
    );

    const res = await GET(request('shh'));

    expect(await res.json()).toEqual({ started: 1 });
    expect(error).not.toHaveBeenCalled();
  });

  it('keeps going after one fails to start, and logs it', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    due = {
      data: [
        { id: 'b-1', account_id: 'acc-1' },
        { id: 'b-2', account_id: 'acc-1' },
      ],
      error: null,
    };
    planScheduledBroadcast.mockRejectedValueOnce(new Error('boom'));

    const res = await GET(request('shh'));

    expect(await res.json()).toEqual({ started: 1 });
    expect(error).toHaveBeenCalled();
  });

  it('closes a broadcast that has nothing to send instead of fanning out', async () => {
    due = { data: [{ id: 'b-1', account_id: 'acc-1' }], error: null };
    planScheduledBroadcast.mockResolvedValue(plan(0));

    await GET(request('shh'));

    expect(finalizeBroadcastStatus).toHaveBeenCalledWith(admin, 'b-1', 0);
    expect(after).not.toHaveBeenCalled();
  });

  it('500s when the due list cannot be read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    due = { data: null, error: { message: 'db down' } };

    const res = await GET(request('shh'));

    expect(res.status).toBe(500);
    expect(planScheduledBroadcast).not.toHaveBeenCalled();
  });
});
