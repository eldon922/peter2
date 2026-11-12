import { supabaseAdmin } from '@/lib/flows/admin-client';
import { DEFAULT_COUNTRY_CODE } from '@/lib/whatsapp/phone-utils';
import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

export async function GET() {
  try {
    const { accountId } = await requireRole('viewer');
    const { error } = await supabaseAdmin().from('accounts')
      .update({ default_country_code: DEFAULT_COUNTRY_CODE })
      .eq('id', accountId).neq('default_country_code', DEFAULT_COUNTRY_CODE);
    if (error) throw error;
    return NextResponse.json({
      defaultCountryCode: DEFAULT_COUNTRY_CODE,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
