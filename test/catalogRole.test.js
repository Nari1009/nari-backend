const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { CATALOG_ROLES, isRecommendationEligibleProduct } = require('../src/services/ai/candidates/catalogEligibility');
const { PUBLIC_PRODUCT_KEYS } = require('../src/services/productProjection');

const product = (overrides = {}) => ({ id: 'p-1', status: 'active', stock: 2, catalogRole: 'CATALOG', ...overrides });

test('catalogRole has only controlled values and eligibility is fail-closed', () => {
  assert.deepEqual(CATALOG_ROLES, ['CATALOG', 'DEV_FIXTURE']);
  assert.equal(isRecommendationEligibleProduct(product()), true);
  assert.equal(isRecommendationEligibleProduct(product({ catalogRole: 'DEV_FIXTURE' })), false);
  assert.equal(isRecommendationEligibleProduct(product({ catalogRole: null })), false);
  assert.equal(isRecommendationEligibleProduct(product({ catalogRole: 'UNKNOWN' })), false);
});

test('commercial eligibility requires active status and positive stock', () => {
  assert.equal(isRecommendationEligibleProduct(product({ status: 'inactive' })), false);
  assert.equal(isRecommendationEligibleProduct(product({ stock: 0 })), false);
  assert.equal(isRecommendationEligibleProduct(product({ stock: -1 })), false);
  assert.equal(isRecommendationEligibleProduct(product({ stock: '3' })), true);
});

test('catalogRole is internal and absent from public Product projection', () => {
  assert.equal(PUBLIC_PRODUCT_KEYS.includes('catalogRole'), false);
  const projectionSource = fs.readFileSync(path.join(__dirname, '../src/services/productProjection.js'), 'utf8');
  assert.doesNotMatch(projectionSource, /catalogRole/);
});

test('Product creation and generic Admin updates do not rewrite catalogRole', () => {
  const adminSource = fs.readFileSync(path.join(__dirname, '../src/routes/admin.js'), 'utf8');
  assert.doesNotMatch(adminSource, /catalogRole\s*[=:]/);
  assert.match(adminSource, /INSERT INTO products/);
  assert.match(adminSource, /UPDATE products SET/);
});

test('startup/init only adds the nullable boundary and does not assign Product roles', () => {
  const initSource = fs.readFileSync(path.join(__dirname, '../src/db/init.js'), 'utf8');
  assert.match(initSource, /ADD COLUMN IF NOT EXISTS catalogRole TEXT/);
  assert.doesNotMatch(initSource, /UPDATE products SET[^;]*catalogRole/i);
  const seedSource = fs.readFileSync(path.join(__dirname, '../src/db/seed.js'), 'utf8');
  assert.doesNotMatch(seedSource, /catalogRole/);
});

test('migration is additive, constrained and contains no Product classification writes', () => {
  const migration = fs.readFileSync(path.join(__dirname, '../migrations/20260912_r11d_catalog_role.sql'), 'utf8');
  assert.match(migration, /ADD COLUMN IF NOT EXISTS catalogRole TEXT NULL/i);
  assert.match(migration, /CATALOG/);
  assert.match(migration, /DEV_FIXTURE/);
  assert.doesNotMatch(migration, /\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
});
