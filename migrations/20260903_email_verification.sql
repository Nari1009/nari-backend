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

-- The legacy compatibility backfill is one-shot. The marker prevents a
-- later re-run from auto-verifying users created after this migration.
CREATE TABLE IF NOT EXISTS email_verification_backfill_runs (
  id TEXT PRIMARY KEY CHECK (id = 'legacy-v1'),
  appliedat TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE email_verification_backfill_runs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM email_verification_backfill_runs WHERE id = 'legacy-v1'
  ) THEN
    -- Existing active accounts with a valid Customer relationship remain
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

    INSERT INTO email_verification_backfill_runs (id)
    VALUES ('legacy-v1');
  END IF;
END $$;

COMMIT;
