-- ============================================================
-- whatsapp_config: distinguish WHY /register failed
--
-- last_registration_error (migration 015) is a human-readable Meta
-- error string — fine for display, useless for branching logic. One
-- failure mode needs its own UI path: Meta error 133005, "Two step
-- verification PIN Mismatch", means the number already has 2FA
-- enabled with a PIN we don't know (common on a re-connect, or any
-- number that was ever registered outside this app). Retrying
-- /register with another self-generated PIN can never succeed there
-- — the settings panel needs to ask the customer for the number's
-- ACTUAL PIN instead of just showing a generic error and a dead-end
-- "try again" button.
--
-- This column is that signal. NULL means either "no error" or "an
-- error we don't have special handling for" — last_registration_error
-- still carries the message either way.
--
-- Backfill: nullable, no default. Existing failed rows simply show
-- the generic failure message until the next /register attempt
-- re-populates this from a real Meta response.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS last_registration_error_code TEXT;
