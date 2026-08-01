// ============================================================
// POST /api/v1/broadcasts/{id}/retry — re-send the failed recipients
// of an existing broadcast (scope: broadcasts:send).
//
// Body (optional):
//   { "header_media_url": "https://…" }
//     Only for a `header_media_required` refusal — see below. Stored on
//     the broadcast, so it is needed at most once.
//
// Failed rows are claimed synchronously, then the Meta fan-out runs in
// `after()`. Poll `GET /api/v1/broadcasts/{id}` for progress.
// Account-scoped: a foreign id → 404.
//
// Response (202):
//   { "data": { "broadcast_id", "retrying", "remaining" } }
//
// Notable errors — all refuse BEFORE claiming any row, so a rejected
// retry never consumes the failures it declined to send:
//   409 conflict               — the broadcast is still sending
//   422 params_unrecoverable   — created before per-recipient template
//                                values were stored, so the original
//                                personalization cannot be reproduced
//   422 template_missing       — the template is gone from this account
//   422 header_media_required  — media-header broadcast predating
//                                header_media_url; resend with
//                                `header_media_url` to say which media
//                                to use. We never guess by falling back
//                                to the template's current default.
// ============================================================

import { after } from 'next/server';

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import {
  planBroadcastRetry,
  deliverBroadcast,
  BroadcastError,
} from '@/lib/whatsapp/broadcast-core';

// Same bound as POST /api/v1/broadcasts — see the note there. The
// planner caps one call to fit, and reports leftovers as `remaining`.
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
    const ctx = await requireApiKey(request, 'broadcasts:send');
    const { id } = await params;

    const body = (await request.json().catch(() => null)) as {
      header_media_url?: unknown;
    } | null;
    const headerMediaUrl =
      typeof body?.header_media_url === 'string' ? body.header_media_url : undefined;

    const plan = await planBroadcastRetry(ctx.supabase, ctx.accountId, id, {
      headerMediaUrl,
    });

    // ctx.supabase is already service-role, so it serves both the
    // planning reads and the post-response fan-out.
    if (plan.planned.length > 0) {
      after(() => deliverBroadcast(ctx.supabase, plan));
    }

    return ok(
      {
        broadcast_id: plan.broadcastId,
        retrying: plan.planned.length,
        remaining: plan.remaining ?? 0,
      },
      202
    );
  } catch (err) {
    if (err instanceof BroadcastError) {
      return fail(err.code, err.message, err.status);
    }
    return toApiErrorResponse(err);
  }
}
