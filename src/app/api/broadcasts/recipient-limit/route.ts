// ============================================================
// GET /api/broadcasts/recipient-limit — advisory "how many recipients
// can this account realistically message" figure, for the dashboard
// wizard's audience-size warning (step2-select-audience.tsx and
// use-broadcast-sending.ts). Read-only, no side effects.
//
// Server-side only because it needs the account's decrypted Meta
// access token to ask Meta for the number's live messaging-limit
// tier — something the browser can never hold. See
// recipientLimitForTier in broadcast-limits.ts for how that tier
// becomes a recipient count.
//
// Response (200): { "limit": 10000, "source": "meta" | "default" }
// `source` is "default" only when there was no live Meta figure to
// use (not configured yet, or the live lookup failed) — mostly useful
// for debugging/observability, not for the UI to branch on.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { decrypt } from '@/lib/whatsapp/encryption';
import { getMessagingLimit } from '@/lib/whatsapp/meta-api';
import { recipientLimitForTier } from '@/lib/whatsapp/broadcast-limits';

export async function GET() {
  try {
    // Same bar as starting a send (send/route.ts) — this is wizard-only
    // data, not something a viewer needs.
    const { supabase, accountId } = await requireRole('agent');

    const { data: config } = await supabase
      .from('whatsapp_config')
      .select('phone_number_id, access_token')
      .eq('account_id', accountId)
      .maybeSingle();

    // Not configured yet — fall back to the flat conservative default
    // rather than error. The wizard shouldn't hard-fail on this while
    // WhatsApp setup is still in progress elsewhere.
    if (!config) {
      return NextResponse.json(recipientLimitForTier(undefined));
    }

    // Live Meta lookup — never throws (see getMessagingLimit), so a
    // network hiccup here degrades to the flat conservative default
    // instead of failing the whole request.
    const messagingLimit = await getMessagingLimit({
      phoneNumberId: config.phone_number_id,
      accessToken: decrypt(config.access_token),
    });

    return NextResponse.json(recipientLimitForTier(messagingLimit?.tier));
  } catch (error) {
    console.error('Error in recipient-limit GET:', error);
    return toErrorResponse(error);
  }
}
