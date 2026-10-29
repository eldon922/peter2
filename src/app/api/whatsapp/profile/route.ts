import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { decrypt } from '@/lib/whatsapp/encryption';
import { META_API_BASE, verifyPhoneNumber } from '@/lib/whatsapp/meta-api';

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('viewer');
    const { data: config } = await supabase.from('whatsapp_config').select('phone_number_id, access_token').eq('account_id', accountId).maybeSingle();
    if (!config) return NextResponse.json({ name: null, avatarUrl: null });
    const accessToken = decrypt(config.access_token);
    const [phone, response] = await Promise.all([
      verifyPhoneNumber({ phoneNumberId: config.phone_number_id, accessToken }),
      fetch(`${META_API_BASE}/${config.phone_number_id}/whatsapp_business_profile?fields=profile_picture_url`, {
        headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store', signal: AbortSignal.timeout(10_000),
      }).catch(() => null),
    ]);
    const profile = response?.ok ? await response.json() : null;
    return NextResponse.json({ name: phone.verified_name || phone.display_phone_number || null, avatarUrl: profile?.data?.[0]?.profile_picture_url ?? null });
  } catch (error) { return toErrorResponse(error); }
}
