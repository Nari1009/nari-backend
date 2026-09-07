const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  PUBLIC_PRODUCT_KEYS,
  PUBLIC_PRODUCT_SELECT,
  toPublicProduct,
} = require('../src/services/productProjection');

const productsRouteSource = fs.readFileSync(
  path.join(__dirname, '../src/routes/products.js'),
  'utf8',
);
const adminRouteSource = fs.readFileSync(
  path.join(__dirname, '../src/routes/admin.js'),
  'utf8',
);

test('public product projection keeps storefront fields and excludes operational fields', () => {
  const projected = toPublicProduct({
    id: 'p-1',
    name: 'Test product',
    brand: 'NARI',
    slug: 'test-product',
    price: 100000,
    stock: 4,
    skinTypes: '["seca"]',
    reviewCount: 3,
    cost: 25000,
    supplier: 'Private supplier',
    minimumStock: 3,
    sku: 'PRIVATE-SKU',
    createdAt: '2026-09-07T00:00:00.000Z',
    updatedAt: '2026-09-07T00:00:00.000Z',
  });

  assert.equal(projected.id, 'p-1');
  assert.equal(projected.name, 'Test product');
  assert.equal(projected.price, 100000);
  assert.equal(projected.stock, 4);
  assert.equal(projected.reviewCount, 3);
  assert.equal('cost' in projected, false);
  assert.equal('supplier' in projected, false);
  assert.equal('minimumStock' in projected, false);
  assert.equal('sku' in projected, false);
  assert.equal('createdAt' in projected, false);
  assert.equal('updatedAt' in projected, false);
});

test('public projection is explicit and future columns are not exposed automatically', () => {
  assert.ok(PUBLIC_PRODUCT_KEYS.length > 0);
  assert.match(PUBLIC_PRODUCT_SELECT, /^SELECT /);
  assert.match(PUBLIC_PRODUCT_SELECT, / FROM products$/);
  assert.equal(PUBLIC_PRODUCT_SELECT.includes('*'), false);
  assert.equal(PUBLIC_PRODUCT_KEYS.includes('cost'), false);
  assert.equal(PUBLIC_PRODUCT_KEYS.includes('supplier'), false);
  assert.equal(PUBLIC_PRODUCT_KEYS.includes('minimumStock'), false);
  assert.equal(PUBLIC_PRODUCT_KEYS.includes('sku'), false);
  assert.equal(PUBLIC_PRODUCT_KEYS.includes('updatedAt'), false);
});

test('public product routes use the explicit projection for list and detail', () => {
  assert.match(productsRouteSource, /PUBLIC_PRODUCT_SELECT/);
  assert.doesNotMatch(productsRouteSource, /SELECT \* FROM products/);
});

test('Admin product routes retain their operational product query path', () => {
  assert.match(adminRouteSource, /SELECT \* FROM products/);
  assert.match(adminRouteSource, /cost/);
  assert.match(adminRouteSource, /supplier/);
  assert.match(adminRouteSource, /minimumStock/);
});
