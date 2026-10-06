import { describe, expect, it } from 'vitest';
import { checkMediaFile, isHeaderMediaKind, isMediaKind, MEDIA_SPECS } from './media-specs';

describe('MEDIA_SPECS', () => {
  it("caps images at Meta's tighter 5 MB limit", () => {
    expect(MEDIA_SPECS.image.maxBytes).toBe(5 * 1024 * 1024);
  });

  it('caps video/audio/document at 16 MB', () => {
    expect(MEDIA_SPECS.video.maxBytes).toBe(16 * 1024 * 1024);
    expect(MEDIA_SPECS.audio.maxBytes).toBe(16 * 1024 * 1024);
    expect(MEDIA_SPECS.document.maxBytes).toBe(16 * 1024 * 1024);
  });
});

describe('kind guards', () => {
  it('only accepts the real kinds', () => {
    expect(isMediaKind('audio')).toBe(true);
    expect(isMediaKind('toString')).toBe(false);
    expect(isHeaderMediaKind('audio')).toBe(false);
    expect(isHeaderMediaKind('document')).toBe(true);
  });
});

describe('checkMediaFile', () => {
  it('accepts a valid file', () => {
    expect(checkMediaFile('image', { type: 'image/png', size: 1024 })).toBeNull();
  });

  it('flags a wrong type', () => {
    expect(checkMediaFile('image', { type: 'image/webp', size: 1024 })).toEqual({
      problem: 'type',
      types: 'image/jpeg, image/png',
    });
  });

  it('flags a file over the limit', () => {
    expect(
      checkMediaFile('image', { type: 'image/jpeg', size: 6 * 1024 * 1024 })
    ).toEqual({ problem: 'size', size: '6.0', limit: '5' });
  });
});
