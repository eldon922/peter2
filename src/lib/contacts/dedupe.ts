import type { SupabaseClient } from '@supabase/supabase-js';
import {
  DEFAULT_COUNTRY_CODE,
  normalizePhone,
  phoneVariants,
  toMetaPhone,
} from '@/lib/whatsapp/phone-utils';

/**
 * Contact de-duplication helpers, shared by the WhatsApp webhook, the
 * manual contact form, and CSV import so all paths agree on what
 * "same number" means (issue #212).
 *
 * The canonical key is `normalizePhone` (digits-only) — the same form
 * the DB stores in the generated `contacts.phone_normalized` column
 * and enforces unique per account. Country-code aliases are exact;
 * full-number trunk variants support older Meta sandbox numbers.
 */

/** Canonical de-dup key for a phone string (digits only). */
export function normalizeKey(phone: string): string {
  return normalizePhone(phone);
}

export function phoneLookupKeys(phone: string, countryCode: string): string[] {
  const canonical = toMetaPhone(phone, countryCode);
  if (!canonical) return [];
  return [
    ...new Set([
      normalizePhone(phone),
      canonical,
      `00${canonical}`,
      ...(canonical.startsWith(countryCode)
        ? [`0${canonical.slice(countryCode.length)}`]
        : []),
    ]),
  ];
}

/** Minimal shape we need back from a contacts lookup. */
export interface ExistingContact {
  id: string;
  phone: string;
  name?: string | null;
  [key: string]: unknown;
}

export function phoneMatchSuffix(
  phone: string,
  countryCode = DEFAULT_COUNTRY_CODE
): string {
  const canonical = toMetaPhone(phone, countryCode);
  return (
    canonical.startsWith(countryCode)
      ? canonical.slice(countryCode.length)
      : canonical
  ).slice(-8);
}

export function matchContactByPhone(
  candidates: ExistingContact[],
  phone: string,
  countryCode?: string
): ExistingContact | null {
  const exact = candidates.find((candidate) =>
    isExactMatch(candidate, phone, countryCode)
  );
  if (exact) return exact;
  const variants = new Set(phoneVariants(toMetaPhone(phone, countryCode)));
  return (
    candidates.find((candidate) =>
      variants.has(toMetaPhone(candidate.phone, countryCode))
    ) ?? null
  );
}

/**
 * Find an existing contact in `accountId` whose phone matches `phone`,
 * or null. Pre-filters in SQL by the last-8-digit suffix (so we don't
 * pull every contact). Normalized digits ignore formatting; exact
 * country-code aliases take priority over full-number trunk variants.
 */
export async function findExistingContact(
  db: SupabaseClient,
  accountId: string,
  phone: string,
  countryCode?: string,
  excludeContactId?: string
): Promise<ExistingContact | null> {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;

  const suffix = phoneMatchSuffix(phone, countryCode);

  let query = db.from('contacts').select('*').eq('account_id', accountId);
  if (excludeContactId) query = query.neq('id', excludeContactId);
  const { data, error } = await query.like('phone_normalized', `%${suffix}`);

  if (error) throw error;
  return matchContactByPhone(
    (data ?? []) as ExistingContact[],
    phone,
    countryCode
  );
}

/**
 * True when an existing contact is an *exact* normalized match for
 * `phone` (vs only a fuzzy trunk-variant match). The form hard-blocks
 * exact matches but only warns on fuzzy ones.
 */
export function isExactMatch(
  existing: ExistingContact,
  phone: string,
  countryCode?: string
): boolean {
  return (
    toMetaPhone(existing.phone, countryCode) === toMetaPhone(phone, countryCode)
  );
}

/**
 * True for a Postgres unique-constraint violation (SQLSTATE 23505).
 * Used as the backstop when the DB unique index rejects a racing or
 * format-equal insert that slipped past the in-app check.
 */
export function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  return (error as { code?: string }).code === '23505';
}

/**
 * De-duplicate parsed CSV rows by normalized phone, keeping the first
 * occurrence of each (`onDuplicate` lets the caller fold the repeat's
 * data into it). Rows with an empty normalized phone are dropped
 * (they can't be a valid contact). Returns the unique rows, the count
 * removed, and which rows were removed and why.
 */
export function dedupeByPhone<T extends { phone: string }>(
  rows: T[],
  onDuplicate?: (kept: T, duplicate: T) => void,
  keyForPhone: (phone: string) => string = normalizeKey
): {
  unique: T[];
  duplicates: number;
  dropped: { row: T; reason: 'duplicate' | 'no_phone' }[];
} {
  const seen = new Map<string, T>();
  const unique: T[] = [];
  const dropped: { row: T; reason: 'duplicate' | 'no_phone' }[] = [];

  for (const row of rows) {
    const key = keyForPhone(row.phone);
    if (!key) {
      dropped.push({ row, reason: 'no_phone' });
      continue;
    }
    const kept = seen.get(key);
    if (kept) {
      onDuplicate?.(kept, row);
      dropped.push({ row, reason: 'duplicate' });
      continue;
    }
    seen.set(key, row);
    unique.push(row);
  }

  return { unique, duplicates: dropped.length, dropped };
}
