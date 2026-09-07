-- ============================================================
-- 042_whatsapp_coexistence.sql — how the number was connected
--
-- Why
--
--   Until now every `whatsapp_config` row got there the same way: an
--   admin pasted a phone number id, a permanent access token and a
--   6-digit 2FA PIN into Settings → WhatsApp, and the save path called
--   POST /{phone_number_id}/register on their behalf.
--
--   Embedded Signup adds two more origins, and one of them cannot take
--   that code path:
--
--     - 'embedded_signup' — a Cloud API number provisioned inside
--       Meta's Embedded Signup popup. Meta registers it as part of the
--       flow, so calling /register again is redundant.
--     - 'coexistence'     — a number that is already live in the
--       WhatsApp Business app on someone's phone, onboarded with
--       featureType=whatsapp_business_app_onboarding. It is registered
--       *through the Business app* and exposes no two-step PIN to us.
--       Calling /register on it is not merely redundant, it is wrong.
--
--   Without a recorded origin the save path has no way to tell these
--   apart from a manual save that simply arrived without a PIN, and
--   the UI cannot explain to the operator how their number got here.
--
-- Shape
--
--   Text + CHECK rather than a Postgres enum: the existing status /
--   sender_type / content_type columns in this schema are all
--   CHECK-constrained text, and widening a CHECK later is a one-line
--   migration where widening an enum is not.
--
--   NOT NULL DEFAULT 'manual' — every row that exists today got here
--   through the manual form, so the default is not a placeholder, it
--   is the correct value for all of them.
--
-- No RLS changes: `whatsapp_config` policies (migration 017) already
-- restrict SELECT to account members and writes to admin+.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS connection_type TEXT NOT NULL DEFAULT 'manual';

-- Added separately from the column so a re-run against a database that
-- already has the column still installs the constraint.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_config_connection_type_check'
  ) THEN
    ALTER TABLE whatsapp_config
      ADD CONSTRAINT whatsapp_config_connection_type_check
      CHECK (connection_type IN ('manual', 'embedded_signup', 'coexistence'));
  END IF;
END $$;

COMMENT ON COLUMN whatsapp_config.connection_type IS
  'How this number was connected. manual = credentials pasted into Settings; '
  'embedded_signup = Cloud API number provisioned through Meta Embedded Signup; '
  'coexistence = number already live in the WhatsApp Business app, onboarded '
  'with featureType=whatsapp_business_app_onboarding. The last two skip '
  'POST /{phone_number_id}/register — Meta has already registered them and a '
  'coexistence number has no two-step PIN to supply.';
