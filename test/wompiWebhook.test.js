const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { verifyWompiEvent, processWompiEvent } = require('../src/services/wompiWebhook');
const { buildPaymentApprovedEmail } = require('../src/services/email');

const SECRET = 'test_events_fixture_only';

const makeBody = ({ status = 'APPROVED', properties = ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'], amount = 125000, currency = 'COP', reference = 'NARI-PAY-payment-aaaaaaaaaaaaaaaaaaaaaaaa', transactionId = 'tx-1', environment = 'test', timestamp = 1727000000 } = {}) => {
  const body = {
    event: 'transaction.updated',
    data: { transaction: { id: transactionId, status, amount_in_cents: amount, currency, reference, payment_method_type: 'PSE' } },
    environment,
    signature: { properties, checksum: '' },
    timestamp,
    sent_at: '2026-09-26T00:00:00.000Z',
  };
  const material = properties.map((property) => property.split('.').reduce((value, key) => value[key], body.data)).join('') + body.timestamp + SECRET;
  body.signature.checksum = crypto.createHash('sha256').update(material).digest('hex');
  return body;
};

const clone = (value) => JSON.parse(JSON.stringify(value));

const makeRepository = ({ reservationStatus = 'ACTIVE' } = {}) => {
  const state = {
    payment: { id: 'payment-aaaaaaaaaaaaaaaaaaaaaaaa', orderId: 'order-1', provider: 'WOMPI', status: 'CREATED', amount: '125000', currency: 'COP', providerReference: 'NARI-PAY-payment-aaaaaaaaaaaaaaaaaaaaaaaa', providerTransactionId: null, providerStatus: null, paymentMethodType: null },
    reservation: { id: 'reservation-1', orderId: 'order-1', status: reservationStatus, expiresAt: '2099-01-01T00:00:00.000Z' },
    products: [{ id: 'product-1', stock: 0, status: 'active', soldCount: 0 }],
    movements: [],
    events: new Map(),
    outbox: new Map(),
    order: { id: 'order-1', orderNumber: 'NAR-1', userId: null, customerEmailSnapshot: 'test@example.invalid', customerFirstNameSnapshot: 'Test', customerLastNameSnapshot: 'User', shippingAddress: null, subtotal: '1000.00', discountTotal: '0.00', shippingTotal: '250.00', total: '1250.00' },
  };
  const snapshot = () => clone({ payment: state.payment, reservation: state.reservation, products: state.products, movements: state.movements, events: [...state.events], outbox: [...state.outbox] });
  const restore = (saved) => Object.assign(state, { ...saved, events: new Map(saved.events), outbox: new Map(saved.outbox) });
  const repository = {
    async withTransaction(callback) {
      const saved = snapshot();
      try { return await callback(repository); } catch (error) { restore(saved); throw error; }
    },
    async get(sql, params = []) {
      if (/FROM payments/i.test(sql)) {
        if (/WHERE id =/i.test(sql)) return state.payment.id === params[0] ? clone(state.payment) : null;
        if (/providerreference/i.test(sql)) return state.payment.providerReference === (params.length === 1 ? params[0] : params[1]) ? clone(state.payment) : null;
        if (/providertransactionid/i.test(sql)) return state.payment.providerTransactionId === params[0] && state.payment.id !== params[1] ? { id: state.payment.id } : null;
      }
      if (/FROM payment_events/i.test(sql)) return state.events.get(params[params.length - 1]) ? clone(state.events.get(params[params.length - 1])) : null;
      if (/FROM stock_reservations/i.test(sql)) return state.reservation.orderId === params[0] || state.reservation.id === params[0] ? clone(state.reservation) : null;
      if (/FROM orders/i.test(sql)) return state.order.id === params[0] ? clone(state.order) : null;
      return null;
    },
    async all(sql, params = []) {
      if (/FROM stock_reservation_items/i.test(sql)) return [{ id: 'reservation-item-1', reservationId: state.reservation.id, productId: 'product-1', quantity: 1 }];
      if (/FROM products/i.test(sql)) return state.products.filter((product) => params.includes(product.id)).map(clone);
      if (/FROM order_items/i.test(sql)) return [{ productName: 'Product', quantity: 1, unitPrice: '1000.00' }];
      return [];
    },
    async run(sql, params = []) {
      if (/INSERT INTO payment_events/i.test(sql)) {
        const row = { id: params[0], provider: 'WOMPI', providerEventId: params[1], providerTransactionId: params[2], paymentId: params[3], eventType: params[4], status: params[5], payloadHash: params[6], processingStatus: 'RECEIVED', processedAt: null };
        if (!state.events.has(params[1])) state.events.set(params[1], row);
        return { changes: state.events.get(params[1]).id === row.id ? 1 : 0 };
      }
      if (/UPDATE payment_events/i.test(sql)) {
        const row = [...state.events.values()].find((candidate) => candidate.id === params[params.length - 1]);
        Object.assign(row, { paymentId: params[0], providerTransactionId: params[1], status: params[2], processingStatus: params[3], processedAt: params[3] === 'PROCESSED' || params[3] === 'IGNORED' ? new Date().toISOString() : null });
        return { changes: 1 };
      }
      if (/UPDATE payments SET status/i.test(sql)) {
        const [status, providerStatus, providerTransactionId, paymentMethodType, failureCode, failureMessage, , , id] = params;
        Object.assign(state.payment, { status, providerStatus, providerTransactionId, paymentMethodType, failureCode, failureMessage });
        assert.equal(id, state.payment.id);
        return { changes: 1 };
      }
      if (/UPDATE payments SET providerstatus/i.test(sql)) {
        const [providerStatus, providerTransactionId, paymentMethodType, failureCode, failureMessage] = params;
        Object.assign(state.payment, { providerStatus, providerTransactionId, paymentMethodType, failureCode, failureMessage });
        return { changes: 1 };
      }
      if (/UPDATE products SET soldcount/i.test(sql)) { state.products[0].soldCount += params[0]; return { changes: 1 }; }
      if (/INSERT INTO inventory_movements/i.test(sql)) { state.movements.push({ reference: params[8], type: params[3] }); return { changes: 1 }; }
      if (/UPDATE stock_reservations SET status = 'COMMITTED'/i.test(sql)) { state.reservation.status = 'COMMITTED'; return { changes: 1 }; }
      if (/INSERT INTO email_outbox/i.test(sql)) { state.outbox.set(params[5], { eventType: params[1], idempotencyKey: params[5] }); return { changes: 1 }; }
      return { changes: 0 };
    },
    async runStrict(sql, params = []) { return repository.run(sql, params); },
  };
  return { repository, state };
};

test.before(() => {
  process.env.WOMPI_ENABLED = 'true';
  process.env.WOMPI_ENV = 'sandbox';
  process.env.WOMPI_EVENTS_SECRET = SECRET;
});

test('verifies dynamic signature.properties ordering and event shape', () => {
  const body = makeBody({ properties: ['transaction.amount_in_cents', 'transaction.id', 'transaction.status'] });
  const verified = verifyWompiEvent({ body, checksumHeader: body.signature.checksum, secret: SECRET, environment: 'sandbox' });
  assert.equal(verified.transaction.status, 'APPROVED');
  assert.equal(verified.transaction.amountInCents, '125000');
});

test('rejects malformed, unsupported, wrong-environment and invalid-checksum events', () => {
  assert.throws(() => verifyWompiEvent({ body: null, secret: SECRET, environment: 'sandbox' }), /válido/i);
  assert.throws(() => verifyWompiEvent({ body: { ...makeBody(), event: 'other.updated' }, secret: SECRET, environment: 'sandbox' }), /soportado/i);
  assert.throws(() => verifyWompiEvent({ body: makeBody({ environment: 'prod' }), secret: SECRET, environment: 'sandbox' }), /ambiente/i);
  const invalid = makeBody(); invalid.signature.checksum = '0'.repeat(64);
  assert.throws(() => verifyWompiEvent({ body: invalid, secret: SECRET, environment: 'sandbox' }), /firma/i);
});

test('direct CREATED to APPROVED commits reservation and commercial effects once', async () => {
  const { repository, state } = makeRepository();
  const body = makeBody();
  const first = await processWompiEvent({ body, checksumHeader: body.signature.checksum, repository });
  const second = await processWompiEvent({ body, checksumHeader: body.signature.checksum, repository });
  assert.equal(first.status, 'APPROVED');
  assert.equal(second.duplicate, true);
  assert.equal(state.payment.status, 'APPROVED');
  assert.equal(state.reservation.status, 'COMMITTED');
  assert.equal(state.products[0].soldCount, 1);
  assert.equal(state.movements.filter((row) => row.type === 'sale').length, 1);
  assert.equal(state.outbox.size, 1);
});

test('processes PENDING then APPROVED, and ignores a stale PENDING after approval', async () => {
  const { repository, state } = makeRepository();
  const pending = makeBody({ status: 'PENDING' });
  const approved = makeBody({ status: 'APPROVED' });
  await processWompiEvent({ body: pending, checksumHeader: pending.signature.checksum, repository });
  await processWompiEvent({ body: approved, checksumHeader: approved.signature.checksum, repository });
  const stale = makeBody({ status: 'PENDING', timestamp: 1727000001 });
  const result = await processWompiEvent({ body: stale, checksumHeader: stale.signature.checksum, repository });
  assert.equal(result.ignored, true);
  assert.equal(state.payment.status, 'APPROVED');
  assert.equal(state.products[0].soldCount, 1);
});

test('processes DECLINED and ERROR without committing the reservation', async () => {
  for (const status of ['DECLINED', 'ERROR']) {
    const { repository, state } = makeRepository();
    const body = makeBody({ status });
    await processWompiEvent({ body, checksumHeader: body.signature.checksum, repository });
    assert.equal(state.payment.status, status);
    assert.equal(state.reservation.status, 'ACTIVE');
    assert.equal(state.products[0].soldCount, 0);
    assert.equal(state.outbox.size, 0);
  }
});

test('processes VOIDED from PENDING without commercial effects', async () => {
  const { repository, state } = makeRepository();
  const pending = makeBody({ status: 'PENDING' });
  const voided = makeBody({ status: 'VOIDED', timestamp: 1727000001 });
  await processWompiEvent({ body: pending, checksumHeader: pending.signature.checksum, repository });
  await processWompiEvent({ body: voided, checksumHeader: voided.signature.checksum, repository });
  assert.equal(state.payment.status, 'VOIDED');
  assert.equal(state.reservation.status, 'ACTIVE');
  assert.equal(state.outbox.size, 0);
});

test('rejects unknown reference, amount mismatch, currency mismatch and transaction mismatch', async () => {
  const cases = [
    { body: makeBody({ reference: 'NARI-PAY-payment-bbbbbbbbbbbbbbbbbbbbbbbb' }), code: 'WOMPI_REFERENCE_UNKNOWN' },
    { body: makeBody({ amount: 125001 }), code: 'WOMPI_AMOUNT_MISMATCH' },
    { body: makeBody({ currency: 'USD' }), code: 'WOMPI_PAYLOAD_INVALID' },
  ];
  for (const item of cases) {
    const { repository, state } = makeRepository();
    await assert.rejects(() => processWompiEvent({ body: item.body, checksumHeader: item.body.signature.checksum, repository }), (error) => error.code === item.code);
    assert.equal(state.payment.status, 'CREATED');
    assert.equal(state.products[0].soldCount, 0);
  }
  const setup = makeRepository();
  const approved = makeBody();
  await processWompiEvent({ body: approved, checksumHeader: approved.signature.checksum, repository: setup.repository });
  const mismatch = makeBody({ status: 'APPROVED', transactionId: 'tx-2', timestamp: 1727000001 });
  await assert.rejects(() => processWompiEvent({ body: mismatch, checksumHeader: mismatch.signature.checksum, repository: setup.repository }), /transacción/i);
});

test('payment approved email is explicit and contains order summary without shipment claim', () => {
  const email = buildPaymentApprovedEmail({ order: { orderNumber: 'NAR-1', subtotal: '1000.00', shippingTotal: '250.00', total: '1250.00' }, items: [{ productName: 'Product', quantity: 1, unitPrice: '1000.00' }] });
  assert.match(email.subject, /Pago confirmado/);
  assert.match(email.textBody, /Pago aprobado/);
  assert.match(email.textBody, /NAR-1/);
  assert.match(email.textBody, /no el despacho/);
});

test('APPROVED with EXPIRED or RELEASED reservation rolls back the Payment transition and effects', async () => {
  for (const reservationStatus of ['EXPIRED', 'RELEASED']) {
    const { repository, state } = makeRepository({ reservationStatus });
    const body = makeBody();
    await assert.rejects(() => processWompiEvent({ body, checksumHeader: body.signature.checksum, repository }), /conciliación/i);
    assert.equal(state.payment.status, 'CREATED');
    assert.equal(state.products[0].soldCount, 0);
    assert.equal(state.movements.length, 0);
    assert.equal(state.outbox.size, 0);
  }
});

test('migration and outbox worker include payment_approved without changing the legacy webhook', () => {
  const migration = fs.readFileSync(path.join(__dirname, '../migrations/20260926_wompi_webhook.sql'), 'utf8');
  const outbox = fs.readFileSync(path.join(__dirname, '../src/services/emailOutbox.js'), 'utf8');
  const worker = fs.readFileSync(path.join(__dirname, '../scripts/processEmailOutbox.js'), 'utf8');
  const legacy = fs.readFileSync(path.join(__dirname, '../src/routes/paymentWebhook.js'), 'utf8');
  assert.match(migration, /payments_provider_reference_unique/i);
  assert.match(migration, /duplicate non-null provider references exist/i);
  assert.match(migration, /payment_approved/);
  assert.match(outbox, /payment_approved/);
  assert.match(worker, /sendPaymentApprovedEmail/);
  assert.match(legacy, /PAYMENT_WEBHOOK_SECRET/);
});

test('Wompi event insertion targets the existing partial unique index', () => {
  const webhook = fs.readFileSync(path.join(__dirname, '../src/services/wompiWebhook.js'), 'utf8');
  assert.match(webhook, /ON CONFLICT \(provider, providereventid\) WHERE providereventid IS NOT NULL DO NOTHING/i);
});
