// In-memory stand-in for the `api_idempotency_keys` table, for tests.
// Supports only the query shapes `idempotency.ts` uses.

import type { SupabaseClient } from '@supabase/supabase-js';

interface Row {
  account_id: string;
  key: string;
  request_hash: string;
  response_status: number | null;
  response_body: unknown;
  created_at: string;
}

export function makeIdempotencyDb() {
  const rows: Row[] = [];

  function builder() {
    let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
    let values: Record<string, unknown> = {};
    const eqs: [string, unknown][] = [];
    const lts: [string, string][] = [];

    const matching = () =>
      rows.filter(
        (r) =>
          eqs.every(([c, v]) => (r as unknown as Record<string, unknown>)[c] === v) &&
          lts.every(([c, v]) => (r as unknown as Record<string, string>)[c] < v)
      );

    const resolve = (): { data?: unknown; error: { code?: string; message: string } | null } => {
      if (op === 'insert') {
        const dup = rows.some(
          (r) => r.account_id === values.account_id && r.key === values.key
        );
        if (dup) return { error: { code: '23505', message: 'duplicate key' } };
        rows.push({
          ...(values as Pick<Row, 'account_id' | 'key' | 'request_hash'>),
          response_status: null,
          response_body: null,
          created_at: new Date().toISOString(),
        });
        return { error: null };
      }
      if (op === 'update') {
        for (const r of matching()) Object.assign(r, values);
        return { error: null };
      }
      if (op === 'delete') {
        for (const r of matching()) rows.splice(rows.indexOf(r), 1);
        return { error: null };
      }
      return { data: matching()[0] ?? null, error: null };
    };

    const chain = {
      select: () => chain,
      insert: (v: Record<string, unknown>) => ((op = 'insert'), (values = v), chain),
      update: (v: Record<string, unknown>) => ((op = 'update'), (values = v), chain),
      delete: () => ((op = 'delete'), chain),
      eq: (c: string, v: unknown) => (eqs.push([c, v]), chain),
      lt: (c: string, v: string) => (lts.push([c, v]), chain),
      maybeSingle: () => Promise.resolve(resolve()),
      then: (ok: (v: unknown) => unknown) => Promise.resolve(resolve()).then(ok),
    };
    return chain;
  }

  return {
    db: { from: () => builder() } as unknown as SupabaseClient,
    rows,
  };
}
