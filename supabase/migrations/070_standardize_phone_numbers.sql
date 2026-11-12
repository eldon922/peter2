BEGIN;

-- Set app.default_country_code to the application's DEFAULT_COUNTRY_CODE
-- before applying this migration if the installation does not use 62.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS default_country_code TEXT NOT NULL
  DEFAULT coalesce(nullif(current_setting('app.default_country_code', true), ''), '62');
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS phone_conversion JSONB;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS contact_phone_conversion JSONB;

CREATE OR REPLACE FUNCTION public.international_phone_number(phone TEXT, country_code TEXT)
RETURNS TEXT LANGUAGE plpgsql IMMUTABLE STRICT SET search_path = public AS $$
DECLARE digits TEXT;
-- Calling codes from libphonenumber-js metadata, including non-geographic numbers.
calling_codes CONSTANT TEXT[] := ARRAY[
  '1', '7', '20', '27', '30', '31', '32', '33', '34', '36', '39', '40',
  '41', '43', '44', '45', '46', '47', '48', '49', '51', '52', '53', '54',
  '55', '56', '57', '58', '60', '61', '62', '63', '64', '65', '66', '81',
  '82', '84', '86', '90', '91', '92', '93', '94', '95', '98', '211', '212',
  '213', '216', '218', '220', '221', '222', '223', '224', '225', '226', '227', '228',
  '229', '230', '231', '232', '233', '234', '235', '236', '237', '238', '239', '240',
  '241', '242', '243', '244', '245', '246', '247', '248', '249', '250', '251', '252',
  '253', '254', '255', '256', '257', '258', '260', '261', '262', '263', '264', '265',
  '266', '267', '268', '269', '290', '291', '297', '298', '299', '350', '351', '352',
  '353', '354', '355', '356', '357', '358', '359', '370', '371', '372', '373', '374',
  '375', '376', '377', '378', '380', '381', '382', '383', '385', '386', '387', '389',
  '420', '421', '423', '500', '501', '502', '503', '504', '505', '506', '507', '508',
  '509', '590', '591', '592', '593', '594', '595', '596', '597', '598', '599', '670',
  '672', '673', '674', '675', '676', '677', '678', '679', '680', '681', '682', '683',
  '685', '686', '687', '688', '689', '690', '691', '692', '800', '808', '850', '852',
  '853', '855', '856', '870', '878', '880', '881', '882', '883', '886', '888', '960',
  '961', '962', '963', '964', '965', '966', '967', '968', '970', '971', '972', '973',
  '974', '975', '976', '977', '979', '992', '993', '994', '995', '996', '998'];
BEGIN
  IF NOT country_code = ANY(calling_codes) THEN
    RAISE EXCEPTION 'Invalid default country code' USING ERRCODE = '22023';
  END IF;
  digits := canonical_contact_phone(phone, country_code);
  IF country_code IN ('39', '378') AND regexp_replace(phone, '[^0-9]', '', 'g') ~ '^0[1-9]' THEN
    digits := country_code || regexp_replace(phone, '[^0-9]', '', 'g');
  END IF;
  IF digits !~ '^[1-9][0-9]{6,14}$' OR phone ~ '[a-zA-Z]'
    OR digits !~ ('^(' || array_to_string(calling_codes, '|') || ')') THEN
    RAISE EXCEPTION 'Invalid phone number: %', phone USING ERRCODE = '22023';
  END IF;
  RETURN '+' || digits;
END $$;

CREATE OR REPLACE FUNCTION public.format_contact_international_phone()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE code TEXT; formatted TEXT;
BEGIN
  SELECT default_country_code INTO STRICT code FROM accounts WHERE id = NEW.account_id;
  formatted := international_phone_number(NEW.phone, code);
  -- Lock before the unique-index entry and the chat reattachment trigger.
  IF TG_OP = 'INSERT' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.account_id::text || ':' || substr(formatted, 2), 0));
  END IF;
  IF regexp_replace(NEW.phone, '[^0-9]', '', 'g') ~ '^0[1-9]' THEN
    NEW.phone_conversion := jsonb_build_object('input', NEW.phone, 'countryCode', code);
  ELSIF TG_OP = 'UPDATE' THEN
    IF formatted <> international_phone_number(OLD.phone, code)
       AND NEW.phone_conversion IS NOT DISTINCT FROM OLD.phone_conversion THEN
      NEW.phone_conversion := NULL;
    END IF;
  ELSIF NEW.phone_conversion IS NULL THEN
    SELECT contact_phone_conversion INTO NEW.phone_conversion FROM conversations
      WHERE account_id = NEW.account_id AND contact_id IS NULL AND contact_removed_at IS NOT NULL
        AND international_phone_number(contact_phone, code) = formatted
      ORDER BY created_at, id LIMIT 1;
  END IF;
  IF NEW.name = NEW.phone THEN NEW.name := formatted; END IF;
  NEW.phone := formatted;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.record_contact_phone_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE code TEXT; previous TEXT;
BEGIN
  SELECT default_country_code INTO code FROM accounts WHERE id = NEW.account_id;
  previous := international_phone_number(OLD.phone, code);
  IF previous <> NEW.phone THEN
    INSERT INTO contact_phone_history(account_id, contact_id, phone, phone_normalized, changed_by)
      VALUES (OLD.account_id, OLD.id, previous, substr(previous, 2), auth.uid());
  END IF;
  RETURN NEW;
END $$;

-- All dependent rows move before an alias contact or conversation is removed.
CREATE OR REPLACE FUNCTION public.merge_duplicate_conversations()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE g RECORD; latest conversations; target UUID; sources UUID[]; merged INTEGER := 0;
BEGIN
  FOR g IN SELECT account_id, contact_id, array_agg(id ORDER BY created_at, id) ids,
    sum(unread_count) unread, bool_or(ai_autoreply_disabled) paused, sum(ai_reply_count) replies
    FROM conversations WHERE contact_id IS NOT NULL GROUP BY account_id, contact_id HAVING count(*) > 1
  LOOP
    target := g.ids[1]; sources := g.ids[2:array_length(g.ids, 1)];
    SELECT * INTO latest FROM conversations WHERE id = ANY(g.ids)
      ORDER BY last_message_at DESC NULLS LAST, created_at DESC, id LIMIT 1;
    UPDATE messages SET conversation_id = target WHERE conversation_id = ANY(sources);
    UPDATE message_reactions SET conversation_id = target WHERE conversation_id = ANY(sources);
    UPDATE deals SET conversation_id = target WHERE conversation_id = ANY(sources);
    UPDATE flow_runs SET conversation_id = target WHERE conversation_id = ANY(sources);
    UPDATE notifications SET conversation_id = target WHERE conversation_id = ANY(sources);
    UPDATE ai_usage_log SET conversation_id = target WHERE conversation_id = ANY(sources);
    UPDATE conversations SET unread_count = g.unread, status = latest.status,
      assigned_agent_id = coalesce(latest.assigned_agent_id, (SELECT assigned_agent_id FROM conversations
        WHERE id = ANY(g.ids) AND assigned_agent_id IS NOT NULL ORDER BY updated_at DESC LIMIT 1)),
      ai_autoreply_disabled = coalesce(g.paused, false), ai_reply_count = coalesce(g.replies, 0),
      ai_handoff_summary = (SELECT ai_handoff_summary FROM conversations WHERE id = ANY(g.ids)
        AND ai_handoff_summary IS NOT NULL ORDER BY updated_at DESC LIMIT 1),
      last_message_at = latest.last_message_at, last_message_text = latest.last_message_text
    WHERE id = target;
    DELETE FROM conversations WHERE id = ANY(sources);
    merged := merged + cardinality(sources);
  END LOOP;
  RETURN merged;
END $$;
REVOKE ALL ON FUNCTION public.merge_duplicate_conversations() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.merge_duplicate_contacts()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE g RECORD; source contacts; target UUID; active_run UUID; merged INTEGER := 0;
BEGIN
  FOR g IN SELECT account_id, phone_normalized, array_agg(id ORDER BY created_at, id) ids
    FROM contacts GROUP BY account_id, phone_normalized HAVING count(*) > 1
  LOOP
    target := g.ids[1];
    SELECT id INTO active_run FROM flow_runs WHERE contact_id = ANY(g.ids) AND status = 'active'
      ORDER BY last_advanced_at DESC, started_at DESC, id LIMIT 1;
    UPDATE flow_runs SET status = 'paused_by_agent', ended_at = now(),
      end_reason = 'Phone aliases merged; the most recently advanced run remains active'
      WHERE contact_id = ANY(g.ids) AND status = 'active' AND id <> active_run;
    FOR source IN SELECT * FROM contacts WHERE id = ANY(g.ids) AND id <> target ORDER BY created_at, id
    LOOP
      -- Keep the complete previous profile and conflicting custom values in a note.
      INSERT INTO contact_notes(contact_id, user_id, account_id, note_text)
      VALUES (target, source.user_id, source.account_id, 'Merged phone alias: ' || jsonb_build_object(
        'contact', to_jsonb(source), 'custom_values', (SELECT jsonb_agg(to_jsonb(v))
          FROM contact_custom_values v WHERE contact_id = source.id))::text);
      UPDATE contacts SET name = coalesce(nullif(name, ''), source.name),
        profile_name = coalesce(nullif(profile_name, ''), source.profile_name),
        email = coalesce(nullif(email, ''), source.email), company = coalesce(nullif(company, ''), source.company),
        avatar_url = coalesce(avatar_url, source.avatar_url),
        phone_conversion = coalesce(phone_conversion, source.phone_conversion)
      WHERE id = target;
      INSERT INTO contact_tags(contact_id, tag_id) SELECT target, tag_id FROM contact_tags WHERE contact_id = source.id
        ON CONFLICT (contact_id, tag_id) DO NOTHING;
      INSERT INTO contact_custom_values(contact_id, custom_field_id, value)
        SELECT target, custom_field_id, value FROM contact_custom_values WHERE contact_id = source.id
        ON CONFLICT (contact_id, custom_field_id) DO UPDATE
        SET value = coalesce(nullif(contact_custom_values.value, ''), EXCLUDED.value);
      UPDATE conversations SET contact_id = target WHERE contact_id = source.id;
      UPDATE contact_notes SET contact_id = target WHERE contact_id = source.id;
      UPDATE contact_phone_history SET contact_id = target WHERE contact_id = source.id;
      UPDATE deals SET contact_id = target WHERE contact_id = source.id;
      UPDATE broadcast_recipients SET contact_id = target WHERE contact_id = source.id;
      UPDATE automation_logs SET contact_id = target WHERE contact_id = source.id;
      UPDATE automation_pending_executions SET contact_id = target WHERE contact_id = source.id;
      UPDATE flow_runs SET contact_id = target WHERE contact_id = source.id;
      UPDATE notifications SET contact_id = target WHERE contact_id = source.id;
      UPDATE message_reactions t SET emoji = s.emoji, created_at = s.created_at FROM message_reactions s
        WHERE t.message_id = s.message_id AND t.actor_type = 'customer' AND s.actor_type = 'customer'
          AND t.actor_id = target AND s.actor_id = source.id AND s.created_at > t.created_at;
      DELETE FROM message_reactions r WHERE actor_type = 'customer' AND actor_id = source.id
        AND EXISTS (SELECT 1 FROM message_reactions s WHERE s.message_id = r.message_id
          AND s.actor_type = 'customer' AND s.actor_id = target);
      UPDATE message_reactions SET actor_id = target WHERE actor_type = 'customer' AND actor_id = source.id;
      DELETE FROM contacts WHERE id = source.id;
      merged := merged + 1;
    END LOOP;
  END LOOP;
  PERFORM merge_duplicate_conversations();
  RETURN merged;
END $$;
REVOKE ALL ON FUNCTION public.merge_duplicate_contacts() FROM PUBLIC;

LOCK TABLE contacts, conversations IN ACCESS EXCLUSIVE MODE;
DROP INDEX IF EXISTS idx_contacts_account_phone_normalized;
DROP INDEX IF EXISTS idx_conversations_account_contact;
UPDATE contacts SET phone = phone;
SELECT merge_duplicate_contacts();
CREATE UNIQUE INDEX idx_contacts_account_phone_normalized ON contacts(account_id, phone_normalized) WHERE phone_normalized <> '';
CREATE UNIQUE INDEX idx_conversations_account_contact ON conversations(account_id, contact_id);

CREATE OR REPLACE FUNCTION public.format_saved_phone()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE code TEXT;
BEGIN
  IF TG_TABLE_NAME = 'conversations' THEN
    SELECT default_country_code INTO code FROM accounts WHERE id = NEW.account_id;
    IF NEW.contact_phone IS NOT NULL THEN
      IF regexp_replace(NEW.contact_phone, '[^0-9]', '', 'g') ~ '^0[1-9]' THEN
        NEW.contact_phone_conversion := jsonb_build_object('input', NEW.contact_phone, 'countryCode', code);
      END IF;
      NEW.contact_phone := international_phone_number(NEW.contact_phone, code);
    ELSE
      NEW.contact_phone_conversion := NULL;
    END IF;
  ELSIF TG_TABLE_NAME = 'contact_phone_history' THEN
    SELECT default_country_code INTO code FROM accounts WHERE id = NEW.account_id;
    NEW.phone := international_phone_number(NEW.phone, code);
    NEW.phone_normalized := substr(NEW.phone, 2);
  ELSE
    SELECT a.default_country_code INTO code FROM broadcasts b JOIN accounts a ON a.id = b.account_id
      WHERE b.id = NEW.broadcast_id;
    NEW.phone_attempted := international_phone_number(NEW.phone_attempted, code);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS format_saved_phone ON conversations;
CREATE TRIGGER format_saved_phone BEFORE INSERT OR UPDATE OF contact_phone ON conversations
  FOR EACH ROW EXECUTE FUNCTION public.format_saved_phone();
DROP TRIGGER IF EXISTS format_saved_phone ON contact_phone_history;
CREATE TRIGGER format_saved_phone BEFORE INSERT OR UPDATE OF phone ON contact_phone_history
  FOR EACH ROW EXECUTE FUNCTION public.format_saved_phone();
DROP TRIGGER IF EXISTS format_saved_phone ON broadcast_recipients;
CREATE TRIGGER format_saved_phone BEFORE INSERT OR UPDATE OF phone_attempted ON broadcast_recipients
  FOR EACH ROW EXECUTE FUNCTION public.format_saved_phone();
UPDATE conversations SET contact_phone = contact_phone WHERE contact_phone IS NOT NULL;
UPDATE contact_phone_history SET phone = phone;
UPDATE broadcast_recipients SET phone_attempted = phone_attempted WHERE phone_attempted IS NOT NULL;

CREATE OR REPLACE FUNCTION public.preserve_contact_chat()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE conversations SET contact_phone = OLD.phone, contact_name = coalesce(nullif(OLD.name, ''), OLD.profile_name),
    contact_phone_conversion = OLD.phone_conversion, contact_removed_at = now() WHERE contact_id = OLD.id;
  RETURN OLD;
END $$;

CREATE OR REPLACE FUNCTION public.prepare_contact_phones(p_account_id UUID, p_phones TEXT[], p_default_country_code TEXT)
RETURNS VOID LANGUAGE plpgsql SET search_path = public AS $$
DECLARE keys TEXT[]; phone_key TEXT; chat conversations; saved_id UUID;
BEGIN
  IF current_user NOT IN ('postgres', 'service_role') AND NOT is_account_member(p_account_id, 'agent') THEN
    RAISE EXCEPTION 'Insufficient permission' USING ERRCODE = '42501';
  END IF;
  SELECT array_agg(DISTINCT international_phone_number(phone, p_default_country_code)) INTO keys FROM unnest(p_phones) phone;
  FOR phone_key IN SELECT key FROM unnest(keys) key ORDER BY key LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(p_account_id::text || ':' || substr(phone_key, 2), 0));
  END LOOP;
  FOR chat IN SELECT * FROM conversations WHERE account_id = p_account_id AND contact_id IS NULL
    AND contact_removed_at IS NOT NULL AND contact_phone = ANY(keys) ORDER BY created_at, id FOR UPDATE
  LOOP
    SELECT id INTO saved_id FROM contacts WHERE account_id = p_account_id AND phone = chat.contact_phone ORDER BY created_at, id LIMIT 1 FOR UPDATE;
    IF saved_id IS NOT NULL AND chat.contact_phone_conversion IS NOT NULL THEN
      UPDATE contacts SET phone_conversion = coalesce(phone_conversion, chat.contact_phone_conversion) WHERE id = saved_id;
    END IF;
    IF saved_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM conversations WHERE account_id = p_account_id AND contact_id = saved_id) THEN
      UPDATE conversations SET contact_id = saved_id, contact_removed_at = NULL, contact_phone = NULL,
        contact_name = NULL, contact_phone_conversion = NULL WHERE id = chat.id;
    END IF;
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS public.update_contact_details(UUID, TEXT, TEXT, TEXT, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.update_contact_details(p_contact_id UUID, p_default_country_code TEXT, p_phone TEXT,
  p_name TEXT DEFAULT NULL, p_email TEXT DEFAULT NULL, p_company TEXT DEFAULT NULL, p_phone_conversion JSONB DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SET search_path = public AS $$
DECLARE saved contacts; formatted TEXT; conversion JSONB;
BEGIN
  SELECT * INTO saved FROM contacts WHERE id = p_contact_id;
  IF NOT FOUND OR (current_user NOT IN ('postgres', 'service_role') AND NOT is_account_member(saved.account_id, 'agent')) THEN
    RAISE EXCEPTION 'Contact not found or insufficient permission' USING ERRCODE = '42501';
  END IF;
  formatted := international_phone_number(p_phone, p_default_country_code);
  conversion := CASE WHEN regexp_replace(p_phone, '[^0-9]', '', 'g') ~ '^0[1-9]'
    THEN jsonb_build_object('input', p_phone, 'countryCode', p_default_country_code) ELSE p_phone_conversion END;
  PERFORM pg_advisory_xact_lock(hashtextextended(saved.account_id::text || ':' || substr(formatted, 2), 0));
  SELECT * INTO saved FROM contacts WHERE id = p_contact_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Contact not found' USING ERRCODE = '42501'; END IF;
  UPDATE contacts SET phone = formatted,
    phone_conversion = CASE WHEN formatted = saved.phone AND conversion IS NULL THEN saved.phone_conversion ELSE conversion END,
    name = p_name, email = p_email, company = p_company, updated_at = now() WHERE id = saved.id;
END $$;
REVOKE ALL ON FUNCTION public.update_contact_details(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_contact_details(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.format_template_phone_buttons()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE code TEXT;
BEGIN
  SELECT default_country_code INTO code FROM accounts WHERE id = NEW.account_id;
  IF jsonb_typeof(NEW.buttons) = 'array' THEN
    SELECT coalesce(jsonb_agg(CASE WHEN b->>'type' = 'PHONE_NUMBER' AND coalesce(b->>'phone_number', '') <> ''
      THEN jsonb_set(b, '{phone_number}', to_jsonb(international_phone_number(b->>'phone_number', code))) ELSE b END ORDER BY ord), '[]'::jsonb)
      INTO NEW.buttons FROM jsonb_array_elements(NEW.buttons) WITH ORDINALITY t(b, ord);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS format_phone_buttons ON message_templates;
CREATE TRIGGER format_phone_buttons BEFORE INSERT OR UPDATE OF buttons ON message_templates
  FOR EACH ROW EXECUTE FUNCTION public.format_template_phone_buttons();
UPDATE message_templates SET buttons = buttons WHERE jsonb_typeof(buttons) = 'array';

ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_international_phone;
ALTER TABLE contacts ADD CONSTRAINT contacts_international_phone CHECK (phone ~ '^\+[1-9][0-9]{6,14}$');
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_international_phone;
ALTER TABLE conversations ADD CONSTRAINT conversations_international_phone CHECK (contact_phone IS NULL OR contact_phone ~ '^\+[1-9][0-9]{6,14}$');
ALTER TABLE contact_phone_history DROP CONSTRAINT IF EXISTS history_international_phone;
ALTER TABLE contact_phone_history ADD CONSTRAINT history_international_phone CHECK (phone ~ '^\+[1-9][0-9]{6,14}$');
ALTER TABLE broadcast_recipients DROP CONSTRAINT IF EXISTS recipients_international_phone;
ALTER TABLE broadcast_recipients ADD CONSTRAINT recipients_international_phone CHECK (phone_attempted IS NULL OR phone_attempted ~ '^\+[1-9][0-9]{6,14}$');
NOTIFY pgrst, 'reload schema';
COMMIT;
