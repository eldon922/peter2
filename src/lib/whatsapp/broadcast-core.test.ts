import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  createBroadcast,
  planBroadcastRetry,
  deliverBroadcast,
  BroadcastError,
  type BroadcastPlan,
} from './broadcast-core';
import { phoneVariants } from './phone-utils';
import {
  DELIVER_BUDGET_MS,
  MAX_RECIPIENTS,
  SEND_BATCH_DELAY_MS,
  SEND_BATCH_SIZE,
} from './broadcast-limits';

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (v: string) => v,
}));

const sendTemplateMessage = vi.hoisted(() => vi.fn());
vi.mock('@/lib/whatsapp/meta-api', () => ({ sendTemplateMessage }));

// ============================================================
// Minimal chainable Supabase double.
//
// Records every write so tests can assert on what was persisted, and
// answers reads from a per-table fixture. Only the query shapes
// broadcast-core actually uses are supported.
// ============================================================

interface Write {
  table: string;
  op: 'update' | 'insert';
  values: Record<string, unknown>;
  filters: [string, unknown][];
}

interface Fixture {
  /** Rows returned by a select on this table. */
  rows?: Record<string, unknown>[];
  /**
   * Rows an update should report as affected. Defaults to echoing the
   * filters, which models "the compare-and-set won". Return [] to model
   * losing the race.
   */
  onUpdate?: (filters: [string, unknown][]) => Record<string, unknown>[];
}

function makeDb(fixtures: Record<string, Fixture>) {
  const writes: Write[] = [];
  /** Table name per resolved SELECT — lets tests bound round trips. */
  const reads: string[] = [];
  let insertSeq = 0;

  function builder(table: string) {
    const filters: [string, unknown][] = [];
    let op: 'select' | 'update' | 'insert' = 'select';
    let values: Record<string, unknown> = {};
    let rowMode: 'many' | 'single' = 'many';
    // PostgREST semantics: `limit` bounds the returned window, while
    // `count: 'exact'` reports how many rows matched in total. Modelling
    // both is what lets tests catch a `remaining` derived from the
    // window instead of the count.
    let limitN: number | null = null;
    let wantCount = false;
    // PostgREST `or=(a,b,c)`. Only the `phone.like.*<suffix>` shape the
    // bulk contact resolver emits is modelled.
    let orSuffixes: string[] | null = null;

    const resolve = () => {
      const fixture = fixtures[table] ?? {};
      if (op === 'update' || op === 'insert') {
        writes.push({ table, op, values, filters: [...filters] });
        if (fixture.onUpdate) {
          return { data: fixture.onUpdate(filters), error: null };
        }
        // A bulk insert echoes its rows back with synthetic ids, so a
        // caller that `.select()`s the result can map ids to inputs —
        // which is how the bulk contact resolver learns what it created.
        if (op === 'insert' && Array.isArray(values.batch)) {
          const data = (values.batch as Record<string, unknown>[]).map(
            (row) => ({ id: `new-${insertSeq++}`, ...row })
          );
          return { data, error: null };
        }
        return {
          data: [{ id: filters.find(([c]) => c === 'id')?.[1] ?? 'row' }],
          error: null,
        };
      }
      reads.push(table);
      let rows = fixture.rows ?? [];
      for (const [col, val] of filters) {
        rows = rows.filter((r) => !(col in r) || r[col] === val);
      }
      if (orSuffixes) {
        const suffixes = orSuffixes;
        rows = rows.filter((r) =>
          suffixes.some((s) => String(r.phone ?? '').endsWith(s))
        );
      }
      const matched = rows.length;
      if (limitN !== null) rows = rows.slice(0, limitN);
      return rowMode === 'single'
        ? { data: rows[0] ?? null, error: null }
        : {
            data: rows,
            error: null,
            ...(wantCount ? { count: matched } : {}),
          };
    };

    const chain = {
      select: (_columns?: string, opts?: { count?: string }) => {
        if (opts?.count) wantCount = true;
        return chain;
      },
      insert: (v: Record<string, unknown> | Record<string, unknown>[]) => {
        op = 'insert';
        values = Array.isArray(v) ? { batch: v } : v;
        return chain;
      },
      update: (v: Record<string, unknown>) => {
        op = 'update';
        values = v;
        return chain;
      },
      eq: (col: string, val: unknown) => {
        filters.push([col, val]);
        return chain;
      },
      in: () => chain,
      or: (expr: string) => {
        orSuffixes = expr
          .split(',')
          .map((atom) => atom.replace(/^phone\.like\.\*/, ''));
        return chain;
      },
      order: () => chain,
      limit: (n?: number) => {
        if (typeof n === 'number') limitN = n;
        return chain;
      },
      maybeSingle: () => {
        rowMode = 'single';
        return Promise.resolve(resolve());
      },
      single: () => {
        rowMode = 'single';
        return Promise.resolve(resolve());
      },
      then: (onOk: (v: unknown) => unknown) => Promise.resolve(resolve()).then(onOk),
    };
    return chain;
  }

  return {
    db: { from: (table: string) => builder(table) } as unknown as SupabaseClient,
    writes,
    reads,
  };
}

const TEMPLATE_ROW = {
  id: 'tpl-1',
  user_id: 'user-1',
  name: 'promo',
  language: 'en_US',
  body_text: 'Hi {{1}}, your code is {{2}}',
};

const TEMPLATE_NO_VARS = { ...TEMPLATE_ROW, body_text: 'Hi there' };

const CONFIG_ROW = { phone_number_id: 'pn-1', access_token: 'tok' };

function failedRow(over: Record<string, unknown> = {}) {
  return {
    id: 'rec-1',
    contact_id: 'c-1',
    status: 'failed',
    attempt_count: 1,
    template_params: null,
    contact: { id: 'c-1', phone: '14155550123', name: 'Jane' },
    ...over,
  };
}

function sentBroadcast(over: Record<string, unknown> = {}) {
  return {
    id: 'b-1',
    template_name: 'promo',
    template_language: 'en_US',
    template_variables: null,
    header_media_url: null,
    status: 'sent',
    ...over,
  };
}

beforeEach(() => {
  sendTemplateMessage.mockReset();
  sendTemplateMessage.mockResolvedValue({ messageId: 'wamid.new' });
});

describe('createBroadcast validation', () => {
  // These assertions all fire in the pure validation prologue, before
  // any Supabase call — a bare stub is enough.
  const db = {} as SupabaseClient;

  it('rejects a missing template_name', async () => {
    await expect(
      createBroadcast(db, 'acc', 'user', {
        templateName: '',
        recipients: [{ to: '+14155550123' }],
      })
    ).rejects.toMatchObject({ code: 'bad_request', status: 400 });
  });

  it('rejects an empty recipient list', async () => {
    await expect(
      createBroadcast(db, 'acc', 'user', {
        templateName: 'promo',
        recipients: [],
      })
    ).rejects.toBeInstanceOf(BroadcastError);
  });

  it('rejects more recipients than one pass can deliver', async () => {
    // Derived from the cap rather than hard-coded: a literal stops
    // exercising the guard the moment the delivery budget changes.
    const recipients = Array.from({ length: MAX_RECIPIENTS + 1 }, () => ({
      to: '+14155550123',
    }));
    await expect(
      createBroadcast(db, 'acc', 'user', { templateName: 'promo', recipients })
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('createBroadcast contact resolution', () => {
  function contactsDb(existing: Record<string, unknown>[] = []) {
    return makeDb({
      contacts: { rows: existing },
      whatsapp_config: { rows: [CONFIG_ROW] },
      message_templates: { rows: [TEMPLATE_NO_VARS] },
      broadcasts: { rows: [{ id: 'b-1' }] },
    });
  }

  it('resolves N recipients in a constant number of round trips', async () => {
    // The point of the bulk resolver. Previously this was one (often
    // two) sequential SELECTs per recipient, inline in the request —
    // 50 recipients meant 50+ serial round trips before any send.
    const { db, reads } = contactsDb();
    const plan = await createBroadcast(db, 'acc', 'user', {
      templateName: 'promo',
      recipients: Array.from({ length: 50 }, (_, i) => ({
        to: `+1415555${String(i).padStart(4, '0')}`,
      })),
    });

    expect(plan.planned).toHaveLength(50);
    expect(plan.rejected).toBe(0);
    expect(new Set(plan.planned.map((p) => p.recipientRowId)).size).toBe(50);

    // All 50 suffixes fit one filter chunk, so exactly one lookup.
    expect(reads.filter((t) => t === 'contacts')).toHaveLength(1);
  });

  it('reuses an existing contact instead of creating a duplicate', async () => {
    const { db, writes } = contactsDb([
      { id: 'c-existing', account_id: 'acc', phone: '14155550123' },
    ]);

    const plan = await createBroadcast(db, 'acc', 'user', {
      templateName: 'promo',
      recipients: [{ to: '+14155550123' }],
    });

    expect(plan.planned).toHaveLength(1);
    const contactInserts = writes.filter(
      (w) => w.table === 'contacts' && w.op === 'insert'
    );
    expect(contactInserts).toHaveLength(0);
  });

  it('matches a trunk-prefix variant the same way the single-row helper does', async () => {
    // phonesMatch tolerates a trunk 0: 370063949836 ↔ 37063949836.
    const { db, writes } = contactsDb([
      { id: 'c-lt', account_id: 'acc', phone: '37063949836' },
    ]);

    const plan = await createBroadcast(db, 'acc', 'user', {
      templateName: 'promo',
      recipients: [{ to: '+370063949836' }],
    });

    expect(plan.planned).toHaveLength(1);
    expect(
      writes.filter((w) => w.table === 'contacts' && w.op === 'insert')
    ).toHaveLength(0);
  });

  it('collapses duplicate phones into one recipient row', async () => {
    const { db, writes } = contactsDb();

    const plan = await createBroadcast(db, 'acc', 'user', {
      templateName: 'promo',
      recipients: [
        { to: '+14155550123' },
        { to: '+14155550123' },
        { to: '+14155550124' },
      ],
    });

    // Two contacts, and crucially only two rows in the bulk insert —
    // inserting the duplicate would trip the unique index from 022.
    expect(plan.planned).toHaveLength(2);
    const insert = writes.find(
      (w) => w.table === 'contacts' && w.op === 'insert'
    );
    expect((insert!.values.batch as unknown[]).length).toBe(2);
  });

  it('counts invalid phones as rejected without resolving them', async () => {
    const { db } = contactsDb();

    const plan = await createBroadcast(db, 'acc', 'user', {
      templateName: 'promo',
      recipients: [{ to: '+14155550123' }, { to: 'nonsense' }, { to: '' }],
    });

    expect(plan.planned).toHaveLength(1);
    expect(plan.rejected).toBe(2);
  });
});

describe('planBroadcastRetry', () => {
  it('404s on a broadcast outside the account', async () => {
    const { db } = makeDb({ broadcasts: { rows: [] } });
    await expect(planBroadcastRetry(db, 'acc', 'b-1')).rejects.toMatchObject({
      code: 'not_found',
      status: 404,
    });
  });

  it('409s while the broadcast is still sending', async () => {
    const { db } = makeDb({
      broadcasts: { rows: [sentBroadcast({ status: 'sending' })] },
    });
    await expect(planBroadcastRetry(db, 'acc', 'b-1')).rejects.toMatchObject({
      code: 'conflict',
      status: 409,
    });
  });

  it('plans only failed rows and claims them with a compare-and-set', async () => {
    const { db, writes } = makeDb({
      broadcasts: { rows: [sentBroadcast()] },
      broadcast_recipients: {
        rows: [
          failedRow({ template_params: ['Jane', '#1'] }),
          // Must be left alone — retrying a delivered recipient would
          // double-message someone who already got it.
          failedRow({ id: 'rec-sent', status: 'sent', contact_id: 'c-2' }),
          failedRow({ id: 'rec-deliv', status: 'delivered', contact_id: 'c-3' }),
          failedRow({ id: 'rec-pend', status: 'pending', contact_id: 'c-4' }),
        ],
      },
      whatsapp_config: { rows: [CONFIG_ROW] },
      message_templates: { rows: [TEMPLATE_ROW] },
    });

    const plan = await planBroadcastRetry(db, 'acc', 'b-1');

    expect(plan.isRetry).toBe(true);
    expect(plan.planned).toHaveLength(1);
    expect(plan.planned.map((p) => p.recipientRowId)).toEqual(['rec-1']);
    // Nothing was written against the non-failed rows.
    expect(
      writes.filter((w) =>
        w.filters.some(([c, v]) => c === 'id' && v !== 'rec-1' && v !== 'b-1')
      )
    ).toHaveLength(0);
    expect(plan.planned[0]).toMatchObject({
      recipientRowId: 'rec-1',
      phone: '14155550123',
      params: ['Jane', '#1'],
    });

    // The claim must be conditional on status='failed' — that is what
    // makes a concurrent retry safe — and must reset to 'pending' so
    // the webhook ladder accepts the new send's callbacks.
    const claim = writes.find(
      (w) => w.table === 'broadcast_recipients' && w.values.status === 'pending'
    );
    expect(claim).toBeDefined();
    expect(claim!.filters).toContainEqual(['status', 'failed']);
    expect(claim!.values).toMatchObject({ error_message: null, attempt_count: 2 });
  });

  it('reports remaining as a true count of unclaimed failed rows', async () => {
    // Regression: `remaining` was derived from a `limit(CAP + 1)` window,
    // so it could only ever be 0 or 1 — the UI told a user with hundreds
    // of failures that "1 more" was left, every single retry.
    const overflow = MAX_RECIPIENTS + 25;
    const { db } = makeDb({
      broadcasts: { rows: [sentBroadcast()] },
      broadcast_recipients: {
        rows: Array.from({ length: overflow }, (_, i) =>
          failedRow({
            id: `rec-${i}`,
            contact_id: `c-${i}`,
            template_params: ['Jane', '#1'],
            contact: { id: `c-${i}`, phone: '14155550123', name: 'Jane' },
          })
        ),
      },
      whatsapp_config: { rows: [CONFIG_ROW] },
      message_templates: { rows: [TEMPLATE_ROW] },
    });

    const plan = await planBroadcastRetry(db, 'acc', 'b-1');

    expect(plan.planned).toHaveLength(MAX_RECIPIENTS);
    expect(plan.remaining).toBe(overflow - MAX_RECIPIENTS);
  });

  it('reports remaining as 0 when every failed row is claimed', async () => {
    const { db } = makeDb({
      broadcasts: { rows: [sentBroadcast()] },
      broadcast_recipients: {
        rows: Array.from({ length: 3 }, (_, i) =>
          failedRow({
            id: `rec-${i}`,
            contact_id: `c-${i}`,
            template_params: ['Jane', '#1'],
            contact: { id: `c-${i}`, phone: '14155550123', name: 'Jane' },
          })
        ),
      },
      whatsapp_config: { rows: [CONFIG_ROW] },
      message_templates: { rows: [TEMPLATE_ROW] },
    });

    const plan = await planBroadcastRetry(db, 'acc', 'b-1');

    expect(plan.planned).toHaveLength(3);
    expect(plan.remaining).toBe(0);
  });

  it('plans nothing when the claim loses the race', async () => {
    const { db } = makeDb({
      broadcasts: { rows: [sentBroadcast()] },
      broadcast_recipients: {
        rows: [failedRow({ template_params: [] })],
        onUpdate: () => [], // another retry got there first
      },
      whatsapp_config: { rows: [CONFIG_ROW] },
      message_templates: { rows: [TEMPLATE_NO_VARS] },
    });

    const plan = await planBroadcastRetry(db, 'acc', 'b-1');
    expect(plan.planned).toHaveLength(0);
  });

  it('re-records an orphaned contact instead of planning it', async () => {
    const { db, writes } = makeDb({
      broadcasts: { rows: [sentBroadcast()] },
      broadcast_recipients: {
        rows: [failedRow({ contact_id: null, contact: null })],
      },
      whatsapp_config: { rows: [CONFIG_ROW] },
      message_templates: { rows: [TEMPLATE_ROW] },
    });

    const plan = await planBroadcastRetry(db, 'acc', 'b-1');

    expect(plan.planned).toHaveLength(0);
    expect(writes).toContainEqual(
      expect.objectContaining({
        values: expect.objectContaining({
          status: 'failed',
          error_message: 'Contact no longer exists',
        }),
      })
    );
  });

  it('re-resolves params from template_variables when none are stored', async () => {
    const { db } = makeDb({
      broadcasts: {
        rows: [
          sentBroadcast({
            template_variables: {
              '1': { type: 'field', value: 'name' },
              '2': { type: 'static', value: 'SAVE20' },
            },
          }),
        ],
      },
      broadcast_recipients: { rows: [failedRow()] },
      whatsapp_config: { rows: [CONFIG_ROW] },
      message_templates: { rows: [TEMPLATE_ROW] },
      contact_custom_values: { rows: [] },
    });

    const plan = await planBroadcastRetry(db, 'acc', 'b-1');
    expect(plan.planned[0].params).toEqual(['Jane', 'SAVE20']);
  });

  it('prefers stored template_params over re-resolution', async () => {
    const { db } = makeDb({
      broadcasts: {
        rows: [
          sentBroadcast({
            template_variables: { '1': { type: 'field', value: 'name' } },
          }),
        ],
      },
      broadcast_recipients: {
        rows: [failedRow({ template_params: ['AS SENT'] })],
      },
      whatsapp_config: { rows: [CONFIG_ROW] },
      message_templates: { rows: [TEMPLATE_ROW] },
    });

    const plan = await planBroadcastRetry(db, 'acc', 'b-1');
    expect(plan.planned[0].params).toEqual(['AS SENT']);
  });

  it('retries the contact’s NEW number after an edit', async () => {
    const { db } = makeDb({
      broadcasts: {
        rows: [
          sentBroadcast({
            template_variables: { '1': { type: 'field', value: 'phone' } },
          }),
        ],
      },
      broadcast_recipients: {
        rows: [
          failedRow({
            phone_attempted: '14155550123',
            contact: { id: 'c-1', phone: '14155559999', name: 'Jane' },
          }),
        ],
      },
      whatsapp_config: { rows: [CONFIG_ROW] },
      message_templates: { rows: [TEMPLATE_ROW] },
      contact_custom_values: { rows: [] },
    });

    const plan = await planBroadcastRetry(db, 'acc', 'b-1');
    expect(plan.planned[0].phone).toBe('14155559999');
    // A {{phone}} variable re-resolves to the new number too.
    expect(plan.planned[0].params).toEqual(['14155559999']);
  });

  it('resolves to no params when the template has no placeholders', async () => {
    const { db } = makeDb({
      broadcasts: { rows: [sentBroadcast()] },
      broadcast_recipients: { rows: [failedRow()] },
      whatsapp_config: { rows: [CONFIG_ROW] },
      message_templates: { rows: [TEMPLATE_NO_VARS] },
    });

    const plan = await planBroadcastRetry(db, 'acc', 'b-1');
    expect(plan.planned[0].params).toEqual([]);
  });

  it('refuses unrecoverable params without claiming any row', async () => {
    // A legacy API broadcast: no stored params, no variable mapping,
    // but the template needs {{1}}/{{2}}.
    const { db, writes } = makeDb({
      broadcasts: { rows: [sentBroadcast()] },
      broadcast_recipients: { rows: [failedRow()] },
      whatsapp_config: { rows: [CONFIG_ROW] },
      message_templates: { rows: [TEMPLATE_ROW] },
    });

    await expect(planBroadcastRetry(db, 'acc', 'b-1')).rejects.toMatchObject({
      code: 'params_unrecoverable',
      status: 422,
    });

    // The whole point: a refusal must not consume the failures.
    expect(
      writes.filter((w) => w.values.status === 'pending')
    ).toHaveLength(0);
  });

  it('attaches the stored header media URL for media templates', async () => {
    const { db } = makeDb({
      broadcasts: {
        rows: [sentBroadcast({ header_media_url: 'https://cdn/x.jpg' })],
      },
      broadcast_recipients: { rows: [failedRow({ template_params: [] })] },
      whatsapp_config: { rows: [CONFIG_ROW] },
      message_templates: {
        rows: [{ ...TEMPLATE_NO_VARS, header_type: 'image' }],
      },
    });

    const plan = await planBroadcastRetry(db, 'acc', 'b-1');
    expect(plan.planned[0].messageParams).toEqual({
      headerMediaUrl: 'https://cdn/x.jpg',
    });
  });

  it('asks for the media URL rather than reusing the template default', async () => {
    // The template HAS a usable URL — the point is that we must not
    // silently fall back to it, because it may not be what this
    // broadcast originally sent.
    const { db, writes } = makeDb({
      broadcasts: { rows: [sentBroadcast({ header_media_url: null })] },
      broadcast_recipients: { rows: [failedRow({ template_params: [] })] },
      whatsapp_config: { rows: [CONFIG_ROW] },
      message_templates: {
        rows: [
          {
            ...TEMPLATE_NO_VARS,
            header_type: 'image',
            header_media_url: 'https://cdn/template-default.jpg',
          },
        ],
      },
    });

    await expect(planBroadcastRetry(db, 'acc', 'b-1')).rejects.toMatchObject({
      code: 'header_media_required',
      status: 422,
    });
    expect(writes.filter((w) => w.values.status === 'pending')).toHaveLength(0);
  });

  it('uses a supplied media URL and stores it for next time', async () => {
    const { db, writes } = makeDb({
      broadcasts: { rows: [sentBroadcast({ header_media_url: null })] },
      broadcast_recipients: { rows: [failedRow({ template_params: [] })] },
      whatsapp_config: { rows: [CONFIG_ROW] },
      message_templates: {
        rows: [{ ...TEMPLATE_NO_VARS, header_type: 'image' }],
      },
    });

    const plan = await planBroadcastRetry(db, 'acc', 'b-1', {
      headerMediaUrl: 'https://cdn/chosen.jpg',
    });

    expect(plan.planned[0].messageParams).toEqual({
      headerMediaUrl: 'https://cdn/chosen.jpg',
    });
    expect(writes).toContainEqual(
      expect.objectContaining({
        table: 'broadcasts',
        values: { header_media_url: 'https://cdn/chosen.jpg' },
      })
    );
  });

  it('rejects a non-http media URL', async () => {
    const { db } = makeDb({
      broadcasts: { rows: [sentBroadcast({ header_media_url: null })] },
      broadcast_recipients: { rows: [failedRow({ template_params: [] })] },
      whatsapp_config: { rows: [CONFIG_ROW] },
      message_templates: {
        rows: [{ ...TEMPLATE_NO_VARS, header_type: 'image' }],
      },
    });

    await expect(
      planBroadcastRetry(db, 'acc', 'b-1', { headerMediaUrl: 'javascript:alert(1)' })
    ).rejects.toMatchObject({ code: 'bad_request', status: 400 });
  });

  it('refuses when the template is gone rather than sending a degraded message', async () => {
    const { db, writes } = makeDb({
      broadcasts: { rows: [sentBroadcast()] },
      broadcast_recipients: { rows: [failedRow({ template_params: ['x'] })] },
      whatsapp_config: { rows: [CONFIG_ROW] },
      message_templates: { rows: [] },
    });

    await expect(planBroadcastRetry(db, 'acc', 'b-1')).rejects.toMatchObject({
      code: 'template_missing',
      status: 422,
    });
    expect(writes.filter((w) => w.values.status === 'pending')).toHaveLength(0);
  });

  it('omits messageParams for a text-header template', async () => {
    const { db } = makeDb({
      broadcasts: {
        rows: [sentBroadcast({ header_media_url: 'https://cdn/x.jpg' })],
      },
      broadcast_recipients: { rows: [failedRow({ template_params: [] })] },
      whatsapp_config: { rows: [CONFIG_ROW] },
      message_templates: { rows: [{ ...TEMPLATE_NO_VARS, header_type: 'text' }] },
    });

    const plan = await planBroadcastRetry(db, 'acc', 'b-1');
    expect(plan.planned[0].messageParams).toBeUndefined();
  });
});

describe('deliverBroadcast', () => {
  function plan(over: Partial<BroadcastPlan> = {}): BroadcastPlan {
    return {
      broadcastId: 'b-1',
      templateName: 'promo',
      templateLanguage: 'en_US',
      phoneNumberId: 'pn-1',
      accessToken: 'tok',
      templateRow: null,
      planned: [{ recipientRowId: 'rec-1', phone: '14155550123', params: ['Jane'] }],
      rejected: 0,
      ...over,
    };
  }

  it('records the dialled variant, not the input phone', async () => {
    // First variant rejected as "not in allowed list", second accepted.
    // The point is that the *variant* is what gets recorded — which
    // one it happens to be is phoneVariants' business, so derive it.
    const input = '370063949836';
    const accepted = phoneVariants(input)[1];

    sendTemplateMessage
      .mockRejectedValueOnce(new Error('131030 recipient not in allowed list'))
      .mockResolvedValueOnce({ messageId: 'wamid.1' });

    const { db, writes } = makeDb({ broadcasts: { rows: [{ sent_count: 1 }] } });
    await deliverBroadcast(
      db,
      plan({ planned: [{ recipientRowId: 'rec-1', phone: input, params: [] }] })
    );

    const stamp = writes.find((w) => w.values.status === 'sent');
    expect(sendTemplateMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ to: accepted })
    );
    expect(stamp!.values.phone_attempted).toBe(accepted);
    expect(stamp!.values.phone_attempted).not.toBe(input);
  });

  it('records the last variant tried when every one fails', async () => {
    sendTemplateMessage.mockRejectedValue(
      new Error('131030 recipient not in allowed list')
    );

    const input = '370063949836';
    const { db, writes } = makeDb({ broadcasts: { rows: [{ sent_count: 0 }] } });
    await deliverBroadcast(
      db,
      plan({ planned: [{ recipientRowId: 'rec-1', phone: input, params: [] }] })
    );

    const variants = phoneVariants(input);
    const stamp = writes.find((w) => w.values.status === 'failed');
    expect(stamp!.values.phone_attempted).toBe(variants[variants.length - 1]);
  });

  it('stores the params it sent so a second retry can replay them', async () => {
    const { db, writes } = makeDb({ broadcasts: { rows: [{ sent_count: 1 }] } });
    await deliverBroadcast(db, plan());

    const stamp = writes.find((w) => w.values.status === 'sent');
    expect(stamp!.values.template_params).toEqual(['Jane']);
  });

  it('fails a throttled recipient outright rather than re-sending', async () => {
    // Throttling has no in-loop backoff: the row carries Meta's message
    // and the retry endpoint is the recovery path, same as any other
    // failure. A second attempt inside the invocation would spend budget
    // to arrive at this same row.
    sendTemplateMessage.mockRejectedValue(new Error('130429 rate limit hit'));

    const { db, writes } = makeDb({ broadcasts: { rows: [{ sent_count: 0 }] } });
    await deliverBroadcast(db, plan());

    expect(sendTemplateMessage).toHaveBeenCalledTimes(1);
    const stamp = writes.find((w) => w.values.status === 'failed');
    expect(stamp!.values.error_message).toMatch(/130429/);
  });

  /** One more than a full group, so exactly one batch boundary is crossed. */
  const spanningTwoBatches = Array.from(
    { length: SEND_BATCH_SIZE + 1 },
    (_, i) => ({
      recipientRowId: `rec-${i}`,
      phone: '14155550123',
      params: [] as string[],
    })
  );

  it('sends a group unthrottled, then pauses once at the boundary', async () => {
    const at: number[] = [];
    sendTemplateMessage.mockImplementation(async () => {
      at.push(Date.now());
      return { messageId: 'wamid.x' };
    });

    const { db } = makeDb({
      broadcasts: { rows: [{ sent_count: spanningTwoBatches.length }] },
    });
    await deliverBroadcast(db, plan({ planned: spanningTwoBatches }));

    expect(at).toHaveLength(SEND_BATCH_SIZE + 1);

    // Nothing paces sends *within* a group — that is the tradeoff of
    // batch pacing over the per-message governor it replaced.
    for (let i = 1; i < SEND_BATCH_SIZE; i++) {
      expect(at[i] - at[i - 1]).toBeLessThan(50);
    }

    // ...and one flat pause before the next group opens.
    expect(at[SEND_BATCH_SIZE] - at[SEND_BATCH_SIZE - 1]).toBeGreaterThanOrEqual(
      SEND_BATCH_DELAY_MS - 20
    );
  });

  it('pays the batch pause on top of Meta latency, not instead of it', async () => {
    const latencyMs = 20;
    sendTemplateMessage.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, latencyMs));
      return { messageId: 'wamid.x' };
    });

    const { db } = makeDb({
      broadcasts: { rows: [{ sent_count: spanningTwoBatches.length }] },
    });
    const started = Date.now();
    await deliverBroadcast(db, plan({ planned: spanningTwoBatches }));
    const elapsed = Date.now() - started;

    // SEND_BATCH_DELAY_MS is an unconditional sleep, unlike the
    // compensating governor this replaced — real latency does NOT count
    // toward it. maxDeliverableRecipients() is optimistic by exactly
    // this much, which is why the API reports `remaining` rather than
    // promising a single pass.
    expect(elapsed).toBeGreaterThanOrEqual(
      SEND_BATCH_DELAY_MS + spanningTwoBatches.length * latencyMs
    );
  });

  it('keeps a partly-successful broadcast "sent" when every retry fails', async () => {
    sendTemplateMessage.mockRejectedValue(new Error('boom'));

    // 90 recipients already sent before this retry; the trigger-owned
    // sent_count is what must decide the terminal status.
    const { db, writes } = makeDb({ broadcasts: { rows: [{ sent_count: 90 }] } });
    await deliverBroadcast(db, plan({ isRetry: true }));

    const final = writes.find(
      (w) => w.table === 'broadcasts' && 'status' in w.values
    );
    expect(final!.values.status).toBe('sent');
  });

  it('marks a broadcast failed when nothing has ever sent', async () => {
    sendTemplateMessage.mockRejectedValue(new Error('boom'));

    const { db, writes } = makeDb({ broadcasts: { rows: [{ sent_count: 0 }] } });
    await deliverBroadcast(db, plan({ isRetry: true }));

    const final = writes.find(
      (w) => w.table === 'broadcasts' && 'status' in w.values
    );
    expect(final!.values.status).toBe('failed');
  });
});

describe('deliverBroadcast deadline guard', () => {
  afterEach(() => vi.useRealTimers());

  it('fails unsent rows explicitly rather than stranding them pending', async () => {
    // Jump the clock past the budget after the first send so the guard
    // trips on the second iteration. Derived from DELIVER_BUDGET_MS
    // rather than hard-coded — a hard-coded advance silently stops
    // exercising the guard the moment the budget is raised.
    let now = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    sendTemplateMessage.mockImplementation(async () => {
      now += DELIVER_BUDGET_MS + 1_000;
      return { messageId: 'wamid.x' };
    });

    const { db, writes } = makeDb({ broadcasts: { rows: [{ sent_count: 1 }] } });
    await deliverBroadcast(db, {
      broadcastId: 'b-1',
      templateName: 'promo',
      templateLanguage: 'en_US',
      phoneNumberId: 'pn-1',
      accessToken: 'tok',
      templateRow: null,
      planned: [
        { recipientRowId: 'rec-1', phone: '14155550123', params: [] },
        { recipientRowId: 'rec-2', phone: '14155550124', params: [] },
      ],
      rejected: 0,
    });

    expect(sendTemplateMessage).toHaveBeenCalledTimes(1);
    const stranded = writes.find((w) =>
      w.filters.some(([c, v]) => c === 'id' && v === 'rec-2')
    );
    expect(stranded!.values).toMatchObject({
      status: 'failed',
      error_message: 'Send window elapsed — retry again',
    });
  });
});
