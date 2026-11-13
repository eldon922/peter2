-- psql -v ON_ERROR_STOP=1 -f supabase/ci/verify-broadcast-engagement.sql
-- Disposable database only; fixtures and migration replay roll back.
BEGIN;
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  (md5('eng-owner')::uuid, 'engagement-owner@example.test', '{}'),
  (md5('eng-other')::uuid, 'engagement-other@example.test', '{}');
SELECT set_config('test.eng_account', account_id::text, true)
  FROM profiles WHERE user_id = md5('eng-owner')::uuid;

INSERT INTO contacts (id, user_id, account_id, phone, name)
SELECT md5('eng-contact-' || n)::uuid, md5('eng-owner')::uuid,
  current_setting('test.eng_account')::uuid, '62812000000' || n, 'Customer ' || n
FROM generate_series(1, 4) n;
INSERT INTO conversations (id, user_id, account_id, contact_id)
SELECT md5('eng-chat-' || n)::uuid, md5('eng-owner')::uuid,
  current_setting('test.eng_account')::uuid, md5('eng-contact-' || n)::uuid
FROM generate_series(1, 4) n;
INSERT INTO broadcasts (id, user_id, account_id, name, template_name)
SELECT md5('eng-' || name)::uuid, md5('eng-owner')::uuid,
  current_setting('test.eng_account')::uuid, name, 'test'
FROM unnest(ARRAY['old', 'new', 'future', 'failed']) name;
INSERT INTO broadcast_recipients (id, broadcast_id, contact_id, status, sent_at, created_at, whatsapp_message_id) VALUES
  (md5('eng-r-old')::uuid, md5('eng-old')::uuid, md5('eng-contact-1')::uuid, 'sent', '2026-11-12 07:00Z', '2026-11-12 11:00Z', 'eng-wamid-old'),
  (md5('eng-r-new')::uuid, md5('eng-new')::uuid, md5('eng-contact-1')::uuid, 'read', '2026-11-12 10:00Z', '2026-11-12 06:00Z', 'eng-wamid-new'),
  (md5('eng-r-future')::uuid, md5('eng-future')::uuid, md5('eng-contact-1')::uuid, 'sent', '2026-11-12 14:00Z', '2026-11-12 05:00Z', 'eng-wamid-future'),
  (md5('eng-r-reaction')::uuid, md5('eng-old')::uuid, md5('eng-contact-2')::uuid, 'sent', '2026-11-12 07:00Z', '2026-11-12 06:00Z', 'eng-wamid-reaction'),
  (md5('eng-r-failed')::uuid, md5('eng-failed')::uuid, md5('eng-contact-3')::uuid, 'failed', '2026-11-12 07:00Z', '2026-11-12 06:00Z', 'eng-wamid-failed'),
  (md5('eng-r-ambiguous-old')::uuid, md5('eng-old')::uuid, md5('eng-contact-4')::uuid, 'replied', '2026-11-12 07:00Z', '2026-11-12 06:00Z', 'eng-wamid-ambiguous-old'),
  (md5('eng-r-ambiguous-new')::uuid, md5('eng-new')::uuid, md5('eng-contact-4')::uuid, 'sent', '2026-11-12 10:00Z', '2026-11-12 06:00Z', 'eng-wamid-ambiguous-new');
UPDATE broadcast_recipients SET replied_at = '2026-11-12 13:00Z' WHERE id = md5('eng-r-ambiguous-old')::uuid;

INSERT INTO messages (id, conversation_id, sender_type, content_text, message_id, created_at) VALUES
  (md5('eng-parent-old')::uuid, md5('eng-chat-1')::uuid, 'agent', 'Old broadcast', 'eng-wamid-old', '2026-11-12 07:00Z'),
  (md5('eng-parent-new')::uuid, md5('eng-chat-1')::uuid, 'agent', 'New broadcast', 'eng-wamid-new', '2026-11-12 10:00Z'),
  (md5('eng-parent-reaction')::uuid, md5('eng-chat-2')::uuid, 'agent', 'React to this', 'eng-wamid-reaction', '2026-11-12 07:00Z'),
  (md5('eng-parent-failed')::uuid, md5('eng-chat-3')::uuid, 'agent', 'Failed', 'eng-wamid-failed', '2026-11-12 07:00Z'),
  (md5('eng-before')::uuid, md5('eng-chat-1')::uuid, 'customer', 'Before send', 'eng-in-before', '2026-11-12 05:00Z'),
  (md5('eng-plain')::uuid, md5('eng-chat-1')::uuid, 'customer', 'Thanks', 'eng-in-plain', '2026-11-12 13:00Z'),
  (md5('eng-repeat')::uuid, md5('eng-chat-1')::uuid, 'customer', 'Thank you again', 'eng-in-repeat', '2026-11-12 13:01Z');
INSERT INTO messages (conversation_id, sender_type, content_text, reply_to_message_id, created_at)
VALUES (md5('eng-chat-1')::uuid, 'customer', 'Reply to older broadcast', md5('eng-parent-old')::uuid, '2026-11-12 15:00Z'),
  (md5('eng-chat-1')::uuid, 'customer', 'Resolved reply to new broadcast', md5('eng-parent-new')::uuid, '2026-11-12 13:00Z');
-- This NULL parent may be an unresolved quote to the older campaign.
INSERT INTO messages (conversation_id, sender_type, content_text, created_at)
VALUES (md5('eng-chat-4')::uuid, 'customer', 'Unresolved quotation to old campaign', '2026-11-12 13:00Z');
INSERT INTO message_reactions (message_id, conversation_id, actor_type, actor_id, emoji, created_at) VALUES
  (md5('eng-parent-reaction')::uuid, md5('eng-chat-2')::uuid, 'customer', md5('eng-contact-2')::uuid, '👍', '2026-11-12 12:00Z'),
  (md5('eng-parent-failed')::uuid, md5('eng-chat-3')::uuid, 'agent', md5('eng-owner')::uuid, '👍', '2026-11-12 12:00Z');

-- A cross-account contact reference must not bypass broadcast tenancy.
INSERT INTO contacts (id, user_id, account_id, phone)
SELECT md5('eng-foreign-contact')::uuid, user_id, account_id, '62812999999'
FROM profiles WHERE user_id = md5('eng-other')::uuid;
INSERT INTO broadcasts (id, user_id, account_id, name, template_name)
SELECT md5('eng-foreign')::uuid, user_id, account_id, 'Foreign', 'test'
FROM profiles WHERE user_id = md5('eng-other')::uuid;
INSERT INTO broadcast_recipients (broadcast_id, contact_id, status, sent_at, whatsapp_message_id)
VALUES (md5('eng-foreign')::uuid, md5('eng-contact-1')::uuid, 'sent', '2026-11-12 12:00Z', 'eng-wamid-foreign');

\ir ../migrations/067_recover_broadcast_engagement.sql
\ir ../migrations/067_recover_broadcast_engagement.sql

DO $$
BEGIN
  ASSERT (SELECT replied_count = 3 FROM broadcasts WHERE id = md5('eng-old')::uuid), 'quoted reply and customer reaction must count';
  ASSERT (SELECT replied_count = 1 FROM broadcasts WHERE id = md5('eng-new')::uuid), 'repeated messages must count once on the most recently sent broadcast';
  ASSERT (SELECT replied_at = '2026-11-12 13:00Z'::timestamptz FROM broadcast_recipients WHERE id = md5('eng-r-new')::uuid), 'first reply time must survive reruns';
  ASSERT (SELECT replied_count = 0 FROM broadcasts WHERE id = md5('eng-future')::uuid), 'unquoted reply cannot precede send; quoted reply must use its target';
  ASSERT (SELECT replied_count = 0 FROM broadcasts WHERE id = md5('eng-failed')::uuid), 'agent reactions and failed recipients must not count';
  ASSERT (SELECT replied_count = 0 FROM broadcasts WHERE id = md5('eng-foreign')::uuid), 'engagement must stay in its account';
  ASSERT (SELECT status = 'sent' FROM broadcast_recipients WHERE id = md5('eng-r-ambiguous-new')::uuid), 'a NULL quoted-parent FK is not proof of an unquoted reply';
  RAISE NOTICE 'Broadcast engagement recovery and idempotence passed';
END $$;
-- The later repair intentionally includes inferred ordinary replies.
\ir ../migrations/071_recover_plain_broadcast_replies.sql
\ir ../migrations/071_recover_plain_broadcast_replies.sql
DO $$
BEGIN
  ASSERT (SELECT replied_count = 2 FROM broadcasts WHERE id = md5('eng-new')::uuid), 'ordinary replies must repair existing totals without duplicates';
  ASSERT (SELECT replied_count = 3 FROM broadcasts WHERE id = md5('eng-old')::uuid), 'explicit older replies and reactions must survive';
  ASSERT (SELECT replied_count = 0 FROM broadcasts WHERE id = md5('eng-future')::uuid), 'future broadcasts must not receive ordinary replies';
  ASSERT (SELECT replied_count = 0 FROM broadcasts WHERE id = md5('eng-failed')::uuid), 'failed sends must remain unchanged';
  ASSERT (SELECT replied_count = 0 FROM broadcasts WHERE id = md5('eng-foreign')::uuid), 'ordinary reply recovery must respect account boundaries';
  ASSERT NOT EXISTS (SELECT 1 FROM broadcasts WHERE id IN (md5('eng-old')::uuid, md5('eng-new')::uuid) AND status <> 'draft'), 'repair must not start broadcasts';
  RAISE NOTICE 'Ordinary reply recovery and idempotence passed';
END $$;
ROLLBACK;
