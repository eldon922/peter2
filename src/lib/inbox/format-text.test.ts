import { describe, expect, it } from 'vitest';

import { parseFormatting } from './format-text';

describe('parseFormatting', () => {
  it('formats bold, italic, strike and inline code', () => {
    expect(parseFormatting('a *b* _c_ ~d~ `e`')).toEqual([
      'a ',
      { type: 'bold', children: ['b'] },
      ' ',
      { type: 'italic', children: ['c'] },
      ' ',
      { type: 'strike', children: ['d'] },
      ' ',
      { type: 'code', children: ['e'] },
    ]);
  });

  it('nests formats', () => {
    expect(parseFormatting('*bold _and italic_*')).toEqual([
      {
        type: 'bold',
        children: ['bold ', { type: 'italic', children: ['and italic'] }],
      },
    ]);
  });

  it('leaves unmatched or spaced markers alone', () => {
    expect(parseFormatting('2 * 3 * 4')).toEqual(['2 * 3 * 4']);
    expect(parseFormatting('*open only')).toEqual(['*open only']);
    expect(parseFormatting('snake_case_name')).toEqual(['snake_case_name']);
  });

  it('does not format across lines', () => {
    expect(parseFormatting('*a\nb*')).toEqual(['*a\nb*']);
  });

  it('renders code blocks verbatim', () => {
    expect(parseFormatting('x\n```*not bold*```\ny')).toEqual([
      'x\n',
      { type: 'codeblock', text: '*not bold*' },
      '\ny',
    ]);
  });

  it('turns urls into links without reading markers inside them', () => {
    expect(parseFormatting('see https://x.com/a_b_c/d, ok')).toEqual([
      'see ',
      { type: 'link', url: 'https://x.com/a_b_c/d' },
      ', ok',
    ]);
  });

  it('keeps links inside formatting', () => {
    expect(parseFormatting('*go https://x.com now*')).toEqual([
      {
        type: 'bold',
        children: ['go ', { type: 'link', url: 'https://x.com' }, ' now'],
      },
    ]);
  });

  it('leaves urls in code as plain text', () => {
    expect(parseFormatting('`https://x.com`')).toEqual([
      { type: 'code', children: ['https://x.com'] },
    ]);
  });
});
