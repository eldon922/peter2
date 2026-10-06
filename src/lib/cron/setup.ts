import { supabaseAdmin } from '@/lib/flows/admin-client';
import { createLogger } from '@/lib/log';

const log = createLogger('cron-setup');

/**
 * Creates (or refreshes) the Supabase cron job that starts scheduled
 * broadcasts, through `setup_cron_jobs` from migration 051. Never throws:
 * a missing migration or setting only means broadcasts won't start on time.
 */
export async function setupCronJobs(): Promise<void> {
  const appUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const secret = process.env.AUTOMATION_CRON_SECRET;
  if (!appUrl || !secret) {
    log.warn(
      'cron job not set up: set NEXT_PUBLIC_SITE_URL and AUTOMATION_CRON_SECRET to start scheduled broadcasts'
    );
    return;
  }

  try {
    const { error } = await supabaseAdmin().rpc('setup_cron_jobs', {
      app_url: appUrl,
      cron_secret: secret,
    });
    if (error) {
      log.warn('cron job not set up (is migration 051 applied?)', {
        error: error.message,
      });
      return;
    }
    log.info('cron job ready', { url: appUrl });
  } catch (error) {
    log.warn('cron job not set up', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
