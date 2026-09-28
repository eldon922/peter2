-- ============================================================
-- Broadcast media by Meta media id (upload path)
--
-- Migration 037 gave broadcasts a `header_media_url` so a media-header
-- template's send-time image/video/document could be recorded and
-- replayed on retry. That path always makes Meta fetch the URL fresh
-- on every single recipient send — fine for one message, slow for a
-- broadcast, because Meta re-downloads the same file thousands of
-- times.
--
-- Meta's "Upload Media" endpoint (POST /{phone-number-id}/media)
-- uploads the file once and returns a reusable media `id`; passing
-- `{ id }` instead of `{ link }` in the send skips that per-recipient
-- fetch entirely. `header_media_id` stores that id the same way
-- `header_media_url` stores the link, so a retry reproduces whichever
-- one the original send actually used.
--
-- Both columns are nullable and independent: a broadcast has at most
-- one populated, and `template-send-builder.ts` already prefers
-- `headerMediaId` over `headerMediaUrl` when both are supplied.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE broadcasts
  ADD COLUMN IF NOT EXISTS header_media_id TEXT;

COMMENT ON COLUMN broadcasts.header_media_id IS
  'Meta media id (from the Upload Media endpoint) used for an IMAGE/VIDEO/DOCUMENT header template. Preferred over header_media_url when present — it avoids Meta re-fetching a link on every recipient send.';
