import { describe, expect, it } from 'vitest';
import { defaultHeaderMedia, whatChangingTemplateClears } from './template-change';

const withImage = { header_type: 'image' as const, header_media_url: 'https://cdn/default.jpg' };
const textOnly = { header_type: null, header_media_url: null };
const none = { mediaId: '', url: '' };

describe('defaultHeaderMedia', () => {
  it("starts with the template's saved image link", () => {
    expect(defaultHeaderMedia(withImage)).toEqual({ mediaId: '', url: 'https://cdn/default.jpg' });
  });

  it('starts empty when there is no saved link or no media header', () => {
    expect(defaultHeaderMedia({ header_type: 'image', header_media_url: null })).toEqual(none);
    expect(defaultHeaderMedia({ header_type: 'text', header_media_url: 'https://cdn/x.jpg' })).toEqual(none);
  });
});

describe('whatChangingTemplateClears', () => {
  it('is null when nothing was entered', () => {
    expect(whatChangingTemplateClears(textOnly, {}, none)).toBeNull();
    expect(whatChangingTemplateClears(textOnly, { '1': { value: '  ' } }, none)).toBeNull();
  });

  it("ignores the template's own default image", () => {
    const media = defaultHeaderMedia(withImage);
    expect(whatChangingTemplateClears(withImage, {}, media)).toBeNull();
  });

  it('reports variable values', () => {
    expect(whatChangingTemplateClears(textOnly, { '1': { value: 'name' } }, none)).toBe('variables');
  });

  it('reports an uploaded file or a custom link', () => {
    expect(whatChangingTemplateClears(withImage, {}, { mediaId: 'm1', url: '' })).toBe('image');
    expect(whatChangingTemplateClears(withImage, {}, { mediaId: '', url: 'https://other/x.jpg' })).toBe('image');
    expect(whatChangingTemplateClears(textOnly, {}, { mediaId: '', url: 'https://other/x.jpg' })).toBe('image');
  });

  it('reports both', () => {
    expect(
      whatChangingTemplateClears(withImage, { '1': { value: 'x' } }, { mediaId: 'm1', url: '' })
    ).toBe('both');
  });
});
