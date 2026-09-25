const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { RESERVATION_STATUSES, canTransitionReservation } = require('../src/domain/reservationStatus');
const {
  createReservation,
  commitReservationSale,
  releaseReservation,
  expireReservation,
  getReservationForOrder,
} = require('../src/services/inventoryReservation');

const makeRepository = () => {
  const state = {
    orders: new Map([['order-1', { id: 'order-1' }]]),
    orderItems: [{ productId: 'product-a', quantity: 1 }, { productId: 'product-b', quantity: 2 }],
    products: new Map([
      ['product-a', { id: 'product-a', stock: 1, status: 'active', soldCount: 0 }],
      ['product-b', { id: 'product-b', stock: 2, status: 'active', soldCount: 0 }],
    ]),
    reservations: new Map(),
    reservationItems: new Map(),
    movements: new Map(),
  };
  const cloneReservation = (row) => row && ({ ...row });
  const repository = {
    async withTransaction(callback) {
      const snapshot = {
        products: new Map([...state.products].map(([key, value]) => [key, { ...value }])),
        reservations: new Map([...state.reservations].map(([key, value]) => [key, { ...value }])),
        reservationItems: new Map([...state.reservationItems].map(([key, value]) => [key, { ...value }])),
        movements: new Map([...state.movements].map(([key, value]) => [key, { ...value }])),
      };
      try {
        return await callback(repository);
      } catch (error) {
        state.products = snapshot.products;
        state.reservations = snapshot.reservations;
        state.reservationItems = snapshot.reservationItems;
        state.movements = snapshot.movements;
        throw error;
      }
    },
    async get(sql, params = []) {
      if (/FROM orders/i.test(sql)) return cloneReservation(state.orders.get(params[0]));
      if (/FROM stock_reservations/i.test(sql)) {
        if (/WHERE idempotencykey/i.test(sql)) return [...state.reservations.values()].find((row) => row.idempotencyKey === params[0]);
        if (/WHERE orderid/i.test(sql)) return [...state.reservations.values()].find((row) => row.orderId === params[0]);
        return state.reservations.get(params[0]);
      }
      return undefined;
    },
    async all(sql, params = []) {
      if (/FROM order_items/i.test(sql)) return state.orderItems.filter(() => params[0] === 'order-1').map((row) => ({ ...row }));
      if (/FROM products/i.test(sql)) return params.map((id) => state.products.get(id)).filter(Boolean).sort((a, b) => a.id.localeCompare(b.id)).map((row) => ({ ...row }));
      if (/FROM stock_reservation_items/i.test(sql)) return [...state.reservationItems.values()].filter((row) => row.reservationId === params[0]).sort((a, b) => a.productId.localeCompare(b.productId)).map((row) => ({ ...row }));
      return [];
    },
    async run(sql, params = []) {
      if (/INSERT INTO stock_reservations/i.test(sql)) {
        const [id, orderId, idempotencyKey, expiresAt] = params;
        if ([...state.reservations.values()].some((row) => row.orderId === orderId || row.idempotencyKey === idempotencyKey)) throw new Error('unique reservation constraint');
        state.reservations.set(id, { id, orderId, status: 'ACTIVE', idempotencyKey, expiresAt, committedAt: null, releasedAt: null });
        return { changes: 1 };
      }
      if (/INSERT INTO stock_reservation_items/i.test(sql)) {
        const [id, reservationId, productId, quantity] = params;
        state.reservationItems.set(id, { id, reservationId, productId, quantity, createdAt: new Date().toISOString() });
        return { changes: 1 };
      }
      if (/UPDATE products SET stock = stock -/i.test(sql)) {
        const [quantity, id, minimum] = params;
        const product = state.products.get(id);
        if (!product || product.stock < minimum) return { changes: 0 };
        product.stock -= quantity;
        return { changes: 1 };
      }
      if (/UPDATE products SET stock = stock \+/i.test(sql)) {
        const [quantity, id] = params;
        state.products.get(id).stock += quantity;
        return { changes: 1 };
      }
      if (/UPDATE products SET soldcount/i.test(sql)) {
        const [quantity, id] = params;
        state.products.get(id).soldCount += quantity;
        return { changes: 1 };
      }
      if (/INSERT INTO inventory_movements/i.test(sql)) {
        const [id, productId, quantity, type, description, stockBefore, stockAfter, reason, reference, orderId] = params;
        if (state.movements.has(reference)) throw new Error('duplicate movement reference');
        state.movements.set(reference, { id, productId, quantity, type, description, stockBefore, stockAfter, reason, reference, orderId });
        return { changes: 1 };
      }
      if (/UPDATE stock_reservations SET status/i.test(sql)) {
        const status = /status = 'COMMITTED'/i.test(sql) ? 'COMMITTED' : params[0];
        const id = status === 'COMMITTED' ? params[0] : params[1];
        const row = state.reservations.get(id);
        if (!row || row.status !== 'ACTIVE') return { changes: 0 };
        row.status = status;
        if (status === 'COMMITTED') row.committedAt = new Date().toISOString();
        else row.releasedAt = new Date().toISOString();
        return { changes: 1 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  return { repository, state };
};

const future = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();

test('reservation migration defines private tables, constraints and movement idempotency', () => {
  const migration = fs.readFileSync(path.join(__dirname, '../migrations/20260925_stock_reservations.sql'), 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.stock_reservations/i);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.stock_reservation_items/i);
  assert.match(migration, /UNIQUE \(orderid\)/i);
  assert.match(migration, /UNIQUE \(reservationid, productid\)/i);
  assert.match(migration, /quantity INTEGER NOT NULL CHECK \(quantity > 0\)/i);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/i);
  assert.match(migration, /REVOKE ALL PRIVILEGES ON TABLE public\.stock_reservations FROM anon, authenticated/i);
  assert.match(migration, /REVOKE ALL PRIVILEGES ON TABLE public\.stock_reservation_items FROM anon, authenticated/i);
  assert.match(migration, /inventory_movements_reference_unique/i);
  assert.match(migration, /GROUP BY reference\s+HAVING COUNT\(\*\) > 1/i);
  assert.match(migration, /duplicate non-null references exist/i);
  assert.doesNotMatch(migration, /FORCE ROW LEVEL SECURITY|CREATE POLICY|service_role|supabase_admin/i);
});

test('reservation statuses have only the approved transitions', () => {
  assert.deepEqual(Object.keys(RESERVATION_STATUSES), ['ACTIVE', 'COMMITTED', 'RELEASED', 'EXPIRED']);
  assert.equal(canTransitionReservation('ACTIVE', 'COMMITTED'), true);
  assert.equal(canTransitionReservation('ACTIVE', 'RELEASED'), true);
  assert.equal(canTransitionReservation('ACTIVE', 'EXPIRED'), true);
  assert.equal(canTransitionReservation('COMMITTED', 'ACTIVE'), false);
  assert.equal(canTransitionReservation('RELEASED', 'ACTIVE'), false);
  assert.equal(canTransitionReservation('EXPIRED', 'COMMITTED'), false);
});

test('reserve is atomic across Products and idempotent by Order/key', async () => {
  const { repository, state } = makeRepository();
  const first = await createReservation({ orderId: 'order-1', idempotencyKey: 'checkout-1', expiresAt: future() }, repository);
  const second = await createReservation({ orderId: 'order-1', idempotencyKey: 'checkout-1', expiresAt: future() }, repository);
  assert.equal(first.id, second.id);
  assert.equal(state.products.get('product-a').stock, 0);
  assert.equal(state.products.get('product-b').stock, 0);
  assert.equal(state.reservations.size, 1);
  assert.equal(state.movements.size, 2);
  assert.deepEqual((await getReservationForOrder('order-1', repository)).items.map((item) => item.productId), ['product-a', 'product-b']);
});

test('reservation idempotency rejects a different key for the same Order and a reused key for another Order', async () => {
  const { repository } = makeRepository();
  await createReservation({ orderId: 'order-1', idempotencyKey: 'checkout-key-a', expiresAt: future() }, repository);
  await assert.rejects(() => createReservation({ orderId: 'order-1', idempotencyKey: 'checkout-key-b', expiresAt: future() }, repository), /ya tiene una reserva/i);
  await assert.rejects(() => createReservation({ orderId: 'order-2', idempotencyKey: 'checkout-key-a', expiresAt: future() }, repository), /ya pertenece a otro pedido/i);
});

test('insufficient stock rolls back the complete multi-product reservation', async () => {
  const { repository, state } = makeRepository();
  state.products.get('product-b').stock = 1;
  await assert.rejects(() => createReservation({ orderId: 'order-1', idempotencyKey: 'checkout-2', expiresAt: future() }, repository), /stock suficiente/i);
  assert.equal(state.products.get('product-a').stock, 1);
  assert.equal(state.products.get('product-b').stock, 1);
  assert.equal(state.reservations.size, 0);
  assert.equal(state.movements.size, 0);
});

test('commit increments soldCount once and does not decrement stock again', async () => {
  const { repository, state } = makeRepository();
  const reservation = await createReservation({ orderId: 'order-1', idempotencyKey: 'checkout-3', expiresAt: future() }, repository);
  const stockAfterReserve = [...state.products.values()].map((product) => product.stock);
  await commitReservationSale({ reservationId: reservation.id }, repository);
  await commitReservationSale({ reservationId: reservation.id }, repository);
  assert.deepEqual([...state.products.values()].map((product) => product.stock), stockAfterReserve);
  assert.equal(state.products.get('product-a').soldCount, 1);
  assert.equal(state.products.get('product-b').soldCount, 2);
  assert.equal([...state.movements.values()].filter((movement) => movement.type === 'sale').length, 2);
});

test('movement collision aborts commit without persisting stock, soldCount, or status effects', async () => {
  const { repository, state } = makeRepository();
  const reservation = await createReservation({ orderId: 'order-1', idempotencyKey: 'checkout-collision', expiresAt: future() }, repository);
  state.movements.set(`sale/${reservation.orderId}/product-a`, { reference: `sale/${reservation.orderId}/product-a` });
  await assert.rejects(() => commitReservationSale({ reservationId: reservation.id }, repository), /duplicate movement reference/i);
  assert.equal(state.products.get('product-a').soldCount, 0);
  assert.equal(state.reservations.get(reservation.id).status, 'ACTIVE');
});

test('release restores stock once and terminal states cannot resurrect', async () => {
  const { repository, state } = makeRepository();
  const reservation = await createReservation({ orderId: 'order-1', idempotencyKey: 'checkout-4', expiresAt: future() }, repository);
  await releaseReservation({ reservationId: reservation.id }, repository);
  await releaseReservation({ reservationId: reservation.id }, repository);
  assert.equal(state.products.get('product-a').stock, 1);
  assert.equal(state.products.get('product-b').stock, 2);
  assert.equal([...state.movements.values()].filter((movement) => movement.type === 'reservation_release').length, 2);
  await assert.rejects(() => commitReservationSale({ reservationId: reservation.id }, repository), /no puede convertirse/i);
});

test('terminal operations are idempotent only for the same semantic operation', async () => {
  const makeTerminal = async (status, key) => {
    const setup = makeRepository();
    const reservation = await createReservation({ orderId: 'order-1', idempotencyKey: key, expiresAt: future() }, setup.repository);
    setup.state.reservations.get(reservation.id).status = status;
    return { ...setup, reservation };
  };

  const expired = await makeTerminal('EXPIRED', 'terminal-expired');
  await assert.rejects(() => releaseReservation({ reservationId: expired.reservation.id }, expired.repository), /no puede liberarse/i);
  await assert.rejects(() => commitReservationSale({ reservationId: expired.reservation.id }, expired.repository), /no puede convertirse/i);

  const released = await makeTerminal('RELEASED', 'terminal-released');
  await assert.rejects(() => expireReservation({ reservationId: released.reservation.id, now: new Date(Date.now() + 2 * 60 * 60 * 1000) }, released.repository), /no puede liberarse/i);
  await assert.rejects(() => commitReservationSale({ reservationId: released.reservation.id }, released.repository), /no puede convertirse/i);

  const committed = await makeTerminal('COMMITTED', 'terminal-committed');
  await assert.rejects(() => releaseReservation({ reservationId: committed.reservation.id }, committed.repository), /no puede liberarse/i);
  await assert.rejects(() => expireReservation({ reservationId: committed.reservation.id, now: new Date(Date.now() + 2 * 60 * 60 * 1000) }, committed.repository), /no puede liberarse/i);
});

test('status and product mutation affected-row checks are present', () => {
  const service = fs.readFileSync(path.join(__dirname, '../src/services/inventoryReservation.js'), 'utf8');
  assert.match(service, /soldCountResult\.changes !== 1/);
  assert.match(service, /stockResult\.changes !== 1/);
  assert.match(service, /transitionResult\.changes !== 1/);
  assert.doesNotMatch(service, /ON CONFLICT \(reference\) DO NOTHING/i);
});

test('expiration requires a passed expiry and restores stock exactly once', async () => {
  const { repository, state } = makeRepository();
  const reservation = await createReservation({ orderId: 'order-1', idempotencyKey: 'checkout-5', expiresAt: future() }, repository);
  await assert.rejects(() => expireReservation({ reservationId: reservation.id, now: new Date() }, repository), /todavía no ha expirado/i);
  await expireReservation({ reservationId: reservation.id, now: new Date(Date.now() + 2 * 60 * 60 * 1000) }, repository);
  await expireReservation({ reservationId: reservation.id, now: new Date(Date.now() + 3 * 60 * 60 * 1000) }, repository);
  assert.equal(state.products.get('product-a').stock, 1);
  assert.equal(state.products.get('product-b').stock, 2);
});

test('reserve uses deterministic row locks and a defensive stock predicate for concurrent final-unit attempts', () => {
  const service = fs.readFileSync(path.join(__dirname, '../src/services/inventoryReservation.js'), 'utf8');
  assert.match(service, /ORDER BY id FOR UPDATE/i);
  assert.match(service, /stock = stock - \?, updatedat = CURRENT_TIMESTAMP WHERE id = \? AND stock >= \?/i);
  assert.match(service, /items\.map\(\(item\) => item\.productId\)\);/i);
});
