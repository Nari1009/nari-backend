CREATE TABLE email_outbox (
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

CREATE INDEX email_outbox_due_idx ON email_outbox (status, eligibleat);

ALTER TABLE email_outbox ENABLE ROW LEVEL SECURITY;
