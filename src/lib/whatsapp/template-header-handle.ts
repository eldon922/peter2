import { uploadResumableMedia } from '@/lib/whatsapp/meta-api'
import { fetchPublicMedia } from '@/lib/whatsapp/media-upload'
import type { TemplatePayload } from '@/lib/whatsapp/template-validators'
import { isHeaderMediaKind } from '@/lib/media-specs'

/**
 * Meta requires an `example.header_handle` (from the Resumable Upload
 * API) to create/edit a template with an IMAGE/VIDEO/DOCUMENT header —
 * a plain public URL is not accepted at creation time. This helper
 * turns the template's `header_media_url` (whether the user uploaded a
 * file or pasted a link) into a handle and writes it onto the payload,
 * so both the upload path and the legacy URL path actually succeed.
 *
 * No-op unless the header has a media type with a URL but no handle
 * yet. Originally image-only (the #230 scope); now covers video and
 * document too, each with Meta's own sample constraints.
 *
 * Named `ensureImageHeaderHandle` for backward compatibility with
 * existing imports/tests from when this was image-only — it now
 * handles all three media header types.
 */

export async function ensureImageHeaderHandle(
  payload: TemplatePayload,
  accessToken: string,
  /**
   * The account's Meta App ID from `whatsapp_config` (migration 041).
   * Falls back to the `META_APP_ID` env var when not supplied, so
   * deployments configured before that migration keep working.
   */
  configuredAppId?: string | null,
): Promise<void> {
  if (!isHeaderMediaKind(payload.header_type)) return
  const kind = payload.header_type
  if (payload.header_handle) return // already have one
  if (!payload.header_media_url) return // validator already requires url-or-handle

  const appId = configuredAppId || process.env.META_APP_ID
  if (!appId) {
    throw new Error(
      `${kind[0].toUpperCase()}${kind.slice(1)}-header templates need a Meta App ID (used for Meta’s Resumable Upload). Add it in Settings → WhatsApp, below the webhook configuration — or set the META_APP_ID environment variable — or remove the header.`,
    )
  }

  // `header_media_url` is caller-supplied (any authenticated member can
  // submit a template); the shared downloader refuses non-public hosts.
  const { bytes, mimeType, fileName } = await fetchPublicMedia(payload.header_media_url, kind)

  const { handle } = await uploadResumableMedia({
    appId,
    accessToken,
    fileName,
    mimeType,
    bytes,
  })
  payload.header_handle = handle
}
