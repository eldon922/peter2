ALTER TABLE public.broadcasts ADD COLUMN IF NOT EXISTS send_run_pending INTEGER DEFAULT 0;
ALTER TABLE public.broadcasts ALTER COLUMN send_run_pending SET DEFAULT 0;

CREATE OR REPLACE FUNCTION public._bcast_cols_for_status(s TEXT)
RETURNS TEXT[] AS $$
BEGIN
  IF s = 'pending' THEN RETURN ARRAY['send_run_pending']; END IF;
  IF s = 'sent'      THEN RETURN ARRAY['sent_count']; END IF;
  IF s = 'delivered' THEN RETURN ARRAY['sent_count','delivered_count']; END IF;
  IF s = 'read'      THEN RETURN ARRAY['sent_count','delivered_count','read_count']; END IF;
  IF s = 'replied'   THEN RETURN ARRAY['sent_count','delivered_count','read_count','replied_count']; END IF;
  IF s = 'failed'    THEN RETURN ARRAY['failed_count']; END IF;
  RETURN ARRAY[]::TEXT[];
END;
$$ LANGUAGE plpgsql IMMUTABLE;


CREATE OR REPLACE FUNCTION public.recompute_broadcast_counts(bid UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE broadcasts b SET
    send_run_pending = agg.pending_count,
    sent_count      = agg.sent_count,
    delivered_count = agg.delivered_count,
    read_count      = agg.read_count,
    replied_count   = agg.replied_count,
    failed_count    = agg.failed_count,
    updated_at      = NOW()
  FROM (
    SELECT
      COUNT(*) FILTER (WHERE status = 'pending') AS pending_count,
      COUNT(*) FILTER (WHERE status IN ('sent','delivered','read','replied')) AS sent_count,
      COUNT(*) FILTER (WHERE status IN ('delivered','read','replied'))        AS delivered_count,
      COUNT(*) FILTER (WHERE status IN ('read','replied'))                    AS read_count,
      COUNT(*) FILTER (WHERE status = 'replied')                              AS replied_count,
      COUNT(*) FILTER (WHERE status = 'failed')                               AS failed_count
    FROM broadcast_recipients
    WHERE broadcast_id = bid
  ) agg
  WHERE b.id = bid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.track_broadcast_run_progress() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'sending' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.started_at := now();
      NEW.completed_at := NULL;
      NEW.send_run_total := NEW.total_recipients;
      NEW.send_run_baseline := 0;
      NEW.send_run_pending := 0;
    ELSIF OLD.status <> 'sending' THEN
      NEW.started_at := now();
      NEW.completed_at := NULL;
      SELECT count(*) INTO NEW.send_run_total FROM broadcast_recipients WHERE broadcast_id = NEW.id AND status = 'pending';
      NEW.send_run_pending := NEW.send_run_total;
      SELECT count(*) INTO NEW.send_run_baseline FROM broadcast_recipients
        WHERE broadcast_id = NEW.id AND status IN ('sent', 'delivered', 'read', 'replied', 'failed');
    END IF;
  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'sending' THEN
    NEW.completed_at := now();
  END IF;
  RETURN NEW;
END $$;

-- Populate the durable pending counter without changing scheduling or sending.
UPDATE public.broadcasts b SET send_run_pending = (
  SELECT count(*) FROM public.broadcast_recipients r WHERE r.broadcast_id = b.id AND r.status = 'pending'
);
