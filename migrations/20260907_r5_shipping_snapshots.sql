-- R5 DEV: immutable shipping policy snapshots for new orders.
-- Existing orders remain NULL; no backfill, uniqueness, indexes, or RLS changes.
BEGIN;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS shippingzone TEXT NULL,
  ADD COLUMN IF NOT EXISTS deliverytype TEXT NULL,
  ADD COLUMN IF NOT EXISTS samedayeligible BOOLEAN NULL,
  ADD COLUMN IF NOT EXISTS shippingpolicyversion TEXT NULL;

COMMIT;
