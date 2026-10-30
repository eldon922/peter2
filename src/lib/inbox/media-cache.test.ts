import { afterEach, expect, it, vi } from 'vitest';
import {
  clearMediaCache,
  getMediaObjectUrl,
  peekMediaObjectUrl,
  releaseMediaObjectUrl,
  removeCachedMedia,
} from './media-cache';

afterEach(() => {
  clearMediaCache();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('keeps unrelated and shared mounted images alive when a message is deleted', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('image'))
  );
  const revoke = vi.spyOn(URL, 'revokeObjectURL');
  const first = await getMediaObjectUrl('/first');
  const shared = await getMediaObjectUrl('/shared');
  await getMediaObjectUrl('/shared');
  removeCachedMedia('/shared');
  releaseMediaObjectUrl('/shared');
  expect(peekMediaObjectUrl('/first')).toBe(first);
  expect(peekMediaObjectUrl('/shared')).toBe(shared);
  expect(revoke).not.toHaveBeenCalled();
  releaseMediaObjectUrl('/shared');
  await Promise.resolve();
  expect(revoke).toHaveBeenCalledWith(shared);
  expect(revoke).not.toHaveBeenCalledWith(first);
  expect(peekMediaObjectUrl('/shared')).toBeUndefined();
});
