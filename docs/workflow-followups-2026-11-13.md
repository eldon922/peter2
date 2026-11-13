# Workflow follow-ups — 13 November 2026

Based on the intentionally selected remote `dev` at `5522945`. No database migration is needed for these changes.

| Request | Result |
| --- | --- |
| 1 | Conversion notices compare stable phone/provenance values instead of refreshed object identity. |
| 2 | Contact panels and notes tabs constrain scrolling and wrap long notes. |
| 3 | Delete is the last message action. |
| 4 | Excluded tags use FilterX, distinct from the include filter. |
| 5 | Numbered navigation is shared across contacts, inbox, broadcast recipients, audience lists and paged import reports. Large ranges use ellipses. |
| 6 | Sync ignores equivalent empty fields and rotating Meta sample signatures, refreshes cached sample URLs separately, and reports changed-template counts. |
| 7 | Verified the shared sidebar logo already follows its first menu item on every dashboard route, including nested broadcast routes. |
| 8 | One short localized hint explains numbered versus named variables and samples. |
| 9 | The removed-contact label stays beside the name. |
| 10–11 | Import reports show new, updated and skipped first; names, phones, tag chips and changes have separate readable layouts. |
| 12 | Audience summaries show expandable excluded-recipient and converted-number lists. |
| 13 | Personalization and review message previews expand without their own scrolling region. |
| 14 | Wizard step buttons fill their item and show a pointer cursor. |
| 15–17 | Formatting toggles markers, toolbars sit near selected text, template bodies support formatting, and rich clipboard content becomes WhatsApp markup without rendering pasted HTML. |
| 18 | Template submission shows sending and refresh stages. The form stays locked during the request; no fabricated percentage is shown. |
| 19 | Drafts and failed submissions can be edited; resubmitting an account-scoped draft updates its existing row. Submitted Meta templates retain Meta's edit restrictions. |
| 20 | Every template status has a read-only details action, including for viewers. |
| 21 | Step 3 previews a selected audience recipient, including CSV entries, instead of the newest unrelated contact. |
| 22–23 | Variable sources default to contact fields; a sole custom field is selected automatically. |
| 24 | Step changes reset the main wizard scroll position. |

Validation:

- 1,131 unit tests across 114 files passed, including draft authorization/update tests, formatting toggles, sync comparisons and excluded-audience membership.
- TypeScript and the production build passed. The build required network access for the existing Google Fonts dependency.
- Browser checks passed at 375px and 1440px: chat/template formatting in light and dark themes, rich paste, draft editing, read-only preview, long-note scrolling, numbered recipient pages, converted CSV lists, audience preview names, contact-field defaults and step scroll reset. Sidebar logo destinations were checked across the dashboard routes.
- Lint has the same 25 pre-existing error signatures as the recorded baseline; no new error signatures were introduced.

Browser tests use real components with fixture data. No live Meta submission or production database write was made. Evidence is under `/workspace/work/followups-24-*` and `/workspace/work/workflow-ui/nov13-*`.
