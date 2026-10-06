import { isHeaderMediaKind } from '@/lib/media-specs';
import { NO_HEADER_MEDIA, type HeaderMedia } from '@/lib/broadcasts/header-media';

type HeaderSource = { header_type?: string | null; header_media_url?: string | null };

/**
 * What a template starts with in the wizard: its saved image link when it
 * has a media header (so the link tab opens pre-filled), otherwise nothing.
 */
export function defaultHeaderMedia(template: HeaderSource): HeaderMedia {
  return isHeaderMediaKind(template.header_type) && template.header_media_url
    ? { mediaId: '', url: template.header_media_url }
    : NO_HEADER_MEDIA;
}

/**
 * What switching away from `current` would throw away: variable values the
 * user typed and/or a media choice they made. The template's own default
 * image doesn't count, since picking the template put it there.
 */
export function whatChangingTemplateClears(
  current: HeaderSource | null,
  variables: Record<string, { value: string }>,
  media: HeaderMedia
): 'both' | 'variables' | 'image' | null {
  const hasVariables = Object.values(variables).some((v) => v.value.trim() !== '');
  const defaultUrl = current ? defaultHeaderMedia(current).url : '';
  const hasMedia = media.mediaId !== '' || (media.url !== '' && media.url !== defaultUrl);
  if (hasVariables && hasMedia) return 'both';
  if (hasVariables) return 'variables';
  return hasMedia ? 'image' : null;
}
