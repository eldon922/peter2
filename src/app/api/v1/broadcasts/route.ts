// ============================================================
// POST /api/v1/broadcasts — launch a template broadcast
// (scope: broadcasts:send).
//
// Body:
//   {
//     "name": "July promo",                 // optional label
//     "template_name": "promo_july",        // required, approved template
//     "template_language": "en_US",         // optional (default en_US)
//     "recipients": [                        // required, non-empty array
//                                            // (no hard cap — what one
//                                            // pass can't send is retried
//                                            // via the retry endpoint)
//       { "to": "+14155550123", "params": ["Jane"] },
//       { "to": "+14155550124" }
//     ]
//   }
//
// The broadcast + its recipient rows are persisted synchronously, then
// the Meta fan-out runs in `after()` so the request returns fast. Poll
// `GET /api/v1/broadcasts/{id}` for progress.
//
// Optional header `Idempotency-Key`: a retry with the same key and body
// (after a timeout, say) gets the first response back, with
// `Idempotent-Replayed: true`, instead of creating a second broadcast.
//
// Response (202):
//   { "data": { "broadcast_id", "status": "sending",
//               "total_recipients", "accepted", "rejected" } }
// ============================================================

import { NextResponse, after } from 'next/server';

import { requireApiKey } from '@/lib/auth/api-context';

// The `after()` fan-out below sends to every recipient sequentially and
// runs within this route's max duration (the same constraint the
// webhook route documents). Give it headroom beyond the platform
// default so a modest batch isn't cut off mid-send. This is a bound,
// not a guarantee: a large audience can still exceed it in one pass —
// deliverBroadcast marks whatever's left as 'failed' rather than
// stranding it, and the retry endpoint sends the rest when called.
// A durable queue/cron drain is the complete fix (follow-up).
//
// MUST equal ROUTE_MAX_DURATION_SECONDS in lib/whatsapp/broadcast-limits
// — DELIVER_BUDGET_MS is derived from it. It cannot be imported: Next
// statically analyzes route segment config and ignores non-literal
// values. broadcast-limits.test.ts enforces the mirror.
export const maxDuration = 1800;
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import {
  claimIdempotencyKey,
  hashRequestBody,
  readIdempotencyKey,
  releaseIdempotencyKey,
  saveIdempotentResponse,
} from '@/lib/api/v1/idempotency';
import { resolveAuditUserId, ContactError } from '@/lib/api/v1/contacts';
import {
  createBroadcast,
  deliverBroadcast,
  BroadcastError,
} from '@/lib/whatsapp/broadcast-core';

export async function POST(request: Request) {
  // Set once an Idempotency-Key is reserved, until the broadcast exists.
  let releaseKey: (() => Promise<void>) | null = null;
  try {
    const ctx = await requireApiKey(request, 'broadcasts:send');
    const idempotencyKey = readIdempotencyKey(request);

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    if (idempotencyKey) {
      const claim = await claimIdempotencyKey(
        ctx.supabase,
        ctx.accountId,
        idempotencyKey,
        hashRequestBody(body)
      );
      if (claim.kind === 'replay') {
        return NextResponse.json(claim.body, {
          status: claim.status,
          headers: { 'Idempotent-Replayed': 'true' },
        });
      }
      if (claim.kind === 'mismatch') {
        return fail(
          'idempotency_key_reused',
          'This Idempotency-Key was already used with a different request body.',
          422
        );
      }
      if (claim.kind === 'busy') {
        return fail(
          'request_in_progress',
          'A request with this Idempotency-Key is still being processed. Retry shortly.',
          409
        );
      }
      releaseKey = () =>
        releaseIdempotencyKey(ctx.supabase, ctx.accountId, idempotencyKey);
    }

    const templateName =
      typeof body.template_name === 'string' ? body.template_name : '';
    const recipients = Array.isArray(body.recipients) ? body.recipients : [];

    const auditUserId = await resolveAuditUserId(ctx.supabase, ctx.accountId);

    const plan = await createBroadcast(ctx.supabase, ctx.accountId, auditUserId, {
      name: typeof body.name === 'string' ? body.name : null,
      templateName,
      templateLanguage:
        typeof body.template_language === 'string'
          ? body.template_language
          : null,
      recipients: recipients.map((r) => ({
        to: typeof r?.to === 'string' ? r.to : '',
        params: Array.isArray(r?.params) ? r.params : undefined,
      })),
    });

    // The broadcast exists now: a retry must get it back, not a new one.
    releaseKey = null;

    // Fan out after the response is sent. Uses the same service-role
    // client — no request-scoped auth needed for the Meta calls or
    // the account-scoped row updates.
    after(() => deliverBroadcast(ctx.supabase, plan));

    const payload = {
      broadcast_id: plan.broadcastId,
      status: 'sending',
      total_recipients: plan.planned.length,
      accepted: plan.planned.length,
      rejected: plan.rejected,
    };
    if (idempotencyKey) {
      try {
        await saveIdempotentResponse(
          ctx.supabase,
          ctx.accountId,
          idempotencyKey,
          202,
          { data: payload }
        );
      } catch (e) {
        // The broadcast is already going out, so still answer 202.
        console.error('[api/v1/broadcasts] could not store the idempotent response:', e);
      }
    }

    return ok(payload, 202);
  } catch (err) {
    // The request failed before creating anything: free the key for a retry.
    await releaseKey?.().catch((e) =>
      console.error('[api/v1/broadcasts] could not release the idempotency key:', e)
    );
    if (err instanceof BroadcastError) {
      return fail(err.code, err.message, err.status);
    }
    if (err instanceof ContactError) {
      return fail(
        err.status === 400 ? 'bad_request' : 'internal',
        err.message,
        err.status
      );
    }
    return toApiErrorResponse(err);
  }
}
