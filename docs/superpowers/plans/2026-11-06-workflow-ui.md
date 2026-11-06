# Workflow UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved broadcast, contact-import and inbox UI refinement.

**Architecture:** Keep data handling and public component props intact. Restructure existing client components with responsive layouts, semantic form labels and consistent controls. Reuse current UI primitives and translations.

**Tech Stack:** Next.js 16, React 19, Tailwind 4, Base UI, next-intl, Vitest and a local Playwright fixture harness.

**Spec:** `docs/superpowers/specs/2026-11-06-workflow-ui-design.md`

## Global Constraints

- Preserve the existing accent choices, fonts, light/dark modes, translations, permissions, data handling, pagination, send confirmations and retry safeguards.
- Preserve preview provenance and date/time selection followed by send confirmation.
- Preserve restrictions on closing while an import is running, and keep every partial-success and failure report available.
- Do not add decorative gradients, display fonts, new packages or ornamental motion.
- Commit each workflow improvement separately to dev, with the solution explained in its commit body, then push.

## Review Focus

- Long button URLs, field names and translated labels must wrap or scroll within their own region, without page overflow.
- A 375×640 viewport must retain reachable modal actions and meaningful space for the scrolling body.
- Missing or loading contacts/custom fields must not mislabel previews, enable incomplete sends or switch controls between controlled and uncontrolled.
- A pending import/send must preserve duplicate-submission guards, close restrictions and partial-result reports.
- Mobile keyboard order and localized validation must stay understandable in both light and dark themes.

Browser scripts and fixture services live under `/workspace/work/workflow-ui/`, outside product code. The execution ledger is `progress.md` there. Existing fixtures mock only unavailable authentication and services; assertions run against real UI components. Layout-only changes use rendered checks, not tests that duplicate class names.

## Task 1: Broadcast personalization and navigation

**Files:** `src/app/(dashboard)/broadcasts/new/page.tsx`, `src/components/broadcasts/step3-personalize.tsx`, `message-preview.tsx`, `formatting-toggle.tsx`, `header-media-picker.tsx`; `messages/{en,id,ko}.json`.

**Interfaces:** Preserve all component props and variable keys. Continue resolving body, header and button values through the existing variable helpers. Preview sources remain unchanged.

- [ ] Write and run `node /workspace/work/workflow-ui/broadcasts.mjs` against current UI: assert distinct control names and desktop editor/preview alignment. Expect failure on unlabeled controls or stacked preview.
- [ ] Widen the wizard, make the active mobile step readable, group variable controls, put a bounded sticky preview alongside the desktop form and keep actions reachable. Add local, translated required-field guidance and associate each input/select with its variable. Keep field selections controlled from first render.
- [ ] Verify body/header/button requirements still disable Next independently, custom selections display names, long URLs do not overflow, and incomplete mappings are clearly identified. Capture desktop/tablet/mobile light/dark screens.
- [ ] Run relevant variable/header/template tests, TypeScript and scoped lint; commit `fix(broadcasts): clarify personalization and wizard navigation`.

## Task 2: Review, schedule and send confirmations

**Files:** `src/components/broadcasts/step1-choose-template.tsx`, `step2-select-audience.tsx` (matching navigation and selection states), `step4-schedule-send.tsx`, `send-confirmation-dialog.tsx`, `schedule-dialog.tsx`; `messages/{en,id,ko}.json` if needed.

**Interfaces:** Keep `onSend`, `onSchedule`, `onConfirm` and saved-broadcast guards intact; reuse `BroadcastMessagePreview` and existing recipient snapshots.

- [ ] Extend `broadcasts.mjs` with a short-viewport confirmation assertion: footer remains reachable without scrolling the entire modal, and Schedule requires time selection followed by message confirmation. Expect current scrolling-footer layout to fail.
- [ ] Use compact review details, a clear name field and side-by-side preview. Standardize modal header/body/footer regions, loading and error states; make long descriptions and action labels reflow.
- [ ] Verify no send occurs before final confirmation, zero/missing recipients block actions, saved broadcast locks survive, and mobile, long-preview, loading and failure states remain usable.
- [ ] Run schedule/finish/broadcast-core tests and scoped lint; commit `fix(broadcasts): make review and confirmation actions accessible`.

## Task 3: Contact import

**Files:** `src/components/contacts/import-modal.tsx`, `import-report-details.tsx`, `src/components/ui/tag-multi-select.tsx`; `messages/{en,id,ko}.json`.

**Interfaces:** Preserve parse/import/custom-value/tag logic and `ImportModal` props. Optional additional tags apply exactly as before.

- [ ] Write and run `node /workspace/work/workflow-ui/import.mjs`: upload a fixture and assert that a preview row is visible before scrolling at 375×812. Expect failure with the current tall header.
- [ ] Keep title/footer fixed, move instructions into a concise disclosure in the body, compact the chosen-file presentation, put preview before optional tags and improve result hierarchy and semantic colors. Increase tag-removal target without changing selection behavior.
- [ ] Verify initial, parsing, importing, complete and partial-failure states; phone/tablet/desktop layout; long custom fields/tags; blank-value preservation, CSV dedupe and matching returned contacts by phone. Verify close is blocked while importing and errors remain available in the report.
- [ ] Run CSV/import tests, TypeScript and scoped lint; commit `fix(contacts): prioritize import preview and keep actions reachable`.

## Task 4: Inbox composer and list controls

**Files:** `src/components/inbox/message-composer.tsx`, `conversation-list.tsx`, `src/components/phone-country-warning.tsx`, `src/components/ui/list-pagination.tsx`, `src/app/(dashboard)/broadcasts/[id]/page.tsx`; `messages/{en,id,ko}.json`.

**Interfaces:** Preserve composer send/reply/draft/media behavior, role restrictions, list queries, filters and pagination API.

- [ ] Write and run `node /workspace/work/workflow-ui/inbox.mjs`: require a named Send button, readable formatting preview and usable narrow search/pagination. Expect the current unnamed send control to fail.
- [ ] Group composer helpers, quiet country-code guidance, label icon controls and improve target/focus sizes. Reflow recipient controls and pagination at narrow widths; keep counts and loading feedback readable.
- [ ] Verify reply, draft preservation during pending send, viewer read-only controls, filtering and next/previous pages. Capture mobile/tablet/desktop in both themes and check keyboard focus.
- [ ] Run inbox/pagination tests and scoped lint; commit `fix(inbox): simplify composer and responsive list controls`.

## Completion

- [ ] Compare every spec requirement with the rendered components; document any implementation decisions in the ledger.
- [ ] Run full tests, TypeScript, lint and production build. Record screenshots and review limits.
- [ ] Have a fresh reviewer inspect the complete range against spec, plan, browser evidence and the five Review Focus conditions. Address material findings and verify fixes.
- [ ] Update this plan and the validation record, push dev, and verify the remote SHA and clean working tree.
