-- NARI R11 Fase 3C: evidencia cosmética persistente y locks.
-- Ejecutar únicamente en Supabase DEV, desde el SQL Editor autorizado.
-- La migración es transaccional y falla sin modificar estructuras incompatibles.

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('gen_random_uuid()') IS NULL THEN
    RAISE EXCEPTION
      'R11-3C abortada: gen_random_uuid() no está disponible en este proyecto';
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.ai_product_research_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key TEXT NOT NULL UNIQUE,
  product_id TEXT NOT NULL
    REFERENCES public.products(id) ON DELETE CASCADE,
  product_fingerprint TEXT NOT NULL,
  brand_snapshot TEXT NOT NULL,
  name_snapshot TEXT NOT NULL,
  variant_snapshot TEXT,
  source_url TEXT NOT NULL,
  source_domain TEXT NOT NULL,
  source_type TEXT NOT NULL
    CONSTRAINT ai_product_research_evidence_source_type_check
    CHECK (source_type IN ('OFFICIAL', 'VERIFIED')),
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence TEXT NOT NULL
    CONSTRAINT ai_product_research_evidence_confidence_check
    CHECK (confidence IN ('VERIFIED', 'UNKNOWN', 'REJECTED')),
  consulted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ NOT NULL,
  extractor_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.ai_product_research_locks (
  cache_key TEXT PRIMARY KEY,
  owner_id UUID NOT NULL DEFAULT gen_random_uuid(),
  lease_until TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Debe ocurrir antes del bloque que valida relrowsecurity.
ALTER TABLE public.ai_product_research_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_product_research_locks ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS ai_product_research_product_idx
  ON public.ai_product_research_evidence
  (product_id, product_fingerprint, expires_at DESC);

CREATE INDEX IF NOT EXISTS ai_product_research_expiry_idx
  ON public.ai_product_research_evidence (expires_at);

DO $$
DECLARE
  required_column RECORD;
  source_check_definition TEXT;
  confidence_check_definition TEXT;
  foreign_key_is_valid BOOLEAN;
  product_index_is_valid BOOLEAN;
  expiry_index_is_valid BOOLEAN;
BEGIN
  FOR required_column IN
    SELECT * FROM (VALUES
      ('ai_product_research_evidence', 'id', 'uuid', true, true, '%gen_random_uuid%'),
      ('ai_product_research_evidence', 'cache_key', 'text', true, false, NULL),
      ('ai_product_research_evidence', 'product_id', 'text', true, false, NULL),
      ('ai_product_research_evidence', 'product_fingerprint', 'text', true, false, NULL),
      ('ai_product_research_evidence', 'brand_snapshot', 'text', true, false, NULL),
      ('ai_product_research_evidence', 'name_snapshot', 'text', true, false, NULL),
      ('ai_product_research_evidence', 'variant_snapshot', 'text', false, false, NULL),
      ('ai_product_research_evidence', 'source_url', 'text', true, false, NULL),
      ('ai_product_research_evidence', 'source_domain', 'text', true, false, NULL),
      ('ai_product_research_evidence', 'source_type', 'text', true, false, NULL),
      ('ai_product_research_evidence', 'evidence', 'jsonb', true, true, '%jsonb%'),
      ('ai_product_research_evidence', 'confidence', 'text', true, false, NULL),
      ('ai_product_research_evidence', 'consulted_at', 'timestamp with time zone', true, true, '%current_timestamp%'),
      ('ai_product_research_evidence', 'expires_at', 'timestamp with time zone', true, false, NULL),
      ('ai_product_research_evidence', 'extractor_version', 'text', true, false, NULL),
      ('ai_product_research_evidence', 'created_at', 'timestamp with time zone', true, true, '%current_timestamp%'),
      ('ai_product_research_evidence', 'updated_at', 'timestamp with time zone', true, true, '%current_timestamp%'),
      ('ai_product_research_locks', 'cache_key', 'text', true, false, NULL),
      ('ai_product_research_locks', 'owner_id', 'uuid', true, true, '%gen_random_uuid%'),
      ('ai_product_research_locks', 'lease_until', 'timestamp with time zone', true, false, NULL),
      ('ai_product_research_locks', 'created_at', 'timestamp with time zone', true, true, '%current_timestamp%')
    ) AS columns(table_name, column_name, data_type, must_be_not_null, must_have_default, default_pattern)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = required_column.table_name
        AND a.attname = required_column.column_name
        AND NOT a.attisdropped
        AND format_type(a.atttypid, a.atttypmod) = required_column.data_type
        AND a.attnotnull = required_column.must_be_not_null
        AND (
          (
            required_column.must_have_default
            AND EXISTS (
              SELECT 1
              FROM pg_attrdef d
              WHERE d.adrelid = c.oid
                AND d.adnum = a.attnum
                AND regexp_replace(lower(pg_get_expr(d.adbin, d.adrelid)), '\s+', '', 'g')
                    LIKE regexp_replace(lower(required_column.default_pattern), '\s+', '', 'g')
            )
          )
          OR (
            NOT required_column.must_have_default
            AND NOT EXISTS (
              SELECT 1
              FROM pg_attrdef d
              WHERE d.adrelid = c.oid
                AND d.adnum = a.attnum
            )
          )
        )
    ) THEN
      RAISE EXCEPTION 'R11-3C estructura incompatible: %.% requiere tipo %, nulabilidad % y default %',
        required_column.table_name,
        required_column.column_name,
        required_column.data_type,
        required_column.must_be_not_null,
        CASE WHEN required_column.must_have_default
          THEN required_column.default_pattern
          ELSE 'prohibido'
        END;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.ai_product_research_evidence'::regclass
      AND contype = 'p'
      AND pg_get_constraintdef(oid) = 'PRIMARY KEY (id)'
  ) THEN
    RAISE EXCEPTION 'R11-3C estructura incompatible: PK esperada PRIMARY KEY (id)';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.ai_product_research_locks'::regclass
      AND contype = 'p'
      AND pg_get_constraintdef(oid) = 'PRIMARY KEY (cache_key)'
  ) THEN
    RAISE EXCEPTION 'R11-3C estructura incompatible: PK esperada PRIMARY KEY (cache_key)';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM pg_constraint fk
    JOIN pg_class source_table ON source_table.oid = fk.conrelid
    JOIN pg_namespace source_schema ON source_schema.oid = source_table.relnamespace
    JOIN pg_class target_table ON target_table.oid = fk.confrelid
    JOIN pg_namespace target_schema ON target_schema.oid = target_table.relnamespace
    JOIN pg_attribute source_column
      ON source_column.attrelid = fk.conrelid
     AND source_column.attnum = fk.conkey[1]
    JOIN pg_attribute target_column
      ON target_column.attrelid = fk.confrelid
     AND target_column.attnum = fk.confkey[1]
    WHERE fk.contype = 'f'
      AND source_schema.nspname = 'public'
      AND source_table.relname = 'ai_product_research_evidence'
      AND source_column.attname = 'product_id'
      AND target_schema.nspname = 'public'
      AND target_table.relname = 'products'
      AND target_column.attname = 'id'
      AND array_length(fk.conkey, 1) = 1
      AND array_length(fk.confkey, 1) = 1
      AND fk.confdeltype = 'c'
  ) INTO foreign_key_is_valid;

  IF NOT foreign_key_is_valid THEN
    RAISE EXCEPTION 'R11-3C estructura incompatible: FK product_id -> products.id ON DELETE CASCADE';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.ai_product_research_evidence'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) = 'UNIQUE (cache_key)'
  ) THEN
    RAISE EXCEPTION 'R11-3C estructura incompatible: cache_key debe tener UNIQUE (cache_key)';
  END IF;

  SELECT pg_get_constraintdef(oid) INTO source_check_definition
  FROM pg_constraint
  WHERE conrelid = 'public.ai_product_research_evidence'::regclass
    AND conname = 'ai_product_research_evidence_source_type_check';
  IF source_check_definition IS NULL
     OR source_check_definition NOT ILIKE '%source_type%'
     OR source_check_definition NOT ILIKE '%OFFICIAL%'
     OR source_check_definition NOT ILIKE '%VERIFIED%' THEN
    RAISE EXCEPTION 'R11-3C estructura incompatible: CHECK de source_type no coincide';
  END IF;

  SELECT pg_get_constraintdef(oid) INTO confidence_check_definition
  FROM pg_constraint
  WHERE conrelid = 'public.ai_product_research_evidence'::regclass
    AND conname = 'ai_product_research_evidence_confidence_check';
  IF confidence_check_definition IS NULL
     OR confidence_check_definition NOT ILIKE '%confidence%'
     OR confidence_check_definition NOT ILIKE '%VERIFIED%'
     OR confidence_check_definition NOT ILIKE '%UNKNOWN%'
     OR confidence_check_definition NOT ILIKE '%REJECTED%' THEN
    RAISE EXCEPTION 'R11-3C estructura incompatible: CHECK de confidence no coincide';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM pg_class index_table
    JOIN pg_namespace index_schema ON index_schema.oid = index_table.relnamespace
    JOIN pg_index index_metadata ON index_metadata.indexrelid = index_table.oid
    JOIN pg_class source_table ON source_table.oid = index_metadata.indrelid
    JOIN pg_namespace source_schema ON source_schema.oid = source_table.relnamespace
    WHERE index_schema.nspname = 'public'
      AND index_table.relname = 'ai_product_research_product_idx'
      AND source_schema.nspname = 'public'
      AND source_table.relname = 'ai_product_research_evidence'
      AND index_metadata.indnkeyatts = 3
      AND ARRAY(
        SELECT attribute.attname
        FROM unnest(index_metadata.indkey) WITH ORDINALITY AS key_columns(attnum, position)
        JOIN pg_attribute attribute
          ON attribute.attrelid = source_table.oid
         AND attribute.attnum = key_columns.attnum
        ORDER BY key_columns.position
      ) = ARRAY['product_id', 'product_fingerprint', 'expires_at']::name[]
      AND (index_metadata.indoption[2] & 1) = 1
  ) INTO product_index_is_valid;

  IF NOT product_index_is_valid THEN
    RAISE EXCEPTION 'R11-3C estructura incompatible: definición de ai_product_research_product_idx no coincide';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM pg_class index_table
    JOIN pg_namespace index_schema ON index_schema.oid = index_table.relnamespace
    JOIN pg_index index_metadata ON index_metadata.indexrelid = index_table.oid
    JOIN pg_class source_table ON source_table.oid = index_metadata.indrelid
    JOIN pg_namespace source_schema ON source_schema.oid = source_table.relnamespace
    WHERE index_schema.nspname = 'public'
      AND index_table.relname = 'ai_product_research_expiry_idx'
      AND source_schema.nspname = 'public'
      AND source_table.relname = 'ai_product_research_evidence'
      AND index_metadata.indnkeyatts = 1
      AND ARRAY(
        SELECT attribute.attname
        FROM unnest(index_metadata.indkey) WITH ORDINALITY AS key_columns(attnum, position)
        JOIN pg_attribute attribute
          ON attribute.attrelid = source_table.oid
         AND attribute.attnum = key_columns.attnum
        ORDER BY key_columns.position
      ) = ARRAY['expires_at']::name[]
  ) INTO expiry_index_is_valid;

  IF NOT expiry_index_is_valid THEN
    RAISE EXCEPTION 'R11-3C estructura incompatible: definición de ai_product_research_expiry_idx no coincide';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class
    WHERE oid = 'public.ai_product_research_evidence'::regclass
      AND relrowsecurity
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_class
    WHERE oid = 'public.ai_product_research_locks'::regclass
      AND relrowsecurity
  ) THEN
    RAISE EXCEPTION 'R11-3C seguridad incompatible: RLS debe estar habilitado';
  END IF;
END
$$;

REVOKE ALL ON TABLE public.ai_product_research_evidence FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.ai_product_research_locks FROM PUBLIC, anon, authenticated;

-- No se concede acceso a service_role ni a otro rol por suposición.
-- El propietario o el rol efectivo del Backend debe verificarse manualmente.

COMMIT;
