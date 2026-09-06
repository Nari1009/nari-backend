-- NARI - bounded abandoned-cart reminder campaigns
-- Adds persistent stage/lease/idempotency state. No new email is sent by this migration.
BEGIN;

ALTER TABLE abandoned_carts
  ADD COLUMN IF NOT EXISTS normalizedemail TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS processingstage TEXT,
  ADD COLUMN IF NOT EXISTS processingat TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS nextattemptat TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS firstreminderattemptcount INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS secondreminderattemptcount INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lasterror TEXT,
  ADD COLUMN IF NOT EXISTS recoveredat TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completedat TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelledat TIMESTAMPTZ;

UPDATE abandoned_carts
SET normalizedemail = lower(trim(email))
WHERE normalizedemail IS NULL OR normalizedemail = '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.abandoned_carts'::regclass
      AND conname = 'abandoned_carts_status_check'
  ) THEN
    ALTER TABLE abandoned_carts ADD CONSTRAINT abandoned_carts_status_check
      CHECK (status IN ('active', 'recovered', 'completed', 'cancelled', 'blocked'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS abandoned_carts_campaign_idx
  ON abandoned_carts (normalizedemail, status, lastactivityat);

CREATE TABLE IF NOT EXISTS abandoned_cart_migration_runs (
  id TEXT PRIMARY KEY,
  appliedat TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE abandoned_cart_migration_runs ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  containment_cutoff TIMESTAMPTZ;
BEGIN
  INSERT INTO abandoned_cart_migration_runs (id)
  VALUES ('bounded-reminders-v1')
  ON CONFLICT (id) DO NOTHING
  RETURNING appliedat INTO containment_cutoff;

  IF containment_cutoff IS NOT NULL THEN
    UPDATE abandoned_carts
    SET status = CASE
          WHEN convertedat IS NOT NULL OR trim(CAST(convertedat AS TEXT)) <> '' THEN 'completed'
          ELSE 'cancelled'
        END,
        cancelledat = CASE
          WHEN convertedat IS NOT NULL OR trim(CAST(convertedat AS TEXT)) <> '' THEN cancelledat
          ELSE CURRENT_TIMESTAMP
        END,
        processingstage = NULL,
        processingat = NULL,
        nextattemptat = NULL,
        updatedat = CURRENT_TIMESTAMP
    WHERE createdat < containment_cutoff
      AND COALESCE(status, 'active') = 'active';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'abandoned_cart_migration_runs') THEN
    RAISE EXCEPTION 'abandoned_cart_migration_runs has public policies; review manually before continuing';
  END IF;
END $$;

COMMIT;
