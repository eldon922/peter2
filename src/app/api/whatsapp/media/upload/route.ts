// ============================================================
// POST /api/whatsapp/media/upload — upload a file to Meta's
// phone-number-scoped "Upload Media" endpoint and return the
// resulting media id.
//
// https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/media#upload-media
//
// This is the "fast path" for broadcast/template media: once a file
// is uploaded here, its `id` can be reused across every recipient in
// a broadcast without Meta re-fetching a link per message. Distinct
// from the account's Supabase-storage upload (`uploadAccountMedia`),
// which stores a public URL Meta fetches at send/review time instead.
// ============================================================

import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { uploadPhoneMedia } from '@/lib/whatsapp/meta-api'
import { isMediaKind, MEDIA_SPECS } from '@/lib/media-specs'
import { decrypt } from '@/lib/whatsapp/encryption'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

export async function POST(request: Request) {
  try {
    // Uploading media is part of composing a send, so it needs the
    // same 'agent' role as sending a broadcast/template.
    const { supabase, accountId, userId } = await requireRole('agent')

    const limit = checkRateLimit(`media-upload:${userId}`, RATE_LIMITS.broadcast)
    if (!limit.success) return rateLimitResponse(limit)

    const form = await request.formData().catch(() => null)
    const file = form?.get('file')
    const kindRaw = form?.get('kind')
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'A file is required.' }, { status: 400 })
    }
    if (!isMediaKind(kindRaw)) {
      return NextResponse.json(
        { error: "'kind' must be one of image, video, document, audio." },
        { status: 400 },
      )
    }
    const kind = kindRaw

    const allowedMimes = MEDIA_SPECS[kind].mimeTypes
    if (!allowedMimes.includes(file.type)) {
      return NextResponse.json(
        { error: `${kind} must be one of: ${allowedMimes.join(', ')} (got ${file.type || 'unknown'}).` },
        { status: 400 },
      )
    }
    const maxBytes = MEDIA_SPECS[kind].maxBytes
    if (file.size > maxBytes) {
      return NextResponse.json(
        {
          error: `${kind} is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is ${(maxBytes / 1024 / 1024).toFixed(0)} MB.`,
        },
        { status: 400 },
      )
    }

    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('phone_number_id, access_token')
      .eq('account_id', accountId)
      .single()
    if (configError || !config) {
      return NextResponse.json({ error: 'WhatsApp not configured' }, { status: 400 })
    }

    const accessToken = decrypt(config.access_token)
    const bytes = new Uint8Array(await file.arrayBuffer())

    const { id } = await uploadPhoneMedia({
      phoneNumberId: config.phone_number_id,
      accessToken,
      bytes,
      mimeType: file.type,
      fileName: file.name || `header.${kind}`,
    })

    return NextResponse.json({ id, mimeType: file.type, kind })
  } catch (error) {
    console.error('Error in WhatsApp media upload POST:', error)
    return toErrorResponse(error)
  }
}
