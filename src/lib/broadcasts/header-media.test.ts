import { describe, expect, it } from 'vitest';
import { headerMediaError } from './header-media';

describe('headerMediaError', () => {
  it('is fine with an uploaded id', () => {
    expect(headerMediaError({ mediaId: 'm1', url: '' })).toBeNull();
  });

  it('is fine with a valid link', () => {
    expect(headerMediaError({ mediaId: '', url: ' https://cdn/x.jpg ' })).toBeNull();
  });

  it('asks for something when both are empty', () => {
    expect(headerMediaError({ mediaId: '', url: '  ' })).toBe('missing');
  });

  it('rejects a link that is not http(s)', () => {
    expect(headerMediaError({ mediaId: '', url: 'javascript:alert(1)' })).toBe('invalid');
    expect(headerMediaError({ mediaId: '', url: 'not a url' })).toBe('invalid');
  });
});
