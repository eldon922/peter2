// ============================================================
// Meta delivery-failure text.
//
// A send Meta accepted can still fail afterwards — the messaging limit
// (131049), a quality restriction (131048), a per-recipient rate limit
// (131056). Meta's guidance is to handle a failure in BOTH places:
//
//   "It is a good practice when working with Cloud API that you monitor
//    both the Graph API response and the `messages` webhook for error
//    handling."
//
// The synchronous half is throwMetaError in meta-api.ts. This is the
// asynchronous half: `entry.changes.value.statuses[].errors`, which the
// status webhook carries on `status: 'failed'`.
//
// Field reference and the failed-status example this module is written
// against:
// https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/messages/status
//
// Lives here rather than in the webhook route so it can be unit-tested;
// a `route.ts` may only export request handlers and segment config.
// ============================================================

/**
 * One entry of Meta's `errors` array, per the status webhook reference.
 *
 * `message` is documented as "Same as title value", and Meta's own
 * example has both carrying the whole sentence while
 * `error_data.details` carries an "extended explanation" — for 131049
 * that's the difference between "This message was not delivered to
 * maintain healthy ecosystem engagement." and the longer form. So the
 * three are ordered by how much they explain, not because any one of
 * them is unreliable.
 *
 * Fields stay optional because this is an untrusted inbound payload,
 * not because the docs mark them so.
 */
export interface WhatsAppStatusError {
  code?: number
  title?: string
  message?: string
  error_data?: { details?: string }
}

/**
 * Collapse the `errors` array into the one line stored on
 * `broadcast_recipients.error_message`.
 *
 * Takes the most explanatory text present rather than a fixed field,
 * and keeps the numeric code — Meta's error reference is indexed by it,
 * so it's the difference between a user being able to look the failure
 * up and not.
 *
 * Never returns an empty string: a blank Error cell on the broadcast
 * page is the symptom this exists to prevent.
 */
export function formatStatusError(errors?: WhatsAppStatusError[]): string {
  const first = errors?.[0]
  if (!first) {
    return 'Meta reported this message as failed without giving a reason'
  }

  const detail = [first.error_data?.details, first.message, first.title]
    .map((s) => s?.trim())
    .find((s): s is string => !!s)

  const tag = typeof first.code === 'number' ? `#${first.code}` : ''
  const text = detail ?? 'Message failed'
  // Meta's own `message` usually already reads "(#131049) …" — don't
  // stutter the code when it's already in the text.
  const withCode = tag && !text.includes(tag) ? `(${tag}) ${text}` : text

  // The column is TEXT, but a runaway payload has no business in a
  // table cell.
  return withCode.length > 500 ? `${withCode.slice(0, 497)}…` : withCode
}
