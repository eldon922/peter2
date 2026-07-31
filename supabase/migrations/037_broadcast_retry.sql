-- ============================================================
-- Retry failed broadcast recipients
--
-- Problem this solves:
--   A recipient that Meta rejects lands in broadcast_recipients with
--   status='failed' and a free-text error_message, and that is a dead
--   end — the only way to re-reach those numbers was to build a whole
--   new broadcast, which re-messages everyone who already succeeded.
--   Many of those failures are transient (Meta 5xx, throttling, a
--   token blip, an after() fan-out cut off mid-send).
--
-- Supporting a targeted retry needs four things the schema never
-- recorded:
--
--   1. attempt_count / last_attempt_at — so a retried row is
--      distinguishable from a first attempt.
--   2. phone_attempted — the number ACTUALLY dialled. Nothing stored a
--      phone at all; every read joins contacts, so the UI has always
--      shown the contact's *current* number even for a send made
--      months ago. Worse, the phoneVariants fallback may succeed on a
--      trunk-prefix variant that was never in contacts.phone at all.
--   3. template_params — the resolved positional params actually sent.
--      The wizard persists broadcasts.template_variables (a mapping
--      that can be re-resolved), but the public API path persisted
--      per-recipient params NOWHERE, so an API broadcast could only be
--      retried with blank variables. Storing the resolved values makes
--      a retry an exact replay for both paths.
--   4. broadcasts.header_media_url — required at send time for
--      IMAGE/VIDEO/DOCUMENT header templates and previously held only
--      in the wizard's memory, so a retry could not reproduce it.
--
-- No backfill on any of them. Rows written before this migration
-- genuinely have no record of the number dialled or the params sent,
-- and synthesizing one from contacts.phone would fabricate history.
-- Every consumer falls back to the joined contact when they are NULL;
-- the retry planner refuses (422) rather than sending blank variables
-- when params are unrecoverable and the template needs them.
--
-- Note on attempt_count: it defaults to 1 because inserting a
-- recipient row plans exactly one attempt, which keeps the initial
-- send paths unchanged. A row that never left 'pending' therefore
-- still reads 1 even though nothing was dialled.
--
-- Aggregate count columns on `broadcasts` remain trigger-owned
-- (migrations 003/005) and are untouched here: a retry flips a row
-- failed -> pending -> sent, and the incremental trigger moves
-- failed_count/sent_count on its own.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE broadcast_recipients
  ADD COLUMN IF NOT EXISTS attempt_count   INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS phone_attempted TEXT,
  ADD COLUMN IF NOT EXISTS template_params JSONB;

ALTER TABLE broadcasts
  ADD COLUMN IF NOT EXISTS header_media_url TEXT;

-- The retry planner's hot query: failed rows for one broadcast.
-- Partial so it stays small — failures are the minority of rows.
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_failed
  ON broadcast_recipients (broadcast_id)
  WHERE status = 'failed';

COMMENT ON COLUMN broadcast_recipients.attempt_count IS
  'Send attempts planned for this row. Starts at 1 on insert; incremented when a retry claims the row.';
COMMENT ON COLUMN broadcast_recipients.last_attempt_at IS
  'When a retry last claimed this row. NULL for rows never retried.';
COMMENT ON COLUMN broadcast_recipients.phone_attempted IS
  'The number actually dialled, including the phoneVariants variant Meta accepted. NULL for rows sent before migration 037.';
COMMENT ON COLUMN broadcast_recipients.template_params IS
  'Resolved positional template params actually sent, e.g. ["Jane","#1234"]. Lets a retry replay the exact message. NULL for rows sent before migration 037.';
COMMENT ON COLUMN broadcasts.header_media_url IS
  'Media URL used for an IMAGE/VIDEO/DOCUMENT header template, so a retry reproduces the original send rather than falling back to the template default.';
