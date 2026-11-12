import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { countConvertedAudiencePhones } from './local-phones';

interface CountQuery {
  select: () => CountQuery;
  like: () => CountQuery;
  not: () => CountQuery;
  in: (key: string, ids: string[]) => CountQuery;
  then: (
    resolve: (result: { count: number; error: null }) => unknown
  ) => Promise<unknown>;
}

describe('local phone conversion notices', () => {
  it('counts only local numbers in the CSV audience', async () => {
    expect(
      await countConvertedAudiencePhones({} as SupabaseClient, {
        kind: 'csv',
        contacts: [
          {
            phone: '+628123456789',
            phone_conversion: { input: '08123456789', countryCode: '62' },
          },
          { phone: '+628123456789' },
          { phone: '00628123456789' },
        ],
      })
    ).toBe(1);
  });
  it('respects the resolved audience rather than counting excluded contacts', async () => {
    const rows = [
      {
        id: 'included',
        phone_normalized: '628123456789',
        phone_conversion: { input: '08123456789', countryCode: '62' },
      },
      {
        id: 'excluded',
        phone_normalized: '628129999999',
        phone_conversion: { input: '08129999999', countryCode: '62' },
      },
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
            selected = selected.filter((row) => 'phone_conversion' in row);
            return query;
          },
          in: (_key: string, ids: string[]) => {
            selected = selected.filter((row) => ids.includes(row.id));
            return query;
          },
          then: (
            resolve: (result: { count: number; error: null }) => unknown
          ) =>
            Promise.resolve({ count: selected.length, error: null }).then(
              resolve
            ),
        };
        return query;
      },
    } as unknown as SupabaseClient;
    expect(
      await countConvertedAudiencePhones(db, {
        kind: 'ids',
        ids: ['included', 'international'],
      })
    ).toBe(1);
    expect(
      await countConvertedAudiencePhones(db, { kind: 'ids', ids: [] })
    ).toBe(0);
    expect(
      await countConvertedAudiencePhones(db, { kind: 'all', count: 4 })
    ).toBe(2);
  });
});
