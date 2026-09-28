-- ============================================================
-- Track when a broadcast's Meta media id was uploaded
--
-- Meta keeps files uploaded via POST /{phone-number-id}/media for
-- 30 days, after which the returned media `id` stops working.
-- Migration 046 stores that id on the broadcast so retries can reuse
-- it, but without an upload time a retry after day 30 would send a
-- dead id to every recipient.
--
-- `header_media_uploaded_at` lets planBroadcastRetry detect an aged id
-- and ask for fresh media instead of sending it.
--
-- Backfill: rows that already have an id get `created_at`. The real
-- upload happened at or before that moment, so this can only make an
-- id look older than it is — it errs toward asking for a re-upload,
-- never toward sending an expired id.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE broadcasts
  ADD COLUMN IF NOT EXISTS header_media_uploaded_at TIMESTAMPTZ;

UPDATE broadcasts
   SET header_media_uploaded_at = created_at
 WHERE header_media_id IS NOT NULL
   AND header_media_uploaded_at IS NULL;

COMMENT ON COLUMN broadcasts.header_media_uploaded_at IS
  'When header_media_id was uploaded to Meta. Meta drops uploaded media after 30 days, so retries treat an older id as expired and ask for fresh media.';
