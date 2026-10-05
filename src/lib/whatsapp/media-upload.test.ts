import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const uploadPhoneMedia = vi.hoisted(() => vi.fn())
vi.mock('@/lib/whatsapp/meta-api', () => ({ uploadPhoneMedia }))

const isDeliverableUrl = vi.hoisted(() => vi.fn())
vi.mock('@/lib/webhooks/ssrf', () => ({ isDeliverableUrl }))

import { uploadMediaFromUrl, isBroadcastMediaKind } from './media-upload'

const ARGS = {
  url: 'https://cdn.example.com/header.jpg',
  kind: 'image' as const,
  phoneNumberId: 'pn-1',
  accessToken: 'tok',
}

function respond(body: Uint8Array, init: { status?: number; type?: string } = {}) {
  const headers = new Headers()
  if (init.type) headers.set('content-type', init.type)
  return new Response(body as unknown as BodyInit, { status: init.status ?? 200, headers })
}

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  uploadPhoneMedia.mockReset()
  uploadPhoneMedia.mockResolvedValue({ id: 'meta-media-1' })
  isDeliverableUrl.mockReset()
  isDeliverableUrl.mockResolvedValue(true)
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('uploadMediaFromUrl', () => {
  it('fetches the URL and uploads the bytes to Meta, returning the media id', async () => {
    fetchMock.mockResolvedValue(respond(new Uint8Array([1, 2, 3]), { type: 'image/png' }))
    await expect(uploadMediaFromUrl(ARGS)).resolves.toEqual({ id: 'meta-media-1' })
    expect(uploadPhoneMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        phoneNumberId: 'pn-1',
        accessToken: 'tok',
        mimeType: 'image/png',
        fileName: 'header.png',
      })
    )
    // Redirects must not be followed (SSRF).
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'manual' })
  })

  it('refuses a private/unreachable destination before fetching anything', async () => {
    isDeliverableUrl.mockResolvedValue(false)
    await expect(uploadMediaFromUrl(ARGS)).rejects.toThrow(/publicly reachable/)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(uploadPhoneMedia).not.toHaveBeenCalled()
  })

  it('rejects a non-2xx response (including a redirect)', async () => {
    fetchMock.mockResolvedValue(respond(new Uint8Array(), { status: 302 }))
    await expect(uploadMediaFromUrl(ARGS)).rejects.toThrow(/returned 302/)
    expect(uploadPhoneMedia).not.toHaveBeenCalled()
  })

  it('rejects the wrong content type for the header kind', async () => {
    fetchMock.mockResolvedValue(respond(new Uint8Array([1]), { type: 'image/webp' }))
    await expect(uploadMediaFromUrl(ARGS)).rejects.toThrow(/image\/webp/)
    expect(uploadPhoneMedia).not.toHaveBeenCalled()
  })

  it('rejects an empty body and an oversized one', async () => {
    fetchMock.mockResolvedValueOnce(respond(new Uint8Array(), { type: 'image/jpeg' }))
    await expect(uploadMediaFromUrl(ARGS)).rejects.toThrow(/empty/)

    fetchMock.mockResolvedValueOnce(
      respond(new Uint8Array(5 * 1024 * 1024 + 1), { type: 'image/jpeg' })
    )
    await expect(uploadMediaFromUrl(ARGS)).rejects.toThrow(/5 MB limit/)
    expect(uploadPhoneMedia).not.toHaveBeenCalled()
  })

  it('stops reading a download as soon as it passes the size limit', async () => {
    let pulls = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1
        controller.enqueue(new Uint8Array(1024 * 1024))
        if (pulls >= 50) controller.close()
      },
    })
    fetchMock.mockResolvedValue(
      new Response(stream, { status: 200, headers: { 'content-type': 'image/jpeg' } })
    )
    await expect(uploadMediaFromUrl(ARGS)).rejects.toThrow(/5 MB limit/)
    expect(pulls).toBeLessThan(10)
    expect(uploadPhoneMedia).not.toHaveBeenCalled()
  })

  it('falls back to the first allowed type when the server sends no content-type', async () => {
    fetchMock.mockResolvedValue(respond(new Uint8Array([1])))
    await uploadMediaFromUrl({ ...ARGS, kind: 'document' })
    expect(uploadPhoneMedia).toHaveBeenCalledWith(
      expect.objectContaining({ mimeType: 'application/pdf', fileName: 'header.pdf' })
    )
  })

  it('turns a network failure into a reachability error', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'))
    await expect(uploadMediaFromUrl(ARGS)).rejects.toThrow(/publicly reachable/)
  })
})

describe('isBroadcastMediaKind', () => {
  it('accepts only media header kinds', () => {
    expect(['image', 'video', 'document'].every(isBroadcastMediaKind)).toBe(true)
    expect(isBroadcastMediaKind('text')).toBe(false)
    expect(isBroadcastMediaKind(undefined)).toBe(false)
  })
})
