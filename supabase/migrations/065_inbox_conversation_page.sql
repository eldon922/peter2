CREATE OR REPLACE FUNCTION public.inbox_conversation_page(
  p_status TEXT DEFAULT 'all',
  p_search TEXT DEFAULT '',
  p_tag_ids UUID[] DEFAULT '{}',
  p_include_untagged BOOLEAN DEFAULT false,
  p_company TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 25,
  p_offset INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  WITH matched AS (
    SELECT v.id, v.unread_count > 0 AS unread, v.last_message_at
    FROM conversations v
    LEFT JOIN contacts c ON c.id = v.contact_id
    WHERE (p_status = 'all' OR (p_status = 'unread' AND v.unread_count > 0) OR v.status = p_status)
      AND (p_company IS NULL OR trim(c.company) = p_company)
      AND (trim(p_search) = ''
        OR strpos(lower(coalesce(nullif(c.name, ''), v.contact_name, '')), lower(trim(p_search))) > 0
        OR strpos(lower(coalesce(nullif(c.phone, ''), v.contact_phone, '')), lower(trim(p_search))) > 0
        OR strpos(lower(coalesce(v.last_message_text, '')), lower(trim(p_search))) > 0)
      AND ((cardinality(p_tag_ids) = 0 AND NOT p_include_untagged)
        OR EXISTS (SELECT 1 FROM contact_tags ct WHERE ct.contact_id = c.id AND ct.tag_id = ANY(p_tag_ids))
        OR (p_include_untagged AND NOT EXISTS (SELECT 1 FROM contact_tags ct WHERE ct.contact_id = c.id)))
  ), page AS (
    SELECT v.*, CASE WHEN c.id IS NULL THEN NULL ELSE
      to_jsonb(c) || jsonb_build_object('contact_tags', (
        SELECT coalesce(jsonb_agg(jsonb_build_object('tags', to_jsonb(t))), '[]'::jsonb)
        FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id WHERE ct.contact_id = c.id
      )) END AS contact,
      (SELECT max(m.created_at) FROM messages m WHERE m.conversation_id = v.id
        AND m.sender_type = 'customer' AND m.created_at >= now() - interval '24 hours') AS last_inbound_at
    FROM (SELECT * FROM matched ORDER BY unread DESC, last_message_at DESC NULLS LAST, id
      LIMIT least(greatest(p_limit, 1), 100) OFFSET greatest(p_offset, 0)) picked
    JOIN conversations v ON v.id = picked.id
    LEFT JOIN contacts c ON c.id = v.contact_id
  )
  SELECT jsonb_build_object(
    'rows', coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY (p.unread_count > 0) DESC, p.last_message_at DESC NULLS LAST, p.id) FROM page p), '[]'::jsonb),
    'total', (SELECT count(*) FROM matched),
    'companies', coalesce((SELECT jsonb_agg(company ORDER BY company) FROM (
      SELECT DISTINCT trim(c.company) AS company FROM conversations v
      JOIN contacts c ON c.id = v.contact_id WHERE nullif(trim(c.company), '') IS NOT NULL
    ) companies), '[]'::jsonb)
  );
$$;
REVOKE ALL ON FUNCTION public.inbox_conversation_page(TEXT, TEXT, UUID[], BOOLEAN, TEXT, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.inbox_conversation_page(TEXT, TEXT, UUID[], BOOLEAN, TEXT, INTEGER, INTEGER) TO authenticated;
