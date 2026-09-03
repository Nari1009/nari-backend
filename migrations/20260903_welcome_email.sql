-- NARI - welcome email idempotency marker
-- Apply manually in the target environment before enabling the post-verification trigger.
-- This migration does not send email and does not backfill existing accounts.
BEGIN;

ALTER TABLE auth_users
  ADD COLUMN IF NOT EXISTS welcomeemailsentat TIMESTAMPTZ NULL;

COMMIT;
