import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { META_API_BASE, uploadPhoneMedia } from './meta-api';

const args = {
  phoneNumberId: 'phone-1',
  accessToken: 'test-token',
  bytes: new Uint8Array([1, 2, 3]),
  mimeType: 'image/png',
  fileName: 'header.png',
};
const fetchMock = vi.fn();

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('uploadPhoneMedia', () => {
  it('recovers a dropped connection and sends the complete file again', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(response({ id: 'media-1' }));

    const result = expect(uploadPhoneMedia(args)).resolves.toEqual({ id: 'media-1' });
    await vi.runAllTimersAsync();
    await result;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetchMock.mock.calls) {
      expect(url).toBe(`${META_API_BASE}/phone-1/media`);
      expect(init.headers).toEqual({ Authorization: 'Bearer test-token' });
      expect(init.body.get('messaging_product')).toBe('whatsapp');
      const file = init.body.get('file') as File;
      expect(file.name).toBe('header.png');
      expect(file.type).toBe('image/png');
      expect(new Uint8Array(await file.arrayBuffer())).toEqual(args.bytes);
    }
  });

  it('retries a connection interrupted while reading the upload result', async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.error(new TypeError('terminated'));
      },
    });
    fetchMock
      .mockResolvedValueOnce(new Response(body))
      .mockResolvedValueOnce(response({ id: 'media-2' }));

    const result = expect(uploadPhoneMedia(args)).resolves.toEqual({ id: 'media-2' });
    await vi.runAllTimersAsync();
    await result;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('stops after three connection failures and preserves the cause for server logs', async () => {
    const cause = new TypeError('fetch failed', {
      cause: Object.assign(new Error('Network unreachable'), { code: 'ENETUNREACH' }),
    });
    fetchMock.mockRejectedValue(cause);
    const result = uploadPhoneMedia(args).catch((error: Error) => error);
    await vi.runAllTimersAsync();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(await result).toMatchObject({
      message: expect.stringContaining('app server connection to graph.facebook.com'),
      cause,
    });
  });

  it('shares one deadline across retries and stops once it expires', async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    fetchMock
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockImplementationOnce(async () => {
        controller.abort(new DOMException('Upload timed out', 'TimeoutError'));
        throw controller.signal.reason;
      });

    const result = expect(uploadPhoneMedia(args)).rejects.toThrow('upload to WhatsApp timed out');
    await vi.runAllTimersAsync();
    await result;

    expect(timeout).toHaveBeenCalledExactlyOnceWith(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(([, init]) => init.signal === controller.signal)).toBe(true);
  });

  it.each([400, 401, 429, 500])('preserves Meta errors without re-uploading after HTTP %i', async (status) => {
    fetchMock.mockResolvedValue(response({ error: { code: 190, message: 'Meta rejected this upload' } }, status));
    await expect(uploadPhoneMedia(args)).rejects.toThrow('(#190) Meta rejected this upload');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a malformed response without retrying', async () => {
    fetchMock.mockResolvedValue(new Response('<html>Invalid response</html>'));
    await expect(uploadPhoneMedia(args)).rejects.toThrow('invalid media upload response');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([{}, null])('rejects a successful response without a media id: %j', async (body) => {
    fetchMock.mockResolvedValue(response(body));
    await expect(uploadPhoneMedia(args)).rejects.toThrow('Meta did not return a media id');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
