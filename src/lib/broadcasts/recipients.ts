import type { SupabaseClient } from '@supabase/supabase-js';

import { fetchAllRows } from '@/lib/supabase/batching';
import type { BroadcastRecipient } from '@/types';

export async function fetchBroadcastRecipients(
  supabase: Pick<SupabaseClient, 'from'>,
  broadcastId: string,
  includeTags: boolean
): Promise<BroadcastRecipient[]> {
  // Page by immutable id so sending cannot move rows between pages.
  const { rows, error } = await fetchAllRows<BroadcastRecipient>((from, to) =>
    supabase
      .from('broadcast_recipients')
      .select(
        includeTags
          ? '*, contact:contacts(*, contact_tags(tag_id))'
          : '*, contact:contacts(*)'
      )
      .eq('broadcast_id', broadcastId)
      .order('id', { ascending: true })
      .range(from, to)
  );
  if (error) throw new Error(error.message);

  // Keep the table and export in sent-time order, with unsent rows last.
  return rows.sort((a, b) => {
    if (a.sent_at && b.sent_at) {
      const bySentAt = Date.parse(b.sent_at) - Date.parse(a.sent_at);
      if (bySentAt) return bySentAt;
    } else if (a.sent_at) return -1;
    else if (b.sent_at) return 1;
    return a.id.localeCompare(b.id);
  });
}
