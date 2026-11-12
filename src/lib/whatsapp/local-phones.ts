import type { SupabaseClient } from '@supabase/supabase-js';
import type { ResolvedAudience } from '@/lib/broadcasts/audience';
import { chunkIds } from '@/lib/supabase/batching';

export async function countConvertedAudiencePhones(
  db: Pick<SupabaseClient, 'from'>,
  resolved: NonNullable<ResolvedAudience>
): Promise<number> {
  if (resolved.kind === 'csv')
    return resolved.contacts.filter((contact) => contact.phone_conversion)
      .length;
  let total = 0;
  for (const ids of resolved.kind === 'ids' ? chunkIds(resolved.ids) : [null]) {
    let query = db
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .not('phone_conversion', 'is', null);
    if (ids) query = query.in('id', ids);
    const { count, error } = await query;
    if (error) throw error;
    total += count ?? 0;
  }
  return total;
}
