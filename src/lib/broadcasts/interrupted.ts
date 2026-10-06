import type { SupabaseClient } from '@supabase/supabase-js';

import { createLogger } from '@/lib/log';
import { stopBroadcast } from '@/lib/whatsapp/broadcast-core';

const log = createLogger('startup');

export const INTERRUPTED_REASON = 'Interrupted by a server restart — retry to resume';

/**
 * A broadcast still 'sending' when the app boots lost its send with the
 * previous process: nothing is delivering it any more. Stop it the way the
 * Stop button does, so the unsent recipients show as failed and Retry
 * resumes them. Runs once at boot and assumes one copy of the app.
 *
 * Only broadcasts untouched since `bootedAt` count, so one that started
 * sending after boot is never mistaken for a lost one.
 */
export async function failInterruptedBroadcasts(
  db: SupabaseClient,
  bootedAt: Date
): Promise<void> {
  try {
    const { data, error } = await db
      .from('broadcasts')
      .select('id, account_id')
      .eq('status', 'sending')
      .lt('updated_at', bootedAt.toISOString());
    if (error) {
      log.warn('could not look for interrupted broadcasts', { error: error.message });
      return;
    }

    for (const row of data ?? []) {
      try {
        await stopBroadcast(db, row.account_id as string, row.id as string, INTERRUPTED_REASON);
        log.warn('broadcast was interrupted by a restart; unsent recipients marked failed', {
          broadcast: row.id,
        });
      } catch (error) {
        log.warn('could not end an interrupted broadcast', {
          broadcast: row.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } catch (error) {
    log.warn('could not look for interrupted broadcasts', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
