import { beforeEach, describe, expect, it, vi } from 'vitest'

const uploadMediaFromUrl = vi.hoisted(() => vi.fn())
const uploadPhoneMedia = vi.hoisted(() => vi.fn())

vi.mock('@/lib/whatsapp/media-upload', () => ({ uploadMediaFromUrl }))
vi.mock('@/lib/whatsapp/meta-api', () => ({ uploadPhoneMedia }))
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (v: string) => `dec:${v}` }))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: vi.fn(),
  RATE_LIMITS: { broadcast: {} },
}))

let hasConfig = true
vi.mock('@/lib/auth/account', () => ({
  toErrorResponse: () => new Response(null, { status: 500 }),
  requireRole: async () => ({
    userId: 'u1',
    accountId: 'acc',
    supabase: {
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () =>
              hasConfig
                ? { data: { phone_number_id: 'pn-1', access_token: 'enc' }, error: null }
                : { data: null, error: { message: 'none' } },
          }),
        }),
      }),
    },
  }),
}))

import { POST } from './route'

function jsonRequest(body: unknown) {
  return new Request('http://x/api/whatsapp/media/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function fileRequest(file: File, kind: string) {
  const form = new FormData()
  form.append('file', file)
  form.append('kind', kind)
  return new Request('http://x/api/whatsapp/media/upload', { method: 'POST', body: form })
}

beforeEach(() => {
  hasConfig = true
  uploadMediaFromUrl.mockReset()
  uploadMediaFromUrl.mockResolvedValue({ id: 'link-media' })
  uploadPhoneMedia.mockReset()
  uploadPhoneMedia.mockResolvedValue({ id: 'file-media' })
})

describe('POST /api/whatsapp/media/upload with a link', () => {
  it('downloads the link and returns the Meta media id', async () => {
    const res = await POST(jsonRequest({ url: 'https://cdn/x.jpg', kind: 'image' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 'link-media', kind: 'image' })
    expect(uploadMediaFromUrl).toHaveBeenCalledWith({
      url: 'https://cdn/x.jpg',
      kind: 'image',
      phoneNumberId: 'pn-1',
      accessToken: 'dec:enc',
    })
  })

  it('rejects a link that is not http(s), and audio', async () => {
    expect((await POST(jsonRequest({ url: 'javascript:alert(1)', kind: 'image' }))).status).toBe(400)
    expect((await POST(jsonRequest({ url: 'https://cdn/x.mp3', kind: 'audio' }))).status).toBe(400)
    expect(uploadMediaFromUrl).not.toHaveBeenCalled()
  })

  it('reports a download failure as 502 with the reason', async () => {
    uploadMediaFromUrl.mockRejectedValue(new Error('The image is empty.'))
    const res = await POST(jsonRequest({ url: 'https://cdn/x.jpg', kind: 'image' }))
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'The image is empty.' })
  })

  it('needs WhatsApp to be configured', async () => {
    hasConfig = false
    const res = await POST(jsonRequest({ url: 'https://cdn/x.jpg', kind: 'image' }))
    expect(res.status).toBe(400)
    expect(uploadMediaFromUrl).not.toHaveBeenCalled()
  })
})

describe('POST /api/whatsapp/media/upload with a file', () => {
  it('uploads a valid file', async () => {
    const res = await POST(fileRequest(new File(['x'], 'a.png', { type: 'image/png' }), 'image'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ id: 'file-media', kind: 'image' })
    expect(uploadPhoneMedia).toHaveBeenCalledWith(
      expect.objectContaining({ phoneNumberId: 'pn-1', mimeType: 'image/png', fileName: 'a.png' })
    )
  })

  it('rejects a wrong type and an unknown kind', async () => {
    const webp = new File(['x'], 'a.webp', { type: 'image/webp' })
    expect((await POST(fileRequest(webp, 'image'))).status).toBe(400)
    expect((await POST(fileRequest(webp, 'sticker'))).status).toBe(400)
    expect(uploadPhoneMedia).not.toHaveBeenCalled()
  })
})
