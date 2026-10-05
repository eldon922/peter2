-- ============================================================
-- contacts.profile_name — the name on the customer's WhatsApp profile
--
-- Inbound messages used to overwrite contacts.name with the sender's
-- WhatsApp profile name, wiping any name set in the CRM. The profile
-- name now lives in its own column and `name` is left alone. The UI
-- shows "Name (Profile name)" when the two differ.
--
-- No backfill: existing rows genuinely don't record which name came
-- from where.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS profile_name TEXT;

COMMENT ON COLUMN contacts.profile_name IS
  'Name from the customer''s WhatsApp profile, refreshed on inbound messages. Never overwrites contacts.name.';
