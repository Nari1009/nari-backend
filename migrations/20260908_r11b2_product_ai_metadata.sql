-- NARI R11B2: additive product metadata foundation.
-- No existing product rows are backfilled or normalized.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS routineStep TEXT NULL,
  ADD COLUMN IF NOT EXISTS sizeLabel TEXT NULL;
