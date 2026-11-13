import type { SupabaseClient } from '@supabase/supabase-js';
import type { ResolvedAudience } from '@/lib/broadcasts/audience';
import { chunkIds, fetchAllRows } from '@/lib/supabase/batching';

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

export async function convertedAudience(
  db: Pick<SupabaseClient, 'from'>,
  resolved: NonNullable<ResolvedAudience>
): Promise<NonNullable<ResolvedAudience>> {
  if (resolved.kind === 'csv')
    return {
      kind: 'csv',
      contacts: resolved.contacts.filter((contact) => contact.phone_conversion),
    };
  const result: string[] = [];
  for (const ids of resolved.kind === 'ids' ? chunkIds(resolved.ids) : [null]) {
    const { rows, error } = await fetchAllRows<{ id: string }>((from, to) => {
      let query = db
        .from('contacts')
        .select('id')
        .not('phone_conversion', 'is', null)
        .order('id')
        .range(from, to);
      if (ids) query = query.in('id', ids);
      return query;
    });
    if (error) throw error;
    result.push(...rows.map((row) => row.id));
  }
  return { kind: 'ids', ids: result };
}
