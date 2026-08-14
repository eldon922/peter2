-- ============================================================
-- 039_contact_phone_history.sql — audit trail of contact numbers
--
-- Why
--
--   A contact's number changes for several reasons: an agent corrects
--   a typo, the customer moves to a new number, or `send-message.ts`
--   auto-corrects a trunk-prefix variant after Meta accepts a
--   different form than the one on file. Today all of those overwrite
--   `contacts.phone` in place, so the previous number is gone — and
--   with it any way to answer "who was this thread with before?" or to
--   recognise an old number when it reappears.
--
--   This records the number a contact *used to* have, with the moment
--   it stopped being current. Reading the history plus the live
--   `contacts.phone` gives the full timeline.
--
-- Shape
--
--   One row per change, holding the OLD value. `changed_at` is when it
--   was replaced. `changed_by` is the acting user where one is known —
--   it is NULL for writes made by the service-role client (webhook
--   auto-correction), which is itself informative.
--
--   `account_id` is denormalised onto the row so RLS can scope reads
--   without joining back to `contacts`, matching how every other
--   account-scoped table in this schema is policed.
--
-- Trigger
--
--   Fires only when the normalised form actually differs — reformatting
--   `+1 555 000` to `+1555000` is not a number change and should not
--   litter the history. SECURITY DEFINER so the insert succeeds
--   regardless of which client made the UPDATE; the function writes
--   only values taken from the row being updated, so there is no
--   privilege surface for a caller to steer.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS contact_phone_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  -- The number as it was stored before the change, verbatim.
  phone TEXT NOT NULL,
  -- Digits-only form, so a lookup by old number matches regardless of
  -- how it happened to be formatted at the time.
  phone_normalized TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_contact_phone_history_contact
  ON contact_phone_history (contact_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_phone_history_account
  ON contact_phone_history (account_id);
-- Supports "have we seen this number before?" lookups.
CREATE INDEX IF NOT EXISTS idx_contact_phone_history_normalized
  ON contact_phone_history (account_id, phone_normalized)
  WHERE phone_normalized IS NOT NULL AND phone_normalized <> '';

ALTER TABLE contact_phone_history ENABLE ROW LEVEL SECURITY;

-- Read-only to the app: rows are written exclusively by the trigger
-- below. No INSERT/UPDATE/DELETE policy is granted, so an audit trail
-- cannot be edited or erased through PostgREST — the SECURITY DEFINER
-- trigger bypasses RLS to do the writing.
DROP POLICY IF EXISTS contact_phone_history_select ON contact_phone_history;
CREATE POLICY contact_phone_history_select ON contact_phone_history
  FOR SELECT USING (is_account_member(account_id));

CREATE OR REPLACE FUNCTION public.record_contact_phone_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_normalized TEXT;
  v_new_normalized TEXT;
BEGIN
  -- Mirrors the generated-column expression from migration 022 so the
  -- comparison here agrees with what the unique index considers "the
  -- same number".
  v_old_normalized := regexp_replace(coalesce(OLD.phone, ''), '[^0-9]', '', 'g');
  v_new_normalized := regexp_replace(coalesce(NEW.phone, ''), '[^0-9]', '', 'g');

  IF v_old_normalized IS DISTINCT FROM v_new_normalized
     AND v_old_normalized <> '' THEN
    INSERT INTO contact_phone_history (
      account_id, contact_id, phone, phone_normalized, changed_by
    )
    VALUES (
      OLD.account_id,
      OLD.id,
      OLD.phone,
      v_old_normalized,
      -- NULL under the service-role client (no JWT), which is exactly
      -- how a webhook auto-correction should read.
      auth.uid()
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS record_phone_change ON contacts;
CREATE TRIGGER record_phone_change
  AFTER UPDATE OF phone ON contacts
  FOR EACH ROW
  EXECUTE FUNCTION public.record_contact_phone_change();
