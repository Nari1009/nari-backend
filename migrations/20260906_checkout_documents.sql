-- R4 DEV: checkout document fields.
-- Physical PostgreSQL identifiers follow the existing lowercase convention.
-- Existing rows remain NULL; no backfill, uniqueness, indexes, or RLS changes.
BEGIN;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS documenttype TEXT NULL,
  ADD COLUMN IF NOT EXISTS documentnumber TEXT NULL;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS documenttypesnapshot TEXT NULL,
  ADD COLUMN IF NOT EXISTS documentnumbersnapshot TEXT NULL;

COMMIT;
