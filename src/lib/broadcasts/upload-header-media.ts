import type { HeaderMediaKind } from '@/lib/media-specs';

/**
 * Get a Meta media id for a header image/video/document: from a picked
 * file, or from a public link the server downloads. Throws a message
 * fit to show the user.
 */
export async function uploadHeaderMedia(
  source: File | string,
  kind: HeaderMediaKind,
  fallbackError: string
): Promise<string> {
  let init: RequestInit;
  if (typeof source === 'string') {
    init = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: source, kind }),
    };
  } else {
    const form = new FormData();
    form.append('file', source);
    form.append('kind', kind);
    init = { method: 'POST', body: form };
  }

  const res = await fetch('/api/whatsapp/media/upload', init);
  const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
  if (!res.ok || !data.id) throw new Error(data.error || fallbackError);
  return data.id;
}
