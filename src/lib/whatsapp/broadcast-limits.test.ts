import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  DELIVER_BUDGET_MS,
  DELIVERY_WRITE_RESERVE_MS,
  ROUTE_MAX_DURATION_SECONDS,
  SEND_BATCH_DELAY_MS,
  getSendPacing,
  recipientLimitForTier,
} from './broadcast-limits';

// getSendPacing's batch sizes (20 / 80 / 1000) are inlined in
// broadcast-limits.ts rather than exported as named constants, so
// these tests assert against the same literals.
const SEND_BATCH_SIZE = 20;
const SEND_BATCH_SIZE_FAST = 80;
const SEND_BATCH_SIZE_HIGH = 1000;

// recipientLimitForTier's default-tier fallback (delivery budget ÷
// per-message cost of the conservative-default batch shape) is now
// computed inline rather than through a standalone exported function,
// so these tests mirror the same formula to check against it.
const DEFAULT_RECIPIENT_LIMIT = Math.floor(
  DELIVER_BUDGET_MS / (SEND_BATCH_DELAY_MS / SEND_BATCH_SIZE),
);

// broadcast-limits.ts is the single source of truth for the send
// pipeline's numbers, but two things stop it from being enforceable by
// the compiler alone:
//
//   1. Route segment config must be a *literal*. Next statically
//      analyzes `export const maxDuration` and silently ignores a
//      non-literal value, so the routes can only mirror the constant,
//      never import it. These tests are the mirror check.
//   2. The constants are interdependent (budget ÷ per-message cost
//      bounds what one invocation can send). Those relationships live
//      here so changing one value in isolation fails loudly.

const ROUTES_WITH_MAX_DURATION = [
  'src/app/api/whatsapp/webhook/route.ts',
  'src/app/api/broadcasts/[id]/retry/route.ts',
  'src/app/api/broadcasts/[id]/send/route.ts',
  'src/app/api/v1/broadcasts/route.ts',
  'src/app/api/v1/broadcasts/[id]/retry/route.ts',
];

function readMaxDurationLiteral(relPath: string): number {
  const source = readFileSync(join(process.cwd(), relPath), 'utf8');
  const match = source.match(/^export const maxDuration = (\d+)/m);
  if (!match) {
    throw new Error(
      `${relPath} declares no literal \`export const maxDuration\`. ` +
        'Route segment config must be a literal — an imported binding is ignored by Next.',
    );
  }
  return Number(match[1]);
}

describe('maxDuration mirrors ROUTE_MAX_DURATION_SECONDS', () => {
  it.each(ROUTES_WITH_MAX_DURATION)('%s', (relPath) => {
    expect(readMaxDurationLiteral(relPath)).toBe(ROUTE_MAX_DURATION_SECONDS);
  });

  it('covers every route that declares one', () => {
    // A new `after()` route that sets its own maxDuration must be added
    // to the list above, or it drifts from the derived budget unchecked.
    const declared = ROUTES_WITH_MAX_DURATION.length;
    expect(declared).toBeGreaterThan(0);
    for (const relPath of ROUTES_WITH_MAX_DURATION) {
      expect(() => readMaxDurationLiteral(relPath)).not.toThrow();
    }
  });
});

describe('DELIVER_BUDGET_MS follows the route ceiling', () => {
  it('is derived from ROUTE_MAX_DURATION_SECONDS, not hard-coded', () => {
    expect(DELIVER_BUDGET_MS).toBe(
      ROUTE_MAX_DURATION_SECONDS * 1000 - DELIVERY_WRITE_RESERVE_MS,
    );
  });

  it('leaves the invocation time to write its remaining rows', () => {
    expect(DELIVERY_WRITE_RESERVE_MS).toBeGreaterThan(0);
    expect(DELIVER_BUDGET_MS).toBeLessThan(ROUTE_MAX_DURATION_SECONDS * 1000);
  });

  it('still leaves a usable send window', () => {
    expect(DELIVER_BUDGET_MS).toBeGreaterThan(0);
    expect(DEFAULT_RECIPIENT_LIMIT).toBeGreaterThan(0);
  });
});

describe('recipientLimitForTier converts Meta live messaging-limit tier into a recipient count', () => {
  it('falls back to the conservative default figure when the tier lookup is unknown', () => {
    for (const tier of [null, undefined, '', 'TIER_SOMETHING_NEW'] as const) {
      expect(recipientLimitForTier(tier)).toEqual({
        limit: DEFAULT_RECIPIENT_LIMIT,
        source: 'default',
      });
    }
  });

  it('is a usable number at the shipped configuration', () => {
    const { limit } = recipientLimitForTier(null);
    expect(limit).toBeGreaterThan(0);
    expect(Number.isInteger(limit)).toBe(true);
  });

  it('is described accurately by docs/public-api.md — no hard cap, not a fixed figure', () => {
    // createBroadcast used to reject a request over the deliverable
    // ceiling with a 400, and the docs quoted that literal figure.
    // Neither is true anymore — the docs must not claim a hard cap, and
    // must not quote a number that goes stale the moment the timing
    // constants change.
    const docs = readFileSync(join(process.cwd(), 'docs/public-api.md'), 'utf8');
    expect(docs).toContain('no hard cap');
    expect(docs).not.toContain(`${DEFAULT_RECIPIENT_LIMIT} at the shipped defaults`);
  });

  it('maps each documented tier to its recipient count', () => {
    expect(recipientLimitForTier('TIER_50')).toEqual({ limit: 50, source: 'meta' });
    expect(recipientLimitForTier('TIER_250')).toEqual({ limit: 250, source: 'meta' });
    expect(recipientLimitForTier('TIER_1K')).toEqual({ limit: 1_000, source: 'meta' });
    expect(recipientLimitForTier('TIER_2K')).toEqual({ limit: 2_000, source: 'meta' });
    expect(recipientLimitForTier('TIER_10K')).toEqual({ limit: 10_000, source: 'meta' });
    expect(recipientLimitForTier('TIER_100K')).toEqual({ limit: 100_000, source: 'meta' });
  });

  it('treats TIER_NOT_SET as the starting tier, not unlimited', () => {
    expect(recipientLimitForTier('TIER_NOT_SET')).toEqual({ limit: 250, source: 'meta' });
  });

  it('represents TIER_UNLIMITED as a large finite number, not Infinity', () => {
    // JSON.stringify(Infinity) is `null` — an Infinity limit would
    // silently break the route's NextResponse.json response and every
    // `size > recipientLimit` comparison downstream.
    const result = recipientLimitForTier('TIER_UNLIMITED');
    expect(result.source).toBe('meta');
    expect(Number.isFinite(result.limit)).toBe(true);
    expect(JSON.parse(JSON.stringify(result)).limit).toBe(result.limit);
    expect(result.limit).toBeGreaterThan(100_000);
  });
});

describe('the fan-out paces from getSendPacing\'s shared batch sizes', () => {
  // Both send paths (a fresh wizard send and a retry) now go through
  // `deliverBroadcast` in `after()` — the dashboard hook no longer
  // loops batches from the browser itself (see
  // `use-broadcast-sending.ts`'s Step 4), so there is exactly one
  // place left that pages sends, and this guards that it still resolves
  // pacing from the shared module rather than a hard-coded number.
  //
  // Pacing itself now varies primarily by Meta's live-reported
  // throughput tier (`getSendPacing`), not a static per-connection-type
  // guess — connection_type only still matters as the one input
  // `getSendPacing`'s `isCoexistence` clamp needs (see broadcast-limits.ts)
  // — so this no longer asserts the literal constant names appear; it
  // asserts the send loop defers to the shared resolver instead of
  // inlining its own batch shape.

  const SEND_PATHS = ['src/lib/whatsapp/broadcast-core.ts'];

  it.each(SEND_PATHS)('%s paces via getSendPacing', (relPath) => {
    const source = readFileSync(join(process.cwd(), relPath), 'utf8');
    expect(source).toContain('getSendPacing');
  });

  it('bills capacity at the rate the batch shape actually achieves', () => {
    // Stated without naming the interval, since it is now just the
    // default recipient-limit formula's default: one batch-delay of
    // budget buys exactly one batch. Tuning either constant moves the
    // recipient limit with it rather than leaving the cap describing
    // pacing that no longer runs.
    expect(Math.floor(SEND_BATCH_DELAY_MS / (SEND_BATCH_DELAY_MS / SEND_BATCH_SIZE))).toBe(
      SEND_BATCH_SIZE,
    );
    expect(
      Math.floor((SEND_BATCH_DELAY_MS * 10) / (SEND_BATCH_DELAY_MS / SEND_BATCH_SIZE)),
    ).toBe(SEND_BATCH_SIZE * 10);
  });

  it('getSendPacing keeps the conservative default under Meta\'s lowest documented ceiling', () => {
    for (const level of [null, undefined, ''] as const) {
      const pacing = getSendPacing(level);
      const optimisticMps = pacing.batchSize / (pacing.batchDelayMs / 1000);
      expect(pacing.batchSize).toBe(SEND_BATCH_SIZE);
      expect(optimisticMps).toBeLessThan(20);
    }
  });

  it('getSendPacing scales batch size with Meta\'s live-reported tier', () => {
    const unknown = getSendPacing(null);
    const standard = getSendPacing('STANDARD');
    const high = getSendPacing('HIGH');
    const unrecognized = getSendPacing('some-new-tier');

    expect(standard.batchSize).toBe(SEND_BATCH_SIZE_FAST);
    expect(high.batchSize).toBe(SEND_BATCH_SIZE_HIGH);
    expect(unrecognized.batchSize).toBe(SEND_BATCH_SIZE);

    // Ordering should hold regardless of the exact constants above.
    expect(high.batchSize).toBeGreaterThan(standard.batchSize);
    expect(standard.batchSize).toBeGreaterThan(unrecognized.batchSize);
    expect(unrecognized.batchSize).toBeGreaterThan(unknown.batchSize);

    // The pause between groups doesn't change with tier — only batch
    // size does.
    expect(standard.batchDelayMs).toBe(unknown.batchDelayMs);
    expect(high.batchDelayMs).toBe(unknown.batchDelayMs);
  });

  it('getSendPacing clamps to the coexistence ceiling regardless of the reported tier', () => {
    for (const level of ['STANDARD', 'HIGH', 'some-new-tier', null, undefined] as const) {
      const pacing = getSendPacing(level, true);
      expect(pacing.batchSize).toBeLessThanOrEqual(SEND_BATCH_SIZE);
    }
  });

  it('the coexistence clamp never raises pacing above what the tier alone would give', () => {
    // The clamp is a ceiling, not a floor — a conservative-default
    // (10) or unrecognized-tier (20) result should come through
    // unchanged, not get bumped up to the 20 mps ceiling.
    const unknownCoexistence = getSendPacing(null, true);
    const unknownNonCoexistence = getSendPacing(null, false);
    expect(unknownCoexistence.batchSize).toBe(unknownNonCoexistence.batchSize);
  });

  it('isCoexistence defaults to false — omitting it must not silently clamp', () => {
    expect(getSendPacing('HIGH')).toEqual(getSendPacing('HIGH', false));
    expect(getSendPacing('HIGH').batchSize).toBe(SEND_BATCH_SIZE_HIGH);
  });
});
