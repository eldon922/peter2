# Workflow follow-up validation

Completed on 2026-11-12 (Asia/Bangkok), starting from `dev` at `72affc7` after pulling. Followed AGENTS.md, CLAUDE.md, Superpowers execution/review guidance and Impeccable interaction guidance. Each feature or fix has a separate commit explaining its solution and validation.

## Delivered

- Inbox: unread **message** total in the sidebar; consistent local/international contact identity; conditional conversion guidance in details and beside the header phone; restored AI draft hint; selection-only formatting with keyboard access; active-row strip and background; chat deletion in contact details.
- Contacts: matching adjacent include/exclude tag filters and an export modal for all contacts, selected tags or untagged contacts. Every exported contact retains all its tags.
- Templates: new-template language follows the app locale; localized named-variable examples explain styles and samples.
- Broadcasts: correct reply/reaction attribution, a right-hand audience summary, bottom-aligned sticky actions, validated navigation between visited steps, and conversion guidance scoped to affected recipients.
- Searches: a shared clear action, including Escape, across contacts, conversations, broadcasts, recipients and tag pickers.

Implementation commits run from `aad3738` through `e7312bb`.

## Database deployment

Apply these migrations **before deploying the application changes**:

1. `067_recover_broadcast_engagement.sql` repairs engagement from resolved quotations, customer reactions and persisted reply timestamps, then refreshes counters.
2. `068_contact_phone_identity.sql` adds canonical phone preparation and atomic editing, and updates removed-contact restoration to preserve chat history while reusing the same identity. New application callers require these functions.
3. `069_contact_international_phone_prefix.sql` retains `+` on saved international numbers across all write paths and adds missing prefixes to existing international records. Digits-only matching and WhatsApp sending remain unchanged; legacy local numbers are preserved.

Historical messages with missing quotation context cannot establish which broadcast received a reply. Migration 067 does not guess those assignments or erase existing positive engagement. Counts represent unique recipients, not the number of replies or reactions.

Existing duplicate contact records are not automatically removed. New writes and explicit phone edits prevent canonical aliases; recreating or restoring a removed contact reattaches its history. Existing split conversations can be combined during restoration while preserving their children and state.

These migrations were not applied to the hosted database. No real WhatsApp messages were sent.

## Final review fixes

One independent final review found four important issues and no critical or minor issues. Each was reproduced before its fix and passed its targeted regression afterward.

| Finding | Fix |
| --- | --- |
| Both phone editors could create a legacy alias | Check canonical identity in both UIs and serialize edits in an account-scoped database function; unchanged legacy phones can still receive profile edits. |
| Historical NULL-parent messages could falsely credit a newer campaign | Recover only engagement supported by resolved context, reactions or an existing reply timestamp. |
| Canonical recreation could detach old chats and restoration could create an alias | Prepare matching archived snapshots before insertion; reuse canonical contacts and preserve messages, reactions, files, assignments and unread state when restoring. |
| Keyboard users could not reach the selection toolbar | Shift+Tab enters the toolbar, focus retains selection, and formatting or Escape returns to the editor; ordinary Tab reaches Send. |

## Verification

| Check | Result |
| --- | --- |
| Full test suite | 1,110 tests across 111 files passed |
| TypeScript | Passed, including a separate check after the production build |
| Lint | 0 errors; 48 existing warnings |
| Production build | Passed; existing middleware-convention deprecation remains |
| Whitespace | Passed |
| Browser checks | Passed at 375, 768 and 1440px in light/dark themes, with English, Indonesian and Korean template/import checks |
| PostgreSQL checks | Migration replay/idempotence, engagement attribution, legacy alias edits, removed-contact restoration, child/state preservation and role/account restrictions passed |
| Concurrent database checks | Simultaneous edits accept one identity; simultaneous recreation/restoration keep one contact and the original chat |

Browser checks render the real components with fixture authentication and data services. They cover scoped CSV exports with full tags, custom-field import preservation, local/international CSV deduplication, actual thread deletion confirmation, conditional tooltips, visited-step validation, footer position and keyboard selection. Touch tooltip/formatting controls were also checked; native operating-system selection handles were not simulated. These checks do not establish live Meta delivery or hosted authorization behavior.

SQL ran against a disposable local PostgreSQL 17 database with pgvector. Unchanged migration 051 was skipped because its cron extensions are unavailable in that image. Existing workflow permission, retention and progress checks passed with the new functions installed. No dependencies were added.

Evidence remains under `/workspace/work/`: `followups-fix-tests-final.log`, `followups-fix-types-final.log`, `followups-fix-lint.log`, `followups-fix-build.log`, `followups-fix-browser.log`, `followups-review-green.log`, `followups-alias-import-final.log`, `followups-import-final.log`, `followups-thread-browser.log`, `followups-history-green.log`, `followups-identity-sql.log`, `followups-existing-sql.log` and `followups-concurrency-final.log`. Review and fix notes are in `followups-2026-11-12/`; browser fixtures and screenshots are in `workflow-ui/`.

The subsequent `+` prefix correction passed 153 targeted tests in six files and fresh PostgreSQL checks for migration backfill/idempotence, insert/edit/restore formatting, unchanged normalized uniqueness, phone history, identity and existing workflow permissions. Evidence is in `phone-prefix-tests.log`, `phone-prefix-migrations.log` and `phone-prefix-*-sql.log`. The correction changes database formatting only; no application dependencies or UI code changed.
