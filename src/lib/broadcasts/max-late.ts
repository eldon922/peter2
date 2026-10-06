const DEFAULT_HOURS = 1;

/**
 * How long after its time a scheduled broadcast may still be started
 * (`BROADCAST_MAX_LATE_HOURS`, default 1). Anything later is not sent.
 */
export function maxLateMs(raw = process.env.BROADCAST_MAX_LATE_HOURS): number {
  const hours = Number(raw);
  return (Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_HOURS) * 3_600_000;
}
