-- Recover only retained engagement evidence. A NULL resolved parent
-- can mean an unresolved/deleted quotation, so it cannot prove that a
-- historical message was an unquoted reply to the latest campaign.
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_contact_sent
  ON public.broadcast_recipients (contact_id, sent_at DESC)
  WHERE sent_at IS NOT NULL;

WITH quoted_replies AS (
  SELECT r.id, m.created_at AS engaged_at
  FROM public.messages m
  JOIN public.conversations c ON c.id = m.conversation_id
  JOIN public.messages target ON target.id = m.reply_to_message_id
    AND target.conversation_id = c.id
  JOIN public.broadcast_recipients r ON r.whatsapp_message_id = target.message_id
  JOIN public.broadcasts b ON b.id = r.broadcast_id AND b.account_id = c.account_id
  WHERE m.sender_type = 'customer'
), reactions AS (
  SELECT r.id, reaction.created_at AS engaged_at
  FROM public.message_reactions reaction
  JOIN public.messages target ON target.id = reaction.message_id
    AND target.conversation_id = reaction.conversation_id
  JOIN public.conversations c ON c.id = target.conversation_id
  JOIN public.broadcast_recipients r ON r.whatsapp_message_id = target.message_id
  JOIN public.broadcasts b ON b.id = r.broadcast_id AND b.account_id = c.account_id
  WHERE reaction.actor_type = 'customer'
), engagement AS (
  SELECT id, min(engaged_at) AS first_engaged_at
  FROM (
    SELECT * FROM quoted_replies
    UNION ALL SELECT * FROM reactions
    UNION ALL SELECT id, replied_at FROM public.broadcast_recipients WHERE replied_at IS NOT NULL
  ) events
  GROUP BY id
)
UPDATE public.broadcast_recipients r
SET status = 'replied',
    replied_at = least(r.replied_at, engagement.first_engaged_at)
FROM engagement
WHERE r.id = engagement.id AND r.status IN ('sent', 'delivered', 'read', 'replied')
  AND (r.status <> 'replied' OR r.replied_at IS NULL
    OR r.replied_at > engagement.first_engaged_at);

-- Rebuild totals as well, repairing any earlier aggregate drift.
DO $$
DECLARE bid UUID;
BEGIN
  FOR bid IN SELECT id FROM public.broadcasts LOOP
    PERFORM public.recompute_broadcast_counts(bid);
  END LOOP;
END $$;
