-- NARI R14.5: editable logistics preparation, separate from commercial order data.
-- Additive only. Do not create guides, alter orders, or backfill historical data.
BEGIN;

CREATE TABLE IF NOT EXISTS public.order_logistics_preparations (
  id TEXT PRIMARY KEY,
  orderid TEXT NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'READY_FOR_GUIDE', 'GUIDE_CREATION_DISABLED')),
  recipientname TEXT NULL, recipientphone TEXT NULL, addressline1 TEXT NULL, addressline2 TEXT NULL,
  department TEXT NULL, municipality TEXT NULL, danecode TEXT NULL, providercode TEXT NULL, deliveryobservations TEXT NULL,
  packageprofileid TEXT NULL, weightkg NUMERIC NULL CHECK (weightkg IS NULL OR weightkg > 0),
  lengthcm NUMERIC NULL CHECK (lengthcm IS NULL OR lengthcm > 0), widthcm NUMERIC NULL CHECK (widthcm IS NULL OR widthcm > 0), heightcm NUMERIC NULL CHECK (heightcm IS NULL OR heightcm > 0),
  units INTEGER NULL CHECK (units IS NULL OR units > 0), declaredvalue NUMERIC NULL CHECK (declaredvalue IS NULL OR declaredvalue >= 0),
  shippingamountpaidbycustomer NUMERIC NULL, actualcarriershippingcost NUMERIC NULL CHECK (actualcarriershippingcost IS NULL OR actualcarriershippingcost >= 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0), createdat TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, updatedat TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  createdby TEXT NULL, updatedby TEXT NULL
);
CREATE INDEX IF NOT EXISTS order_logistics_preparations_status_idx ON public.order_logistics_preparations (status, updatedat);

CREATE TABLE IF NOT EXISTS public.order_logistics_preparation_history (
  id TEXT PRIMARY KEY, preparationid TEXT NOT NULL REFERENCES public.order_logistics_preparations(id) ON DELETE CASCADE,
  orderid TEXT NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE, fieldname TEXT NOT NULL, previousvalue TEXT NULL, newvalue TEXT NULL,
  changedat TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, changedby TEXT NULL
);
CREATE INDEX IF NOT EXISTS order_logistics_preparation_history_order_idx ON public.order_logistics_preparation_history (orderid, changedat, id);

ALTER TABLE public.order_logistics_preparations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_logistics_preparation_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.order_logistics_preparations FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.order_logistics_preparation_history FROM anon, authenticated;
COMMIT;
