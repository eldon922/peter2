import type { Broadcast } from '@/types';

export function broadcastRunProgress(
  broadcast: Pick<
    Broadcast,
    | 'total_recipients'
    | 'sent_count'
    | 'failed_count'
    | 'send_run_total'
    | 'send_run_baseline'
    | 'send_run_pending'
  >
) {
  const total = broadcast.send_run_total ?? broadcast.total_recipients;
  const done = Math.min(
    total,
    Math.max(
      0,
      broadcast.send_run_pending != null
        ? total - broadcast.send_run_pending
        : broadcast.sent_count +
            broadcast.failed_count -
            (broadcast.send_run_baseline ?? 0)
    )
  );
  return {
    total,
    done,
    percent: total > 0 ? Math.round((done / total) * 100) : 0,
  };
}
