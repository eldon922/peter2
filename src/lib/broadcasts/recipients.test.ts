import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import type { BroadcastRecipient } from '@/types';
import { fetchBroadcastRecipients } from './recipients';

function recipient(id: number, sentAt?: string): BroadcastRecipient {
  return {
    id: String(id).padStart(6, '0'),
    broadcast_id: 'broadcast-1',
    contact_id: null,
    status: sentAt ? 'sent' : 'pending',
    sent_at: sentAt,
    created_at: '2026-10-01T00:00:00Z',
  };
}

function makeDb(
  rows: BroadcastRecipient[],
  { cap = 1000, failAt }: { cap?: number; failAt?: number } = {}
) {
  const requests: URL[] = [];
  const fetchFn: typeof fetch = async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    requests.push(url);
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const limit = Number(url.searchParams.get('limit') ?? cap);
    if (offset === failAt) {
      return new Response(
        JSON.stringify({ message: 'Could not load recipients' }),
        {
          status: 400,
        }
      );
    }
    return new Response(
      JSON.stringify(rows.slice(offset, offset + Math.min(limit, cap))),
      {
        headers: { 'Content-Type': 'application/json' },
      }
    );
  };
  const db = createClient('https://example.supabase.co', 'test-anon-key', {
    global: { fetch: fetchFn },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  return { db, requests };
}

describe('fetchBroadcastRecipients', () => {
  it.each([0, 1000, 1001, 2505])(
    'loads all %i recipients for the table, count and CSV',
    async (total) => {
      const rows = Array.from({ length: total }, (_, i) => recipient(i));
      const { db, requests } = makeDb(rows);

      const result = await fetchBroadcastRecipients(db, 'broadcast-1', false);

      expect(result).toEqual(rows);
      for (const url of requests) {
        expect(url.pathname).toBe('/rest/v1/broadcast_recipients');
        expect(url.searchParams.getAll('broadcast_id')).toEqual([
          'eq.broadcast-1',
        ]);
        expect(url.searchParams.get('select')).toBe('*,contact:contacts(*)');
        expect(url.searchParams.get('order')).toBe('id.asc');
      }
    }
  );

  it('continues after short pages when the server cap is lower than 1000', async () => {
    const rows = Array.from({ length: 1201 }, (_, i) => recipient(i));
    const { db } = makeDb(rows, { cap: 300 });

    await expect(
      fetchBroadcastRecipients(db, 'broadcast-1', false)
    ).resolves.toEqual(rows);
  });

  it('includes contact tags on every page for tag-targeted broadcasts', async () => {
    const { db, requests } = makeDb(
      Array.from({ length: 1001 }, (_, i) => recipient(i))
    );

    await fetchBroadcastRecipients(db, 'broadcast-1', true);

    expect(requests.length).toBeGreaterThan(1);
    for (const url of requests) {
      expect(url.searchParams.get('select')).toBe(
        '*,contact:contacts(*,contact_tags(tag_id))'
      );
    }
  });

  it('sorts newest sent first with id ties and unsent recipients last across pages', async () => {
    const old = '2026-10-01T01:00:00Z';
    const recent = '2026-10-02T01:00:00Z';
    const rows = [
      recipient(0),
      recipient(1, old),
      recipient(2, recent),
      recipient(3, recent),
      recipient(4),
    ];
    const { db } = makeDb(rows, { cap: 2 });

    const result = await fetchBroadcastRecipients(db, 'broadcast-1', false);

    expect(result.map((r) => r.id)).toEqual(
      [2, 3, 1, 0, 4].map((i) => rows[i].id)
    );
  });

  it('rejects a failed later page instead of exposing a partial recipient list', async () => {
    const { db } = makeDb(
      Array.from({ length: 1001 }, (_, i) => recipient(i)),
      { failAt: 1000 }
    );

    await expect(
      fetchBroadcastRecipients(db, 'broadcast-1', false)
    ).rejects.toThrow('Could not load recipients');
  });
});
