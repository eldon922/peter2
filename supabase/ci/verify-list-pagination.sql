-- Run with psql -v ON_ERROR_STOP=1 after migrations. Fixtures are rolled back.
BEGIN;
INSERT INTO auth.users (id, email) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'page-test-1@example.com'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'page-test-2@example.com');
DO $$
DECLARE
  account UUID;
  owner_id UUID := 'aaaaaaaa-0000-0000-0000-000000000001';
BEGIN
  SELECT account_id INTO account FROM profiles WHERE user_id = owner_id;
  INSERT INTO contacts (id, user_id, account_id, name, phone, company)
    SELECT md5('page-contact-' || i)::uuid, owner_id, account,
      'Contact ' || i, '6281234' || lpad(i::text, 5, '0'), CASE WHEN i = 105 THEN 'Last company' ELSE 'First company' END
    FROM generate_series(1, 105) i;
  INSERT INTO tags (id, user_id, account_id, name) VALUES (md5('page-tag')::uuid, owner_id, account, 'VIP');
  INSERT INTO contact_tags (contact_id, tag_id)
    SELECT md5('page-contact-' || i)::uuid, md5('page-tag')::uuid FROM generate_series(1, 10) i;
  INSERT INTO conversations (id, user_id, account_id, contact_id, unread_count, last_message_at)
    SELECT md5('page-chat-' || i)::uuid, owner_id, account, md5('page-contact-' || i)::uuid,
      CASE WHEN i = 105 THEN 1 ELSE 0 END, now() - i * interval '1 minute'
    FROM generate_series(1, 105) i;
  INSERT INTO messages (conversation_id, sender_type, content_text)
    VALUES (md5('page-chat-105')::uuid, 'customer', 'Hello');
  INSERT INTO broadcasts (id, user_id, account_id, name, template_name, total_recipients)
    VALUES (md5('page-broadcast')::uuid, owner_id, account, 'Page test', 'test', 105);
  INSERT INTO broadcast_recipients (id, broadcast_id, contact_id, status, sent_at, phone_attempted, template_header_text)
    SELECT md5('page-recipient-' || i)::uuid, md5('page-broadcast')::uuid, md5('page-contact-' || i)::uuid,
      CASE WHEN i <= 10 THEN 'failed' ELSE 'sent' END, now(), 'original-' || i, 'Header ' || i
    FROM generate_series(1, 105) i;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
DO $$
DECLARE
  a JSONB;
  b JSONB;
BEGIN
  a := broadcast_recipient_page(md5('page-broadcast')::uuid);
  b := broadcast_recipient_page(md5('page-broadcast')::uuid, p_offset => 50);
  ASSERT (a->>'total')::int = 105 AND jsonb_array_length(a->'rows') = 50, 'recipient first page';
  ASSERT jsonb_array_length(b->'rows') = 50, 'recipient second page';
  ASSERT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(a->'rows') x JOIN jsonb_array_elements(b->'rows') y ON x->>'id' = y->>'id'), 'recipient pages overlap on tied sent times';
  a := broadcast_recipient_page(md5('page-broadcast')::uuid, p_status => 'failed');
  ASSERT (a->>'total')::int = 10, 'recipient status filter';
  a := broadcast_recipient_page(md5('page-broadcast')::uuid, p_search => 'original-105');
  ASSERT (a->>'total')::int = 1 AND a->'rows'->0->>'template_header_text' = 'Header 105', 'attempted phone search and stored header';
  a := broadcast_recipient_page(md5('page-broadcast')::uuid, p_offset => 999);
  ASSERT (a->>'total')::int = 105 AND jsonb_array_length(a->'rows') = 0, 'empty recipient page retains total';

  a := inbox_conversation_page();
  b := inbox_conversation_page(p_offset => 25);
  ASSERT (a->>'total')::int = 105 AND jsonb_array_length(a->'rows') = 25, 'inbox first page';
  ASSERT a->'rows'->0->>'id' = md5('page-chat-105')::uuid::text, 'unread conversations sort first';
  ASSERT a->'rows'->0->>'last_inbound_at' IS NOT NULL, 'visible session badge';
  ASSERT (a->'companies') @> '["Last company"]'::jsonb, 'company options cover all pages';
  ASSERT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(a->'rows') x JOIN jsonb_array_elements(b->'rows') y ON x->>'id' = y->>'id'), 'inbox pages overlap';
  a := inbox_conversation_page(p_tag_ids => ARRAY[md5('page-tag')::uuid]);
  ASSERT (a->>'total')::int = 10, 'inbox tag filter';
  ASSERT jsonb_array_length(a->'rows'->0->'contact'->'contact_tags') = 1, 'embedded tags';
  a := inbox_conversation_page(p_include_untagged => true);
  ASSERT (a->>'total')::int = 95, 'inbox untagged filter';
  a := inbox_conversation_page(p_search => 'Contact 105');
  ASSERT (a->>'total')::int = 1, 'inbox search outside first page';
  a := inbox_conversation_page(p_company => 'Last company');
  ASSERT (a->>'total')::int = 1, 'inbox company filter';
  a := inbox_conversation_page(p_offset => 999);
  ASSERT (a->>'total')::int = 105 AND jsonb_array_length(a->'rows') = 0, 'empty inbox page retains total';
END $$;
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000002', true);
DO $$
BEGIN
  ASSERT (inbox_conversation_page()->>'total')::int = 0, 'inbox must respect account RLS';
  ASSERT (broadcast_recipient_page(md5('page-broadcast')::uuid)->>'total')::int = 0, 'recipients must respect account RLS';
END $$;
ROLLBACK;
