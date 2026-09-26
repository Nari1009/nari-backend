-- R12 atomic checkout foundation: one logical checkout submission per key.
-- Historical orders remain valid with NULL checkoutidempotencykey.
BEGIN;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS checkoutidempotencykey TEXT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT checkoutidempotencykey
    FROM public.orders
    WHERE checkoutidempotencykey IS NOT NULL
    GROUP BY checkoutidempotencykey
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot create checkout idempotency index: duplicate non-null checkout keys exist';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS orders_checkout_idempotency_unique
  ON public.orders (checkoutidempotencykey)
  WHERE checkoutidempotencykey IS NOT NULL;

COMMIT;
