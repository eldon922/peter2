import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import { applyInboundEdit, parseInboundEdit } from './inbound-edit'

describe('parseInboundEdit', () => {
  it('reads the original id and new text', () => {
    expect(
      parseInboundEdit({
        edit: {
          original_message_id: 'wamid.A',
          message: { type: 'text', text: { body: 'fixed' } },
        },
      })
    ).toEqual({ originalMessageId: 'wamid.A', text: 'fixed' })
  })

  it('reads a new caption on a media message, including a removed one', () => {
    const withCaption = parseInboundEdit({
      edit: { original_message_id: 'wamid.A', message: { image: { caption: 'new' } } },
    })
    expect(withCaption?.text).toBe('new')
    const removed = parseInboundEdit({
      edit: { original_message_id: 'wamid.A', message: { image: { id: '1' } } },
    })
    expect(removed?.text).toBe('')
  })

  it('ignores payloads it does not understand', () => {
    expect(parseInboundEdit({})).toBeNull()
    expect(parseInboundEdit({ edit: { message: { text: { body: 'x' } } } })).toBeNull()
    expect(parseInboundEdit({ edit: { original_message_id: 'wamid.A' } })).toBeNull()
    expect(
      parseInboundEdit({ edit: { original_message_id: 'wamid.A', message: { type: 'audio' } } })
    ).toBeNull()
  })
})

interface Update {
  table: string
  values: Record<string, unknown>
  filters: [string, unknown][]
}

function makeDb(opts: {
  contacts?: Record<string, unknown>[]
  conversation?: Record<string, unknown> | null
  message?: Record<string, unknown> | null
}) {
  const updates: Update[] = []
  const messageFilters: [string, unknown][] = []

  const from = (table: string) => {
    const filters: [string, unknown][] = []
    let values: Record<string, unknown> | null = null
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (c: string, v: unknown) => {
        filters.push([c, v])
        if (table === 'messages') messageFilters.push([c, v])
        return chain
      },
      like: () =>
        Promise.resolve({ data: opts.contacts ?? [], error: null }),
      order: () => chain,
      limit: () =>
        Promise.resolve({
          data: opts.conversation ? [opts.conversation] : [],
          error: null,
        }),
      maybeSingle: () => Promise.resolve({ data: opts.message ?? null, error: null }),
      update: (v: Record<string, unknown>) => {
        values = v
        return chain
      },
      then: (ok: (v: unknown) => unknown) => {
        if (values) updates.push({ table, values, filters: [...filters] })
        return Promise.resolve({ error: null }).then(ok)
      },
    }
    return chain
  }
  return { db: { from } as unknown as SupabaseClient, updates, messageFilters }
}

const EDIT = {
  edit: {
    original_message_id: 'wamid.A',
    message: { type: 'text', text: { body: 'new text' } },
  },
}
const CONTACT = { id: 'c1', phone: '+628123456789' }

describe('applyInboundEdit', () => {
  it("updates the customer's own message and the list preview", async () => {
    const { db, updates, messageFilters } = makeDb({
      contacts: [CONTACT],
      conversation: { id: 'conv1', last_message_text: 'old text' },
      message: { id: 'm1', content_text: 'old text', sender_type: 'customer' },
    })

    expect(await applyInboundEdit(db, 'acct', '628123456789', EDIT)).toBe('updated')
    expect(messageFilters).toContainEqual(['conversation_id', 'conv1'])
    expect(updates).toEqual([
      { table: 'messages', values: { content_text: 'new text' }, filters: [['id', 'm1']] },
      {
        table: 'conversations',
        values: { last_message_text: 'new text' },
        filters: [['id', 'conv1']],
      },
    ])
  })

  it('leaves the list preview alone when a different message is the latest', async () => {
    const { db, updates } = makeDb({
      contacts: [CONTACT],
      conversation: { id: 'conv1', last_message_text: 'something newer' },
      message: { id: 'm1', content_text: 'old text', sender_type: 'customer' },
    })
    await applyInboundEdit(db, 'acct', '628123456789', EDIT)
    expect(updates.map((u) => u.table)).toEqual(['messages'])
  })

  it('never edits a message we sent', async () => {
    const { db, updates } = makeDb({
      contacts: [CONTACT],
      conversation: { id: 'conv1', last_message_text: 'x' },
      message: { id: 'm1', content_text: 'x', sender_type: 'agent' },
    })
    expect(await applyInboundEdit(db, 'acct', '628123456789', EDIT)).toBe('ignored')
    expect(updates).toEqual([])
  })

  it('ignores an edit for a message we never stored, or an unknown sender', async () => {
    const noMessage = makeDb({
      contacts: [CONTACT],
      conversation: { id: 'conv1', last_message_text: 'x' },
      message: null,
    })
    expect(await applyInboundEdit(noMessage.db, 'acct', '628123456789', EDIT)).toBe('ignored')

    const noContact = makeDb({ contacts: [] })
    expect(await applyInboundEdit(noContact.db, 'acct', '628123456789', EDIT)).toBe('ignored')
    expect(noContact.updates).toEqual([])
  })
})
