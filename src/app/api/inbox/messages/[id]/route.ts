import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId } = await requireRole('agent');
    const { id } = await params;
    const { data: message } = await supabase.from('messages').select('id, conversation_id').eq('id', id).maybeSingle();
    if (!message) return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    const { data: chat } = await supabase.from('conversations').select('id').eq('id', message.conversation_id).eq('account_id', accountId).maybeSingle();
    if (!chat) return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    const { data, error } = await supabase.from('messages').delete().eq('id', id).eq('conversation_id', chat.id).select('id');
    if (error) throw error;
    if (!data?.length) return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    return new Response(null, { status: 204 });
  } catch (error) { return toErrorResponse(error); }
}
