-- Run after migration 068; checks include applying 069 twice. Fixtures roll back.
BEGIN;
INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES (md5('prefix-owner')::uuid, 'prefix-owner@example.test', '{}');
SELECT set_config('test.prefix_account', account_id::text, true)
FROM profiles WHERE user_id = md5('prefix-owner')::uuid;
SELECT set_config('request.jwt.claim.sub', md5('prefix-owner')::uuid::text, true);

INSERT INTO contacts (id, user_id, account_id, phone) VALUES
  (md5('prefix-international')::uuid, md5('prefix-owner')::uuid, current_setting('test.prefix_account')::uuid, '6281234567890'),
  (md5('prefix-local')::uuid, md5('prefix-owner')::uuid, current_setting('test.prefix_account')::uuid, '089999999999');

\ir ../migrations/069_contact_international_phone_prefix.sql
\ir ../migrations/069_contact_international_phone_prefix.sql

DO $$ BEGIN
  ASSERT (SELECT phone = '+6281234567890' AND phone_normalized = '6281234567890'
    FROM contacts WHERE id = md5('prefix-international')::uuid), 'international phone must retain + without changing identity';
  ASSERT (SELECT phone = '089999999999' FROM contacts WHERE id = md5('prefix-local')::uuid), 'local numbers must not receive a guessed country code';
  ASSERT NOT EXISTS (SELECT 1 FROM contact_phone_history WHERE contact_id = md5('prefix-international')::uuid), 'prefix formatting must not create a number-change history entry';
END $$;

SET LOCAL ROLE authenticated;
SELECT update_contact_details(md5('prefix-local')::uuid, '62', '088888888888', 'Edited');
INSERT INTO contacts (id, user_id, account_id, phone)
VALUES (md5('prefix-new')::uuid, auth.uid(), current_setting('test.prefix_account')::uuid, '447700900123');
DO $$ BEGIN
  ASSERT (SELECT phone = '+6288888888888' FROM contacts WHERE id = md5('prefix-local')::uuid), 'phone edits must save +countrycode';
  ASSERT (SELECT phone = '+447700900123' FROM contacts WHERE id = md5('prefix-new')::uuid), 'inserts must save +countrycode';
  BEGIN
    INSERT INTO contacts (user_id, account_id, phone)
    VALUES (auth.uid(), current_setting('test.prefix_account')::uuid, '+62 812-3456-7890');
    RAISE EXCEPTION 'Formatting bypassed duplicate protection';
  EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;
INSERT INTO conversations (id, user_id, account_id, contact_id)
VALUES (md5('prefix-chat')::uuid, auth.uid(), current_setting('test.prefix_account')::uuid, md5('prefix-new')::uuid);
DELETE FROM contacts WHERE id = md5('prefix-new')::uuid;
SELECT save_conversation_contact(md5('prefix-chat')::uuid, '62');
DO $$ BEGIN
  ASSERT (SELECT c.phone = '+447700900123' FROM conversations chat JOIN contacts c ON c.id = chat.contact_id
    WHERE chat.id = md5('prefix-chat')::uuid), 'restoring a contact must retain +countrycode';
END $$;
RESET ROLE;
ROLLBACK;
