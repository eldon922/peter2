import { describe, expect, it } from 'vitest';

import { chunkIds, fetchAllRows, READ_PAGE_SIZE, withRetry } from './batching';

// A stand-in for PostgREST: serves `.range(from, to)` windows over a
// table, but — like the real thing — never returns more than `maxRows`
// per response, regardless of how much was asked for.
function fakeTable(total: number, serverMaxRows: number) {
  const requests: [number, number][] = [];
  const all = Array.from({ length: total }, (_, i) => ({ id: i }));
  const fetchPage = async (from: number, to: number) => {
    requests.push([from, to]);
    const window = all.slice(from, to + 1).slice(0, serverMaxRows);
    return { data: window, error: null, count: total };
  };
  return { fetchPage, requests };
}

describe('fetchAllRows', () => {
  it('returns every row when the table is larger than the server row cap', async () => {
    const { fetchPage } = fakeTable(4321, 1000);

    const { rows, error } = await fetchAllRows(fetchPage);

    expect(error).toBeNull();
    expect(rows).toHaveLength(4321);
    expect(rows.map((r) => r.id)).toEqual(Array.from({ length: 4321 }, (_, i) => i));
  });

  it('is not fooled by a server cap below the page size', async () => {
    // A project with max_rows = 300 answers a 1,000-row window with 300.
    // Treating that short page as "the end" would drop the rest.
    const { fetchPage } = fakeTable(1000, 300);

    const { rows } = await fetchAllRows(fetchPage);

    expect(rows).toHaveLength(1000);
  });

  it('handles an exact multiple of the page size', async () => {
    const { fetchPage } = fakeTable(READ_PAGE_SIZE * 2, 1000);

    const { rows } = await fetchAllRows(fetchPage);

    expect(rows).toHaveLength(READ_PAGE_SIZE * 2);
  });

  it('returns an empty result for an empty table in a single request', async () => {
    const { fetchPage, requests } = fakeTable(0, 1000);

    const { rows, count } = await fetchAllRows(fetchPage);

    expect(rows).toEqual([]);
    expect(count).toBe(0);
    expect(requests).toHaveLength(1);
  });

  it('stops at maxRows without asking for more, and never over-requests', async () => {
    const { fetchPage, requests } = fakeTable(5000, 1000);

    const { rows } = await fetchAllRows(fetchPage, { maxRows: 2500 });

    expect(rows).toHaveLength(2500);
    // 1000 + 1000 + 500 — the final window is trimmed to what is left,
    // and there is no trailing "is that all?" request once the bound hit.
    expect(requests).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2499],
    ]);
  });

  it('reports the count from the first page', async () => {
    const { fetchPage } = fakeTable(2500, 1000);

    const { count } = await fetchAllRows(fetchPage, { maxRows: 1000 });

    expect(count).toBe(2500);
  });

  it('surfaces an error and the rows read so far, rather than throwing', async () => {
    let calls = 0;
    const fetchPage = async () => {
      calls += 1;
      return calls === 1
        ? { data: [{ id: 1 }], error: null }
        : { data: null, error: { message: 'boom' } };
    };

    const result = await fetchAllRows(fetchPage);

    expect(result.error).toEqual({ message: 'boom' });
    expect(result.rows).toEqual([{ id: 1 }]);
  });
});

describe('withRetry', () => {
  const fast = { baseDelayMs: 0 };

  it('retries a returned network error until it succeeds', async () => {
    let calls = 0;
    const fn = async () => {
      calls += 1;
      return calls < 3
        ? { data: null, error: { message: 'TypeError: fetch failed' }, status: 0 }
        : { data: [{ id: 1 }], error: null, status: 200 };
    };

    const result = await withRetry(fn, fast);

    expect(calls).toBe(3);
    expect(result.error).toBeNull();
  });

  it.each([429, 503])('retries a returned %i', async (status) => {
    let calls = 0;
    const fn = async () => {
      calls += 1;
      return calls < 2
        ? { data: null, error: { message: 'busy' }, status }
        : { data: [], error: null, status: 200 };
    };

    await withRetry(fn, fast);

    expect(calls).toBe(2);
  });

  it('does not retry a duplicate-key error', async () => {
    let calls = 0;
    const fn = async () => {
      calls += 1;
      return { data: null, error: { code: '23505', message: 'duplicate' }, status: 409 };
    };

    const result = await withRetry(fn, fast);

    expect(calls).toBe(1);
    expect(result.error?.code).toBe('23505');
  });

  it('returns the last error result after the final attempt', async () => {
    let calls = 0;
    const fn = async () => {
      calls += 1;
      return { data: null, error: { message: 'down' }, status: 503 };
    };

    const result = await withRetry(fn, { attempts: 3, baseDelayMs: 0 });

    expect(calls).toBe(3);
    expect(result.error).toEqual({ message: 'down' });
  });

  it('retries a thrown error and rethrows after the final attempt', async () => {
    let calls = 0;
    const fn = async () => {
      calls += 1;
      throw new Error('boom');
    };

    await expect(withRetry(fn, { attempts: 2, baseDelayMs: 0 })).rejects.toThrow('boom');
    expect(calls).toBe(2);
  });
});

describe('chunkIds', () => {
  it('keeps each chunk under a custom character limit', () => {
    const ids = Array.from({ length: 500 }, (_, i) => String(6281000000000 + i));
    const chunks = chunkIds(ids, 1500);
    expect(chunks.flat()).toEqual(ids);
    for (const c of chunks) expect(c.join(',').length).toBeLessThanOrEqual(1500);
  });
});
