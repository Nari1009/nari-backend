#!/usr/bin/env node

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Client } = require('pg');
const { processWompiEvent } = require('../src/services/wompiWebhook');
const { createReservation, releaseReservation, expireReservation } = require('../src/services/inventoryReservation');

const AUTHORIZATION = 'YES';
const SECRET = crypto.randomBytes(32).toString('hex');
const EVENTS_SECRET = `test_events_${SECRET}`;
const NAMESPACE = `r12e-wompi-validation-${process.pid}-${Date.now()}-`;
const fixtures = [];
let activeClient = null;

const failConfiguration = (message) => {
  throw new Error(`R12E DEV validation refused: ${message}`);
};

const assertConfiguration = () => {
  if (process.env.NARI_ALLOW_R12E_REAL_DEV_VALIDATION !== AUTHORIZATION) failConfiguration('set NARI_ALLOW_R12E_REAL_DEV_VALIDATION=YES.');
  if (!process.env.DEV_DATABASE_URL) failConfiguration('DEV_DATABASE_URL is required.');
  if (process.env.DATABASE_URL || process.env.PROD_DATABASE_URL) failConfiguration('DATABASE_URL and PROD_DATABASE_URL must be unset.');
  let parsed;
  try { parsed = new URL(process.env.DEV_DATABASE_URL); } catch { failConfiguration('DEV_DATABASE_URL is not a valid URL.'); }
  const isSupabase = parsed.hostname.endsWith('.supabase.co') || parsed.hostname.endsWith('.supabase.com');
  if (!isSupabase || !parsed.username.startsWith('postgres.')) failConfiguration('DEV_DATABASE_URL must target Supabase DEV PostgreSQL.');
};

const sql = (text, params = []) => String(text).replace(/\?/g, (_, offset, source) => `$${(source.slice(0, offset).match(/\?/g) || []).length + 1}`);

const adapterFor = (client) => ({
  query: (text, params = []) => client.query(sql(text), params),
  get: async (text, params = []) => (await client.query(sql(text), params)).rows[0],
  all: async (text, params = []) => (await client.query(sql(text), params)).rows,
  run: async (text, params = []) => { const result = await client.query(sql(text), params); return { changes: result.rowCount, lastID: result.rows[0]?.id }; },
  runStrict: async (text, params = []) => { const result = await client.query(sql(text), params); return { changes: result.rowCount, lastID: result.rows[0]?.id }; },
  withTransaction: (callback) => callback(adapterFor(client)),
});

const withTransaction = async (client, callback) => {
  await client.query('BEGIN');
  try {
    const result = await callback(adapterFor(client));
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
};

const id = (suffix) => `${NAMESPACE}${suffix}`;
const paymentReference = (paymentId) => `NARI-PAY-${paymentId}`;

const makeEvent = ({ payment, status, transactionId = id(`tx-${payment.id}`), timestamp = Date.now() }) => {
  const body = {
    event: 'transaction.updated',
    data: { transaction: {
      id: transactionId,
      status,
      amount_in_cents: String(payment.amount),
      currency: payment.currency,
      reference: payment.providerReference,
      payment_method_type: 'PSE',
    } },
    environment: 'test',
    signature: { properties: ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'], checksum: '' },
    timestamp,
  };
  const material = body.signature.properties.map((property) => property.split('.').reduce((value, key) => value[key], body.data)).join('') + String(timestamp) + EVENTS_SECRET;
  body.signature.checksum = crypto.createHash('sha256').update(material, 'utf8').digest('hex');
  return body;
};

const createFixture = async (client, label) => {
  const productId = id(`${label}-product`);
  const orderId = id(`${label}-order`);
  const itemId = id(`${label}-item`);
  const paymentId = id(`${label}-payment`);
  const orderNumber = `R12E-${process.pid}-${label}`.slice(0, 50);
  await client.query(`INSERT INTO products (id, brand, name, slug, category, price, stock, soldcount, status, catalogrole)
    VALUES ($1, 'R12E Validation', $2, $3, 'R12E Validation', 1250, 1, 0, 'active', 'DEV_FIXTURE')`, [productId, `R12E ${label}`, `${productId}-slug`]);
  await client.query(`INSERT INTO orders (id, ordernumber, status, total, subtotal, shippingtotal, discounttotal, shippingaddress)
    VALUES ($1, $2, 'Pendiente', 1250, 1250, 0, 0, 'R12E validation fixture')`, [orderId, orderNumber]);
  await client.query(`INSERT INTO order_items (id, orderid, productid, productname, quantity, unitprice)
    VALUES ($1, $2, $3, $4, 1, 1250)`, [itemId, orderId, productId, `R12E ${label}`]);
  await client.query(`INSERT INTO payments (id, orderid, provider, status, amount, currency, idempotencykey, providerreference)
    VALUES ($1, $2, 'WOMPI', 'CREATED', 125000, 'COP', $3, $4)`, [paymentId, orderId, id(`${label}-key`), paymentReference(paymentId)]);
  const fixture = { productId, orderId, itemId, paymentId, payment: { id: paymentId, amount: '125000', currency: 'COP', providerReference: paymentReference(paymentId) } };
  fixtures.push(fixture);
  await withTransaction(client, (tx) => createReservation({ orderId, idempotencyKey: id(`${label}-reservation-key`), expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() }, tx));
  return fixture;
};

const processEvent = (body, client) => withTransaction(client, (tx) => processWompiEvent({ body, checksumHeader: body.signature.checksum, repository: tx }));

const counts = async (client, fixture) => {
  const result = {};
  for (const [key, table, column, value] of [
    ['payment', 'payments', 'id', fixture.paymentId],
    ['reservation', 'stock_reservations', 'orderid', fixture.orderId],
    ['saleMovement', 'inventory_movements', 'reference', `sale/${fixture.orderId}/${fixture.productId}`],
    ['approvedEmail', 'email_outbox', 'idempotencykey', `payment_approved/${fixture.paymentId}`],
    ['event', 'payment_events', 'paymentid', fixture.paymentId],
  ]) {
    const row = await client.query(`SELECT COUNT(*)::int AS count FROM ${table} WHERE ${column} = $1`, [value]);
    result[key] = row.rows[0].count;
  }
  const product = await client.query('SELECT stock, soldcount AS "soldCount" FROM products WHERE id = $1', [fixture.productId]);
  result.product = product.rows[0];
  const payment = await client.query('SELECT status FROM payments WHERE id = $1', [fixture.paymentId]);
  const reservation = await client.query('SELECT status FROM stock_reservations WHERE orderid = $1', [fixture.orderId]);
  const processedEvents = await client.query("SELECT COUNT(*)::int AS count FROM payment_events WHERE paymentid = $1 AND processingstatus = 'PROCESSED'", [fixture.paymentId]);
  result.paymentStatus = payment.rows[0]?.status;
  result.reservationStatus = reservation.rows[0]?.status;
  result.processedEvents = processedEvents.rows[0].count;
  return result;
};

const validateApproved = async (client, fixture, label) => {
  const body = makeEvent({ payment: fixture.payment, status: 'APPROVED', transactionId: id(`${label}-tx`) });
  await processEvent(body, client);
  await processEvent(body, client);
  const state = await counts(client, fixture);
  assert.equal(state.paymentStatus, 'APPROVED');
  assert.equal(state.reservationStatus, 'COMMITTED');
  assert.equal(state.reservation, 1);
  assert.equal(state.saleMovement, 1);
  assert.equal(state.approvedEmail, 1);
  assert.equal(state.event, 1);
  assert.equal(state.processedEvents, 1);
  assert.equal(state.product.soldCount, 1);
  assert.equal(state.product.stock, 0);
};

const validatePendingThenApproved = async (client, fixture, label) => {
  const pending = makeEvent({ payment: fixture.payment, status: 'PENDING', transactionId: id(`${label}-tx`) });
  const approved = makeEvent({ payment: fixture.payment, status: 'APPROVED', transactionId: id(`${label}-tx`), timestamp: Date.now() + 1 });
  await processEvent(pending, client);
  await processEvent(approved, client);
  const state = await counts(client, fixture);
  assert.equal(state.paymentStatus, 'APPROVED');
  assert.equal(state.reservationStatus, 'COMMITTED');
  assert.equal(state.processedEvents, 2);
  assert.equal(state.reservation, 1);
  assert.equal(state.saleMovement, 1);
  assert.equal(state.approvedEmail, 1);
  assert.equal(state.product.soldCount, 1);
};

const validateConcurrentDuplicate = async (fixture, label) => {
  const body = makeEvent({ payment: fixture.payment, status: 'APPROVED', transactionId: id(`${label}-tx`) });
  const first = new Client({ connectionString: process.env.DEV_DATABASE_URL });
  const second = new Client({ connectionString: process.env.DEV_DATABASE_URL });
  await Promise.all([first.connect(), second.connect()]);
  try { await Promise.all([processEvent(body, first), processEvent(body, second)]); } finally { await Promise.all([first.end(), second.end()]); }
  const state = await counts(activeClient, fixture);
  assert.equal(state.saleMovement, 1);
  assert.equal(state.approvedEmail, 1);
  assert.equal(state.product.soldCount, 1);
};

const validateReconciliationRollback = async (client, fixture, label, status) => {
  const reservation = await client.query('SELECT id FROM stock_reservations WHERE orderid = $1', [fixture.orderId]);
  if (status === 'RELEASED') await releaseReservation({ reservationId: reservation.rows[0].id }, adapterFor(client));
  else {
    await client.query('UPDATE stock_reservations SET expiresat = CURRENT_TIMESTAMP - INTERVAL \'1 minute\' WHERE id = $1', [reservation.rows[0].id]);
    await expireReservation({ reservationId: reservation.rows[0].id, now: new Date() }, adapterFor(client));
  }
  const body = makeEvent({ payment: fixture.payment, status: 'APPROVED', transactionId: id(`${label}-tx`) });
  await assert.rejects(() => processEvent(body, client), (error) => error.code === 'WOMPI_RECONCILIATION_REQUIRED');
  const state = await counts(client, fixture);
  const payment = await client.query('SELECT status FROM payments WHERE id = $1', [fixture.paymentId]);
  assert.equal(payment.rows[0].status, 'CREATED');
  assert.equal(state.saleMovement, 0);
  assert.equal(state.approvedEmail, 0);
  assert.equal(state.product.soldCount, 0);
  assert.equal(state.processedEvents, 0);
};

const cleanup = async (client) => {
  const ids = fixtures.map((fixture) => fixture.orderId);
  if (!ids.length) return;
  await client.query('DELETE FROM email_outbox WHERE orderid = ANY($1::text[])', [ids]);
  await client.query('DELETE FROM payment_events WHERE paymentid IN (SELECT id FROM payments WHERE orderid = ANY($1::text[]))', [ids]);
  await client.query('DELETE FROM payments WHERE orderid = ANY($1::text[])', [ids]);
  await client.query('DELETE FROM inventory_movements WHERE orderid = ANY($1::text[])', [ids]);
  await client.query('DELETE FROM stock_reservation_items WHERE reservationid IN (SELECT id FROM stock_reservations WHERE orderid = ANY($1::text[]))', [ids]);
  await client.query('DELETE FROM stock_reservations WHERE orderid = ANY($1::text[])', [ids]);
  await client.query('DELETE FROM order_items WHERE orderid = ANY($1::text[])', [ids]);
  await client.query('DELETE FROM orders WHERE id = ANY($1::text[])', [ids]);
  await client.query('DELETE FROM products WHERE id = ANY($1::text[])', [fixtures.map((fixture) => fixture.productId)]);
  const remaining = await client.query('SELECT COUNT(*)::int AS count FROM products WHERE id = ANY($1::text[])', [fixtures.map((fixture) => fixture.productId)]);
  assert.equal(remaining.rows[0].count, 0);
};

const main = async () => {
  assertConfiguration();
  process.env.WOMPI_ENABLED = 'true';
  process.env.WOMPI_ENV = 'sandbox';
  process.env.WOMPI_EVENTS_SECRET = EVENTS_SECRET;
  activeClient = new Client({ connectionString: process.env.DEV_DATABASE_URL });
  await activeClient.connect();
  try {
    const direct = await createFixture(activeClient, 'direct');
    await validateApproved(activeClient, direct, 'direct');
    const sequence = await createFixture(activeClient, 'sequence');
    await validatePendingThenApproved(activeClient, sequence, 'sequence');
    const concurrent = await createFixture(activeClient, 'concurrent');
    await validateConcurrentDuplicate(concurrent, 'concurrent');
    const expired = await createFixture(activeClient, 'expired');
    await validateReconciliationRollback(activeClient, expired, 'expired', 'EXPIRED');
    const released = await createFixture(activeClient, 'released');
    await validateReconciliationRollback(activeClient, released, 'released', 'RELEASED');
    console.log('R12E WOMPI WEBHOOK DEV VALIDATION PASS');
  } finally {
    await cleanup(activeClient).catch(() => undefined);
    await activeClient.end();
    activeClient = null;
  }
};

const handleSignal = async (signal) => {
  if (activeClient) await cleanup(activeClient).catch(() => undefined);
  process.exitCode = 130;
  console.error(`R12E DEV validation interrupted: ${signal}`);
};

process.once('SIGINT', () => { handleSignal('SIGINT'); });
process.once('SIGTERM', () => { handleSignal('SIGTERM'); });

if (require.main === module) main().catch((error) => { console.error(`R12E DEV validation failed: ${error.message}`); process.exitCode = 1; });
