const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { PAYMENT_STATUSES, canTransitionPayment } = require('../src/domain/paymentStatus');
const {
  createPaymentAttempt,
  findByIdempotencyKey,
  listPaymentsForOrder,
  recordPaymentEvent,
  transitionPaymentStatus,
} = require('../src/services/paymentService');

const paymentRow = (overrides = {}) => ({
  id: 'payment-1', orderId: 'order-1', provider: 'WOMPI', status: 'CREATED', amount: '12500000', currency: 'COP',
  idempotencyKey: 'checkout-1', providerTransactionId: null, providerReference: null, paymentMethodType: null,
  providerStatus: null, failureCode: null, failureMessage: null, approvedAt: null, failedAt: null, expiresAt: null,
  createdAt: '2026-09-23T00:00:00.000Z', updatedAt: '2026-09-23T00:00:00.000Z', ...overrides,
});

const createFakeRepository = () => {
  const state = {
    orders: new Map([['order-1', { id: 'order-1', total: '125000.00' }]]),
    payments: new Map(),
    events: new Map(),
  };
  const repository = {
    async get(sql, params = []) {
      if (/FROM orders/i.test(sql)) return state.orders.get(params[0]);
      if (/FROM payment_events/i.test(sql)) {
        if (/providereventid/i.test(sql)) return state.events.get(`${params[0]}:${params[1]}`);
        return state.events.get(params[0]);
      }
      if (/FROM payments/i.test(sql)) {
        if (/WHERE id =/i.test(sql)) return state.payments.get(params[0]);
        if (/WHERE providertransactionid/i.test(sql)) return [...state.payments.values()].find((row) => row.provider === params[0] && row.providerTransactionId === params[1]);
        return [...state.payments.values()].find((row) => row.provider === params[0] && row.idempotencyKey === params[1]);
      }
      return undefined;
    },
    async all(sql, params = []) {
      if (/FROM payments/i.test(sql)) return [...state.payments.values()].filter((row) => row.orderId === params[0]);
      return [];
    },
    async run(sql, params = []) {
      if (/INSERT INTO payments/i.test(sql)) {
        const [id, orderId, provider, amount, currency, idempotencyKey, expiresAt] = params;
        const duplicate = [...state.payments.values()].some((row) => row.provider === provider && row.idempotencyKey === idempotencyKey);
        if (!duplicate) state.payments.set(id, paymentRow({ id, orderId, provider, amount, currency, idempotencyKey, expiresAt }));
        return { changes: duplicate ? 0 : 1 };
      }
      if (/UPDATE payments/i.test(sql)) {
        const [status, providerStatus, providerTransactionId, failureCode, failureMessage, approvedAt, failedAt, id, currentStatus] = params;
        const row = state.payments.get(id);
        if (!row || row.status !== currentStatus) return { changes: 0 };
        Object.assign(row, { status, providerStatus: providerStatus || row.providerStatus, providerTransactionId: providerTransactionId || row.providerTransactionId, failureCode: failureCode || row.failureCode, failureMessage: failureMessage || row.failureMessage, approvedAt: approvedAt || row.approvedAt, failedAt: failedAt || row.failedAt });
        return { changes: 1 };
      }
      if (/INSERT INTO payment_events/i.test(sql)) {
        const [id, provider, providerEventId, providerTransactionId, paymentId, eventType, status, payloadHash, processingStatus] = params;
        const key = `${provider}:${providerEventId}`;
        if (!state.events.has(key)) {
          const event = { id, provider, providerEventId, providerTransactionId, paymentId, eventType, status, payloadHash, processingStatus, receivedAt: '2026-09-23T00:00:00.000Z', processedAt: null };
          state.events.set(key, event);
          state.events.set(id, event);
          return { changes: 1 };
        }
        return { changes: 0 };
      }
      throw new Error(`Unexpected SQL in fake repository: ${sql}`);
    },
  };
  return { repository, state };
};

test('payment migration defines independent payment and event entities without historical backfill', () => {
  const migration = fs.readFileSync(path.join(__dirname, '../migrations/20260923_payment_domain.sql'), 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.payments/i);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.payment_events/i);
  assert.match(migration, /UNIQUE \(provider, idempotencykey\)/i);
  assert.match(migration, /payments_provider_transaction_unique/i);
  assert.match(migration, /payment_events_provider_event_unique/i);
  assert.match(migration, /REFERENCES public\.orders\(id\) ON DELETE RESTRICT/i);
  assert.match(migration, /REFERENCES public\.payments\(id\)/i);
  assert.match(migration, /ALTER TABLE public\.payments ENABLE ROW LEVEL SECURITY/i);
  assert.match(migration, /ALTER TABLE public\.payment_events ENABLE ROW LEVEL SECURITY/i);
  assert.match(migration, /REVOKE ALL PRIVILEGES ON TABLE public\.payments FROM anon, authenticated/i);
  assert.match(migration, /REVOKE ALL PRIVILEGES ON TABLE public\.payment_events FROM anon, authenticated/i);
  assert.doesNotMatch(migration, /FORCE ROW LEVEL SECURITY/i);
  assert.doesNotMatch(migration, /GRANT\s+.*\b(anon|authenticated)\b/i);
  assert.doesNotMatch(migration, /\b(INSERT|UPDATE|DELETE)\s+INTO\s+public\.(orders|products)/i);
  assert.doesNotMatch(migration, /wompi/i);
});

test('security baseline is scoped to NARI public tables and preserves managed roles', () => {
  const migration = fs.readFileSync(path.join(__dirname, '../migrations/20260924_nari_public_security_baseline.sql'), 'utf8');
  const expectedTables = [
    'abandoned_cart_migration_runs', 'abandoned_carts', 'account_addresses', 'admin_sessions',
    'admin_users', 'auth_sessions', 'auth_users', 'catalog_options', 'customers', 'email_outbox',
    'email_verification_tokens', 'inventory_movements', 'order_customer_orphan_refs', 'order_items',
    'order_review_requests', 'orders', 'password_reset_tokens', 'products', 'public_settings',
    'review_links', 'reviews', 'site_content',
  ];
  for (const table of expectedTables) assert.match(migration, new RegExp(`'${table}'`));
  assert.match(migration, /to_regclass\(format\('public\.%I', expected_table\)\)/i);
  assert.doesNotMatch(migration, /COUNT\(\*\).*22|actual_count/i);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/i);
  assert.match(migration, /REVOKE ALL PRIVILEGES ON TABLE/i);
  assert.doesNotMatch(migration, /supabase_admin|storage\.objects|auth\./i);
  assert.doesNotMatch(migration, /REVOKE\s+.*service_role/i);
  assert.doesNotMatch(migration, /CREATE POLICY/i);
  assert.doesNotMatch(migration, /FORCE ROW LEVEL SECURITY/i);
});

test('security baseline does not harden payment tables or reject additional public tables', () => {
  const migration = fs.readFileSync(path.join(__dirname, '../migrations/20260924_nari_public_security_baseline.sql'), 'utf8');
  assert.doesNotMatch(migration, /payments|payment_events/i);
  assert.doesNotMatch(migration, /pg_class|pg_namespace/i);
  assert.match(migration, /FOREACH expected_table IN ARRAY expected_tables/i);
});

test('payment order relationship is non-cascading for payment history', () => {
  const migration = fs.readFileSync(path.join(__dirname, '../migrations/20260923_payment_domain.sql'), 'utf8');
  assert.match(migration, /orderid TEXT NOT NULL REFERENCES public\.orders\(id\) ON DELETE RESTRICT/i);
  assert.doesNotMatch(migration, /orderid TEXT NOT NULL REFERENCES public\.orders\(id\) ON DELETE CASCADE/i);
  assert.match(migration, /paymentid TEXT NULL REFERENCES public\.payments\(id\) ON DELETE SET NULL/i);
});

test('payment statuses expose one canonical transition matrix', () => {
  assert.deepEqual(Object.keys(PAYMENT_STATUSES), ['CREATED', 'PENDING', 'APPROVED', 'DECLINED', 'VOIDED', 'ERROR', 'REFUNDED']);
  assert.equal(canTransitionPayment('CREATED', 'PENDING'), true);
  assert.equal(canTransitionPayment('PENDING', 'APPROVED'), true);
  assert.equal(canTransitionPayment('APPROVED', 'PENDING'), false);
  assert.equal(canTransitionPayment('REFUNDED', 'APPROVED'), false);
});

test('creating an attempt uses the canonical order amount and is idempotent', async () => {
  const { repository, state } = createFakeRepository();
  const first = await createPaymentAttempt({ orderId: 'order-1', provider: 'wompi', amount: '12500000', idempotencyKey: 'checkout-1' }, repository);
  const second = await createPaymentAttempt({ orderId: 'order-1', provider: 'WOMPI', amount: '12500000', idempotencyKey: 'checkout-1' }, repository);
  assert.equal(first.id, second.id);
  assert.equal(state.payments.size, 1);
  await assert.rejects(() => createPaymentAttempt({ orderId: 'order-1', provider: 'WOMPI', amount: '12500001', idempotencyKey: 'checkout-2' }, repository), /monto no coincide/i);
  await assert.rejects(() => createPaymentAttempt({ orderId: 'order-1', provider: 'WOMPI', amount: '0', idempotencyKey: 'checkout-3' }, repository), /monto/i);
  await assert.rejects(() => createPaymentAttempt({ orderId: 'order-1', provider: 'WOMPI', amount: '-1', idempotencyKey: 'checkout-4' }, repository), /monto/i);
  assert.equal((await findByIdempotencyKey('WOMPI', 'checkout-1', repository)).id, first.id);
});

test('one order can have multiple attempts and transitions remain monotonic', async () => {
  const { repository, state } = createFakeRepository();
  const first = await createPaymentAttempt({ orderId: 'order-1', provider: 'WOMPI', amount: '12500000', idempotencyKey: 'checkout-1' }, repository);
  state.payments.set('payment-2', paymentRow({ id: 'payment-2', idempotencyKey: 'checkout-2', status: 'DECLINED' }));
  assert.equal((await listPaymentsForOrder('order-1', repository)).length, 2);
  await transitionPaymentStatus({ paymentId: first.id, status: 'PENDING' }, repository);
  const approved = await transitionPaymentStatus({ paymentId: first.id, status: 'APPROVED', providerTransactionId: 'tx-1' }, repository);
  assert.equal(approved.status, 'APPROVED');
  await assert.rejects(() => transitionPaymentStatus({ paymentId: first.id, status: 'PENDING' }, repository), /no está permitida/i);
  state.payments.get(first.id).status = 'REFUNDED';
  await assert.rejects(() => transitionPaymentStatus({ paymentId: first.id, status: 'APPROVED' }, repository), /no está permitida/i);
});

test('payment events deduplicate by provider event id without storing provider payload', async () => {
  const { repository, state } = createFakeRepository();
  const hash = 'a'.repeat(64);
  const first = await recordPaymentEvent({ provider: 'WOMPI', providerEventId: 'evt-1', eventType: 'transaction.updated', status: 'PENDING', payloadHash: hash }, repository);
  const second = await recordPaymentEvent({ provider: 'WOMPI', providerEventId: 'evt-1', eventType: 'transaction.updated', status: 'PENDING', payloadHash: hash }, repository);
  assert.equal(first.id, second.id);
  assert.equal(state.events.size, 2);
  assert.ok(!Object.hasOwn(first, 'payload'));
  await assert.rejects(() => recordPaymentEvent({ provider: 'WOMPI', providerEventId: 'evt-2', eventType: 'transaction.updated', status: 'PENDING', payloadHash: 'not-a-hash' }, repository), /hash/i);
});
