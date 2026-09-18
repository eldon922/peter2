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
 * Calls POST /{phone_number_id}/register for plain Cloud API numbers
 * (issue: numbers came back from the popup "connected" but never
 * actually subscribed for inbound webhooks — Meta error 141000 on
 * send/receive). Meta does NOT reliably do this as part of the popup
 * flow, despite what an earlier version of this comment claimed. A
 * coexistence number is the one case that genuinely skips it: it's
 * registered through the WhatsApp Business app itself and has no
 * Cloud API PIN to give us. See migration 042.
 *
 * The PIN /register sets is generated here, handed back to the
 * browser once in this response (`registration_pin`), and never
 * stored — see the comment on that field below.
 */

import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  exchangeCodeForToken,
  generateRegistrationPin,
  getEmbeddedSignupEnv,
  listWabaPhoneNumbers,
  resolveWabaIdFromToken,
  type WabaPhoneNumber,
} from '@/lib/whatsapp/embedded-signup'
import { registerPhoneNumber, RegisterPinMismatchError, subscribeWabaToApp } from '@/lib/whatsapp/meta-api'
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

    // Step 6 — register the number for inbound webhooks.
    //
    // Coexistence numbers register through the WhatsApp Business app
    // itself and have no Cloud API PIN to give us, so this is skipped
    // for them and they're treated as live from `connected_at` alone
    // (unchanged from before). A plain Cloud API number, though, needs
    // an explicit /register call — the popup completing does not
    // guarantee Meta already did this, and a number that looks
    // "connected" here but was never registered fails every send with
    // error 141000. The PIN doesn't need to mean anything to the
    // customer; /register both sets it and completes registration in
    // one call, so a freshly generated one is fine.
    let registeredAt: string | null = null
    let registrationError: string | null = null
    /**
     * Set specifically for RegisterPinMismatchError. The settings
     * panel uses this (not just `registrationError`'s text) to decide
     * whether to show the generic failure message or the "enter this
     * number's existing PIN" retry form — see
     * POST /api/whatsapp/config/register.
     */
    let registrationErrorCode: 'pin_mismatch' | null = null
    // Only set when /register actually succeeds this call — never
    // persisted anywhere, and deliberately not stored on the config
    // row (see comment on the response below for why).
    let generatedPin: string | null = null
    if (!isCoexistence) {
      const pin = generateRegistrationPin()
      try {
        await registerPhoneNumber({
          phoneNumberId: phoneNumber.id,
          accessToken,
          pin,
        })
        registeredAt = new Date().toISOString()
        generatedPin = pin
      } catch (err) {
        if (err instanceof RegisterPinMismatchError) {
          registrationErrorCode = 'pin_mismatch'
        }
        registrationError =
          err instanceof Error ? err.message : 'Unknown Meta API error'
        console.error('[embedded-signup] /register failed:', registrationError)
        // Fall through and still save the row — the credentials and
        // subscription are valid, only registration failed, and the
        // "Not Registered" banner (driven by registered_at /
        // last_registration_error, same fields the manual-connect path
        // writes) gives the user a retry path without redoing signup.
      }
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
      // Coexistence: registered through the Business app, so treat it
      // as live from the moment the config is saved. Cloud API: only
      // as live as the /register call above actually was.
      registered_at: isCoexistence ? now : registeredAt,
      subscribed_apps_at: now,
      last_registration_error: isCoexistence ? null : registrationError,
      last_registration_error_code: isCoexistence ? null : registrationErrorCode,
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
      registered: row.registered_at != null,
      registration_error: row.last_registration_error,
      registration_error_code: row.last_registration_error_code,
      // Handed to the browser exactly once, on the response to THIS
      // request, and never written anywhere server-side (not to
      // whatsapp_config, not to logs). If the customer loses it, it
      // is not recoverable here — Meta's WhatsApp Manager → two-step
      // verification is the only reset path at that point.
      registration_pin: generatedPin,
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
