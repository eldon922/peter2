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

  let res: Response;
  try {
    res = await fetch('/api/whatsapp/media/upload', init);
  } catch (cause) {
    throw new Error(
      `${fallbackError} Could not reach the app server. Check your connection and try again.`,
      { cause }
    );
  }
  const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
  if (!res.ok || !data.id) {
    throw new Error(
      data.error || (res.ok ? fallbackError : `${fallbackError} (HTTP ${res.status})`)
    );
  }
  return data.id;
}
