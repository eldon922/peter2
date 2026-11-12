import type { SupabaseClient } from '@supabase/supabase-js';
import { chunkRows } from '@/lib/supabase/batching';

export async function prepareContactPhones(
  db: Pick<SupabaseClient, 'rpc'>,
  accountId: string,
  phones: string[],
  countryCode: string
) {
  for (const batch of chunkRows([...new Set(phones)])) {
    const { error } = await db.rpc('prepare_contact_phones', {
      p_account_id: accountId,
      p_phones: batch,
      p_default_country_code: countryCode,
    });
    if (error) throw error;
  }
}
