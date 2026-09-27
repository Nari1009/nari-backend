const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const crypto = require('node:crypto');
const { createIntegritySignature, wompiReferenceForPaymentId } = require('../src/services/wompiSignature');
const { getWompiConfig } = require('../src/services/wompiConfig');
const { createCheckoutAccessToken, verifyCheckoutAccessToken } = require('../src/services/checkoutAccessToken');
const { RECOVERY_TOKEN_TTL_SECONDS, TOKEN_SCOPE, createPaymentRecoveryToken, verifyPaymentRecoveryToken } = require('../src/services/paymentRecoveryToken');

const withEnv = async (values, callback) => {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return await callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

test('Wompi references are Backend-shaped, bounded and derived from Payment IDs', () => {
  const reference = wompiReferenceForPaymentId('payment-0123456789abcdef01234567');
  assert.equal(reference, 'NARI-PAY-payment-0123456789abcdef01234567');
  assert.ok(reference.length <= 255);
  assert.throws(() => wompiReferenceForPaymentId('order-0123456789abcdef01234567'));
});

test('integrity signature uses exact Wompi material order and lowercase SHA-256', async () => {
  const secret = 'test_integrity_fixture_secret';
  const reference = 'NARI-PAY-payment-0123456789abcdef01234567';
  await withEnv({ WOMPI_INTEGRITY_SECRET: secret }, async () => {
    const actual = createIntegritySignature({ reference, amountInCents: '12500000', currency: 'COP' });
    const expected = crypto.createHash('sha256').update(`${reference}12500000COP${secret}`).digest('hex');
    assert.equal(actual, expected);
    assert.match(actual, /^[a-f0-9]{64}$/);
    assert.throws(() => createIntegritySignature({ reference, amountInCents: '0', currency: 'COP' }));
    assert.throws(() => createIntegritySignature({ reference, amountInCents: '1', currency: 'USD' }));
  });
});

test('Sandbox configuration fails closed and never requires later API secrets', async () => {
  await withEnv({ WOMPI_ENABLED: 'false', WOMPI_ENV: undefined, WOMPI_PUBLIC_KEY: undefined, WOMPI_INTEGRITY_SECRET: undefined }, async () => {
    assert.throws(() => getWompiConfig(), /no está habilitado/i);
  });
  await withEnv({ WOMPI_ENABLED: 'true', WOMPI_ENV: 'sandbox', WOMPI_PUBLIC_KEY: 'pub_test_fixture', WOMPI_INTEGRITY_SECRET: 'test_integrity_fixture' }, async () => {
    assert.deepEqual(getWompiConfig(), { environment: 'sandbox', publicKey: 'pub_test_fixture', integritySecret: 'test_integrity_fixture' });
  });
  await withEnv({ WOMPI_ENABLED: 'true', WOMPI_ENV: 'production', WOMPI_PUBLIC_KEY: 'pub_test_fixture', WOMPI_INTEGRITY_SECRET: 'test_integrity_fixture' }, async () => {
    assert.throws(() => getWompiConfig(), /sandbox/i);
  });
  await withEnv({ WOMPI_ENABLED: 'true', WOMPI_ENV: 'sandbox', WOMPI_PUBLIC_KEY: 'pub_live_fixture', WOMPI_INTEGRITY_SECRET: 'test_integrity_fixture' }, async () => {
    assert.throws(() => getWompiConfig(), /PUBLIC_KEY/i);
  });
});

test('guest checkout access tokens are scoped, expiring and tamper-resistant', async () => {
  const secret = 'checkout_access_secret_fixture_32_chars!';
  await withEnv({ CHECKOUT_ACCESS_SECRET: secret }, async () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 1800;
    const token = createCheckoutAccessToken({ orderId: 'order-0123456789abcdef01234567', paymentId: 'payment-0123456789abcdef01234567', expiresAt });
    assert.deepEqual(verifyCheckoutAccessToken(token), { version: 1, orderId: 'order-0123456789abcdef01234567', paymentId: 'payment-0123456789abcdef01234567', expiresAt });
    const parts = token.split('.');
    assert.equal(verifyCheckoutAccessToken(`${parts[0]}.${parts[1]}.tampered`), null);
    const expiredPayload = Buffer.from(JSON.stringify({ version: 1, orderId: 'order-0123456789abcdef01234567', paymentId: 'payment-0123456789abcdef01234567', expiresAt: Math.floor(Date.now() / 1000) - 1 }), 'utf8').toString('base64url');
    const expiredUnsigned = `v1.${expiredPayload}`;
    const expiredSignature = crypto.createHmac('sha256', secret).update(expiredUnsigned).digest('base64url');
    assert.equal(verifyCheckoutAccessToken(`${expiredUnsigned}.${expiredSignature}`), null);
  });
});

test('payment recovery tokens are read-only scoped, 48-hour and tamper-resistant', async () => {
  const secret = 'checkout_recovery_secret_fixture_32_chars!';
  const orderId = 'order-0123456789abcdef01234567';
  const paymentId = 'payment-0123456789abcdef01234567';
  await withEnv({ CHECKOUT_RECOVERY_SECRET: secret }, async () => {
    const expiresAt = Math.floor(Date.now() / 1000) + RECOVERY_TOKEN_TTL_SECONDS;
    const token = createPaymentRecoveryToken({ orderId, paymentId, expiresAt });
    assert.deepEqual(verifyPaymentRecoveryToken(token), { version: 1, scope: TOKEN_SCOPE, orderId, paymentId, expiresAt });
    const parts = token.split('.');
    assert.equal(verifyPaymentRecoveryToken(`${parts[0]}.${parts[1]}.tampered`), null);
    assert.throws(() => createPaymentRecoveryToken({ orderId, paymentId, expiresAt: Math.floor(Date.now() / 1000) - 1 }), /recuperación/i);
  });
});

test('payment recovery token creation fails closed without its dedicated secret', async () => {
  await withEnv({ CHECKOUT_RECOVERY_SECRET: undefined }, async () => {
    assert.throws(() => createPaymentRecoveryToken({ orderId: 'order-0123456789abcdef01234567', paymentId: 'payment-0123456789abcdef01234567' }), /CHECKOUT_RECOVERY_SECRET/i);
  });
});

test('widget endpoint is mounted separately from the legacy webhook and uses canonical fields', () => {
  const route = fs.readFileSync(path.join(__dirname, '../src/routes/wompi.js'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const orderCreation = fs.readFileSync(path.join(__dirname, '../src/services/orderCreation.js'), 'utf8');
  assert.match(route, /POST|router\.post\('\/wompi\/widget-config'/i);
  assert.match(route, /provider !== 'WOMPI'/);
  assert.match(route, /payment\.userId !== sessionUser\.id/);
  assert.match(route, /verifyCheckoutAccessToken/);
  assert.match(route, /access\.paymentId !== payment\.id/);
  assert.doesNotMatch(route, /req\.body\?\.(amount|amountInCents|currency|reference)/);
  assert.doesNotMatch(route, /UPDATE\s+payments|UPDATE\s+stock_reservations|UPDATE\s+products/i);
  assert.match(route, /payment\.amount/);
  assert.match(route, /createIntegritySignature/);
  assert.match(server, /wompiRouter/);
  assert.match(orderCreation, /provider: 'WOMPI'/);
  assert.match(orderCreation, /createCheckoutAccessToken/);
  assert.match(orderCreation, /createPaymentRecoveryToken/);
  assert.match(orderCreation, /if \(!userId && wompiEnabled\(\)\)/);
});

test('payment status endpoint is read-only and scopes authenticated and guest access', () => {
  const route = fs.readFileSync(path.join(__dirname, '../src/routes/wompi.js'), 'utf8');
  assert.match(route, /router\.post\('\/status'/);
  assert.match(route, /payment\.userId !== sessionUser\.id/);
  assert.match(route, /access\.paymentId !== payment\.id/);
  assert.match(route, /access\.orderId !== payment\.orderId/);
  assert.match(route, /verifyPaymentRecoveryToken/);
  assert.match(route, /paymentRecoveryToken/);
  const widgetRoute = route.slice(route.indexOf("router.post('/wompi/widget-config'"), route.indexOf("router.post('/status'"));
  assert.doesNotMatch(widgetRoute, /req\.body\?\.paymentRecoveryToken|verifyPaymentRecoveryToken/);
  assert.match(route, /paymentStatus: payment\.paymentStatus/);
  assert.doesNotMatch(route, /UPDATE\s+(payments|orders|stock_reservations|products)/i);
  assert.doesNotMatch(route, /INSERT\s+INTO\s+(payments|orders|stock_reservations|payment_events|email_outbox)/i);
});

console.log('wompiWidgetFoundation tests: PASS');
