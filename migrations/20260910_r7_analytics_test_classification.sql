-- R7A: explicit test/demo classification for analytics.
-- Apply manually in DEV after reviewing existing rows. No rows are classified here.
BEGIN;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS istest BOOLEAN NOT NULL DEFAULT FALSE;

COMMIT;
