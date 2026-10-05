-- ============================================================
-- Template "DELETED" status
--
-- "Sync from Meta" now marks local templates that no longer exist on
-- Meta (deleted there) so they stay visible but are clearly flagged and
-- can't be picked for sending. Adds 'DELETED' to the allowed statuses.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE message_templates
  DROP CONSTRAINT IF EXISTS message_templates_status_meta_check;

ALTER TABLE message_templates
  ADD CONSTRAINT message_templates_status_meta_check
  CHECK (status IN (
    'DRAFT',
    'PENDING',
    'APPROVED',
    'REJECTED',
    'PAUSED',
    'DISABLED',
    'IN_APPEAL',
    'PENDING_DELETION',
    'DELETED'
  ));
