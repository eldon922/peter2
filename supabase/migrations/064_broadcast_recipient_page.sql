CREATE OR REPLACE FUNCTION public.broadcast_recipient_page(
  p_broadcast_id UUID,
  p_status TEXT DEFAULT 'all',
  p_search TEXT DEFAULT '',
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  WITH matched AS (
    SELECT r.id, r.sent_at
    FROM broadcast_recipients r
    LEFT JOIN contacts c ON c.id = r.contact_id
    WHERE r.broadcast_id = p_broadcast_id
      AND (p_status = 'all' OR r.status = p_status)
      AND (trim(p_search) = '' OR strpos(lower(concat_ws(' ', c.name, c.profile_name, c.phone, r.phone_attempted)), lower(trim(p_search))) > 0)
  ), page AS (
    SELECT r.*, CASE WHEN c.id IS NULL THEN NULL ELSE
      to_jsonb(c) || jsonb_build_object('contact_tags', (
        SELECT coalesce(jsonb_agg(jsonb_build_object('tag_id', ct.tag_id)), '[]'::jsonb)
        FROM contact_tags ct WHERE ct.contact_id = c.id
      )) END AS contact
    FROM (SELECT * FROM matched ORDER BY sent_at DESC NULLS LAST, id
      LIMIT least(greatest(p_limit, 1), 200) OFFSET greatest(p_offset, 0)) m
    JOIN broadcast_recipients r ON r.id = m.id
    LEFT JOIN contacts c ON c.id = r.contact_id
  )
  SELECT jsonb_build_object(
    'rows', coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.sent_at DESC NULLS LAST, p.id) FROM page p), '[]'::jsonb),
    'total', (SELECT count(*) FROM matched)
  );
$$;
REVOKE ALL ON FUNCTION public.broadcast_recipient_page(UUID, TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.broadcast_recipient_page(UUID, TEXT, TEXT, INTEGER, INTEGER) TO authenticated;
