'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { fetchAllRows } from '@/lib/supabase/batching';
import { useAuth } from '@/hooks/use-auth';
import type { Conversation } from '@/types';

/**
 * Total unread inbound messages for the sidebar's Inbox badge.
 *
 * Lives on its own realtime channel (distinct from the inbox page's
 * "inbox-realtime") so both can coexist without sharing state.
 */
export function useTotalUnread(): number {
  const { accountId } = useAuth();
  const [result, setResult] = useState({ accountId, total: 0 });

  // Keep a live local mirror of {id: unread_count} so INSERT/UPDATE/DELETE
  // events can adjust the total in O(1) without refetching.
  const countsRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    if (!accountId) return;
    const setTotal = (total: number) => setResult({ accountId, total });
    const supabase = createClient();
    let cancelled = false;
    countsRef.current = new Map();
    const changes = new Map<string, number | null>();

    // Initial load. RLS scopes this to the signed-in user automatically —
    // no explicit user_id filter needed here.
    (async () => {
      const { rows: data, error } = await fetchAllRows<{
        id: string;
        unread_count: number;
      }>((from, to) =>
        supabase
          .from('conversations')
          .select('id, unread_count')
          .eq('account_id', accountId)
          .order('id')
          .range(from, to)
      );
      if (cancelled || error) return;

      const map = new Map<string, number>();
      let sum = 0;
      for (const row of data as { id: string; unread_count: number }[]) {
        const n = row.unread_count ?? 0;
        map.set(row.id, n);
      }
      for (const [id, count] of changes) {
        if (count === null) map.delete(id);
        else map.set(id, count);
      }
      for (const n of map.values()) sum += n;
      countsRef.current = map;
      setTotal(sum);
    })();

    const channel = supabase
      .channel(`total-unread-${accountId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversations', filter: `account_id=eq.${accountId}` },
        (payload) => {
          if (cancelled) return;
          const map = countsRef.current;
          if (payload.eventType === 'DELETE') {
            const oldRow = payload.old as Partial<Conversation>;
            if (oldRow.id) {
              map.delete(oldRow.id);
              changes.set(oldRow.id, null);
            }
          } else {
            const row = payload.new as Conversation;
            map.set(row.id, row.unread_count ?? 0);
            changes.set(row.id, row.unread_count ?? 0);
          }
          // Recompute — cheap, conversations per user stay small.
          let sum = 0;
          for (const n of map.values()) sum += n;
          setTotal(sum);
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [accountId]);

  return result.accountId === accountId ? result.total : 0;
}
