import type { SupabaseClient } from '@supabase/supabase-js';
import { expect, it } from 'vitest';
import { saveImportedCustomValues } from './import-custom-values';

it('upserts new and existing contact values by their field IDs without clearing blank cells', async () => {
  const writes: unknown[] = [];
  const db = {
    from: (table: string) => {
      expect(table).toBe('contact_custom_values');
      return {
        upsert: (rows: unknown[], options: unknown) => {
          expect(options).toEqual({ onConflict: 'contact_id,custom_field_id' });
          writes.push(...rows);
          return { select: () => Promise.resolve({ data: rows, error: null }) };
        },
      };
    },
  } as unknown as SupabaseClient;
  const result = await saveImportedCustomValues(db, [
    { contactId: 'new', values: { field1: 'Gold', field2: ' ' } },
    { contactId: 'existing', values: { field1: 'Silver', field2: '0' } },
  ]);
  expect(writes).toEqual([
    { contact_id: 'new', custom_field_id: 'field1', value: 'Gold' },
    { contact_id: 'existing', custom_field_id: 'field1', value: 'Silver' },
    { contact_id: 'existing', custom_field_id: 'field2', value: '0' },
  ]);
  expect(result.saved.get('new')).toEqual(['field1']);
  expect(result.saved.get('existing')).toEqual(['field1', 'field2']);
  expect(result.failed.size).toBe(0);
});

it('reports contacts whose custom fields could not be saved', async () => {
  const db = {
    from: () => ({
      upsert: () => ({
        select: () =>
          Promise.resolve({
            data: null,
            error: { message: 'write denied' },
            status: 403,
          }),
      }),
    }),
  } as unknown as SupabaseClient;
  const result = await saveImportedCustomValues(db, [
    { contactId: 'contact', values: { field: 'Gold' } },
  ]);
  expect(result.saved.size).toBe(0);
  expect(result.failed.get('contact')).toBe('write denied');
});
