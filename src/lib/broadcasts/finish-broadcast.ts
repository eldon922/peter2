import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The last wizard step failed after the broadcast was saved. A lost reply
 * looks like a failure, so it may already have started or been scheduled:
 * the wizard must not let it be created a second time.
 */
export class BroadcastSavedError extends Error {
  constructor(
    message: string,
    readonly broadcastId: string
  ) {
    super(message);
    this.name = 'BroadcastSavedError';
  }
}

/**
 * The wizard's last step for a broadcast whose recipients are all saved:
 * set its total (which makes it startable) and then schedule it, or start it.
 */
export async function finishBroadcast(
  supabase: SupabaseClient,
  broadcastId: string,
  total: number,
  scheduledAt?: string,
  fetchFn: typeof fetch = fetch
): Promise<void> {
  const { data, error } = await supabase
    .from('broadcasts')
    .update(
      scheduledAt
        ? { total_recipients: total, status: 'scheduled', scheduled_at: scheduledAt }
        : { total_recipients: total }
    )
    .eq('id', broadcastId)
    .eq('status', 'draft')
    .select('id');
  if (error) {
    const message = `Failed to finish saving the broadcast: ${error.message}`;
    // Scheduling is this same write, so its outcome is unknown; setting the
    // total on its own starts nothing.
    throw scheduledAt ? new BroadcastSavedError(message, broadcastId) : new Error(message);
  }
  if (!data?.length) {
    throw new Error('This broadcast was removed or changed while it was being saved.');
  }
  if (scheduledAt) return;

  try {
    const res = await fetchFn(`/api/broadcasts/${broadcastId}/start`, { method: 'POST' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new BroadcastSavedError(body.error || 'Failed to start sending', broadcastId);
    }
  } catch (e) {
    if (e instanceof BroadcastSavedError) throw e;
    throw new BroadcastSavedError(
      'Lost the connection while starting the broadcast. It may have started.',
      broadcastId
    );
  }
}
