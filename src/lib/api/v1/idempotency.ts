// ============================================================
// Idempotency keys for the public API.
//
// A caller sends `Idempotency-Key: <unique string>` with a request that
// creates something. The first request with that key runs and its
// response is stored; a retry with the same key and body gets the stored
// response back instead of creating a second one (see migration 052).
// ============================================================

import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

import { badRequest } from '@/lib/api/v1/respond';

const TABLE = 'api_idempotency_keys';
const KEY_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_KEY_LENGTH = 255;
const UNIQUE_VIOLATION = '23505';

/** The request's key, or null when it sent none. Throws a 400 for a bad one. */
export function readIdempotencyKey(request: Request): string | null {
  const raw = request.headers.get('idempotency-key');
  if (raw === null) return null;
  const key = raw.trim();
  if (key.length === 0 || key.length > MAX_KEY_LENGTH || !/^[\x21-\x7e]+$/.test(key)) {
    throw badRequest(
      `Idempotency-Key must be 1–${MAX_KEY_LENGTH} visible characters with no spaces.`
    );
  }
  return key;
}

export function hashRequestBody(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

export type IdempotencyClaim =
  | { kind: 'new' }
  | { kind: 'replay'; status: number; body: unknown }
  /** Same key, different request body. */
  | { kind: 'mismatch' }
  /** Same key, and the first request is still running. */
  | { kind: 'busy' };

/** Reserves `key` for this request, or says what an earlier request with it left behind. */
export async function claimIdempotencyKey(
  db: SupabaseClient,
  accountId: string,
  key: string,
  requestHash: string
): Promise<IdempotencyClaim> {
  await db
    .from(TABLE)
    .delete()
    .eq('account_id', accountId)
    .lt('created_at', new Date(Date.now() - KEY_TTL_MS).toISOString());

  const { error } = await db
    .from(TABLE)
    .insert({ account_id: accountId, key, request_hash: requestHash });
  if (!error) return { kind: 'new' };
  if (error.code !== UNIQUE_VIOLATION) throw new Error(error.message);

  const { data, error: readError } = await db
    .from(TABLE)
    .select('request_hash, response_status, response_body')
    .eq('account_id', accountId)
    .eq('key', key)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  // Gone again already (just cleaned up or released): the caller can retry.
  if (!data) return { kind: 'busy' };
  if (data.request_hash !== requestHash) return { kind: 'mismatch' };
  if (data.response_status === null) return { kind: 'busy' };
  return { kind: 'replay', status: data.response_status, body: data.response_body };
}

/** Stores the response a retry with this key will get back. */
export async function saveIdempotentResponse(
  db: SupabaseClient,
  accountId: string,
  key: string,
  status: number,
  body: unknown
): Promise<void> {
  const { error } = await db
    .from(TABLE)
    .update({ response_status: status, response_body: body })
    .eq('account_id', accountId)
    .eq('key', key);
  if (error) throw new Error(error.message);
}

/** Frees `key` after a request that failed, so the caller can try again. */
export async function releaseIdempotencyKey(
  db: SupabaseClient,
  accountId: string,
  key: string
): Promise<void> {
  const { error } = await db
    .from(TABLE)
    .delete()
    .eq('account_id', accountId)
    .eq('key', key);
  if (error) throw new Error(error.message);
}
