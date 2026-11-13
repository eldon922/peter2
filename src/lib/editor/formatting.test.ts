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
