// ============================================================
// POST /api/broadcasts/{id}/retry — re-send the failed recipients of
// an existing broadcast (dashboard surface).
//
// Body (optional):
//   { "recipient_id": "<uuid>" }   // retry a single row instead of all
//
// Failed rows are claimed (failed → pending) synchronously so the
// response can report exactly how many were taken, then the Meta
// fan-out runs in `after()`. Poll the broadcast row for progress.
//
// Response (200):
//   { "retrying": 12, "remaining": 0 }
// ============================================================

import { NextResponse } from 'next/server';
import { after } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import {
  planBroadcastRetry,
  deliverBroadcast,
  BroadcastError,
} from '@/lib/whatsapp/broadcast-core';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';

// The `after()` fan-out sends sequentially within this route's max
// duration, the same constraint the v1 broadcast route documents. The
// planner caps a single call well inside that budget and reports any
// leftovers as `remaining`, and deliverBroadcast stops early rather
// than being cut off mid-write.
//
// MUST equal ROUTE_MAX_DURATION_SECONDS in lib/whatsapp/broadcast-limits
// (literal required — see the note there). Enforced by
// broadcast-limits.test.ts.
export const maxDuration = 300;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Retrying is a send, so it needs the same 'agent' role as
    // starting a broadcast — a viewer must not be able to re-blast a
    // template from the account's number.
    const { supabase, accountId, userId } = await requireRole('agent');

    // Deliberately a separate bucket from `broadcast:` — a retry
    // shouldn't be locked out by the campaign-start budget the send
    // wizard consumes, and vice versa.
    const limit = checkRateLimit(`broadcast-retry:${userId}`, RATE_LIMITS.broadcast);
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    const body = (await request.json().catch(() => null)) as {
      recipient_id?: unknown;
      header_media_url?: unknown;
    } | null;
    const recipientId =
      typeof body?.recipient_id === 'string' ? body.recipient_id : undefined;
    // Supplied by the UI after a `header_media_required` refusal. The
    // planner persists it, so the prompt happens once per broadcast.
    const headerMediaUrl =
      typeof body?.header_media_url === 'string' ? body.header_media_url : undefined;

    // Plan with the request-scoped client: RLS enforces account
    // ownership on every read and on the claim.
    const plan = await planBroadcastRetry(supabase, accountId, id, {
      recipientId,
      headerMediaUrl,
    });

    // ...but fan out on the service-role client. The cookie-backed
    // client can't safely refresh its session once the response has
    // been sent, and the plan carries explicit row ids that the claim
    // above already verified belong to this account.
    if (plan.planned.length > 0) {
      after(() => deliverBroadcast(supabaseAdmin(), plan));
    }

    return NextResponse.json({
      retrying: plan.planned.length,
      remaining: plan.remaining ?? 0,
    });
  } catch (error) {
    if (error instanceof BroadcastError) {
      return NextResponse.json(
        { error: error.message, code: error.code, ...error.details },
        { status: error.status }
      );
    }
    console.error('Error in broadcast retry POST:', error);
    return toErrorResponse(error);
  }
}
