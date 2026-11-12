import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { recordBroadcastReply } from './broadcast-engagement';

const at = (hour: number) =>
  `2026-11-12T${String(hour).padStart(2, '0')}:00:00Z`;
function recipient(id: string, sent: number, created: number, status = 'sent') {
  return {
    id,
    contact_id: 'contact',
    broadcasts: { account_id: 'account' },
    sent_at: at(sent),
    created_at: at(created),
    status,
    replied_at: status === 'replied' ? at(sent + 1) : null,
    whatsapp_message_id: `wamid-${id}`,
  };
}
type Recipient = ReturnType<typeof recipient>;
interface EngagementQuery {
  select: () => EngagementQuery;
  eq: (key: string, expected: unknown) => EngagementQuery;
  in: (key: string, expected: unknown[]) => EngagementQuery;
  lte: (key: string, expected: string) => EngagementQuery;
  order: (key: string, options: { ascending: boolean }) => EngagementQuery;
  limit: (count: number) => EngagementQuery;
  update: (data: Record<string, unknown>) => EngagementQuery;
  then: (
    resolve: (result: { data: Recipient[]; error: null }) => unknown
  ) => Promise<unknown>;
}
function database(rows: Recipient[]) {
  return {
    from: () => {
      const filters: ((row: Recipient) => boolean)[] = [];
      let order: { key: string; ascending: boolean } | undefined;
      let limit = Infinity;
      let patch: Record<string, unknown> | undefined;
      const value = (row: Recipient, key: string): unknown =>
        key === 'broadcasts.account_id'
          ? row.broadcasts.account_id
          : row[key as keyof Recipient];
      const query: EngagementQuery = {
        select: () => query,
        eq: (key: string, expected: unknown) => {
          filters.push((row) => value(row, key) === expected);
          return query;
        },
        in: (key: string, expected: unknown[]) => {
          filters.push((row) => expected.includes(value(row, key)));
          return query;
        },
        lte: (key: string, expected: string) => {
          filters.push(
            (row) =>
              Boolean(value(row, key)) &&
              Date.parse(String(value(row, key))) <= Date.parse(expected)
          );
          return query;
        },
        order: (key: string, options: { ascending: boolean }) => {
          order = { key, ...options };
          return query;
        },
        limit: (count: number) => {
          limit = count;
          return query;
        },
        update: (data: Record<string, unknown>) => {
          patch = data;
          return query;
        },
        then: (
          resolve: (result: { data: Recipient[]; error: null }) => unknown
        ) => {
          let result = rows.filter((row) =>
            filters.every((filter) => filter(row))
          );
          if (order) {
            const { key, ascending } = order;
            result.sort(
              (a, b) =>
                String(value(a, key)).localeCompare(String(value(b, key))) *
                (ascending ? 1 : -1)
            );
          }
          result = result.slice(0, limit);
          if (patch) for (const row of result) Object.assign(row, patch);
          return Promise.resolve({ data: result, error: null }).then(resolve);
        },
      };
      return query;
    },
  } as unknown as SupabaseClient;
}

describe('broadcast engagement attribution', () => {
  it('uses send time rather than creation time and excludes future sends', async () => {
    const rows = [
      recipient('old', 7, 11),
      recipient('latest', 10, 6),
      recipient('future', 14, 12),
    ];
    await recordBroadcastReply(database(rows), 'account', 'contact', at(13));
    expect(
      rows.filter((row) => row.status === 'replied').map((row) => row.id)
    ).toEqual(['latest']);
  });
  it('keeps repeated responses on the latest broadcast instead of crediting older broadcasts', async () => {
    const rows = [
      recipient('old', 7, 6),
      recipient('latest', 10, 9, 'replied'),
    ];
    await recordBroadcastReply(database(rows), 'account', 'contact', at(13));
    expect(rows[0].status).toBe('sent');
    expect(rows[1].replied_at).toBe(at(11));
  });
  it('attributes a quoted reply or reaction to its exact message', async () => {
    const rows = [recipient('old', 7, 6), recipient('latest', 10, 9)];
    await recordBroadcastReply(
      database(rows),
      'account',
      'contact',
      at(13),
      'wamid-old'
    );
    expect(rows[0].status).toBe('replied');
    expect(rows[1].status).toBe('sent');
  });
  it('uses an explicit target even when Meta rounds the event timestamp to the sending second', async () => {
    const rows = [recipient('target', 10, 9)];
    rows[0].sent_at = '2026-11-12T10:00:00.750Z';
    await recordBroadcastReply(
      database(rows),
      'account',
      'contact',
      at(10),
      'wamid-target'
    );
    expect(rows[0].status).toBe('replied');
  });
  it('does not credit another campaign when a quoted target is unknown', async () => {
    const rows = [recipient('latest', 10, 9)];
    await recordBroadcastReply(
      database(rows),
      'account',
      'contact',
      at(13),
      'unknown'
    );
    expect(rows[0].status).toBe('sent');
  });
  it('never credits another account, contact, or failed recipient', async () => {
    const rows = [
      recipient('foreign', 10, 9),
      recipient('other-contact', 10, 9),
      recipient('failed', 10, 9, 'failed'),
    ];
    rows[0].broadcasts.account_id = 'other-account';
    rows[1].contact_id = 'other-contact';
    await recordBroadcastReply(database(rows), 'account', 'contact', at(13));
    expect(rows.some((row) => row.status === 'replied')).toBe(false);
  });
});
