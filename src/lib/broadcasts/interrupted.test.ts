import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const stopBroadcast = vi.hoisted(() => vi.fn());
vi.mock('@/lib/whatsapp/broadcast-core', () => ({ stopBroadcast }));

import { failInterruptedBroadcasts, INTERRUPTED_REASON } from './interrupted';

// The sweep reads with from().select().eq().lt() and awaits the `lt` call.
let result: { data: unknown[] | null; error: { message: string } | null };
let filters: [string, string, unknown][];

const db = {
  from: () => {
    const chain = {
      select: () => chain,
      eq: (col: string, val: unknown) => (filters.push(['eq', col, val]), chain),
      lt: (col: string, val: unknown) => (filters.push(['lt', col, val]), Promise.resolve(result)),
    };
    return chain;
  },
} as unknown as SupabaseClient;

const bootedAt = new Date('2026-10-07T08:00:00Z');

beforeEach(() => {
  result = { data: [], error: null };
  filters = [];
  stopBroadcast.mockReset();
  stopBroadcast.mockResolvedValue(undefined);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});

describe('failInterruptedBroadcasts', () => {
  it('only looks at sending broadcasts untouched since the app booted', async () => {
    await failInterruptedBroadcasts(db, bootedAt);

    expect(filters).toContainEqual(['eq', 'status', 'sending']);
    expect(filters).toContainEqual(['lt', 'updated_at', '2026-10-07T08:00:00.000Z']);
  });

  it('stops each one with the restart reason', async () => {
    result = {
      data: [
        { id: 'b-1', account_id: 'acc-1' },
        { id: 'b-2', account_id: 'acc-2' },
      ],
      error: null,
    };

    await failInterruptedBroadcasts(db, bootedAt);

    expect(stopBroadcast).toHaveBeenCalledWith(db, 'acc-1', 'b-1', INTERRUPTED_REASON);
    expect(stopBroadcast).toHaveBeenCalledWith(db, 'acc-2', 'b-2', INTERRUPTED_REASON);
  });

  it('keeps going when one cannot be ended', async () => {
    result = {
      data: [
        { id: 'b-1', account_id: 'acc-1' },
        { id: 'b-2', account_id: 'acc-1' },
      ],
      error: null,
    };
    stopBroadcast.mockRejectedValueOnce(new Error('boom'));

    await failInterruptedBroadcasts(db, bootedAt);

    expect(stopBroadcast).toHaveBeenCalledTimes(2);
  });

  it('does nothing and does not throw when the lookup fails', async () => {
    result = { data: null, error: { message: 'db down' } };

    await expect(failInterruptedBroadcasts(db, bootedAt)).resolves.toBeUndefined();
    expect(stopBroadcast).not.toHaveBeenCalled();
  });
});
