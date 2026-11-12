import type { SupabaseClient } from '@supabase/supabase-js';
import type { ResolvedAudience } from '@/lib/broadcasts/audience';
import { chunkIds } from '@/lib/supabase/batching';
import { normalizePhone } from './phone-utils';

export function isLocalPhone(phone: string): boolean {
  return /^0[1-9]\d*$/.test(normalizePhone(phone));
}

export async function countLocalAudiencePhones(
  db: Pick<SupabaseClient, 'from'>,
  resolved: NonNullable<ResolvedAudience>
): Promise<number> {
  if (resolved.kind === 'csv')
    return resolved.contacts.filter((contact) => isLocalPhone(contact.phone))
      .length;
  let total = 0;
  for (const ids of resolved.kind === 'ids' ? chunkIds(resolved.ids) : [null]) {
    let query = db
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .like('phone_normalized', '0%')
      .not('phone_normalized', 'like', '00%');
    if (ids) query = query.in('id', ids);
    const { count, error } = await query;
    if (error) throw error;
    total += count ?? 0;
  }
  return total;
}
