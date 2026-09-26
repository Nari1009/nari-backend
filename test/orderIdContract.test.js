const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../src/services/orderCreation.js'), 'utf8');

test('Order IDs are Backend-owned and bounded independently of payload.reference', () => {
  assert.match(source, /const id = `order-\$\{randomId\(\)\}`;/);
  assert.match(source, /payload\.reference is a legacy Client/);
  assert.doesNotMatch(source, /const id = String\(payload\.reference/);
  assert.doesNotMatch(source, /slice\(0, 50\)/);
});

test('checkout idempotency remains independent from generated Order IDs', () => {
  assert.match(source, /findExistingCheckout\(tx, checkoutIdempotencyKey\)/);
  assert.match(source, /checkoutidempotencykey/);
  assert.match(source, /INSERT INTO orders[\s\S]*checkoutidempotencykey/);
  assert.match(source, /const reservation = await createReservation\(\{ orderId: id/);
  assert.match(source, /const payment = await createPaymentAttempt\(\{ orderId: id/);
});

console.log('orderIdContract tests: PASS');
