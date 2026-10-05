import { uploadPhoneMedia } from '@/lib/whatsapp/meta-api'
import { isDeliverableUrl } from '@/lib/webhooks/ssrf'

/**
 * Server-side "fetch a public URL, push it to Meta's Upload Media
 * endpoint, return the reusable media id".
 *
 * Broadcasts send every media header by Meta media id (never by link) so
 * Meta doesn't re-download the file once per recipient. Where the media
 * only exists as a URL — the template's default image, a URL typed into
 * the wizard, an API-created broadcast — this turns it into an id.
 *
 * Limits mirror Meta's media caps and the /api/whatsapp/media/upload
 * route (image 5 MB JPEG/PNG, video 16 MB MP4/3GPP, document 16 MB PDF).
 */
export type BroadcastMediaKind = 'image' | 'video' | 'document'

export function isBroadcastMediaKind(value: unknown): value is BroadcastMediaKind {
  return value === 'image' || value === 'video' || value === 'document'
}

const SPECS: Record<BroadcastMediaKind, { maxBytes: number; allowedTypes: string[]; ext: string }> = {
  image: { maxBytes: 5 * 1024 * 1024, allowedTypes: ['image/jpeg', 'image/png'], ext: 'jpg' },
  video: { maxBytes: 16 * 1024 * 1024, allowedTypes: ['video/mp4', 'video/3gpp'], ext: 'mp4' },
  document: { maxBytes: 16 * 1024 * 1024, allowedTypes: ['application/pdf'], ext: 'pdf' },
}

const FETCH_TIMEOUT_MS = 30_000

/** Read a body, giving up as soon as it grows past `maxBytes`. */
async function readCapped(
  res: Response,
  kind: BroadcastMediaKind,
  maxBytes: number,
): Promise<Uint8Array> {
  const reader = res.body?.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (reader) {
    let chunk: ReadableStreamReadResult<Uint8Array>
    try {
      chunk = await reader.read()
    } catch {
      throw new Error(`Could not fetch the ${kind} URL. Make sure it is publicly reachable.`)
    }
    if (chunk.done) break
    total += chunk.value.byteLength
    if (total > maxBytes) {
      void reader.cancel()
      throw new Error(`The ${kind} is over the ${(maxBytes / 1024 / 1024).toFixed(0)} MB limit.`)
    }
    chunks.push(chunk.value)
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

export async function uploadMediaFromUrl(args: {
  url: string
  kind: BroadcastMediaKind
  phoneNumberId: string
  accessToken: string
}): Promise<{ id: string }> {
  const { url, kind, phoneNumberId, accessToken } = args
  const spec = SPECS[kind]

  // SSRF guard: the URL can be caller-supplied and is fetched from the
  // server, so refuse anything that resolves to a private/loopback/
  // link-local address (same guard as template-header-handle.ts).
  if (!(await isDeliverableUrl(url))) {
    throw new Error(`Could not fetch the ${kind} URL. Make sure it is publicly reachable.`)
  }

  let res: Response
  try {
    res = await fetch(url, {
      // Never follow redirects: a public URL could 3xx-bounce to an
      // internal address and defeat the guard above.
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
  } catch {
    throw new Error(`Could not fetch the ${kind} URL. Make sure it is publicly reachable.`)
  }
  if (!res.ok) {
    throw new Error(`The ${kind} URL returned ${res.status}. It must be publicly reachable.`)
  }

  const contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  if (contentType && !spec.allowedTypes.includes(contentType)) {
    throw new Error(`The ${kind} must be ${spec.allowedTypes.join(' or ')} (got ${contentType}).`)
  }
  const mimeType = spec.allowedTypes.includes(contentType) ? contentType : spec.allowedTypes[0]

  const bytes = await readCapped(res, kind, spec.maxBytes)
  if (bytes.byteLength === 0) throw new Error(`The ${kind} is empty.`)

  return uploadPhoneMedia({
    phoneNumberId,
    accessToken,
    bytes,
    mimeType,
    fileName: `header.${mimeType.split('/')[1] || spec.ext}`,
  })
}
