-- NARI R12C — stock reservation domain foundation
-- Backend-only reservation tables. No checkout integration or payment effects.
BEGIN;

CREATE TABLE IF NOT EXISTS public.stock_reservations (
  id TEXT PRIMARY KEY,
  orderid TEXT NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'COMMITTED', 'RELEASED', 'EXPIRED')),
  idempotencykey TEXT NOT NULL,
  expiresat TIMESTAMPTZ NOT NULL,
  createdat TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedat TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  committedat TIMESTAMPTZ NULL,
  releasedat TIMESTAMPTZ NULL,
  CONSTRAINT stock_reservations_order_unique UNIQUE (orderid),
  CONSTRAINT stock_reservations_idempotency_unique UNIQUE (idempotencykey)
);

CREATE INDEX IF NOT EXISTS stock_reservations_expiration_idx
  ON public.stock_reservations (status, expiresat);

CREATE TABLE IF NOT EXISTS public.stock_reservation_items (
  id TEXT PRIMARY KEY,
  reservationid TEXT NOT NULL REFERENCES public.stock_reservations(id) ON DELETE RESTRICT,
  productid TEXT NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  createdat TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT stock_reservation_items_product_unique UNIQUE (reservationid, productid)
);

CREATE INDEX IF NOT EXISTS stock_reservation_items_product_idx
  ON public.stock_reservation_items (productid);

-- Existing historical movements use NULL references. This partial unique index
-- makes deterministic reservation/sale references exactly-once without changing
-- historical rows or requiring every legacy movement to have a reference.
DO $$
BEGIN
  IF EXISTS (
    SELECT reference
    FROM public.inventory_movements
    WHERE reference IS NOT NULL
    GROUP BY reference
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot create unique inventory movement reference index: duplicate non-null references exist';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS inventory_movements_reference_unique
  ON public.inventory_movements (reference)
  WHERE reference IS NOT NULL;

-- These are private Backend-owned tables. Do not rely on managed default
-- privileges: harden each table in the same transaction that creates it.
ALTER TABLE public.stock_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_reservation_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.stock_reservations FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.stock_reservation_items FROM anon, authenticated;

COMMIT;
