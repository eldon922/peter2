ALTER TABLE public.broadcasts ADD COLUMN IF NOT EXISTS send_run_total INTEGER;
ALTER TABLE public.broadcasts ADD COLUMN IF NOT EXISTS send_run_baseline INTEGER;

CREATE OR REPLACE FUNCTION public.track_broadcast_run_progress() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'sending' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.send_run_total := NEW.total_recipients;
      NEW.send_run_baseline := 0;
    ELSIF OLD.status <> 'sending' THEN
      SELECT count(*) INTO NEW.send_run_total FROM broadcast_recipients WHERE broadcast_id = NEW.id AND status = 'pending';
      NEW.send_run_baseline := NEW.sent_count + NEW.failed_count;
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.track_broadcast_run_progress() FROM PUBLIC;
DROP TRIGGER IF EXISTS track_broadcast_run_progress ON public.broadcasts;
CREATE TRIGGER track_broadcast_run_progress BEFORE INSERT OR UPDATE OF status ON public.broadcasts
  FOR EACH ROW EXECUTE FUNCTION public.track_broadcast_run_progress();
