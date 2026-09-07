/**
 * Shared `whatsapp_config` invariants.
 *
 * The manual connect form (`/api/whatsapp/config`) and Embedded Signup
 * (`/api/whatsapp/embedded-signup`) write the same row from two very
 * different directions, but they have to agree on the rules that keep
 * inbound message routing working. Those rules live here so there is
 * one copy of each.
 */

import { supabaseAdmin } from '@/lib/flows/admin-client'

/**
 * Return the account_id of a *different* account that has already
 * claimed this phone_number_id, or null when the number is free.
 *
 * wacrm is single-tenant-per-WhatsApp-number. Letting two accounts bind
 * the same number makes the webhook's phone_number_id lookup return
 * multiple rows, and every inbound message for that number is silently
 * dropped (issue #136). Post-multi-user the conflict is between
 * accounts, not users — teammates inside one account share a config.
 *
 * This has to run under the service role: RLS hides other accounts'
 * rows from the caller's own session, so a conflict would be invisible
 * from a user-scoped client.
 *
 * Throws on a query failure so callers fail closed rather than treating
 * "we could not check" as "the number is free".
 */
export async function findConflictingAccount(args: {
  phoneNumberId: string
  accountId: string
}): Promise<string | null> {
  const { phoneNumberId, accountId } = args

  const { data, error } = await supabaseAdmin()
    .from('whatsapp_config')
    .select('account_id')
    .eq('phone_number_id', phoneNumberId)
    .neq('account_id', accountId)
    .maybeSingle()

  if (error) {
    console.error('Error checking phone_number_id ownership:', error)
    throw new Error('Failed to validate configuration')
  }

  return (data?.account_id as string | undefined) ?? null
}

/**
 * The message shown when {@link findConflictingAccount} finds one.
 * Shared so both routes say the same thing — operators comparing the
 * two paths should not get two different explanations of one rule.
 */
export const PHONE_NUMBER_CLAIMED_MESSAGE =
  'This WhatsApp phone number is already linked to another account on this instance. Each phone number can only be connected to one wacrm user.'
