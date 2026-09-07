/**
 * Meta Embedded Signup helpers.
 *
 * Embedded Signup is the popup flow an approved Meta Tech Provider can
 * host so a business owner connects their own WhatsApp account without
 * ever seeing an access token. The browser half lives in
 * `src/components/settings/embedded-signup-button.tsx`; everything here
 * runs server-side, because all of it needs `META_APP_SECRET`.
 *
 * Two flavours come through the same code path:
 *
 *   - Plain Embedded Signup — the customer provisions a fresh Cloud API
 *     number inside the popup.
 *   - Coexistence — the customer connects a number that is *already
 *     live in the WhatsApp Business app* on their phone, via
 *     `featureType=whatsapp_business_app_onboarding`. Meta reports these
 *     with `platform_type: 'SMB_APP'`, which is the only reliable way to
 *     tell them apart after the fact.
 *
 * Same named-parameters convention as `./meta-api.ts` — see the note at
 * the top of that file for why positional args are banned here.
 */

import { META_API_BASE, throwMetaError } from './meta-api'

/**
 * Meta's own name for the runtime behind a business phone number.
 * `SMB_APP` means the WhatsApp Business app is driving it (coexistence);
 * `CLOUD_API` means it is a normal Cloud API number. `NOT_APPLICABLE`
 * shows up on numbers that have not finished provisioning.
 */
export type MetaPlatformType = 'CLOUD_API' | 'SMB_APP' | 'NOT_APPLICABLE'

export interface WabaPhoneNumber {
  id: string
  display_phone_number: string
  verified_name?: string
  platform_type?: MetaPlatformType
}

/**
 * Read the instance-level Meta app credentials.
 *
 * Unlike the manual connect form — where migration 041 moved app_id /
 * app_secret onto `whatsapp_config` so a self-hoster can fill them in
 * from Settings — Embedded Signup is inherently instance-level: the
 * config id, the app id and the app secret all belong to the *Tech
 * Provider's* app, not to the customer being onboarded. So these stay
 * env-only, and their absence is what keeps the button hidden.
 */
export function getEmbeddedSignupEnv(): {
  appId: string
  appSecret: string
  configId: string
} | null {
  const appId = process.env.META_APP_ID?.trim()
  const appSecret = process.env.META_APP_SECRET?.trim()
  const configId = process.env.NEXT_PUBLIC_META_ES_CONFIG_ID?.trim()
  if (!appId || !appSecret || !configId) return null
  return { appId, appSecret, configId }
}

export interface ExchangeCodeForTokenArgs {
  code: string
  appId: string
  appSecret: string
}

/**
 * Exchange the short-lived code the popup handed the browser for the
 * customer's Business Integration System User access token.
 *
 * Note there is deliberately **no `redirect_uri`**: Embedded Signup
 * codes are minted for the JS SDK, not for a redirect-based OAuth
 * round-trip, and sending one makes Meta reject the exchange. The token
 * that comes back is already long-lived — there is no second
 * short-lived → long-lived step the way there is for Facebook Login.
 */
export async function exchangeCodeForToken(
  args: ExchangeCodeForTokenArgs
): Promise<string> {
  const { code, appId, appSecret } = args
  const url = new URL(`${META_API_BASE}/oauth/access_token`)
  url.searchParams.set('client_id', appId)
  url.searchParams.set('client_secret', appSecret)
  url.searchParams.set('code', code)

  const response = await fetch(url, { method: 'GET' })
  if (!response.ok) {
    await throwMetaError(response, `Token exchange failed: ${response.status}`)
  }

  const data = (await response.json()) as { access_token?: string }
  if (!data.access_token) {
    throw new Error('Meta returned no access_token for the signup code.')
  }
  return data.access_token
}

export interface ResolveWabaIdFromTokenArgs {
  accessToken: string
  appId: string
  appSecret: string
}

/**
 * Recover the WABA id from the freshly minted token.
 *
 * The `postMessage` the popup sends usually carries `waba_id`, but the
 * coexistence completion event is documented as being allowed to omit
 * parts of the session payload, and a popup blocked mid-flight can drop
 * the message entirely while the `FB.login` callback still succeeds. In
 * both cases the token itself still knows: `/debug_token` lists the WABA
 * ids the customer granted under the `whatsapp_business_management`
 * granular scope.
 *
 * Returns null rather than throwing — the caller has a better error to
 * raise than "debug_token said nothing".
 */
export async function resolveWabaIdFromToken(
  args: ResolveWabaIdFromTokenArgs
): Promise<string | null> {
  const { accessToken, appId, appSecret } = args
  const url = new URL(`${META_API_BASE}/debug_token`)
  url.searchParams.set('input_token', accessToken)
  // App access token, per Meta's docs — the app-id|app-secret form
  // avoids a second round trip to mint one.
  url.searchParams.set('access_token', `${appId}|${appSecret}`)

  const response = await fetch(url, { method: 'GET' })
  if (!response.ok) return null

  const data = (await response.json()) as {
    data?: {
      granular_scopes?: { scope: string; target_ids?: string[] }[]
    }
  }

  const scope = data.data?.granular_scopes?.find(
    (s) => s.scope === 'whatsapp_business_management'
  )
  return scope?.target_ids?.[0] ?? null
}

export interface ListWabaPhoneNumbersArgs {
  wabaId: string
  accessToken: string
}

/**
 * List the business phone numbers under a WABA.
 *
 * `platform_type` is the field that matters here — it is what tells a
 * coexistence number (`SMB_APP`) from a Cloud API one, and therefore
 * what `connection_type` the config row gets and whether /register is
 * safe to call.
 */
export async function listWabaPhoneNumbers(
  args: ListWabaPhoneNumbersArgs
): Promise<WabaPhoneNumber[]> {
  const { wabaId, accessToken } = args
  const url = `${META_API_BASE}/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,platform_type`
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) {
    await throwMetaError(response, `Meta API error: ${response.status}`)
  }
  const data = (await response.json()) as { data?: WabaPhoneNumber[] }
  return data.data ?? []
}
