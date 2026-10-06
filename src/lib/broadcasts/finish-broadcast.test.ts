import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { BroadcastSavedError, finishBroadcast } from './finish-broadcast';

// The write is from().update().eq().eq().select() and the `select` is awaited.
function makeDb(result: { data: unknown[] | null; error: { message: string } | null }) {
  const updates: Record<string, unknown>[] = [];
  const chain = {
    update: (values: Record<string, unknown>) => (updates.push(values), chain),
    eq: () => chain,
    select: () => Promise.resolve(result),
  };
  return { db: { from: () => chain } as unknown as SupabaseClient, updates };
}

const applied = { data: [{ id: 'b-1' }], error: null };
const reply = (status: number, body: unknown = {}) =>
  vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));

describe('finishBroadcast: send now', () => {
  it('sets the total, then starts it', async () => {
    const { db, updates } = makeDb(applied);
    const fetchFn = reply(200);

    await finishBroadcast(db, 'b-1', 42, undefined, fetchFn);

    expect(updates).toEqual([{ total_recipients: 42 }]);
    expect(fetchFn).toHaveBeenCalledWith('/api/broadcasts/b-1/start', { method: 'POST' });
  });

  it('a plain error, nothing locked, when the total could not be set', async () => {
    const { db } = makeDb({ data: null, error: { message: 'db down' } });
    const fetchFn = reply(200);

    const failure = await finishBroadcast(db, 'b-1', 42, undefined, fetchFn).catch((e) => e);

    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(BroadcastSavedError);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('a plain error when the broadcast was removed or changed', async () => {
    const { db } = makeDb({ data: [], error: null });

    const failure = await finishBroadcast(db, 'b-1', 42, undefined, reply(200)).catch((e) => e);

    expect(failure).not.toBeInstanceOf(BroadcastSavedError);
  });

  it('locks it and passes on the server message when the start is refused', async () => {
    const { db } = makeDb(applied);

    await expect(
      finishBroadcast(db, 'b-1', 42, undefined, reply(429, { error: 'Too many requests' }))
    ).rejects.toMatchObject({
      name: 'BroadcastSavedError',
      broadcastId: 'b-1',
      message: 'Too many requests',
    });
  });

  it('locks it when the reply is lost, since it may have started', async () => {
    const { db } = makeDb(applied);
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(finishBroadcast(db, 'b-1', 42, undefined, fetchFn)).rejects.toMatchObject({
      name: 'BroadcastSavedError',
      broadcastId: 'b-1',
      message: expect.stringContaining('may have started'),
    });
  });

  it('locks it when a proxy answers with something that is not ours', async () => {
    const { db } = makeDb(applied);
    const fetchFn = vi.fn().mockResolvedValue(new Response('<html>Bad gateway</html>', { status: 502 }));

    await expect(finishBroadcast(db, 'b-1', 42, undefined, fetchFn)).rejects.toMatchObject({
      name: 'BroadcastSavedError',
      message: 'Failed to start sending',
    });
  });
});

describe('finishBroadcast: a write that throws instead of returning an error', () => {
  const throwing = {
    from: () => {
      const chain = {
        update: () => chain,
        eq: () => chain,
        select: () => Promise.reject(new TypeError('Failed to fetch')),
      };
      return chain;
    },
  } as unknown as SupabaseClient;

  it('locks a schedule, since it may have gone through', async () => {
    await expect(
      finishBroadcast(throwing, 'b-1', 42, '2026-10-08T09:00:00.000Z', reply(200))
    ).rejects.toMatchObject({ name: 'BroadcastSavedError', broadcastId: 'b-1' });
  });

  it('does not lock a send now, which had not started yet', async () => {
    const failure = await finishBroadcast(throwing, 'b-1', 42, undefined, reply(200)).catch(
      (e) => e
    );

    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(BroadcastSavedError);
  });
});

describe('finishBroadcast: schedule', () => {
  it('sets the total and the schedule in one write, and starts nothing', async () => {
    const { db, updates } = makeDb(applied);
    const fetchFn = reply(200);

    await finishBroadcast(db, 'b-1', 42, '2026-10-08T09:00:00.000Z', fetchFn);

    expect(updates).toEqual([
      { total_recipients: 42, status: 'scheduled', scheduled_at: '2026-10-08T09:00:00.000Z' },
    ]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('locks it when that write fails, since a lost reply may still have scheduled it', async () => {
    const { db } = makeDb({ data: null, error: { message: 'TypeError: Failed to fetch' } });

    await expect(
      finishBroadcast(db, 'b-1', 42, '2026-10-08T09:00:00.000Z', reply(200))
    ).rejects.toMatchObject({ name: 'BroadcastSavedError', broadcastId: 'b-1' });
  });
});
