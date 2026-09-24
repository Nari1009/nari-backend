-- NARI DEV security baseline
-- Reproducible hardening for NARI-owned public tables only.
-- Does not touch Supabase managed schemas, service_role, Storage or policies.
-- Safe to re-run after the expected DEV table set has been confirmed.
BEGIN;

DO $$
DECLARE
  expected_table TEXT;
  expected_tables CONSTANT TEXT[] := ARRAY[
    'abandoned_cart_migration_runs',
    'abandoned_carts',
    'account_addresses',
    'admin_sessions',
    'admin_users',
    'auth_sessions',
    'auth_users',
    'catalog_options',
    'customers',
    'email_outbox',
    'email_verification_tokens',
    'inventory_movements',
    'order_customer_orphan_refs',
    'order_items',
    'order_review_requests',
    'orders',
    'password_reset_tokens',
    'products',
    'public_settings',
    'review_links',
    'reviews',
    'site_content'
  ];
BEGIN
  FOREACH expected_table IN ARRAY expected_tables
  LOOP
    IF to_regclass(format('public.%I', expected_table)) IS NULL THEN
      RAISE EXCEPTION 'NARI DEV security baseline expected historical table public.% but it is missing', expected_table;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', expected_table);
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM anon, authenticated', expected_table);
  END LOOP;
END $$;

-- No public policies are created. Backend access remains through the existing
-- direct PostgreSQL role; service_role grants are intentionally untouched.
COMMIT;
