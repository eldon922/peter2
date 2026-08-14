-- ============================================================
-- 041_whatsapp_config_meta_app.sql — Meta App ID / App Secret
--
-- Why
--
--   `META_APP_ID` and `META_APP_SECRET` were environment variables, so
--   they could only be set by whoever deploys the app — and only once
--   for the whole instance. Two problems:
--
--     1. A self-hoster who has the app running cannot finish the Meta
--        setup without shell access and a restart, even though every
--        other credential (phone number id, WABA id, access token,
--        verify token) is entered in Settings.
--     2. One instance serving several accounts, each with its own Meta
--        app, has no way to hold more than one app secret — webhook
--        signature verification can only ever match one of them.
--
--   Moving both onto `whatsapp_config` puts them beside the credentials
--   they belong with, per account.
--
-- Shape
--
--   `app_id` is not a secret (it appears in Meta's dashboard URLs and
--   in client-side SDK config), so it is stored in the clear.
--
--   `app_secret` IS a secret — it is the HMAC key Meta signs webhook
--   payloads with. Stored encrypted with the same AES-256-GCM
--   `encrypt()`/`decrypt()` helper as `access_token` and
--   `verify_token`, so a database dump does not hand over the ability
--   to forge webhook deliveries.
--
-- Compatibility
--
--   Both columns are nullable. The env vars remain a fallback: an
--   existing deployment keeps working untouched, and the column takes
--   precedence when set. Nothing needs to be migrated.
--
-- No RLS changes: `whatsapp_config` policies (migration 017) already
-- restrict SELECT to account members and writes to admin+.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS app_id TEXT,
  ADD COLUMN IF NOT EXISTS app_secret TEXT;

COMMENT ON COLUMN whatsapp_config.app_id IS
  'Meta App ID (Meta for Developers → App Settings → Basic). Not secret; '
  'used for the Resumable Upload API when submitting image-header templates. '
  'Falls back to the META_APP_ID env var when NULL.';

COMMENT ON COLUMN whatsapp_config.app_secret IS
  'Meta App Secret, AES-256-GCM encrypted (same helper as access_token). '
  'The HMAC key for x-hub-signature-256 on inbound webhooks. '
  'Falls back to the META_APP_SECRET env var when NULL.';
