import { expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveAudience } from './audience';
import { UNTAGGED } from '@/lib/contacts/tag-filter';

const contacts = [{ id: 'a', phone: '+628111111111' }, { id: 'b', phone: '+628222222222' }, { id: 'c', phone: '+628333333333' }];
const assignments = [{ id: '1', contact_id: 'a', tag_id: 'vip' }, { id: '2', contact_id: 'a', tag_id: 'exclude' }, { id: '3', contact_id: 'b', tag_id: 'vip' }];
function database() {
  return { from(table: string) {
    let rows = table === 'contacts' ? contacts as Record<string, string>[] : assignments as Record<string, string>[];
    let first = 0; let last = Infinity;
    const query = {
      select: () => query,
      in: (key: string, values: string[]) => { rows = rows.filter((row) => values.includes(row[key])); return query; },
      order: () => query,
      range: (from: number, to: number) => { first = from; last = to; return query; },
      then: (resolve: (value: unknown) => void) => Promise.resolve({ data: rows.slice(first, last + 1), error: null }).then(resolve),
    };
    return query;
  } } as unknown as SupabaseClient;
}

it('counts unique excluded recipients after tag matching', async () => {
  expect(await resolveAudience(database(), { type: 'tags', tagIds: ['vip'], excludeTagIds: ['exclude'] })).toEqual({ kind: 'ids', ids: ['b'], excludedCount: 1 });
});
it('includes untagged contacts alongside an included tag', async () => {
  expect(await resolveAudience(database(), { type: 'tags', tagIds: ['exclude', UNTAGGED] })).toMatchObject({ ids: ['a', 'c'] });
});
it('excludes existing and new untagged CSV numbers before saving contacts', async () => {
  const resolved = await resolveAudience(database(), { type: 'csv', excludeTagIds: [UNTAGGED], csvContacts: [{ phone: '+62 8111111111' }, { phone: '+628333333333' }, { phone: '+628444444444' }] });
  expect(resolved).toEqual({ kind: 'csv', contacts: [{ phone: '+62 8111111111' }], excludedCount: 2 });
});
