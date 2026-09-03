-- NARI DEV - email verification
-- Apply manually in the DEV database only. This migration is intentionally
-- not executed by application startup.
BEGIN;

ALTER TABLE auth_users
  ADD COLUMN IF NOT EXISTS emailverifiedat TIMESTAMPTZ NULL;

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id TEXT PRIMARY KEY,
  userid TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  tokenhash TEXT NOT NULL UNIQUE,
  expiresat TIMESTAMPTZ NOT NULL,
  createdat TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  usedat TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS email_verification_tokens_userid_idx
  ON email_verification_tokens(userid);

CREATE INDEX IF NOT EXISTS email_verification_tokens_expiresat_idx
  ON email_verification_tokens(expiresat);

ALTER TABLE email_verification_tokens ENABLE ROW LEVEL SECURITY;

-- Existing active accounts with their valid Customer relationship remain
-- usable. Orphan AuthUsers are intentionally not backfilled.
UPDATE auth_users au
SET emailverifiedat = COALESCE(au.createdat, CURRENT_TIMESTAMP)
WHERE au.emailverifiedat IS NULL
  AND au.isactive = 1
  AND EXISTS (
    SELECT 1
    FROM customers c
    WHERE c.authuserid = au.id
      AND lower(trim(c.email)) = lower(trim(au.email))
  );

COMMIT;
