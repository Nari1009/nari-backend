const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const orderCreationPath = require.resolve('../src/services/orderCreation');
const dbInitPath = require.resolve('../src/db/init');
const { createOrder } = require('../src/services/orderCreation');

const payload = () => ({
  reference: 'r12-injection-order',
  checkoutIdempotencyKey: 'r12-injection-key',
  customer: { email: 'r12-injection@example.invalid', phone: '3001234567' },
  shippingAddress: { addressLine1: 'Synthetic 1', city: 'Medellín', department: 'Antioquia', country: 'Colombia' },
  items: [{ productId: 'r12-injection-product', quantity: 1 }],
});

const withDbStub = async (stub, callback) => {
  const previous = require.cache[dbInitPath];
  require.cache[dbInitPath] = { id: dbInitPath, filename: dbInitPath, loaded: true, exports: stub };
  try {
    return await callback();
  } finally {
    if (previous) require.cache[dbInitPath] = previous;
    else delete require.cache[dbInitPath];
  }
};

test('createOrder uses the supplied repository and does not resolve the global database', async () => {
  let injectedCalls = 0;
  const expected = new Error('injected repository reached');
  const injected = {
    withTransaction: async () => {
      injectedCalls += 1;
      throw expected;
    },
  };
  const forbiddenDefault = {
    withTransaction: async () => { throw new Error('global repository must not be used'); },
  };

  await withDbStub(forbiddenDefault, async () => {
    await assert.rejects(
      () => createOrder({ payload: payload(), repository: injected }),
      (error) => error === expected,
    );
  });
  assert.equal(injectedCalls, 1);
});

test('createOrder without a repository preserves the default production repository path', async () => {
  let defaultCalls = 0;
  const expected = new Error('default repository reached');
  const defaultRepository = {
    withTransaction: async () => {
      defaultCalls += 1;
      throw expected;
    },
  };

  await withDbStub(defaultRepository, async () => {
    await assert.rejects(
      () => createOrder({ payload: payload() }),
      (error) => error === expected,
    );
  });
  assert.equal(defaultCalls, 1);
});

test('checkout-critical collaborators receive the same transaction adapter', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/services/orderCreation.js'), 'utf8');
  assert.match(source, /const db = repository \|\| defaultDb\(\);/);
  assert.match(source, /await db\.withTransaction\(async \(tx\) =>/);
  assert.match(source, /getShippingQuote\(\{ department: address\.department, city: address\.city \}, tx\)/);
  assert.match(source, /createReservation\(\{ orderId: id[\s\S]*?\}, tx\)/);
  assert.match(source, /createPaymentAttempt\(\{ orderId: id[\s\S]*?\}, tx\)/);
  assert.match(source, /enqueueOrderEmail\(tx, 'order_received'/);
  assert.doesNotMatch(source, /repository\s*=\s*payload\./i);
});

test('routes do not expose repository selection through HTTP input', () => {
  const routes = fs.readFileSync(path.join(__dirname, '../src/routes/auth.js'), 'utf8');
  assert.match(routes, /createOrder\(\{ payload: req\.body \|\| \{\}, userId: req\.user\.id \}\)/);
  assert.match(routes, /createOrder\(\{ payload: req\.body \|\| \{\} \}\)/);
  assert.doesNotMatch(routes, /repository:\s*req\./i);
});

test('production transaction adapter still exposes strict movement insertion', () => {
  const dbSource = fs.readFileSync(path.join(__dirname, '../src/db/init.js'), 'utf8');
  assert.match(dbSource, /runStrict: async/);
  assert.match(dbSource, /translateStrict\(sql\)/);
});

console.log('orderCreationRepositoryInjection tests: PASS');
