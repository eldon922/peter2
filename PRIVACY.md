# Privacy policy

wacrm is a **self-hosted template**. The project maintainers never
receive your data: a wacrm install talks to your own Supabase project,
to Meta's WhatsApp Cloud API, and — only if you enable the AI features
— to your chosen AI provider. There is no telemetry, no phone-home, no
analytics endpoint in this codebase.

That also means the privacy policy is *yours* to publish. Whoever runs
the install is the data controller for every contact, message, and
teammate in it, and Meta requires a public privacy policy URL for a
WhatsApp Business app. This file is a starting point drafted against
what this code actually does — the tables it creates, the third parties
it calls, the security controls it applies.

> **This is not legal advice.** It is a technically accurate
> description of the software, written in the shape of a privacy
> policy. Data-protection law depends on your jurisdiction, your
> industry, and how you use the CRM. Have a qualified lawyer review it
> before you publish it.

## How to use this template

1. **Fill in every placeholder.** They are `[IN SQUARE BRACKETS AND
   CAPS]` — `grep -n '\[[A-Z]' PRIVACY.md` lists every one.
2. **Delete what doesn't apply.** Not using the AI reply assistant?
   Remove §7. No outbound webhooks or API keys? Remove those rows. A
   policy that describes processing you don't do is inaccurate in the
   same way as one that omits processing you do.
3. **Add what your fork does.** The moment you add an integration —
   analytics, a payment provider, a support widget, a different AI
   model — it belongs in §8.
4. **Have it reviewed**, then publish it at a stable public URL.
5. **Register that URL** in Meta's app dashboard (App → Settings →
   Basic → Privacy Policy URL) and link it from your CRM's login page
   and your website footer.
6. **Re-read it after every migration** that adds a table holding
   personal data. Appendix A is the inventory to keep current.

Everything below the line is the policy itself.

---

# Privacy Policy

**[COMPANY NAME]**
**Last updated: [DATE]**

## 1. Who we are

[COMPANY NAME] ("we", "us") operates a WhatsApp-based customer
relationship management system at [CRM URL], which we use to
communicate with customers and prospects over WhatsApp and to keep
records of those conversations.

- **Registered address:** [REGISTERED ADDRESS]
- **Privacy contact:** [PRIVACY CONTACT EMAIL]
- **Data protection officer:** [DPO NAME AND CONTACT, OR DELETE THIS
  LINE IF YOU ARE NOT REQUIRED TO APPOINT ONE]
- **EU/UK representative:** [NAME AND CONTACT, OR DELETE THIS LINE]
- **WhatsApp business number:** [WHATSAPP BUSINESS NUMBER]

This policy explains what personal data we collect through that
system, why, who we share it with, and what rights you have.

## 2. Who this policy is about

Two groups, with different data and different legal footing:

**Customers and contacts.** People who message our WhatsApp business
number, or whose details we add to the CRM. We are the controller of
that data.

**Team members.** Our own staff who hold CRM accounts — agents,
admins, the account owner. We are the controller of their account
data too.

We are not the controller of the data Meta holds about your use of
WhatsApp itself. When you message us on WhatsApp, Meta processes that
message as part of running WhatsApp, under
[its own terms and privacy policy](https://www.whatsapp.com/legal/).
Both apply alongside this one.

## 3. What we collect

### 3.1 Contact records

- Phone number (this is the identifier WhatsApp routes on, so it is
  always present)
- Name, email address, company name, profile photo URL — where you
  give them to us or they arrive with your WhatsApp profile
- Tags and custom fields we define (for example lifecycle stage,
  region, product interest)
- Internal notes written by our team about the relationship
- A history of previous phone numbers when a contact's number is
  changed, so older conversations stay findable

### 3.2 Conversations

- The full content of messages exchanged with our business number, in
  both directions, retained after delivery
- Media you send or we send you — images, documents, audio, video —
  and voice notes
- Message metadata: timestamps, delivery and read receipts, WhatsApp
  message IDs, emoji reactions
- Conversation state: open/pending/closed, which agent is assigned,
  unread counts

Media you send us is **not copied into our storage**. It is fetched
from Meta on demand when an agent opens the conversation. Media *we*
send you is uploaded to our storage first, because Meta must be able
to fetch it by URL — those files sit at long, unguessable URLs that
are not listed or indexed, but are readable by anyone holding the URL.

### 3.3 Sales, broadcasts, and automations

- Deals linked to a contact: title, value, currency, pipeline stage,
  expected close date, and any notes our team adds
- Broadcast membership and per-recipient delivery status (sent,
  delivered, read, replied, failed) with timestamps
- Automation and flow run logs recording which rule fired for which
  conversation and what it did

### 3.4 AI features

[DELETE THIS ENTIRE SECTION IF YOU HAVE NOT ENABLED THE AI REPLY
ASSISTANT.]

When an agent asks for an AI-drafted reply, or when the auto-reply bot
is enabled for a conversation, we send the recent **text** of that
conversation to our AI provider ([OPENAI / ANTHROPIC]) to generate a
suggested response. Details in §7.

We also store a usage log — provider, model, token counts, timestamp.
It records *that* a request happened, not what was in it.

### 3.5 Team member accounts

- Name, email address, profile photo
- A password, stored only as a hash by our authentication provider; we
  never see it. Sign-in is by username, which maps to an internal email
  address at [USERNAME EMAIL DOMAIN].
- Role (owner, admin, agent, viewer) and account membership
- Presence: online/away status and a last-seen timestamp, so teammates
  can see who is available
- Invitations issued and accepted, each with an expiring single-use
  token

### 3.6 Technical and security data

- Session cookies that keep you signed in (§13)
- Server logs: inbound webhook events, outbound sends, broadcast
  fan-out, and errors. These record phone numbers and message
  identifiers, but are kept deliberately low-volume and are not used
  to profile anyone.
- API keys created by our team for programmatic access, stored as
  SHA-256 hashes — the plaintext key is shown once at creation and
  never again
- Webhook endpoint URLs we configure, with their signing secrets
  encrypted at rest

### 3.7 What we do not collect

We do not run advertising or analytics trackers in the CRM. We do not
buy contact lists, we do not scrape, and the CRM sends nothing to the
authors of the software it is built on.

## 4. Where the data comes from

- **From you** — when you message our WhatsApp number, fill in a form,
  or give us your details in person
- **From WhatsApp** — your WhatsApp profile name and number arrive
  with your first message
- **From our team** — notes, tags, deal values, corrections
- **From imports** — CSV files of contacts we already hold, for
  example from a previous CRM. Imports are matched against existing
  records by phone number and merged rather than duplicated.

## 5. Why we process it, and our legal basis

| What we do | Why | Legal basis (GDPR Art. 6) |
| --- | --- | --- |
| Reply to your messages, keep the thread | To answer you and honour what was agreed | Contract, or legitimate interests in responding to enquiries |
| Keep contact records and notes | To recognise you next time and give continuity across agents | Legitimate interests in running a customer relationship |
| Track deals through a pipeline | To manage the sales process | Contract or legitimate interests |
| Send broadcasts and template messages | Marketing and service updates | Consent, where required for marketing — see §6 |
| Run automations (auto-replies, tagging, reminders) | To respond promptly and consistently | Legitimate interests |
| Generate AI-assisted replies | To draft faster and more consistently | Legitimate interests — see §7 |
| Keep delivery and read records | To prove a message was sent and diagnose failures | Legitimate interests; legal obligation where record-keeping is required |
| Security, rate limiting, audit logs | To protect the system and its data | Legitimate interests; legal obligation |
| Retain records for tax, accounting, disputes | Compliance | Legal obligation |

Where we rely on legitimate interests, we have weighed them against
your rights, and you can object at any time (§12).

[IF YOU OPERATE OUTSIDE THE EU/UK, REPLACE THIS TABLE'S LEGAL-BASIS
COLUMN WITH THE EQUIVALENT UNDER YOUR LAW, OR REMOVE IT.]

## 6. WhatsApp messaging and opt-in

WhatsApp's own rules, which we follow, mean:

- We message you only after you have opted in — by messaging us first,
  or by giving explicit consent through another channel.
- Outside a 24-hour window after your last message, WhatsApp only lets
  us send pre-approved template messages. We do not use these to
  circumvent an opt-out.
- **You can opt out at any time** by replying STOP, or by writing to
  [PRIVACY CONTACT EMAIL]. We will stop sending marketing messages and
  tag your record accordingly. We may still send you transactional
  messages you have asked for (for example an order update).
- Meta processes every message as part of delivering WhatsApp. See
  Meta's [WhatsApp Business Data Processing Terms](https://www.whatsapp.com/legal/business-data-processing-terms).

> **Operator note — delete before publishing.** wacrm does not handle
> STOP for you. Before you promise it, build it: a keyword automation
> that catches STOP / UNSUBSCRIBE and applies an `opted-out` tag, and a
> habit of excluding that tag from every broadcast audience. Test it
> end to end from a real handset.

## 7. AI processing

[DELETE THIS SECTION IF YOU HAVE NOT ENABLED THE AI FEATURES.]

We use an AI model to help our agents draft replies faster.

**What is sent.** The recent text messages of the conversation being
replied to, plus the business context we have configured (our tone,
our policies) and any relevant excerpts from our internal knowledge
base. Media, attachments, and contact records other than the thread
itself are not sent.

**Where it goes.** To [OPENAI / ANTHROPIC] over an encrypted
connection, using our own API account. Their handling of that data is
governed by their terms — see
[OpenAI's API data policy](https://openai.com/policies/api-data-usage-policies)
/ [Anthropic's privacy policy](https://www.anthropic.com/legal/privacy).
[KEEP ONLY THE PROVIDER YOU USE. CONFIRM WHETHER YOUR CONTRACT WITH
THEM ALLOWS TRAINING ON YOUR DATA, AND STATE THE ANSWER HERE.]

**Knowledge base.** [IF YOU USE SEMANTIC SEARCH: The documents we load
into the assistant's knowledge base — FAQs, policies, product docs —
are also sent to [PROVIDER] once at indexing time to compute
embeddings. Keep personal data out of that knowledge base.]

**Human oversight.** [DESCRIBE YOUR SETUP — for example: "A drafted
reply is reviewed by an agent before sending," or "Auto-reply is
enabled and capped at N automated replies per conversation, after
which the thread is handed to a human."] No decision with a legal or
similarly significant effect on you is made by the model (§15).

## 8. Who we share data with

We do not sell personal data. We share it with the following
processors, each under a data processing agreement:

| Who | What they handle | Why |
| --- | --- | --- |
| **Meta Platforms** (WhatsApp Cloud API) | Message content, phone numbers, media, delivery receipts | Delivering WhatsApp messages |
| **Supabase** | Our entire database, authentication, and file storage — hosted in [SUPABASE REGION] | Running the CRM's data layer |
| **[HOSTING PROVIDER]** | The application server and its logs, in [HOSTING REGION] | Hosting the CRM |
| **[OPENAI / ANTHROPIC]** | Conversation text sent for AI drafting (§7) | AI reply assistance — *omit this row if AI is off* |
| **[YOUR EMAIL PROVIDER]** | Team member email addresses | Only if you have configured SMTP — by default the CRM sends no email and invitations are shared as links |
| **[ANY SYSTEM RECEIVING OUR OUTBOUND WEBHOOKS]** | Conversation and contact events we forward | Integrations we have configured — *omit if unused* |

We may also disclose data to professional advisers, or to authorities
where we are legally required to, and to a buyer if the business is
sold — in which case we will tell you first.

## 9. International transfers

Our infrastructure is located in [REGION(S)]. Meta and
[OPENAI / ANTHROPIC] process data in the United States and elsewhere.
Where data leaves [YOUR JURISDICTION], transfers rely on
[STANDARD CONTRACTUAL CLAUSES / UK IDTA / ADEQUACY DECISION / YOUR
MECHANISM]. Ask us at [PRIVACY CONTACT EMAIL] for a copy of the
safeguards.

## 10. How long we keep it

| Data | Retention |
| --- | --- |
| Contact records | [E.G. WHILE THE RELATIONSHIP IS ACTIVE, THEN 24 MONTHS] |
| Message history and media | [E.G. 24 MONTHS FROM THE LAST MESSAGE] |
| Deals | [E.G. 7 YEARS, FOR ACCOUNTING] |
| Broadcast delivery records | [E.G. 12 MONTHS] |
| Automation and flow logs | [E.G. 90 DAYS] |
| AI usage log (token counts, no content) | [E.G. 12 MONTHS] |
| Server logs | [E.G. 30 DAYS] |
| Team member accounts | Until the account is removed |

Deleting a contact from the CRM also deletes their conversations,
messages, notes, tags, custom field values, and phone-number history.
Deals and broadcast records survive with the link to the contact
removed, so aggregate history stays intact but no longer identifies
anyone.

> **Operator note — delete before publishing.** wacrm applies no
> automatic retention schedule. The rows above are promises *you* have
> to keep, whether by a scheduled job, a documented manual review, or
> a Postgres policy. Do not publish a retention period you have no
> mechanism to honour.

## 11. How we protect it

- **Row-level security** on every database table, so one account
  cannot read another's data even if application code is wrong
- **Encryption in transit** (TLS) everywhere, including the WhatsApp
  webhook
- **Encryption at rest** for the most sensitive secrets — WhatsApp
  access tokens, AI provider keys, and webhook signing secrets are
  stored AES-256-GCM encrypted, not in plaintext
- **Hashed credentials** — passwords are hashed by our authentication
  provider; API keys are stored as SHA-256 hashes
- **Signature verification** on inbound WhatsApp webhooks, and HMAC
  signing on outbound webhooks, so we can tell real events from forged
  ones
- **Role-based access** — agents see the shared inbox, viewers are
  read-only, and only owners and admins can change configuration
- **Rate limiting** on the public API and on the internal endpoints
  that spend money or touch credentials
- **Hardened HTTP headers** — HSTS, `X-Content-Type-Options`,
  `X-Frame-Options`, `Referrer-Policy`, a restrictive
  `Permissions-Policy`, and a Content-Security-Policy
  [wacrm ships the CSP in report-only mode so violations surface
  without breaking a page. Flip it to enforcing in `next.config.ts`
  before you claim it here.]

No system is perfectly secure. If we discover a breach affecting your
personal data, we will notify the relevant supervisory authority
within 72 hours where required, and tell you directly where the risk
to you is high.

## 12. Your rights

Subject to your local law, you can ask us to:

- **Access** the personal data we hold about you, as a copy
- **Correct** anything inaccurate or incomplete
- **Delete** it ("right to be forgotten")
- **Restrict** or **object to** our processing, including any
  processing based on legitimate interests
- **Port** it — receive it in a structured, machine-readable format
- **Withdraw consent** where we relied on it, without affecting what
  we did before you withdrew
- **Opt out of marketing** at any time — reply STOP on WhatsApp or
  write to us

Write to **[PRIVACY CONTACT EMAIL]**. We will respond within
[30 DAYS / YOUR STATUTORY PERIOD]. We may ask you to confirm your
identity — usually by messaging from the WhatsApp number we hold.

If you are unhappy with our response, you can complain to
[YOUR SUPERVISORY AUTHORITY — e.g. your national data protection
authority].

## 13. Cookies

The CRM sets only the cookies needed to sign a team member in and keep
them signed in. These are strictly necessary — the application cannot
work without them — so we do not ask for consent to set them.

Display preferences such as theme and view layout are kept in your
browser's local storage. They stay on your device and are never sent to
our server.

We do not use advertising, tracking, or third-party analytics cookies.

[IF YOUR MARKETING SITE USES ANALYTICS OR ADS, DESCRIBE THEM HERE OR
LINK TO A SEPARATE COOKIE POLICY — THIS SECTION COVERS THE CRM ONLY.]

## 14. Children

The CRM is not intended for children under [16 / YOUR AGE THRESHOLD],
and we do not knowingly collect their data. If you believe a child has
sent us personal data, contact us and we will delete it.

## 15. Automated decision-making

We do not make decisions producing legal or similarly significant
effects about you by automated means alone. Our automations route,
tag, and reply to conversations; AI-generated text assists our agents.
[IF AUTO-REPLY RUNS UNSUPERVISED, SAY SO PLAINLY AND DESCRIBE HOW A
PERSON CAN BE REACHED INSTEAD.]

## 16. Changes to this policy

We will post any update here with a new "last updated" date. If a
change materially affects how we use your data, we will tell you
before it takes effect.

## 17. Contact

Questions, requests, or complaints: **[PRIVACY CONTACT EMAIL]**, or
write to us at [REGISTERED ADDRESS].

---

# Appendix A — Data inventory

For the operator, not for publication. Every table wacrm creates that
holds personal data, and what happens on deletion. Keep it current as
you add migrations.

| Table | Personal data | On contact/user delete |
| --- | --- | --- |
| `contacts` | Phone, name, email, company, avatar URL | Row deleted |
| `contact_tags`, `contact_custom_values`, `contact_notes` | Segmentation and free-text notes about a person | Cascade delete |
| `contact_phone_history` | Previous phone numbers, who changed them | Cascade delete |
| `conversations` | Thread state, last message preview, assignment | Cascade delete |
| `messages` | Full message text, media URLs, WhatsApp message IDs | Cascade via conversation |
| `message_reactions` | Emoji reactions and who sent them | Cascade via message |
| `deals` | Deal value and stage tied to a person | `contact_id` set NULL, row kept |
| `broadcast_recipients` | Per-person delivery/read/reply status | `contact_id` set NULL, row kept |
| `automation_logs`, `flow_runs`, `flow_run_events` | Which rule fired for which conversation | Retained; prune on your own schedule |
| `ai_knowledge_documents`, `ai_knowledge_chunks` | Whatever you loaded — keep personal data out | Manual |
| `ai_usage_log` | Token counts and model, no content | Retained |
| `profiles` | Team member name, email, avatar | Cascade on auth user delete |
| `member_presence` | Online/away, last seen | Cascade on auth user delete |
| `notifications` | In-app notifications referencing contacts | Cascade |
| `api_keys` | SHA-256 hash, prefix, last used | `created_by` set NULL |
| `whatsapp_config`, `ai_configs`, `webhook_endpoints` | Encrypted credentials (not personal data, but breach-critical) | Account-scoped |
| Storage: `avatars`, `chat-media`, `flow-media` | Profile photos and outbound attachments — **public buckets**, readable by URL | Manual |
| `auth.users` (Supabase) | Email, password hash, sessions | Deleted with the user |

# Appendix B — Operator checklist

- [ ] Every placeholder replaced; sections that don't apply deleted
- [ ] Reviewed by a lawyer for your jurisdiction
- [ ] Published at a stable public URL
- [ ] URL registered in Meta's app dashboard, and linked from the CRM
      login page and your website
- [ ] Data processing agreements in place with Meta, Supabase, your
      host, and your AI provider
- [ ] A STOP / UNSUBSCRIBE keyword automation wired up, tagging
      opt-outs and excluded from every broadcast audience — tested
      from a real handset
- [ ] A real mechanism behind each retention period in §10
- [ ] A documented process for handling access and erasure requests
      within your statutory deadline
- [ ] A breach response plan, with the 72-hour notification clock in it
- [ ] Personal data kept out of the AI knowledge base
- [ ] Reviewed again after any migration that adds a table holding
      personal data
