import { describe, expect, it } from 'vitest';

import { toDateTimeLocal } from './schedule';

describe('toDateTimeLocal', () => {
  it('writes local time in the format a datetime-local input expects', () => {
    expect(toDateTimeLocal(new Date(2026, 9, 7, 9, 5))).toBe('2026-10-07T09:05');
  });

  it('round-trips: the input value parses back to the same moment', () => {
    const picked = new Date(2026, 0, 31, 23, 59);
    expect(new Date(toDateTimeLocal(picked)).getTime()).toBe(picked.getTime());
  });
});
