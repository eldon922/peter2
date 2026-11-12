-- Run against a disposable database after migrations; fixtures roll back.
BEGIN;
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  (md5('identity-owner')::uuid, 'identity-owner@example.test', '{}'),
  (md5('identity-viewer')::uuid, 'identity-viewer@example.test', '{}'),
  (md5('identity-replier')::uuid, 'identity-replier@example.test', '{}'),
  (md5('identity-other')::uuid, 'identity-other@example.test', '{}');
SELECT set_config('test.identity_account', account_id::text, true)
  FROM profiles WHERE user_id = md5('identity-owner')::uuid;
UPDATE profiles SET account_id = current_setting('test.identity_account')::uuid,
  account_role = CASE WHEN user_id = md5('identity-viewer')::uuid THEN 'viewer'::account_role_enum ELSE 'replier'::account_role_enum END
WHERE user_id IN (md5('identity-viewer')::uuid, md5('identity-replier')::uuid);
INSERT INTO contacts (id, user_id, account_id, phone, name) VALUES
  (md5('identity-local')::uuid, md5('identity-owner')::uuid, current_setting('test.identity_account')::uuid, '081234567890', 'Local'),
  (md5('identity-edit')::uuid, md5('identity-owner')::uuid, current_setting('test.identity_account')::uuid, '629999999999', 'Edit'),
  (md5('identity-uk')::uuid, md5('identity-owner')::uuid, current_setting('test.identity_account')::uuid, '07700900123', 'UK');
SELECT set_config('request.jwt.claim.sub', md5('identity-owner')::uuid::text, true);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM update_contact_details(md5('identity-edit')::uuid, '62', '+6281234567890', 'Alias');
    RAISE EXCEPTION 'Editing created a local/international alias';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  ASSERT (SELECT phone = '629999999999' FROM contacts WHERE id = md5('identity-edit')::uuid), 'collision must not change the saved contact';
  BEGIN
    PERFORM update_contact_details(md5('identity-edit')::uuid, '44', '+447700900123', 'Alias');
    RAISE EXCEPTION 'Custom country code collision was accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;
RESET ROLE;
-- A legacy alias pair must not prevent an unrelated name/email edit.
INSERT INTO contacts (user_id, account_id, phone)
VALUES (md5('identity-owner')::uuid, current_setting('test.identity_account')::uuid, '6281234567890');
SET LOCAL ROLE authenticated;
SELECT update_contact_details(md5('identity-local')::uuid, '62', '081234567890', 'Name updated', 'updated@example.test');
DO $$ BEGIN
  ASSERT (SELECT phone = '081234567890' AND name = 'Name updated' AND email = 'updated@example.test'
    FROM contacts WHERE id = md5('identity-local')::uuid), 'unchanged phone fields must preserve old alias records without rewriting them';
END $$;
SELECT update_contact_details(md5('identity-uk')::uuid, '44', '+447700900123', 'UK');
DO $$ BEGIN ASSERT (SELECT phone = '447700900123' FROM contacts WHERE id = md5('identity-uk')::uuid), 'explicit phone-format edits must be saved'; END $$;
RESET ROLE;

INSERT INTO contacts (id, user_id, account_id, phone) VALUES
  (md5('identity-removed')::uuid, md5('identity-owner')::uuid, current_setting('test.identity_account')::uuid, '089999999990'),
  (md5('identity-split')::uuid, md5('identity-owner')::uuid, current_setting('test.identity_account')::uuid, '083333333330');
INSERT INTO conversations (id, user_id, account_id, contact_id, unread_count, last_message_at, last_message_text) VALUES
  (md5('identity-old-chat')::uuid, md5('identity-owner')::uuid, current_setting('test.identity_account')::uuid, md5('identity-removed')::uuid, 3, '2026-11-12 07:00Z', 'Old history'),
  (md5('identity-split-old')::uuid, md5('identity-owner')::uuid, current_setting('test.identity_account')::uuid, md5('identity-split')::uuid, 3, '2026-11-12 07:00Z', 'Earlier history');
INSERT INTO messages (id, conversation_id, sender_type, content_type, content_text, media_url, media_filename) VALUES
  (md5('identity-old-message')::uuid, md5('identity-old-chat')::uuid, 'customer', 'document', 'Original attachment', 'https://example.test/original.pdf', 'Original.pdf'),
  (md5('identity-split-old-message')::uuid, md5('identity-split-old')::uuid, 'customer', 'text', 'Earlier history', NULL, NULL);
DELETE FROM contacts WHERE id IN (md5('identity-removed')::uuid, md5('identity-split')::uuid);
SET LOCAL ROLE authenticated;
SELECT prepare_contact_phones(current_setting('test.identity_account')::uuid, ARRAY['6289999999990'], '62');
INSERT INTO contacts (id, user_id, account_id, phone)
VALUES (md5('identity-recreated')::uuid, auth.uid(), current_setting('test.identity_account')::uuid, '6289999999990');
SELECT save_conversation_contact(md5('identity-old-chat')::uuid, '62');
DO $$ BEGIN
  ASSERT (SELECT contact_id = md5('identity-recreated')::uuid AND contact_removed_at IS NULL
    FROM conversations WHERE id = md5('identity-old-chat')::uuid), 'canonical recreation must reattach the old conversation';
  ASSERT (SELECT count(*) = 1 FROM contacts WHERE phone_normalized IN ('089999999990', '6289999999990')), 'restore must not create another alias';
  ASSERT (SELECT media_filename = 'Original.pdf' FROM messages WHERE id = md5('identity-old-message')::uuid), 'original attachments must survive recreation';
END $$;
RESET ROLE;

-- Simulate a split thread produced by a version deployed before this fix.
INSERT INTO contacts (id, user_id, account_id, phone)
VALUES (md5('identity-split-recreated')::uuid, md5('identity-owner')::uuid, current_setting('test.identity_account')::uuid, '6283333333330');
INSERT INTO conversations (id, user_id, account_id, contact_id, unread_count, last_message_at, last_message_text)
VALUES (md5('identity-split-new')::uuid, md5('identity-owner')::uuid, current_setting('test.identity_account')::uuid, md5('identity-split-recreated')::uuid, 2, '2026-11-12 08:00Z', 'New document');
INSERT INTO messages (id, conversation_id, sender_type, content_type, media_filename, media_url)
VALUES (md5('identity-split-new-message')::uuid, md5('identity-split-new')::uuid, 'customer', 'document', 'New document.pdf', 'https://example.test/new.pdf');
UPDATE conversations SET status = 'closed', ai_autoreply_disabled = true, ai_reply_count = 2 WHERE id = md5('identity-split-old')::uuid;
UPDATE conversations SET assigned_agent_id = md5('identity-owner')::uuid, ai_reply_count = 1,
  ai_handoff_summary = 'Latest handoff' WHERE id = md5('identity-split-new')::uuid;
INSERT INTO message_reactions (message_id, conversation_id, actor_type, actor_id, emoji)
VALUES (md5('identity-split-new-message')::uuid, md5('identity-split-new')::uuid, 'customer', md5('identity-split-recreated')::uuid, '👍');
SET LOCAL ROLE authenticated;
SELECT save_conversation_contact(md5('identity-split-old')::uuid, '62');
DO $$ BEGIN
  ASSERT (SELECT contact_id = md5('identity-split-recreated')::uuid AND unread_count = 5
    FROM conversations WHERE id = md5('identity-split-old')::uuid), 'restore must reuse the contact and preserve unread totals';
  ASSERT (SELECT status = 'open' AND assigned_agent_id = md5('identity-owner')::uuid AND ai_autoreply_disabled AND ai_reply_count = 3 AND ai_handoff_summary = 'Latest handoff' FROM conversations WHERE id = md5('identity-split-old')::uuid), 'current assignment, status and AI takeover state must survive';
  ASSERT NOT EXISTS (SELECT 1 FROM conversations WHERE id = md5('identity-split-new')::uuid), 'redundant thread remains';
  ASSERT (SELECT count(*) = 2 FROM messages WHERE conversation_id = md5('identity-split-old')::uuid), 'messages must move before thread deletion';
  ASSERT EXISTS (SELECT 1 FROM message_reactions WHERE conversation_id = md5('identity-split-old')::uuid AND actor_type = 'customer'), 'customer reactions must survive despite agent-only write policies';
  ASSERT EXISTS (SELECT 1 FROM messages WHERE id = md5('identity-split-new-message')::uuid AND media_filename = 'New document.pdf' AND media_url = 'https://example.test/new.pdf'), 'media metadata was lost';
END $$;

SELECT set_config('request.jwt.claim.sub', md5('identity-viewer')::uuid::text, true);
DO $$ BEGIN
  BEGIN PERFORM update_contact_details(md5('identity-local')::uuid, '62', '081234567890'); RAISE EXCEPTION 'Viewer edited contact'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM prepare_contact_phones(current_setting('test.identity_account')::uuid, ARRAY['081234567890'], '62'); RAISE EXCEPTION 'Viewer prepared contact'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM save_conversation_contact(md5('identity-old-chat')::uuid, '62'); RAISE EXCEPTION 'Viewer restored contact'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub', md5('identity-replier')::uuid::text, true);
DO $$ BEGIN
  BEGIN PERFORM update_contact_details(md5('identity-local')::uuid, '62', '081234567890'); RAISE EXCEPTION 'Replier edited contact'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub', md5('identity-other')::uuid::text, true);
DO $$ BEGIN
  BEGIN PERFORM update_contact_details(md5('identity-local')::uuid, '62', '081234567890'); RAISE EXCEPTION 'Cross-account edit'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM prepare_contact_phones(current_setting('test.identity_account')::uuid, ARRAY['081234567890'], '62'); RAISE EXCEPTION 'Cross-account preparation'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM save_conversation_contact(md5('identity-old-chat')::uuid, '62'); RAISE EXCEPTION 'Cross-account restore'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT prepare_contact_phones(current_setting('test.identity_account')::uuid, ARRAY['6289999999990'], '62');
RESET ROLE;
DO $$ BEGIN RAISE NOTICE 'Contact identity, edit collisions, restoration, retained history and role checks passed'; END $$;
ROLLBACK;
