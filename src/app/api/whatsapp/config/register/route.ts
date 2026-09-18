import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import { registerPhoneNumber, RegisterPinMismatchError } from '@/lib/whatsapp/meta-api'

/**
 * POST /api/whatsapp/config/register
 *
 * Retries POST /{phone_number_id}/register for the account's saved
 * number, using a PIN the caller supplies now rather than one this
 * app generated. This is the path out of RegisterPinMismatchError
 * (Meta error 133005): the number already has two-step verification
 * enabled with a PIN neither Embedded Signup's auto-generated one
 * nor the manual form's could have guessed, so the only way forward
 * is asking whoever actually knows it.
 *
 * Deliberately separate from POST /api/whatsapp/config: that route
 * re-validates and re-saves an entire pasted-by-hand credential set.
 * This one only touches registration, reusing the access_token and
 * phone_number_id already on file — the only option for an
 * Embedded-Signup-connected number, which never exposes its access
 * token to the browser for a manual-form resubmit in the first place.
 */
export async function POST(request: Request) {
  try {
    // Same admin-only gate as both connect paths — whatsapp_config
    // writes are admin+ at the RLS layer too.
    const { supabase, accountId } = await requireRole('admin')

    const body = await request.json().catch(() => null)
    const pin = typeof body?.pin === 'string' ? body.pin.trim() : ''
    if (!/^\d{6}$/.test(pin)) {
      return NextResponse.json(
        { error: 'PIN must be exactly 6 digits.' },
        { status: 400 },
      )
    }

    const { data: config, error: fetchError } = await supabase
      .from('whatsapp_config')
      .select('phone_number_id, access_token')
      .eq('account_id', accountId)
      .maybeSingle()

    if (fetchError || !config) {
      return NextResponse.json(
        { error: 'No WhatsApp configuration found for this account.' },
        { status: 404 },
      )
    }

    let accessToken: string
    try {
      accessToken = decrypt(config.access_token)
    } catch (err) {
      console.error('[whatsapp/config/register] token decryption failed:', err)
      return NextResponse.json(
        {
          error:
            'The stored access token cannot be decrypted with the current ENCRYPTION_KEY. Reset the configuration and reconnect.',
        },
        { status: 500 },
      )
    }

    const now = new Date().toISOString()

    try {
      await registerPhoneNumber({
        phoneNumberId: config.phone_number_id,
        accessToken,
        pin,
      })
    } catch (err) {
      // Still the wrong PIN (or some other Meta error) — save the
      // outcome so the banner reflects it, but don't 500: the caller
      // gets to try a different PIN without reloading the page.
      const registrationErrorCode =
        err instanceof RegisterPinMismatchError ? ('pin_mismatch' as const) : null
      const registrationError =
        err instanceof Error ? err.message : 'Unknown Meta API error'

      const { error: updateError } = await supabase
        .from('whatsapp_config')
        .update({
          last_registration_error: registrationError,
          last_registration_error_code: registrationErrorCode,
          updated_at: now,
        })
        .eq('account_id', accountId)
      if (updateError) {
        console.error('[whatsapp/config/register] saving failed attempt failed:', updateError)
      }

      return NextResponse.json({
        success: false,
        registered: false,
        registration_error: registrationError,
        registration_error_code: registrationErrorCode,
      })
    }

    const { error: updateError } = await supabase
      .from('whatsapp_config')
      .update({
        registered_at: now,
        last_registration_error: null,
        last_registration_error_code: null,
        updated_at: now,
      })
      .eq('account_id', accountId)

    if (updateError) {
      console.error('[whatsapp/config/register] saving registered_at failed:', updateError)
      return NextResponse.json(
        { error: 'Registered with Meta, but failed to save the status locally. Refresh to check.' },
        { status: 500 },
      )
    }

    return NextResponse.json({ success: true, registered: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
