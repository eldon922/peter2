// ============================================================
// Broadcast audience resolution for the wizard (browser client).
//
// Step 2 (estimate + contact list) and step 4 (final confirmation) read
// the same audience, so the lookups live here once.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { contactDisplayName } from '@/lib/contacts/display-name';
import { chunkIds, fetchAllRows } from '@/lib/supabase/batching';

export type CustomFieldOperator = 'is' | 'is_not' | 'contains';

export interface CustomFieldFilter {
  fieldId: string;
  operator: CustomFieldOperator;
  value: string;
}

export interface AudienceConfig {
  type: 'all' | 'tags' | 'custom_field' | 'csv';
  tagIds?: string[];
  customField?: CustomFieldFilter;
  csvContacts?: { phone: string; name?: string }[];
  /** Contacts carrying any of these tags are subtracted from the result. */
  excludeTagIds?: string[];
}

/** One row of the recipient list shown in the wizard. */
export interface AudienceContact {
  id: string;
  name: string | null;
  profile_name?: string | null;
  phone: string;
}

/**
 * `null` while the audience is only partially configured.
 * `all` is "every contact" with no exclusions, so it needs no id list.
 */
export type ResolvedAudience =
  | { kind: 'ids'; ids: string[] }
  | { kind: 'all'; count: number }
  | { kind: 'csv'; contacts: { phone: string; name?: string }[] }
  | null;

export const AUDIENCE_PAGE_SIZE = 50;

type Supabase = Pick<SupabaseClient, 'from'>;

async function contactIdsForTags(
  supabase: Supabase,
  tagIds: string[],
): Promise<string[]> {
  const { rows, error } = await fetchAllRows<{ contact_id: string }>(
    (from, to) =>
      supabase
        .from('contact_tags')
        .select('contact_id')
        .in('tag_id', tagIds)
        .order('id')
        .range(from, to),
  );
  if (error) throw new Error(error.message);
  return [...new Set(rows.map((r) => r.contact_id))];
}

async function contactIdsForCustomField(
  supabase: Supabase,
  { fieldId, operator, value }: CustomFieldFilter,
): Promise<string[]> {
  // A function so each page gets a fresh (mutable) query builder.
  const buildQuery = () => {
    let q = supabase
      .from('contact_custom_values')
      .select('contact_id')
      .eq('custom_field_id', fieldId);
    if (operator === 'is') q = q.eq('value', value);
    else if (operator === 'is_not') q = q.neq('value', value);
    else q = q.ilike('value', `%${value}%`);
    return q;
  };
  const { rows, error } = await fetchAllRows<{ contact_id: string }>(
    (from, to) => buildQuery().order('id').range(from, to),
  );
  if (error) throw new Error(error.message);
  return [...new Set(rows.map((r) => r.contact_id))];
}

async function allContactIds(supabase: Supabase): Promise<string[]> {
  const { rows, error } = await fetchAllRows<{ id: string }>((from, to) =>
    supabase.from('contacts').select('id').order('id').range(from, to),
  );
  if (error) throw new Error(error.message);
  return rows.map((r) => r.id);
}

export async function resolveAudience(
  supabase: Supabase,
  audience: AudienceConfig,
): Promise<ResolvedAudience> {
  const excludeTagIds = audience.excludeTagIds ?? [];
  let ids: string[];

  if (audience.type === 'all') {
    if (excludeTagIds.length === 0) {
      const { count, error } = await supabase
        .from('contacts')
        .select('*', { count: 'exact', head: true });
      if (error) throw new Error(error.message);
      return { kind: 'all', count: count ?? 0 };
    }
    ids = await allContactIds(supabase);
  } else if (audience.type === 'tags' && audience.tagIds?.length) {
    ids = await contactIdsForTags(supabase, audience.tagIds);
  } else if (
    audience.type === 'custom_field' &&
    audience.customField?.fieldId &&
    audience.customField.value
  ) {
    ids = await contactIdsForCustomField(supabase, audience.customField);
  } else if (audience.type === 'csv' && audience.csvContacts?.length) {
    // CSV contacts are synthetic, so exclusion doesn't apply (same as send).
    return { kind: 'csv', contacts: audience.csvContacts };
  } else {
    return null;
  }

  if (excludeTagIds.length > 0) {
    const excluded = new Set(await contactIdsForTags(supabase, excludeTagIds));
    ids = ids.filter((id) => !excluded.has(id));
  }
  return { kind: 'ids', ids };
}

export function resolvedCount(resolved: ResolvedAudience): number | null {
  if (!resolved) return null;
  if (resolved.kind === 'ids') return resolved.ids.length;
  if (resolved.kind === 'all') return resolved.count;
  return resolved.contacts.length;
}

/** One page of the recipient list. */
export async function fetchAudiencePage(
  supabase: Supabase,
  resolved: NonNullable<ResolvedAudience>,
  offset: number,
  limit = AUDIENCE_PAGE_SIZE,
): Promise<AudienceContact[]> {
  if (resolved.kind === 'csv') {
    return resolved.contacts.slice(offset, offset + limit).map((c, i) => ({
      id: `csv-${offset + i}`,
      name: c.name ?? null,
      phone: c.phone,
    }));
  }

  if (resolved.kind === 'all') {
    const { data, error } = await supabase
      .from('contacts')
      .select('id, name, profile_name, phone')
      .order('name', { nullsFirst: false })
      .order('id')
      .range(offset, offset + limit - 1);
    if (error) throw new Error(error.message);
    return (data ?? []) as AudienceContact[];
  }

  const slice = resolved.ids.slice(offset, offset + limit);
  const rows: AudienceContact[] = [];
  for (const chunk of chunkIds(slice)) {
    const { data, error } = await supabase
      .from('contacts')
      .select('id, name, profile_name, phone')
      .in('id', chunk);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as AudienceContact[]));
  }
  return rows.sort((a, b) =>
    contactDisplayName(a).localeCompare(contactDisplayName(b)),
  );
}
