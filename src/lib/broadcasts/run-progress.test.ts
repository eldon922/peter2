import { expect, it } from 'vitest';
import { broadcastRunProgress } from './run-progress';

it('tracks only the retry slice and preserves it after reloading the row', () => {
  const row = { total_recipients: 1000, sent_count: 980, failed_count: 0, send_run_total: 20, send_run_baseline: 980 };
  expect(broadcastRunProgress(row)).toEqual({ total: 20, done: 0, percent: 0 });
  const refreshed = JSON.parse(JSON.stringify({ ...row, sent_count: 986, failed_count: 4 }));
  expect(broadcastRunProgress(refreshed)).toEqual({ total: 20, done: 10, percent: 50 });
});
it('handles first sends, old rows and completed runs', () => {
  expect(broadcastRunProgress({ total_recipients: 10, sent_count: 4, failed_count: 1 })).toEqual({ total: 10, done: 5, percent: 50 });
  expect(broadcastRunProgress({ total_recipients: 10, sent_count: 10, failed_count: 0, send_run_total: 2, send_run_baseline: 8 }).percent).toBe(100);
});
