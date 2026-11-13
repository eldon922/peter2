import { expect, it } from 'vitest';
import { toggleFormat } from './formatting';
it.each(['*', '_', '~', '```'])(
  'toggles %s without accumulating markers',
  (marker) => {
    const first = toggleFormat('Hello world!', 6, 11, marker);
    expect(first.text).toBe(`Hello ${marker}world${marker}!`);
    expect(toggleFormat(first.text, first.start, first.end, marker)).toEqual({
      text: 'Hello world!',
      start: 6,
      end: 11,
    });
  }
);
it('removes markers included in the selection and preserves surrounding text', () => {
  expect(toggleFormat('Hi *world*!', 3, 10, '*')).toEqual({
    text: 'Hi world!',
    start: 3,
    end: 8,
  });
});
it('preserves other formatting when toggling one style', () => {
  expect(toggleFormat('*_world_*', 1, 8, '*').text).toBe('_world_');
});
it.each(['bullet', 'numbered', 'quote'])(
  'toggles selected lines as %s',
  (marker) => {
    const first = toggleFormat('one\ntwo', 0, 7, marker);
    expect(toggleFormat(first.text, first.start, first.end, marker).text).toBe(
      'one\ntwo'
    );
  }
);
it('numbers whole selected lines and preserves surrounding lines', () => {
  expect(toggleFormat('before\none\ntwo\nafter', 8, 14, 'numbered').text).toBe(
    'before\n1. one\n2. two\nafter'
  );
});

it.each(['*', '_', '~', '```'])(
  'trims selected edge whitespace for %s',
  (marker) => {
    const result = toggleFormat('hello  world \n', 5, 14, marker);
    expect(result.text).toBe(`hello  ${marker}world${marker} \n`);
    expect(
      toggleFormat(result.text, result.start, result.end, marker).text
    ).toBe('hello  world \n');
  }
);
it('does not format a whitespace-only selection', () => {
  expect(toggleFormat('  ', 0, 2, '*')).toEqual({
    text: '  ',
    start: 0,
    end: 2,
  });
});
