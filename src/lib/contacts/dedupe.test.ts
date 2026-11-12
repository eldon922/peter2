import { describe, expect, it } from 'vitest';
import { normalizePhone, toMetaPhone } from '@/lib/whatsapp/phone-utils';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  dedupeByPhone,
  findExistingContact,
  isExactMatch,
  isUniqueViolation,
  normalizeKey,
  phoneLookupKeys,
} from './dedupe';

describe('normalizeKey', () => {
  it('looks up local, international and 00 aliases using the configured country', () => {
    expect(phoneLookupKeys('+62 8123456789', '62')).toEqual([
      '628123456789',
      '00628123456789',
      '08123456789',
    ]);
    expect(phoneLookupKeys('07700900123', '44')).toContain('447700900123');
    expect(phoneLookupKeys('+62 8123456789', '44')).not.toContain(
      '08123456789'
    );
  });
  it('strips every non-digit', () => {
    expect(normalizeKey('+1 (555) 123-4567')).toBe('15551234567');
    expect(normalizeKey('15551234567')).toBe('15551234567');
  });

  it('collapses different formats of the same number to one key', () => {
    expect(normalizeKey('+44 7911 123456')).toBe(normalizeKey('447911123456'));
  });
});

describe('isExactMatch', () => {
  it('blocks a domestic/international duplicate using the configured country code', () => {
    expect(
      isExactMatch({ id: '1', phone: '0812 3456 7890' }, '+62 81234567890')
    ).toBe(true);
    expect(
      isExactMatch({ id: '1', phone: '07700 900123' }, '+44 7700 900123', '44')
    ).toBe(true);
    expect(
      isExactMatch({ id: '1', phone: '0812 3456 7890' }, '+44 81234567890')
    ).toBe(false);
  });
  it('treats different formatting of the same digits as exact', () => {
    expect(
      isExactMatch({ id: '1', phone: '+1 555-123-4567' }, '15551234567')
    ).toBe(true);
  });

  it('is false for a trunk-variant (fuzzy) match', () => {
    // last-8 match but not the same full number
    expect(
      isExactMatch({ id: '1', phone: '37063949836' }, '370063949836')
    ).toBe(false);
  });
});

describe('isUniqueViolation', () => {
  it('detects Postgres 23505', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
  });
  it('is false for other errors / non-objects', () => {
    expect(isUniqueViolation({ code: '23502' })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation('boom')).toBe(false);
  });
});

describe('dedupeByPhone', () => {
  it('collapses CSV local and international aliases before inserts', () => {
    const { unique } = dedupeByPhone(
      [{ phone: '08123456789' }, { phone: '+628123456789' }],
      undefined,
      (phone) => toMetaPhone(phone, '62')
    );
    expect(unique).toEqual([{ phone: '08123456789' }]);
  });
  it('keeps the first occurrence and counts in-file duplicates', () => {
    const { unique, duplicates } = dedupeByPhone([
      { phone: '+1 555-1111', name: 'A' },
      { phone: '15551111', name: 'B' }, // same digits as #1
      { phone: '+1 555-2222', name: 'C' },
    ]);
    expect(unique.map((r) => r.name)).toEqual(['A', 'C']);
    expect(duplicates).toBe(1);
  });

  it('reports which rows were dropped and why', () => {
    const { dropped } = dedupeByPhone([
      { phone: '+1 555-1111', name: 'A' },
      { phone: '15551111', name: 'B' },
      { phone: '   ', name: 'C' },
    ]);
    expect(dropped.map((d) => [d.row.name, d.reason])).toEqual([
      ['B', 'duplicate'],
      ['C', 'no_phone'],
    ]);
  });

  it('lets the caller fold a repeated row into the kept one', () => {
    const { unique } = dedupeByPhone(
      [
        { phone: '+1 555-1111', tags: ['a'] },
        { phone: '15551111', tags: ['b'] },
      ],
      (kept, repeat) => kept.tags.push(...repeat.tags)
    );
    expect(unique).toEqual([{ phone: '+1 555-1111', tags: ['a', 'b'] }]);
  });

  it('drops rows with no digits', () => {
    const { unique, duplicates } = dedupeByPhone([
      { phone: '   ' },
      { phone: '+1 555-3333' },
    ]);
    expect(unique).toHaveLength(1);
    expect(duplicates).toBe(1);
  });
});

describe('findExistingContact', () => {
  it('finds a formatted domestic contact when WhatsApp sends the international number', async () => {
    const rows = [{ id: 'existing', phone: '0812 3456-7890' }];
    const builder = {
      select: () => builder,
      eq: () => builder,
      like: (column: string, pattern: string) =>
        Promise.resolve({
          data: rows.filter((row) =>
            (column === 'phone_normalized'
              ? normalizePhone(row.phone)
              : row.phone
            ).endsWith(pattern.slice(1))
          ),
          error: null,
        }),
    };
    const db = { from: () => builder } as unknown as SupabaseClient;
    expect(
      (await findExistingContact(db, 'account', '6281234567890'))?.id
    ).toBe('existing');
  });

  it('prefers an exact international match over a similar suffix', async () => {
    const db = stubDb([
      { id: 'similar', phone: '4471234567890' },
      { id: 'exact', phone: '6281234567890' },
    ]);
    expect(
      (await findExistingContact(db, 'account', '6281234567890'))?.id
    ).toBe('exact');
  });
  it('does not attach a customer to a different country just because the last eight digits match', async () => {
    const db = stubDb([{ id: 'other-country', phone: '4471234567890' }]);
    expect(
      await findExistingContact(db, 'account', '6281234567890')
    ).toBeNull();
  });
  // Minimal SupabaseClient stub: resolves the .from().select().eq().like()
  // chain to a fixed candidate set.
  function stubDb(rows: Array<{ id: string; phone: string }>): SupabaseClient {
    const builder = {
      select: () => builder,
      eq: () => builder,
      like: () => Promise.resolve({ data: rows, error: null }),
    };
    return { from: () => builder } as unknown as SupabaseClient;
  }

  it('returns a trunk-variant match via phonesMatch', async () => {
    const db = stubDb([{ id: 'c1', phone: '37063949836' }]);
    const hit = await findExistingContact(db, 'acct', '+370 063 949 836');
    expect(hit?.id).toBe('c1');
  });

  it('returns null when no candidate matches', async () => {
    const db = stubDb([{ id: 'c1', phone: '15559999999' }]);
    const hit = await findExistingContact(db, 'acct', '+1 555-123-4567');
    expect(hit).toBeNull();
  });

  it('returns null for an empty phone without querying', async () => {
    const db = stubDb([{ id: 'c1', phone: '15551234567' }]);
    expect(await findExistingContact(db, 'acct', '   ')).toBeNull();
  });
});
