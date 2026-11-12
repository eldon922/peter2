# Workflow follow-ups

Base: `dev` at `72affc7`, pulled before changes. Follow AGENTS.md and CLAUDE.md; keep changes simple and commit directly to `dev`, with one explained commit per feature/fix. The user's concrete follow-up requirements authorize implementation without another design approval gate.

## Inbox

- [x] Show a numeric unread-message badge beside Inbox.
- [x] Resolve local/international phone aliases consistently across inbound, create, edit, import, API and restoration paths.
- [x] Show conditional conversion guidance in contact details and a header tooltip; remove the composer notice.
- [x] Restore the prior localized AI draft hint and retain its established control.
- [x] Show a selection-only floating toolbar, with touch and keyboard access.
- [x] Restore the active conversation strip alongside its background highlight.
- [x] Put chat deletion in contact details with the existing confirmation and permissions.

## Contacts

- [x] Match and align include/exclude tag filters.
- [x] Add explicit all/selected-tags/untagged export scope and retain all exported tags.

## Templates

- [x] Default new-template language to the selected app locale.
- [x] Explain numbered and named variables with localized examples.

## Broadcasts

- [x] Correct live reply/reaction attribution and conservatively recover provable historical engagement.
- [x] Put the audience summary in the right column on desktop.
- [x] Keep actions sticky at the actual bottom of the wizard.
- [x] Allow navigation to previous/visited steps without bypassing prerequisites.
- [x] Show conversion guidance only for affected audience/recipient numbers.

## Shared controls and verification

- [x] Add clear actions to every search surface through the shared search control.
- [x] Run meaningful identity and engagement regressions plus rendered UI checks.
- [x] Complete one independent final review and one fix pass; reproduce and verify all four findings.
- [x] Run the full suite, TypeScript, lint, build and whitespace checks.
- [x] Verify migrations and account/role restrictions on local PostgreSQL, including concurrency.
- [x] Prepare scoped commits and the [validation/deployment record](../../workflow-followups-validation.md).

Publish directly to `dev`, verify the remote commit against local HEAD and leave a clean worktree. Migrations 067 and 068 must be applied before deploying the application; hosted changes and live WhatsApp sends are outside this execution.
