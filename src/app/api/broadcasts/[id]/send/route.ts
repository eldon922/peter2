// ============================================================
// POST /api/broadcasts/{id}/send — fan out an already-created
// broadcast (dashboard "new broadcast" wizard surface).
//
// The wizard (`use-broadcast-sending`) still resolves the audience and
// persists the `broadcasts` row + `pending` `broadcast_recipients` rows
// client-side — that part stays as-is. What used to happen next was a
// client-driven loop posting batches to `/api/whatsapp/broadcast` from
// the browser; this route replaces that loop with the same
// after()-and-poll shape the retry route already uses, so the actual
// Meta fan-out runs server-side instead of depending on the sender's
// tab staying open.
//
// Body: none required.
//
// Response (200):
//   { "sending": 42 }
// ============================================================

import { NextResponse } from 'next/server';
import { after } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import {
  planBroadcastSend,
  deliverBroadcast,
  finalizeBroadcastStatus,
  BroadcastError,
} from '@/lib/whatsapp/broadcast-core';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';

// The `after()` fan-out sends sequentially within this route's max
// duration, the same constraint the retry route and the v1 broadcast
// route document.
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
    // Starting a send needs the same 'agent' role the old client-side
    // /api/whatsapp/broadcast route required — a viewer must not be
    // able to trigger a blast just because the wizard got them to a
    // freshly-created broadcast row.
    const { supabase, accountId, userId } = await requireRole('agent');

    // Same bucket the client-driven path used to consume — starting a
    // wizard send is still "starting a campaign", the thing this limit
    // budgets. Distinct from `broadcast-retry:`.
    const limit = checkRateLimit(`broadcast:${userId}`, RATE_LIMITS.broadcast);
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;

    // Plan with the request-scoped client: RLS enforces account
    // ownership on every read.
    const plan = await planBroadcastSend(supabase, accountId, id);

    // ...but fan out on the service-role client, same rationale as the
    // retry route: the cookie-backed client can't safely refresh its
    // session once the response has been sent, and the plan carries
    // explicit row ids already verified to belong to this account.
    if (plan.planned.length > 0) {
      after(() => deliverBroadcast(supabaseAdmin(), plan));
    } else {
      // Nothing to fan out — every recipient row was orphaned, or the
      // wizard's insert produced none. The wizard has already stamped the
      // broadcast 'sending', and without this it would stay there for
      // good: the list and detail pages poll on exactly that status, so a
      // stranded row means a 5-second Supabase poll that never stops.
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
    console.error('Error in broadcast send POST:', error);
    return toErrorResponse(error);
  }
}
