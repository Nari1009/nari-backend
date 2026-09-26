#!/usr/bin/env node

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Client } = require('pg');
const {
  createReservation,
} = require('../src/services/inventoryReservation');

const VALIDATION_PREFIX = 'r12c-concurrency-validation-';
const REQUIRED_AUTHORIZATION = 'YES';
const LOCK_TIMEOUT = '5s';
const STATEMENT_TIMEOUT = '15s';
const OPERATION_TIMEOUT_MS = 30_000;

const activeClients = new Set();
let signalReceived = null;

const failConfiguration = (message) => {
  throw new Error(`R12C concurrency validation refused: ${message}`);
};

const assertDevOnlyConfiguration = () => {
  if (process.env.NARI_ALLOW_R12C_CONCURRENCY_DEV_VALIDATION !== REQUIRED_AUTHORIZATION) {
    failConfiguration('set NARI_ALLOW_R12C_CONCURRENCY_DEV_VALIDATION=YES to authorize this DEV-only validator.');
  }
  if (!process.env.DEV_DATABASE_URL) failConfiguration('DEV_DATABASE_URL is required.');
  if (process.env.DATABASE_URL || process.env.PROD_DATABASE_URL) {
    failConfiguration('DATABASE_URL and PROD_DATABASE_URL must be unset.');
  }
  let parsed;
  try {
    parsed = new URL(process.env.DEV_DATABASE_URL);
  } catch {
    failConfiguration('DEV_DATABASE_URL is not a valid URL.');
  }
  const isSupabaseHost = parsed.hostname.endsWith('.supabase.co') || parsed.hostname.endsWith('.supabase.com');
  if (!isSupabaseHost || !parsed.username.startsWith('postgres.')) {
    failConfiguration('DEV_DATABASE_URL must target a Supabase DEV PostgreSQL endpoint.');
  }
};

const translate = (sql) => {
  let translated = String(sql)
    .replace(/\bdatetime\('now',\s*'-1 day'\)/gi, `(CURRENT_TIMESTAMP - INTERVAL '1 day')`)
    .replace(/\bdatetime\('now',\s*'-3 days'\)/gi, `(CURRENT_TIMESTAMP - INTERVAL '3 days')`)
    .replace(/\bdatetime\(([^)]+)\)/gi, '$1')
    .replace(/\bCOLLATE\s+NOCASE\b/gi, '')
    .replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, 'INSERT INTO');
  return translated.replace(/\?/g, (_, offset, text) => `$${(text.slice(0, offset).match(/\?/g) || []).length + 1}`);
};

const createTransactionAdapter = (client) => {
  const adapter = {
    query: (sql, params = []) => client.query(translate(sql), params),
    get: async (sql, params = []) => (await client.query(translate(sql), params)).rows[0],
    all: async (sql, params = []) => (await client.query(translate(sql), params)).rows,
    run: async (sql, params = []) => {
      const result = await client.query(translate(sql), params);
      return { changes: result.rowCount, lastID: result.rows[0]?.id };
    },
    runStrict: async (sql, params = []) => {
      const result = await client.query(translate(sql), params);
      return { changes: result.rowCount, lastID: result.rows[0]?.id };
    },
    // Each operation owns its own outer transaction. Never nest or commit here.
    withTransaction: (callback) => callback(adapter),
  };
  return adapter;
};

const clientOptions = () => ({
  connectionString: process.env.DEV_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const fixtureId = (runId, suffix, kind) => `${runId}-${suffix}-${kind}`;
const fixtureOrderNumber = (runId, suffix) => `R12C-VALIDATION-${runId.slice(-12)}-${suffix}`;

const configureTransaction = async (client) => {
  await client.query('BEGIN');
  await client.query("SELECT set_config('lock_timeout', $1, true)", [LOCK_TIMEOUT]);
  await client.query("SELECT set_config('statement_timeout', $1, true)", [STATEMENT_TIMEOUT]);
};

const createFixture = async (client, runId, suffix, { stock, productId: suppliedProductId = null, createProduct = true }) => {
  const productId = suppliedProductId || fixtureId(runId, suffix, 'product');
  const orderId = fixtureId(runId, suffix, 'order');
  const itemId = fixtureId(runId, suffix, 'item');
  const orderNumber = fixtureOrderNumber(runId, suffix);
  const productName = `R12C concurrency validation ${suffix}`;

  if (createProduct) {
    await client.query(`
      INSERT INTO public.products
        (id, brand, name, slug, category, price, stock, soldcount, status)
      VALUES ($1, 'R12C Validation', $2, $3, 'R12C Validation', 1000, $4, 0, 'active')
    `, [productId, productName, `${productId}-slug`, stock]);
  }
  await client.query(`
    INSERT INTO public.orders
      (id, ordernumber, status, total, shippingaddress)
    VALUES ($1, $2, 'Pendiente', 1000, 'R12C concurrency validation fixture')
  `, [orderId, orderNumber]);
  await client.query(`
    INSERT INTO public.order_items
      (id, orderid, productid, productname, quantity, unitprice)
    VALUES ($1, $2, $3, $4, 1, 1000)
  `, [itemId, orderId, productId, productName]);

  return { productId, orderId, itemId, orderNumber };
};

const readNamespaceDetails = async (client) => {
  const like = `${VALIDATION_PREFIX}%`;
  const definitions = {
    stock_reservations: ['SELECT id FROM public.stock_reservations WHERE orderid LIKE $1 ORDER BY id', [like]],
    stock_reservation_items: [`
      SELECT sri.id
      FROM public.stock_reservation_items sri
      JOIN public.stock_reservations sr ON sr.id = sri.reservationid
      WHERE sr.orderid LIKE $1
      ORDER BY sri.id
    `, [like]],
    inventory_movements: ['SELECT id FROM public.inventory_movements WHERE orderid LIKE $1 ORDER BY id', [like]],
    orders: ['SELECT id FROM public.orders WHERE id LIKE $1 ORDER BY id', [like]],
    order_items: ['SELECT id FROM public.order_items WHERE orderid LIKE $1 ORDER BY id', [like]],
    products: ['SELECT id FROM public.products WHERE id LIKE $1 ORDER BY id', [like]],
  };
  const details = {};
  for (const [table, [sql, params]] of Object.entries(definitions)) {
    const rows = (await client.query(sql, params)).rows;
    details[table] = { count: rows.length, ids: rows.map((row) => row.id) };
  }
  return details;
};

const assertNoNamespaceRows = (details) => {
  const stale = Object.entries(details).filter(([, value]) => value.count !== 0);
  if (stale.length) {
    throw new Error(`stale concurrency fixtures detected: ${JSON.stringify(Object.fromEntries(stale))}`);
  }
};

const preflightStaleFixtures = async () => {
  const client = new Client(clientOptions());
  try {
    await client.connect();
    const details = await readNamespaceDetails(client);
    assertNoNamespaceRows(details);
  } finally {
    await client.end().catch(() => undefined);
  }
};

const setupFixtures = async (runId, fixtureState) => {
  const client = new Client(clientOptions());
  const fixtures = { f1: [], f2: null };
  try {
    activeClients.add(client);
    await client.connect();
    await configureTransaction(client);
    const f1ProductId = fixtureId(runId, 'f1', 'product');
    fixtures.f1.push(await createFixture(client, runId, 'f1-a', {
      stock: 1,
      productId: f1ProductId,
    }));
    fixtures.f1.push(await createFixture(client, runId, 'f1-b', {
      stock: 1,
      productId: f1ProductId,
      createProduct: false,
    }));
    fixtures.f2 = await createFixture(client, runId, 'f2', { stock: 4 });
    await client.query('COMMIT');
    fixtureState.committed = true;
    fixtureState.fixtures = fixtures;
    return fixtures;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    activeClients.delete(client);
    await client.end().catch(() => undefined);
  }
};

const operationResult = async (client, fn) => {
  try {
    await configureTransaction(client);
    const adapter = createTransactionAdapter(client);
    const value = await fn(adapter);
    await client.query('COMMIT');
    return { ok: true, value };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    return { ok: false, error };
  }
};

const runOperation = async (fn) => {
  const client = new Client(clientOptions());
  activeClients.add(client);
  let operation;
  try {
    await client.connect();
    operation = operationResult(client, fn);
    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`concurrency operation timed out after ${OPERATION_TIMEOUT_MS}ms`)), OPERATION_TIMEOUT_MS).unref();
    });
    return await Promise.race([operation, timeout]);
  } finally {
    activeClients.delete(client);
    await client.end().catch(() => undefined);
  }
};

const readProduct = async (client, productId) => (await client.query(
  'SELECT stock, soldcount AS "soldCount" FROM public.products WHERE id = $1',
  [productId],
)).rows[0];

const validateF1 = async (runId, fixtures) => {
  const productId = fixtures.f1[0].productId;
  const results = await Promise.all(fixtures.f1.map((fixture) => runOperation((adapter) => createReservation({
    orderId: fixture.orderId,
    idempotencyKey: fixtureId(runId, fixture.orderId.endsWith('f1-a-order') ? 'f1-a' : 'f1-b', 'key'),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  }, adapter))));
  const successes = results.filter((result) => result.ok);
  const failures = results.filter((result) => !result.ok);
  assert.equal(successes.length, 1, 'F1 must have exactly one successful reservation');
  assert.equal(failures.length, 1, 'F1 must have exactly one failed reservation');
  assert.match(failures[0].error.message, /stock suficiente|stock cambió/i);

  const verifier = new Client(clientOptions());
  try {
    await verifier.connect();
    const product = await readProduct(verifier, productId);
    assert.equal(product.stock, 0);
    assert.ok(product.stock >= 0);
    const reservationRows = await verifier.query("SELECT id, orderid, status FROM public.stock_reservations WHERE orderid = ANY($1::text[])", [fixtures.f1.map((fixture) => fixture.orderId)]);
    assert.equal(reservationRows.rowCount, 1);
    assert.equal(reservationRows.rows[0].status, 'ACTIVE');
    const reservationId = reservationRows.rows[0].id;
    const itemRows = await verifier.query('SELECT productid, quantity FROM public.stock_reservation_items WHERE reservationid = $1', [reservationId]);
    assert.deepEqual(itemRows.rows, [{ productid: productId, quantity: 1 }]);
    const movementRows = await verifier.query(`
      SELECT quantity, stockbefore AS "stockBefore", stockafter AS "stockAfter"
      FROM public.inventory_movements
      WHERE orderid = ANY($1::text[]) AND type = 'reservation'
    `, [fixtures.f1.map((fixture) => fixture.orderId)]);
    assert.equal(movementRows.rowCount, 1);
    assert.deepEqual(movementRows.rows[0], { quantity: -1, stockBefore: 1, stockAfter: 0 });
  } finally {
    await verifier.end().catch(() => undefined);
  }
};

const validateF2 = async (runId, fixture) => {
  const key = fixtureId(runId, 'f2', 'same-key');
  const results = await Promise.all([
    runOperation((adapter) => createReservation({ orderId: fixture.orderId, idempotencyKey: key, expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() }, adapter)),
    runOperation((adapter) => createReservation({ orderId: fixture.orderId, idempotencyKey: key, expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() }, adapter)),
  ]);
  const successes = results.filter((result) => result.ok);
  const failures = results.filter((result) => !result.ok);
  assert.ok(successes.length === 1 || successes.length === 2);
  if (successes.length === 2) assert.equal(successes[0].value.id, successes[1].value.id);
  if (failures.length === 1) assert.match(failures[0].error.message, /reserva|unique|duplicate/i);
  assert.ok(failures.length === 0 || failures.length === 1);

  const verifier = new Client(clientOptions());
  try {
    await verifier.connect();
    const product = await readProduct(verifier, fixture.productId);
    assert.equal(product.stock, 3);
    assert.ok(product.stock >= 0);
    const reservationRows = await verifier.query('SELECT id FROM public.stock_reservations WHERE orderid = $1', [fixture.orderId]);
    assert.equal(reservationRows.rowCount, 1);
    if (successes.length === 2) assert.equal(reservationRows.rows[0].id, successes[0].value.id);
    const itemRows = await verifier.query('SELECT COUNT(*)::int AS count FROM public.stock_reservation_items WHERE reservationid = $1', [reservationRows.rows[0].id]);
    assert.equal(itemRows.rows[0].count, 1);
    const movementRows = await verifier.query(`
      SELECT COUNT(*)::int AS count
      FROM public.inventory_movements
      WHERE orderid = $1 AND type = 'reservation'
    `, [fixture.orderId]);
    assert.equal(movementRows.rows[0].count, 1);
  } finally {
    await verifier.end().catch(() => undefined);
  }
};

const cleanupFixtures = async (fixtures) => {
  const client = new Client(clientOptions());
  const orderIds = [...fixtures.f1, fixtures.f2].map((fixture) => fixture.orderId);
  const productIds = [...new Set([...fixtures.f1, fixtures.f2].map((fixture) => fixture.productId))];
  try {
    activeClients.add(client);
    await client.connect();
    await client.query('BEGIN');
    await client.query(`
      DELETE FROM public.stock_reservation_items
      WHERE reservationid IN (SELECT id FROM public.stock_reservations WHERE orderid = ANY($1::text[]))
    `, [orderIds]);
    await client.query('DELETE FROM public.inventory_movements WHERE orderid = ANY($1::text[])', [orderIds]);
    await client.query('DELETE FROM public.stock_reservations WHERE orderid = ANY($1::text[])', [orderIds]);
    await client.query('DELETE FROM public.order_items WHERE orderid = ANY($1::text[])', [orderIds]);
    await client.query('DELETE FROM public.orders WHERE id = ANY($1::text[])', [orderIds]);
    await client.query('DELETE FROM public.products WHERE id = ANY($1::text[])', [productIds]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    activeClients.delete(client);
    await client.end().catch(() => undefined);
  }
};

const verifyCleanup = async () => {
  const client = new Client(clientOptions());
  try {
    await client.connect();
    const details = await readNamespaceDetails(client);
    assertNoNamespaceRows(details);
    return details;
  } finally {
    await client.end().catch(() => undefined);
  }
};

const abortActiveClients = () => {
  for (const client of activeClients) client.end().catch(() => undefined);
};

const onSignal = (signal) => {
  signalReceived = signal;
  abortActiveClients();
};

const main = async () => {
  assertDevOnlyConfiguration();
  await preflightStaleFixtures();
  const runId = `${VALIDATION_PREFIX}${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
  const fixtureState = { committed: false, fixtures: null };
  process.once('SIGINT', () => onSignal('SIGINT'));
  process.once('SIGTERM', () => onSignal('SIGTERM'));
  try {
    await setupFixtures(runId, fixtureState);
    const fixtures = fixtureState.fixtures;
    await validateF1(runId, fixtures);
    await validateF2(runId, fixtures.f2);
    if (signalReceived) throw new Error(`validation interrupted by ${signalReceived}`);
    console.log('R12C concurrency validation F1/F2 passed.');
  } finally {
    if (fixtureState.committed) {
      let cleanupError = null;
      let verificationError = null;
      let details = null;
      try {
        await cleanupFixtures(fixtureState.fixtures);
      } catch (error) {
        cleanupError = error;
      }
      try {
        details = await verifyCleanup();
      } catch (error) {
        verificationError = error;
      }
      if (cleanupError) throw new Error(`fixture cleanup failed: ${cleanupError.message}`);
      if (verificationError) throw new Error(`fixture cleanup verification failed: ${verificationError.message}`);
      console.log(`R12C concurrency fixture cleanup verified: ${JSON.stringify(details)}`);
    }
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');
  }
};

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`R12C concurrency validation failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { assertDevOnlyConfiguration, createTransactionAdapter, readNamespaceDetails };
