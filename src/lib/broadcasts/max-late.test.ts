import { describe, expect, it } from 'vitest';
import { maxLateMs } from './max-late';

const HOUR = 3_600_000;

describe('maxLateMs', () => {
  it('defaults to one hour', () => {
    expect(maxLateMs(undefined)).toBe(HOUR);
    expect(maxLateMs('')).toBe(HOUR);
  });

  it('reads the number of hours, fractions included', () => {
    expect(maxLateMs('6')).toBe(6 * HOUR);
    expect(maxLateMs('0.5')).toBe(HOUR / 2);
  });

  it('falls back to the default for anything unusable', () => {
    for (const bad of ['abc', '0', '-2', 'Infinity']) {
      expect(maxLateMs(bad)).toBe(HOUR);
    }
  });
});
