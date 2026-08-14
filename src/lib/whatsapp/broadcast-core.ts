// ============================================================
// Public-API broadcast core.
//
// Splits a broadcast into two phases so the HTTP route can persist +
// acknowledge fast and fan out afterwards (in `after()`):
//
//   createBroadcast()  — validate, resolve contacts, insert the
//                        `broadcasts` row + `broadcast_recipients`
//                        rows (status 'pending'), return a plan.
//   deliverBroadcast() — send each recipient's template via Meta
//                        (phone-variant retry), stamp each recipient
//                        row + the aggregate counts, finalize status.
//
// Recipient rows carry `whatsapp_message_id`, so the inbound webhook's
// status handler (which matches on that column) updates delivered/read
// for API broadcasts exactly as it does for dashboard ones.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { sendTemplateMessage } from '@/lib/whatsapp/meta-api';
import { decrypt } from '@/lib/whatsapp/encryption';
import {
  DELIVER_BUDGET_MS,
  MAX_RECIPIENTS,
  SEND_BATCH_DELAY_MS,
  SEND_BATCH_SIZE,
} from '@/lib/whatsapp/broadcast-limits';
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils';
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard';
import type { SendTimeParams } from '@/lib/whatsapp/template-send-builder';
import type { Contact, MessageTemplate } from '@/types';
import { findOrCreateContactsBulk } from '@/lib/api/v1/contacts';
import {
  bodyPlaceholderKeys,
  fetchCustomValueIndex,
  isValidHttpUrl,
  resolveVariables,
  type VariableMapping,
} from '@/lib/broadcasts/variables';
import { createLogger } from '@/lib/log';

const log = createLogger('broadcast');

/** Thrown by createBroadcast on a caller-visible failure; route maps it. */
export class BroadcastError extends Error {
  readonly code: string;
  readonly status: number;
  /**
   * Extra machine-readable context for errors the UI has to act on
   * rather than just display — e.g. `header_media_required` carries
   * the header type so the prompt can label itself and preview an
   * image correctly.
   */
  readonly details?: Record<string, unknown>;
  constructor(
    code: string,
    message: string,
    status: number,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'BroadcastError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export interface BroadcastRecipientInput {
  /** E.164 phone. */
  to: string;
  /** Positional body params for the template ({{1}}, {{2}}…). */
  params?: string[];
}

export interface CreateBroadcastParams {
  name?: string | null;
  templateName: string;
  templateLanguage?: string | null;
  recipients: BroadcastRecipientInput[];
}

interface PlannedRecipient {
  recipientRowId: string;
  phone: string;
  params: string[];
  /**
   * Structured send-time values (currently the media-header URL). Set
   * on retries of media-header templates, where the URL comes from
   * `broadcasts.header_media_url` rather than the template default.
   */
  messageParams?: SendTimeParams;
}

export interface BroadcastPlan {
  broadcastId: string;
  templateName: string;
  templateLanguage: string;
  phoneNumberId: string;
  accessToken: string;
  templateRow: MessageTemplate | null;
  planned: PlannedRecipient[];
  /** Phones rejected up front (invalid E.164) — counted as failed. */
  rejected: number;
  /**
   * True when this plan re-sends already-failed rows. Changes how the
   * terminal broadcast status is computed: a retry where everything
   * fails again must not mark a partially-successful broadcast
   * 'failed'.
   */
  isRetry?: boolean;
  /**
   * Failed rows still awaiting a retry after this call's claim — a true
   * count, so the caller can tell how many more passes are needed.
   */
  remaining?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Load the per-account send context: Meta credentials plus the local
 * template row used to build header/button components.
 *
 * Shared by createBroadcast and planBroadcastRetry — loading it once
 * per broadcast rather than per recipient avoids an N+1, and guarding
 * a malformed local row here fails loudly once instead of producing N
 * identical opaque TypeErrors inside the send loop.
 */
async function loadSendContext(
  db: SupabaseClient,
  accountId: string,
  templateName: string,
  templateLanguage: string
): Promise<{
  phoneNumberId: string;
  accessToken: string;
  templateRow: MessageTemplate | null;
}> {
  const { data: config, error: configError } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', accountId)
    .single();
  if (configError || !config) {
    throw new BroadcastError(
      'whatsapp_not_configured',
      'WhatsApp not configured. Please set up your WhatsApp integration first.',
      400
    );
  }

  const { data: rawTemplateRow } = await db
    .from('message_templates')
    .select('*')
    .eq('account_id', accountId)
    .eq('name', templateName)
    .eq('language', templateLanguage)
    .maybeSingle();
  if (rawTemplateRow && !isMessageTemplate(rawTemplateRow)) {
    throw new BroadcastError(
      'template_malformed',
      'Template row is malformed locally — run "Sync from Meta" in Settings to repair it before broadcasting.',
      500
    );
  }

  return {
    phoneNumberId: config.phone_number_id,
    accessToken: decrypt(config.access_token),
    templateRow: (rawTemplateRow as MessageTemplate | null) ?? null,
  };
}

/**
 * Validate + persist a broadcast, resolving each recipient to a
 * contact. Returns a plan for {@link deliverBroadcast}. Throws
 * {@link BroadcastError} on bad input / missing config / a malformed
 * template / a DB failure — nothing is sent in this phase.
 */
export async function createBroadcast(
  db: SupabaseClient,
  accountId: string,
  auditUserId: string,
  params: CreateBroadcastParams
): Promise<BroadcastPlan> {
  const { name, templateName, recipients } = params;
  const templateLanguage = params.templateLanguage || 'en_US';

  if (!templateName) {
    throw new BroadcastError('bad_request', "'template_name' is required", 400);
  }
  if (!Array.isArray(recipients) || recipients.length === 0) {
    throw new BroadcastError(
      'bad_request',
      "'recipients' must be a non-empty array of { to, params? }",
      400
    );
  }
  if (recipients.length > MAX_RECIPIENTS) {
    throw new BroadcastError(
      'bad_request',
      `A broadcast is capped at ${MAX_RECIPIENTS} recipients per request; split larger sends`,
      400
    );
  }

  // Meta credentials + template row (fail fast before anything is
  // persisted or sent).
  const { phoneNumberId, accessToken, templateRow } = await loadSendContext(
    db,
    accountId,
    templateName,
    templateLanguage
  );

  // Resolve each recipient to a contact. Invalid phones are dropped
  // (counted as rejected) rather than aborting the whole broadcast.
  const resolved: { contactId: string; phone: string; params: string[] }[] = [];
  let rejected = 0;
  // Sanitize and validate first — pure, no I/O — so the contact lookup
  // sees only phones worth resolving.
  const prepared: { phone: string; params: string[] }[] = [];
  for (const r of recipients) {
    const sanitized = sanitizePhoneForMeta(typeof r.to === 'string' ? r.to : '');
    if (!isValidE164(sanitized)) {
      rejected++;
      continue;
    }
    prepared.push({
      phone: sanitized,
      params: Array.isArray(r.params)
        ? r.params.filter((p): p is string => typeof p === 'string')
        : [],
    });
  }

  // Resolve every recipient in a handful of round trips. This used to be
  // a sequential `await` per recipient, which put N round trips of
  // Postgres latency on the request path before the `after()` fan-out
  // even began — the cost scaled with the recipient cap and had nothing
  // to do with Meta throughput.
  const contactIdByPhone = await findOrCreateContactsBulk(
    db,
    accountId,
    auditUserId,
    prepared.map((p) => p.phone)
  );

  for (const p of prepared) {
    const contactId = contactIdByPhone.get(p.phone);
    if (!contactId) {
      // The resolver throws on any real failure, so a gap here would
      // mean a silently dropped recipient — louder is better.
      throw new BroadcastError(
        'internal',
        'Failed to resolve every recipient to a contact',
        500
      );
    }
    resolved.push({ contactId, phone: p.phone, params: p.params });
  }

  // Collapse recipients that resolved to the SAME contact (the caller
  // listed a phone twice, or two numbers fuzzy-matched to one contact).
  // Keep the first occurrence so the contact is messaged once and its
  // params aren't silently overwritten by a later duplicate — and so
  // the row↔params pairing below (keyed by contact_id) is unambiguous.
  const seenContact = new Set<string>();
  const deduped = resolved.filter((r) => {
    if (seenContact.has(r.contactId)) return false;
    seenContact.add(r.contactId);
    return true;
  });

  if (deduped.length === 0) {
    throw new BroadcastError(
      'bad_request',
      'No recipients had a valid E.164 phone number',
      400
    );
  }

  // Persist the broadcast + its recipients. The count columns
  // (sent/delivered/read/replied/failed) are owned by the DB aggregate
  // trigger (migrations 003/005) and derived purely from
  // broadcast_recipients rows — we deliberately do NOT seed them here
  // (a manual value would be clobbered by the trigger on the first
  // recipient change). `rejected` phones have no recipient row, so they
  // are reported to the caller in the POST response, not in these
  // persisted counts.
  const { data: broadcast, error: bErr } = await db
    .from('broadcasts')
    .insert({
      account_id: accountId,
      user_id: auditUserId,
      name: name || `API broadcast (${templateName})`,
      template_name: templateName,
      template_language: templateLanguage,
      status: 'sending',
      total_recipients: deduped.length,
    })
    .select('id')
    .single();
  if (bErr || !broadcast) {
    console.error('[broadcast-core] create broadcast error:', bErr);
    throw new BroadcastError('internal', 'Failed to create broadcast', 500);
  }

  // `template_params` is stored at insert (not at send) so the params
  // survive an `after()` cutoff: a row that never got sent can still be
  // retried with the exact values the caller supplied. Without this the
  // API path persisted per-recipient params nowhere at all, leaving
  // those broadcasts permanently un-retryable.
  const { data: recipientRows, error: rErr } = await db
    .from('broadcast_recipients')
    .insert(
      deduped.map((r) => ({
        broadcast_id: broadcast.id,
        contact_id: r.contactId,
        status: 'pending' as const,
        template_params: r.params,
      }))
    )
    .select('id, contact_id');
  if (rErr || !recipientRows) {
    console.error('[broadcast-core] create recipients error:', rErr);
    throw new BroadcastError('internal', 'Failed to create broadcast', 500);
  }

  // Pair each inserted recipient row back to its phone/params by
  // contact_id — unambiguous now that duplicates are collapsed.
  const byContact = new Map(deduped.map((r) => [r.contactId, r]));
  const planned: PlannedRecipient[] = recipientRows.map((row) => {
    const r = byContact.get(row.contact_id as string)!;
    return { recipientRowId: row.id as string, phone: r.phone, params: r.params };
  });

  return {
    broadcastId: broadcast.id,
    templateName,
    templateLanguage,
    phoneNumberId,
    accessToken,
    templateRow,
    planned,
    rejected,
  };
}

/** A failed recipient row joined to its contact, as read for a retry. */
interface FailedRecipientRow {
  id: string;
  contact_id: string | null;
  attempt_count: number | null;
  template_params: unknown;
  contact: Contact | null;
}

/**
 * Build a {@link BroadcastPlan} that re-sends only the *failed*
 * recipients of an existing broadcast.
 *
 * Params are resolved through a four-case ladder, because what is
 * recoverable depends on when and how the broadcast was created:
 *
 *   1. `recipient.template_params` — the values actually sent. Exact
 *      replay. Present on everything sent after migration 037.
 *   2. `broadcasts.template_variables` — a mapping, re-resolved
 *      against the contact. Covers wizard broadcasts predating 037.
 *   3. Template has no body placeholders — nothing to recover.
 *   4. Otherwise refuse. API broadcasts predating 037 stored
 *      per-recipient params nowhere, and re-sending a personalized
 *      template with blank variables is worse than not sending.
 *
 * Case 4 throws *before* any row is claimed, so a refusal never
 * consumes the failures it declined to retry.
 *
 * The claim itself (failed → pending) is a compare-and-set and doubles
 * as the concurrency guard: a second concurrent retry claims nothing.
 * Resetting to 'pending' also matters for correctness downstream —
 * 'failed' is terminal in the webhook status ladder, so a row left at
 * 'failed' would have the new send's delivered/read callbacks
 * rejected.
 */
export async function planBroadcastRetry(
  db: SupabaseClient,
  accountId: string,
  broadcastId: string,
  opts: { recipientId?: string; headerMediaUrl?: string } = {}
): Promise<BroadcastPlan> {
  const { data: broadcast, error: bErr } = await db
    .from('broadcasts')
    .select(
      'id, template_name, template_language, template_variables, header_media_url, status'
    )
    .eq('id', broadcastId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (bErr) {
    console.error('[broadcast-core] retry read broadcast error:', bErr);
    throw new BroadcastError('internal', 'Failed to read broadcast', 500);
  }
  if (!broadcast) {
    throw new BroadcastError('not_found', 'Broadcast not found', 404);
  }
  if (broadcast.status === 'sending') {
    throw new BroadcastError(
      'conflict',
      'This broadcast is still sending. Wait for it to finish before retrying.',
      409
    );
  }

  const templateLanguage = broadcast.template_language || 'en_US';

  // `count: 'exact'` reports how many failed rows match in total,
  // independent of the row window `limit` returns — so `remaining` below
  // is a true count rather than a "there is at least one more" flag.
  // PostgREST computes it in the same round trip; no second query.
  let query = db
    .from('broadcast_recipients')
    .select(
      'id, contact_id, attempt_count, template_params, contact:contacts(*)',
      { count: 'exact' }
    )
    .eq('broadcast_id', broadcastId)
    .eq('status', 'failed')
    .order('created_at', { ascending: true })
    .limit(MAX_RECIPIENTS);
  if (opts.recipientId) query = query.eq('id', opts.recipientId);

  const { data: rawRows, error: rErr, count } = await query;
  if (rErr) {
    console.error('[broadcast-core] retry read recipients error:', rErr);
    throw new BroadcastError('internal', 'Failed to read recipients', 500);
  }

  const rows = (rawRows ?? []) as unknown as FailedRecipientRow[];
  // Fall back to the claimed rows when the driver reports no count: that
  // yields remaining = 0, which understates rather than inventing a
  // number the caller would act on.
  const totalFailed = typeof count === 'number' ? count : rows.length;
  const remaining = Math.max(0, totalFailed - rows.length);

  // A contact deleted since the send leaves contact_id NULL (migration
  // 004), so there is no number to dial. Re-stamp with a reason rather
  // than letting the row silently disappear from the retry.
  const orphaned = rows.filter((r) => !r.contact?.phone);
  const sendable = rows.filter((r) => r.contact?.phone);
  for (const row of orphaned) {
    await db
      .from('broadcast_recipients')
      .update({
        status: 'failed',
        error_message: 'Contact no longer exists',
        last_attempt_at: new Date().toISOString(),
      })
      .eq('id', row.id);
  }

  if (sendable.length === 0) {
    return {
      broadcastId,
      templateName: broadcast.template_name,
      templateLanguage,
      phoneNumberId: '',
      accessToken: '',
      templateRow: null,
      planned: [],
      rejected: 0,
      isRetry: true,
      remaining,
    };
  }

  const { phoneNumberId, accessToken, templateRow } = await loadSendContext(
    db,
    accountId,
    broadcast.template_name,
    templateLanguage
  );

  // Without the local template row we cannot tell whether this template
  // has a media header or body placeholders, so every downstream
  // decision would be a guess. createBroadcast tolerates a null row
  // because its caller supplies everything explicitly; a retry has no
  // such caller, so refuse rather than send a degraded message.
  if (!templateRow) {
    throw new BroadcastError(
      'template_missing',
      `Template "${broadcast.template_name}" (${templateLanguage}) is no longer in this account, so the original message cannot be rebuilt. Run "Sync from Meta" in Settings, then retry.`,
      422
    );
  }

  // Media headers need a URL on every send. We will NOT quietly fall
  // back to the template's current default here: for a broadcast that
  // predates header_media_url, that would re-send a different image
  // than the original with no indication anything changed. Ask for it
  // instead — the caller can supply one and we persist it so this is a
  // one-time prompt.
  const headerType = templateRow.header_type;
  const isMediaHeader =
    headerType === 'image' || headerType === 'video' || headerType === 'document';
  const suppliedMediaUrl = opts.headerMediaUrl?.trim();
  const storedMediaUrl = broadcast.header_media_url?.trim();
  let headerMediaUrl = suppliedMediaUrl || storedMediaUrl || undefined;

  if (isMediaHeader) {
    if (!headerMediaUrl) {
      throw new BroadcastError(
        'header_media_required',
        `This broadcast uses a ${headerType} header but predates media URLs being recorded, so we cannot tell which ${headerType} it sent. Supply the URL to retry with.`,
        422,
        { headerType }
      );
    }
    if (!isValidHttpUrl(headerMediaUrl)) {
      throw new BroadcastError(
        'bad_request',
        'The media URL must be a valid http(s) URL.',
        400
      );
    }
    // Persist a newly supplied URL so later retries don't re-prompt.
    if (suppliedMediaUrl && suppliedMediaUrl !== storedMediaUrl) {
      await db
        .from('broadcasts')
        .update({ header_media_url: suppliedMediaUrl })
        .eq('id', broadcastId);
    }
  } else {
    headerMediaUrl = undefined;
  }

  // Case 2 is the only one needing custom-field lookups; skip the
  // round-trips entirely when every row already carries its params.
  const needsResolution = sendable.filter((r) => !Array.isArray(r.template_params));
  const templateVariables = (broadcast.template_variables ?? null) as Record<
    string,
    VariableMapping
  > | null;
  const templateHasPlaceholders =
    bodyPlaceholderKeys(templateRow.body_text).length > 0;

  if (needsResolution.length > 0 && !templateVariables && templateHasPlaceholders) {
    // Case 4 — thrown before any claim, so the rows stay 'failed'.
    throw new BroadcastError(
      'params_unrecoverable',
      'This broadcast was created before per-recipient template values were stored, so its personalization cannot be reproduced. Create a new broadcast for these recipients instead.',
      422
    );
  }

  const customValues =
    needsResolution.length > 0 && templateVariables
      ? await fetchCustomValueIndex(
          db,
          needsResolution.map((r) => r.contact!.id)
        )
      : new Map();

  // Always explicit for media headers — validated above, never left to
  // the builder's template-default fallback.
  const messageParams: SendTimeParams | undefined = headerMediaUrl
    ? { headerMediaUrl }
    : undefined;

  // Claim: compare-and-set on status. Only rows we actually win are
  // planned, so concurrent retries can't double-send.
  const planned: PlannedRecipient[] = [];
  const claimedAt = new Date().toISOString();
  for (const row of sendable) {
    const contact = row.contact!;
    const params = Array.isArray(row.template_params)
      ? (row.template_params as string[])
      : templateVariables
        ? resolveVariables(templateVariables, contact, customValues.get(contact.id))
        : [];

    const { data: claimed, error: claimErr } = await db
      .from('broadcast_recipients')
      .update({
        status: 'pending',
        error_message: null,
        attempt_count: (row.attempt_count ?? 1) + 1,
        last_attempt_at: claimedAt,
      })
      .eq('id', row.id)
      .eq('status', 'failed')
      .select('id');
    if (claimErr) {
      console.error('[broadcast-core] retry claim error:', claimErr);
      continue;
    }
    if (!claimed || claimed.length === 0) continue; // lost the race

    planned.push({
      recipientRowId: row.id,
      phone: contact.phone as string,
      params,
      ...(messageParams ? { messageParams } : {}),
    });
  }

  // Back to 'sending' so the list page resumes polling and Delete stays
  // disabled while the fan-out runs.
  if (planned.length > 0) {
    await db
      .from('broadcasts')
      .update({ status: 'sending', updated_at: new Date().toISOString() })
      .eq('id', broadcastId);
  }

  return {
    broadcastId,
    templateName: broadcast.template_name,
    templateLanguage,
    phoneNumberId,
    accessToken,
    templateRow,
    planned,
    rejected: 0,
    isRetry: true,
    remaining,
  };
}

/** A pending recipient row joined to its contact, as read for a send. */
interface PendingRecipientRow {
  id: string;
  contact_id: string | null;
  template_params: unknown;
  contact: Contact | null;
}

/**
 * Build a {@link BroadcastPlan} for a broadcast whose `broadcasts` row
 * and `pending` `broadcast_recipients` rows already exist — created
 * just before this call by the dashboard wizard (`use-broadcast-sending`),
 * which still resolves the audience, creates the broadcast, and
 * inserts recipient rows (each already carrying its resolved
 * `template_params`) client-side.
 *
 * This function's only job is turning those rows into a plan for
 * {@link deliverBroadcast}, the same way {@link planBroadcastRetry}
 * does for a retry — so the wizard's actual Meta fan-out runs
 * server-side in `after()` instead of looping batches from the
 * browser. Unlike a retry there is no prior attempt to reconcile: no
 * variable re-resolution, no claim/compare-and-set (nothing else can
 * be racing a 'pending' row created moments ago in the same flow), no
 * media-URL prompt (the wizard collected it before insert).
 */
export async function planBroadcastSend(
  db: SupabaseClient,
  accountId: string,
  broadcastId: string
): Promise<BroadcastPlan> {
  const { data: broadcast, error: bErr } = await db
    .from('broadcasts')
    .select('id, template_name, template_language, header_media_url, status')
    .eq('id', broadcastId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (bErr) {
    console.error('[broadcast-core] send read broadcast error:', bErr);
    throw new BroadcastError('internal', 'Failed to read broadcast', 500);
  }
  if (!broadcast) {
    throw new BroadcastError('not_found', 'Broadcast not found', 404);
  }

  const templateLanguage = broadcast.template_language || 'en_US';

  const { data: rawRows, error: rErr } = await db
    .from('broadcast_recipients')
    .select('id, contact_id, template_params, contact:contacts(*)')
    .eq('broadcast_id', broadcastId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(MAX_RECIPIENTS);
  if (rErr) {
    console.error('[broadcast-core] send read recipients error:', rErr);
    throw new BroadcastError('internal', 'Failed to read recipients', 500);
  }

  const rows = (rawRows ?? []) as unknown as PendingRecipientRow[];

  // A contact deleted in the gap between the wizard's insert and this
  // call leaves nothing to dial. Rare, but the window is real, and
  // failing loudly here beats a row silently stuck 'pending' forever.
  const orphaned = rows.filter((r) => !r.contact?.phone);
  const sendable = rows.filter((r) => r.contact?.phone);
  for (const row of orphaned) {
    await db
      .from('broadcast_recipients')
      .update({ status: 'failed', error_message: 'Contact no longer exists' })
      .eq('id', row.id);
  }

  if (sendable.length === 0) {
    return {
      broadcastId,
      templateName: broadcast.template_name,
      templateLanguage,
      phoneNumberId: '',
      accessToken: '',
      templateRow: null,
      planned: [],
      rejected: 0,
    };
  }

  const { phoneNumberId, accessToken, templateRow } = await loadSendContext(
    db,
    accountId,
    broadcast.template_name,
    templateLanguage
  );

  // `template_params` was resolved and stored by the wizard at insert
  // time, so every row already carries exactly what to send — no
  // variable resolution happens here, only the message shape.
  const headerType = templateRow?.header_type;
  const isMediaHeader =
    headerType === 'image' || headerType === 'video' || headerType === 'document';
  const headerMediaUrl = broadcast.header_media_url?.trim() || undefined;
  const messageParams: SendTimeParams | undefined =
    isMediaHeader && headerMediaUrl ? { headerMediaUrl } : undefined;

  const planned: PlannedRecipient[] = sendable.map((row) => ({
    recipientRowId: row.id,
    phone: row.contact!.phone as string,
    params: Array.isArray(row.template_params) ? (row.template_params as string[]) : [],
    ...(messageParams ? { messageParams } : {}),
  }));

  return {
    broadcastId,
    templateName: broadcast.template_name,
    templateLanguage,
    phoneNumberId,
    accessToken,
    templateRow,
    planned,
    rejected: 0,
  };
}

/**
 * Fan out a {@link BroadcastPlan}: send each recipient's template
 * (phone-variant retry) and stamp its `broadcast_recipients` row.
 * Best-effort per recipient — one failure never aborts the rest.
 * Designed to run inside `after()`.
 *
 * Paced in groups of SEND_BATCH_SIZE with a SEND_BATCH_DELAY_MS pause
 * between them — the same shape the dashboard's client-driven path uses
 * (`use-broadcast-sending`), so the two agree on burst behaviour and not
 * just on average rate. Bounded by DELIVER_BUDGET_MS so the invocation
 * isn't killed mid-write.
 *
 * The per-status count columns on `broadcasts` are owned by the DB
 * aggregate trigger (migrations 003/005): each recipient-row update
 * below advances them automatically, and later Meta delivery/read
 * webhooks keep advancing them. We therefore never write those columns
 * here — only the terminal `status` — otherwise a manual value would
 * race and clobber the trigger-maintained counts.
 */
export async function deliverBroadcast(
  db: SupabaseClient,
  plan: BroadcastPlan
): Promise<void> {
  let sentCount = 0;
  const startedAt = Date.now();

  log.info('fan-out started', {
    broadcast: plan.broadcastId,
    recipients: plan.planned.length,
    template: plan.templateName,
    retry: Boolean(plan.isRetry),
  });

  // Everything below runs inside try/finally so the terminal status is
  // written even when the loop throws (an unreachable DB, a bug in the
  // send path). Leaving the row on 'sending' is not a cosmetic problem:
  // both the list and detail pages poll *because* a broadcast is
  // 'sending', so a stranded row means those pages poll Supabase every
  // five seconds forever, for every viewer, with nothing left to report.
  try {
  for (const [index, recipient] of plan.planned.entries()) {
    // Deadline guard — stop while there is still time to write the
    // remaining rows, rather than being killed mid-loop and stranding
    // them in 'pending'. Checked before the batch pause below, so an
    // already-blown budget doesn't spend a further SEND_BATCH_DELAY_MS
    // of the write reserve on a sleep it will never send after.
    if (Date.now() - startedAt > DELIVER_BUDGET_MS) {
      const unsent = plan.planned.slice(index);
      console.warn(
        `[broadcast-core] delivery budget elapsed for ${plan.broadcastId}; ${unsent.length} recipient(s) not attempted`
      );
      for (const pending of unsent) {
        await db
          .from('broadcast_recipients')
          .update({
            status: 'failed',
            error_message: 'Send window elapsed — retry again',
            phone_attempted: pending.phone,
            template_params: pending.params,
          })
          .eq('id', pending.recipientRowId);
      }
      break;
    }

    // Batch pacing, mirroring use-broadcast-sending: nothing throttles
    // the sends inside a group, then one flat pause before the next.
    // Expressed as a modulo on the flat index rather than a chunk loop
    // so the per-recipient deadline guard above still runs — the client
    // has no duration budget to guard, the server does.
    if (index > 0 && index % SEND_BATCH_SIZE === 0) {
      await sleep(SEND_BATCH_DELAY_MS);
    }

    const variants = phoneVariants(recipient.phone);
    let sentMessageId: string | null = null;
    let lastError: string | null = null;
    // The number we actually dialled — a trunk-prefix variant may win,
    // and that is what deserves recording, not the stored contact
    // number.
    let attemptedPhone = recipient.phone;

    for (const variant of variants) {
      attemptedPhone = variant;

      try {
        const result = await sendTemplateMessage({
          phoneNumberId: plan.phoneNumberId,
          accessToken: plan.accessToken,
          to: variant,
          templateName: plan.templateName,
          language: plan.templateLanguage,
          template: plan.templateRow ?? undefined,
          messageParams: recipient.messageParams,
          params: recipient.params,
        });
        sentMessageId = result.messageId;
        lastError = null;
        break;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        lastError = message;

        // Throttling gets no special handling in-loop: the row is
        // stamped failed with Meta's message and recovered by the retry
        // endpoint, the same path every other failure takes. Re-sending
        // inside the invocation only spent budget to reach the same row.
        //
        // Only a "recipient not allowed" error is worth another variant.
        if (!isRecipientNotAllowedError(lastError)) break;
      }
    }

    if (sentMessageId) {
      sentCount++;
      await db
        .from('broadcast_recipients')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          whatsapp_message_id: sentMessageId,
          error_message: null,
          phone_attempted: attemptedPhone,
          template_params: recipient.params,
        })
        .eq('id', recipient.recipientRowId);
    } else {
      await db
        .from('broadcast_recipients')
        .update({
          status: 'failed',
          error_message: lastError || 'Unknown error',
          phone_attempted: attemptedPhone,
          template_params: recipient.params,
        })
        .eq('id', recipient.recipientRowId);
    }
  }

  } finally {
    // Terminal status only — counts are trigger-owned (see the note
    // above). If nothing sent, the broadcast failed outright; a partial
    // send is still 'sent' (per-recipient failures show in failed_count).
    //
    // On a retry, this run's tally is the wrong basis: a broadcast that
    // originally sent 90 of 100 and then fails all 10 retries has
    // sentCount === 0 here, and marking it 'failed' would erase the 90
    // successes from the UI. Use the trigger-maintained total instead.
    //
    // Guarded on its own so a failure here can't mask whatever error
    // brought us into the `finally` — that error still propagates to the
    // caller's logs.
    try {
      await finalizeBroadcastStatus(db, plan.broadcastId, sentCount, plan.isRetry);
      log.info('fan-out finished', {
        broadcast: plan.broadcastId,
        sent: sentCount,
        of: plan.planned.length,
        ms: Date.now() - startedAt,
      });
    } catch (error) {
      console.error(
        `[broadcast-core] failed to finalize status for ${plan.broadcastId}:`,
        error
      );
    }
  }
}

/**
 * Move a broadcast off `sending` onto its terminal status.
 *
 * `sentThisRun` is what the current invocation managed to send. On a
 * retry (or when the caller has no tally of its own, e.g. a plan that
 * turned out to have nothing to deliver) the trigger-maintained
 * `sent_count` is consulted instead, so an earlier partial success isn't
 * relabelled as an outright failure.
 */
export async function finalizeBroadcastStatus(
  db: SupabaseClient,
  broadcastId: string,
  sentThisRun: number,
  consultStoredCount = false
): Promise<void> {
  let succeeded = sentThisRun > 0;
  if (consultStoredCount || sentThisRun === 0) {
    const { data: counts } = await db
      .from('broadcasts')
      .select('sent_count')
      .eq('id', broadcastId)
      .maybeSingle();
    succeeded = (counts?.sent_count ?? sentThisRun) > 0;
  }

  await db
    .from('broadcasts')
    .update({
      status: succeeded ? 'sent' : 'failed',
      updated_at: new Date().toISOString(),
    })
    .eq('id', broadcastId);
}
