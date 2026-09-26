/*
 * DEV-only manual validator for the R12 atomic checkout foundation.
 *
 * This file intentionally does not load .env, mutate process.env, apply
 * migrations, use the application pool, or access any production system.
 * Run manually only after migrations/20260926_checkout_idempotency.sql has
 * been reviewed and applied to the authorized Supabase DEV database.
 */
const crypto = require('crypto');
const { Client } = require('pg');
const { createOrder } = require('../src/services/orderCreation');
const {
  createReservation,
  commitReservationSale,
  releaseReservation,
  expireReservation,
} = require('../src/services/inventoryReservation');

const PREFIX = 'r12-atomic-checkout-validation-';
const PRIVATE_TABLES = [
  'orders', 'order_items', 'customers', 'auth_users', 'stock_reservations',
  'stock_reservation_items', 'payments', 'payment_events', 'inventory_movements',
  'email_outbox', 'abandoned_carts', 'account_addresses', 'auth_sessions', 'products', 'public_settings',
];
const STALE_COLUMNS = {
  products: ['id', 'slug', 'sku', 'name'],
  customers: ['id', 'email'],
  auth_users: ['id', 'email'],
  orders: ['id', 'ordernumber', 'checkoutidempotencykey'],
  order_items: ['id', 'orderid', 'productid', 'productname'],
  stock_reservations: ['id', 'orderid', 'idempotencykey'],
  stock_reservation_items: ['id', 'reservationid', 'productid'],
  payments: ['id', 'orderid', 'idempotencykey', 'providerreference', 'providertransactionid'],
  payment_events: ['id', 'paymentid', 'providereventid', 'providertransactionid'],
  inventory_movements: ['id', 'productid', 'orderid', 'reference'],
  email_outbox: ['id', 'orderid', 'idempotencykey', 'recipientemail', 'payload'],
  abandoned_carts: ['id', 'userid', 'email', 'items'],
  account_addresses: ['id', 'userid', 'addressline1'],
  auth_sessions: ['id', 'userid'],
};

const runId = `${PREFIX}${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
const sets = new Map(PRIVATE_TABLES.map((table) => [table, new Set()]));
let operationalClients = new Set();
let cleanupStarted = false;
let signalHandling = false;
let mutationStarted = false;
let activeScenario = 'startup';

const fail = (message) => { throw new Error(message); };
const assert = (condition, message) => { if (!condition) fail(message); };
const text = (value) => String(value ?? '');
const id = (label) => `${runId}-${label}`;
const email = (label) => `${runId}-${label}@example.invalid`;
const key = (label) => `${runId}-${label}`;
// Production truncates payload.reference to 50 characters before using it as
// orders.id. Keep validator Order references below that limit while retaining
// the synthetic namespace and a per-label run-derived identity.
const orderReference = (label) => `${PREFIX}order-${crypto.createHash('sha256').update(`${runId}:${label}`).digest('hex').slice(0, 12)}`;
const orderNumber = (label) => `R12-VALIDATION-${Date.now()}-${label}`.slice(0, 120);
const isoInMinutes = (minutes) => new Date(Date.now() + minutes * 60 * 1000).toISOString();

const safeError = (error) => ({
  code: error?.code || null,
  status: error?.status || null,
  message: text(error?.message).slice(0, 240),
});

const setScenario = (name) => { activeScenario = name; };

const isSupportedSupabaseHostname = (hostname) => {
  const value = String(hostname || '').toLowerCase();
  const directHost = /^db\.[a-z0-9]{10,40}\.supabase\.co$/i;
  const poolerHost = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.pooler\.supabase\.com$/i;
  return directHost.test(value) || poolerHost.test(value);
};

const validateEnvironment = () => {
  if (process.env.NARI_ALLOW_ATOMIC_CHECKOUT_DEV_VALIDATION !== 'YES') {
    fail('Set NARI_ALLOW_ATOMIC_CHECKOUT_DEV_VALIDATION=YES to authorize this DEV-only validator.');
  }
  if (!process.env.DEV_DATABASE_URL) fail('DEV_DATABASE_URL is required.');
  if (process.env.DATABASE_URL) fail('DATABASE_URL must be absent.');
  if (process.env.PROD_DATABASE_URL) fail('PROD_DATABASE_URL must be absent.');
  let parsed;
  try { parsed = new URL(process.env.DEV_DATABASE_URL); } catch { fail('DEV_DATABASE_URL is not a valid URL.'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) fail('DEV_DATABASE_URL must use PostgreSQL.');
  if (!isSupportedSupabaseHostname(parsed.hostname)) fail('DEV_DATABASE_URL must target a supported Supabase PostgreSQL host.');
  if (!/^postgres(?:\.[a-z0-9-]+)?$/i.test(decodeURIComponent(parsed.username || ''))) {
    fail('DEV_DATABASE_URL must use the expected Supabase postgres user format.');
  }
};

const translateSql = (sql, { ignoreInsertConflicts = true } = {}) => {
  let translated = String(sql)
    .replace(/\bdatetime\('now',\s*'-1 day'\)/gi, `(CURRENT_TIMESTAMP - INTERVAL '1 day')`)
    .replace(/\bdatetime\('now',\s*'-3 days'\)/gi, `(CURRENT_TIMESTAMP - INTERVAL '3 days')`)
    .replace(/\bdatetime\(([^)]+)\)/gi, '$1')
    .replace(/\bCOLLATE\s+NOCASE\b/gi, '')
    .replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, 'INSERT INTO');
  if (ignoreInsertConflicts && /INSERT\s+INTO/i.test(translated) && !/ON\s+CONFLICT/i.test(translated)) {
    translated += ' ON CONFLICT DO NOTHING';
  }
  return translated.replace(/\?/g, (_, offset, source) => `$${(source.slice(0, offset).match(/\?/g) || []).length + 1}`);
};

const createTransactionAdapter = (client) => {
  const tx = {
    query: (sql, params = []) => client.query(translateSql(sql), params),
    get: async (sql, params = []) => (await client.query(translateSql(sql), params)).rows[0],
    all: async (sql, params = []) => (await client.query(translateSql(sql), params)).rows,
    run: async (sql, params = []) => {
      const result = await client.query(translateSql(sql), params);
      return { changes: result.rowCount, lastID: result.rows[0]?.id };
    },
    runStrict: async (sql, params = []) => {
      const result = await client.query(translateSql(sql, { ignoreInsertConflicts: false }), params);
      return { changes: result.rowCount, lastID: result.rows[0]?.id };
    },
    withTransaction: async (callback) => callback(tx),
  };
  return tx;
};

const createRepository = (client) => {
  const root = createTransactionAdapter(client);
  return {
    query: root.query,
    get: root.get,
    all: root.all,
    run: root.run,
    runStrict: root.runStrict,
    withTransaction: async (callback) => {
      await client.query('BEGIN');
      try {
        const result = await callback(createTransactionAdapter(client));
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      }
    },
  };
};

const connectClient = async () => {
  const client = new Client({ connectionString: process.env.DEV_DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  operationalClients.add(client);
  return client;
};

const closeClient = async (client) => {
  if (!client) return;
  operationalClients.delete(client);
  await client.end().catch(() => undefined);
};

const tableExists = async (client, table) => {
  const row = await client.query(`SELECT to_regclass($1) AS name`, [`public.${table}`]);
  return Boolean(row.rows[0]?.name);
};

const columnExists = async (client, table, column) => {
  const row = await client.query(`SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`, [table, column]);
  return row.rowCount === 1;
};

const structuralPreflight = async (client) => {
  const required = {
    orders: ['id', 'ordernumber', 'checkoutidempotencykey', 'userid', 'customerid', 'status', 'total', 'subtotal', 'shippingtotal', 'discounttotal', 'shippingaddress', 'createdat'],
    products: ['id', 'name', 'price', 'cost', 'stock', 'soldcount', 'status'],
    order_items: ['id', 'orderid', 'productid', 'productname', 'quantity', 'unitprice', 'unitcost'],
    customers: ['id', 'authuserid', 'email', 'firstname', 'lastname', 'phone', 'phonenormalized', 'ordercount', 'totalpurchased', 'firstpurchaseat', 'lastpurchaseat'],
    auth_users: ['id', 'email', 'passwordhash', 'firstname', 'lastname', 'phone', 'isactive'],
    public_settings: ['key', 'value'],
    stock_reservations: ['id', 'orderid', 'status', 'idempotencykey', 'expiresat'],
    stock_reservation_items: ['id', 'reservationid', 'productid', 'quantity'],
    payments: ['id', 'orderid', 'provider', 'status', 'amount', 'currency', 'idempotencykey'],
    payment_events: ['id', 'provider', 'processingstatus'],
    inventory_movements: ['id', 'productid', 'quantity', 'type', 'stockbefore', 'stockafter', 'reference', 'orderid'],
    email_outbox: ['id', 'eventtype', 'orderid', 'recipientemail', 'payload', 'idempotencykey'],
  };
  for (const [table, columns] of Object.entries(required)) {
    assert(await tableExists(client, table), `Required table public.${table} is missing.`);
    for (const column of columns) assert(await columnExists(client, table, column), `Required column public.${table}.${column} is missing.`);
  }
  const checkoutIndex = await client.query(`
    SELECT indexdef FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'orders'
      AND indexname = 'orders_checkout_idempotency_unique'`);
  assert(checkoutIndex.rowCount === 1 && /UNIQUE/i.test(checkoutIndex.rows[0].indexdef) && /checkoutidempotencykey\s+IS\s+NOT\s+NULL/i.test(checkoutIndex.rows[0].indexdef), 'The checkout idempotency partial unique index is missing or incorrect.');
  const movementIndex = await client.query(`SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'inventory_movements' AND indexname = 'inventory_movements_reference_unique'`);
  assert(movementIndex.rowCount === 1 && /UNIQUE/i.test(movementIndex.rows[0].indexdef) && /reference\s+IS\s+NOT\s+NULL/i.test(movementIndex.rows[0].indexdef), 'The inventory movement reference unique index is missing or incorrect.');
  for (const table of PRIVATE_TABLES) {
    const rel = await client.query(`SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass($1)`, [`public.${table}`]);
    if (!rel.rowCount) continue;
    assert(rel.rows[0].relrowsecurity === true, `RLS is not enabled on public.${table}.`);
    const grants = await client.query(`SELECT grantee FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name = $1 AND grantee IN ('anon', 'authenticated') AND privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE')`, [table]);
    assert(grants.rowCount === 0, `anon/authenticated table grants remain on public.${table}.`);
  }
};

const staleFixtureGuard = async (client) => {
  const found = [];
  for (const [table, columns] of Object.entries(STALE_COLUMNS)) {
    if (!await tableExists(client, table)) continue;
    const predicates = columns.map((column) => `CAST(${column} AS TEXT) LIKE $1`).join(' OR ');
    const rows = await client.query(`SELECT id::text AS id FROM public.${table} WHERE ${predicates} LIMIT 25`, [`${PREFIX}%`]);
    if (rows.rowCount) found.push({ table, ids: rows.rows.map((row) => row.id).filter(Boolean) });
  }
  if (found.length) fail(`Stale atomic-checkout fixtures exist: ${JSON.stringify(found)}`);
};

const track = (table, value) => { if (value) sets.get(table)?.add(String(value)); };
const trackOrderGraph = async (client, orderId) => {
  track('orders', orderId);
  const queries = [
    ['order_items', `SELECT id FROM order_items WHERE orderid = $1`],
    ['stock_reservations', `SELECT id FROM stock_reservations WHERE orderid = $1`],
    ['payments', `SELECT id FROM payments WHERE orderid = $1`],
    ['email_outbox', `SELECT id FROM email_outbox WHERE orderid = $1`],
    ['inventory_movements', `SELECT id FROM inventory_movements WHERE orderid = $1`],
  ];
  for (const [table, sql] of queries) {
    const rows = await client.query(sql, [orderId]);
    rows.rows.forEach((row) => track(table, row.id));
  }
  const reservations = await client.query(`SELECT id FROM stock_reservations WHERE orderid = $1`, [orderId]);
  for (const row of reservations.rows) {
    track('stock_reservations', row.id);
    const items = await client.query(`SELECT id FROM stock_reservation_items WHERE reservationid = $1`, [row.id]);
    items.rows.forEach((item) => track('stock_reservation_items', item.id));
  }
  const payments = await client.query(`SELECT id FROM payments WHERE orderid = $1`, [orderId]);
  for (const row of payments.rows) {
    track('payments', row.id);
    const events = await client.query(`SELECT id FROM payment_events WHERE paymentid = $1`, [row.id]);
    events.rows.forEach((event) => track('payment_events', event.id));
  }
};

const hydrateCurrentRunFixtureIds = async (client) => {
  // Cleanup runs only for this execution's exact run marker. This is not the
  // stale-fixture guard and never broadens deletion to the namespace.
  for (const [table, columns] of Object.entries(STALE_COLUMNS)) {
    if (!await tableExists(client, table)) continue;
    const predicates = columns.map((column) => `CAST(${column} AS TEXT) LIKE $1`).join(' OR ');
    const rows = await client.query(`SELECT id::text AS id FROM public.${table} WHERE ${predicates}`, [`${runId}%`]);
    rows.rows.forEach((row) => track(table, row.id));
  }
  for (const orderId of [...sets.get('orders')]) await trackOrderGraph(client, orderId);
  for (const userId of [...sets.get('auth_users')]) {
    for (const [table, column] of [['account_addresses', 'userid'], ['auth_sessions', 'userid']]) {
      if (!await tableExists(client, table)) continue;
      const rows = await client.query(`SELECT id FROM ${table} WHERE ${column} = $1`, [userId]);
      rows.rows.forEach((row) => track(table, row.id));
    }
  }
};

const insertProduct = async (repo, label, stock, price = '100.00') => {
  const productId = id(`product-${label}`);
  await repo.withTransaction(async (tx) => {
    await tx.run(`INSERT INTO products (id, brand, name, slug, category, description, sku, price, cost, stock, status, soldcount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [productId, 'R12 Synthetic', `${PREFIX}${label}`, `${productId}-slug`, 'skincare', 'Synthetic validation product', `${productId}-sku`, price, '10.00', stock, 'active', 0]);
  });
  track('products', productId);
  return productId;
};

const insertAuthUser = async (repo, label) => {
  const userId = id(`auth-${label}`);
  await repo.withTransaction(async (tx) => {
    await tx.run(`INSERT INTO auth_users (id, email, passwordhash, firstname, lastname, phone, phonenormalized, isactive) VALUES (?, ?, ?, ?, ?, ?, ?, 1)`, [userId, email(`auth-${label}`), 'synthetic-not-a-login-secret', 'R12', 'Validation', '3000000000', '3000000000']);
  });
  track('auth_users', userId);
  return userId;
};

const checkoutPayload = ({ label, productId, checkoutKey, reference, quantity = 1, emailLabel, includeKey = true, clientPrice }) => ({
  reference: reference || orderReference(label),
  ...(includeKey ? { checkoutIdempotencyKey: checkoutKey || key(label) } : {}),
  customer: { email: email(emailLabel || label), firstName: 'R12', lastName: 'Validation', phone: '3000000000' },
  shippingAddress: { addressLine1: `${PREFIX}${label}`, city: 'Medellín', department: 'Antioquia', country: 'Colombia' },
  items: [{ productId, quantity, ...(clientPrice === undefined ? {} : { price: clientPrice, unitPrice: clientPrice }) }],
});

const createOrderWithDiagnostics = async ({ client, scenario, payload, userId = null, repository, checkoutKeyLabel }) => {
  const existing = await one(client, `SELECT id, checkoutidempotencykey FROM orders WHERE id = $1`, [payload.reference]);
  try {
    return await createOrder({ payload, userId, repository });
  } catch (error) {
    const keyMatch = existing ? existing.checkoutidempotencykey === payload.checkoutIdempotencyKey : null;
    throw new Error(`${scenario} failed: intendedOrderId=${payload.reference}; preexistingOrder=${existing ? 'yes' : 'no'}; existingCheckoutKeyMatch=${keyMatch === null ? 'n/a' : keyMatch ? 'yes' : 'no'}; checkoutKeyLabel=${checkoutKeyLabel}; cause=${safeError(error).message}`);
  }
};

const directRows = async (client, sql, params = []) => (await client.query(sql, params)).rows;
const one = async (client, sql, params = []) => (await client.query(sql, params)).rows[0];
const expectError = async (promise, matcher, label) => {
  try { await promise; fail(`${label} unexpectedly succeeded.`); } catch (error) {
    if (error.message === `${label} unexpectedly succeeded.`) throw error;
    if (matcher && !matcher(error)) throw new Error(`${label} failed for an unexpected reason: ${JSON.stringify(safeError(error))}`);
    return error;
  }
};

const assertCheckout = async (client, result, expected, { userId = null } = {}) => {
  const order = await one(client, `SELECT id, userid, status, checkoutidempotencykey, total, subtotal, shippingtotal, createdat FROM orders WHERE id = $1`, [result.id]);
  assert(order, `Order ${result.id} is missing.`);
  assert(order.status === 'Pendiente', 'Checkout order status is not Pendiente.');
  assert(order.userid === userId, 'Checkout user association is incorrect.');
  if (expected.key) assert(order.checkoutidempotencykey === expected.key, 'Checkout idempotency key was not persisted.');
  const items = await directRows(client, `SELECT productid, quantity, unitprice FROM order_items WHERE orderid = $1`, [result.id]);
  assert(items.length === 1 && items[0].productid === expected.productId && Number(items[0].quantity) === expected.quantity, 'Order item does not match the fixture.');
  assert(Number(items[0].unitprice) === Number(expected.price), 'Order item price is not canonical.');
  const reservation = await one(client, `SELECT id, status, expiresat FROM stock_reservations WHERE orderid = $1`, [result.id]);
  assert(reservation && reservation.status === 'ACTIVE', 'Checkout reservation is not ACTIVE.');
  const reservationItems = await directRows(client, `SELECT productid, quantity FROM stock_reservation_items WHERE reservationid = $1`, [reservation.id]);
  assert(reservationItems.length === 1 && reservationItems[0].productid === expected.productId && Number(reservationItems[0].quantity) === expected.quantity, 'Reservation items are incorrect.');
  const expiryDelta = new Date(reservation.expiresat).getTime() - new Date(order.createdat || Date.now()).getTime();
  assert(expiryDelta > 29 * 60 * 1000 && expiryDelta < 31 * 60 * 1000, 'Reservation expiry is not approximately 30 minutes.');
  const payment = await one(client, `SELECT id, status, provider, amount, currency, idempotencykey FROM payments WHERE orderid = $1`, [result.id]);
  assert(payment && payment.status === 'CREATED' && payment.provider === 'INTERNAL_CHECKOUT' && payment.currency === 'COP', 'Initial payment is incorrect.');
  assert(String(payment.amount) === String(Math.round(Number(order.total) * 100)), 'Payment amount is not canonical cents.');
  const movement = await one(client, `SELECT id, quantity, stockbefore, stockafter, type, reference FROM inventory_movements WHERE orderid = $1 AND type = 'reservation'`, [result.id]);
  assert(movement && Number(movement.quantity) === -expected.quantity && Number(movement.stockafter) === Number(movement.stockbefore) - expected.quantity, 'Reservation movement is incorrect.');
  assert(movement.reference === `reservation/${reservation.id}/${expected.productId}`, 'Reservation movement reference is incorrect.');
  const saleCount = await one(client, `SELECT COUNT(*)::int AS count FROM inventory_movements WHERE orderid = $1 AND type = 'sale'`, [result.id]);
  assert(Number(saleCount.count) === 0, 'Initial checkout created a sale movement.');
  await trackOrderGraph(client, result.id);
  return { order, reservation, payment, movement };
};

const assertCustomerMetrics = async (client, customerEmail) => {
  const customer = await one(client, `SELECT id, ordercount, totalpurchased, firstpurchaseat, lastpurchaseat FROM customers WHERE email = $1`, [customerEmail]);
  assert(customer && Number(customer.ordercount) === 0 && Number(customer.totalpurchased) === 0 && !customer.firstpurchaseat && !customer.lastpurchaseat, 'Customer purchase metrics changed during initial checkout.');
  track('customers', customer.id);
  return customer;
};

const trackCustomerByEmail = async (client, customerEmail) => {
  const customer = await one(client, `SELECT id FROM customers WHERE email = $1`, [customerEmail]);
  if (customer) track('customers', customer.id);
  return customer;
};

const assertOutboxCount = async (client, orderId, expected) => {
  const row = await one(client, `SELECT COUNT(*)::int AS count FROM email_outbox WHERE orderid = $1 AND eventtype = 'order_received'`, [orderId]);
  assert(Number(row.count) === expected, `Expected ${expected} order_received outbox row(s), found ${row.count}.`);
  const rows = await directRows(client, `SELECT id FROM email_outbox WHERE orderid = $1`, [orderId]);
  rows.forEach((item) => track('email_outbox', item.id));
};

const readCheckoutResidue = async (client, orderId) => {
  const countFor = async (table, column) => Number((await one(client, `SELECT COUNT(*)::int AS count FROM ${table} WHERE ${column} = $1`, [orderId])).count);
  const reservationItems = await one(client, `SELECT COUNT(*)::int AS count
    FROM stock_reservation_items sri
    JOIN stock_reservations sr ON sr.id = sri.reservationid
    WHERE sr.orderid = $1`, [orderId]);
  const movements = await one(client, `SELECT
    COUNT(*) FILTER (WHERE type = 'reservation')::int AS reservationcount,
    COUNT(*) FILTER (WHERE type = 'sale')::int AS salecount
    FROM inventory_movements WHERE orderid = $1`, [orderId]);
  return {
    orders: await countFor('orders', 'id'),
    orderItems: await countFor('order_items', 'orderid'),
    reservations: await countFor('stock_reservations', 'orderid'),
    reservationItems: Number(reservationItems.count),
    payments: await countFor('payments', 'orderid'),
    reservationMovements: Number(movements.reservationcount),
    saleMovements: Number(movements.salecount),
    outbox: await countFor('email_outbox', 'orderid'),
  };
};

const assertNoCheckoutResidue = async (client, orderId) => {
  const residue = await readCheckoutResidue(client, orderId);
  const remaining = Object.entries(residue).filter(([, count]) => count !== 0);
  assert(remaining.length === 0, `Checkout residue remains for failed checkout ${orderId}: ${JSON.stringify(residue)}`);
};

const createPreconditionPayment = async (repo, { orderId, productId, checkoutKey }) => {
  await repo.withTransaction(async (tx) => {
    await tx.run(`INSERT INTO orders (id, ordernumber, userId, customerId, status, total, subtotal, shippingtotal, discounttotal, shippingaddress, createdat) VALUES (?, ?, NULL, NULL, 'Pendiente', ?, ?, 0, 0, ?, CURRENT_TIMESTAMP)`, [orderId, orderNumber('payment-collision'), '1.00', '1.00', JSON.stringify({ addressLine1: 'synthetic', city: 'Medellín', department: 'Antioquia' })]);
    await tx.run(`INSERT INTO payments (id, orderid, provider, status, amount, currency, idempotencykey, expiresat) VALUES (?, ?, 'INTERNAL_CHECKOUT', 'CREATED', ?, 'COP', ?, ?)` , [id('payment-collision'), orderId, '1', `checkout-payment/${checkoutKey}`, isoInMinutes(30)]);
  });
  track('orders', orderId);
  track('payments', id('payment-collision'));
};

const createCollisionMovement = async (repo, { productId, reference, orderId, quantity = 0, type = 'sale' }) => {
  const movementId = id(`collision-${crypto.randomBytes(4).toString('hex')}`);
  await repo.withTransaction(async (tx) => {
    await tx.runStrict(`INSERT INTO inventory_movements (id, productid, quantity, type, description, stockbefore, stockafter, reason, reference, orderid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [movementId, productId, quantity, type, 'Synthetic collision prerequisite', 0, 0, 'Validator prerequisite', reference, orderId]);
  });
  track('inventory_movements', movementId);
  return movementId;
};

const scenarioSuccess = async (repo, client, label, productId, userId = null, initialStock = 1) => {
  const checkoutKey = key(label);
  const customerEmail = email(label);
  const payload = checkoutPayload({ label, productId, checkoutKey, emailLabel: label });
  const result = await createOrderWithDiagnostics({ client, scenario: `Scenario ${label}`, payload, userId, repository: repo, checkoutKeyLabel: label });
  const details = await assertCheckout(client, result, { key: checkoutKey, productId, quantity: 1, price: '100.00' }, { userId });
  const product = await one(client, `SELECT stock, soldcount FROM products WHERE id = $1`, [productId]);
  const expectedStock = initialStock - 1;
  const actualStock = Number(product.stock);
  const actualSoldCount = Number(product.soldcount);
  assert(actualStock === expectedStock && actualSoldCount === 0, `${label} product inventory semantics are incorrect: expected stock=${expectedStock}, actual stock=${actualStock}, expected soldCount=0, actual soldCount=${actualSoldCount}.`);
  await assertCustomerMetrics(client, customerEmail);
  await assertOutboxCount(client, result.id, 1);
  return { result, details, checkoutKey, customerEmail };
};

const scenarioPaymentFailure = async (repo, client, productId) => {
  const label = 'payment-failure';
  const checkoutKey = key(label);
  const collisionOrderId = orderReference('payment-collision-order');
  await createPreconditionPayment(repo, { orderId: collisionOrderId, productId, checkoutKey });
  const orderId = orderReference(label);
  const baseline = await one(client, `SELECT stock, soldcount FROM products WHERE id = $1`, [productId]);
  const stockBefore = Number(baseline.stock);
  const soldCountBefore = Number(baseline.soldcount);
  const operationClient = await connectClient();
  let error;
  try {
    const operationRepository = createRepository(operationClient);
    error = await expectError(createOrder({ payload: checkoutPayload({ label, productId, checkoutKey, reference: orderId, emailLabel: label }), repository: operationRepository }), (value) => value.status === 409 && /idempotencia|intento/i.test(value.message), 'Payment-layer collision rollback');
  } finally {
    await closeClient(operationClient);
  }
  // The existing Payment INSERT uses ON CONFLICT DO NOTHING intentionally.
  // This is a real post-reservation domain failure, not a fabricated 23505.
  const observation = await connectClient();
  try {
    const residue = await readCheckoutResidue(observation, orderId);
    const product = await one(observation, `SELECT stock, soldcount FROM products WHERE id = $1`, [productId]);
    const observationState = {
      ...residue,
      stock: Number(product.stock),
      soldCount: Number(product.soldcount),
      stockBefore,
      soldCountBefore,
    };
    const residueFields = Object.keys(residue).filter((field) => residue[field] !== 0);
    assert(residueFields.length === 0
      && observationState.stock === observationState.stockBefore
      && observationState.soldCount === observationState.soldCountBefore,
    `Payment-layer rollback invariants failed: ${JSON.stringify(observationState)}`);
  } finally {
    await closeClient(observation);
  }
  return error;
};

const scenarioReservationFailure = async (repo, client, productId) => {
  const label = 'reservation-failure';
  await repo.withTransaction(async (tx) => { await tx.run(`UPDATE products SET stock = 0 WHERE id = ?`, [productId]); });
  const orderId = orderReference(label);
  await expectError(createOrder({ payload: checkoutPayload({ label, productId, reference: orderId }), repository: repo }), (value) => value.status === 409 && /stock|disponible/i.test(value.message), 'Reservation failure rollback');
  await assertNoCheckoutResidue(client, orderId);
  const product = await one(client, `SELECT stock FROM products WHERE id = $1`, [productId]);
  assert(Number(product.stock) === 0, 'Reservation failure changed stock.');
};

const scenarioInvalidKeys = async (repo, client, productId) => {
  for (const [label, value] of [['wrong-type', 42], ['empty', ''], ['too-long', 'x'.repeat(201)], ['spaces', 'bad key']]) {
    const orderId = orderReference(`invalid-${label}`);
    await expectError(createOrder({ payload: { ...checkoutPayload({ label, productId, reference: orderId }), checkoutIdempotencyKey: value }, repository: repo }), (error) => error.status === 400 && /idempotencia/i.test(error.message), `Invalid key ${label}`);
    const row = await one(client, `SELECT COUNT(*)::int AS count FROM orders WHERE id = $1`, [orderId]);
    assert(Number(row.count) === 0, `Invalid key ${label} created durable Order state.`);
  }
};

const scenarioStrictLifecycleCollision = async (repo, client, productId, kind) => {
  const label = `strict-${kind}`;
  const successful = await scenarioSuccess(repo, client, label, productId, null, 4);
  const reservation = successful.details.reservation;
  const reference = kind === 'commit'
    ? `sale/${successful.result.id}/${productId}`
    : `reservation-release/${reservation.id}/${productId}`;
  await createCollisionMovement(repo, { productId, reference, orderId: successful.result.id, type: kind === 'commit' ? 'sale' : 'reservation_release' });
  const before = await one(client, `SELECT stock, soldcount FROM products WHERE id = $1`, [productId]);
  if (kind === 'commit') {
    await expectError(commitReservationSale({ reservationId: reservation.id }, repo), (error) => error.code === '23505', 'Strict commit collision');
  } else if (kind === 'release') {
    await expectError(releaseReservation({ reservationId: reservation.id }, repo), (error) => error.code === '23505', 'Strict release collision');
  } else {
    await expectError(expireReservation({ reservationId: reservation.id, now: new Date(Date.now() + 60 * 60 * 1000) }, repo), (error) => error.code === '23505', 'Strict expiration collision');
  }
  const after = await one(client, `SELECT stock, soldcount FROM products WHERE id = $1`, [productId]);
  const current = await one(client, `SELECT status FROM stock_reservations WHERE id = $1`, [reservation.id]);
  assert(Number(after.stock) === Number(before.stock) && Number(after.soldcount) === Number(before.soldcount) && current.status === 'ACTIVE', `${kind} collision did not roll back completely.`);
};

const runScenarios = async (repo, client) => {
  setScenario('A authenticated successful checkout');
  const authUserId = await insertAuthUser(repo, 'authenticated');
  const authProduct = await insertProduct(repo, 'authenticated', 2);
  const authenticated = await scenarioSuccess(repo, client, 'authenticated', authProduct, authUserId, 2);
  assert(authenticated.result.paymentStatus === 'CREATED', 'Authenticated checkout did not create CREATED payment.');

  setScenario('B guest successful checkout');
  const guestProduct = await insertProduct(repo, 'guest', 2);
  const guest = await scenarioSuccess(repo, client, 'guest', guestProduct, null, 2);
  assert(guest.result.id, 'Guest checkout did not return an Order.');

  setScenario('C sequential same-key replay');
  const replayProduct = await insertProduct(repo, 'sequential-replay', 2);
  const replayKey = key('sequential-replay');
  const replayPayload = checkoutPayload({ label: 'sequential-replay', productId: replayProduct, checkoutKey: replayKey });
  const first = await createOrder({ payload: replayPayload, repository: repo });
  const firstDetails = await assertCheckout(client, first, { key: replayKey, productId: replayProduct, quantity: 1, price: '100.00' });
  const firstExpiry = firstDetails.reservation.expiresat;
  const second = await createOrder({ payload: replayPayload, repository: repo });
  assert(second.id === first.id && second.reservationId === first.reservationId && second.paymentId === first.paymentId, 'Sequential replay returned a different checkout.');
  const replayReservation = await one(client, `SELECT expiresat FROM stock_reservations WHERE orderid = $1`, [first.id]);
  assert(new Date(replayReservation.expiresat).getTime() === new Date(firstExpiry).getTime(), 'Sequential replay reset reservation expiry.');
  await assertCustomerMetrics(client, email('sequential-replay'));
  await assertOutboxCount(client, first.id, 1);
  await trackOrderGraph(client, first.id);

  setScenario('D concurrent same-key replay');
  const concurrentProduct = await insertProduct(repo, 'concurrent-replay', 2);
  const concurrentKey = key('concurrent-replay');
  // Keep request objects independent. They represent the same logical
  // checkout, but sharing a mutable payload between concurrent calls can
  // obscure result-extraction bugs and is not representative of two requests.
  const makeConcurrentPayload = () => checkoutPayload({ label: 'concurrent-replay', productId: concurrentProduct, checkoutKey: concurrentKey });
  const c1 = await connectClient();
  const c2 = await connectClient();
  try {
    const r1 = createOrder({ payload: makeConcurrentPayload(), repository: createRepository(c1) });
    const r2 = createOrder({ payload: makeConcurrentPayload(), repository: createRepository(c2) });
    const [concurrentA, concurrentB] = await Promise.all([r1, r2]);
    const sameLogicalCheckout = concurrentA.id === concurrentB.id
      && concurrentA.reservationId === concurrentB.reservationId
      && concurrentA.paymentId === concurrentB.paymentId;
    const persistedOrders = await directRows(client, `SELECT id, checkoutidempotencykey FROM orders WHERE checkoutidempotencykey = $1`, [concurrentKey]);
    const persistedOrderId = persistedOrders[0]?.id || concurrentA?.id || concurrentB?.id || null;
    const persistedReservations = await directRows(client, `SELECT id, orderid, status FROM stock_reservations WHERE orderid = $1`, [persistedOrderId]);
    const persistedPayments = await directRows(client, `SELECT id, orderid, status, idempotencykey FROM payments WHERE orderid = $1`, [persistedOrderId]);
    const persistedMovements = await directRows(client, `SELECT id, quantity, type, reference FROM inventory_movements WHERE orderid = $1 AND productid = $2`, [persistedOrderId, concurrentProduct]);
    const persistedProduct = await one(client, `SELECT stock, soldcount FROM products WHERE id = $1`, [concurrentProduct]);
    const persistedOutbox = await one(client, `SELECT COUNT(*)::int AS count FROM email_outbox WHERE orderid = $1 AND eventtype = 'order_received'`, [persistedOrderId]);
    const persistedSaleMovements = await one(client, `SELECT COUNT(*)::int AS count FROM inventory_movements WHERE orderid = $1 AND productid = $2 AND type = 'sale'`, [persistedOrderId, concurrentProduct]);
    const diagnostics = {
      ordersForCheckoutKey: persistedOrders.length,
      persistedOrderId,
      reservationsForOrder: persistedReservations.length,
      paymentsForOrder: persistedPayments.length,
      reservationMovements: persistedMovements.filter((row) => row.type === 'reservation').length,
      saleMovements: Number(persistedSaleMovements?.count || 0),
      stock: persistedProduct?.stock ?? null,
      soldCount: persistedProduct?.soldcount ?? null,
      outboxCount: Number(persistedOutbox?.count || 0),
    };
    const invariantFailures = [];
    if (!sameLogicalCheckout) invariantFailures.push('D1/D2 return IDs differ');
    if (persistedOrders.length !== 1) invariantFailures.push(`ordersForCheckoutKey=${persistedOrders.length}`);
    if (persistedReservations.length !== 1 || persistedReservations[0].status !== 'ACTIVE') invariantFailures.push('reservation cardinality/status');
    if (persistedPayments.length !== 1 || persistedPayments[0].status !== 'CREATED') invariantFailures.push('payment cardinality/status');
    if (diagnostics.reservationMovements !== 1 || Number(persistedMovements.find((row) => row.type === 'reservation')?.quantity) !== -1) invariantFailures.push('reservation movement');
    if (Number(persistedProduct?.stock) !== 1 || Number(persistedProduct?.soldcount) !== 0) invariantFailures.push('stock/soldCount');
    if (diagnostics.saleMovements !== 0) invariantFailures.push('sale movement');
    if (diagnostics.outboxCount !== 1) invariantFailures.push('outbox cardinality');
    assert(invariantFailures.length === 0, `Concurrent replay invariants failed: ${JSON.stringify({ ...diagnostics, invariantFailures })}`);
    await trackOrderGraph(client, concurrentA.id);
    await trackCustomerByEmail(client, email('concurrent-replay'));
    await assertOutboxCount(client, concurrentA.id, 1);
  } finally { await closeClient(c1); await closeClient(c2); }

  setScenario('E final-unit competition');
  const competitionProduct = await insertProduct(repo, 'final-unit', 1);
  const competitionPayloadA = checkoutPayload({ label: 'final-unit-a', productId: competitionProduct, checkoutKey: key('final-unit-a'), emailLabel: 'final-unit-a' });
  const competitionPayloadB = checkoutPayload({ label: 'final-unit-b', productId: competitionProduct, checkoutKey: key('final-unit-b'), emailLabel: 'final-unit-b' });
  assert(competitionPayloadA.items[0].productId === competitionPayloadB.items[0].productId, 'Final-unit checkouts do not share the same Product.');
  const e1 = await connectClient();
  const e2 = await connectClient();
  let competitionResults;
  try {
    competitionResults = await Promise.allSettled([
      createOrder({ payload: competitionPayloadA, repository: createRepository(e1) }),
      createOrder({ payload: competitionPayloadB, repository: createRepository(e2) }),
    ]);
  } finally { await closeClient(e1); await closeClient(e2); }
  assert(competitionResults.filter((item) => item.status === 'fulfilled').length === 1, 'Final-unit competition did not have exactly one winner.');
  assert(competitionResults.filter((item) => item.status === 'rejected').length === 1, 'Final-unit competition did not have exactly one loser.');
  const loser = competitionResults.find((item) => item.status === 'rejected').reason;
  assert(loser.status === 409 && /stock|disponible/i.test(loser.message), `Final-unit loser failed for an unexpected reason: ${JSON.stringify(safeError(loser))}`);
  const finalProduct = await one(client, `SELECT stock, soldcount FROM products WHERE id = $1`, [competitionProduct]);
  assert(Number(finalProduct.stock) === 0 && Number(finalProduct.stock) >= 0, 'Final-unit competition left invalid stock.');
  const winning = competitionResults.find((item) => item.status === 'fulfilled').value;
  await trackOrderGraph(client, winning.id);
  await trackCustomerByEmail(client, email(competitionResults[0].status === 'fulfilled' ? 'final-unit-a' : 'final-unit-b'));
  const loserOrder = competitionResults.find((item) => item.status === 'rejected') ? (competitionResults[0].status === 'rejected' ? competitionPayloadA.reference : competitionPayloadB.reference) : null;
  if (loserOrder) {
    const residue = await one(client, `SELECT COUNT(*)::int AS count FROM orders WHERE id = $1`, [loserOrder]);
    assert(Number(residue.count) === 0, 'Final-unit loser left an Order residue.');
  }

  setScenario('F payment-layer rollback');
  const paymentFailureProduct = await insertProduct(repo, 'payment-failure', 1);
  await scenarioPaymentFailure(repo, client, paymentFailureProduct);
  setScenario('G reservation failure rollback');
  const reservationFailureProduct = await insertProduct(repo, 'reservation-failure', 0);
  await scenarioReservationFailure(repo, client, reservationFailureProduct);

  setScenario('H canonical price');
  const priceProduct = await insertProduct(repo, 'canonical-price', 1, '123.45');
  const priceResult = await createOrder({ payload: checkoutPayload({ label: 'canonical-price', productId: priceProduct, checkoutKey: key('canonical-price'), clientPrice: '0.01' }), repository: repo });
  await assertCheckout(client, priceResult, { key: key('canonical-price'), productId: priceProduct, quantity: 1, price: '123.45' });
  await assertCustomerMetrics(client, email('canonical-price'));

  setScenario('I missing checkout idempotency key');
  const noKeyProduct = await insertProduct(repo, 'missing-key', 1);
  const noKeyResult = await createOrder({ payload: checkoutPayload({ label: 'missing-key', productId: noKeyProduct, includeKey: false }), repository: repo });
  await assertCheckout(client, noKeyResult, { productId: noKeyProduct, quantity: 1, price: '100.00' });
  await assertCustomerMetrics(client, email('missing-key'));
  console.log('MISSING-KEY PATH IS NOT STRONGLY DUPLICATE-SUBMIT PROTECTED.');

  setScenario('J invalid checkout idempotency key');
  const invalidProduct = await insertProduct(repo, 'invalid-key', 1);
  await scenarioInvalidKeys(repo, client, invalidProduct);

  setScenario('K strict commit movement collision');
  const lifecycleProduct = await insertProduct(repo, 'strict-lifecycle', 4);
  await scenarioStrictLifecycleCollision(repo, client, lifecycleProduct, 'commit');
  setScenario('L strict release movement collision');
  const lifecycleReleaseProduct = await insertProduct(repo, 'strict-release', 4);
  await scenarioStrictLifecycleCollision(repo, client, lifecycleReleaseProduct, 'release');
  setScenario('M strict expiration movement collision');
  const lifecycleExpireProduct = await insertProduct(repo, 'strict-expire', 4);
  await scenarioStrictLifecycleCollision(repo, client, lifecycleExpireProduct, 'expire');
};

const cleanup = async () => {
  if (cleanupStarted) return;
  cleanupStarted = true;
  const client = await connectClient();
  const repo = createRepository(client);
  try {
    await hydrateCurrentRunFixtureIds(client);
    await repo.withTransaction(async (tx) => {
      const deleteByIds = async (table, column) => {
        const values = [...(sets.get(table) || [])];
        if (values.length) await tx.run(`DELETE FROM ${table} WHERE ${column} = ANY(?)`, [values]);
      };
      await deleteByIds('payment_events', 'id');
      await deleteByIds('payments', 'id');
      await deleteByIds('email_outbox', 'id');
      await deleteByIds('stock_reservation_items', 'id');
      await deleteByIds('stock_reservations', 'id');
      await deleteByIds('inventory_movements', 'id');
      await deleteByIds('order_items', 'id');
      await deleteByIds('abandoned_carts', 'id');
      await deleteByIds('account_addresses', 'id');
      await deleteByIds('orders', 'id');
      await deleteByIds('customers', 'id');
      await deleteByIds('auth_sessions', 'id');
      await deleteByIds('auth_users', 'id');
      await deleteByIds('products', 'id');
    });
  } finally { await closeClient(client); }
};

const verifyCleanup = async () => {
  const client = await connectClient();
  const counts = {};
  try {
    for (const [table, values] of sets.entries()) {
      const ids = [...values];
      if (!ids.length) { counts[table] = 0; continue; }
      const result = await client.query(`SELECT COUNT(*)::int AS count FROM ${table} WHERE id = ANY($1::text[])`, [ids]);
      counts[table] = Number(result.rows[0].count);
    }
  } finally { await closeClient(client); }
  const remaining = Object.entries(counts).filter(([, count]) => count !== 0);
  if (remaining.length) fail(`Current-run fixture cleanup failed: ${JSON.stringify(remaining)}`);
  return counts;
};

const installSignalHandlers = () => {
  const handler = async (signal) => {
    if (signalHandling) return;
    signalHandling = true;
    console.error(`Received ${signal}; attempting exact-fixture cleanup.`);
    try { await cleanup(); await verifyCleanup(); } catch (error) { console.error(`Cleanup failed: ${safeError(error).message}`); }
    for (const client of [...operationalClients]) await closeClient(client);
    process.exitCode = 130;
  };
  process.once('SIGINT', handler);
  process.once('SIGTERM', handler);
};

const main = async () => {
  validateEnvironment();
  const client = await connectClient();
  installSignalHandlers();
  try {
    await structuralPreflight(client);
    await staleFixtureGuard(client);
    mutationStarted = true;
    const repo = createRepository(client);
    await runScenarios(repo, client);
    console.log('R12 atomic checkout DEV validation scenarios completed.');
  } catch (error) {
    console.error(`R12 atomic checkout validation failed [${activeScenario}]: ${safeError(error).message}`);
    process.exitCode = 1;
  } finally {
    await closeClient(client);
    if (!mutationStarted) return;
    try {
      await cleanup();
      const counts = await verifyCleanup();
      console.log(`R12 atomic checkout fixture cleanup verified: ${JSON.stringify(counts)}`);
    } catch (error) {
      console.error(`R12 atomic checkout cleanup failed: ${safeError(error).message}`);
      process.exitCode = 1;
    }
  }
};

if (require.main === module) main().catch((error) => {
  console.error(`R12 atomic checkout validator terminated: ${safeError(error).message}`);
  process.exitCode = 1;
});

module.exports = { validateEnvironment, isSupportedSupabaseHostname, translateSql, createRepository, structuralPreflight, staleFixtureGuard };
