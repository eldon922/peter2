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
// A broadcast later than BROADCAST_MAX_LATE_HOURS (default 1) is not sent:
// it goes back to draft with its recipients, so a scheduler that was down
// can't send old broadcasts at a surprising time.
//
// Response (200):
//   { "started": 2, "skipped": 0 }
// ============================================================

import { timingSafeEqual } from 'node:crypto';
import { NextResponse, after } from 'next/server';

import { supabaseAdmin } from '@/lib/flows/admin-client';
import { maxLateMs } from '@/lib/broadcasts/max-late';
import {
  planBroadcastStart,
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
  const cutoff = new Date(Date.now() - maxLateMs()).toISOString();

  const { data: late, error: lateError } = await admin
    .from('broadcasts')
    // scheduled_at stays, so the broadcast page can say when it was due.
    .update({ status: 'draft' })
    .eq('status', 'scheduled')
    .lt('scheduled_at', cutoff)
    .select('id');
  if (lateError) {
    // The due scan below skips late ones anyway, so nothing sends by mistake.
    console.error('[broadcasts-cron] late scan failed:', lateError.message);
  } else if (late?.length) {
    console.warn(
      `[broadcasts-cron] too late to send, back to draft: ${late.map((r) => r.id).join(', ')}`
    );
  }

  const { data: due, error } = await admin
    .from('broadcasts')
    .select('id, account_id')
    .eq('status', 'scheduled')
    .gte('scheduled_at', cutoff)
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
      const plan = await planBroadcastStart(
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

  return NextResponse.json({ started, skipped: late?.length ?? 0 });
}
