-- Include untagged contacts and subtract excluded tags before counting and paging.
DROP FUNCTION IF EXISTS public.filter_contacts_by_tags(UUID[], TEXT, INT, INT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.filter_contacts_by_tags(
  p_tag_ids UUID[],
  p_search TEXT DEFAULT NULL,
  p_limit INT DEFAULT 25,
  p_offset INT DEFAULT 0,
  p_sort_column TEXT DEFAULT 'created_at',
  p_sort_dir TEXT DEFAULT 'desc',
  p_include_untagged BOOLEAN DEFAULT false,
  p_exclude_tag_ids UUID[] DEFAULT '{}',
  p_exclude_untagged BOOLEAN DEFAULT false
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
    SELECT DISTINCT c.id, c.name, c.phone, c.email, c.company, c.created_at
    FROM contacts c
    WHERE (
        (coalesce(cardinality(p_tag_ids), 0) = 0 AND NOT p_include_untagged)
        OR EXISTS (SELECT 1 FROM contact_tags ct WHERE ct.contact_id = c.id AND ct.tag_id = ANY(p_tag_ids))
        OR (p_include_untagged AND NOT EXISTS (SELECT 1 FROM contact_tags ct WHERE ct.contact_id = c.id))
      )
      AND NOT EXISTS (SELECT 1 FROM contact_tags ct WHERE ct.contact_id = c.id AND ct.tag_id = ANY(p_exclude_tag_ids))
      AND (NOT p_exclude_untagged OR EXISTS (SELECT 1 FROM contact_tags ct WHERE ct.contact_id = c.id))
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

ALTER FUNCTION public.filter_contacts_by_tags(UUID[], TEXT, INT, INT, TEXT, TEXT, BOOLEAN, UUID[], BOOLEAN)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION public.filter_contacts_by_tags(UUID[], TEXT, INT, INT, TEXT, TEXT, BOOLEAN, UUID[], BOOLEAN)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.filter_contacts_by_tags(UUID[], TEXT, INT, INT, TEXT, TEXT, BOOLEAN, UUID[], BOOLEAN)
  TO authenticated;
