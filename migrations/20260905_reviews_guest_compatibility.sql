-- NARI - final review constraints for registered and guest purchases
-- No data is deleted or rewritten. The migration stops on incompatible data.
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'reviews'
      AND column_name = 'userid'
  ) THEN
    RAISE EXCEPTION 'reviews.userid is missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.reviews r
    LEFT JOIN public.auth_users u ON u.id = r.userid
    WHERE r.userid IS NOT NULL
      AND u.id IS NULL
  ) THEN
    RAISE EXCEPTION 'reviews contains orphan userid values; migration stopped';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.reviews
    GROUP BY orderid, productid
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'reviews contains duplicate orderid/productid pairs; migration stopped';
  END IF;
END $$;

ALTER TABLE reviews
  ALTER COLUMN userid DROP NOT NULL;

DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_attribute att
      ON att.attrelid = con.conrelid
     AND att.attnum = ANY(con.conkey)
    WHERE con.conrelid = 'public.reviews'::regclass
      AND con.contype = 'f'
      AND att.attname = 'userid'
      AND pg_get_constraintdef(con.oid) NOT ILIKE '%ON DELETE SET NULL%'
  LOOP
    EXECUTE format('ALTER TABLE public.reviews DROP CONSTRAINT %I', constraint_name);
  END LOOP;

  FOR constraint_name IN
    SELECT idx.relname
    FROM pg_index ind
    JOIN pg_class idx ON idx.oid = ind.indexrelid
    WHERE ind.indrelid = 'public.reviews'::regclass
      AND ind.indisunique
      AND NOT ind.indisprimary
      AND ind.indkey = ARRAY[
        (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.reviews'::regclass AND attname = 'orderid'),
        (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.reviews'::regclass AND attname = 'userid'),
        (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.reviews'::regclass AND attname = 'productid')
      ]::int2vector
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint con WHERE con.conindid = ind.indexrelid
      )
  LOOP
    EXECUTE format('DROP INDEX public.%I', constraint_name);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint con
    WHERE con.conrelid = 'public.reviews'::regclass
      AND con.conname = 'reviews_userid_fkey'
      AND con.contype = 'f'
      AND pg_get_constraintdef(con.oid) ILIKE '%FOREIGN KEY (userid)%'
      AND pg_get_constraintdef(con.oid) ILIKE '%REFERENCES auth_users(id)%'
      AND pg_get_constraintdef(con.oid) ILIKE '%ON DELETE SET NULL%'
  ) THEN
    ALTER TABLE public.reviews
      ADD CONSTRAINT reviews_userid_fkey
      FOREIGN KEY (userid) REFERENCES public.auth_users(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'public.reviews'::regclass
      AND con.contype = 'u'
      AND con.conkey = ARRAY[
        (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.reviews'::regclass AND attname = 'orderid'),
        (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.reviews'::regclass AND attname = 'userid'),
        (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.reviews'::regclass AND attname = 'productid')
      ]::smallint[]
  LOOP
    EXECUTE format('ALTER TABLE public.reviews DROP CONSTRAINT %I', constraint_name);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint con
    WHERE con.conrelid = 'public.reviews'::regclass
      AND con.conname = 'reviews_orderid_productid_key'
      AND con.contype = 'u'
  ) THEN
    ALTER TABLE public.reviews
      ADD CONSTRAINT reviews_orderid_productid_key UNIQUE (orderid, productid);
  END IF;
END $$;

COMMIT;
