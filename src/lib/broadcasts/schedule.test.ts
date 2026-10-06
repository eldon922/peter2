import { describe, expect, it } from 'vitest';

import { missedItsTime, toDateTimeLocal } from './schedule';

describe('toDateTimeLocal', () => {
  it('writes local time in the format a datetime-local input expects', () => {
    expect(toDateTimeLocal(new Date(2026, 9, 7, 9, 5))).toBe('2026-10-07T09:05');
  });

  it('round-trips: the input value parses back to the same moment', () => {
    const picked = new Date(2026, 0, 31, 23, 59);
    expect(new Date(toDateTimeLocal(picked)).getTime()).toBe(picked.getTime());
  });
});

describe('missedItsTime', () => {
  const at = (iso: string) => ({ scheduled_at: iso });

  it('is true for a draft whose time passed before it was moved to draft', () => {
    expect(
      missedItsTime({
        status: 'draft',
        ...at('2026-10-07T09:00:00Z'),
        updated_at: '2026-10-07T10:01:00Z',
      })
    ).toBe(true);
  });

  it('is false for a draft whose time is still ahead', () => {
    expect(
      missedItsTime({
        status: 'draft',
        ...at('2026-10-08T09:00:00Z'),
        updated_at: '2026-10-07T10:01:00Z',
      })
    ).toBe(false);
  });

  it('is false for a scheduled broadcast, whatever its time', () => {
    for (const time of ['2026-10-07T09:00:00Z', '2026-10-08T09:00:00Z']) {
      expect(
        missedItsTime({
          status: 'scheduled',
          ...at(time),
          updated_at: '2026-10-07T10:01:00Z',
        })
      ).toBe(false);
    }
  });

  it('is false for a plain draft or a cancelled schedule (no time)', () => {
    expect(
      missedItsTime({ status: 'draft', scheduled_at: null, updated_at: '2026-10-07T10:01:00Z' })
    ).toBe(false);
    expect(missedItsTime({ status: 'draft', updated_at: '2026-10-07T10:01:00Z' })).toBe(false);
  });
});
