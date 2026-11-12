# Phone number standardization

Completed on 2026-11-12 (Asia/Bangkok). This replaces the partial prefix-only behavior in migration 069.

Every saved phone value uses `+<country code><number>`. With `DEFAULT_COUNTRY_CODE=62`, local `081234567890` and `81234567890` become `+6281234567890`. Explicit `+` and `00` international inputs preserve their country. Use an explicit international prefix for foreign numbers; unmarked national inputs use the configured default.

The shared country-aware formatter covers contact forms, imports and CSV previews, broadcast audiences, API contact creation, inbound WhatsApp, send-number corrections and template phone buttons. Database rules enforce the saved format on contacts, removed-chat snapshots, phone history, attempted broadcast numbers and template phone buttons. Meta receives its required digits-only value at the send boundary. Meta's phone-number IDs remain identifiers.

Conversion provenance records the original input and the country code actually used. Contact details, the inbox header tooltip, imports and broadcast notices can explain a conversion after the saved number has already been standardized. Changing the installation default does not relabel earlier conversions.

## Apply before deployment

Apply pending migrations in order through `070_standardize_phone_numbers.sql` before deploying the application. The hosted database was not changed during implementation.

For the initial backfill, PostgreSQL cannot read the application's environment. If `DEFAULT_COUNTRY_CODE` is different from `62`, configure the matching database default first. For example, for `44`:

```sql
ALTER DATABASE postgres SET app.default_country_code = '44';
```

Reconnect the migration tool before applying 070. The authenticated phone-format endpoint subsequently keeps each account's database default aligned with the application's environment.

Migration 070 converts existing local records, checks calling codes and restores the uniqueness indexes after merging aliases within each account. It preserves messages, attachments, tags, custom values, notes, reactions, phone history, broadcast records and conversation state. Previous profiles and conflicting custom values are retained in a contact note. If aliases have competing active flows, the most recently advanced run continues and older runs are paused with their history and reason preserved.

The migration is transactional. Invalid phone data stops it rather than inventing a destination or leaving a partial conversion.

## Validation

- Full suite: 1,120 tests in 112 files passed; TypeScript and production build passed.
- Rendered checks: canonical import previews and writes, retained custom fields, inbox tooltips, stored conversion codes, audience previews and conditional notices passed at 375px/1440px in both themes, including English, Indonesian and Korean notices.
- Fresh PostgreSQL: migrations through 069, legacy aliases, then 070 twice; canonical storage, duplicate merging, retained messages/media/tags/custom values, active-flow handling, restoration, role restrictions and existing workflow checks passed. The unchanged cron-extension migration 051 is skipped in the local image.
- Concurrent edits and recreation/restoration checks passed. Calling-code checks include configurable defaults, unknown-code rejection and significant leading zeros for Italy and San Marino.
- Lint reports 25 existing errors, reproduced on unchanged `8d4f61b` with the same installed dependencies; this change adds no errors. Whitespace checks passed.

Evidence is retained under `/workspace/work/standard-phones-*.log` and `/workspace/work/workflow-ui/standard-phones-*.png`. Browser services are fixtures around real components; no live messages were sent.
