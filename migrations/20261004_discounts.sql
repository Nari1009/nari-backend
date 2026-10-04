ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS discountpercent INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_discountpercent_check') THEN
    ALTER TABLE public.products ADD CONSTRAINT products_discountpercent_check
      CHECK (discountpercent >= 0 AND discountpercent <= 99);
  END IF;
END $$;

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS baseunitprice NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS discountpercent INTEGER,
  ADD COLUMN IF NOT EXISTS discountamount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS discountsource TEXT,
  ADD COLUMN IF NOT EXISTS effectiveunitprice NUMERIC(12,2);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_items_discountpercent_check') THEN
    ALTER TABLE public.order_items ADD CONSTRAINT order_items_discountpercent_check
      CHECK (discountpercent IS NULL OR (discountpercent >= 0 AND discountpercent <= 99));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_items_discountsource_check') THEN
    ALTER TABLE public.order_items ADD CONSTRAINT order_items_discountsource_check
      CHECK (discountsource IS NULL OR discountsource IN ('PRODUCT', 'GLOBAL', 'NONE'));
  END IF;
END $$;
