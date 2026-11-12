-- Disposable database only: start after migration 069. This exercises the backfill.
INSERT INTO auth.users(id, email, raw_user_meta_data) VALUES
  (md5('standard-owner')::uuid, 'standard-owner@example.test', '{}'),
  (md5('standard-other')::uuid, 'standard-other@example.test', '{}');
SELECT set_config('test.standard_account', account_id::text, false) FROM profiles WHERE user_id = md5('standard-owner')::uuid;
INSERT INTO contacts(id, user_id, account_id, phone, name, company, created_at) VALUES
  (md5('standard-local')::uuid, md5('standard-owner')::uuid, current_setting('test.standard_account')::uuid, '081234567890', 'Original', NULL, '2026-01-01'),
  (md5('standard-alias')::uuid, md5('standard-owner')::uuid, current_setting('test.standard_account')::uuid, '+6281234567890', 'Alias', 'Company', '2026-02-01');
INSERT INTO contacts(id, user_id, account_id, phone)
SELECT md5('standard-other-contact')::uuid, user_id, account_id, '+6281234567890' FROM profiles WHERE user_id = md5('standard-other')::uuid;
INSERT INTO conversations(id, user_id, account_id, contact_id, unread_count, last_message_at, last_message_text, ai_autoreply_disabled, ai_reply_count) VALUES
  (md5('standard-chat-1')::uuid, md5('standard-owner')::uuid, current_setting('test.standard_account')::uuid, md5('standard-local')::uuid, 2, '2026-01-01', 'Earlier', true, 2),
  (md5('standard-chat-2')::uuid, md5('standard-owner')::uuid, current_setting('test.standard_account')::uuid, md5('standard-alias')::uuid, 3, '2026-02-01', 'Latest', false, 1);
UPDATE conversations SET assigned_agent_id = md5('standard-owner')::uuid, status = 'pending' WHERE id = md5('standard-chat-2')::uuid;
INSERT INTO messages(id, conversation_id, sender_type, content_type, content_text, media_filename, media_url) VALUES
  (md5('standard-message-1')::uuid, md5('standard-chat-1')::uuid, 'customer', 'text', 'Earlier', NULL, NULL),
  (md5('standard-message-2')::uuid, md5('standard-chat-2')::uuid, 'customer', 'document', 'Latest', 'Original.pdf', 'https://example.test/original.pdf');
INSERT INTO message_reactions(message_id, conversation_id, actor_type, actor_id, emoji)
VALUES (md5('standard-message-2')::uuid, md5('standard-chat-2')::uuid, 'customer', md5('standard-alias')::uuid, '👍');
INSERT INTO tags(id, user_id, account_id, name) VALUES
  (md5('standard-tag-1')::uuid, md5('standard-owner')::uuid, current_setting('test.standard_account')::uuid, 'One'),
  (md5('standard-tag-2')::uuid, md5('standard-owner')::uuid, current_setting('test.standard_account')::uuid, 'Two');
INSERT INTO contact_tags(contact_id, tag_id) VALUES
  (md5('standard-local')::uuid, md5('standard-tag-1')::uuid),
  (md5('standard-alias')::uuid, md5('standard-tag-1')::uuid),
  (md5('standard-alias')::uuid, md5('standard-tag-2')::uuid);
INSERT INTO custom_fields(id, user_id, account_id, field_name, field_type)
VALUES (md5('standard-field')::uuid, md5('standard-owner')::uuid, current_setting('test.standard_account')::uuid, 'Level', 'text');
INSERT INTO contact_custom_values(contact_id, custom_field_id, value) VALUES
  (md5('standard-local')::uuid, md5('standard-field')::uuid, ''),
  (md5('standard-alias')::uuid, md5('standard-field')::uuid, 'Gold');
INSERT INTO flows(id, user_id, account_id, name, trigger_type)
VALUES (md5('standard-flow')::uuid, md5('standard-owner')::uuid, current_setting('test.standard_account')::uuid, 'Existing flow', 'manual');
INSERT INTO flow_runs(id, flow_id, user_id, account_id, contact_id, conversation_id, last_advanced_at) VALUES
  (md5('standard-run-1')::uuid, md5('standard-flow')::uuid, md5('standard-owner')::uuid, current_setting('test.standard_account')::uuid,
    md5('standard-local')::uuid, md5('standard-chat-1')::uuid, '2026-01-01'),
  (md5('standard-run-2')::uuid, md5('standard-flow')::uuid, md5('standard-owner')::uuid, current_setting('test.standard_account')::uuid,
    md5('standard-alias')::uuid, md5('standard-chat-2')::uuid, '2026-02-01');
INSERT INTO contact_phone_history(account_id, contact_id, phone, phone_normalized)
VALUES (current_setting('test.standard_account')::uuid, md5('standard-alias')::uuid, '081111111111', '081111111111');
INSERT INTO conversations(id, user_id, account_id, contact_phone, contact_removed_at)
VALUES (md5('standard-removed')::uuid, md5('standard-owner')::uuid, current_setting('test.standard_account')::uuid, '082222222222', now());
INSERT INTO broadcasts(id, user_id, account_id, name, template_name)
VALUES (md5('standard-broadcast')::uuid, md5('standard-owner')::uuid, current_setting('test.standard_account')::uuid, 'History', 'test');
INSERT INTO broadcast_recipients(id, broadcast_id, contact_id, phone_attempted)
VALUES (md5('standard-recipient')::uuid, md5('standard-broadcast')::uuid, md5('standard-alias')::uuid, '081234567890');
INSERT INTO message_templates(id, user_id, account_id, name, body_text, buttons)
VALUES (md5('standard-template')::uuid, md5('standard-owner')::uuid, current_setting('test.standard_account')::uuid, 'phone_test', 'Call us', '[{"type":"PHONE_NUMBER","text":"Call","phone_number":"081234567890"}]');

\ir ../migrations/070_standardize_phone_numbers.sql
\ir ../migrations/070_standardize_phone_numbers.sql

DO $$ BEGIN
  BEGIN
    PERFORM international_phone_number('+999123456789', '62');
    RAISE EXCEPTION 'An unknown country code was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  ASSERT international_phone_number('0669833999', '39') = '+390669833999', 'Italy retains its significant leading zero';
  ASSERT international_phone_number('0549888888', '378') = '+3780549888888', 'San Marino retains its significant leading zero';
  ASSERT (SELECT count(*) = 1 FROM contacts WHERE account_id = current_setting('test.standard_account')::uuid), 'aliases must merge within their account';
  ASSERT EXISTS (SELECT 1 FROM contacts WHERE id = md5('standard-other-contact')::uuid), 'another account must remain independent';
  ASSERT (SELECT phone = '+6281234567890' AND company = 'Company' AND phone_conversion->>'input' = '081234567890'
    FROM contacts WHERE id = md5('standard-local')::uuid), 'canonical identity, profile and conversion evidence must survive';
  ASSERT (SELECT count(*) = 1 FROM conversations WHERE contact_id = md5('standard-local')::uuid), 'one chat must remain';
  ASSERT (SELECT unread_count = 5 AND status = 'pending' AND assigned_agent_id = md5('standard-owner')::uuid
    AND ai_autoreply_disabled AND ai_reply_count = 3 AND last_message_text = 'Latest'
    FROM conversations WHERE contact_id = md5('standard-local')::uuid), 'chat state must combine correctly';
  ASSERT (SELECT count(*) = 2 FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE contact_id = md5('standard-local')::uuid)), 'all messages must survive';
  ASSERT EXISTS (SELECT 1 FROM messages WHERE media_filename = 'Original.pdf' AND media_url = 'https://example.test/original.pdf'), 'attachments must survive';
  ASSERT EXISTS (SELECT 1 FROM message_reactions WHERE actor_id = md5('standard-local')::uuid AND emoji = '👍'), 'reaction ownership must follow the merged contact';
  ASSERT (SELECT count(*) = 2 FROM contact_tags WHERE contact_id = md5('standard-local')::uuid), 'all tags must survive';
  ASSERT EXISTS (SELECT 1 FROM contact_custom_values WHERE contact_id = md5('standard-local')::uuid AND value = 'Gold'), 'custom values must survive';
  ASSERT EXISTS (SELECT 1 FROM contact_notes WHERE contact_id = md5('standard-local')::uuid AND note_text LIKE '%Alias%'), 'the previous profile must be retained';
  ASSERT (SELECT count(*) = 2 FROM flow_runs WHERE contact_id = md5('standard-local')::uuid), 'both flow histories must survive';
  ASSERT (SELECT status = 'active' FROM flow_runs WHERE id = md5('standard-run-2')::uuid), 'the most recent active flow must continue';
  ASSERT (SELECT status = 'paused_by_agent' AND end_reason IS NOT NULL FROM flow_runs WHERE id = md5('standard-run-1')::uuid), 'an older competing run must pause with its reason retained';
  ASSERT EXISTS (SELECT 1 FROM contact_phone_history WHERE contact_id = md5('standard-local')::uuid AND phone = '+6281111111111'), 'old phone history must be canonical and retained';
  ASSERT (SELECT contact_phone = '+6282222222222' AND contact_phone_conversion->>'countryCode' = '62'
    FROM conversations WHERE id = md5('standard-removed')::uuid), 'removed chats must retain a canonical snapshot and conversion notice';
  ASSERT (SELECT phone_attempted = '+6281234567890' AND contact_id = md5('standard-local')::uuid FROM broadcast_recipients WHERE id = md5('standard-recipient')::uuid), 'broadcast history must stay linked and canonical';
  ASSERT (SELECT buttons->0->>'phone_number' = '+6281234567890' FROM message_templates WHERE id = md5('standard-template')::uuid), 'template phone buttons must be canonical';
  BEGIN INSERT INTO contacts(user_id, account_id, phone) VALUES (md5('standard-owner')::uuid, current_setting('test.standard_account')::uuid, '081234567890');
    RAISE EXCEPTION 'A raw local number bypassed canonical uniqueness'; EXCEPTION WHEN unique_violation THEN NULL; END;
  BEGIN INSERT INTO contacts(user_id, account_id, phone) VALUES (md5('standard-owner')::uuid, current_setting('test.standard_account')::uuid, 'abc');
    RAISE EXCEPTION 'An invalid number was accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;

UPDATE accounts SET default_country_code = '44' WHERE id = (SELECT account_id FROM profiles WHERE user_id = md5('standard-other')::uuid);
INSERT INTO contacts(id, user_id, account_id, phone)
SELECT md5('standard-uk')::uuid, user_id, account_id, '07700900123' FROM profiles WHERE user_id = md5('standard-other')::uuid;
DO $$ BEGIN
  ASSERT (SELECT phone = '+447700900123' AND phone_conversion->>'countryCode' = '44' FROM contacts WHERE id = md5('standard-uk')::uuid), 'custom defaults must apply before storage';
END $$;
SELECT set_config('request.jwt.claim.sub', md5('standard-owner')::uuid::text, false);
SET ROLE authenticated;
SELECT update_contact_details(md5('standard-local')::uuid, '62', '+6281234567890', 'Edited');
SELECT save_conversation_contact(md5('standard-removed')::uuid, '62');
DO $$ BEGIN
  ASSERT (SELECT phone_conversion IS NOT NULL AND phone = '+6281234567890' FROM contacts WHERE id = md5('standard-local')::uuid), 'profile edits must preserve conversion evidence';
  ASSERT EXISTS (SELECT 1 FROM conversations v JOIN contacts c ON c.id = v.contact_id
    WHERE v.id = md5('standard-removed')::uuid AND c.phone = '+6282222222222' AND c.phone_conversion IS NOT NULL), 'restoration must retain the converted identity and notice';
END $$;
RESET ROLE;
