import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, accountId } = await requireRole('agent');
    const { id } = await params;
    const { data, error } = await supabase
      .from('conversations')
      .delete()
      .eq('id', id)
      .eq('account_id', accountId)
      .select('id');
    if (error) throw error;
    if (!data?.length)
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
    return new Response(null, { status: 204 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
