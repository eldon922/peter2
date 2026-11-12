import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { countLocalAudiencePhones, isLocalPhone } from './local-phones';
import { toMetaPhone } from './phone-utils';

interface CountQuery {
  select: () => CountQuery;
  like: () => CountQuery;
  not: () => CountQuery;
  in: (key: string, ids: string[]) => CountQuery;
  then: (resolve: (result: { count: number; error: null }) => unknown) => Promise<unknown>;
}

describe('local phone conversion notices', () => {
  it('only warns for numbers that assume a country code', () => {
    expect(isLocalPhone('0812 3456-7890')).toBe(true);
    for (const phone of [
      '+6281234567890',
      '6281234567890',
      '006281234567890',
      '',
      '0',
    ])
      expect(isLocalPhone(phone)).toBe(false);
    expect(toMetaPhone('07700 900123', '44')).toBe('447700900123');
    expect(toMetaPhone('00627700900123', '44')).toBe('627700900123');
  });
  it('counts only local numbers in the CSV audience', async () => {
    expect(
      await countLocalAudiencePhones({} as SupabaseClient, {
        kind: 'csv',
        contacts: [
          { phone: '08123456789' },
          { phone: '+628123456789' },
          { phone: '00628123456789' },
        ],
      })
    ).toBe(1);
  });
  it('respects the resolved audience rather than counting excluded contacts', async () => {
    const rows = [
      { id: 'included', phone_normalized: '08123456789' },
      { id: 'excluded', phone_normalized: '08129999999' },
      { id: 'international', phone_normalized: '628123456789' },
      { id: 'prefix', phone_normalized: '00628123456789' },
    ];
    const db = {
      from: () => {
        let selected = rows;
        const query: CountQuery = {
          select: () => query,
          like: () => {
            selected = selected.filter((row) =>
              row.phone_normalized.startsWith('0')
            );
            return query;
          },
          not: () => {
            selected = selected.filter(
              (row) => !row.phone_normalized.startsWith('00')
            );
            return query;
          },
          in: (_key: string, ids: string[]) => {
            selected = selected.filter((row) => ids.includes(row.id));
            return query;
          },
          then: (resolve: (result: { count: number; error: null }) => unknown) =>
            Promise.resolve({ count: selected.length, error: null }).then(
              resolve
            ),
        };
        return query;
      },
    } as unknown as SupabaseClient;
    expect(
      await countLocalAudiencePhones(db, {
        kind: 'ids',
        ids: ['included', 'international'],
      })
    ).toBe(1);
    expect(await countLocalAudiencePhones(db, { kind: 'ids', ids: [] })).toBe(
      0
    );
    expect(await countLocalAudiencePhones(db, { kind: 'all', count: 4 })).toBe(
      2
    );
  });
});
