// ============================================================
// POST /api/broadcasts/{id}/start — start a scheduled broadcast, or a
// draft that has recipients (a cancelled schedule), now ("Start now" on
// the broadcast page).
//
// Same shape as /send: claim and plan here, fan out in `after()`. The
// claim (scheduled or draft → sending) is a compare-and-set, so it can't
// race the cron that starts due broadcasts — the loser gets a 409.
//
// Response (200):
//   { "sending": 42 }
// ============================================================

import { NextResponse, after } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import {
  planBroadcastStart,
  deliverBroadcast,
  finalizeBroadcastStatus,
  BroadcastError,
} from '@/lib/whatsapp/broadcast-core';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';

// MUST equal ROUTE_MAX_DURATION_SECONDS in lib/whatsapp/broadcast-limits
// (literal required — see the note there). Enforced by
// broadcast-limits.test.ts.
export const maxDuration = 1800;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Starting a send needs the same 'agent' role as /send.
    const { supabase, accountId, userId } = await requireRole('agent');

    // Same bucket as /send: this is "starting a campaign" too.
    const limit = checkRateLimit(`broadcast:${userId}`, RATE_LIMITS.broadcast);
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;

    // Claim and plan with the request-scoped client (RLS enforces account
    // ownership), fan out on the service-role client — same split as /send.
    const plan = await planBroadcastStart(supabase, accountId, id, [
      'scheduled',
      'draft',
    ]);
    if (plan.planned.length > 0) {
      after(() => deliverBroadcast(supabaseAdmin(), plan));
    } else {
      // Every recipient was orphaned — close it, or it polls 'sending' forever.
      await finalizeBroadcastStatus(supabaseAdmin(), id, 0);
    }

    return NextResponse.json({ sending: plan.planned.length });
  } catch (error) {
    if (error instanceof BroadcastError) {
      return NextResponse.json(
        { error: error.message, code: error.code, ...error.details },
        { status: error.status }
      );
    }
    console.error('Error in broadcast start POST:', error);
    return toErrorResponse(error);
  }
}
