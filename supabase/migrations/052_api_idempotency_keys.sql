-- ============================================================
-- 052_api_idempotency_keys.sql — duplicate protection for the public API
--
-- A caller whose POST /api/v1/broadcasts timed out can't tell whether the
-- broadcast was created, and most HTTP clients retry on their own. Without
-- protection the retry creates a second broadcast and everyone is messaged
-- twice. The caller can now send an `Idempotency-Key` header: the first
-- request with a key is processed and its response is stored here, and a
-- retry with the same key and body gets that stored response back instead
-- of creating anything.
--
--   key           chosen by the caller, unique per account
--   request_hash  SHA-256 of the request body, so the same key with a
--                 different body is refused instead of replayed
--   response_*    NULL while the first request is still running
--
-- Rows older than 24 hours are removed by the API itself.
--
-- RLS is on with no policies: only the service role (the public API,
-- which has no user session) reads or writes this table.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS api_idempotency_keys (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  key             text NOT NULL,
  request_hash    text NOT NULL,
  response_status integer,
  response_body   jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, key)
);

-- The 24-hour clean-up filters on age.
CREATE INDEX IF NOT EXISTS api_idempotency_keys_created_at_idx
  ON api_idempotency_keys (created_at);

ALTER TABLE api_idempotency_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON api_idempotency_keys FROM anon, authenticated;
