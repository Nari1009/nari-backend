-- R6 PROD: nullable public order numbers for commercial orders.
-- Apply manually only after reviewing the PROD order inventory.
-- Existing demo/test orders intentionally remain NULL.
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

DO $$
DECLARE
  persisted_max BIGINT;
  sequence_last BIGINT;
  sequence_called BOOLEAN;
  next_sequence_value BIGINT;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.orders
    WHERE ordernumber IS NOT NULL
      AND ordernumber !~ '^NAR-[0-9]+$'
  ) THEN
    RAISE EXCEPTION 'R6 ordernumber verification failed: invalid existing value';
  END IF;

  SELECT COALESCE(MAX(SUBSTRING(ordernumber FROM 5)::BIGINT), 0)
  INTO persisted_max
  FROM public.orders
  WHERE ordernumber IS NOT NULL;

  SELECT last_value, is_called
  INTO sequence_last, sequence_called
  FROM public.order_public_number_seq;

  next_sequence_value := CASE
    WHEN sequence_called THEN sequence_last + 1
    ELSE sequence_last
  END;

  IF next_sequence_value <= persisted_max THEN
    PERFORM setval('public.order_public_number_seq', persisted_max, true);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'orders_ordernumber_key'
      AND conrelid = 'public.orders'::regclass
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_ordernumber_key UNIQUE (ordernumber);
  END IF;
END $$;

-- Deliberately remain nullable: known PROD demo orders are not commercial orders.
ALTER TABLE public.orders
  ALTER COLUMN ordernumber DROP NOT NULL;

COMMIT;
