// ============================================================
// Single source of truth for the broadcast send pipeline's limits.
//
// These numbers are interdependent — the duration budget, the send
// pacing and the per-call recipient caps only make sense relative to
// one another — so they live together and derive from one another
// where possible. Previously they were spread across broadcast-core,
// four route files and the dashboard hook, which let them drift.
//
// Read the derivation below before changing any single value: loosening
// the pacing without raising the budget (or vice versa) reintroduces
// the "Send window elapsed" failure this module exists to make
// reasonable about.
// ============================================================

import type { WhatsAppConnectionType } from '@/types';

/**
 * The execution ceiling every fan-out route declares.
 *
 * ⚠️ Next statically analyzes route segment config: `export const
 * maxDuration` MUST be a literal in each route file. An imported
 * binding is silently *ignored* and the route falls back to the
 * platform default — so the routes cannot import this value, they can
 * only mirror it. `broadcast-limits.test.ts` asserts every route's
 * literal matches this constant, which is what actually keeps them in
 * sync.
 *
 * This is a *declaration*, not an enforcement mechanism. Next writes it
 * into build-output metadata and the deployment platform decides what
 * to do with it (Vercel clamps it to the plan ceiling; a self-hosted
 * `next start` ignores it entirely, since no platform layer reads the
 * build output). See DELIVER_BUDGET_MS.
 *
 * MUST be mirrored in each route file as a literal, not an import:
 * export const maxDuration = [ROUTE_MAX_DURATION_SECONDS]; // in each route file
 */
export const ROUTE_MAX_DURATION_SECONDS = 600;

/**
 * Tail of the duration budget reserved for DB writes rather than sends.
 *
 * When the deadline hits, `deliverBroadcast` still has to stamp every
 * unreached recipient row as failed. That work needs to finish inside
 * the same invocation, so it gets carved out of the budget up front.
 */
export const DELIVERY_WRITE_RESERVE_MS = 10_000;

/**
 * Deadline for the send loop — derived from the route ceiling rather
 * than hard-coded, so raising `ROUTE_MAX_DURATION_SECONDS` actually
 * grants the fan-out more time instead of silently doing nothing.
 *
 * Rows not reached before this are marked `failed` with an explicit
 * message rather than being stranded in `pending` — `pending` is a dead
 * end in this schema (invisible in the funnel, unreachable by retry),
 * `failed` is recoverable. That recovery property, not the timeout, is
 * the reason this guard exists: a process restart mid-fan-out strands
 * rows the same way a platform timeout does.
 */
export const DELIVER_BUDGET_MS =
  ROUTE_MAX_DURATION_SECONDS * 1000 - DELIVERY_WRITE_RESERVE_MS;

// ============================================================
// Send pacing — governs `deliverBroadcast`'s fan-out.
//
// `deliverBroadcast` (running in `after()`, for both a fresh wizard
// send via /api/broadcasts/{id}/send and a retry via
// /api/broadcasts/{id}/retry) sends a group of SEND_BATCH_SIZE, then
// pauses SEND_BATCH_DELAY_MS before the next group. This is the only
// place sends are paced — earlier the dashboard hook
// (`use-broadcast-sending`) had its own client-driven loop pacing
// itself from the browser against a since-removed route
// (/api/whatsapp/broadcast); that loop is gone, so this module is now
// the single source of truth rather than one of two.
// ============================================================

/**
 * Recipients sent per group before pausing.
 *
 * ⚠️ Kept at the coexistence-safe figure, not the 80 that was briefly
 * shipped here: a flat 80 is right at (and, with any real latency,
 * effectively over) Meta's 20 mps ceiling for a number also registered
 * on the WhatsApp Business app, so every account paid the coexistence
 * risk to get the Cloud-API-only accounts' speed. See getSendPacing —
 * SEND_BATCH_SIZE_FAST below carries that 80 for the accounts it's
 * actually safe for.
 */
export const SEND_BATCH_SIZE = 10;

/**
 * Pause between groups. 10 per batch + 1 s keeps the average under
 * Meta's per-phone-number messaging rate so a large broadcast never
 * trips the upstream limiter.
 *
 * ⚠️ This is an *additive* sleep, not a compensating interval: it is
 * paid on top of however long the batch's sends actually took, and
 * nothing paces the sends *within* a batch. So the ~10 msg/s below is
 * a zero-latency figure and a bound on the average only — the
 * instantaneous rate inside a group is whatever Meta's latency allows.
 */
export const SEND_BATCH_DELAY_MS = 1000;

/**
 * Faster pacing for a number that isn't subject to Meta's coexistence
 * throughput cap. Meta's documented ceilings
 * (https://developers.facebook.com/documentation/business-messaging/whatsapp/throughput):
 *
 *   - a coexistence number (also live in the WhatsApp Business app) is
 *     capped at 20 messages/sec by Meta, regardless of app-side pacing
 *   - a Cloud-API-only number defaults to 80 messages/sec
 *
 * SEND_BATCH_SIZE/SEND_BATCH_DELAY_MS above already sit comfortably
 * under the 20 mps coexistence ceiling, so they stay the default for
 * any account we can't positively confirm is coexistence-free. This
 * profile targets Meta's 80 mps Cloud-API default directly for
 * everyone else — batch size == mps ceiling, so unlike the
 * coexistence profile it has no headroom of its own; the margin comes
 * entirely from real latency making the additive batch pause dominate
 * (see the note above), the same way it already does for the default
 * profile.
 */
export const SEND_BATCH_SIZE_FAST = 80;
export const SEND_BATCH_DELAY_MS_FAST = 1000;

export interface SendPacing {
  batchSize: number;
  batchDelayMs: number;
}

/**
 * Resolve send pacing for a `whatsapp_config.connection_type`.
 *
 * `'coexistence'` — and anything unrecognized, including `null`/
 * `undefined` for a plan built before this was threaded through —
 * gets the conservative default: it's the safe assumption when we
 * can't positively confirm the number isn't throughput-capped at 20
 * mps. `'manual'` and `'embedded_signup'` are Cloud-API-only numbers
 * and get the faster profile.
 */
export function getSendPacing(
  connectionType: WhatsAppConnectionType | null | undefined
): SendPacing {
  if (connectionType === 'manual' || connectionType === 'embedded_signup') {
    return { batchSize: SEND_BATCH_SIZE_FAST, batchDelayMs: SEND_BATCH_DELAY_MS_FAST };
  }
  return { batchSize: SEND_BATCH_SIZE, batchDelayMs: SEND_BATCH_DELAY_MS };
}

/**
 * Upper bound on how many recipients one invocation can send: the
 * delivery budget divided by the per-message cost of the batch shape.
 *
 * `intervalMs` defaults to `SEND_BATCH_DELAY_MS / SEND_BATCH_SIZE`
 * (≈10 msg/s) rather than being its own constant, so the cap is derived
 * from the pacing that actually runs and can't describe pacing that
 * doesn't. That rate is well under everything Meta documents — Cloud
 * API allows 80 mps by default and up to 1,000 mps by automatic
 * upgrade, and 20 mps for a number registered on both the WhatsApp
 * Business app and Cloud API.
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/throughput
 *
 * ⚠️ Optimistic by construction. The batch pause is additive, so a
 * group really costs `SEND_BATCH_SIZE × latency + SEND_BATCH_DELAY_MS`
 * — this figure is only reached when Meta answers instantly. At 300 ms
 * round trips the real figure is roughly a quarter of it.
 */
export function maxDeliverableRecipients(
  budgetMs: number = DELIVER_BUDGET_MS,
  intervalMs: number = SEND_BATCH_DELAY_MS / SEND_BATCH_SIZE,
): number {
  return Math.floor(budgetMs / intervalMs);
}

/**
 * A rough "how many will fit in one pass" figure, not an enforced cap.
 * Neither `createBroadcast` nor `planBroadcastRetry`/`planBroadcastSend`
 * reject a larger audience — they now claim it in full and let it drain
 * over however many automatic retry passes it takes (see the comment in
 * `createBroadcast`). This is exported for callers that want to *warn*
 * about that up front rather than enforce it: the dashboard wizard
 * (`use-broadcast-sending.ts`) uses it to tell someone sending to a huge
 * audience that it'll take a while, before they commit to it.
 *
 * Derived, not declared: tuning ROUTE_MAX_DURATION_SECONDS or the batch
 * constants moves this automatically.
 *
 * ⚠️ Optimistic by construction — see maxDeliverableRecipients above.
 * A full-"cap" audience will not drain in one pass under real latency;
 * it just means more retry passes, not lost recipients.
 */
export const MAX_RECIPIENTS = maxDeliverableRecipients();

/**
 * `MAX_RECIPIENTS`, resolved for a specific connection type's pacing
 * instead of the shipped conservative default — so a Cloud-API-only
 * account's "this will take a while" warning uses its real, faster
 * capacity instead of being held to the coexistence-derived figure it
 * doesn't actually need. Used by `use-broadcast-sending.ts`'s
 * audience-size check; `getSendPacing` is what actually governs send
 * speed.
 */
export function maxRecipientsFor(
  connectionType: WhatsAppConnectionType | null | undefined,
): number {
  const pacing = getSendPacing(connectionType);
  return maxDeliverableRecipients(DELIVER_BUDGET_MS, pacing.batchDelayMs / pacing.batchSize);
}
