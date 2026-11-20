import { supabaseAdmin } from '@/lib/flows/admin-client';

export async function GET(
  _: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(token))
    return new Response(null, { status: 404 });
  const { data, error } = await supabaseAdmin().rpc('follow_broadcast_button', {
    p_token: token,
  });
  if (error) return new Response(null, { status: 503 });
  if (!data) return new Response(null, { status: 404 });
  return new Response(null, {
    status: 302,
    headers: {
      Location: data,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

export function HEAD() {
  return new Response(null, {
    status: 204,
    headers: { 'Cache-Control': 'no-store' },
  });
}
