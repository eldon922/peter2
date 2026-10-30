import type { SupabaseClient } from '@supabase/supabase-js';
import { chunkRows, withRetry } from '@/lib/supabase/batching';

export async function saveImportedCustomValues(
  db: Pick<SupabaseClient, 'from'>,
  assignments: { contactId: string; values: Record<string, string> }[]
) {
  const saved = new Map<string, string[]>();
  const failed = new Map<string, string>();
  const rows = assignments.flatMap(({ contactId, values }) =>
    Object.entries(values)
      .filter(([, value]) => value.trim())
      .map(([fieldId, value]) => ({
        contact_id: contactId,
        custom_field_id: fieldId,
        value,
      }))
  );
  for (const chunk of chunkRows(rows)) {
    try {
      const { data, error } = await withRetry(() =>
        db
          .from('contact_custom_values')
          .upsert(chunk, { onConflict: 'contact_id,custom_field_id' })
          .select('contact_id, custom_field_id')
      );
      if (error) throw error;
      for (const row of data ?? []) {
        saved.set(row.contact_id, [
          ...(saved.get(row.contact_id) ?? []),
          row.custom_field_id,
        ]);
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : String((error as { message?: unknown })?.message ?? error);
      for (const row of chunk) failed.set(row.contact_id, message);
    }
  }
  return { saved, failed };
}
