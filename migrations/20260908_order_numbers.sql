-- R6 DEV: persistent public order numbers.
-- Apply manually only after reviewing the DEV data and the generated backfill.
-- Existing orders receive numbers in createdAt ASC, id ASC order.
BEGIN;

CREATE SEQUENCE IF NOT EXISTS public.order_public_number_seq
  AS BIGINT
  START WITH 1
  INCREMENT BY 1
  NO MINVALUE
  NO MAXVALUE
  CACHE 1;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS ordernumber TEXT NULL;

WITH numbered AS (
  SELECT id,
         'NAR-' || LPAD((COALESCE((SELECT MAX(SUBSTRING(existing.ordernumber FROM 5)::BIGINT) FROM public.orders AS existing), 0) + ROW_NUMBER() OVER (ORDER BY createdat ASC, id ASC))::TEXT, 6, '0') AS public_number
  FROM public.orders
  WHERE ordernumber IS NULL
)
UPDATE public.orders AS orders
SET ordernumber = numbered.public_number
FROM numbered
WHERE orders.id = numbered.id
  AND orders.ordernumber IS NULL;

SELECT setval(
  'public.order_public_number_seq',
  COALESCE((SELECT MAX(SUBSTRING(ordernumber FROM 5)::BIGINT) FROM public.orders), 1),
  (SELECT COUNT(*) > 0 FROM public.orders)
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.orders WHERE ordernumber IS NULL)
    OR EXISTS (SELECT 1 FROM public.orders WHERE ordernumber !~ '^NAR-[0-9]+$')
    OR EXISTS (SELECT 1 FROM public.orders GROUP BY ordernumber HAVING COUNT(*) > 1) THEN
    RAISE EXCEPTION 'R6 ordernumber verification failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orders_ordernumber_key'
      AND conrelid = 'public.orders'::regclass
  ) THEN
    ALTER TABLE public.orders ADD CONSTRAINT orders_ordernumber_key UNIQUE (ordernumber);
  END IF;
END $$;

ALTER TABLE public.orders
  ALTER COLUMN ordernumber SET NOT NULL;

COMMIT;
