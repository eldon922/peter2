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

  function builder(table: string) {
    const filters: [string, unknown][] = [];
    let op: 'select' | 'update' | 'insert' = 'select';
    let values: Record<string, unknown> = {};
    let rowMode: 'many' | 'single' = 'many';

    const resolve = () => {
      const fixture = fixtures[table] ?? {};
      if (op === 'update' || op === 'insert') {
        writes.push({ table, op, values, filters: [...filters] });
        const data = fixture.onUpdate
          ? fixture.onUpdate(filters)
          : [{ id: filters.find(([c]) => c === 'id')?.[1] ?? 'row' }];
        return { data, error: null };
      }
      let rows = fixture.rows ?? [];
      for (const [col, val] of filters) {
        rows = rows.filter((r) => !(col in r) || r[col] === val);
      }
      return rowMode === 'single'
        ? { data: rows[0] ?? null, error: null }
        : { data: rows, error: null };
    };

    const chain = {
      select: () => chain,
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
      order: () => chain,
      limit: () => chain,
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

  it('rejects more than 1000 recipients', async () => {
    const recipients = Array.from({ length: 1001 }, () => ({
      to: '+14155550123',
    }));
    await expect(
      createBroadcast(db, 'acc', 'user', { templateName: 'promo', recipients })
    ).rejects.toMatchObject({ status: 400 });
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

  it('backs off once on a rate-limit error, then succeeds', async () => {
    sendTemplateMessage
      .mockRejectedValueOnce(new Error('130429 rate limit hit'))
      .mockResolvedValueOnce({ messageId: 'wamid.2' });

    const { db, writes } = makeDb({ broadcasts: { rows: [{ sent_count: 1 }] } });
    await deliverBroadcast(db, plan());

    expect(sendTemplateMessage).toHaveBeenCalledTimes(2);
    expect(writes.find((w) => w.values.status === 'sent')).toBeDefined();
  });

  it('gives up after a second rate-limit error rather than looping', async () => {
    sendTemplateMessage.mockRejectedValue(new Error('130429 rate limit hit'));

    const { db, writes } = makeDb({ broadcasts: { rows: [{ sent_count: 0 }] } });
    await deliverBroadcast(db, plan());

    expect(sendTemplateMessage).toHaveBeenCalledTimes(2);
    const stamp = writes.find((w) => w.values.status === 'failed');
    expect(stamp!.values.error_message).toMatch(/130429/);
  });

  it('paces sends at least MIN_SEND_INTERVAL_MS apart', async () => {
    const at: number[] = [];
    sendTemplateMessage.mockImplementation(async () => {
      at.push(Date.now());
      return { messageId: 'wamid.x' };
    });

    const { db } = makeDb({ broadcasts: { rows: [{ sent_count: 3 }] } });
    await deliverBroadcast(
      db,
      plan({
        planned: Array.from({ length: 3 }, (_, i) => ({
          recipientRowId: `rec-${i}`,
          phone: '14155550123',
          params: [],
        })),
      })
    );

    expect(at).toHaveLength(3);
    for (let i = 1; i < at.length; i++) {
      // 100ms floor, with a little slack for timer coarseness.
      expect(at[i] - at[i - 1]).toBeGreaterThanOrEqual(90);
    }
  });

  it('adds no delay when Meta is already slower than the interval', async () => {
    sendTemplateMessage.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 150));
      return { messageId: 'wamid.x' };
    });

    const { db } = makeDb({ broadcasts: { rows: [{ sent_count: 3 }] } });
    const started = Date.now();
    await deliverBroadcast(
      db,
      plan({
        planned: Array.from({ length: 3 }, (_, i) => ({
          recipientRowId: `rec-${i}`,
          phone: '14155550123',
          params: [],
        })),
      })
    );
    const elapsed = Date.now() - started;

    // 3 × 150ms of real latency. An additive post-send sleep would push
    // this past 750ms; the interval governor must not.
    expect(elapsed).toBeLessThan(650);
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
    // trips on the second iteration.
    let now = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    sendTemplateMessage.mockImplementation(async () => {
      now += 60_000;
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
