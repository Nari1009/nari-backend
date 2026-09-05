CREATE TABLE IF NOT EXISTS email_outbox (
  id TEXT PRIMARY KEY,
  eventtype TEXT NOT NULL CHECK (eventtype IN ('order_received', 'order_shipped', 'order_delivered')),
  orderid TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  recipientemail TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'blocked')),
  attemptcount INTEGER NOT NULL DEFAULT 0 CHECK (attemptcount >= 0),
  eligibleat TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processingat TIMESTAMPTZ NULL,
  sentat TIMESTAMPTZ NULL,
  lasterror TEXT NULL,
  providermessageid TEXT NULL,
  idempotencykey TEXT NOT NULL UNIQUE,
  createdat TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedat TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS email_outbox_due_idx ON email_outbox (status, eligibleat);

ALTER TABLE email_outbox ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='email_outbox') <> 15
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.email_outbox'::regclass AND conname='email_outbox_pkey')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.email_outbox'::regclass AND conname='email_outbox_idempotencykey_key')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.email_outbox'::regclass AND conname='email_outbox_orderid_fkey')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.email_outbox'::regclass AND conname='email_outbox_eventtype_check')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.email_outbox'::regclass AND conname='email_outbox_status_check')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.email_outbox'::regclass AND conname='email_outbox_attemptcount_check') THEN
    RAISE EXCEPTION 'email_outbox has an incompatible schema';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='email_outbox') THEN
    RAISE EXCEPTION 'email_outbox has public policies; review manually before continuing';
  END IF;
END $$;
