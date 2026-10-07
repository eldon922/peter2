import type { SupabaseClient } from '@supabase/supabase-js';
import { chunkRows, fetchAllRows, withRetry } from '@/lib/supabase/batching';

const DEFAULT_TAG_COLOR = '#3b82f6';

export interface ResolveImportTagsResult {
  /** Lowercase tag name → tag id. */
  tagIdByKey: Map<string, string>;
  /** Names that could not be matched and were not created. */
  skippedNames: string[];
}

/**
 * Resolve tag names from a CSV import to tag ids. Existing account tags
 * are matched case-insensitively. Missing names are created when
 * `canCreateTags` is true (admin+); otherwise they are reported in
 * `skippedNames`.
 *
 * Unlike the manual contact form (existing tags only), import may
 * auto-create missing tag definitions for admin+ callers.
 */
export async function resolveImportTagIds(
  supabase: SupabaseClient,
  params: {
    accountId: string;
    userId: string;
    tagNames: string[];
    canCreateTags: boolean;
    defaultColor?: string;
  }
): Promise<ResolveImportTagsResult> {
  const { accountId, userId, tagNames, canCreateTags } = params;
  const defaultColor = params.defaultColor ?? DEFAULT_TAG_COLOR;

  const uniqueNames: string[] = [];
  const seen = new Set<string>();
  for (const raw of tagNames) {
    const name = raw.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueNames.push(name);
  }

  if (uniqueNames.length === 0) {
    return { tagIdByKey: new Map(), skippedNames: [] };
  }

  // Paged: one response is capped at 1000 rows, and a tag missed here
  // would be created a second time.
  const { rows: existing, error: fetchError } = await fetchAllRows<{
    id: string;
    name: string;
  }>((from, to) =>
    supabase
      .from('tags')
      .select('id, name')
      .eq('account_id', accountId)
      .order('id')
      .range(from, to)
  );

  if (fetchError) throw new Error(fetchError.message);

  const tagIdByKey = new Map<string, string>();
  for (const tag of existing) {
    const key = tag.name.trim().toLowerCase();
    if (!tagIdByKey.has(key)) tagIdByKey.set(key, tag.id);
  }

  const skippedNames: string[] = [];
  const toCreate: string[] = [];

  for (const name of uniqueNames) {
    const key = name.toLowerCase();
    if (tagIdByKey.has(key)) continue;
    if (canCreateTags) toCreate.push(name);
    else skippedNames.push(name);
  }

  for (const batch of chunkRows(toCreate)) {
    const { data: created, error: createError } = await supabase
      .from('tags')
      .insert(
        batch.map((name) => ({
          user_id: userId,
          account_id: accountId,
          name,
          color: defaultColor,
        }))
      )
      .select('id, name');

    if (createError) throw createError;

    for (const tag of created ?? []) {
      tagIdByKey.set(tag.name.trim().toLowerCase(), tag.id);
    }
  }

  return { tagIdByKey, skippedNames };
}

export interface ContactTagAssignment {
  contactId: string;
  tagNames: string[];
}

export interface AssignTagsResult {
  /** Contact–tag pairs that were actually new. */
  assigned: number;
  /** Contacts that gained at least one tag. */
  contactIds: Set<string>;
}

/**
 * Insert contact_tags rows for imported contacts. Pairs that already
 * exist are ignored, and only the pairs really added are counted.
 */
export async function assignImportedContactTags(
  supabase: SupabaseClient,
  assignments: ContactTagAssignment[],
  tagIdByKey: Map<string, string>
): Promise<AssignTagsResult> {
  const rows: { contact_id: string; tag_id: string }[] = [];

  for (const { contactId, tagNames } of assignments) {
    const assignedTagIds = new Set<string>();
    for (const name of tagNames) {
      const tagId = tagIdByKey.get(name.trim().toLowerCase());
      if (!tagId || assignedTagIds.has(tagId)) continue;
      assignedTagIds.add(tagId);
      rows.push({ contact_id: contactId, tag_id: tagId });
    }
  }

  const result: AssignTagsResult = { assigned: 0, contactIds: new Set() };

  for (const chunk of chunkRows(rows)) {
    const { data, error } = await withRetry(() =>
      supabase
        .from('contact_tags')
        .upsert(chunk, {
          onConflict: 'contact_id,tag_id',
          ignoreDuplicates: true,
        })
        .select('contact_id')
    );
    if (error) throw error;
    for (const row of data ?? []) result.contactIds.add(row.contact_id);
    result.assigned += data?.length ?? 0;
  }

  return result;
}
