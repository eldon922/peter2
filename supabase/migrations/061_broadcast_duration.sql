ALTER TABLE public.broadcasts ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE public.broadcasts ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.track_broadcast_run_progress() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'sending' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.started_at := now();
      NEW.completed_at := NULL;
      NEW.send_run_total := NEW.total_recipients;
      NEW.send_run_baseline := 0;
    ELSIF OLD.status <> 'sending' THEN
      NEW.started_at := now();
      NEW.completed_at := NULL;
      SELECT count(*) INTO NEW.send_run_total FROM broadcast_recipients WHERE broadcast_id = NEW.id AND status = 'pending';
      NEW.send_run_baseline := NEW.sent_count + NEW.failed_count;
    END IF;
  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'sending' THEN
    NEW.completed_at := now();
  END IF;
  RETURN NEW;
END $$;
