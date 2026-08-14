-- ============================================================
-- 038_filter_contacts_by_tags_sort.sql — sortable contact list
--
-- Why
--
--   The Contacts table gained clickable column headers. The
--   unfiltered list sorts through PostgREST (`.order(...)`), but the
--   tag-filtered path goes through `filter_contacts_by_tags`, which
--   hard-coded `ORDER BY created_at DESC`. Sorting the returned page
--   client-side would only reorder the 25 rows already chosen by the
--   old ordering — the wrong rows entirely once you sort by name — so
--   the ordering has to happen inside the window function, next to the
--   LIMIT/OFFSET.
--
-- Sort surface
--
--   `p_sort_column` is validated against a fixed whitelist rather than
--   interpolated: the function body is SQL, so an unchecked identifier
--   would be an injection point. Anything unrecognised falls back to
--   `created_at`, matching the previous behaviour. `id` is appended as
--   a tiebreaker throughout so pagination stays stable when the sort
--   key repeats (many contacts share a company, or have none).
--
--   NULLs sort last in both directions — an empty email or company is
--   never what you're looking for when you sort by that column.
--
-- Compatibility
--
--   Both new params default, so the previous 4-arg call signature keeps
--   working. The old 4-arg overload is dropped explicitly: PostgreSQL
--   would otherwise keep it alongside this one and every 4-arg call
--   would fail as ambiguous.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

DROP FUNCTION IF EXISTS public.filter_contacts_by_tags(UUID[], TEXT, INT, INT);

CREATE OR REPLACE FUNCTION public.filter_contacts_by_tags(
  p_tag_ids UUID[],
  p_search TEXT DEFAULT NULL,
  p_limit INT DEFAULT 25,
  p_offset INT DEFAULT 0,
  p_sort_column TEXT DEFAULT 'created_at',
  p_sort_dir TEXT DEFAULT 'desc'
)
RETURNS TABLE (contact contacts, total_count BIGINT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH params AS (
    SELECT
      CASE
        WHEN p_sort_column IN ('name', 'phone', 'email', 'company', 'created_at')
          THEN p_sort_column
        ELSE 'created_at'
      END AS col,
      (lower(coalesce(p_sort_dir, 'desc')) = 'asc') AS is_asc
  ),
  matched AS (
    -- Distinct contacts having ANY of the selected tags (OR),
    -- narrowed by the same name/phone/email search as the list.
    SELECT DISTINCT c.id, c.name, c.phone, c.email, c.company, c.created_at
    FROM contacts c
    JOIN contact_tags ct ON ct.contact_id = c.id
    WHERE ct.tag_id = ANY(p_tag_ids)
      AND (
        p_search IS NULL
        OR c.name ILIKE '%' || p_search || '%'
        OR c.phone ILIKE '%' || p_search || '%'
        OR c.email ILIKE '%' || p_search || '%'
      )
  ),
  page AS (
    -- count(*) OVER() is evaluated before LIMIT, so it is the full
    -- match total regardless of the page being returned.
    SELECT m.id, count(*) OVER() AS total_count
    FROM matched m, params p
    ORDER BY
      CASE WHEN p.is_asc THEN
        CASE p.col
          WHEN 'name' THEN m.name
          WHEN 'phone' THEN m.phone
          WHEN 'email' THEN m.email
          WHEN 'company' THEN m.company
        END
      END ASC NULLS LAST,
      CASE WHEN NOT p.is_asc THEN
        CASE p.col
          WHEN 'name' THEN m.name
          WHEN 'phone' THEN m.phone
          WHEN 'email' THEN m.email
          WHEN 'company' THEN m.company
        END
      END DESC NULLS LAST,
      CASE WHEN p.col = 'created_at' AND p.is_asc THEN m.created_at END ASC NULLS LAST,
      CASE WHEN p.col = 'created_at' AND NOT p.is_asc THEN m.created_at END DESC NULLS LAST,
      m.id
    LIMIT p_limit OFFSET p_offset
  )
  SELECT c AS contact, page.total_count
  FROM page
  JOIN contacts c ON c.id = page.id, params p
  ORDER BY
    CASE WHEN p.is_asc THEN
      CASE p.col
        WHEN 'name' THEN c.name
        WHEN 'phone' THEN c.phone
        WHEN 'email' THEN c.email
        WHEN 'company' THEN c.company
      END
    END ASC NULLS LAST,
    CASE WHEN NOT p.is_asc THEN
      CASE p.col
        WHEN 'name' THEN c.name
        WHEN 'phone' THEN c.phone
        WHEN 'email' THEN c.email
        WHEN 'company' THEN c.company
      END
    END DESC NULLS LAST,
    CASE WHEN p.col = 'created_at' AND p.is_asc THEN c.created_at END ASC NULLS LAST,
    CASE WHEN p.col = 'created_at' AND NOT p.is_asc THEN c.created_at END DESC NULLS LAST,
    c.id;
$$;

ALTER FUNCTION public.filter_contacts_by_tags(UUID[], TEXT, INT, INT, TEXT, TEXT)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.filter_contacts_by_tags(UUID[], TEXT, INT, INT, TEXT, TEXT)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.filter_contacts_by_tags(UUID[], TEXT, INT, INT, TEXT, TEXT)
  TO authenticated;
