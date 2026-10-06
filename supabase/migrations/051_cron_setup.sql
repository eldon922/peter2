-- ============================================================
-- Cron job that starts scheduled broadcasts
--
-- Scheduled broadcasts only go out when GET /api/broadcasts/cron is
-- called every minute. The app calls setup_cron_jobs() each time it
-- starts, so the Supabase cron job (pg_cron + pg_net) exists without
-- anyone creating it by hand. The app passes its own public URL and
-- AUTOMATION_CRON_SECRET, so a changed URL or secret is fixed on the
-- next start.
--
-- Only service_role may call it: it schedules a job that runs as the
-- database owner and carries the secret.
--
-- Needs pg_cron and pg_net (both available on Supabase).
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.setup_cron_jobs(app_url text, cron_secret text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF coalesce(app_url, '') = '' OR coalesce(cron_secret, '') = '' THEN
    RAISE EXCEPTION 'app_url and cron_secret are required';
  END IF;

  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'peter2-broadcasts';
  PERFORM cron.schedule(
    'peter2-broadcasts',
    '* * * * *',
    format(
      'select net.http_get(url := %L, headers := jsonb_build_object(''x-cron-secret'', %L), timeout_milliseconds := 30000)',
      rtrim(app_url, '/') || '/api/broadcasts/cron',
      cron_secret
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.setup_cron_jobs(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.setup_cron_jobs(text, text) TO service_role;
