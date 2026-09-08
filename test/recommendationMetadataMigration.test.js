const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const migration = fs.readFileSync(
  path.join(__dirname, '../migrations/20260909_r11b2_canonical_recommendation_metadata.sql'),
  'utf8',
);

test('canonical recommendation metadata migration is additive and narrowly scoped', () => {
  assert.match(migration, /ALTER TABLE public\.products/i);
  for (const column of ['suitableSkinTypes', 'suitableConditions', 'targets']) {
    assert.match(migration, new RegExp(`ADD COLUMN IF NOT EXISTS ${column} TEXT NULL`, 'i'));
  }
  assert.doesNotMatch(migration, /\b(UPDATE|DELETE|INSERT|DROP|TRUNCATE|CREATE)\b/i);
  assert.doesNotMatch(migration, /catalog_options|customers|orders|auth|reviews/i);
});
