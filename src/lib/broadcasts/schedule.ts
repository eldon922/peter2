import { format } from 'date-fns';
import type { Broadcast } from '@/types';

/** The local `YYYY-MM-DDTHH:mm` value an `<input type="datetime-local">` reads and writes. */
export function toDateTimeLocal(date: Date): string {
  return format(date, "yyyy-MM-dd'T'HH:mm");
}

/** A scheduled time as the viewer reads it, in their own time zone. */
export function formatScheduledAt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

/**
 * A draft that still has its time was too late to send: the cron moved it
 * to draft after that time passed. A time that is still ahead never counts.
 */
export function missedItsTime(
  broadcast: Pick<Broadcast, 'status' | 'scheduled_at' | 'updated_at'>
): boolean {
  if (broadcast.status !== 'draft') return false;
  if (!broadcast.scheduled_at || !broadcast.updated_at) return false;
  return new Date(broadcast.scheduled_at) <= new Date(broadcast.updated_at);
}
