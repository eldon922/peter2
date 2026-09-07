# Embedded Signup & WhatsApp coexistence

By default, connecting a number in wacrm means an admin pastes a phone
number ID, WABA ID, permanent access token and 2FA PIN into
**Settings → WhatsApp**. That works everywhere and stays the default.

If you are an approved Meta **Tech Provider**, you can instead offer
Meta's [Embedded Signup](https://developers.facebook.com/docs/whatsapp/embedded-signup)
flow: your customer clicks one button, completes a Facebook pop-up, and
lands connected — no credentials to copy, nothing to explain.

The same flow onboards a number **already in use in the WhatsApp
Business app** on someone's phone. Meta calls this *coexistence*: the
owner keeps replying from their phone, and those messages show up in the
wacrm shared inbox alongside everything else.

> **Most self-hosters should skip this page.** Embedded Signup needs an
> approved Tech Provider app: business verification, App Review for
> `whatsapp_business_management` and `whatsapp_business_messaging`, and a
> configured signup flow. Without one, leave the variables below unset —
> the WhatsApp settings panel behaves exactly as it always has.

## What it changes

| | Manual | Embedded Signup |
| --- | --- | --- |
| Credentials | Customer pastes 6 fields | Customer clicks a button |
| `POST /{phone_number_id}/register` | wacrm calls it with the 2FA PIN | Skipped — Meta registers the number during the flow |
| Webhook verify token | Per account, in Settings | Once, on your app (`META_WEBHOOK_VERIFY_TOKEN`) |
| App secret | Per account, in Settings | Once, on your app (`META_APP_SECRET`) |
| Business-app messages | Not visible | Mirrored into the inbox (coexistence) |

Each connection records how it got there in
`whatsapp_config.connection_type` (`manual` / `embedded_signup` /
`coexistence`, [migration 042](../supabase/migrations/042_whatsapp_coexistence.sql)).
Coexistence numbers have no two-step PIN, so the PIN field disappears for
them rather than asking for something that does not exist.

## Setup

### 1. Configure the Meta app

In **Meta for Developers → your app**:

1. **WhatsApp → Embedded Signup** — create a configuration and copy its
   **configuration ID**. To offer coexistence, the configuration must
   permit onboarding existing WhatsApp Business app accounts.
2. **App Settings → Basic** — copy the **App ID** and **App Secret**.
3. **WhatsApp → Configuration → Webhook** — set the callback URL to
   `https://your-domain/api/whatsapp/webhook` and a verify token of your
   choosing. Subscribe at least to `messages`, and add
   **`smb_message_echoes`** so messages sent from the Business app reach
   you. (`history` and `smb_app_state_sync` carry past chats and the
   Business-app address book; wacrm does not consume them yet.)
4. **App Settings → Basic → App Domains** and the Facebook Login
   settings must include the domain you serve wacrm from — the pop-up
   will refuse to open otherwise.

### 2. Set the environment variables

```bash
# Server-side
META_APP_ID=your-app-id
META_APP_SECRET=your-app-secret
META_WEBHOOK_VERIFY_TOKEN=the-verify-token-you-typed-into-meta

# Client-side — inlined at build time
NEXT_PUBLIC_FACEBOOK_APP_ID=your-app-id
NEXT_PUBLIC_META_ES_CONFIG_ID=your-embedded-signup-configuration-id
```

`NEXT_PUBLIC_*` variables are baked into the bundle at build time, so a
Docker deploy must pass them as **build args**, not just runtime env —
`docker-compose.yml` already forwards both. Changing either one requires
`docker compose up --build`.

The button appears only when `NEXT_PUBLIC_FACEBOOK_APP_ID` **and**
`NEXT_PUBLIC_META_ES_CONFIG_ID` are both set. `META_APP_ID` /
`META_APP_SECRET` are checked server-side; if the build has the public
pair but the server lacks the secret pair, the connect request fails with
a 503 that says so.

### 3. Apply the migration

Run [`supabase/migrations/042_whatsapp_coexistence.sql`](../supabase/migrations/042_whatsapp_coexistence.sql)
against your Supabase project.

## What the customer sees

**Settings → WhatsApp** gains a *Connect with Facebook* card at the top,
and the manual credential fields collapse behind a **"Connect manually
instead"** disclosure — still there for a Meta test number, a number the
pop-up will not offer, or re-pasting a rotated token.

After a successful connect, a badge records whether the number arrived
through Embedded Signup or through the WhatsApp Business app.

## How coexistence messages flow

- **Customer → business**: normal `messages` webhook, exactly as for any
  Cloud API number.
- **Business → customer, sent from wacrm**: normal outbound send.
- **Business → customer, sent from the WhatsApp Business app**: arrives
  on the `smb_message_echoes` webhook and is stored as an *agent*
  message. It does not increase the conversation's unread count (nobody
  on the team needs to catch up on it), and it does not trigger
  automations, flows or AI auto-reply — those fire on inbound messages
  only, and running them on your own outbound traffic would loop.

Messages wacrm sent itself are echoed back by Meta too; they are matched
on Meta's message ID and skipped rather than duplicated.

## Troubleshooting

**The button does not appear.** Both `NEXT_PUBLIC_*` variables must be
present *at build time*. Rebuild after setting them.

**"Could not determine which WhatsApp Business Account was connected."**
The pop-up's session message never arrived — usually a pop-up blocker.
The server falls back to reading the WABA off the token, so this means
both routes failed; retry with pop-ups allowed.

**"This WhatsApp Business Account has more than one phone number."**
wacrm binds one number per account and will not pick for you. Re-run the
signup selecting a single number, or connect that number manually.

**Meta's webhook verification fails.** Under Embedded Signup there is no
per-account verify token to match, so `META_WEBHOOK_VERIFY_TOKEN` must be
set on the server and must equal what you typed into Meta.

**Messages sent from the phone never appear.** Check that
`smb_message_echoes` is ticked in your app's WhatsApp webhook fields —
it is not subscribed by default.
