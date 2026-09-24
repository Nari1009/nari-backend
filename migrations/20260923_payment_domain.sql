-- NARI R12B — payment domain foundation
-- Schema only. No provider calls, webhook processing, stock effects or backfill.
BEGIN;

CREATE TABLE IF NOT EXISTS public.payments (
  id TEXT PRIMARY KEY,
  orderid TEXT NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL CHECK (provider <> ''),
  status TEXT NOT NULL DEFAULT 'CREATED'
    CHECK (status IN ('CREATED', 'PENDING', 'APPROVED', 'DECLINED', 'VOIDED', 'ERROR', 'REFUNDED')),
  -- COP minor units (centavos), matching the future provider amount_in_cents contract.
  amount BIGINT NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'COP' CHECK (currency = 'COP'),
  idempotencykey TEXT NOT NULL,
  providertransactionid TEXT NULL,
  providerreference TEXT NULL,
  paymentmethodtype TEXT NULL,
  providerstatus TEXT NULL,
  failurecode TEXT NULL,
  failuremessage TEXT NULL,
  approvedat TIMESTAMPTZ NULL,
  failedat TIMESTAMPTZ NULL,
  expiresat TIMESTAMPTZ NULL,
  createdat TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedat TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT payments_provider_idempotency_key UNIQUE (provider, idempotencykey)
);

CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_transaction_unique
  ON public.payments (provider, providertransactionid)
  WHERE providertransactionid IS NOT NULL;
CREATE INDEX IF NOT EXISTS payments_orderid_createdat_idx
  ON public.payments (orderid, createdat);

CREATE TABLE IF NOT EXISTS public.payment_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider <> ''),
  providereventid TEXT NULL,
  providertransactionid TEXT NULL,
  paymentid TEXT NULL REFERENCES public.payments(id) ON DELETE SET NULL,
  eventtype TEXT NOT NULL,
  status TEXT NOT NULL,
  payloadhash TEXT NULL,
  receivedat TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processedat TIMESTAMPTZ NULL,
  processingstatus TEXT NOT NULL DEFAULT 'RECEIVED'
    CHECK (processingstatus IN ('RECEIVED', 'PROCESSING', 'PROCESSED', 'IGNORED', 'FAILED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_events_provider_event_unique
  ON public.payment_events (provider, providereventid)
  WHERE providereventid IS NOT NULL;
CREATE INDEX IF NOT EXISTS payment_events_transaction_idx
  ON public.payment_events (provider, providertransactionid);
CREATE INDEX IF NOT EXISTS payment_events_payment_idx
  ON public.payment_events (paymentid);

-- These are private Backend-owned tables. Do not rely on Supabase default
-- privileges: every migration that creates a private public-schema table
-- must close Data API access in the same transaction.
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.payments FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.payment_events FROM anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('payments', 'payment_events')) THEN
    RAISE EXCEPTION 'Payment tables must not expose public RLS policies';
  END IF;
END $$;

COMMIT;
