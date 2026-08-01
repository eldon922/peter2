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
 */
export const ROUTE_MAX_DURATION_SECONDS = 300;

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
// Send pacing — shared by BOTH send paths.
//
// The server fan-out (`deliverBroadcast`, running in `after()`) and the
// dashboard's client-driven path (`use-broadcast-sending`, pacing from
// the browser) use the same mechanism: send a group of SEND_BATCH_SIZE,
// then pause SEND_BATCH_DELAY_MS before the next group. Previously the
// server ran a per-message interval governor instead, so the two paths
// had different burst behaviour under the same nominal rate.
// ============================================================

/**
 * Recipients sent per group before pausing.
 *
 * On the client this is also the POST body size for
 * /api/whatsapp/broadcast, which gives it a second job the server side
 * doesn't have: it is the failure blast radius. `use-broadcast-sending`
 * marks the *whole* batch failed when one POST throws, so raising this
 * to go faster also widens what a single network blip writes off.
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
 * Recipients handled in one request — both the create path (validated
 * against the submitted array before anything is persisted or sent) and
 * the retry path (failed rows claimed per call). One number governs
 * both: a retry is just a second send of the same audience, and giving
 * the two paths different ceilings meant a broadcast you were allowed
 * to *start* could not be *finished* at the same granularity.
 *
 * Derived, not declared: the cap *is* what one invocation can drain, so
 * tuning ROUTE_MAX_DURATION_SECONDS or the batch constants moves it
 * automatically and the two can never disagree.
 *
 * Two things follow from taking the ceiling directly, both deliberate:
 *
 *   - There is no latency headroom. A full-cap request only completes in
 *     one pass if Meta answers instantly; under real latency the tail is
 *     marked failed and `remaining` reports it honestly, so it degrades
 *     into extra retry passes rather than lost recipients.
 *   - It is a moving number, so `docs/public-api.md` describes how it is
 *     derived instead of quoting a fixed figure that would go stale.
 *
 * ⚠️ This models the *send* phase only. `createBroadcast` also resolves
 * contacts one round trip at a time, inline in the request rather than
 * in `after()`, so a larger cap costs request latency this arithmetic
 * does not account for.
 */
export const MAX_RECIPIENTS = maxDeliverableRecipients();
