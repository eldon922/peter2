import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import { findBroadcastSentMessage, renderTemplateBody } from './broadcast-message'

describe('renderTemplateBody', () => {
  it('substitutes positional placeholders', () => {
    expect(renderTemplateBody('Hi {{1}}, your order {{2}} shipped', ['Ann', 'A-9'])).toBe(
      'Hi Ann, your order A-9 shipped',
    )
  })

  it('substitutes every occurrence of a repeated placeholder', () => {
    expect(renderTemplateBody('{{1}}, see you {{2}}. Bye {{1}}', ['Ann', 'soon'])).toBe(
      'Ann, see you soon. Bye Ann',
    )
  })

  it('leaves a placeholder with no matching param as-is', () => {
    // Blanking it would render as a message with a word missing; the
    // marker makes the params/template drift visible instead.
    expect(renderTemplateBody('Hi {{1}}, code {{2}}', ['Ann'])).toBe('Hi Ann, code {{2}}')
  })

  it('substitutes an empty-string param rather than treating it as absent', () => {
    expect(renderTemplateBody('Hi {{1}}!', [''])).toBe('Hi !')
  })

  it('returns bodies without placeholders unchanged', () => {
    expect(renderTemplateBody('No variables here', ['unused'])).toBe('No variables here')
  })

  it('returns null for a missing body', () => {
    expect(renderTemplateBody(null, [])).toBeNull()
    expect(renderTemplateBody(undefined, [])).toBeNull()
    expect(renderTemplateBody('', [])).toBeNull()
  })
})

// ------------------------------------------------------------
// Chainable Supabase stub, scripted per table. Both queries here
// terminate on `.maybeSingle()`, so it dispatches on the active table.
// ------------------------------------------------------------
interface Script {
  recipient?: Record<string, unknown> | null
  recipientError?: { message: string } | null
  template?: { body_text: string | null } | null
}

function makeDb(script: Script): { db: SupabaseClient; filters: [string, unknown][] } {
  let table = ''
  const filters: [string, unknown][] = []

  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: (column: string, value: unknown) => {
      filters.push([column, value])
      return builder
    },
    maybeSingle: () => {
      if (table === 'broadcast_recipients') {
        return Promise.resolve({
          data: script.recipient ?? null,
          error: script.recipientError ?? null,
        })
      }
      return Promise.resolve({ data: script.template ?? null, error: null })
    },
  }

  const db = {
    from: (name: string) => {
      table = name
      return builder
    },
  } as unknown as SupabaseClient

  return { db, filters }
}

const BROADCAST = {
  account_id: 'acct-1',
  template_name: 'order_update',
  template_language: 'en_US',
  header_media_url: null,
}

describe('findBroadcastSentMessage', () => {
  it('reconstructs the message a broadcast sent under a wamid', async () => {
    const { db } = makeDb({
      recipient: {
        contact_id: 'contact-1',
        template_params: ['Ann', 'A-9'],
        status: 'delivered',
        sent_at: '2026-08-01T10:00:00Z',
        broadcast: BROADCAST,
      },
      template: { body_text: 'Hi {{1}}, order {{2}} is on its way' },
    })

    expect(await findBroadcastSentMessage(db, 'acct-1', 'wamid.X')).toEqual({
      contactId: 'contact-1',
      templateName: 'order_update',
      bodyText: 'Hi Ann, order A-9 is on its way',
      mediaUrl: null,
      status: 'delivered',
      sentAt: '2026-08-01T10:00:00Z',
    })
  })

  it('scopes the lookup to the account through the joined broadcast', async () => {
    // The wamid arrives from an inbound webhook, so without this filter
    // one tenant's reaction could resolve against another's broadcast.
    const { db, filters } = makeDb({ recipient: null })
    await findBroadcastSentMessage(db, 'acct-1', 'wamid.X')

    expect(filters).toContainEqual(['whatsapp_message_id', 'wamid.X'])
    expect(filters).toContainEqual(['broadcast.account_id', 'acct-1'])
  })

  it('returns null when the wamid did not come from a broadcast', async () => {
    const { db } = makeDb({ recipient: null })
    expect(await findBroadcastSentMessage(db, 'acct-1', 'wamid.X')).toBeNull()
  })

  it('returns null when the recipient lookup errors', async () => {
    const { db } = makeDb({ recipient: null, recipientError: { message: 'boom' } })
    expect(await findBroadcastSentMessage(db, 'acct-1', 'wamid.X')).toBeNull()
  })

  it('normalizes an array-shaped embedded broadcast', async () => {
    // PostgREST returns a to-one embed as an object, but the untyped
    // client can hand back a single-element array.
    const { db } = makeDb({
      recipient: {
        contact_id: 'contact-1',
        template_params: [],
        status: 'sent',
        sent_at: null,
        broadcast: [BROADCAST],
      },
      template: { body_text: 'Static body' },
    })

    const result = await findBroadcastSentMessage(db, 'acct-1', 'wamid.X')
    expect(result?.templateName).toBe('order_update')
    expect(result?.bodyText).toBe('Static body')
  })

  it('maps a replied recipient onto the read message status', async () => {
    // messages.status has no 'replied' — answering implies reading.
    const { db } = makeDb({
      recipient: {
        contact_id: 'contact-1',
        template_params: [],
        status: 'replied',
        sent_at: null,
        broadcast: BROADCAST,
      },
      template: { body_text: 'Hello' },
    })

    expect((await findBroadcastSentMessage(db, 'acct-1', 'wamid.X'))?.status).toBe('read')
  })

  it('still resolves when the template has been deleted since the send', async () => {
    // Losing the body costs us the text, not the message — the bubble
    // still anchors the reaction and still names the template.
    const { db } = makeDb({
      recipient: {
        contact_id: 'contact-1',
        template_params: ['Ann'],
        status: 'sent',
        sent_at: null,
        broadcast: BROADCAST,
      },
      template: null,
    })

    const result = await findBroadcastSentMessage(db, 'acct-1', 'wamid.X')
    expect(result?.bodyText).toBeNull()
    expect(result?.templateName).toBe('order_update')
  })

  it('carries the media header through for image templates', async () => {
    const { db } = makeDb({
      recipient: {
        contact_id: 'contact-1',
        template_params: [],
        status: 'sent',
        sent_at: null,
        broadcast: { ...BROADCAST, header_media_url: 'https://cdn.test/a.jpg' },
      },
      template: { body_text: 'Look' },
    })

    expect((await findBroadcastSentMessage(db, 'acct-1', 'wamid.X'))?.mediaUrl).toBe(
      'https://cdn.test/a.jpg',
    )
  })
})
