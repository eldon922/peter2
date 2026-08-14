// ============================================================
// Minimal server-side logger.
//
// Why this exists
//
//   `docker logs` showed the Next.js boot banner and then nothing,
//   even while the app was serving traffic. That is not a Docker or a
//   Next.js problem — the codebase simply had no info-level logging.
//   Every diagnostic was a `console.error` / `console.warn`, so a
//   healthy deployment printed literally nothing after startup and
//   there was no way to tell a working webhook from a silent one.
//
//   This adds the missing level. Errors keep their existing call
//   sites; what's new is a deliberate, low-volume record of the things
//   an operator needs to see happening: inbound webhooks, outbound
//   sends, broadcast fan-out.
//
// Contract
//
//   * Server-only. Nothing here runs in the browser bundle.
//   * Writes to stdout (debug/info) and stderr (warn/error), which is
//     exactly what Docker's json-file driver captures. No transport,
//     no dependency, no buffering of our own.
//   * `LOG_LEVEL` gates output: debug | info | warn | error, default
//     `info`. Set it to `warn` to get the old near-silent behaviour
//     back, or `debug` when chasing something specific.
//
// Format is one line per event so `docker logs | grep` stays useful:
//   2026-08-14T09:12:33.041Z  INFO  [webhook] inbound message {"type":"text"}
// ============================================================

const LEVELS = ['debug', 'info', 'warn', 'error'] as const;

export type LogLevel = (typeof LEVELS)[number];

function resolveThreshold(): number {
  const raw = process.env.LOG_LEVEL?.trim().toLowerCase();
  const index = LEVELS.indexOf(raw as LogLevel);
  // Unset or unrecognised → `info`. An unrecognised value is worth a
  // nudge but must not be fatal: a typo in an env var should degrade to
  // the sane default, not take the server down at import time.
  return index === -1 ? LEVELS.indexOf('info') : index;
}

const threshold = resolveThreshold();

/** Structured detail appended to the line as compact JSON. */
export type LogContext = Record<string, unknown>;

function format(
  level: LogLevel,
  scope: string,
  message: string,
  context?: LogContext,
): string {
  const head = `${new Date().toISOString()}  ${level.toUpperCase().padEnd(5)} [${scope}] ${message}`;
  if (!context || Object.keys(context).length === 0) return head;
  try {
    return `${head} ${JSON.stringify(context)}`;
  } catch {
    // A context object with a circular reference must not cost us the
    // log line itself — the message is the part that matters.
    return `${head} [context not serialisable]`;
  }
}

function emit(
  level: LogLevel,
  scope: string,
  message: string,
  context?: LogContext,
): void {
  if (LEVELS.indexOf(level) < threshold) return;
  const line = format(level, scope, message, context);
  if (level === 'error' || level === 'warn') {
    process.stderr.write(`${line}\n`);
  } else {
    process.stdout.write(`${line}\n`);
  }
}

/**
 * Create a logger bound to a scope — the bracketed tag that already
 * prefixes this codebase's messages by hand (`[webhook]`,
 * `[broadcast-core]`, …). Use one per module:
 *
 *   const log = createLogger('webhook')
 *   log.info('inbound message', { type: message.type })
 */
export function createLogger(scope: string) {
  return {
    debug: (message: string, context?: LogContext) =>
      emit('debug', scope, message, context),
    info: (message: string, context?: LogContext) =>
      emit('info', scope, message, context),
    warn: (message: string, context?: LogContext) =>
      emit('warn', scope, message, context),
    error: (message: string, context?: LogContext) =>
      emit('error', scope, message, context),
  };
}

export type Logger = ReturnType<typeof createLogger>;
