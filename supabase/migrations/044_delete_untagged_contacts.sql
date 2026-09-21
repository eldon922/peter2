-- ============================================================
-- 044_delete_untagged_contacts.sql — bulk delete contacts with no tags
--
-- Why
--
--   Migration 040 lets the Contacts page delete everyone carrying a
--   given tag. The mirror-image cleanup — "delete everyone I never
--   tagged" (typically leftovers from an import, or stray inbound
--   numbers that were never triaged) — can't be expressed through it:
--   there is no tag to pass. Client-side it would mean reading every
--   contact id and every contact_tags row, diffing them, and deleting
--   in chunks, with the same unbounded-select / IN-clause limits and
--   half-succeeded failure mode that 025 and 040 document.
--
--   So, as in 040, it is one statement inside one transaction: every
--   untagged contact goes or none does.
--
-- Two functions
--
--   count_untagged_contacts()   — how many the delete would take. The
--                                 UI shows this in the confirmation so
--                                 the user sees a real number.
--   delete_untagged_contacts()  — deletes them; returns the number
--                                 deleted.
--
-- Scoping
--
--   040 derives the account from the tag being deleted. There is no
--   tag here, so the account is resolved from the caller's profile
--   (one account per user — see 017). Both functions raise if the
--   caller has no account rather than silently matching nothing.
--
--   The `c.account_id = v_account_id` predicate is not only a scoping
--   nicety, it is what makes the NOT EXISTS below safe: RLS on
--   contact_tags (`contact_tags_select`, 017) exposes a tag row to
--   the caller exactly when the parent contact is visible to them, so
--   for contacts in the caller's own account every tag row is
--   visible and "no visible tag row" really means "no tag".
--
-- Security
--
--   SECURITY INVOKER (the default), so `contacts_delete` from 017
--   applies unchanged — the caller must be an `agent` or above. A
--   viewer calling delete_untagged_contacts() deletes nothing.
--
--   Deleting a contact cascades to its conversations, messages,
--   notes and custom values as those FKs already specify; broadcast
--   recipients keep their row with a NULL contact_id (004), so
--   historical broadcast counts are not rewritten.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE OR REPLACE FUNCTION public.count_untagged_contacts()
RETURNS BIGINT
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
  v_count BIGINT;
BEGIN
  SELECT account_id INTO v_account_id
  FROM profiles
  WHERE user_id = auth.uid();

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'No account for caller' USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_count
  FROM contacts c
  WHERE c.account_id = v_account_id
    AND NOT EXISTS (
      SELECT 1 FROM contact_tags ct
      WHERE ct.contact_id = c.id
    );

  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_untagged_contacts()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
  v_deleted BIGINT;
BEGIN
  SELECT account_id INTO v_account_id
  FROM profiles
  WHERE user_id = auth.uid();

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'No account for caller' USING ERRCODE = '22023';
  END IF;

  WITH deleted AS (
    DELETE FROM contacts c
    WHERE c.account_id = v_account_id
      AND NOT EXISTS (
        SELECT 1 FROM contact_tags ct
        WHERE ct.contact_id = c.id
      )
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted FROM deleted;

  RETURN v_deleted;
END;
$$;

ALTER FUNCTION public.count_untagged_contacts() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.count_untagged_contacts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.count_untagged_contacts() TO authenticated;

ALTER FUNCTION public.delete_untagged_contacts() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.delete_untagged_contacts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_untagged_contacts() TO authenticated;
