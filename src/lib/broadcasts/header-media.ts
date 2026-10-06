import { isValidHttpUrl } from '@/lib/broadcasts/variables';

/**
 * The image/video/document chosen for a template's header: either the
 * Meta media id of an uploaded file, or a public link. Never both.
 */
export interface HeaderMedia {
  mediaId: string;
  url: string;
}

export const NO_HEADER_MEDIA: HeaderMedia = { mediaId: '', url: '' };

/** What is wrong with the choice, or null when it can be sent. */
export function headerMediaError({ mediaId, url }: HeaderMedia): 'missing' | 'invalid' | null {
  if (mediaId.trim()) return null;
  const value = url.trim();
  if (!value) return 'missing';
  return isValidHttpUrl(value) ? null : 'invalid';
}
