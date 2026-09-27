-- NARI R12E — Wompi webhook support.
-- Extends existing private tables only; no new table or sequence is created.
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT provider, providerreference
    FROM public.payments
    WHERE providerreference IS NOT NULL
    GROUP BY provider, providerreference
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot create provider reference index: duplicate non-null provider references exist';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_reference_unique
  ON public.payments (provider, providerreference)
  WHERE providerreference IS NOT NULL;

ALTER TABLE public.email_outbox DROP CONSTRAINT IF EXISTS email_outbox_eventtype_check;
ALTER TABLE public.email_outbox
  ADD CONSTRAINT email_outbox_eventtype_check
  CHECK (eventtype IN ('order_received', 'order_shipped', 'order_delivered', 'payment_approved'));

COMMIT;
