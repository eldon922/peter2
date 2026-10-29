-- Run after migrations against a disposable database. All fixtures roll back.
BEGIN;
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('10000000-0000-0000-0000-000000000001', 'workflow-owner@example.test', '{"full_name":"Owner"}'),
  ('10000000-0000-0000-0000-000000000002', 'workflow-agent@example.test', '{"full_name":"Agent"}'),
  ('10000000-0000-0000-0000-000000000003', 'workflow-replier@example.test', '{"full_name":"Replier"}'),
  ('10000000-0000-0000-0000-000000000004', 'workflow-viewer@example.test', '{"full_name":"Viewer"}'),
  ('10000000-0000-0000-0000-000000000005', 'workflow-other@example.test', '{"full_name":"Other"}');

SELECT set_config('test.account_id', account_id::text, true) FROM profiles WHERE user_id = '10000000-0000-0000-0000-000000000001';
UPDATE profiles SET account_id = current_setting('test.account_id')::uuid,
  account_role = CASE user_id
    WHEN '10000000-0000-0000-0000-000000000002' THEN 'agent'::account_role_enum
    WHEN '10000000-0000-0000-0000-000000000003' THEN 'replier'::account_role_enum
    ELSE 'viewer'::account_role_enum END
WHERE user_id IN ('10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000004');

INSERT INTO contacts (id, user_id, account_id, phone, name) VALUES
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', current_setting('test.account_id')::uuid, '+628123456701', 'Saved contact'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', current_setting('test.account_id')::uuid, '+628123456702', 'Untagged'),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', current_setting('test.account_id')::uuid, '+628123456703', 'Excluded');
INSERT INTO contacts (user_id, account_id, phone, name)
  SELECT user_id, account_id, '+628123456704', 'Other account' FROM profiles WHERE user_id = '10000000-0000-0000-0000-000000000005';
INSERT INTO tags (id, user_id, account_id, name) VALUES
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', current_setting('test.account_id')::uuid, 'VIP'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', current_setting('test.account_id')::uuid, 'Suppression');
INSERT INTO contact_tags (contact_id, tag_id) VALUES
  ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000002');
INSERT INTO conversations (id, user_id, account_id, contact_id, unread_count)
VALUES ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', current_setting('test.account_id')::uuid, '20000000-0000-0000-0000-000000000001', 3);
INSERT INTO messages (id, conversation_id, sender_type, content_type, content_text, media_filename, created_at)
VALUES ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'customer', 'document', 'History', 'Original report.pdf', '2020-01-01');

SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE matches INTEGER; total BIGINT;
BEGIN
  SELECT count(*) INTO matches FROM filter_contacts_by_tags('{}', p_include_untagged => true);
  IF matches <> 1 THEN RAISE EXCEPTION 'Untagged filter or account isolation failed'; END IF;
  SELECT count(*), max(total_count) INTO matches, total FROM filter_contacts_by_tags(
    ARRAY['30000000-0000-0000-0000-000000000001'::uuid], p_include_untagged => true,
    p_exclude_tag_ids => ARRAY['30000000-0000-0000-0000-000000000002'::uuid], p_limit => 1);
  IF matches <> 1 OR total <> 2 THEN RAISE EXCEPTION 'Excluded tags must be applied before counting and paging'; END IF;
  SELECT count(*) INTO matches FROM filter_contacts_by_tags('{}', p_exclude_untagged => true);
  IF matches <> 2 THEN RAISE EXCEPTION 'Exclude untagged failed'; END IF;
END $$;

SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);
DO $$
BEGIN
  UPDATE conversations SET unread_count = 0 WHERE id = '40000000-0000-0000-0000-000000000001';
  IF (SELECT unread_count FROM conversations WHERE id = '40000000-0000-0000-0000-000000000001') <> 3 THEN
    RAISE EXCEPTION 'Viewer cleared unread state';
  END IF;
  BEGIN
    INSERT INTO messages (conversation_id, sender_type, content_type, content_text)
      VALUES ('40000000-0000-0000-0000-000000000001', 'agent', 'text', 'Forbidden');
    RAISE EXCEPTION 'Viewer sent a message';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
DO $$
DECLARE affected INTEGER;
BEGIN
  IF NOT is_account_member(current_setting('test.account_id')::uuid, 'replier') OR is_account_member(current_setting('test.account_id')::uuid, 'agent') THEN
    RAISE EXCEPTION 'Replier hierarchy failed';
  END IF;
  INSERT INTO messages (id, conversation_id, sender_type, content_type, content_text)
    VALUES ('50000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000001', 'agent', 'text', 'Reply');
  UPDATE conversations SET unread_count = 0 WHERE id = '40000000-0000-0000-0000-000000000001';
  INSERT INTO message_reactions (message_id, conversation_id, actor_type, actor_id, emoji)
    VALUES ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'agent', auth.uid(), '👍');
  DELETE FROM messages WHERE id = '50000000-0000-0000-0000-000000000001';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 0 THEN RAISE EXCEPTION 'Replier deleted history'; END IF;
  BEGIN
    UPDATE conversations SET status = 'closed' WHERE id = '40000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'Replier changed chat status';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO contacts (user_id, account_id, phone) VALUES (auth.uid(), current_setting('test.account_id')::uuid, '+628123456705');
    RAISE EXCEPTION 'Replier created a contact';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO broadcasts (user_id, account_id, name, template_name) VALUES (auth.uid(), current_setting('test.account_id')::uuid, 'Forbidden', 'test');
    RAISE EXCEPTION 'Replier created a broadcast';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

SELECT set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
DO $$
DECLARE saved UUID;
BEGIN
  DELETE FROM contacts WHERE id = '20000000-0000-0000-0000-000000000001';
  IF NOT EXISTS (SELECT 1 FROM conversations WHERE id = '40000000-0000-0000-0000-000000000001'
    AND contact_id IS NULL AND contact_removed_at IS NOT NULL AND contact_phone = '+628123456701') THEN
    RAISE EXCEPTION 'Contact deletion lost the chat or its identity';
  END IF;
  IF (SELECT count(*) FROM messages WHERE conversation_id = '40000000-0000-0000-0000-000000000001') <> 2 THEN
    RAISE EXCEPTION 'Contact deletion removed message history';
  END IF;
  SELECT save_conversation_contact('40000000-0000-0000-0000-000000000001') INTO saved;
  IF NOT EXISTS (SELECT 1 FROM conversations WHERE id = '40000000-0000-0000-0000-000000000001' AND contact_id = saved AND contact_removed_at IS NULL) THEN
    RAISE EXCEPTION 'Saving the removed contact did not reconnect history';
  END IF;
  DELETE FROM messages WHERE id = '50000000-0000-0000-0000-000000000002';
  IF (SELECT last_message_text FROM conversations WHERE id = '40000000-0000-0000-0000-000000000001') <> 'History' THEN
    RAISE EXCEPTION 'Message deletion left a stale preview';
  END IF;
  IF (SELECT media_filename FROM messages WHERE id = '50000000-0000-0000-0000-000000000001') <> 'Original report.pdf' THEN
    RAISE EXCEPTION 'Retained history lost the filename';
  END IF;
  DELETE FROM conversations WHERE id = '40000000-0000-0000-0000-000000000001';
  IF EXISTS (SELECT 1 FROM messages WHERE conversation_id = '40000000-0000-0000-0000-000000000001') THEN
    RAISE EXCEPTION 'Chat deletion did not cascade messages';
  END IF;
END $$;

RESET ROLE;
INSERT INTO broadcasts (id, user_id, account_id, name, template_name, total_recipients, status)
VALUES ('60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', current_setting('test.account_id')::uuid, 'Progress', 'test', 3, 'sent');
INSERT INTO broadcast_recipients (broadcast_id, contact_id, status) VALUES
  ('60000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'sent'),
  ('60000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'failed'),
  ('60000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003', 'failed');
UPDATE broadcast_recipients SET status = 'pending' WHERE broadcast_id = '60000000-0000-0000-0000-000000000001' AND status = 'failed';
UPDATE broadcasts SET status = 'sending' WHERE id = '60000000-0000-0000-0000-000000000001';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM broadcasts WHERE id = '60000000-0000-0000-0000-000000000001'
    AND send_run_total = 2 AND send_run_baseline = 1 AND started_at IS NOT NULL AND completed_at IS NULL) THEN
    RAISE EXCEPTION 'Retry progress snapshot has the wrong denominator or baseline';
  END IF;
END $$;
UPDATE broadcast_recipients SET status = 'sent' WHERE id IN (SELECT id FROM broadcast_recipients WHERE broadcast_id = '60000000-0000-0000-0000-000000000001' AND status = 'pending' LIMIT 1);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM broadcasts WHERE id = '60000000-0000-0000-0000-000000000001'
    AND sent_count + failed_count - send_run_baseline = 1 AND send_run_total = 2) THEN
    RAISE EXCEPTION 'Persisted retry progress should be 1 of 2';
  END IF;
END $$;
UPDATE broadcasts SET status = 'sent' WHERE id = '60000000-0000-0000-0000-000000000001';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM broadcasts WHERE id = '60000000-0000-0000-0000-000000000001' AND completed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Completed duration was not persisted';
  END IF;
  RAISE NOTICE 'Workflow, retention, role, filter and progress checks passed';
END $$;
ROLLBACK;
