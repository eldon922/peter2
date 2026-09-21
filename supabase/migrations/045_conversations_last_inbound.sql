-- ============================================================
-- 045_conversations_last_inbound.sql — last customer message per
-- conversation, for the Inbox "time remaining" badge
--
-- Why
--
--   The conversation list badge ("23h", "Expired") is driven by the
--   customer's last inbound message inside the 24h WhatsApp window.
--   The client used to get it with
--
--     messages WHERE sender_type = 'customer' AND created_at >= now-24h
--            AND conversation_id IN (<every conversation id>)
--
--   which fails in two silent ways on a real inbox:
--
--     * the id list goes into the request URL, so past a couple of
--       hundred conversations the request is rejected (414 / 400);
--     * PostgREST caps a response at 1000 rows, so a busy account
--       gets a truncated result with arbitrary conversations missing.
--
--   Either way the client ended up with an empty/partial map, and an
--   absent conversation means "no open window" — so every row showed
--   "Expired". Same class of problem 025 and 040 document.
--
--   This does the aggregation in the database: one row per
--   conversation, no id list, no row-per-message transfer.
--
-- Security
--
--   SECURITY INVOKER (the default), so `messages_select` from 017
--   applies unchanged — the caller only sees conversations in their
--   own account.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_messages_customer_created
  ON messages (created_at DESC)
  WHERE sender_type = 'customer';

CREATE OR REPLACE FUNCTION public.conversations_last_inbound(
  p_window_hours INTEGER DEFAULT 24
)
RETURNS TABLE (conversation_id UUID, last_inbound_at TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT m.conversation_id, max(m.created_at) AS last_inbound_at
  FROM messages m
  WHERE m.sender_type = 'customer'
    AND m.created_at >= now() - make_interval(hours => p_window_hours)
  GROUP BY m.conversation_id;
$$;

ALTER FUNCTION public.conversations_last_inbound(INTEGER) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.conversations_last_inbound(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.conversations_last_inbound(INTEGER) TO authenticated;
