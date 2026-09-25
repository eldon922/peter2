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
export const ROUTE_MAX_DURATION_SECONDS = 1800;

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
// /api/broadcasts/{id}/retry) sends a group of `batchSize`, then
// pauses `batchDelayMs` before the next group. This is the only place
// sends are paced — earlier the dashboard hook (`use-broadcast-sending`)
// had its own client-driven loop pacing itself from the browser
// against a since-removed route (/api/whatsapp/broadcast); that loop
// is gone, so this module is now the single source of truth rather
// than one of two.
//
// Pacing is driven primarily by Meta's own live-reported throughput
// tier for the number (`getPhoneNumberThroughput` in meta-api.ts) —
// not a static guess keyed off `whatsapp_config.connection_type`.
// Meta's tier is the account's real, current speed; a stored field
// can only ever be a guess at it. The one exception is the fixed
// coexistence ceiling, which `connection_type` still has to supply —
// see the batch-size comment on `getSendPacing` below for why.
// ============================================================

/**
 * Meta's own reported throughput tier for a number
 * (`getPhoneNumberThroughput` in meta-api.ts), live.
 */
export type MetaThroughputLevel = 'STANDARD' | 'HIGH' | string;

/**
 * Pause between groups. Flat regardless of tier — the batch *size*
 * below is what changes with mps, not the pause between batches.
 *
 * ⚠️ This is an *additive* sleep, not a compensating interval: it is
 * paid on top of however long the batch's sends actually took, and
 * nothing paces the sends *within* a batch. So the mps figures below
 * are zero-latency, average-only bounds — the instantaneous rate
 * inside a group is whatever Meta's latency allows.
 */
export const SEND_BATCH_DELAY_MS = 1000;

export interface SendPacing {
  batchSize: number;
  batchDelayMs: number;
}

/**
 * Resolve send pacing from Meta's live-reported throughput tier.
 *
 * Batch sizes, inlined rather than named constants:
 * - 20: no live throughput figure to go on (lookup failed, or not yet
 *   checked), or an unrecognized tier string. The safest assumption
 *   available: comfortably under every tier Meta documents, including
 *   a coexistence number's 20 mps ceiling (see `isCoexistence` below).
 *   Also Meta's own fixed ceiling for a coexistence number (also live
 *   in the WhatsApp Business app) — a restriction Meta applies on top
 *   of the throughput tier and does not report *in* it (see the
 *   warning on `MetaThroughputLevel` in broadcast-limits.ts). This is the one
 *   number this function cannot get from a live Meta call and has to
 *   be told, via `isCoexistence`.
 * - 80: Meta's `'STANDARD'` tier — the Cloud API default.
 * - 1000: Meta's `'HIGH'` tier — an automatic, quality-gated upgrade.
 *
 * `isCoexistence` clamps the result to 20 regardless of what the
 * throughput tier implies — this is the one fact `throughputLevel`
 * cannot supply (see above), so it has to come from the caller. Pass
 * `whatsapp_config.connection_type === 'coexistence'` for that
 * account. Leaving this `false`/omitted for a number that actually is
 * coexistence-registered reopens the gap described there: Meta could
 * report `'STANDARD'` and this would pace at 80 mps, above what Meta
 * actually allows.
 */
export function getSendPacing(
  throughputLevel: MetaThroughputLevel | null | undefined,
  isCoexistence = false,
): SendPacing {
  const batchSize = !throughputLevel
    ? 20
    : throughputLevel === 'HIGH'
      ? 1000
      : throughputLevel === 'STANDARD'
        ? 80
        : 20;
  return {
    batchSize: isCoexistence ? Math.min(batchSize, 20) : batchSize,
    batchDelayMs: SEND_BATCH_DELAY_MS,
  };
}

/**
 * Upper bound on how many recipients one invocation can send: the
 * delivery budget divided by the per-message cost of the batch shape.
 *
 * `intervalMs` defaults to `SEND_BATCH_DELAY_MS / 20` (≈10 msg/s,
 * 20 being `getSendPacing`'s conservative-default batch size) rather
 * than being its own constant, so the cap is derived from the
 * conservative pacing profile and can't describe pacing that doesn't
 * run by default.
 *
 * ⚠️ Optimistic by construction. The batch pause is additive, so a
 * group really costs `batchSize × latency + batchDelayMs` — this
 * figure is only reached when Meta answers instantly. At 300 ms round
 * trips the real figure is roughly a quarter of it.
 */
export function maxDeliverableRecipients(
  budgetMs: number = DELIVER_BUDGET_MS,
  intervalMs: number = SEND_BATCH_DELAY_MS / 20,
): number {
  return Math.floor(budgetMs / intervalMs);
}

// ============================================================
// Recipient limit — surfaced to the dashboard wizard
// (use-broadcast-sending.ts, step2-select-audience.tsx) via
// /api/broadcasts/recipient-limit as an audience-size warning.
//
// This is Meta's own messaging-limit tier for the account — the
// actual maximum number of unique WhatsApp users a business can
// message outside a customer-service window in a rolling 24-hour
// period
// (https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits)
// — not a figure derived from the route's execution-time budget.
// That's a real Meta-enforced ceiling, not just an estimate of how
// fast we happen to be able to push messages out.
// ============================================================

const RECIPIENTS_BY_TIER = {
  TIER_50: 50,
  TIER_250: 250,
  TIER_1K: 1_000,      // alias some API versions/webhooks use for TIER_2K
  TIER_2K: 2_000,
  TIER_10K: 10_000,
  TIER_100K: 100_000,
  TIER_UNLIMITED: Number.MAX_SAFE_INTEGER, // Infinity → null over JSON, breaks `size > limit`
  TIER_NOT_SET: 250,   // unverified/never-sent number — treat as starting tier
} as const;

export type MessagingLimitTier = keyof typeof RECIPIENTS_BY_TIER | string | null | undefined;

export interface RecipientLimit {
  limit: number;
  source: 'meta' | 'default';
}

/**
 * Convert Meta's live messaging-limit tier into a recipient count.
 *
 * `tier` unknown (lookup failed, not yet checked, or a value Meta
 * documents nothing for) falls back to `maxDeliverableRecipients()` —
 * the flat conservative default derived from the shipped batch
 * pacing, since there's no live data to convert.
 *
 * Note this is the account's rolling-24-hour ceiling across *every*
 * send, not a per-broadcast one — a broadcast smaller than this limit
 * can still fail partway through if other sends already used up the
 * day's budget. It's still the right advisory figure for the wizard:
 * a real Meta-enforced number beats a guess at execution speed.
 */
export function recipientLimitForTier(
  tier: MessagingLimitTier,
): RecipientLimit {
  if (tier && tier in RECIPIENTS_BY_TIER) {
    return { limit: RECIPIENTS_BY_TIER[tier as keyof typeof RECIPIENTS_BY_TIER], source: 'meta' };
  }
  return { limit: maxDeliverableRecipients(), source: 'default' };
}
