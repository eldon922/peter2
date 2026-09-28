import { uploadResumableMedia } from '@/lib/whatsapp/meta-api'
import type { TemplatePayload } from '@/lib/whatsapp/template-validators'
import { isDeliverableUrl } from '@/lib/webhooks/ssrf'

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

type MediaHeaderType = 'image' | 'video' | 'document'

interface MediaHeaderSpec {
  maxBytes: number
  allowedTypes: string[]
  /** Human label used in error messages, e.g. "JPEG or PNG". */
  typeLabel: string
  defaultFileName: string
}

// Meta's header sample limits per type. Video/document mirror the caps
// already surfaced to users in Settings.templates.videoHint /
// documentHint (messages/*.json) — keep those in sync if these change.
const MEDIA_SPECS: Record<MediaHeaderType, MediaHeaderSpec> = {
  image: {
    maxBytes: 5 * 1024 * 1024,
    allowedTypes: ['image/jpeg', 'image/png'],
    typeLabel: 'JPEG or PNG',
    defaultFileName: 'header.jpg',
  },
  video: {
    maxBytes: 16 * 1024 * 1024,
    allowedTypes: ['video/mp4', 'video/3gpp'],
    typeLabel: 'MP4 or 3GPP',
    defaultFileName: 'header.mp4',
  },
  document: {
    maxBytes: 16 * 1024 * 1024,
    allowedTypes: ['application/pdf'],
    typeLabel: 'PDF',
    defaultFileName: 'header.pdf',
  },
}

function isMediaHeaderType(value: unknown): value is MediaHeaderType {
  return value === 'image' || value === 'video' || value === 'document'
}

function fileNameFor(kind: MediaHeaderType, contentType: string): string {
  const ext = contentType.split('/')[1] || MEDIA_SPECS[kind].defaultFileName.split('.')[1]
  return `header.${ext}`
}

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
  if (!isMediaHeaderType(payload.header_type)) return
  const kind = payload.header_type
  if (payload.header_handle) return // already have one
  if (!payload.header_media_url) return // validator already requires url-or-handle

  const spec = MEDIA_SPECS[kind]

  const appId = configuredAppId || process.env.META_APP_ID
  if (!appId) {
    throw new Error(
      `${kind[0].toUpperCase()}${kind.slice(1)}-header templates need a Meta App ID (used for Meta’s Resumable Upload). Add it in Settings → WhatsApp, below the webhook configuration — or set the META_APP_ID environment variable — or remove the header.`,
    )
  }

  // SSRF guard: `header_media_url` is caller-supplied (any authenticated
  // member can submit a template) and the fetch below happens server-side,
  // so refuse any destination that resolves to a private / loopback /
  // link-local / reserved address. Same guard, same message as the two
  // other outbound-fetch call sites (see lib/webhooks/ssrf.ts) — matching
  // the unreachable-host message keeps the failure from being an oracle.
  if (!(await isDeliverableUrl(payload.header_media_url))) {
    throw new Error(`Could not fetch the header ${kind} URL. Make sure it is publicly reachable.`)
  }

  // Fetch the sample media bytes (works for our uploaded chat-media URL
  // and for a manually-pasted public link).
  let res: Response
  try {
    res = await fetch(payload.header_media_url, {
      // Do NOT follow redirects — a public URL could 3xx-bounce to an
      // internal address, defeating the guard above. Bound the request so
      // a hung host can't tie up the template-submit handler.
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    throw new Error(`Could not fetch the header ${kind} URL. Make sure it is publicly reachable.`)
  }
  if (!res.ok) {
    throw new Error(`Header ${kind} URL returned ${res.status}. It must be publicly reachable.`)
  }

  const contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  if (contentType && !spec.allowedTypes.includes(contentType)) {
    throw new Error(`Header ${kind} must be ${spec.typeLabel} (got ${contentType}).`)
  }

  const bytes = new Uint8Array(await res.arrayBuffer())
  if (bytes.byteLength === 0) {
    throw new Error(`Header ${kind} is empty.`)
  }
  if (bytes.byteLength > spec.maxBytes) {
    throw new Error(
      `Header ${kind} is ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB — Meta's limit is ${(spec.maxBytes / 1024 / 1024).toFixed(0)} MB.`,
    )
  }

  const mimeType = spec.allowedTypes.includes(contentType) ? contentType : spec.allowedTypes[0]
  const fileName = fileNameFor(kind, mimeType)

  const { handle } = await uploadResumableMedia({
    appId,
    accessToken,
    fileName,
    mimeType,
    bytes,
  })
  payload.header_handle = handle
}
