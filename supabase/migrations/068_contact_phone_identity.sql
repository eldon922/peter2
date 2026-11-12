CREATE OR REPLACE FUNCTION public.canonical_contact_phone(phone TEXT, country_code TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN digits LIKE '00%' THEN substr(digits, 3)
    WHEN digits LIKE '0%' AND country_code IS NOT NULL THEN country_code || substr(digits, 2)
    ELSE digits
  END
  FROM (SELECT regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') AS digits) normalized;
$$;

-- Normalize matching detached snapshots before an INSERT, so the existing
-- exact-match reattachment trigger can preserve the original conversation.
CREATE OR REPLACE FUNCTION public.prepare_contact_phones(
  p_account_id UUID, p_phones TEXT[], p_default_country_code TEXT
) RETURNS VOID LANGUAGE plpgsql SET search_path = public AS $$
DECLARE keys TEXT[]; phone_key TEXT; chat conversations; saved_id UUID;
BEGIN
  IF current_user NOT IN ('postgres', 'service_role')
     AND NOT is_account_member(p_account_id, 'agent') THEN
    RAISE EXCEPTION 'Insufficient permission' USING ERRCODE = '42501';
  END IF;
  IF p_default_country_code IS NULL OR p_default_country_code !~ '^[0-9]{1,3}$' THEN
    RAISE EXCEPTION 'Invalid country code' USING ERRCODE = '22023';
  END IF;
  SELECT array_agg(DISTINCT canonical_contact_phone(phone, p_default_country_code)) INTO keys
    FROM unnest(p_phones) phone;
  FOR phone_key IN SELECT key FROM unnest(keys) key ORDER BY key LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(p_account_id::text || ':' || phone_key, 0));
  END LOOP;
  UPDATE conversations SET contact_phone = canonical_contact_phone(contact_phone, p_default_country_code)
  WHERE account_id = p_account_id AND contact_id IS NULL AND contact_removed_at IS NOT NULL
    AND canonical_contact_phone(contact_phone, p_default_country_code) = ANY(keys);

  FOR chat IN SELECT * FROM conversations
    WHERE account_id = p_account_id AND contact_id IS NULL AND contact_removed_at IS NOT NULL
      AND contact_phone = ANY(keys) ORDER BY created_at, id FOR UPDATE
  LOOP
    SELECT id INTO saved_id FROM contacts WHERE account_id = p_account_id
      AND canonical_contact_phone(phone, p_default_country_code) = chat.contact_phone
      ORDER BY created_at, id LIMIT 1 FOR UPDATE;
    IF saved_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM conversations WHERE account_id = p_account_id AND contact_id = saved_id
    ) THEN
      UPDATE conversations SET contact_id = saved_id, contact_removed_at = NULL,
        contact_phone = NULL, contact_name = NULL WHERE id = chat.id;
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.prepare_contact_phones(UUID, TEXT[], TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prepare_contact_phones(UUID, TEXT[], TEXT) TO authenticated, service_role;

-- Check and update in one transaction. An unchanged phone field keeps
-- its stored value, allowing name/email edits on pre-existing alias pairs.
CREATE OR REPLACE FUNCTION public.update_contact_details(
  p_contact_id UUID, p_default_country_code TEXT, p_phone TEXT,
  p_name TEXT DEFAULT NULL, p_email TEXT DEFAULT NULL, p_company TEXT DEFAULT NULL
) RETURNS VOID LANGUAGE plpgsql SET search_path = public AS $$
DECLARE saved contacts; phone_key TEXT; changed BOOLEAN;
BEGIN
  SELECT * INTO saved FROM contacts WHERE id = p_contact_id;
  IF NOT FOUND OR (current_user NOT IN ('postgres', 'service_role')
      AND NOT is_account_member(saved.account_id, 'agent')) THEN
    RAISE EXCEPTION 'Contact not found or insufficient permission' USING ERRCODE = '42501';
  END IF;
  IF p_default_country_code IS NULL OR p_default_country_code !~ '^[0-9]{1,3}$' THEN
    RAISE EXCEPTION 'Invalid country code' USING ERRCODE = '22023';
  END IF;
  phone_key := canonical_contact_phone(p_phone, p_default_country_code);
  IF phone_key = '' THEN RAISE EXCEPTION 'Phone is required' USING ERRCODE = '22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(saved.account_id::text || ':' || phone_key, 0));
  SELECT * INTO saved FROM contacts WHERE id = p_contact_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Contact not found' USING ERRCODE = '42501'; END IF;
  changed := p_phone IS DISTINCT FROM saved.phone;
  IF changed THEN
    IF EXISTS (SELECT 1 FROM contacts WHERE account_id = saved.account_id AND id <> saved.id
      AND canonical_contact_phone(phone, p_default_country_code) = phone_key) THEN
      RAISE EXCEPTION 'Phone number already belongs to another contact' USING ERRCODE = '23505';
    END IF;
  END IF;
  UPDATE contacts SET phone = CASE WHEN changed THEN phone_key ELSE saved.phone END,
    name = p_name, email = p_email, company = p_company, updated_at = now()
  WHERE id = saved.id;
END $$;
REVOKE ALL ON FUNCTION public.update_contact_details(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_contact_details(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.save_conversation_contact(UUID);
CREATE OR REPLACE FUNCTION public.save_conversation_contact(
  p_conversation_id UUID, p_default_country_code TEXT DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE chat conversations; linked conversations; saved_id UUID; phone_key TEXT;
BEGIN
  SELECT * INTO chat FROM conversations WHERE id = p_conversation_id;
  IF NOT FOUND OR NOT is_account_member(chat.account_id, 'agent') THEN
    RAISE EXCEPTION 'Conversation not found or insufficient permission' USING ERRCODE = '42501';
  END IF;
  IF chat.contact_id IS NOT NULL THEN RETURN chat.contact_id; END IF;
  IF chat.contact_phone IS NULL OR chat.contact_removed_at IS NULL THEN
    RAISE EXCEPTION 'No saved contact details are available' USING ERRCODE = '22023';
  END IF;
  IF p_default_country_code IS NOT NULL AND p_default_country_code !~ '^[0-9]{1,3}$' THEN
    RAISE EXCEPTION 'Invalid country code' USING ERRCODE = '22023';
  END IF;
  phone_key := canonical_contact_phone(chat.contact_phone, p_default_country_code);
  PERFORM pg_advisory_xact_lock(hashtextextended(chat.account_id::text || ':' || phone_key, 0));
  SELECT * INTO chat FROM conversations WHERE id = p_conversation_id FOR UPDATE;
  IF chat.contact_id IS NOT NULL THEN RETURN chat.contact_id; END IF;
  IF p_default_country_code IS NOT NULL THEN
    PERFORM prepare_contact_phones(chat.account_id, ARRAY[chat.contact_phone], p_default_country_code);
    SELECT * INTO chat FROM conversations WHERE id = p_conversation_id;
    IF chat.contact_id IS NOT NULL THEN RETURN chat.contact_id; END IF;
  END IF;
  SELECT id INTO saved_id FROM contacts WHERE account_id = chat.account_id
    AND canonical_contact_phone(phone, p_default_country_code) = phone_key
    ORDER BY created_at, id LIMIT 1 FOR UPDATE;
  IF saved_id IS NULL THEN
    INSERT INTO contacts (account_id, user_id, phone, name)
      VALUES (chat.account_id, auth.uid(), phone_key, chat.contact_name)
      ON CONFLICT (account_id, phone_normalized) WHERE phone_normalized <> '' DO NOTHING
      RETURNING id INTO saved_id;
    IF saved_id IS NULL THEN
      SELECT id INTO saved_id FROM contacts WHERE account_id = chat.account_id
        AND phone_normalized = phone_key;
    END IF;
  END IF;
  IF saved_id IS NULL THEN
    RAISE EXCEPTION 'Could not resolve the saved contact' USING ERRCODE = '23505';
  END IF;
  SELECT * INTO linked FROM conversations WHERE account_id = chat.account_id
    AND contact_id = saved_id AND id <> chat.id FOR UPDATE;
  IF FOUND THEN
    -- A contact recreated before this migration may already have a new
    -- thread. Move every child before removing that redundant thread.
    UPDATE messages SET conversation_id = chat.id WHERE conversation_id = linked.id;
    UPDATE message_reactions SET conversation_id = chat.id WHERE conversation_id = linked.id;
    UPDATE deals SET conversation_id = chat.id WHERE conversation_id = linked.id;
    UPDATE flow_runs SET conversation_id = chat.id WHERE conversation_id = linked.id;
    UPDATE notifications SET conversation_id = chat.id WHERE conversation_id = linked.id;
    UPDATE ai_usage_log SET conversation_id = chat.id WHERE conversation_id = linked.id;
    DELETE FROM conversations WHERE id = linked.id;
    UPDATE conversations SET status = linked.status,
      assigned_agent_id = coalesce(linked.assigned_agent_id, chat.assigned_agent_id),
      ai_autoreply_disabled = coalesce(chat.ai_autoreply_disabled, false) OR coalesce(linked.ai_autoreply_disabled, false),
      ai_reply_count = coalesce(chat.ai_reply_count, 0) + coalesce(linked.ai_reply_count, 0),
      ai_handoff_summary = coalesce(linked.ai_handoff_summary, chat.ai_handoff_summary),
      unread_count = coalesce(chat.unread_count, 0) + coalesce(linked.unread_count, 0),
      last_message_at = greatest(chat.last_message_at, linked.last_message_at),
      last_message_text = CASE WHEN linked.last_message_at > coalesce(chat.last_message_at, '-infinity')
        THEN linked.last_message_text ELSE chat.last_message_text END
    WHERE id = chat.id;
  END IF;
  UPDATE conversations SET contact_id = saved_id, contact_removed_at = NULL,
    contact_phone = NULL, contact_name = NULL WHERE id = chat.id;
  RETURN saved_id;
END $$;
REVOKE ALL ON FUNCTION public.save_conversation_contact(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_conversation_contact(UUID, TEXT) TO authenticated;
NOTIFY pgrst, 'reload schema';
