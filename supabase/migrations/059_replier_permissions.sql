CREATE OR REPLACE FUNCTION public.is_account_member(target_account_id UUID, min_role account_role_enum DEFAULT 'viewer') RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.account_id = target_account_id
    AND CASE p.account_role WHEN 'owner' THEN 5 WHEN 'admin' THEN 4 WHEN 'agent' THEN 3 WHEN 'replier' THEN 2 WHEN 'viewer' THEN 1 END
      >= CASE min_role WHEN 'owner' THEN 5 WHEN 'admin' THEN 4 WHEN 'agent' THEN 3 WHEN 'replier' THEN 2 WHEN 'viewer' THEN 1 END);
$$;

DROP POLICY IF EXISTS messages_modify ON public.messages;
CREATE POLICY messages_insert ON public.messages FOR INSERT WITH CHECK (
  sender_type = 'agent' AND EXISTS (SELECT 1 FROM conversations c WHERE c.id = messages.conversation_id AND is_account_member(c.account_id, 'replier')));
CREATE POLICY messages_update ON public.messages FOR UPDATE USING (
  EXISTS (SELECT 1 FROM conversations c WHERE c.id = messages.conversation_id AND is_account_member(c.account_id, 'agent')));
CREATE POLICY messages_delete ON public.messages FOR DELETE USING (
  EXISTS (SELECT 1 FROM conversations c WHERE c.id = messages.conversation_id AND is_account_member(c.account_id, 'agent')));
ALTER POLICY conversations_update ON public.conversations USING (is_account_member(account_id, 'replier')) WITH CHECK (is_account_member(account_id, 'replier'));
ALTER POLICY message_reactions_modify ON public.message_reactions USING (
  actor_type = 'agent' AND actor_id = auth.uid() AND EXISTS (SELECT 1 FROM conversations c WHERE c.id = message_reactions.conversation_id AND is_account_member(c.account_id, 'replier'))
) WITH CHECK (
  actor_type = 'agent' AND actor_id = auth.uid() AND EXISTS (SELECT 1 FROM messages m JOIN conversations c ON c.id = m.conversation_id
    WHERE m.id = message_reactions.message_id AND c.id = message_reactions.conversation_id AND is_account_member(c.account_id, 'replier')));

CREATE OR REPLACE FUNCTION public.guard_replier_chat_update() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF is_account_member(OLD.account_id, 'replier') AND NOT is_account_member(OLD.account_id, 'agent')
    AND (to_jsonb(NEW) - ARRAY['unread_count', 'last_message_at', 'last_message_text', 'updated_at'])
      IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['unread_count', 'last_message_at', 'last_message_text', 'updated_at']) THEN
    RAISE EXCEPTION 'Repliers may only reply and mark chats read' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_replier_chat_update ON public.conversations;
CREATE TRIGGER guard_replier_chat_update BEFORE UPDATE ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.guard_replier_chat_update();

ALTER POLICY "Members can upload chat media" ON storage.objects WITH CHECK (
  bucket_id = 'chat-media' AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid()
    AND ('account-' || p.account_id::text) = (storage.foldername(name))[1] AND is_account_member(p.account_id, 'replier')));
ALTER POLICY "Members can update chat media" ON storage.objects USING (
  bucket_id = 'chat-media' AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid()
    AND ('account-' || p.account_id::text) = (storage.foldername(name))[1] AND is_account_member(p.account_id, 'agent')));
ALTER POLICY "Members can delete chat media" ON storage.objects USING (
  bucket_id = 'chat-media' AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid()
    AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    AND (is_account_member(p.account_id, 'agent') OR (is_account_member(p.account_id, 'replier') AND owner_id = auth.uid()::text))));
