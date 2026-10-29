import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';

export async function GET() {
  try {
    await requireRole('viewer');
    return NextResponse.json({ defaultCountryCode: (process.env.DEFAULT_COUNTRY_CODE ?? '62').replace(/\D/g, '') });
  } catch (error) { return toErrorResponse(error); }
}
