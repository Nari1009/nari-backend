const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const migrationPath = path.join(__dirname, '..', 'migrations', '20261022_r11_product_research_evidence.sql');
const migration = fs.readFileSync(migrationPath, 'utf8');

test('research migration is transactional, additive and rerunnable', () => {
  assert.match(migration, /^BEGIN;/m);
  assert.match(migration, /COMMIT;\s*$/m);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.ai_product_research_evidence/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.ai_product_research_locks/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS/);
  assert.match(migration, /pg_index/);
  assert.match(migration, /indoption\[2\] & 1/);
  assert.doesNotMatch(migration, /indoption\[3\] & 1/);
  assert.match(migration, /cache_key debe tener UNIQUE \(cache_key\)/);
  assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE|DELETE FROM/i);
  assert.doesNotMatch(migration, /ALTER TABLE public\.products/i);
});

test('RLS is enabled before the validation block checks relrowsecurity', () => {
  const rlsPosition = migration.indexOf('ALTER TABLE public.ai_product_research_evidence ENABLE ROW LEVEL SECURITY;');
  const validationPosition = migration.indexOf('DECLARE\n  required_column RECORD;');
  assert.ok(rlsPosition >= 0);
  assert.ok(validationPosition > rlsPosition);
  assert.ok(migration.lastIndexOf('relrowsecurity') > rlsPosition);
});

test('research migration fails closed for UUID, incompatible structures and missing security', () => {
  assert.match(migration, /to_regprocedure\('gen_random_uuid\(\)'\)/);
  assert.match(migration, /RAISE EXCEPTION 'R11-3C estructura incompatible/);
  assert.match(migration, /relrowsecurity/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.ai_product_research_evidence FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.ai_product_research_locks FROM PUBLIC, anon, authenticated/);
  assert.doesNotMatch(migration, /GRANT ALL ON TABLE .* service_role/);
});

test('research migration preserves product type and foreign key boundary', () => {
  assert.match(migration, /product_id TEXT NOT NULL\s+REFERENCES public\.products\(id\)/);
  assert.match(migration, /'product_id', 'text'/);
  assert.match(migration, /confdeltype = 'c'/);
  assert.match(migration, /source_column\.attname = 'product_id'/);
  assert.match(migration, /target_column\.attname = 'id'/);
  assert.match(migration, /PRIMARY KEY \(id\)/);
  assert.match(migration, /PRIMARY KEY \(cache_key\)/);
  assert.match(migration, /UNIQUE \(cache_key\)/);
  assert.match(migration, /must_be_not_null/);
  assert.match(migration, /pg_attrdef/);
});
