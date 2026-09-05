-- NARI - deliveredAt schema
-- Additive only. Does not backfill historical orders.
BEGIN;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS deliveredat TIMESTAMPTZ NULL;

DO $$
DECLARE
  column_type text;
  nullable text;
BEGIN
  SELECT data_type, is_nullable
    INTO column_type, nullable
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'orders'
    AND column_name = 'deliveredat';

  IF column_type IS DISTINCT FROM 'timestamp with time zone'
     OR nullable IS DISTINCT FROM 'YES' THEN
    RAISE EXCEPTION 'orders.deliveredat has an incompatible definition';
  END IF;
END $$;

COMMIT;
