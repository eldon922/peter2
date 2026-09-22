// ============================================================
// PostgREST request-size guards.
//
// Supabase queries fail on *size*, not just on row count, and they fail
// in two different places for two different reasons:
//
//   - Reads put their filters in the URL, so a big `.in(...)` blows the
//     reverse proxy's request-line/header limit. Bounded by characters.
//   - Writes put their rows in the body, so a big `.insert(...)` blows
//     PostgREST's payload cap. Bounded by rows.
//
// Both are "keep the request under the ceiling" and neither belongs to
// any one feature — broadcasts, contacts and CSV import all hit them —
// so they live here rather than in whichever module needed them first.
// ============================================================

// Contact ids are 36-char UUIDs, so a *count*-based page cap doesn't
// bound the request size: 260 of them alone join into a ~9.6KB query
// string, already past the ~8KB request-line/header limit most
// reverse proxies in front of PostgREST (nginx, Kong) enforce by
// default — the browser reports that as a generic "TypeError: Failed
// to fetch" with no distinguishing HTTP status. Chunk by the joined
// string length instead, well under that ceiling.
const IN_CLAUSE_MAX_CHARS = 3000;

/**
 * Split ids into chunks whose joined length stays under the URL limit,
 * for feeding `.in(column, chunk)` one request at a time.
 */
export function chunkIds(ids: string[]): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let currentLength = 0;

  for (const id of ids) {
    const addedLength = id.length + 1; // +1 for the joining comma
    if (current.length > 0 && currentLength + addedLength > IN_CLAUSE_MAX_CHARS) {
      chunks.push(current);
      current = [];
      currentLength = 0;
    }
    current.push(id);
    currentLength += addedLength;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/**
 * Rows per bulk insert (`broadcast_recipients`, and CSV-imported
 * contacts).
 *
 * A row count rather than a character count, unlike IN_CLAUSE_MAX_CHARS
 * above: insert rows ride in the body, where the ceiling is orders of
 * magnitude larger than the 8KB header limit, so precision buys nothing
 * and a count is easier to reason about at the call sites.
 *
 * Nothing to do with send pacing — a broadcast's recipient rows are all
 * written before the first message goes out.
 */
export const INSERT_BATCH_SIZE = 200;

/** Split rows into `INSERT_BATCH_SIZE` groups for chunked `.insert()`. */
export function chunkRows<T>(rows: T[]): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
    chunks.push(rows.slice(i, i + INSERT_BATCH_SIZE));
  }
  return chunks;
}

/**
 * Retry a request a few times with backoff.
 *
 * A large CSV import fires dozens to hundreds of sequential requests
 * (lookup chunks, insert chunks, per-row fallbacks, renames). Each one
 * individually is unlikely to fail, but across that many round trips a
 * single dropped connection, 429, or proxy hiccup becomes close to
 * certain — and without a retry, that one failure used to abort the
 * entire import. Retrying is safe here because every write in the
 * import path is already idempotent (phone is unique per account, and
 * a 23505 on retry is treated as "already there", not an error).
 *
 * Not a general-purpose retry: it assumes the operation is safe to
 * repeat, which is true for the requests this module chunks but not
 * true in general (e.g. non-idempotent RPCs).
 */
export async function withRetry<T>(
  fn: () => PromiseLike<T>,
  opts: { attempts?: number; baseDelayMs?: number } = {}
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  let lastErr: unknown;

  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1) break;
      await new Promise((resolve) =>
        setTimeout(resolve, baseDelayMs * 2 ** i)
      );
    }
  }
  throw lastErr;
}

// ============================================================
// Reading more rows than one response will carry.
//
// PostgREST silently truncates every response to its `max_rows`
// setting (1,000 by default on Supabase) — no error, no warning, just
// fewer rows than matched. A plain `.select()` over a large table, or a
// `.limit(N)` with N above that cap, therefore returns a *prefix* that
// looks like a complete answer. For a broadcast audience that means a
// send quietly stops at 1,000 contacts, and an "exclude" list quietly
// stops excluding after 1,000 rows.
//
// Reads that must be complete page through `.range()` instead.
// ============================================================

/**
 * Rows requested per page by `fetchAllRows`. Matches Supabase's default
 * `max_rows`, but correctness does not depend on it: the next page
 * starts at the number of rows *received*, not the number requested, so
 * a project configured with a lower cap costs extra round trips rather
 * than lost rows.
 */
export const READ_PAGE_SIZE = 1000;

interface PageResponse<T> {
  data: T[] | null;
  error: { message: string } | null;
  count?: number | null;
}

/**
 * Collect every row of a query, one `.range()` window at a time.
 *
 * `fetchPage` must build a **fresh** query on each call (supabase-js
 * builders are mutable — reusing one across pages stacks the ranges)
 * and must apply a **deterministic, unique** ordering, e.g.
 * `.order('id')`. Offset paging over an unordered or tied ordering can
 * repeat or skip rows between pages.
 *
 * Stops on the first empty page, so an unbounded read costs one extra
 * round trip to confirm the end. That is deliberate: treating a short
 * page as the end would reintroduce the silent truncation this exists
 * to prevent whenever the server's row cap is below `pageSize`.
 *
 * `maxRows` bounds the result (and the last window requested), for
 * callers that want "up to N" rather than "all". `count` is whatever
 * the first page reported for `{ count: 'exact' }`, else null.
 *
 * Errors are returned rather than thrown so each caller keeps its own
 * error handling; `rows` then holds whatever was read before the failure
 * and must not be treated as complete.
 */
export async function fetchAllRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResponse<T>>,
  opts: { pageSize?: number; maxRows?: number } = {}
): Promise<{
  rows: T[];
  count: number | null;
  error: { message: string } | null;
}> {
  const pageSize = opts.pageSize ?? READ_PAGE_SIZE;
  const maxRows = opts.maxRows ?? Number.POSITIVE_INFINITY;
  const rows: T[] = [];
  let count: number | null = null;

  while (rows.length < maxRows) {
    const from = rows.length;
    const to = Math.min(from + pageSize, maxRows) - 1;
    const { data, error, count: pageCount } = await fetchPage(from, to);
    if (error) return { rows, count, error };
    if (count === null && typeof pageCount === 'number') count = pageCount;
    if (!data || data.length === 0) break;
    rows.push(...data);
  }

  return {
    rows: rows.length > maxRows ? rows.slice(0, maxRows) : rows,
    count,
    error: null,
  };
}
