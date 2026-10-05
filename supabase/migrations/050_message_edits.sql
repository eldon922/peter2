-- ============================================================
-- Customer message edits
--
-- A customer can edit a WhatsApp message they already sent. The webhook
-- now applies the edit to the stored message and keeps what it replaced:
--
--   edited_at    when the latest edit happened (NULL = never edited)
--   edit_history earlier versions, oldest first:
--                [{ "text": "…", "at": "2026-…Z" }, …]
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS edited_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS edit_history JSONB;

COMMENT ON COLUMN messages.edited_at IS
  'When the customer last edited this message on WhatsApp. NULL if never edited.';
COMMENT ON COLUMN messages.edit_history IS
  'Earlier versions of an edited message, oldest first: [{text, at}].';
