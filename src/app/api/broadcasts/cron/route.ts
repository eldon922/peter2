// ============================================================
// GET /api/broadcasts/cron — start broadcasts whose scheduled time
// has come.
//
// Meant to be hit every minute or so by a scheduler (Vercel Cron /
// external pinger). Auth is the same shared secret as the automation
// and flows crons: the `x-cron-secret` header must match
// `AUTOMATION_CRON_SECRET`.
//
// Each due broadcast is claimed (scheduled → sending) before it is
// sent, so overlapping invocations or a "Start now" click can't start
// the same one twice.
//
// Response (200):
//   { "started": 2 }
// ============================================================

import { timingSafeEqual } from 'node:crypto';
import { NextResponse, after } from 'next/server';

import { supabaseAdmin } from '@/lib/flows/admin-client';
import {
  planScheduledBroadcast,
  deliverBroadcast,
  finalizeBroadcastStatus,
  BroadcastError,
} from '@/lib/whatsapp/broadcast-core';

// Fan-outs run in `after()`, so this has the same ceiling as /send.
//
// MUST equal ROUTE_MAX_DURATION_SECONDS in lib/whatsapp/broadcast-limits
// (literal required — see the note there). Enforced by
// broadcast-limits.test.ts.
export const maxDuration = 1800;

// More than this at once just wait for the next tick.
const MAX_PER_RUN = 10;

export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  }
  // Constant-time compare, same as the other cron routes.
  const supplied = request.headers.get('x-cron-secret') ?? '';
  const suppliedBuf = Buffer.from(supplied);
  const expectedBuf = Buffer.from(expected);
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = supabaseAdmin();
  const { data: due, error } = await admin
    .from('broadcasts')
    .select('id, account_id')
    .eq('status', 'scheduled')
    .lte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(MAX_PER_RUN);
  if (error) {
    console.error('[broadcasts-cron] due scan failed:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let started = 0;
  for (const row of due ?? []) {
    try {
      const plan = await planScheduledBroadcast(
        admin,
        row.account_id as string,
        row.id as string
      );
      if (plan.planned.length > 0) {
        after(() => deliverBroadcast(admin, plan));
      } else {
        await finalizeBroadcastStatus(admin, row.id as string, 0);
      }
      started++;
    } catch (err) {
      // A 409 means a "Start now" click or another run got there first.
      // Anything else was already closed out as failed by the planner.
      if (!(err instanceof BroadcastError && err.code === 'conflict')) {
        console.error(`[broadcasts-cron] could not start ${row.id}:`, err);
      }
    }
  }

  return NextResponse.json({ started });
}
