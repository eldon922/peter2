// ============================================================
// Browser-side cache for inbox media.
//
// Media behind /api/whatsapp/media/<id> needs the signed-in session, so
// it can't be a plain <img src>. It's fetched once, kept in the Cache
// Storage API (survives reloads, content never changes for a given id)
// and handed out as object URLs that are shared across every mount.
// Cleared on sign-out so the next person on this browser can't see it.
// ============================================================

const CACHE_NAME = 'peter2-media-v1';
const MAX_ENTRIES = 300;

const objectUrls = new Map<string, Promise<string>>();
const resolved = new Map<string, string>();
const users = new Map<string, number>();
const removed = new Set<string>();

function cacheStorage(): CacheStorage | null {
  return typeof caches === 'undefined' ? null : caches;
}

async function remember(cache: Cache, url: string, response: Response) {
  await cache.put(url, response);
  const keys = await cache.keys();
  // keys() is in insertion order, so the front is the oldest.
  for (const old of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) {
    await cache.delete(old);
  }
}

async function load(url: string): Promise<string> {
  let blob: Blob | null = null;
  const storage = cacheStorage();
  const cache = storage
    ? await storage.open(CACHE_NAME).catch(() => null)
    : null;

  const hit = await cache?.match(url).catch(() => undefined);
  if (hit) blob = await hit.blob();

  if (!blob) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to load media');
    if (cache) await remember(cache, url, res.clone()).catch(() => {});
    blob = await res.blob();
  }
  return URL.createObjectURL(blob);
}

/** Acquire an object URL; release it when the image unmounts. */
export function getMediaObjectUrl(url: string): Promise<string> {
  users.set(url, (users.get(url) ?? 0) + 1);
  let pending = objectUrls.get(url);
  if (!pending) {
    pending = load(url);
    objectUrls.set(url, pending);
    pending
      .then((u) => {
        if (objectUrls.get(url) === pending) resolved.set(url, u);
      })
      .catch(() => {});
    // Don't cache failures — a retry on next mount should refetch.
    pending.catch(() => objectUrls.delete(url));
  }
  return pending;
}

function revoke(url: string) {
  objectUrls
    .get(url)
    ?.then((src) => URL.revokeObjectURL(src))
    .catch(() => {});
  objectUrls.delete(url);
  resolved.delete(url);
  users.delete(url);
  removed.delete(url);
}

export function releaseMediaObjectUrl(url: string) {
  const remaining = Math.max(0, (users.get(url) ?? 0) - 1);
  users.set(url, remaining);
  if (!remaining && removed.has(url)) revoke(url);
}

export function removeCachedMedia(url: string | null | undefined) {
  if (!url) return;
  const pending = objectUrls.get(url);
  removed.add(url);
  // The same image may still be displayed by another message.
  if (!users.get(url)) revoke(url);
  void Promise.resolve(pending)
    .catch(() => {})
    .then(async () => {
      const cache = await cacheStorage()?.open(CACHE_NAME);
      await cache?.delete(url);
    })
    .catch(() => {});
}

/** The object URL if it's already loaded, so a remount can skip the spinner. */
export function peekMediaObjectUrl(url: string): string | undefined {
  return resolved.get(url);
}

export function clearMediaCache() {
  for (const url of objectUrls.keys()) revoke(url);
  void cacheStorage()?.delete(CACHE_NAME);
}
