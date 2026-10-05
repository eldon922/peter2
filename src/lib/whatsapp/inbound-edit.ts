import type { SupabaseClient } from '@supabase/supabase-js'

import { findExistingContact } from '@/lib/contacts/dedupe'

/**
 * A message edited on WhatsApp: by the customer, or by the business owner
 * on their phone in coexistence mode (delivered as a message echo).
 *
 * Meta delivers it on the normal `messages` webhook as a message of
 * `type: "edit"`, which points back at the original and carries the new
 * content as a nested message:
 *
 *   { type: "edit", edit: { original_message_id: "wamid…",
 *       message: { type: "text", text: { body: "new text" } } } }
 *
 * For media the new caption sits under the media key
 * (`image` / `video` / `document`). Anything that doesn't fit this shape
 * is ignored rather than guessed at.
 */
export interface InboundEdit {
  originalMessageId: string
  /** New text, or the new caption for a media message. May be empty. */
  text: string
}

const MEDIA_KEYS = ['image', 'video', 'document'] as const

export function parseInboundEdit(message: { edit?: unknown }): InboundEdit | null {
  const edit = message.edit as
    | { original_message_id?: unknown; message?: Record<string, unknown> }
    | undefined
  const originalId = edit?.original_message_id
  const inner = edit?.message
  if (typeof originalId !== 'string' || !originalId || !inner) return null

  const textBody = (inner.text as { body?: unknown } | undefined)?.body
  if (typeof textBody === 'string') {
    return { originalMessageId: originalId, text: textBody }
  }

  for (const key of MEDIA_KEYS) {
    const media = inner[key] as { caption?: unknown } | undefined
    if (media && typeof media === 'object') {
      return {
        originalMessageId: originalId,
        text: typeof media.caption === 'string' ? media.caption : '',
      }
    }
  }
  return null
}

/**
 * Apply an edit to the stored message.
 *
 * `phone` is the customer's number (the sender of an inbound edit, the
 * recipient of an echoed one). The message is looked up inside that
 * customer's conversation and only if its `sender_type` is one of
 * `senders`, so an edit can never touch someone else's thread or a message
 * from the other side. Creates nothing: an edit for a message we never
 * stored is dropped.
 */
export async function applyMessageEdit(
  db: SupabaseClient,
  accountId: string,
  phone: string,
  message: { edit?: unknown; timestamp?: string },
  senders: string[]
): Promise<'updated' | 'ignored'> {
  const edit = parseInboundEdit(message)
  if (!edit) return 'ignored'

  const contact = await findExistingContact(db, accountId, phone)
  if (!contact) return 'ignored'

  const { data: convRows } = await db
    .from('conversations')
    .select('id, last_message_text')
    .eq('account_id', accountId)
    .eq('contact_id', contact.id)
    .order('created_at', { ascending: true })
    .limit(1)
  const conversation = convRows?.[0]
  if (!conversation) return 'ignored'

  const { data: original } = await db
    .from('messages')
    .select('id, content_text, sender_type, edit_history')
    .eq('message_id', edit.originalMessageId)
    .eq('conversation_id', conversation.id)
    .maybeSingle()
  if (!original || !senders.includes(original.sender_type)) return 'ignored'

  // The edit's own timestamp is when the customer edited, not when we heard.
  const seconds = Number(message.timestamp)
  const editedAt = Number.isFinite(seconds) && seconds > 0
    ? new Date(seconds * 1000).toISOString()
    : new Date().toISOString()

  const { error } = await db
    .from('messages')
    .update({
      content_text: edit.text || null,
      edited_at: editedAt,
      // Keep what this edit replaced.
      edit_history: [
        ...(Array.isArray(original.edit_history) ? original.edit_history : []),
        { text: original.content_text ?? null, at: editedAt },
      ],
    })
    .eq('id', original.id)
  if (error) {
    console.error('[webhook] failed to apply message edit:', error.message)
    return 'ignored'
  }

  // The inbox list previews the latest message — keep it in step when the
  // edited one is that message.
  if (
    conversation.last_message_text &&
    conversation.last_message_text === original.content_text
  ) {
    await db
      .from('conversations')
      .update({ last_message_text: edit.text || conversation.last_message_text })
      .eq('id', conversation.id)
  }
  return 'updated'
}
