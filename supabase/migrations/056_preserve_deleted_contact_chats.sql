ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS contact_phone TEXT,
  ADD COLUMN IF NOT EXISTS contact_name TEXT,
  ADD COLUMN IF NOT EXISTS contact_removed_at TIMESTAMPTZ;
ALTER TABLE public.conversations ALTER COLUMN contact_id DROP NOT NULL;
ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_contact_id_fkey;
ALTER TABLE public.conversations ADD CONSTRAINT conversations_contact_id_fkey
  FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.preserve_contact_chat() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE conversations SET contact_phone = OLD.phone,
    contact_name = coalesce(OLD.name, OLD.profile_name), contact_removed_at = now()
    WHERE contact_id = OLD.id AND account_id = OLD.account_id;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.preserve_contact_chat() FROM PUBLIC;
DROP TRIGGER IF EXISTS preserve_contact_chat ON public.contacts;
CREATE TRIGGER preserve_contact_chat BEFORE DELETE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.preserve_contact_chat();

CREATE OR REPLACE FUNCTION public.reattach_saved_contact_chat() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE conversations SET contact_id = NEW.id, contact_removed_at = NULL,
    contact_phone = NULL, contact_name = NULL
  WHERE id = (
    SELECT id FROM conversations WHERE account_id = NEW.account_id AND contact_id IS NULL
      AND contact_removed_at IS NOT NULL AND regexp_replace(contact_phone, '\D', '', 'g') = NEW.phone_normalized
    ORDER BY created_at, id LIMIT 1
  ) AND NOT EXISTS (SELECT 1 FROM conversations WHERE account_id = NEW.account_id AND contact_id = NEW.id);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.reattach_saved_contact_chat() FROM PUBLIC;
DROP TRIGGER IF EXISTS reattach_saved_contact_chat ON public.contacts;
CREATE TRIGGER reattach_saved_contact_chat AFTER INSERT ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.reattach_saved_contact_chat();

CREATE OR REPLACE FUNCTION public.save_conversation_contact(p_conversation_id UUID) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE chat conversations; saved_id UUID;
BEGIN
  SELECT * INTO chat FROM conversations WHERE id = p_conversation_id FOR UPDATE;
  IF NOT FOUND OR NOT is_account_member(chat.account_id, 'agent') THEN
    RAISE EXCEPTION 'Conversation not found or insufficient permission' USING ERRCODE = '42501';
  END IF;
  IF chat.contact_id IS NOT NULL THEN RETURN chat.contact_id; END IF;
  IF chat.contact_phone IS NULL OR chat.contact_removed_at IS NULL THEN
    RAISE EXCEPTION 'No saved contact details are available' USING ERRCODE = '22023';
  END IF;
  INSERT INTO contacts (account_id, user_id, phone, name)
    VALUES (chat.account_id, auth.uid(), chat.contact_phone, chat.contact_name)
    ON CONFLICT (account_id, phone_normalized) WHERE phone_normalized <> '' DO NOTHING
    RETURNING id INTO saved_id;
  IF saved_id IS NULL THEN
    SELECT id INTO saved_id FROM contacts WHERE account_id = chat.account_id
      AND phone_normalized = regexp_replace(chat.contact_phone, '\D', '', 'g');
  END IF;
  UPDATE conversations SET contact_id = saved_id, contact_removed_at = NULL,
    contact_phone = NULL, contact_name = NULL WHERE id = chat.id;
  RETURN saved_id;
END $$;
REVOKE ALL ON FUNCTION public.save_conversation_contact(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_conversation_contact(UUID) TO authenticated;
