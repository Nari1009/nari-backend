-- NARI - deferred review request persistence
-- Creates schema only. No historical requests are backfilled.
BEGIN;

CREATE TABLE IF NOT EXISTS public.order_review_requests (
  id TEXT PRIMARY KEY,
  orderid TEXT NOT NULL UNIQUE
    REFERENCES public.orders(id) ON DELETE CASCADE,
  userid TEXT NULL
    REFERENCES public.auth_users(id) ON DELETE SET NULL,
  tokenhash TEXT NULL UNIQUE,
  tokenciphertext TEXT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'sent', 'completed', 'blocked')),
  eligibleat TIMESTAMPTZ NOT NULL,
  sentat TIMESTAMPTZ NULL,
  processingat TIMESTAMPTZ NULL,
  expiresat TIMESTAMPTZ NOT NULL,
  completedat TIMESTAMPTZ NULL,
  attemptcount INTEGER NOT NULL DEFAULT 0 CHECK (attemptcount >= 0),
  lasterror TEXT NULL,
  createdat TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
DECLARE
  expected record;
  actual_type text;
  actual_nullable text;
BEGIN
  FOR expected IN
    SELECT * FROM (VALUES
      ('id', 'text', 'NO'),
      ('orderid', 'text', 'NO'),
      ('userid', 'text', 'YES'),
      ('tokenhash', 'text', 'YES'),
      ('tokenciphertext', 'text', 'YES'),
      ('status', 'text', 'NO'),
      ('eligibleat', 'timestamp with time zone', 'NO'),
      ('sentat', 'timestamp with time zone', 'YES'),
      ('processingat', 'timestamp with time zone', 'YES'),
      ('expiresat', 'timestamp with time zone', 'NO'),
      ('completedat', 'timestamp with time zone', 'YES'),
      ('attemptcount', 'integer', 'NO'),
      ('lasterror', 'text', 'YES'),
      ('createdat', 'timestamp with time zone', 'NO')
    ) AS expected(column_name, data_type, is_nullable)
  LOOP
    SELECT c.data_type, c.is_nullable
      INTO actual_type, actual_nullable
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'order_review_requests'
      AND c.column_name = expected.column_name;

    IF actual_type IS DISTINCT FROM expected.data_type
       OR actual_nullable IS DISTINCT FROM expected.is_nullable THEN
      RAISE EXCEPTION 'order_review_requests.% has an incompatible definition', expected.column_name;
    END IF;
  END LOOP;

  IF (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='order_review_requests') <> 14 THEN
    RAISE EXCEPTION 'order_review_requests has unexpected columns';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.order_review_requests'::regclass AND contype='p')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.order_review_requests'::regclass AND contype='u' AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid='public.order_review_requests'::regclass AND attname='orderid')]::smallint[])
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.order_review_requests'::regclass AND contype='u' AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid='public.order_review_requests'::regclass AND attname='tokenhash')]::smallint[])
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.order_review_requests'::regclass AND contype='f' AND pg_get_constraintdef(oid) ILIKE '%orderid%REFERENCES orders(id)%ON DELETE CASCADE%')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.order_review_requests'::regclass AND contype='f' AND pg_get_constraintdef(oid) ILIKE '%userid%REFERENCES auth_users(id)%ON DELETE SET NULL%')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.order_review_requests'::regclass AND conname='order_review_requests_status_check')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.order_review_requests'::regclass AND conname='order_review_requests_attemptcount_check') THEN
    RAISE EXCEPTION 'order_review_requests has incompatible constraints';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS order_review_requests_due_idx
  ON public.order_review_requests (status, eligibleat);

ALTER TABLE public.order_review_requests ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'order_review_requests'
  ) THEN
    RAISE EXCEPTION 'order_review_requests has public policies; review manually before continuing';
  END IF;
END $$;

COMMIT;
