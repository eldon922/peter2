// ============================================================
// Broadcast template-variable resolution — shared by the client
// wizard and the server-side retry planner.
//
// This logic used to live inside `use-broadcast-sending.ts`, which is
// a `'use client'` module. Server code (the retry planner in
// broadcast-core) must not import from a client module, so the pure
// pieces live here and the hook re-exports them for its existing
// callers.
//
// Everything here is isomorphic: it takes a Supabase client rather
// than creating one, so the browser client and the service-role
// client both work.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Contact } from '@/types';
import { phonesMatch } from '@/lib/whatsapp/phone-utils';

/**
 * Variable mapping — each template placeholder (by key, usually "1",
 * "2", …) is resolved at send time. `field` maps to a built-in contact
 * field (name/phone/email/company); `custom_field` maps to a
 * contact_custom_values.value row keyed by the custom_fields.id stored
 * in `value`.
 */
export type VariableMapping =
  | { type: 'static'; value: string }
  | { type: 'field'; value: string }
  | { type: 'custom_field'; value: string };

/** contactId → (customFieldId → value). */
export type CustomValueIndex = Map<string, Map<string, string>>;

/**
 * Per-contact resolution of custom-field placeholders. Static and
 * built-in-field mappings resolve synchronously; custom fields read
 * from a pre-built index to avoid N+1 queries during the send loop.
 */
export function resolveVariables(
  variables: Record<string, VariableMapping>,
  contact: Contact,
  customValues?: Map<string, string>,
): string[] {
  // Keys are typically "1","2",... — numeric-aware sort keeps
  // {{1}} before {{10}}.
  const keys = Object.keys(variables).sort((a, b) => {
    const an = Number(a);
    const bn = Number(b);
    if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
    return a.localeCompare(b);
  });

  return keys.map((key) => {
    const v = variables[key];
    if (v.type === 'static') return v.value;

    if (v.type === 'field') {
      const fieldMap: Record<string, string | undefined> = {
        name: contact.name,
        phone: contact.phone,
        email: contact.email,
        company: contact.company,
      };
      return fieldMap[v.value] ?? '';
    }

    // custom_field
    return customValues?.get(v.value) ?? '';
  });
}

/**
 * Body placeholder keys ("1", "2", …) in template order, deduplicated.
 *
 * Used by the personalize step to build its variable form, and by the
 * retry planner to decide whether a broadcast with no recoverable
 * params can still be retried (a template with no placeholders needs
 * none).
 */
export function bodyPlaceholderKeys(bodyText: string | null | undefined): string[] {
  if (!bodyText) return [];
  const matches = bodyText.match(/\{\{(\d+)\}\}/g);
  if (!matches) return [];
  return [...new Set(matches.map((m) => m.replace(/[{}]/g, '')))];
}

// Contact ids are 36-char UUIDs, so a *count*-based page cap doesn't
// bound the request size: 260 of them alone join into a ~9.6KB query
// string, already past the ~8KB request-line/header limit most
// reverse proxies in front of PostgREST (nginx, Kong) enforce by
// default — the browser reports that as a generic "TypeError: Failed
// to fetch" with no distinguishing HTTP status. Chunk by the joined
// string length instead, well under that ceiling.
const IN_CLAUSE_MAX_CHARS = 3000;

export function chunkIds(ids: string[]): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let currentLength = 0;

  for (const id of ids) {
    const addedLength = id.length + 1; // +1 for the joining comma
    if (current.length > 0 && currentLength + addedLength > IN_CLAUSE_MAX_CHARS) {
      chunks.push(current);
      current = [];
      currentLength = 0;
    }
    current.push(id);
    currentLength += addedLength;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/**
 * Bulk-fetch contact_custom_values for a set of contacts. Returns an
 * index keyed by contact_id → field_id → value.
 */
export async function fetchCustomValueIndex(
  supabase: Pick<SupabaseClient, 'from'>,
  contactIds: string[],
): Promise<CustomValueIndex> {
  const index: CustomValueIndex = new Map();
  if (contactIds.length === 0) return index;

  for (const slice of chunkIds(contactIds)) {
    const { data } = await supabase
      .from('contact_custom_values')
      .select('contact_id, custom_field_id, value')
      .in('contact_id', slice);

    for (const row of data ?? []) {
      const bucket = index.get(row.contact_id) ?? new Map<string, string>();
      bucket.set(row.custom_field_id, row.value ?? '');
      index.set(row.contact_id, bucket);
    }
  }
  return index;
}

/**
 * http(s) URL check for media-header links, shared by the personalize
 * step and the retry planner so both reject the same inputs.
 */
export function isValidHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * True when the number a recipient was actually dialled on no longer
 * matches its contact's current number — i.e. someone edited the
 * contact after the send, so a retry will reach a different phone than
 * the attempt that failed.
 *
 * Uses `phonesMatch`, which treats trunk-prefix variants as equal, so
 * a send that succeeded on a `+620812…` variant of a `+62812…` contact
 * is NOT reported as changed. Only a real edit is.
 *
 * A NULL `phone_attempted` means the row predates migration 037 (or
 * nothing was ever dialled) — there is no claim to make, so false.
 */
export function numberChanged(recipient: {
  phone_attempted?: string | null;
  contact?: { phone?: string | null } | null;
}): boolean {
  const attempted = recipient.phone_attempted;
  const current = recipient.contact?.phone;
  if (!attempted || !current) return false;
  return !phonesMatch(attempted, current);
}
