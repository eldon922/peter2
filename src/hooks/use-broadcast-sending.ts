'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Contact, MessageTemplate } from '@/types';
import {
  fetchCustomValueIndex,
  resolveVariables,
  type VariableMapping,
} from '@/lib/broadcasts/variables';
import { chunkIds, chunkRows, fetchAllRows } from '@/lib/supabase/batching';
import { isHeaderMediaKind } from '@/lib/media-specs';
import { uploadHeaderMedia } from '@/lib/broadcasts/upload-header-media';
import type {
  AudienceConfig,
  CustomFieldFilter,
  CustomFieldOperator,
} from '@/lib/broadcasts/audience';

// Re-exported so existing importers of this hook keep working. The
// implementations moved to lib/broadcasts/variables so the server-side
// retry planner can share them — this module is `'use client'`, which
// server code must not import from.
export { resolveVariables, type VariableMapping };

export type { AudienceConfig, CustomFieldFilter, CustomFieldOperator };

interface BroadcastPayload {
  name: string;
  template: MessageTemplate;
  audience: AudienceConfig;
  variables: Record<string, VariableMapping>;
  /**
   * Public link for an IMAGE/VIDEO/DOCUMENT header. Uploaded to Meta
   * before anything is saved, so a bad link fails here and leaves no
   * broadcast behind. Kept on the broadcast as the source for retries.
   * Ignored when `headerMediaId` is also set.
   */
  headerMediaUrl?: string;
  /** Meta media id from an already-uploaded file for the same header. */
  headerMediaId?: string;
  /**
   * ISO time to send at. When set, the broadcast and its recipients are
   * saved as 'scheduled' and nothing is sent now — the cron (or "Start
   * now" on the broadcast page) sends it later.
   */
  scheduledAt?: string;
}

export type SendingStage =
  | 'uploading'
  | 'resolving'
  | 'creating'
  | 'preparing'
  | 'saving'
  | 'starting';

interface UseBroadcastSendingReturn {
  createAndSendBroadcast: (payload: BroadcastPayload) => Promise<string>;
  isProcessing: boolean;
  progress: number;
  /** What the send is doing right now, for the progress panel. */
  stage: SendingStage | null;
  /** Recipients saved so far vs. total, during the `saving` stage. */
  counts: { done: number; total: number } | null;
}

/** Bulk-fetch contacts by id, chunked to stay under the request-size limit. */
async function fetchContactsByIds(
  supabase: ReturnType<typeof createClient>,
  contactIds: string[],
): Promise<Contact[]> {
  const contacts: Contact[] = [];
  for (const slice of chunkIds(contactIds)) {
    const { data, error } = await supabase
      .from('contacts')
      .select('*')
      .in('id', slice);
    if (error) throw new Error(`Failed to fetch contacts: ${error.message}`);
    contacts.push(...((data ?? []) as Contact[]));
  }
  return contacts;
}

/**
 * Non-blocking now — see the comment at its call site.
 * `/api/broadcasts/recipient-limit`'s server-side check (Meta's live
 * messaging-limit tier for the account — see recipientLimitForTier in
 * broadcast-limits.ts) is the source of `limit`.
 */
function audienceTooLargeWarning(size: number, limit: number): string {
  return `This audience has ${size.toLocaleString()} contacts, above this account's limit of about ${limit.toLocaleString()}. Some may not be sent the first time — after it finishes, open the broadcast and press Retry to send the rest.`;
}

/**
 * Best-effort: a failed fetch here should never block sending, just
 * mean the size warning below is skipped. `Infinity` makes every
 * `size > recipientLimit` comparison false without a separate
 * "did the lookup succeed" branch at each call site.
 */
async function fetchRecipientLimit(): Promise<number> {
  try {
    const res = await fetch('/api/broadcasts/recipient-limit');
    if (!res.ok) return Infinity;
    const data = (await res.json()) as { limit?: number };
    return typeof data.limit === 'number' ? data.limit : Infinity;
  } catch {
    return Infinity;
  }
}

export function useBroadcastSending(): UseBroadcastSendingReturn {
  const { accountId } = useAuth();
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState<SendingStage | null>(null);
  const [counts, setCounts] = useState<{ done: number; total: number } | null>(null);

  /**
   * Every read below goes through `fetchAllRows`. PostgREST clips each
   * response to its `max_rows` (1,000 by default) without any error, so
   * a plain `.select()` returned only the first 1,000 contacts — and,
   * worse, only the first 1,000 *excluded* contacts, letting the rest
   * through to the send. Pages are ordered by `id` so offset paging is
   * stable.
   */
  async function resolveAudience(audience: AudienceConfig): Promise<Contact[]> {
    const supabase = createClient();

    let contacts: Contact[] = [];

    if (audience.type === 'all') {
      const { rows, error } = await fetchAllRows<Contact>((from, to) =>
        supabase.from('contacts').select('*').order('id').range(from, to)
      );
      if (error) throw new Error(`Failed to fetch contacts: ${error.message}`);
      contacts = rows;
    } else if (
      audience.type === 'tags' &&
      audience.tagIds &&
      audience.tagIds.length > 0
    ) {
      const tagIds = audience.tagIds;
      const { rows: contactTags, error: tagError } = await fetchAllRows<{
        contact_id: string;
      }>((from, to) =>
        supabase
          .from('contact_tags')
          .select('contact_id')
          .in('tag_id', tagIds)
          .order('id')
          .range(from, to)
      );

      if (tagError)
        throw new Error(`Failed to fetch contact tags: ${tagError.message}`);

      if (contactTags.length > 0) {
        const uniqueContactIds = [
          ...new Set(contactTags.map((ct) => ct.contact_id)),
        ];
        contacts = await fetchContactsByIds(supabase, uniqueContactIds);
      }
    } else if (audience.type === 'custom_field' && audience.customField) {
      contacts = await resolveCustomFieldAudience(supabase, audience.customField);
    } else if (audience.type === 'csv' && audience.csvContacts) {
      contacts = await upsertCsvContacts(supabase, audience.csvContacts);
    }

    // Apply exclude tags (works across all contact-derived audience
    // types). CSV contacts are synthetic so exclusion doesn't apply.
    if (audience.excludeTagIds && audience.excludeTagIds.length > 0) {
      const excludeTagIds = audience.excludeTagIds;
      const { rows: excludeRows, error: excludeError } = await fetchAllRows<{
        contact_id: string;
      }>((from, to) =>
        supabase
          .from('contact_tags')
          .select('contact_id')
          .in('tag_id', excludeTagIds)
          .order('id')
          .range(from, to)
      );
      // Abort rather than send without the exclusion: an incomplete
      // exclude list means messaging people the user opted out.
      if (excludeError) {
        throw new Error(
          `Failed to fetch excluded contacts: ${excludeError.message}`,
        );
      }
      const excludedIds = new Set(excludeRows.map((r) => r.contact_id));
      contacts = contacts.filter((c) => !excludedIds.has(c.id));
    }

    return contacts;
  }

  /**
   * CSV uploads arrive as raw phone/name pairs, not DB rows. Before we
   * can insert broadcast_recipients (whose contact_id FKs contacts.id),
   * we need real contacts.id UUIDs. So: look up each CSV phone in the
   * caller's contacts table; insert any that don't exist; return the
   * resolved set.
   *
   * Pre-existing implementation synthesized `csv-N` strings as
   * contact_id, which failed the UUID cast on insert — every CSV
   * broadcast silently created zero recipients.
   */
  async function upsertCsvContacts(
    supabase: ReturnType<typeof createClient>,
    csvRows: { phone: string; name?: string }[],
  ): Promise<Contact[]> {
    if (csvRows.length === 0) return [];

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) {
      throw new Error('You are not signed in.');
    }
    if (!accountId) {
      throw new Error('Your profile is not linked to an account.');
    }

    // De-duplicate by phone within the CSV (users can paste duplicates).
    const uniqueByPhone = new Map<string, { phone: string; name?: string }>();
    for (const row of csvRows) {
      if (row.phone) uniqueByPhone.set(row.phone, row);
    }
    const phones = [...uniqueByPhone.keys()];

    // Single round-trip lookup of existing contacts by phone.
    const { data: existing, error: lookupErr } = await supabase
      .from('contacts')
      .select('*')
      .eq('user_id', user.id)
      .in('phone', phones);
    if (lookupErr) {
      throw new Error(`Failed to look up CSV contacts: ${lookupErr.message}`);
    }

    const byPhone = new Map<string, Contact>();
    for (const c of (existing ?? []) as Contact[]) {
      if (c.phone) byPhone.set(c.phone, c);
    }

    // Insert only missing contacts, in one batch per 200 rows (PostgREST
    // has a default payload cap — 200 keeps individual requests small).
    const missing = phones
      .filter((p) => !byPhone.has(p))
      .map((phone) => ({
        user_id: user.id,
        account_id: accountId,
        phone,
        name: uniqueByPhone.get(phone)?.name ?? null,
      }));

    for (const chunk of chunkRows(missing)) {
      const { data: inserted, error: insertErr } = await supabase
        .from('contacts')
        .insert(chunk)
        .select();
      if (insertErr) {
        throw new Error(`Failed to create CSV contacts: ${insertErr.message}`);
      }
      for (const c of (inserted ?? []) as Contact[]) {
        if (c.phone) byPhone.set(c.phone, c);
      }
    }

    // Preserve input order so analytics roughly matches the CSV order.
    return phones
      .map((p) => byPhone.get(p))
      .filter((c): c is Contact => Boolean(c));
  }

  async function resolveCustomFieldAudience(
    supabase: ReturnType<typeof createClient>,
    filter: CustomFieldFilter,
  ): Promise<Contact[]> {
    const { fieldId, operator, value } = filter;

    // Build the WHERE clause for the operator. PostgREST supports
    // eq/neq/ilike via the query builder — use ilike with wildcards
    // for "contains" so the match is case-insensitive.
    //
    // A function, not a variable: supabase-js builders are mutable, so
    // each page needs a fresh one or the ranges would stack.
    const buildQuery = () => {
      let query = supabase
        .from('contact_custom_values')
        .select('contact_id')
        .eq('custom_field_id', fieldId);

      if (operator === 'is') query = query.eq('value', value);
      else if (operator === 'is_not') query = query.neq('value', value);
      else if (operator === 'contains')
        query = query.ilike('value', `%${value}%`);
      return query;
    };

    const { rows: matches, error: matchErr } = await fetchAllRows<{
      contact_id: string;
    }>((from, to) => buildQuery().order('id').range(from, to));
    if (matchErr)
      throw new Error(`Custom-field filter failed: ${matchErr.message}`);

    const contactIds = [...new Set(matches.map((m) => m.contact_id))];
    if (contactIds.length === 0) return [];

    return fetchContactsByIds(supabase, contactIds);
  }

  async function createAndSendBroadcast(payload: BroadcastPayload): Promise<string> {
    setIsProcessing(true);
    setProgress(0);
    setStage('resolving');
    setCounts(null);

    const supabase = createClient();

    try {
      // ── Step 0: Resolve current user ──────────────────────────────
      // broadcasts.user_id is NOT NULL + guarded by RLS
      // (auth.uid() = user_id). Without this, the INSERT below was
      // silently failing with 23502 / 42501 — the wizard would
      // no-op with no feedback.
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) {
        throw new Error('You are not signed in.');
      }
      if (!accountId) {
        throw new Error('Your profile is not linked to an account.');
      }

      // ── Step 0b: Media header ─────────────────────────────────────
      // Media-header templates need a Meta media id on every send. A
      // picked file already has one; a link is uploaded now, before
      // anything is saved, so a bad link leaves no broadcast behind.
      const mediaKind = payload.template.header_type;
      let headerMediaId: string | undefined;
      let headerMediaUrl: string | undefined;
      if (isHeaderMediaKind(mediaKind)) {
        headerMediaId = payload.headerMediaId?.trim() || undefined;
        headerMediaUrl = headerMediaId ? undefined : payload.headerMediaUrl?.trim() || undefined;
        if (headerMediaUrl) {
          setStage('uploading');
          headerMediaId = await uploadHeaderMedia(
            headerMediaUrl,
            mediaKind,
            'Could not upload the media.'
          );
        }
      }

      // ── Step 1: Resolve audience contacts ─────────────────────────
      setStage('resolving');
      setProgress(5);
      const contacts = await resolveAudience(payload.audience);

      if (contacts.length === 0) {
        throw new Error('No contacts found for this audience.');
      }

      // Server-side sending no longer hard-caps a broadcast — what one
      // pass can't send is marked failed and has to be retried by hand
      // (see createBroadcast's comment in broadcast-core.ts), so this
      // is advisory only: it doesn't block or throw, it just lets the
      // person sending know up front that they may need to press Retry
      // instead of assuming "sending" means "sent" a moment later. The
      // limit itself comes from the server (recipient-limit route),
      // which can ask Meta for this account's live messaging-limit
      // tier — something the browser can never do on its own.
      const recipientLimit = await fetchRecipientLimit();
      if (contacts.length > recipientLimit) {
        toast.warning(audienceTooLargeWarning(contacts.length, recipientLimit));
      }

      // ── Step 2: Create broadcast row ──────────────────────────────
      // Count columns are owned by the DB aggregate trigger (migrations
      // 003/005) and derived from broadcast_recipients — never seeded
      // or written here, or a manual value races the trigger.
      setProgress(10);
      setStage('creating');
      const { data: broadcast, error: broadcastError } = await supabase
        .from('broadcasts')
        .insert({
          user_id: user.id,
          account_id: accountId,
          name: payload.name,
          template_name: payload.template.name,
          template_language: payload.template.language ?? 'en_US',
          template_variables: payload.variables,
          // Persisted so a retry reproduces this exact media header
          // instead of silently falling back to the template default.
          header_media_url: headerMediaUrl || null,
          header_media_id: headerMediaId || null,
          // Meta drops uploaded media after 30 days; retries use this to
          // notice an aged id. Stamped at insert, which trails the actual
          // upload by however long the user sat in the wizard — the check
          // keeps a 1-day margin for that.
          header_media_uploaded_at: headerMediaId ? new Date().toISOString() : null,
          audience_filter: {
            type: payload.audience.type,
            tagIds: payload.audience.tagIds,
            customField: payload.audience.customField,
            excludeTagIds: payload.audience.excludeTagIds,
          },
          status: payload.scheduledAt ? 'scheduled' : 'sending',
          scheduled_at: payload.scheduledAt ?? null,
          total_recipients: contacts.length,
        })
        .select()
        .single();

      if (broadcastError || !broadcast) {
        throw new Error(
          `Failed to create broadcast: ${broadcastError?.message ?? 'unknown error'}`,
        );
      }

      // ── Step 3: Resolve params, then insert recipient rows ────────
      // Resolution happens BEFORE the insert so each row is born with
      // its `template_params`. That makes the values durable: a retry
      // replays exactly what was sent, and an abandoned tab still
      // leaves retryable rows behind.
      setProgress(20);
      setStage('preparing');
      const customValueIndex = await fetchCustomValueIndex(
        supabase,
        contacts.map((c) => c.id),
      );
      const paramsByContact = new Map<string, string[]>(
        contacts.map((contact) => [
          contact.id,
          resolveVariables(
            payload.variables,
            contact,
            customValueIndex.get(contact.id),
          ),
        ]),
      );

      const recipientRows = contacts.map((contact) => ({
        broadcast_id: broadcast.id,
        contact_id: contact.id,
        status: 'pending' as const,
        template_params: paramsByContact.get(contact.id) ?? [],
      }));

      setStage('saving');
      let saved = 0;
      setCounts({ done: 0, total: recipientRows.length });
      for (const [batchIndex, batch] of chunkRows(recipientRows).entries()) {
        const { error: recipientError } = await supabase
          .from('broadcast_recipients')
          .insert(batch);
        if (recipientError) {
          // Previous impl logged and marched on — the broadcast then ran
          // with an incomplete recipient set, so webhook status updates
          // couldn't find some rows and the aggregate counts drifted.
          // Flip the broadcast to failed so the user sees the problem
          // immediately, then throw to abort the send loop. Only the
          // status: failed_count belongs to the trigger.
          await supabase
            .from('broadcasts')
            .update({ status: 'failed' })
            .eq('id', broadcast.id);
          throw new Error(
            `Failed to insert recipient batch ${batchIndex + 1}: ${recipientError.message}`,
          );
        }
        saved += batch.length;
        setCounts({ done: saved, total: recipientRows.length });
        // 20 → 40 across the inserts, so a big audience visibly moves.
        setProgress(20 + Math.round((saved / recipientRows.length) * 20));
      }

      // ── Step 4: Hand the fan-out to the server ─────────────────────
      // Every row above is already 'pending' with its template_params
      // resolved, so from here this is exactly what a retry does:
      // kick off /api/broadcasts/{id}/send, which plans the pending
      // rows and delivers them in `after()` — the same server-side
      // path `deliverBroadcast` uses for retries, instead of this hook
      // looping batches against /api/whatsapp/broadcast itself. The
      // actual send no longer depends on this tab staying open; the
      // broadcast detail page polls `broadcasts`/`broadcast_recipients`
      // for live progress once we navigate there.
      //
      // A scheduled broadcast stops here: its recipient rows stay
      // 'pending' until the cron or "Start now" sends them.
      setProgress(40);
      if (!payload.scheduledAt) {
        setStage('starting');
        const sendRes = await fetch(`/api/broadcasts/${broadcast.id}/send`, {
          method: 'POST',
        });
        if (!sendRes.ok) {
          const sendData = await sendRes.json().catch(() => ({}));
          throw new Error(sendData.error || 'Failed to start sending');
        }
      }

      setProgress(100);
      return broadcast.id;
    } finally {
      setIsProcessing(false);
      setStage(null);
      setCounts(null);
    }
  }

  return { createAndSendBroadcast, isProcessing, progress, stage, counts };
}
