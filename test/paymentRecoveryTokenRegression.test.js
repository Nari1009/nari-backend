const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { createOrder } = require('../src/services/orderCreation');
const {
  RECOVERY_TOKEN_TTL_SECONDS,
  TOKEN_SCOPE,
  createPaymentRecoveryToken,
  verifyPaymentRecoveryToken,
} = require('../src/services/paymentRecoveryToken');

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

const paymentId = 'payment-0123456789abcdef01234567';
const historicalOrderId = 'order-0123456789abcdef01234567';
const generatedOrderId = 'NARI-1760000000000-0123456789abcdef01234567';

test('generated NARI order IDs create and verify recovery tokens', async () => {
  await withEnv({ CHECKOUT_RECOVERY_SECRET: 'checkout_recovery_secret_fixture_32_chars!' }, async () => {
    const expiresAt = Math.floor(Date.now() / 1000) + RECOVERY_TOKEN_TTL_SECONDS;
    const token = createPaymentRecoveryToken({ orderId: generatedOrderId, paymentId, expiresAt });
    assert.deepEqual(verifyPaymentRecoveryToken(token), {
      version: 1, scope: TOKEN_SCOPE, orderId: generatedOrderId, paymentId, expiresAt,
    });
  });
});

test('historical order IDs remain supported while malformed IDs remain rejected', async () => {
  await withEnv({ CHECKOUT_RECOVERY_SECRET: 'checkout_recovery_secret_fixture_32_chars!' }, async () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 1800;
    const token = createPaymentRecoveryToken({ orderId: historicalOrderId, paymentId, expiresAt });
    assert.equal(verifyPaymentRecoveryToken(token)?.orderId, historicalOrderId);
    assert.throws(() => createPaymentRecoveryToken({ orderId: 'order-anything', paymentId, expiresAt }), /recuperación/i);
    assert.throws(() => createPaymentRecoveryToken({ orderId: generatedOrderId, paymentId: 'payment-anything', expiresAt }), /recuperación/i);
  });
});

test('expired and tampered recovery tokens are rejected', async () => {
  const secret = 'checkout_recovery_secret_fixture_32_chars!';
  await withEnv({ CHECKOUT_RECOVERY_SECRET: secret }, async () => {
    assert.throws(() => createPaymentRecoveryToken({ orderId: generatedOrderId, paymentId, expiresAt: Math.floor(Date.now() / 1000) - 1 }), /recuperación/i);
    const expiresAt = Math.floor(Date.now() / 1000) + 1800;
    const token = createPaymentRecoveryToken({ orderId: generatedOrderId, paymentId, expiresAt });
    const parts = token.split('.');
    assert.equal(verifyPaymentRecoveryToken(`${parts[0]}.${parts[1]}.tampered`), null);
    const expiredPayload = Buffer.from(JSON.stringify({ version: 1, scope: TOKEN_SCOPE, orderId: generatedOrderId, paymentId, expiresAt: Math.floor(Date.now() / 1000) - 1 }), 'utf8').toString('base64url');
    const expiredUnsigned = `v1.${expiredPayload}`;
    const expiredSignature = crypto.createHmac('sha256', secret).update(expiredUnsigned).digest('base64url');
    assert.equal(verifyPaymentRecoveryToken(`${expiredUnsigned}.${expiredSignature}`), null);
  });
});

const createCheckoutRepository = () => {
  const order = { id: generatedOrderId, orderNumber: 'NARI-000001', total: '10900.00' };
  const payment = {
    id: paymentId,
    orderId: generatedOrderId,
    provider: 'WOMPI',
    status: 'CREATED',
    amount: '1090000',
    currency: 'COP',
    idempotencyKey: 'checkout-payment/checkout-regression-key',
  };
  const reservation = {
    id: 'reservation-0123456789abcdef01234567',
    orderId: generatedOrderId,
    status: 'ACTIVE',
    idempotencyKey: 'checkout-reservation/checkout-regression-key',
    expiresAt: new Date(Date.now() + 1_800_000).toISOString(),
  };
  const tx = {
    async withTransaction(callback) { return callback(tx); },
    async query(sql, params = []) {
      if (/INSERT INTO orders/i.test(sql)) {
        order.id = params[0];
        order.orderNumber = params[1];
        order.total = params[6];
        reservation.orderId = order.id;
        payment.orderId = order.id;
        return { rowCount: 1, rows: [{ id: order.id, orderNumber: order.orderNumber }] };
      }
      if (/INSERT INTO customers/i.test(sql)) return { rowCount: 1, rows: [{ id: 'customer-0123456789abcdef01234567' }] };
      return { rowCount: 0, rows: [] };
    },
    async get(sql) {
      if (/nextval\('public\.order_public_number_seq'\)/i.test(sql)) return { value: 1 };
      if (/checkoutidempotencykey|WHERE orderid = \?/i.test(sql) && /SELECT id FROM orders|stock_reservations WHERE orderid/i.test(sql)) return null;
      if (/customers WHERE authuserid|customers WHERE lower/i.test(sql)) return null;
      if (/SELECT email, firstname/i.test(sql)) return { email: 'buyer@example.invalid', firstName: 'Buyer', lastName: 'Test', phone: '3001234567' };
      if (/FROM orders WHERE id = \?/i.test(sql)) return order;
      if (/FROM stock_reservations/i.test(sql)) return reservation;
      if (/FROM payments/i.test(sql)) return payment;
      return null;
    },
    async all(sql) {
      if (/FROM order_items/i.test(sql)) return [{ productId: 'product-1', productName: 'Producto', quantity: 1 }];
      if (/FROM products/i.test(sql)) return [{ id: 'product-1', name: 'Producto', price: '10000.00', cost: '1000.00', stock: 5, status: 'active', soldCount: 0 }];
      if (/stock_reservation_items/i.test(sql)) return [{ id: 'reservation-item-1', reservationId: reservation.id, productId: 'product-1', quantity: 1 }];
      return [];
    },
    async run(sql, params = []) {
      if (/INSERT INTO payments/i.test(sql)) {
        payment.orderId = params[1];
        payment.amount = params[3];
        payment.currency = params[4];
        payment.idempotencyKey = params[5];
      }
      return { changes: 1, rowCount: 1 };
    },
    async runStrict() { return { changes: 1, rowCount: 1 }; },
  };
  return { withTransaction: async (callback) => callback(tx) };
};

test('guest checkout with the generated order ID reaches recovery-token generation', async () => {
  await withEnv({
    WOMPI_ENABLED: 'true',
    CHECKOUT_ACCESS_SECRET: 'checkout_access_secret_fixture_32_chars!',
    CHECKOUT_RECOVERY_SECRET: 'checkout_recovery_secret_fixture_32_chars!',
  }, async () => {
    const result = await createOrder({
      repository: createCheckoutRepository(),
      payload: {
        checkoutIdempotencyKey: 'checkout-regression-key',
        customer: { email: 'buyer@example.invalid', phone: '3001234567' },
        shippingAddress: { addressLine1: 'Calle 1', city: 'Bello', department: 'Antioquia', country: 'Colombia' },
        items: [{ productId: 'product-1', quantity: 1 }],
      },
    });
    assert.match(result.id, /^NARI-\d{10,13}-[a-f0-9]{24}$/);
    assert.equal(verifyPaymentRecoveryToken(result.paymentRecoveryToken)?.orderId, result.id);
  });
});

console.log('paymentRecoveryTokenRegression tests: PASS');
