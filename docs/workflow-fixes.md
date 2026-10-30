# Contacts, inbox and broadcast fixes

Apply migrations **053–065 in order** before deploying this version. The Replier enum addition (058) must commit before its permissions migration (059). The broadcast attachment picker needs the `broadcast-media` bucket created by 062. Migration 063 stores recipient header values; 064–065 provide the paginated list queries used by this version.

## Contact and chat deletion

Previously, deleting a contact cascaded through its conversations and message records. Uploaded files lived separately in Storage, and browser media caches were not purged by that database cascade.

Deleting a contact now preserves its chat and messages. The inbox shows a removed-contact marker with its saved name and phone number. An agent can save the contact again to reconnect the history, or explicitly delete the chat.

Delete message and Delete chat permanently remove their inbox records and dependent reactions. They remove the deleted items from this browser's message and media caches; unrelated image previews remain usable. Connected inboxes also handle the deletion events. They do not unsend messages on WhatsApp or erase separately stored uploaded files. Historical chats already removed by the old contact cascade cannot be reconstructed by this migration.

## Scheduled audiences

The recipient list is a **snapshot saved when the broadcast is scheduled**. Contacts added to the selected tag afterward are not added automatically. Removing a tag afterward also does not remove its saved recipients. Review the recipient list before starting; recreate the broadcast if it needs a fresh audience.

## Scheduled media

Picked attachments are retained in account-scoped `broadcast-media` storage. Scheduling saves the source URL and uploads it to Meta when the broadcast actually starts. Send now uploads before starting. A later retry can upload the retained source again if its Meta media ID has aged past the safety window.

Older scheduled broadcasts that contain only an expiring Meta ID and no source URL still require a replacement upload. Incoming photos do not include original filenames in Meta's webhook; downloads use an attachment filename when no original name is available.

## Roles and read state

Replier can send replies, attachments, templates and reactions in existing inbox conversations. Contacts, broadcasts, settings, assignment, conversation status and deletion remain read-only for that role. Viewer can inspect chats without clearing their unread indicators. Opening a chat does not send a Meta read receipt in this application.

## Progress and lists

Retry progress uses a saved run total and baseline, so the denominator stays correct after refresh. Durations use recorded start and completion times; old broadcasts without those timestamps cannot show a reliable duration. Scheduled countdowns show a waiting state once the chosen time arrives, until the scheduler starts the send.

Inbox conversations fetch 25 rows per page and broadcast recipients fetch 50. Search, filters and counts run in the database across the full dataset. Opening an off-page conversation or changing list pages preserves the selected thread. Recipient exports fetch the full list only when requested; contact exports include every matching row. Shared buttons show feedback for pending asynchronous handlers; navigation and recipient filters show their own pending state.

## Verification

The regression suite covers named template parameters, unchanged sync results, CSV export, filename handling, audience exclusions, roles and retry progress. `supabase/ci/verify-workflow-fixes.sql` checks filters, chat retention/restoration, deletion, real role policies and persisted retry progress inside a transaction that rolls back its fixtures. `supabase/ci/verify-list-pagination.sql` checks database paging and account isolation. Run both against a disposable database after applying the migrations.

Validated for this change:

- 1,068 tests passed across 107 test files.
- Type checking and the production build passed.
- ESLint reported zero errors and 48 warnings.
- Six original Chromium component checks passed: first-click contact submission during blur validation, CSV audience input, single-choice tag radios, pending button state, template language selection, and the final scheduling confirmation.
- Eight additional Chromium checks passed: pending-send draft preservation, unchanged-refresh scroll position, targeted media eviction, shared templates after no-op sync, required header input/preview, inbox paging/search, recipient paging/search/full export, and off-page chat deep links.
- All new migrations (053–065) applied successfully to a disposable PostgreSQL database. Both SQL check scripts passed with real authenticated role policies, including page boundaries, filter counts, stored headers and cross-account isolation. The unchanged cron migration (051) was excluded from that local replay because the image does not provide its cron/network extensions.

Browser checks used mocked authentication and service responses. No real WhatsApp messages were sent, and the hosted database was not migrated or deployed during this work.

## Review follow-up

- [ac32f05](https://github.com/eldon922/peter2/commit/ac32f05): clear the submitted draft before sending so completion cannot erase the next draft.
- [3ae301c](https://github.com/eldon922/peter2/commit/3ae301c): read templates by account so unchanged shared templates remain visible to teammates.
- [4c3efa4](https://github.com/eldon922/peter2/commit/4c3efa4): evict only deleted media and keep shared image URLs alive while still displayed.
- [4a91afb](https://github.com/eldon922/peter2/commit/4a91afb): collect and preview header variables, then save each recipient's resolved value for scheduling and retry. Legacy retries without a saved header fail before claiming recipients.
- [85bd8f0](https://github.com/eldon922/peter2/commit/85bd8f0): preserve the reader's position during refreshes and incoming messages when scrolled up.
- [74b57e2](https://github.com/eldon922/peter2/commit/74b57e2): replace full-list polling with database pagination and keep full exports and off-page chat selection working.

The cleanup commits reuse pending duplicate-phone lookups, share image-download helpers, derive import tag colors from the existing catalog, and share contact filter arguments between the table and export.

## Request checklist

Each linked commit includes its solution in the commit description. Follow-up commits refine edge cases and validation.

| Request                                 | Result                                                                                                                                                            | Main commit                                                  |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Add Contact needs two clicks            | Submit waits for the pending duplicate lookup and prevents repeat submissions; stale dialog lookups are ignored.                                                  | [b71d92a](https://github.com/eldon922/peter2/commit/b71d92a) |
| CSV input missing in broadcast wizard   | Restored the upload input with parsing, normalized deduplication, preview, errors and loading feedback.                                                           | [442a642](https://github.com/eldon922/peter2/commit/442a642) |
| Space below import actions              | Added bottom spacing to the import modal footer.                                                                                                                  | [b89b30a](https://github.com/eldon922/peter2/commit/b89b30a) |
| Green Approved template chip            | Approved chips use green in both themes.                                                                                                                          | [8a2ba97](https://github.com/eldon922/peter2/commit/8a2ba97) |
| Count emoji reactions                   | Customer reactions to a broadcast message count in Replied/reacted without duplicate increments.                                                                  | [0aab463](https://github.com/eldon922/peter2/commit/0aab463) |
| Untagged tag filter                     | Added untagged options to Contacts, inbox and broadcast audience selection.                                                                                       | [1ed335d](https://github.com/eldon922/peter2/commit/1ed335d) |
| Confirm scheduled broadcasts            | Scheduling requires a personalized message, audience and scheduled-time preview before final confirmation.                                                        | [9a8a01d](https://github.com/eldon922/peter2/commit/9a8a01d) |
| Preserve chat when deleting a contact   | Retain conversations and messages, mark the contact removed, and offer Save contact or Delete chat.                                                               | [33630d6](https://github.com/eldon922/peter2/commit/33630d6) |
| Inbox live updates                      | Recover missed events through visible-page refreshes and focus/online recovery; synchronize deletion and cache changes.                                           | [7a11d8c](https://github.com/eldon922/peter2/commit/7a11d8c) |
| Warn about automatic country codes      | Composer and broadcast wizard show the current server default and explain local-number conversion.                                                                | [2e6b69a](https://github.com/eldon922/peter2/commit/2e6b69a) |
| Preview Start now and Retry             | Both actions require confirmation with the actual recipients and personalized message preview.                                                                    | [de4e4f6](https://github.com/eldon922/peter2/commit/de4e4f6) |
| Live scheduled-broadcast start          | Broadcast lists and detail pages subscribe to updates and refresh before and during sending.                                                                      | [921a811](https://github.com/eldon922/peter2/commit/921a811) |
| Search broadcasts and recipients        | Added broadcast name/template/language search and recipient name/phone search.                                                                                    | [0c7bb68](https://github.com/eldon922/peter2/commit/0c7bb68) |
| Radios for a single choice              | The shared tag picker supports radios; delete-by-tag uses that mode. Multiple-tag actions retain multiple selection.                                              | [608bd3b](https://github.com/eldon922/peter2/commit/608bd3b) |
| Named template variables                | Named placeholders are supported in creation, synchronization, inbox replies, broadcasts, previews and retries.                                                   | [66462dc](https://github.com/eldon922/peter2/commit/66462dc) |
| Logo opens the first menu               | Logo destination comes from the available sidebar items.                                                                                                          | [988e291](https://github.com/eldon922/peter2/commit/988e291) |
| Localize WhatsApp support               | Support text follows the selected English, Indonesian or Korean language.                                                                                         | [8001ff4](https://github.com/eldon922/peter2/commit/8001ff4) |
| Export contacts with all tags           | Export every matching contact across pages, including all of each contact's tags; filters support tagged, all, untagged and exclusions.                           | [767f561](https://github.com/eldon922/peter2/commit/767f561) |
| Improve dark red contrast               | Brightened dark-mode red accents and corrected quote foregrounds.                                                                                                 | [d7c61a1](https://github.com/eldon922/peter2/commit/d7c61a1) |
| Keep downloaded filenames               | Persist original attachment names when available and explicitly name downloads; use a descriptive fallback when Meta supplies no original name.                   | [63f8431](https://github.com/eldon922/peter2/commit/63f8431) |
| Accurate template sync notification     | Compare actual synchronized fields, ignore audit fields and equivalent optional values, and report no change accurately.                                          | [d535511](https://github.com/eldon922/peter2/commit/d535511) |
| Replier role                            | Allow existing-inbox replies, attachments, templates and reactions; other management actions remain read-only as agreed.                                          | [414e315](https://github.com/eldon922/peter2/commit/414e315) |
| Import modal tag field                  | Select existing tags and, for admins, add new tags to the imported rows without replacing CSV tags.                                                               | [8cb4a7c](https://github.com/eldon922/peter2/commit/8cb4a7c) |
| WhatsApp account identity               | Retrieve the connected account's verified display name and profile picture, with saved-account fallbacks.                                                         | [85108e8](https://github.com/eldon922/peter2/commit/85108e8) |
| Running and completed duration          | Persist start/completion times and display elapsed duration during and after a run.                                                                               | [29d986e](https://github.com/eldon922/peter2/commit/29d986e) |
| Loading feedback                        | Shared asynchronous buttons retain a busy state and reject repeat clicks; sidebar navigation, broadcast entries and recipient filtering show pending feedback.    | [c0419fd](https://github.com/eldon922/peter2/commit/c0419fd) |
| Inbox message formatting                | Added formatting controls, keyboard shortcuts and a live preview for chat drafts.                                                                                 | [7e85373](https://github.com/eldon922/peter2/commit/7e85373) |
| Existing tags in import results         | Updated-contact results display existing tags separately.                                                                                                         | [6646b12](https://github.com/eldon922/peter2/commit/6646b12) |
| Inbox and recipient pagination          | Fetch 25 inbox conversations or 50 recipients per page; search/filter counts use the full database, and exports remain complete.                                                   | [845add6](https://github.com/eldon922/peter2/commit/845add6) |
| Excluded audience counts                | Preview actual excluded recipient counts with the same resolution used when sending, including untagged CSV entries.                                              | [c277cf7](https://github.com/eldon922/peter2/commit/c277cf7) |
| Viewer unread/read-receipt behavior     | Viewing as Viewer preserves unread markers; opening a chat does not send a Meta read receipt.                                                                     | [2bdf32d](https://github.com/eldon922/peter2/commit/2bdf32d) |
| Explain contact deletion and files      | Documented the former record cascade, separate file storage and the new history-preserving behavior above.                                                        | [703e159](https://github.com/eldon922/peter2/commit/703e159) |
| Delete message and chat                 | Added confirmed, account-scoped deletion, dependent-record cleanup, preview refresh and browser cache synchronization.                                            | [1510285](https://github.com/eldon922/peter2/commit/1510285) |
| Later tag additions in a scheduled send | Documented that saved recipients are a snapshot; later tag additions are not included.                                                                            | [703e159](https://github.com/eldon922/peter2/commit/703e159) |
| Template language dropdown              | Replaced free text with a native selector of supported language codes.                                                                                            | [6281ab4](https://github.com/eldon922/peter2/commit/6281ab4) |
| Media expiry during long schedules      | Retain the attachment source and upload to Meta when sending starts; retries can upload it again. Older schedules without a source need a replacement attachment. | [ddb99c0](https://github.com/eldon922/peter2/commit/ddb99c0) |
| Contacts exclusion filter               | Apply excluded tags and untagged filters on the server before counts, pagination and export.                                                                      | [1ed335d](https://github.com/eldon922/peter2/commit/1ed335d) |
| Landscape and portrait preview sizes    | Preserve image proportions in inbox, composer and broadcast previews.                                                                                             | [0336826](https://github.com/eldon922/peter2/commit/0336826) |
| Scheduled countdown                     | Display a ticking countdown, then a waiting-to-start state when due.                                                                                              | [35ee930](https://github.com/eldon922/peter2/commit/35ee930) |
| Loading while filtering recipients      | Show pending state for search, status filters and refreshes.                                                                                                      | [dbf0b69](https://github.com/eldon922/peter2/commit/dbf0b69) |
| Retry progress after refresh            | Persist each run's total and baseline so retry progress advances and retains the correct denominator after refresh.                                               | [8ac0453](https://github.com/eldon922/peter2/commit/8ac0453) |
