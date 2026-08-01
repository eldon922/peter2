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
