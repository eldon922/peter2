-- ============================================================
-- 040_delete_contacts_by_tag.sql — bulk delete by tag
--
-- Why an RPC
--
--   The Contacts page can only select the 25 rows it has loaded, so
--   "delete everyone tagged Churned" meant paging through the list and
--   deleting a screen at a time. Doing it client-side properly would
--   mean reading every matching contact id (the same unbounded-select
--   and IN-clause limits migration 025 documents) and then issuing
--   delete calls in chunks — several round trips, and a partial result
--   if any of them fails halfway.
--
--   This does the whole thing in one statement, inside one transaction:
--   either every tagged contact goes or none does.
--
-- Security
--
--   SECURITY INVOKER (the default), so `contacts_delete` from migration
--   017 applies unchanged — the caller must be an `agent` or above in
--   the owning account, and rows outside their account are invisible to
--   the DELETE. A viewer calling this deletes nothing.
--
--   The tag is additionally checked for account membership up front.
--   Without that, passing a tag id belonging to another account would
--   be a (harmless, but confusing) no-op rather than an error.
--
--   Deleting a contact cascades to its conversations, messages, notes,
--   tags and custom values as those FKs already specify; broadcast
--   recipients keep their row with a NULL contact_id (migration 004),
--   so historical broadcast counts are not rewritten by this.
--
-- Returns the number of contacts deleted.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE OR REPLACE FUNCTION public.delete_contacts_by_tag(p_tag_id UUID)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
  v_deleted BIGINT;
BEGIN
  -- `tags_select` already restricts this read to the caller's account,
  -- so a tag from anywhere else simply isn't found.
  SELECT account_id INTO v_account_id
  FROM tags
  WHERE id = p_tag_id;

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'Tag not found' USING ERRCODE = 'no_data_found';
  END IF;

  WITH deleted AS (
    DELETE FROM contacts c
    WHERE c.account_id = v_account_id
      AND EXISTS (
        SELECT 1 FROM contact_tags ct
        WHERE ct.contact_id = c.id
          AND ct.tag_id = p_tag_id
      )
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted FROM deleted;

  RETURN v_deleted;
END;
$$;

ALTER FUNCTION public.delete_contacts_by_tag(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.delete_contacts_by_tag(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_contacts_by_tag(UUID) TO authenticated;
