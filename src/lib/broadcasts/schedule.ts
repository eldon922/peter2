import { format } from 'date-fns';

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
