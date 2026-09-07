/**
 * POST /api/whatsapp/embedded-signup
 *
 * Completes Meta's Embedded Signup flow. The browser half
 * (`src/components/settings/embedded-signup-button.tsx`) collects two
 * things from the popup and posts them here:
 *
 *   - `code`  — from the FB.login callback, exchangeable for the
 *               customer's access token. Never leaves the server again.
 *   - `waba_id` / `phone_number_id` — from the popup's postMessage.
 *               Both are best-effort: the coexistence completion event
 *               can omit the phone number, and a dropped message leaves
 *               neither, so this route re-derives whatever is missing
 *               from Meta rather than trusting the browser to supply it.
 *
 * Deliberately does NOT call POST /{phone_number_id}/register. A
 * coexistence number is registered through the WhatsApp Business app and
 * has no two-step PIN to give us; an Embedded Signup Cloud API number is
 * registered by Meta inside the flow. See migration 042.
 */

import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  exchangeCodeForToken,
  getEmbeddedSignupEnv,
  listWabaPhoneNumbers,
  resolveWabaIdFromToken,
  type WabaPhoneNumber,
} from '@/lib/whatsapp/embedded-signup'
import { subscribeWabaToApp } from '@/lib/whatsapp/meta-api'
import { encrypt } from '@/lib/whatsapp/encryption'
import {
  findConflictingAccount,
  PHONE_NUMBER_CLAIMED_MESSAGE,
} from '@/lib/whatsapp/config-store'

/**
 * Pick the number this signup was for.
 *
 * The popup usually tells us, but the coexistence completion event
 * (`FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING`) is allowed to omit
 * `phone_number_id`, so falling back to the WABA's own list is a normal
 * path here, not an edge case. A WABA with exactly one number is
 * unambiguous; more than one and we have to ask rather than guess,
 * because guessing wrong binds the account to the wrong inbox.
 */
function selectPhoneNumber(
  numbers: WabaPhoneNumber[],
  requestedId: string | undefined,
): { ok: true; number: WabaPhoneNumber } | { ok: false; error: string } {
  if (requestedId) {
    const match = numbers.find((n) => n.id === requestedId)
    // Meta named this number in the signup session, so trust it even if
    // the list call came back stale — a number provisioned seconds ago
    // does not always appear in /phone_numbers immediately.
    return match
      ? { ok: true, number: match }
      : { ok: true, number: { id: requestedId, display_phone_number: '' } }
  }

  if (numbers.length === 0) {
    return {
      ok: false,
      error:
        'Meta reported no phone numbers on this WhatsApp Business Account. Finish adding a number in the signup popup, then try again.',
    }
  }

  if (numbers.length > 1) {
    const list = numbers.map((n) => n.display_phone_number || n.id).join(', ')
    return {
      ok: false,
      error: `This WhatsApp Business Account has more than one phone number (${list}). Re-run the signup and pick a single number, or connect it manually below.`,
    }
  }

  return { ok: true, number: numbers[0] }
}

export async function POST(request: Request) {
  try {
    // Same admin-only gate as the manual connect form: whatsapp_config
    // writes are admin+ at the RLS layer too.
    const { supabase, accountId, userId } = await requireRole('admin')

    const env = getEmbeddedSignupEnv()
    if (!env) {
      // The button is env-gated client-side, so reaching this means the
      // server and the build disagree about the configuration — most
      // often NEXT_PUBLIC_META_ES_CONFIG_ID baked into a Docker image
      // without META_APP_ID / META_APP_SECRET set at runtime.
      return NextResponse.json(
        {
          error:
            'Embedded Signup is not configured on this instance. Set META_APP_ID, META_APP_SECRET and NEXT_PUBLIC_META_ES_CONFIG_ID.',
        },
        { status: 503 },
      )
    }

    const body = await request.json().catch(() => null)
    const code = typeof body?.code === 'string' ? body.code.trim() : ''
    const requestedWabaId =
      typeof body?.waba_id === 'string' && body.waba_id.trim()
        ? body.waba_id.trim()
        : undefined
    const requestedPhoneNumberId =
      typeof body?.phone_number_id === 'string' && body.phone_number_id.trim()
        ? body.phone_number_id.trim()
        : undefined

    if (!code) {
      return NextResponse.json(
        { error: 'Missing the signup code returned by Meta.' },
        { status: 400 },
      )
    }

    // Step 1 — code → the customer's long-lived business token.
    let accessToken: string
    try {
      accessToken = await exchangeCodeForToken({
        code,
        appId: env.appId,
        appSecret: env.appSecret,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Meta API error'
      console.error('[embedded-signup] token exchange failed:', message)
      return NextResponse.json(
        { error: `Meta rejected the signup code: ${message}` },
        { status: 400 },
      )
    }

    // Step 2 — resolve the WABA, from the popup or from the token.
    const wabaId =
      requestedWabaId ??
      (await resolveWabaIdFromToken({
        accessToken,
        appId: env.appId,
        appSecret: env.appSecret,
      }))

    if (!wabaId) {
      return NextResponse.json(
        {
          error:
            'Could not determine which WhatsApp Business Account was connected. Re-run the signup, and make sure pop-ups are not blocked.',
        },
        { status: 400 },
      )
    }

    // Step 3 — resolve the number, and with it whether this is
    // coexistence (platform_type SMB_APP) or a plain Cloud API number.
    let numbers: WabaPhoneNumber[]
    try {
      numbers = await listWabaPhoneNumbers({ wabaId, accessToken })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Meta API error'
      console.error('[embedded-signup] phone_numbers lookup failed:', message)
      return NextResponse.json(
        { error: `Meta API error reading the account's phone numbers: ${message}` },
        { status: 400 },
      )
    }

    const selection = selectPhoneNumber(numbers, requestedPhoneNumberId)
    if (!selection.ok) {
      return NextResponse.json({ error: selection.error }, { status: 409 })
    }
    const phoneNumber = selection.number
    const isCoexistence = phoneNumber.platform_type === 'SMB_APP'

    // Step 4 — one number, one account (issue #136).
    let claimedBy: string | null
    try {
      claimedBy = await findConflictingAccount({
        phoneNumberId: phoneNumber.id,
        accountId,
      })
    } catch {
      return NextResponse.json(
        { error: 'Failed to validate configuration' },
        { status: 500 },
      )
    }
    if (claimedBy) {
      return NextResponse.json(
        { error: PHONE_NUMBER_CLAIMED_MESSAGE },
        { status: 409 },
      )
    }

    // Step 5 — subscribe this app to the WABA so its webhooks reach us.
    // Idempotent on Meta's side. Unlike the manual path we do NOT treat
    // a failure here as non-fatal: Embedded Signup has no follow-up
    // screen where the operator could notice and retry, so a silent
    // failure would leave a connection that looks healthy and receives
    // nothing.
    try {
      await subscribeWabaToApp({ wabaId, accessToken })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Meta API error'
      console.error('[embedded-signup] subscribed_apps failed:', message)
      return NextResponse.json(
        {
          error: `Connected, but subscribing to webhooks failed: ${message}. Nothing was saved — please try again.`,
        },
        { status: 502 },
      )
    }

    let encryptedAccessToken: string
    try {
      encryptedAccessToken = encrypt(accessToken)
    } catch (err) {
      console.error('[embedded-signup] encryption failed:', err)
      return NextResponse.json(
        {
          error:
            'Failed to encrypt the access token. Check that ENCRYPTION_KEY is a valid 64-character hex string.',
        },
        { status: 500 },
      )
    }

    const now = new Date().toISOString()
    const row = {
      phone_number_id: phoneNumber.id,
      waba_id: wabaId,
      access_token: encryptedAccessToken,
      connection_type: isCoexistence
        ? ('coexistence' as const)
        : ('embedded_signup' as const),
      status: 'connected' as const,
      connected_at: now,
      // Meta registers the number as part of the flow (coexistence
      // numbers are registered through the Business app), so the number
      // really is live — recording the timestamp keeps the UI's
      // "Not registered" banner from firing on a healthy connection.
      registered_at: now,
      subscribed_apps_at: now,
      last_registration_error: null,
      updated_at: now,
    }

    // verify_token and app_secret stay NULL on purpose. Under Embedded
    // Signup the webhook is configured once on the Tech Provider's app,
    // not per customer, so both fall back to the instance env vars —
    // META_WEBHOOK_VERIFY_TOKEN for the GET handshake and META_APP_SECRET
    // for the x-hub-signature-256 check.
    const { data: existing } = await supabase
      .from('whatsapp_config')
      .select('id')
      .eq('account_id', accountId)
      .maybeSingle()

    const { error: writeError } = existing
      ? await supabase.from('whatsapp_config').update(row).eq('account_id', accountId)
      : await supabase
          .from('whatsapp_config')
          .insert({ account_id: accountId, user_id: userId, ...row })

    if (writeError) {
      console.error('[embedded-signup] saving whatsapp_config failed:', writeError)
      return NextResponse.json(
        { error: 'Failed to save configuration' },
        { status: 500 },
      )
    }

    return NextResponse.json({
      success: true,
      connection_type: row.connection_type,
      waba_id: wabaId,
      phone_info: {
        id: phoneNumber.id,
        display_phone_number: phoneNumber.display_phone_number,
        verified_name: phoneNumber.verified_name,
      },
    })
  } catch (err) {
    // requireRole throws UnauthorizedError / ForbiddenError; toErrorResponse
    // maps those and lets anything else fall through as a 500.
    return toErrorResponse(err)
  }
}
