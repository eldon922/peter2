import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadHeaderMedia } from './upload-header-media';

const fetchMock = vi.fn();
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

function reply(body: unknown, status = 200) {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

describe('uploadHeaderMedia', () => {
  it('sends a file as a form and returns the id', async () => {
    reply({ id: 'media-1' });
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    await expect(uploadHeaderMedia(file, 'image', 'failed')).resolves.toBe('media-1');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/whatsapp/media/upload');
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get('kind')).toBe('image');
  });

  it('sends a link as JSON', async () => {
    reply({ id: 'media-2' });
    await expect(uploadHeaderMedia('https://cdn/x.jpg', 'image', 'failed')).resolves.toBe(
      'media-2'
    );

    const init = fetchMock.mock.calls[0][1];
    expect(JSON.parse(init.body)).toEqual({ url: 'https://cdn/x.jpg', kind: 'image' });
  });

  it("throws the server's message, or the fallback when there is none", async () => {
    reply({ error: 'The image is empty.' }, 502);
    await expect(uploadHeaderMedia('https://cdn/x.jpg', 'image', 'failed')).rejects.toThrow(
      'The image is empty.'
    );

    reply({}, 500);
    await expect(uploadHeaderMedia('https://cdn/x.jpg', 'image', 'failed')).rejects.toThrow(
      'failed'
    );
  });
});
