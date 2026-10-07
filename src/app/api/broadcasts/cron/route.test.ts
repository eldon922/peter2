import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// next's real `after` needs a live request; here it just records the callback.
const after = vi.hoisted(() => vi.fn());
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after,
}));

const planBroadcastStart = vi.hoisted(() => vi.fn());
const deliverBroadcast = vi.hoisted(() => vi.fn());
const finalizeBroadcastStatus = vi.hoisted(() => vi.fn());
vi.mock('@/lib/whatsapp/broadcast-core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/whatsapp/broadcast-core')>()),
  planBroadcastStart,
  deliverBroadcast,
  finalizeBroadcastStatus,
}));

// The route first moves late broadcasts back to draft with
//   from().update().eq().lt().select()
// and then reads the due list with
//   from().select().eq().gte().lte().order().limit()
// awaiting the `select` of the first and the `limit` of the second.
const admin = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@/lib/flows/admin-client', () => ({ supabaseAdmin: () => admin }));

import { BroadcastError } from '@/lib/whatsapp/broadcast-core';
import { GET } from './route';

let due: { data: unknown[] | null; error: { message: string } | null };
let late: { data: unknown[] | null; error: { message: string } | null };
let filters: [string, string, unknown][];
let updates: Record<string, unknown>[];

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
  late = { data: [], error: null };
  filters = [];
  updates = [];
  admin.from.mockImplementation(() => {
    let updating = false;
    const chain = {
      update: (values: Record<string, unknown>) => {
        updating = true;
        updates.push(values);
        return chain;
      },
      select: () => (updating ? Promise.resolve(late) : chain),
      eq: (col: string, val: unknown) => (filters.push(['eq', col, val]), chain),
      lt: (col: string, val: unknown) => (filters.push(['lt', col, val]), chain),
      gte: (col: string, val: unknown) => (filters.push(['gte', col, val]), chain),
      lte: (col: string, val: unknown) => (filters.push(['lte', col, val]), chain),
      order: () => chain,
      limit: () => Promise.resolve(due),
    };
    return chain;
  });
  planBroadcastStart.mockReset();
  planBroadcastStart.mockResolvedValue(plan(2));
});

afterEach(() => {
  delete process.env.AUTOMATION_CRON_SECRET;
  delete process.env.BROADCAST_MAX_LATE_HOURS;
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

    expect(await res.json()).toEqual({ started: 2, skipped: 0 });
    // Each claim carries the time it was made, so a schedule moved later
    // after the scan is not started.
    expect(planBroadcastStart).toHaveBeenCalledWith(
      admin,
      'acc-1',
      'b-1',
      ['scheduled'],
      expect.any(String)
    );
    expect(planBroadcastStart).toHaveBeenCalledWith(
      admin,
      'acc-2',
      'b-2',
      ['scheduled'],
      expect.any(String)
    );
    expect(after).toHaveBeenCalledTimes(2);
    // Only scheduled broadcasts whose time has come.
    expect(filters).toContainEqual(['eq', 'status', 'scheduled']);
    expect(filters).toContainEqual(['lte', 'scheduled_at', expect.any(String)]);
  });

  it('never starts one that is later than the allowed lateness (default 1 hour)', async () => {
    await GET(request('shh'));

    const cutoff = filters.find(([op, col]) => op === 'gte' && col === 'scheduled_at')![2];
    expect(Date.now() - Date.parse(cutoff as string)).toBeGreaterThan(3_599_000);
    expect(Date.now() - Date.parse(cutoff as string)).toBeLessThan(3_601_000);
  });

  it('takes the allowed lateness from BROADCAST_MAX_LATE_HOURS', async () => {
    process.env.BROADCAST_MAX_LATE_HOURS = '6';

    await GET(request('shh'));

    const cutoff = filters.find(([op, col]) => op === 'gte' && col === 'scheduled_at')![2];
    expect(Date.now() - Date.parse(cutoff as string)).toBeGreaterThan(6 * 3_600_000 - 1000);
    expect(Date.now() - Date.parse(cutoff as string)).toBeLessThan(6 * 3_600_000 + 1000);
  });

  it('moves late scheduled broadcasts back to draft and reports them, sending nothing for them', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    late = { data: [{ id: 'old-1' }, { id: 'old-2' }], error: null };

    const res = await GET(request('shh'));

    expect(await res.json()).toEqual({ started: 0, skipped: 2 });
    // Its time stays, so the broadcast page can say when it was due.
    expect(updates).toEqual([{ status: 'draft' }]);
    // Only a still-scheduled row older than the cutoff is touched.
    expect(filters).toContainEqual(['eq', 'status', 'scheduled']);
    expect(filters).toContainEqual(['lt', 'scheduled_at', expect.any(String)]);
    expect(planBroadcastStart).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('old-1, old-2'));
  });

  it('still starts the on-time ones when the late scan fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    late = { data: null, error: { message: 'db hiccup' } };
    due = { data: [{ id: 'b-1', account_id: 'acc-1' }], error: null };

    const res = await GET(request('shh'));

    expect(await res.json()).toEqual({ started: 1, skipped: 0 });
    expect(error).toHaveBeenCalled();
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
    planBroadcastStart.mockRejectedValueOnce(
      new BroadcastError('conflict', 'no longer scheduled', 409)
    );

    const res = await GET(request('shh'));

    expect(await res.json()).toEqual({ started: 1, skipped: 0 });
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
    planBroadcastStart.mockRejectedValueOnce(new Error('boom'));

    const res = await GET(request('shh'));

    expect(await res.json()).toEqual({ started: 1, skipped: 0 });
    expect(error).toHaveBeenCalled();
  });

  it('closes a broadcast that has nothing to send instead of fanning out', async () => {
    due = { data: [{ id: 'b-1', account_id: 'acc-1' }], error: null };
    planBroadcastStart.mockResolvedValue(plan(0));

    await GET(request('shh'));

    expect(finalizeBroadcastStatus).toHaveBeenCalledWith(admin, 'b-1', 0);
    expect(after).not.toHaveBeenCalled();
  });

  it('500s when the due list cannot be read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    due = { data: null, error: { message: 'db down' } };

    const res = await GET(request('shh'));

    expect(res.status).toBe(500);
    expect(planBroadcastStart).not.toHaveBeenCalled();
  });
});
