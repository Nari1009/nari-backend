-- NARI DEV — customer identity migration
-- Preparada para revisión. NO ejecutar sin autorización explícita.
-- No crea Customers ni inventa identidad histórica.
-- Los snapshots se crean físicamente en lowercase, de acuerdo con el esquema actual.

/* UP — atómica, auditable y genérica */
BEGIN;

LOCK TABLE public.customers, public.orders, public.order_items
  IN SHARE ROW EXCLUSIVE MODE;

-- Abortar antes de cualquier escritura si la migración ya fue aplicada.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'customers_email_normalized_unique' AND c.relkind = 'i'
  ) THEN RAISE EXCEPTION 'Migración ya aplicada: existe el índice customers_email_normalized_unique'; END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orders_customerid_fkey' AND conrelid = 'public.orders'::regclass
  ) THEN RAISE EXCEPTION 'Migración ya aplicada: existe la constraint orders_customerid_fkey'; END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders'
      AND column_name IN ('customeremailsnapshot', 'customerfirstnamesnapshot', 'customerlastnamesnapshot', 'customerphonesnapshot')
  ) THEN RAISE EXCEPTION 'Migración ya aplicada: existe al menos una columna snapshot'; END IF;

  IF to_regclass('public.order_customer_orphan_refs') IS NOT NULL THEN
    RAISE EXCEPTION 'Migración ya aplicada o incompleta: existe order_customer_orphan_refs';
  END IF;
END $$;

-- No se inventan ni se normalizan silenciosamente emails.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.customers WHERE email IS NULL) THEN
    RAISE EXCEPTION 'Precheck falló: existe un Customer con email NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM public.customers WHERE trim(email) = '') THEN
    RAISE EXCEPTION 'Precheck falló: existe un Customer con email vacío';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.customers
    GROUP BY lower(trim(email)) HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Precheck falló: existen Customers duplicados por lower(trim(email))';
  END IF;
END $$;

-- Conteos dinámicos, sin asumir cantidades concretas.
CREATE TEMP TABLE _customer_identity_precheck ON COMMIT DROP AS
SELECT
  (SELECT count(*) FROM public.customers) AS customers_count,
  (SELECT count(*) FROM public.orders) AS orders_count,
  (SELECT count(*) FROM public.order_items) AS order_items_count,
  (SELECT count(*) FROM public.orders o
   WHERE o.customerid IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.customers c WHERE c.id = o.customerid)) AS orphan_orders_count,
  (SELECT count(*) FROM public.order_items oi
   JOIN public.orders o ON o.id = oi.orderid
   WHERE o.customerid IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.customers c WHERE c.id = o.customerid)) AS orphan_order_items_count;

-- Evidencia durable. No tiene FK a Orders, para que una eliminación accidental
-- de una Order no destruya el respaldo.
CREATE TABLE public.order_customer_orphan_refs (
  orderid TEXT PRIMARY KEY,
  customerid TEXT NOT NULL,
  capturedat TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO public.order_customer_orphan_refs (orderid, customerid)
SELECT o.id, o.customerid
FROM public.orders o
WHERE o.customerid IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.customers c WHERE c.id = o.customerid);

DO $$
DECLARE expected_orphans BIGINT; backed_up_orphans BIGINT;
BEGIN
  SELECT orphan_orders_count INTO expected_orphans FROM _customer_identity_precheck;
  SELECT count(*) INTO backed_up_orphans FROM public.order_customer_orphan_refs;
  IF backed_up_orphans <> expected_orphans THEN
    RAISE EXCEPTION 'Backup incompleto: se esperaban % y se respaldaron %', expected_orphans, backed_up_orphans;
  END IF;
END $$;

-- Solo referencias no nulas cuyo Customer no existe.
UPDATE public.orders o SET customerid = NULL
WHERE o.customerid IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.customers c WHERE c.id = o.customerid);

CREATE UNIQUE INDEX customers_email_normalized_unique
  ON public.customers (lower(trim(email)));

ALTER TABLE public.orders
  ADD CONSTRAINT orders_customerid_fkey
  FOREIGN KEY (customerid) REFERENCES public.customers(id)
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Columnas físicas lowercase; el Backend usará aliases camelCase al leerlas.
ALTER TABLE public.orders
  ADD COLUMN customeremailsnapshot TEXT NULL,
  ADD COLUMN customerfirstnamesnapshot TEXT NULL,
  ADD COLUMN customerlastnamesnapshot TEXT NULL,
  ADD COLUMN customerphonesnapshot TEXT NULL;

-- POSTCHECKS: cualquier incumplimiento provoca rollback de toda la transacción.
DO $$
DECLARE
  pre_customers BIGINT; pre_orders BIGINT; pre_order_items BIGINT;
  pre_orphans BIGINT; pre_orphan_items BIGINT; value_count BIGINT;
BEGIN
  SELECT customers_count, orders_count, order_items_count, orphan_orders_count, orphan_order_items_count
  INTO pre_customers, pre_orders, pre_order_items, pre_orphans, pre_orphan_items
  FROM _customer_identity_precheck;

  SELECT count(*) INTO value_count FROM public.orders o
  WHERE o.customerid IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.customers c WHERE c.id = o.customerid);
  IF value_count <> 0 THEN RAISE EXCEPTION 'Postcheck: quedan % referencias huérfanas activas', value_count; END IF;

  SELECT count(*) INTO value_count FROM (
    SELECT lower(trim(email)) FROM public.customers GROUP BY lower(trim(email)) HAVING count(*) > 1
  ) duplicates;
  IF value_count <> 0 THEN RAISE EXCEPTION 'Postcheck: quedan % grupos de emails duplicados', value_count; END IF;

  SELECT count(*) INTO value_count FROM public.customers WHERE email IS NULL OR trim(email) = '';
  IF value_count <> 0 THEN RAISE EXCEPTION 'Postcheck: quedan % emails NULL o vacíos', value_count; END IF;

  SELECT count(*) INTO value_count FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'customers_email_normalized_unique' AND c.relkind = 'i';
  IF value_count <> 1 THEN RAISE EXCEPTION 'Postcheck: índice email normalizado ausente o duplicado'; END IF;

  SELECT count(*) INTO value_count FROM pg_constraint
  WHERE conname = 'orders_customerid_fkey' AND conrelid = 'public.orders'::regclass
    AND contype = 'f' AND confdeltype = 'n' AND confupdtype = 'c';
  IF value_count <> 1 THEN RAISE EXCEPTION 'Postcheck: FK sin SET NULL/CASCADE'; END IF;

  SELECT count(*) INTO value_count FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'orders'
    AND column_name IN ('customeremailsnapshot', 'customerfirstnamesnapshot', 'customerlastnamesnapshot', 'customerphonesnapshot');
  IF value_count <> 4 THEN RAISE EXCEPTION 'Postcheck: columnas snapshot incompletas'; END IF;

  SELECT count(*) INTO value_count FROM public.customers;
  IF value_count <> pre_customers THEN RAISE EXCEPTION 'Postcheck: cambió el total de Customers'; END IF;
  SELECT count(*) INTO value_count FROM public.orders;
  IF value_count <> pre_orders THEN RAISE EXCEPTION 'Postcheck: cambió el total de Orders'; END IF;
  SELECT count(*) INTO value_count FROM public.order_items;
  IF value_count <> pre_order_items THEN RAISE EXCEPTION 'Postcheck: cambió el total de order_items'; END IF;

  SELECT count(*) INTO value_count FROM public.order_customer_orphan_refs;
  IF value_count <> pre_orphans THEN RAISE EXCEPTION 'Postcheck: backup no coincide con huérfanas PRE'; END IF;

  SELECT count(*) INTO value_count
  FROM public.order_customer_orphan_refs r
  LEFT JOIN public.orders o ON o.id = r.orderid WHERE o.id IS NULL;
  IF value_count <> 0 THEN RAISE EXCEPTION 'Postcheck: faltan Orders respaldadas'; END IF;

  SELECT count(*) INTO value_count
  FROM public.order_items oi JOIN public.order_customer_orphan_refs r ON r.orderid = oi.orderid;
  IF value_count <> pre_orphan_items THEN RAISE EXCEPTION 'Postcheck: faltan order_items de huérfanas'; END IF;
END $$;

COMMIT;

/* DOWN / ROLLBACK — ejecutar separadamente y con revisión explícita.

La tabla order_customer_orphan_refs se conserva como evidencia histórica.
El rollback no elimina Customers, Orders ni order_items.

Órdenes nuevas posteriores a UP:
- con customerId válido: permanecen intactas;
- con customerId NULL: permanecen NULL;
- no se restauran porque no están en el backup;
- sus snapshots se pierden al eliminar las columnas.
*/

BEGIN;
LOCK TABLE public.customers, public.orders, public.order_items
  IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF to_regclass('public.order_customer_orphan_refs') IS NULL THEN
    RAISE EXCEPTION 'Rollback detenido: no existe order_customer_orphan_refs';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.order_customer_orphan_refs r
    JOIN public.customers c ON c.id = r.customerid
  ) THEN RAISE EXCEPTION 'Rollback detenido: customerId original ahora existe'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.order_customer_orphan_refs r
    JOIN public.orders o ON o.id = r.orderid WHERE o.customerid IS NOT NULL
  ) THEN RAISE EXCEPTION 'Rollback detenido: una Order respaldada ya tiene customerId'; END IF;
END $$;

ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_customerid_fkey;
DROP INDEX IF EXISTS public.customers_email_normalized_unique;

UPDATE public.orders o SET customerid = r.customerid
FROM public.order_customer_orphan_refs r
WHERE o.id = r.orderid AND o.customerid IS NULL;

ALTER TABLE public.orders
  DROP COLUMN IF EXISTS customeremailsnapshot,
  DROP COLUMN IF EXISTS customerfirstnamesnapshot,
  DROP COLUMN IF EXISTS customerlastnamesnapshot,
  DROP COLUMN IF EXISTS customerphonesnapshot;

-- La tabla de respaldo se conserva deliberadamente.
COMMIT;
