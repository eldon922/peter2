import type { SupabaseClient } from '@supabase/supabase-js';

export async function recordBroadcastReply(
  db: Pick<SupabaseClient, 'from'>,
  accountId: string,
  contactId: string,
  receivedAt: string,
  messageId?: string
) {
  let query = db
    .from('broadcast_recipients')
    .select('id, status, replied_at, broadcasts!inner(account_id)')
    .eq('contact_id', contactId)
    .eq('broadcasts.account_id', accountId)
    .in('status', ['sent', 'delivered', 'read', 'replied']);
  if (messageId) query = query.eq('whatsapp_message_id', messageId);
  else query = query.lte('sent_at', receivedAt);
  const { data, error } = await query
    .order('sent_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  const row = data?.[0];
  if (!row || row.status === 'replied') return;
  const result = await db
    .from('broadcast_recipients')
    .update({ status: 'replied', replied_at: row.replied_at ?? receivedAt })
    .eq('id', row.id)
    .in('status', ['sent', 'delivered', 'read']);
  if (result.error) throw result.error;
}
