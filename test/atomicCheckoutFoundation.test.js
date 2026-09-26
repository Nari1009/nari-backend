const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { normalizeCheckoutIdempotencyKey, CHECKOUT_RESERVATION_TTL_MINUTES } = require('../src/services/orderCreation');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('checkout idempotency migration is nullable, duplicate-guarded and partial-unique', () => {
  const migration = read('migrations/20260926_checkout_idempotency.sql');
  assert.match(migration, /ADD COLUMN IF NOT EXISTS checkoutidempotencykey TEXT NULL/i);
  assert.match(migration, /GROUP BY checkoutidempotencykey\s+HAVING COUNT\(\*\) > 1/i);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS orders_checkout_idempotency_unique/i);
  assert.match(migration, /WHERE checkoutidempotencykey IS NOT NULL/i);
});

test('checkout idempotency keys are strictly validated and optional for legacy clients', () => {
  assert.equal(normalizeCheckoutIdempotencyKey(undefined), null);
  assert.equal(normalizeCheckoutIdempotencyKey(' checkout-123 '), 'checkout-123');
  assert.throws(() => normalizeCheckoutIdempotencyKey(123));
  assert.throws(() => normalizeCheckoutIdempotencyKey('has spaces'));
  assert.throws(() => normalizeCheckoutIdempotencyKey(''));
  assert.throws(() => normalizeCheckoutIdempotencyKey('   '));
});

test('checkout foundation composes order, reservation and payment in one transaction', () => {
  const source = read('src/services/orderCreation.js');
  assert.match(source, /withTransaction\(async \(tx\) =>/);
  assert.match(source, /createReservation\(\{ orderId: id/);
  assert.match(source, /createPaymentAttempt\(\{ orderId: id/);
  assert.match(source, /amount: orderTotalInCents\(Number\(total\)\.toFixed\(2\)\)/);
  assert.doesNotMatch(source, /amount:\s*payload/i);
  assert.match(source, /provider: 'INTERNAL_CHECKOUT'/);
  assert.match(source, /status: 'Pendiente'/);
  assert.match(source, /SAVEPOINT checkout_idempotency/);
  assert.match(source, /ROLLBACK TO SAVEPOINT checkout_idempotency/);
  assert.match(source, /pg_advisory_xact_lock\(hashtextextended/);
  assert.doesNotMatch(source, /UPDATE products SET stock = stock -/);
  assert.doesNotMatch(source, /soldCount = soldCount \+/i);
  assert.doesNotMatch(source, /INSERT INTO inventory_movements/i);
  assert.doesNotMatch(source, /UPDATE abandoned_carts/i);
});

test('reservation expiration has a bounded 30-minute default and shared transaction support exists', () => {
  assert.equal(CHECKOUT_RESERVATION_TTL_MINUTES, 30);
  const dbSource = read('src/db/init.js');
  assert.match(dbSource, /withTransaction: async \(callback\) => callback\(tx\)/);
  const shippingSource = read('src/services/shippingPolicy.js');
  assert.match(shippingSource, /configuredNationalShippingCost = async \(repository\)/);
});

console.log('atomicCheckoutFoundation tests: PASS');
