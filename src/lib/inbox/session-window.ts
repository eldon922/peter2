import { differenceInHours } from 'date-fns';

/**
 * The WhatsApp customer-service window.
 *
 * Meta only allows free-form replies within 24 hours of the customer's
 * last inbound message. Outside it, the only way to reach them is an
 * approved template — so "how long have I got" is the single most
 * decision-relevant fact about an open thread, and it belongs in the
 * conversation list, not just inside the thread you already opened.
 *
 * The clock runs from the customer's last message, never from
 * `conversations.last_message_at`: that column moves on outbound sends
 * too, so using it would show a fresh 24 hours on a thread whose window
 * had actually closed — the one error that matters, because it invites a
 * reply Meta will reject.
 */
export const SESSION_WINDOW_HOURS = 24;

export interface SessionWindow {
  /** No reply is possible without a template. */
  expired: boolean;
  /** Whole hours left, floored. Zero once under an hour remains. */
  hoursLeft: number;
  /** Whole minutes left, floored. Only meaningful under an hour. */
  minutesLeft: number;
}

const EXPIRED: SessionWindow = { expired: true, hoursLeft: 0, minutesLeft: 0 };

/**
 * How much of the window is left, given when the customer last wrote.
 *
 * `null` — no inbound message on record — is expired, not "unknown":
 * a thread nobody has written into has no open window, and treating the
 * absence as time remaining would be the wrong way to be wrong.
 *
 * Uses whole-hour arithmetic to match the thread header's timer, so the
 * list and the open conversation never disagree by a rounding step.
 */
export function sessionWindow(
  lastCustomerMessageAt: string | Date | null | undefined,
  now: Date = new Date()
): SessionWindow {
  if (!lastCustomerMessageAt) return EXPIRED;

  const last =
    lastCustomerMessageAt instanceof Date
      ? lastCustomerMessageAt
      : new Date(lastCustomerMessageAt);
  if (Number.isNaN(last.getTime())) return EXPIRED;

  const hoursSince = differenceInHours(now, last);
  if (hoursSince >= SESSION_WINDOW_HOURS) return EXPIRED;

  const hoursLeft = SESSION_WINDOW_HOURS - hoursSince;
  return {
    expired: false,
    hoursLeft: Math.floor(hoursLeft),
    minutesLeft: Math.floor(hoursLeft * 60),
  };
}
