# Workflow UI refinement

Status: approved by the user on 2026-11-06. Implement approach 2 below.

## Intent and scope

Make the contacts, broadcasts and inbox features added in this session feel like one coherent CRM. Operators need to choose recipients, check a personalized message and send with confidence; import a CSV without losing the preview or actions; and reply without helper controls crowding the conversation.

Preserve the existing accent choices, fonts, light/dark modes, translations, permissions, data handling, pagination, send confirmations and retry safeguards. This is a focused refinement of the existing product, not a new visual identity or backend project.

## Approaches

1. **Spacing and color fixes only:** small changes, but the long stacked forms and crowded controls remain.
2. **Restructure the affected workflows (recommended):** give forms, previews, feedback and actions distinct roles using the existing design system. Keep the same steps and behavior.
3. **Replace the whole dashboard design:** broader consistency work, but affects unrelated settings, navigation and workflows.

The user approved approach 2: refine the affected workflows within the existing visual system.

## Broadcasts

- Keep the four-step flow, with a readable current step on small screens and clear completed states.
- On desktop, place personalization controls and the message preview side by side. Keep the preview visible while editing a long form. On mobile, stack them in task order.
- Keep preview provenance explicit: Personalize uses its current contact/sample fallback; Review uses a resolved audience contact. Do not suggest that the Personalize sample is the chosen recipient.
- Group header, body and button variables with clear labels and a consistent control layout. Use field names and meaningful empty/loading states. Associate each label with its control.
- Put incomplete-mapping feedback next to the affected field and use readable warning colors in both themes, with a short summary by Next.
- Give review details a compact summary. Make recipient count, send time and the final action easy to find. Use one clear primary action and consistent secondary actions.
- Make send, schedule, start and retry confirmation dialogs use the same header/body/footer structure. Keep actions reachable while their bodies scroll, including at short viewport heights.
- Preserve scheduling's date/time selection followed by message confirmation, and retain Send now, Schedule and Save draft as existing actions.
- Keep all existing checks and the personalized message preview before sending.

```text
Create broadcast                         Template > Audience > Personalize > Review

Personalize your message                    Message preview
  Header / body / button fields              Recipient sample
  Source        Value                        WhatsApp message and buttons
  Media                                      Formatting control

Back                                                        Next: review
```

## Contact import

- Keep a short fixed title and an anchored action footer. Put instructions, upload, tags and preview in the scrollable body so a tall header cannot squeeze out the preview on phones.
- Use a full upload area initially and a compact filename/status row once a file is chosen.
- Put the populated data preview before optional tag controls, so the next task is checking the contacts that will be imported.
- Put detailed CSV and merge rules behind a clearly labeled disclosure. Keep required-column guidance visible.
- Present preview, progress and results as distinct states with legible text and semantic success/warning/error colors in both themes.
- Keep existing/custom fields and tag results available. Confine wide-table scrolling to the table region.
- Keep importing feedback and completion actions in consistent positions. Preserve existing import behavior and reports.
- Preserve restrictions on closing while an import is running, and keep every partial-success and failure report available.

```text
Import contacts                                                   Close
  Choose CSV / selected-file row
  CSV guidance (expandable)
  Preview / importing / result
  Additional tags
  [only this body scrolls]
Cancel                                             Import N contacts
```

## Inbox and list controls

- Group formatting with the composer, use labeled accessible controls, and improve focus visibility and touch targets.
- Make phone-format guidance a quiet note instead of a competing warning strip. Keep session-expired and removed-contact states prominent because they change available actions.
- Keep formatted previews compact and separately identifiable. Preserve reply, attachment, draft and read-only behavior.
- Align recipient search, filters and export controls; let them reflow on narrow screens. Give inbox and recipient pagination readable counts and accessible previous/next actions.

## Craft and acceptance checks

- Use existing neutral surfaces and accent tokens, a consistent spacing rhythm and restrained borders. Do not add decorative gradients, display fonts, new packages or ornamental motion.
- Verify real components in the browser at phone, tablet and desktop sizes; test light and dark themes, long names/URLs, populated and empty states, and keyboard access.
- Verify that required variable mappings still block Next; send and schedule still require confirmation; imports still preserve blank custom values and show failures; viewer permissions and pagination still hold.
- Run relevant tests, TypeScript, lint and a production build. Keep screenshots and a concise validation record. Commit each workflow improvement separately to dev, with the solution explained in its commit body, then push.

## Review limits

Browser review uses real components with local fixture data and mocked authentication/services. It does not send WhatsApp messages, change hosted data or prove the live deployment's network behavior.
