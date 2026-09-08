-- NARI R11D: explicit Product catalog/fixture boundary.
-- Nullable is intentional: unclassified Products must fail closed.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS catalogRole TEXT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'products_catalog_role_check'
      AND conrelid = 'public.products'::regclass
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_catalog_role_check
      CHECK (catalogrole IS NULL OR catalogrole IN ('CATALOG', 'DEV_FIXTURE'));
  END IF;
END $$;
