// ============================================================
// POST /api/broadcasts/{id}/stop — stop a broadcast that is sending.
//
// Recipients not yet sent become 'failed' ("Stopped — retry to
// resume"), so the normal Retry button picks up where it left off.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { stopBroadcast, BroadcastError } from '@/lib/whatsapp/broadcast-core';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Stopping is part of running a broadcast: same 'agent' role as send.
    const { accountId } = await requireRole('agent');
    const { id } = await params;

    // Account ownership is checked inside stopBroadcast; the service-role
    // client is needed because the fan-out's own writes bypass RLS too.
    await stopBroadcast(supabaseAdmin(), accountId, id);
    return NextResponse.json({ stopped: true });
  } catch (error) {
    if (error instanceof BroadcastError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      );
    }
    console.error('Error in broadcast stop POST:', error);
    return toErrorResponse(error);
  }
}
