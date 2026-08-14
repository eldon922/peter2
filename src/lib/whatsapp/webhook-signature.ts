import crypto from 'node:crypto'

/**
 * Verify the HMAC-SHA256 signature Meta attaches to webhook POSTs.
 *
 * Meta signs the raw request body with your App Secret and sends the
 * result in the `x-hub-signature-256: sha256=<hex>` header. Without
 * verification, anyone who knows our webhook URL can POST fabricated
 * status updates and drift broadcast counts arbitrarily.
 *
 * Reference:
 *   https://developers.facebook.com/docs/graph-api/webhooks/getting-started#verify-payloads
 *
 * Contract:
 *   An App Secret is **required**. If none is available we fail closed —
 *   every request is rejected until the operator configures one. A
 *   previous version fell open with a warning log, which is unsafe for a
 *   public template: anyone who forgets to configure it would be running
 *   a fully spoofable webhook.
 *
 *   `secret` is the account's own App Secret (from `whatsapp_config`,
 *   migration 041) when the caller could resolve one. Passing nothing
 *   falls back to the `META_APP_SECRET` env var, which is how
 *   single-tenant deployments configured before that migration keep
 *   working.
 */
export function verifyMetaWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret?: string | null,
): boolean {
  const appSecret = secret || process.env.META_APP_SECRET
  if (!appSecret) {
    console.error(
      '[webhook] no Meta App Secret available — rejecting request. ' +
        'Add it in Settings → WhatsApp (below the webhook configuration), ' +
        'or set the META_APP_SECRET env var, to enable signature verification.',
    )
    return false
  }

  if (!signatureHeader) return false
  if (!signatureHeader.startsWith('sha256=')) return false

  const expected =
    'sha256=' +
    crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')

  const a = Buffer.from(signatureHeader)
  const b = Buffer.from(expected)
  // Bail if lengths differ — timingSafeEqual throws otherwise.
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}
