import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Broadcast sends never write a `messages` row.
 *
 * `deliverBroadcast` posts to Meta and records the returned wamid on
 * `broadcast_recipients.whatsapp_message_id` — that's enough for the
 * status webhooks (sent/delivered/read), which look the recipient up by
 * wamid and advance the funnel. Nothing about that path needs a message
 * row, and creating one per recipient would mean a conversation per
 * recipient: a 5,000-contact broadcast would drop 5,000 threads into the
 * inbox for people who never said anything.
 *
 * Reactions are the case where that bites. A reaction is per-(target,
 * actor) state whose target is an FK to `messages.id`, so a customer
 * reacting to a broadcast has nothing to attach to and the event is
 * dropped.
 *
 * The way out is to materialize the broadcast message lazily — only once
 * someone actually engages with it. This module supplies the read half:
 * given a wamid, reconstruct what we sent. The caller decides whether to
 * persist it.
 */

export interface BroadcastSentMessage {
  /** The contact the broadcast went to — the reaction must match this. */
  contactId: string
  templateName: string
  /** Body with placeholders substituted, or null if the template is gone. */
  bodyText: string | null
  /** Media header URL, when the template had one. */
  mediaUrl: string | null
  /** Mapped onto the `messages.status` domain. */
  status: 'sent' | 'delivered' | 'read'
  sentAt: string | null
}

/**
 * Substitute a template's positional placeholders with the values that
 * were actually sent to this recipient.
 *
 * A placeholder with no corresponding param is left as the literal
 * `{{n}}`. Blanking it would render as if we'd sent a message with a
 * word missing; leaving the marker makes it visible that the stored
 * params and the template have drifted apart.
 */
export function renderTemplateBody(
  bodyText: string | null | undefined,
  params: string[],
): string | null {
  if (!bodyText) return null
  return bodyText.replace(/\{\{(\d+)\}\}/g, (placeholder, index: string) => {
    const value = params[Number(index) - 1]
    return value === undefined ? placeholder : value
  })
}

/**
 * `broadcast_recipients.status` carries two values `messages.status` has
 * no room for. 'replied' means they answered, which implies they read it;
 * 'pending'/'failed' can't reach here at all, because a row only has a
 * wamid once Meta accepted the send.
 */
function toMessageStatus(recipientStatus: string): 'sent' | 'delivered' | 'read' {
  switch (recipientStatus) {
    case 'delivered':
      return 'delivered'
    case 'read':
    case 'replied':
      return 'read'
    default:
      return 'sent'
  }
}

/**
 * Reconstruct the broadcast message we sent under `wamid`, or null if
 * that wamid didn't come from a broadcast in this account.
 *
 * Scoped to `accountId` through the joined broadcast: the wamid arrives
 * from an inbound webhook, so it must not be able to reach across
 * tenants. The lookup itself is cheap — migration 003 put a unique
 * partial index on `whatsapp_message_id`.
 */
interface BroadcastRef {
  template_name: string
  template_language: string | null
  header_media_url: string | null
}

interface RecipientRow {
  contact_id: string
  template_params: unknown
  status: string
  sent_at: string | null
  /** PostgREST returns an embedded to-one as an object; the untyped
   *  client widens it to a possible array, so handle both. */
  broadcast: BroadcastRef | BroadcastRef[] | null
}

export async function findBroadcastSentMessage(
  db: SupabaseClient,
  accountId: string,
  wamid: string,
): Promise<BroadcastSentMessage | null> {
  const { data: rawRow, error } = await db
    .from('broadcast_recipients')
    .select(
      'contact_id, template_params, status, sent_at, ' +
        'broadcast:broadcasts!inner(account_id, template_name, template_language, header_media_url)',
    )
    .eq('whatsapp_message_id', wamid)
    .eq('broadcast.account_id', accountId)
    .maybeSingle()

  if (error) {
    console.error('[broadcast-message] recipient lookup failed:', error.message)
    return null
  }
  if (!rawRow) return null

  const row = rawRow as unknown as RecipientRow
  const broadcast = Array.isArray(row.broadcast) ? row.broadcast[0] : row.broadcast
  if (!broadcast) return null

  const params: string[] = Array.isArray(row.template_params)
    ? (row.template_params as string[])
    : []

  // The template can have been deleted or re-synced since the send. That
  // costs us the body text, not the message — a bodyless template bubble
  // still anchors the reaction and still shows which template it was.
  const { data: template } = await db
    .from('message_templates')
    .select('body_text')
    .eq('account_id', accountId)
    .eq('name', broadcast.template_name)
    .eq('language', broadcast.template_language ?? 'en_US')
    .maybeSingle()

  return {
    contactId: row.contact_id,
    templateName: broadcast.template_name,
    bodyText: renderTemplateBody(template?.body_text, params),
    mediaUrl: broadcast.header_media_url ?? null,
    status: toMessageStatus(row.status),
    sentAt: row.sent_at ?? null,
  }
}
