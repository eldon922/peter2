# Contacts, inbox and broadcast fixes

Apply migrations **053–062 in order** before deploying this version. The Replier enum addition (058) must commit before its permissions migration (059). The new broadcast attachment picker also needs the `broadcast-media` bucket created by 062.

## Contact and chat deletion

Previously, deleting a contact cascaded through its conversations and message records. Uploaded files lived separately in Storage, and browser media caches were not purged by that database cascade.

Deleting a contact now preserves its chat and messages. The inbox shows a removed-contact marker with its saved name and phone number. An agent can save the contact again to reconnect the history, or explicitly delete the chat.

Delete message and Delete chat permanently remove their inbox records and dependent reactions. They clear this browser's message and media caches; connected inboxes also handle the deletion events. They do not unsend messages on WhatsApp or erase separately stored uploaded files. Historical chats already removed by the old contact cascade cannot be reconstructed by this migration.

## Scheduled audiences

The recipient list is a **snapshot saved when the broadcast is scheduled**. Contacts added to the selected tag afterward are not added automatically. Removing a tag afterward also does not remove its saved recipients. Review the recipient list before starting; recreate the broadcast if it needs a fresh audience.

## Scheduled media

Picked attachments are retained in account-scoped `broadcast-media` storage. Scheduling saves the source URL and uploads it to Meta when the broadcast actually starts. Send now uploads before starting. A later retry can upload the retained source again if its Meta media ID has aged past the safety window.

Older scheduled broadcasts that contain only an expiring Meta ID and no source URL still require a replacement upload. Incoming photos do not include original filenames in Meta's webhook; downloads use an attachment filename when no original name is available.

## Roles and read state

Replier can send replies, attachments, templates and reactions in existing inbox conversations. Contacts, broadcasts, settings, assignment, conversation status and deletion remain read-only for that role. Viewer can inspect chats without clearing their unread indicators. Opening a chat does not send a Meta read receipt in this application.

## Progress and lists

Retry progress uses a saved run total and baseline, so the denominator stays correct after refresh. Durations use recorded start and completion times; old broadcasts without those timestamps cannot show a reliable duration. Scheduled countdowns show a waiting state once the chosen time arrives, until the scheduler starts the send.

Inbox conversations show 25 rows per page and broadcast recipients show 50. Search and filters apply to the complete loaded dataset, and exports include every matching row. Shared buttons show feedback for pending asynchronous handlers; navigation and recipient filters show their own pending state.

## Verification

The regression suite covers named template parameters, unchanged sync results, CSV export, filename handling, audience exclusions, roles and retry progress. `supabase/ci/verify-workflow-fixes.sql` checks filters, chat retention/restoration, deletion, real role policies and persisted retry progress inside a transaction that rolls back its fixtures. Run it against a disposable database after applying the migrations.
