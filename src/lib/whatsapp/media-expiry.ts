/**
 * Meta's Upload Media endpoint (POST /{phone-number-id}/media) keeps a
 * file for 30 days, then the returned media id stops working — unless
 * the number uses No Storage with a custom TTL, which this app does
 * not configure.
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/media
 *
 * We treat an id as expired one day early so a retry never races the
 * real deadline.
 */
const DAY_MS = 24 * 60 * 60 * 1000
export const META_MEDIA_TTL_MS = 30 * DAY_MS
export const META_MEDIA_SAFETY_MARGIN_MS = 1 * DAY_MS

/**
 * True when a media id uploaded at `uploadedAt` should no longer be
 * sent. An unknown or unparseable time returns false: we can't prove
 * it's stale, so we don't block the send on a guess.
 */
export function isMetaMediaIdExpired(
  uploadedAt: string | Date | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!uploadedAt) return false
  const t = uploadedAt instanceof Date ? uploadedAt.getTime() : Date.parse(uploadedAt)
  if (Number.isNaN(t)) return false
  return now - t >= META_MEDIA_TTL_MS - META_MEDIA_SAFETY_MARGIN_MS
}
