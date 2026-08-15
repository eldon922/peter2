import { describe, expect, it } from 'vitest';
import { sessionWindow, SESSION_WINDOW_HOURS } from './session-window';

const NOW = new Date('2026-08-15T12:00:00Z');

function hoursAgo(h: number): string {
  return new Date(NOW.getTime() - h * 3600_000).toISOString();
}

describe('sessionWindow', () => {
  it('reports the full window for a message that just arrived', () => {
    const w = sessionWindow(hoursAgo(0), NOW);
    expect(w.expired).toBe(false);
    expect(w.hoursLeft).toBe(SESSION_WINDOW_HOURS);
  });

  it('counts down in whole hours', () => {
    expect(sessionWindow(hoursAgo(1), NOW).hoursLeft).toBe(23);
    expect(sessionWindow(hoursAgo(18), NOW).hoursLeft).toBe(6);
    expect(sessionWindow(hoursAgo(23), NOW).hoursLeft).toBe(1);
  });

  it('expires exactly at the 24-hour boundary', () => {
    expect(sessionWindow(hoursAgo(23.99), NOW).expired).toBe(false);
    expect(sessionWindow(hoursAgo(24), NOW).expired).toBe(true);
    expect(sessionWindow(hoursAgo(25), NOW).expired).toBe(true);
  });

  it('falls back to minutes inside the last hour', () => {
    // differenceInHours floors, so 23h30m elapsed leaves under an hour.
    const w = sessionWindow(hoursAgo(23.5), NOW);
    expect(w.expired).toBe(false);
    expect(w.hoursLeft).toBe(1);
    expect(w.minutesLeft).toBe(60);
  });

  it('treats no inbound message as expired, not as unknown', () => {
    // A thread nobody has written into has no open window. Reporting
    // time remaining here would invite a reply Meta rejects.
    expect(sessionWindow(null, NOW).expired).toBe(true);
    expect(sessionWindow(undefined, NOW).expired).toBe(true);
  });

  it('treats an unparseable timestamp as expired', () => {
    expect(sessionWindow('not a date', NOW).expired).toBe(true);
  });

  it('accepts a Date as well as an ISO string', () => {
    const d = new Date(NOW.getTime() - 3600_000);
    expect(sessionWindow(d, NOW).hoursLeft).toBe(23);
  });

  it('does not report negative time for a future timestamp', () => {
    const w = sessionWindow(new Date(NOW.getTime() + 3600_000), NOW);
    expect(w.expired).toBe(false);
    expect(w.hoursLeft).toBeGreaterThanOrEqual(SESSION_WINDOW_HOURS);
  });
});
