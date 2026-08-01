// ============================================================
// Shared contact logic for the public API (v1) contact endpoints.
//
// Kept out of the route files so `GET/POST /api/v1/contacts` and
// `GET/PATCH /api/v1/contacts/{id}` share one serializer, one
// find-or-create (built on the same `findExistingContact` dedupe the
// webhook and send path use), and one tag-sync routine.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { chunkIds, chunkRows } from '@/lib/supabase/batching';
import {
  findExistingContact,
  isUniqueViolation,
  type ExistingContact,
} from '@/lib/contacts/dedupe';
import { resolveImportTagIds } from '@/lib/contacts/resolve-import-tags';
import { addContactTagAndDispatch } from '@/lib/contacts/tag-events';
import {
  sanitizePhoneForMeta,
  isValidE164,
  normalizePhone,
  phonesMatch,
} from '@/lib/whatsapp/phone-utils';

/** Row select that embeds the contact's tags for serialization. */
export const CONTACT_SELECT = '*, contact_tags(tags(*))';

export interface ApiContact {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  company: string | null;
  avatar_url: string | null;
  tags: { id: string; name: string; color: string }[];
  created_at: string;
  updated_at: string;
}

/** Thrown by the helpers below; routes map `.status`/`.message`. */
export class ContactError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ContactError';
    this.status = status;
  }
}

type RawTagJoin = { tags: { id: string; name: string; color: string } | null };

/** Flatten a `CONTACT_SELECT` row into the public contact shape. */
export function serializeContact(row: Record<string, unknown>): ApiContact {
  const joins = (row.contact_tags as RawTagJoin[] | undefined) ?? [];
  return {
    id: row.id as string,
    phone: row.phone as string,
    name: (row.name as string | null) ?? null,
    email: (row.email as string | null) ?? null,
    company: (row.company as string | null) ?? null,
    avatar_url: (row.avatar_url as string | null) ?? null,
    tags: joins
      .map((j) => j.tags)
      .filter((t): t is NonNullable<RawTagJoin['tags']> => t != null)
      .map((t) => ({ id: t.id, name: t.name, color: t.color })),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

/**
 * Resolve the audit `user_id` for API-created rows — the SINGLE source
 * of truth used by every public-API write (contacts, messages,
 * broadcasts, resolve-conversation), so the same key's writes are
 * always attributed to the same human. API callers have no logged-in
 * user, so — like the inbound webhook — we attribute writes to the
 * **WhatsApp config owner** (the webhook's own convention). Contacts
 * can be created before WhatsApp is connected, so we fall back to the
 * account owner when there's no config yet.
 */
export async function resolveAuditUserId(
  db: SupabaseClient,
  accountId: string
): Promise<string> {
  const { data: config } = await db
    .from('whatsapp_config')
    .select('user_id')
    .eq('account_id', accountId)
    .maybeSingle();
  const configOwner = config?.user_id as string | undefined;
  if (configOwner) return configOwner;

  const { data: account } = await db
    .from('accounts')
    .select('owner_user_id')
    .eq('id', accountId)
    .maybeSingle();
  const owner = account?.owner_user_id as string | undefined;
  if (!owner) {
    throw new ContactError('Account owner could not be resolved', 500);
  }
  return owner;
}

export interface ContactInput {
  phone: string;
  name?: string | null;
  email?: string | null;
  company?: string | null;
}

/**
 * Find (by fuzzy phone match) or create a contact in `accountId`.
 * Returns the contact id and whether it was created. Reuses the shared
 * `findExistingContact` dedupe + unique-violation race backstop so an
 * API-created contact is indistinguishable from a webhook-created one.
 */
export async function findOrCreateContact(
  db: SupabaseClient,
  accountId: string,
  auditUserId: string,
  input: ContactInput
): Promise<{ id: string; created: boolean }> {
  const sanitized = sanitizePhoneForMeta(input.phone);
  if (!isValidE164(sanitized)) {
    throw new ContactError(
      "'phone' must be a valid phone number in E.164 format (e.g. +14155550123)",
      400
    );
  }

  const existing = await findExistingContact(db, accountId, sanitized);
  if (existing) return { id: existing.id, created: false };

  const { data: created, error } = await db
    .from('contacts')
    .insert({
      account_id: accountId,
      user_id: auditUserId,
      phone: sanitized,
      name: input.name ?? sanitized,
      email: input.email ?? null,
      company: input.company ?? null,
    })
    .select('id')
    .single();

  if (error || !created) {
    // Lost a race against a concurrent create — the unique index
    // rejected the duplicate. Re-resolve to the winner.
    if (isUniqueViolation(error)) {
      const raced = await findExistingContact(db, accountId, sanitized);
      if (raced) return { id: raced.id, created: false };
    }
    console.error('[api/v1/contacts] create error:', error);
    throw new ContactError('Failed to create contact', 500);
  }

  return { id: created.id, created: true };
}

/**
 * Bulk form of {@link findOrCreateContact}: resolve many phones in a
 * handful of round trips instead of one (or two) per phone.
 *
 * Motivation — the broadcast create path resolved recipients in a
 * sequential `await` loop, so a 1000-recipient request cost 1000+
 * sequential round trips *inline in the request*, before the `after()`
 * fan-out even started. That is a Postgres-latency bound with nothing to
 * do with Meta pacing, and it scaled linearly with the recipient cap.
 *
 * Matching semantics are identical to the single-row helper, because
 * they are the same two steps: pre-filter in SQL on the last-8-digit
 * suffix, then apply the strict `phonesMatch` in JS. Here the suffixes
 * are OR'd into one query per chunk and candidates are bucketed by
 * suffix, so matching stays O(n) rather than O(n×m).
 *
 * Returns a map from each input phone to its contact id. Inputs that
 * normalize to the same contact (trunk-prefix variants, or a literal
 * duplicate) share an entry — the caller collapses those later.
 *
 * Throws {@link ContactError} on a lookup failure, matching the single
 * -row helper: a half-resolved audience must not silently become a
 * partial send.
 */
export async function findOrCreateContactsBulk(
  db: SupabaseClient,
  accountId: string,
  auditUserId: string,
  phones: string[],
): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();
  const unique = [...new Set(phones)];
  if (unique.length === 0) return resolved;

  // Two phones can only match if they share this key: `phonesMatch` is
  // either an exact normalized equality or a last-8-digit equality, and
  // both imply the same bucket.
  const bucketKey = (phone: string): string => {
    const n = normalizePhone(phone);
    return n.length >= 8 ? n.slice(-8) : n;
  };

  // ── 1. One lookup per chunk of suffixes, not per phone ──────────
  const suffixes = [...new Set(unique.map(bucketKey))].filter(Boolean);
  const candidates: ExistingContact[] = [];
  // `chunkIds` bounds the joined filter length, keeping the query string
  // under the ~8KB request-line ceiling proxies impose on PostgREST.
  for (const chunk of chunkIds(suffixes.map((s) => `phone.like.*${s}`))) {
    const { data, error } = await db
      .from('contacts')
      .select('*')
      .eq('account_id', accountId)
      .or(chunk.join(','));
    if (error) {
      console.error('[api/v1/contacts] bulk lookup error:', error);
      throw new ContactError('Failed to look up contacts', 500);
    }
    candidates.push(...((data ?? []) as ExistingContact[]));
  }

  const byBucket = new Map<string, ExistingContact[]>();
  for (const candidate of candidates) {
    const key = bucketKey(candidate.phone);
    const bucket = byBucket.get(key);
    if (bucket) bucket.push(candidate);
    else byBucket.set(key, [candidate]);
  }

  const missing: string[] = [];
  for (const phone of unique) {
    const hit = (byBucket.get(bucketKey(phone)) ?? []).find((c) =>
      phonesMatch(c.phone, phone),
    );
    if (hit) resolved.set(phone, hit.id);
    else missing.push(phone);
  }

  if (missing.length === 0) return resolved;

  // ── 2. Insert the misses in bulk ────────────────────────────────
  // Deduped by normalized key first: two inputs that normalize alike
  // are one contact, and inserting both would trip the unique index
  // from migration 022 and fail the whole statement.
  const newByKey = new Map<string, string>();
  for (const phone of missing) {
    const key = normalizePhone(phone);
    if (!newByKey.has(key)) newByKey.set(key, phone);
  }

  const idByKey = new Map<string, string>();
  const pending = [...newByKey.values()];

  for (const batch of chunkRows(pending)) {
    const { data, error } = await db
      .from('contacts')
      .insert(
        batch.map((phone) => ({
          account_id: accountId,
          user_id: auditUserId,
          phone,
          name: phone,
          email: null,
          company: null,
        })),
      )
      .select('id, phone');

    if (error || !data) {
      // A concurrent create won the unique index, which fails the whole
      // batch. Fall back to the single-row helper for this batch only —
      // it carries the same 23505 backstop and re-resolves to the
      // winner. Rare, and bounded to one batch.
      if (isUniqueViolation(error)) {
        for (const phone of batch) {
          const { id } = await findOrCreateContact(db, accountId, auditUserId, {
            phone,
          });
          idByKey.set(normalizePhone(phone), id);
        }
        continue;
      }
      console.error('[api/v1/contacts] bulk create error:', error);
      throw new ContactError('Failed to create contacts', 500);
    }

    for (const row of data as { id: string; phone: string }[]) {
      idByKey.set(normalizePhone(row.phone), row.id);
    }
  }

  for (const phone of missing) {
    const id = idByKey.get(normalizePhone(phone));
    if (id) resolved.set(phone, id);
  }

  return resolved;
}

/**
 * Replace a contact's tags to exactly match `tagNames` (case-
 * insensitive; missing tags are created). A no-op when `tagNames` is
 * undefined — pass `[]` to clear all tags. Reuses `resolveImportTagIds`
 * so API and CSV-import tag handling stay consistent.
 */
export async function setContactTags(
  db: SupabaseClient,
  accountId: string,
  auditUserId: string,
  contactId: string,
  tagNames: string[]
): Promise<void> {
  const { tagIdByKey } = await resolveImportTagIds(db, {
    accountId,
    userId: auditUserId,
    tagNames,
    canCreateTags: true,
  });
  const desired = new Set(tagIdByKey.values());

  // Diff against the current joins rather than delete-all-then-insert:
  // a diff only touches tags that actually change, so a mid-operation
  // failure can never wipe tags that were meant to stay. Every write
  // is error-checked and surfaced as a ContactError (→ 500) instead of
  // being swallowed behind a misleading 200.
  const { data: current, error: readErr } = await db
    .from('contact_tags')
    .select('tag_id')
    .eq('contact_id', contactId);
  if (readErr) {
    throw new ContactError('Failed to read contact tags', 500);
  }
  const existing = new Set(
    (current ?? []).map((r) => r.tag_id as string)
  );

  const toAdd = [...desired].filter((id) => !existing.has(id));
  const toRemove = [...existing].filter((id) => !desired.has(id));

  if (toRemove.length > 0) {
    const { error } = await db
      .from('contact_tags')
      .delete()
      .eq('contact_id', contactId)
      .in('tag_id', toRemove);
    if (error) throw new ContactError('Failed to update contact tags', 500);
  }
  if (toAdd.length > 0) {
    for (const tagId of toAdd) {
      try {
        await addContactTagAndDispatch({
          db,
          accountId,
          contactId,
          tagId,
        });
      } catch (error) {
        console.error('[api/v1/contacts] tag add failed:', error);
        throw new ContactError('Failed to update contact tags', 500);
      }
    }
  }
}

/** Fetch + serialize a single contact scoped to the account, or null. */
export async function getContactById(
  db: SupabaseClient,
  accountId: string,
  contactId: string
): Promise<ApiContact | null> {
  const { data, error } = await db
    .from('contacts')
    .select(CONTACT_SELECT)
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (error || !data) return null;
  return serializeContact(data as Record<string, unknown>);
}
