import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Coexistence echoes (`smb_message_echoes`).
//
// When a number is connected in coexistence mode, the owner keeps using
// the WhatsApp Business app on their phone. Meta echoes those outbound
// messages to the webhook so the team can see the whole thread. Three
// invariants matter and are asserted here:
//
//   1. An echo lands as an *agent* message, not a customer one.
//   2. It does NOT bump unread_count — the business sent it.
//   3. wacrm's own sends echo back too, and must not be inserted twice.
// ---------------------------------------------------------------------------

const CONFIG = {
  id: 'cfg-1',
  account_id: 'acct-1',
  user_id: 'user-1',
  phone_number_id: 'PNID-1',
  access_token: 'enc-token',
  app_secret: null,
}

const CONTACT = { id: 'contact-1', account_id: 'acct-1', phone: '+15557654321' }
const CONVERSATION = { id: 'conv-1', account_id: 'acct-1', unread_count: 3 }

// What the route wrote, per test.
let messageInserts: Record<string, unknown>[] = []
let conversationUpdates: Record<string, unknown>[] = []
// Meta message_ids already stored — models "wacrm sent this itself".
let storedMetaIds: string[] = []
// Work the route handed to `after()`. POST returns before this settles
// (that's the whole point of after), so tests await it explicitly.
let deferred: Promise<unknown>[] = []

function makeBuilder(table: string) {
  const state: { didInsert: boolean; payload: unknown; metaId?: string } = {
    didInsert: false,
    payload: null,
  }

  const rowsFor = (): { data: unknown; error: null } => {
    switch (table) {
      case 'whatsapp_config':
        return { data: [CONFIG], error: null }
      case 'conversations':
        return { data: [CONVERSATION], error: null }
      default:
        return { data: [], error: null }
    }
  }

  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: (column: string, value: unknown) => {
      if (table === 'messages' && column === 'message_id') {
        state.metaId = String(value)
      }
      return builder
    },
    neq: () => builder,
    in: () => builder,
    not: () => builder,
    order: () => builder,
    limit: () => Promise.resolve(rowsFor()),
    insert: (payload: unknown) => {
      state.didInsert = true
      state.payload = payload
      if (table === 'messages') messageInserts.push(payload as Record<string, unknown>)
      return builder
    },
    update: (payload: unknown) => {
      if (table === 'conversations') {
        conversationUpdates.push(payload as Record<string, unknown>)
      }
      return builder
    },
    single: () => Promise.resolve({ data: state.payload, error: null }),
    maybeSingle: () =>
      Promise.resolve({
        // lookupInternalIdByMetaId — a hit means we already stored it.
        data:
          table === 'messages' && state.metaId && storedMetaIds.includes(state.metaId)
            ? { id: 'existing-message' }
            : null,
        error: null,
      }),
    // Awaiting the builder without a terminal (the config lookup and the
    // conversation update both do this).
    then: (resolve: (v: unknown) => unknown) =>
      Promise.resolve(state.didInsert ? { data: state.payload, error: null } : rowsFor()).then(
        resolve,
      ),
  }
  return builder
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => makeBuilder(table) }),
}))

// Signature verification is exercised by its own tests; here it would
// only stand between us and the handler under test.
vi.mock('@/lib/whatsapp/webhook-signature', () => ({
  verifyMetaWebhookSignature: () => true,
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (v: string) => v.replace(/^enc-/, ''),
  encrypt: (v: string) => `enc-${v}`,
  isLegacyFormat: () => false,
}))

// The contact already exists, so no insert path is involved.
vi.mock('@/lib/contacts/dedupe', () => ({
  findExistingContact: () => Promise.resolve(CONTACT),
  isUniqueViolation: () => false,
}))

// `after()` defers work past the response. Run it inline and keep the
// promise so a test can wait for the writes it performs.
vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server')
  return {
    ...actual,
    after: (fn: () => unknown) => {
      deferred.push(Promise.resolve(fn()))
    },
  }
})

/** POST an echo payload and wait for the deferred processing to finish. */
async function postEchoes(echoes: Record<string, unknown>[]): Promise<Response> {
  const { POST } = await import('./route')
  const res = await POST(echoRequest(echoes))
  await Promise.all(deferred)
  return res
}

function echoRequest(echoes: Record<string, unknown>[]) {
  const body = JSON.stringify({
    entry: [
      {
        id: 'WABA-1',
        changes: [
          {
            field: 'smb_message_echoes',
            value: {
              messaging_product: 'whatsapp',
              metadata: { phone_number_id: 'PNID-1' },
              message_echoes: echoes,
            },
          },
        ],
      },
    ],
  })
  return new Request('https://crm.example.com/api/whatsapp/webhook', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': 'sha256=stub',
    },
    body,
  })
}

const TEXT_ECHO = {
  id: 'wamid.ECHO_1',
  from: '15550000000',
  to: '15557654321',
  timestamp: '1735689600',
  type: 'text',
  text: { body: 'Sent from my phone' },
}

describe('smb_message_echoes webhook', () => {
  beforeEach(() => {
    messageInserts = []
    conversationUpdates = []
    storedMetaIds = []
    deferred = []
  })
  afterEach(() => {
    vi.resetModules()
  })

  it('stores an echo as an agent message attributed to the config owner', async () => {
    const res = await postEchoes([TEXT_ECHO])

    expect(res.status).toBe(200)
    expect(messageInserts).toHaveLength(1)
    expect(messageInserts[0]).toMatchObject({
      conversation_id: 'conv-1',
      sender_type: 'agent',
      sender_id: 'user-1',
      content_type: 'text',
      content_text: 'Sent from my phone',
      message_id: 'wamid.ECHO_1',
      status: 'sent',
    })
  })

  it('does not bump unread_count — the business sent this, nobody has to read it', async () => {
    await postEchoes([TEXT_ECHO])

    expect(conversationUpdates).toHaveLength(1)
    expect(conversationUpdates[0]).not.toHaveProperty('unread_count')
    expect(conversationUpdates[0]).toMatchObject({
      last_message_text: 'Sent from my phone',
    })
  })

  it("skips an echo of wacrm's own send rather than duplicating the thread", async () => {
    storedMetaIds = ['wamid.ECHO_1']
    await postEchoes([TEXT_ECHO])

    expect(messageInserts).toHaveLength(0)
    expect(conversationUpdates).toHaveLength(0)
  })

  it('skips an echo with no recipient instead of guessing a thread', async () => {
    await postEchoes([{ ...TEXT_ECHO, to: undefined }])

    expect(messageInserts).toHaveLength(0)
  })
})
