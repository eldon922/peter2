import { uploadPhoneMedia } from '@/lib/whatsapp/meta-api'
import { isDeliverableUrl } from '@/lib/webhooks/ssrf'
import { MEDIA_SPECS, type HeaderMediaKind } from '@/lib/media-specs'

/**
 * Server-side "fetch a public URL" and "fetch it, push it to Meta's Upload
 * Media endpoint, return the reusable media id".
 *
 * Broadcasts send every media header by Meta media id (never by link) so
 * Meta doesn't re-download the file once per recipient. Where the media
 * only exists as a URL — the template's default image, a URL typed into
 * the wizard, an API-created broadcast — this turns it into an id.
 * Template creation uses the same download to build its sample handle.
 */

const FETCH_TIMEOUT_MS = 30_000
const MAX_REDIRECTS = 3
const REDIRECT_STATUSES = [301, 302, 303, 307, 308]

function unreachable(kind: HeaderMediaKind): Error {
  return new Error(`Could not fetch the ${kind} URL. Make sure it is publicly reachable.`)
}

/**
 * Fetch a public URL, following up to MAX_REDIRECTS redirects by hand.
 *
 * Every hop goes through the SSRF guard before it is requested, so a
 * public URL can't 3xx-bounce to an internal address. Redirects stay
 * manual for that reason — never `redirect: 'follow'`.
 */
async function fetchPublic(
  startUrl: string,
  kind: HeaderMediaKind,
  signal: AbortSignal,
): Promise<Response> {
  let url = startUrl
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!(await isDeliverableUrl(url))) throw unreachable(kind)

    let res: Response
    try {
      res = await fetch(url, { redirect: 'manual', signal })
    } catch {
      throw unreachable(kind)
    }

    const location = res.headers.get('location')
    if (!REDIRECT_STATUSES.includes(res.status) || !location) return res
    void res.body?.cancel()

    try {
      const next = new URL(location, url)
      if (next.protocol !== 'http:' && next.protocol !== 'https:') throw new Error()
      url = next.toString()
    } catch {
      throw unreachable(kind)
    }
  }
  throw new Error(`The ${kind} URL redirects too many times.`)
}

/** Read a body, giving up as soon as it grows past `maxBytes`. */
async function readCapped(
  res: Response,
  kind: HeaderMediaKind,
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
      throw unreachable(kind)
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

/** Download a public media URL, checked against Meta's type and size limits. */
export async function fetchPublicMedia(
  url: string,
  kind: HeaderMediaKind
): Promise<{ bytes: Uint8Array; mimeType: string; fileName: string }> {
  const spec = MEDIA_SPECS[kind]

  // SSRF guard: the URL can be caller-supplied and is fetched from the
  // server, so refuse anything that resolves to a private/loopback/
  // link-local address — on the first request and on every redirect hop.
  const res = await fetchPublic(url, kind, AbortSignal.timeout(FETCH_TIMEOUT_MS))
  if (!res.ok) {
    throw new Error(`The ${kind} URL returned ${res.status}. It must be publicly reachable.`)
  }

  const contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  if (contentType && !spec.mimeTypes.includes(contentType)) {
    throw new Error(`The ${kind} must be ${spec.mimeTypes.join(' or ')} (got ${contentType}).`)
  }
  const mimeType = spec.mimeTypes.includes(contentType) ? contentType : spec.mimeTypes[0]

  const bytes = await readCapped(res, kind, spec.maxBytes)
  if (bytes.byteLength === 0) throw new Error(`The ${kind} is empty.`)

  return { bytes, mimeType, fileName: `header.${mimeType.split('/')[1] || spec.ext}` }
}

export async function uploadMediaFromUrl(args: {
  url: string
  kind: HeaderMediaKind
  phoneNumberId: string
  accessToken: string
}): Promise<{ id: string }> {
  const { url, kind, phoneNumberId, accessToken } = args
  const { bytes, mimeType, fileName } = await fetchPublicMedia(url, kind)
  return uploadPhoneMedia({ phoneNumberId, accessToken, bytes, mimeType, fileName })
}
