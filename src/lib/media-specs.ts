// What Meta accepts for uploaded media. One list, used by the browser
// checks and by the server, so they can't drift apart.

export type MediaKind = 'image' | 'video' | 'document' | 'audio';
export type HeaderMediaKind = 'image' | 'video' | 'document';

const MB = 1024 * 1024;

export const MEDIA_SPECS: Record<
  MediaKind,
  { mimeTypes: string[]; maxBytes: number; ext: string }
> = {
  image: { mimeTypes: ['image/jpeg', 'image/png'], maxBytes: 5 * MB, ext: 'jpg' },
  video: { mimeTypes: ['video/mp4', 'video/3gpp'], maxBytes: 16 * MB, ext: 'mp4' },
  document: { mimeTypes: ['application/pdf'], maxBytes: 16 * MB, ext: 'pdf' },
  audio: {
    mimeTypes: ['audio/aac', 'audio/mp4', 'audio/mpeg', 'audio/amr', 'audio/ogg'],
    maxBytes: 16 * MB,
    ext: 'ogg',
  },
};

export function isMediaKind(value: unknown): value is MediaKind {
  return value === 'audio' || isHeaderMediaKind(value);
}

export function isHeaderMediaKind(value: unknown): value is HeaderMediaKind {
  return value === 'image' || value === 'video' || value === 'document';
}

export type MediaFileProblem =
  | { problem: 'type'; types: string }
  | { problem: 'size'; size: string; limit: string };

/** Null when the file is fine, otherwise what is wrong with it. */
export function checkMediaFile(
  kind: MediaKind,
  file: { type: string; size: number }
): MediaFileProblem | null {
  const { mimeTypes, maxBytes } = MEDIA_SPECS[kind];
  if (!mimeTypes.includes(file.type)) {
    return { problem: 'type', types: mimeTypes.join(', ') };
  }
  if (file.size > maxBytes) {
    return {
      problem: 'size',
      size: (file.size / MB).toFixed(1),
      limit: (maxBytes / MB).toFixed(0),
    };
  }
  return null;
}
