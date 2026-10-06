// ============================================================
// POST /api/whatsapp/media/upload — upload media to Meta's
// phone-number-scoped "Upload Media" endpoint and return the
// resulting media id.
//
// https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/media#upload-media
//
// Two inputs, same result:
//   - multipart form: `file` + `kind` (a file picked in the browser)
//   - JSON: `{ url, kind }` for image/video/document (a public link the
//     server downloads first)
//
// Once uploaded, the `id` is reused across every recipient in a
// broadcast without Meta re-fetching a link per message. Distinct
// from the account's Supabase-storage upload (`uploadAccountMedia`),
// which stores a public URL Meta fetches at send/review time instead.
// ============================================================

import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { uploadPhoneMedia } from '@/lib/whatsapp/meta-api'
import { uploadMediaFromUrl } from '@/lib/whatsapp/media-upload'
import { isValidHttpUrl } from '@/lib/broadcasts/variables'
import { isHeaderMediaKind, isMediaKind, MEDIA_SPECS } from '@/lib/media-specs'
import { decrypt } from '@/lib/whatsapp/encryption'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 })
}

async function loadCredentials(supabase: SupabaseClient, accountId: string) {
  const { data: config, error } = await supabase
    .from('whatsapp_config')
    .select('phone_number_id, access_token')
    .eq('account_id', accountId)
    .single()
  if (error || !config) return null
  return { phoneNumberId: config.phone_number_id, accessToken: decrypt(config.access_token) }
}

const notConfigured = () =>
  NextResponse.json({ error: 'WhatsApp not configured' }, { status: 400 })

export async function POST(request: Request) {
  try {
    // Uploading media is part of composing a send, so it needs the
    // same 'agent' role as sending a broadcast/template.
    const { supabase, accountId, userId } = await requireRole('agent')

    const limit = checkRateLimit(`media-upload:${userId}`, RATE_LIMITS.broadcast)
    if (!limit.success) return rateLimitResponse(limit)

    if (request.headers.get('content-type')?.includes('application/json')) {
      const body = await request.json().catch(() => null)
      const kind = body?.kind
      const url = body?.url
      if (!isHeaderMediaKind(kind)) {
        return badRequest("'kind' must be one of image, video, document for a URL.")
      }
      if (typeof url !== 'string' || !isValidHttpUrl(url)) {
        return badRequest('A valid http(s) URL is required.')
      }

      const credentials = await loadCredentials(supabase, accountId)
      if (!credentials) return notConfigured()

      try {
        const { id } = await uploadMediaFromUrl({ url, kind, ...credentials })
        return NextResponse.json({ id, kind })
      } catch (e) {
        // The messages are written for the person who typed the link.
        return NextResponse.json(
          { error: e instanceof Error ? e.message : 'Could not upload the media.' },
          { status: 502 },
        )
      }
    }

    const form = await request.formData().catch(() => null)
    const file = form?.get('file')
    const kind = form?.get('kind')
    if (!file || !(file instanceof File)) return badRequest('A file is required.')
    if (!isMediaKind(kind)) {
      return badRequest("'kind' must be one of image, video, document, audio.")
    }

    const { mimeTypes, maxBytes } = MEDIA_SPECS[kind]
    if (!mimeTypes.includes(file.type)) {
      return badRequest(
        `${kind} must be one of: ${mimeTypes.join(', ')} (got ${file.type || 'unknown'}).`,
      )
    }
    if (file.size > maxBytes) {
      return badRequest(
        `${kind} is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is ${(maxBytes / 1024 / 1024).toFixed(0)} MB.`,
      )
    }

    const credentials = await loadCredentials(supabase, accountId)
    if (!credentials) return notConfigured()

    const { id } = await uploadPhoneMedia({
      ...credentials,
      bytes: new Uint8Array(await file.arrayBuffer()),
      mimeType: file.type,
      fileName: file.name || `header.${kind}`,
    })

    return NextResponse.json({ id, mimeType: file.type, kind })
  } catch (error) {
    console.error('Error in WhatsApp media upload POST:', error)
    return toErrorResponse(error)
  }
}
