ALTER TABLE public.deals DROP CONSTRAINT IF EXISTS deals_conversation_id_fkey;
ALTER TABLE public.deals ADD CONSTRAINT deals_conversation_id_fkey
  FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.refresh_chat_after_message_delete() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE latest messages;
BEGIN
  SELECT * INTO latest FROM messages WHERE conversation_id = OLD.conversation_id ORDER BY created_at DESC, id DESC LIMIT 1;
  UPDATE conversations SET last_message_text = latest.content_text, last_message_at = latest.created_at WHERE id = OLD.conversation_id;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.refresh_chat_after_message_delete() FROM PUBLIC;
DROP TRIGGER IF EXISTS refresh_chat_after_message_delete ON public.messages;
CREATE TRIGGER refresh_chat_after_message_delete AFTER DELETE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.refresh_chat_after_message_delete();
