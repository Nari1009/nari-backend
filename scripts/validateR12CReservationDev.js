#!/usr/bin/env node

const assert = require('node:assert/strict');
const { Client } = require('pg');
const {
  createReservation,
  commitReservationSale,
  releaseReservation,
  expireReservation,
} = require('../src/services/inventoryReservation');

const VALIDATION_PREFIX = 'r12c-validation-';
const REQUIRED_AUTHORIZATION = 'YES';

const failConfiguration = (message) => {
  throw new Error(`R12C DEV validation refused: ${message}`);
};

const assertDevOnlyConfiguration = () => {
  if (process.env.NARI_ALLOW_R12C_REAL_DEV_VALIDATION !== REQUIRED_AUTHORIZATION) {
    failConfiguration('set NARI_ALLOW_R12C_REAL_DEV_VALIDATION=YES to authorize this DEV-only validator.');
  }
  if (!process.env.DEV_DATABASE_URL) {
    failConfiguration('DEV_DATABASE_URL is required.');
  }
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
    // The outer harness owns BEGIN/ROLLBACK. Never nest or commit here.
    withTransaction: (callback) => callback(adapter),
  };
  return adapter;
};

const fixtureId = (suffix, kind) => `${VALIDATION_PREFIX}${suffix}-${kind}`;
const fixtureOrderNumber = (suffix) => `R12C-VALIDATION-${suffix}-${Date.now()}`;

const createFixture = async (client, suffix, { stock = 2, expiresAt } = {}) => {
  const productId = fixtureId(suffix, 'product');
  const orderId = fixtureId(suffix, 'order');
  const itemId = fixtureId(suffix, 'item');

  await client.query(`
    INSERT INTO public.products
      (id, brand, name, slug, category, price, stock, soldcount, status)
    VALUES ($1, 'R12C Validation', $2, $3, 'R12C Validation', 1000, $4, 0, 'active')
  `, [productId, `R12C validation ${suffix}`, `${productId}-slug`, stock]);
  await client.query(`
    INSERT INTO public.orders
      (id, ordernumber, status, total, shippingaddress)
    VALUES ($1, $2, 'Pendiente', 1000, 'R12C validation fixture')
  `, [orderId, fixtureOrderNumber(suffix)]);
  await client.query(`
    INSERT INTO public.order_items
      (id, orderid, productid, productname, quantity, unitprice)
    VALUES ($1, $2, $3, $4, 1, 1000)
  `, [itemId, orderId, productId, `R12C validation ${suffix}`]);

  return {
    productId,
    orderId,
    itemId,
    expiresAt: expiresAt || new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  };
};

const readProduct = async (client, productId) => {
  const result = await client.query('SELECT stock, soldcount AS "soldCount" FROM public.products WHERE id = $1', [productId]);
  assert.equal(result.rowCount, 1);
  return result.rows[0];
};

const readMovement = async (client, reference) => {
  const result = await client.query(`
    SELECT quantity, stockbefore AS "stockBefore", stockafter AS "stockAfter", type, reference
    FROM public.inventory_movements
    WHERE reference = $1
  `, [reference]);
  assert.equal(result.rowCount, 1);
  return result.rows[0];
};

const validateReserve = async (client, adapter) => {
  const fixture = await createFixture(client, 'a');
  const args = { orderId: fixture.orderId, idempotencyKey: fixtureId('a', 'key'), expiresAt: fixture.expiresAt };
  const before = await readProduct(client, fixture.productId);
  const first = await createReservation(args, adapter);
  assert.equal(first.status, 'ACTIVE');
  assert.equal(first.items.length, 1);
  const after = await readProduct(client, fixture.productId);
  assert.equal(after.stock, before.stock - 1);
  const movement = await readMovement(client, `reservation/${first.id}/${fixture.productId}`);
  assert.equal(movement.type, 'reservation');
  assert.equal(movement.quantity, -1);
  assert.equal(movement.stockBefore, before.stock);
  assert.equal(movement.stockAfter, after.stock);

  const repeated = await createReservation(args, adapter);
  assert.equal(repeated.id, first.id);
  assert.deepEqual(await readProduct(client, fixture.productId), after);
  await assert.rejects(
    () => createReservation({ ...args, idempotencyKey: fixtureId('a', 'other-key') }, adapter),
    /ya tiene una reserva/i,
  );
};

const validateCommit = async (client, adapter) => {
  const fixture = await createFixture(client, 'b');
  const reservation = await createReservation({
    orderId: fixture.orderId,
    idempotencyKey: fixtureId('b', 'key'),
    expiresAt: fixture.expiresAt,
  }, adapter);
  const afterReserve = await readProduct(client, fixture.productId);
  const committed = await commitReservationSale({ reservationId: reservation.id }, adapter);
  assert.equal(committed.status, 'COMMITTED');
  const afterCommit = await readProduct(client, fixture.productId);
  assert.equal(afterCommit.stock, afterReserve.stock);
  assert.equal(afterCommit.soldCount, 1);
  const movement = await readMovement(client, `sale/${fixture.orderId}/${fixture.productId}`);
  assert.equal(movement.type, 'sale');
  assert.equal(movement.quantity, 0);
  assert.equal(movement.stockBefore, movement.stockAfter);
  await commitReservationSale({ reservationId: reservation.id }, adapter);
  assert.deepEqual(await readProduct(client, fixture.productId), afterCommit);
  const duplicateCheck = await client.query(
    'SELECT COUNT(*)::int AS count FROM public.inventory_movements WHERE reference = $1',
    [`sale/${fixture.orderId}/${fixture.productId}`],
  );
  assert.equal(duplicateCheck.rows[0].count, 1);
};

const validateRelease = async (client, adapter) => {
  const fixture = await createFixture(client, 'c');
  const reservation = await createReservation({
    orderId: fixture.orderId,
    idempotencyKey: fixtureId('c', 'key'),
    expiresAt: fixture.expiresAt,
  }, adapter);
  const afterReserve = await readProduct(client, fixture.productId);
  const released = await releaseReservation({ reservationId: reservation.id }, adapter);
  assert.equal(released.status, 'RELEASED');
  const afterRelease = await readProduct(client, fixture.productId);
  assert.equal(afterRelease.stock, afterReserve.stock + 1);
  const movement = await readMovement(client, `reservation-release/${reservation.id}/${fixture.productId}`);
  assert.equal(movement.type, 'reservation_release');
  assert.equal(movement.quantity, 1);
  assert.equal(movement.stockBefore, afterReserve.stock);
  assert.equal(movement.stockAfter, afterRelease.stock);
  await releaseReservation({ reservationId: reservation.id }, adapter);
  assert.deepEqual(await readProduct(client, fixture.productId), afterRelease);
  await assert.rejects(() => commitReservationSale({ reservationId: reservation.id }, adapter), /no puede convertirse/i);
};

const validateExpire = async (client, adapter) => {
  const fixture = await createFixture(client, 'd');
  const reservation = await createReservation({
    orderId: fixture.orderId,
    idempotencyKey: fixtureId('d', 'key'),
    expiresAt: fixture.expiresAt,
  }, adapter);
  const afterReserve = await readProduct(client, fixture.productId);
  await assert.rejects(() => expireReservation({ reservationId: reservation.id, now: new Date() }, adapter), /todavía no ha expirado/i);
  assert.equal((await client.query('SELECT status FROM public.stock_reservations WHERE id = $1', [reservation.id])).rows[0].status, 'ACTIVE');
  const expired = await expireReservation({
    reservationId: reservation.id,
    now: new Date(Date.now() + 2 * 60 * 60 * 1000),
  }, adapter);
  assert.equal(expired.status, 'EXPIRED');
  const afterExpire = await readProduct(client, fixture.productId);
  assert.equal(afterExpire.stock, afterReserve.stock + 1);
  await expireReservation({ reservationId: reservation.id, now: new Date(Date.now() + 3 * 60 * 60 * 1000) }, adapter);
  assert.deepEqual(await readProduct(client, fixture.productId), afterExpire);
  await assert.rejects(() => commitReservationSale({ reservationId: reservation.id }, adapter), /no puede convertirse/i);
};

const validateRollback = async (client, adapter) => {
  const fixture = await createFixture(client, 'e');
  const reservation = await createReservation({
    orderId: fixture.orderId,
    idempotencyKey: fixtureId('e', 'key'),
    expiresAt: fixture.expiresAt,
  }, adapter);
  const before = await readProduct(client, fixture.productId);
  const reference = `sale/${fixture.orderId}/${fixture.productId}`;

  await client.query('SAVEPOINT r12c_validation_failure');
  await client.query(`
    INSERT INTO public.inventory_movements
      (id, productid, quantity, type, description, stockbefore, stockafter, reason, reference, orderid)
    VALUES ($1, $2, 0, 'validation_conflict', 'R12C validation conflict', $3, $3, 'R12C validation', $4, $5)
  `, [fixtureId('e', 'collision-movement'), fixture.productId, before.stock, reference, fixture.orderId]);
  await assert.rejects(() => commitReservationSale({ reservationId: reservation.id }, adapter));
  await client.query('ROLLBACK TO SAVEPOINT r12c_validation_failure');
  await client.query('RELEASE SAVEPOINT r12c_validation_failure');

  assert.deepEqual(await readProduct(client, fixture.productId), before);
  assert.equal((await client.query('SELECT status FROM public.stock_reservations WHERE id = $1', [reservation.id])).rows[0].status, 'ACTIVE');
  assert.equal((await client.query('SELECT COUNT(*)::int AS count FROM public.inventory_movements WHERE reference = $1', [reference])).rows[0].count, 0);
};

const readFixtureCounts = async (client) => {
  const like = `${VALIDATION_PREFIX}%`;
  const queries = {
    stock_reservations: ['SELECT COUNT(*)::int AS count FROM public.stock_reservations WHERE orderid LIKE $1', [like]],
    stock_reservation_items: [`
      SELECT COUNT(*)::int AS count
      FROM public.stock_reservation_items sri
      JOIN public.stock_reservations sr ON sr.id = sri.reservationid
      WHERE sr.orderid LIKE $1
    `, [like]],
    inventory_movements: ['SELECT COUNT(*)::int AS count FROM public.inventory_movements WHERE orderid LIKE $1', [like]],
    orders: ['SELECT COUNT(*)::int AS count FROM public.orders WHERE id LIKE $1', [like]],
    order_items: ['SELECT COUNT(*)::int AS count FROM public.order_items WHERE orderid LIKE $1', [like]],
    products: ['SELECT COUNT(*)::int AS count FROM public.products WHERE id LIKE $1', [like]],
  };
  const counts = {};
  for (const [table, [sql, params]] of Object.entries(queries)) {
    counts[table] = (await client.query(sql, params)).rows[0].count;
  }
  return counts;
};

const assertNoFixtureRows = (counts) => {
  for (const [table, count] of Object.entries(counts)) assert.equal(count, 0, `${table} retained ${count} R12C validation rows`);
};

const main = async () => {
  assertDevOnlyConfiguration();
  const client = new Client({ connectionString: process.env.DEV_DATABASE_URL, ssl: { rejectUnauthorized: false } });
  let outerTransactionStarted = false;
  let validationError;

  try {
    await client.connect();
    await client.query('BEGIN');
    outerTransactionStarted = true;
    const adapter = createTransactionAdapter(client);
    await validateReserve(client, adapter);
    await validateCommit(client, adapter);
    await validateRelease(client, adapter);
    await validateExpire(client, adapter);
    await validateRollback(client, adapter);
  } catch (error) {
    validationError = error;
  } finally {
    if (outerTransactionStarted) await client.query('ROLLBACK').catch(() => undefined);
    await client.end().catch(() => undefined);
  }

  let cleanupError;
  const verifier = new Client({ connectionString: process.env.DEV_DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    await verifier.connect();
    const counts = await readFixtureCounts(verifier);
    assertNoFixtureRows(counts);
  } catch (error) {
    cleanupError = error;
  } finally {
    await verifier.end().catch(() => undefined);
  }

  if (validationError) throw validationError;
  if (cleanupError) throw cleanupError;
  console.log('R12C DEV validation A-E passed; outer transaction rolled back and fixture cleanup verified.');
};

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`R12C DEV validation failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { assertDevOnlyConfiguration, createTransactionAdapter, readFixtureCounts };
