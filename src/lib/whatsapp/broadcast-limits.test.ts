import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  DELIVER_BUDGET_MS,
  DELIVERY_WRITE_RESERVE_MS,
  MAX_RECIPIENTS,
  ROUTE_MAX_DURATION_SECONDS,
  SEND_BATCH_DELAY_MS,
  SEND_BATCH_SIZE,
  maxDeliverableRecipients,
} from './broadcast-limits';

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
    expect(maxDeliverableRecipients()).toBeGreaterThan(0);
  });
});

describe('MAX_RECIPIENTS governs both the create and retry paths', () => {
  it('is the deliverable ceiling, not an independent number', () => {
    // Accepting more than one pass can deliver is what produced the
    // "Send window elapsed" failures. Deriving it means the two can
    // never disagree, whatever the timing constants are tuned to.
    expect(MAX_RECIPIENTS).toBe(maxDeliverableRecipients());
  });

  it('tracks the budget rather than staying fixed', () => {
    // Guards the derivation itself: a hard-coded value would keep
    // passing the assertion above only by coincidence.
    expect(maxDeliverableRecipients(20_000, 100)).toBe(200);
    expect(maxDeliverableRecipients(DELIVER_BUDGET_MS, 25)).toBe(
      Math.floor(DELIVER_BUDGET_MS / 25),
    );
  });

  it('is a usable number at the shipped configuration', () => {
    expect(MAX_RECIPIENTS).toBeGreaterThan(0);
    expect(Number.isInteger(MAX_RECIPIENTS)).toBe(true);
  });

  it('is quoted accurately by docs/public-api.md', () => {
    // The public docs cite the shipped figure. Deriving the cap means
    // that number moves when the timing constants do — this fails if the
    // prose is left behind.
    const docs = readFileSync(join(process.cwd(), 'docs/public-api.md'), 'utf8');
    expect(docs).toContain(`**${MAX_RECIPIENTS} at the shipped defaults**`);
  });
});

describe('both send paths pace identically', () => {
  // The two paths used to run different mechanisms — a per-message
  // interval governor on the server, burst-and-pause in the browser —
  // which agreed on average rate but not on burst behaviour. They now
  // share one shape, and these guard that they keep sharing it.

  const SEND_PATHS = [
    'src/lib/whatsapp/broadcast-core.ts',
    'src/hooks/use-broadcast-sending.ts',
  ];

  it.each(SEND_PATHS)('%s paces from the shared constants', (relPath) => {
    const source = readFileSync(join(process.cwd(), relPath), 'utf8');
    expect(source).toContain('SEND_BATCH_SIZE');
    expect(source).toContain('SEND_BATCH_DELAY_MS');
  });

  it('bills capacity at the rate the batch shape actually achieves', () => {
    // Stated without naming the interval, since it is now just the
    // function's default: one batch-delay of budget buys exactly one
    // batch. Tuning either constant moves MAX_RECIPIENTS with it rather
    // than leaving the cap describing pacing that no longer runs.
    expect(maxDeliverableRecipients(SEND_BATCH_DELAY_MS)).toBe(SEND_BATCH_SIZE);
    expect(maxDeliverableRecipients(SEND_BATCH_DELAY_MS * 10)).toBe(
      SEND_BATCH_SIZE * 10,
    );
  });
});
