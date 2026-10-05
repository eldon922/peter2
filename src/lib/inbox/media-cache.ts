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
  const cache = storage ? await storage.open(CACHE_NAME).catch(() => null) : null;

  const hit = await cache?.match(url).catch(() => undefined);
  if (hit) blob = await hit.blob();

  if (!blob) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to load media');
    if (cache) void remember(cache, url, res.clone()).catch(() => {});
    blob = await res.blob();
  }
  return URL.createObjectURL(blob);
}

/** Object URL for an auth-protected media URL, fetched at most once. */
export function getMediaObjectUrl(url: string): Promise<string> {
  let pending = objectUrls.get(url);
  if (!pending) {
    pending = load(url);
    objectUrls.set(url, pending);
    pending.then((u) => resolved.set(url, u)).catch(() => {});
    // Don't cache failures — a retry on next mount should refetch.
    pending.catch(() => objectUrls.delete(url));
  }
  return pending;
}

/** The object URL if it's already loaded, so a remount can skip the spinner. */
export function peekMediaObjectUrl(url: string): string | undefined {
  return resolved.get(url);
}

export function clearMediaCache() {
  for (const pending of objectUrls.values()) {
    pending.then((u) => URL.revokeObjectURL(u)).catch(() => {});
  }
  objectUrls.clear();
  resolved.clear();
  void cacheStorage()?.delete(CACHE_NAME);
}
