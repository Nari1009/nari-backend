const crypto = require('crypto');
const { RESERVATION_STATUS_VALUES, canTransitionReservation } = require('../domain/reservationStatus');

const defaultRepository = () => require('../db/init');

const randomId = (prefix) => `${prefix}-${crypto.randomBytes(12).toString('hex')}`;
const requiredText = (value, label, max = 200) => {
  const text = String(value || '').trim();
  if (!text || text.length > max) throw createError(`${label} no es válido.`, 400);
  return text;
};
const createError = (message, status = 409) => Object.assign(new Error(message), { status });
const conflict = (message) => createError(message, 409);

const reservationSelect = `SELECT id, orderid AS "orderId", status, idempotencykey AS "idempotencyKey",
  expiresat AS "expiresAt", createdat AS "createdAt", updatedat AS "updatedAt",
  committedat AS "committedAt", releasedat AS "releasedAt" FROM stock_reservations`;

const mapReservation = (row, items = []) => row && ({
  id: row.id,
  orderId: row.orderId,
  status: row.status,
  idempotencyKey: row.idempotencyKey,
  expiresAt: row.expiresAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  committedAt: row.committedAt || null,
  releasedAt: row.releasedAt || null,
  items: items.map((item) => ({
    id: item.id,
    reservationId: item.reservationId,
    productId: item.productId,
    quantity: item.quantity,
    createdAt: item.createdAt,
  })),
});

const reservationItems = async (repository, reservationId, lock = false) => repository.all(`SELECT id, reservationid AS "reservationId", productid AS "productId", quantity, createdat AS "createdAt"
  FROM stock_reservation_items WHERE reservationid = ? ORDER BY productid${lock ? ' FOR UPDATE' : ''}`, [reservationId]);

const readReservation = async (repository, reservationId, lock = false) => {
  const row = await repository.get(`${reservationSelect} WHERE id = ?${lock ? ' FOR UPDATE' : ''}`, [reservationId]);
  return row ? mapReservation(row, await reservationItems(repository, reservationId, lock)) : null;
};

const withRepositoryTransaction = (repository, callback) => {
  if (repository?.withTransaction) return repository.withTransaction(callback);
  return defaultRepository().withTransaction(callback);
};

const validateExpiration = (expiresAt) => {
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) throw createError('La expiración de la reserva no es válida.', 400);
  if (date.getTime() <= Date.now()) throw createError('La reserva debe expirar en el futuro.', 400);
  return date.toISOString();
};

const loadOrderItems = async (tx, orderId) => {
  const order = await tx.get('SELECT id FROM orders WHERE id = ? FOR UPDATE', [orderId]);
  if (!order) throw createError('El pedido no existe.', 404);
  const rows = await tx.all('SELECT productid AS "productId", quantity FROM order_items WHERE orderid = ? ORDER BY productid, id', [orderId]);
  if (!rows.length) throw createError('El pedido no tiene productos.', 400);
  const quantities = new Map();
  for (const row of rows) {
    if (!Number.isInteger(row.quantity) || row.quantity <= 0) throw createError('La cantidad del pedido no es válida.', 400);
    quantities.set(row.productId, (quantities.get(row.productId) || 0) + row.quantity);
  }
  return [...quantities.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([productId, quantity]) => ({ productId, quantity }));
};

const lockProducts = async (tx, items) => {
  const placeholders = items.map(() => '?').join(', ');
  const products = await tx.all(`SELECT id, stock, status, soldcount AS "soldCount" FROM products WHERE id IN (${placeholders}) ORDER BY id FOR UPDATE`, items.map((item) => item.productId));
  const byId = new Map(products.map((product) => [product.id, product]));
  if (products.length !== items.length) throw conflict('Uno de los productos ya no existe.');
  for (const item of items) {
    const product = byId.get(item.productId);
    if (product.status !== 'active') throw conflict('Uno de los productos ya no está disponible.');
    if (!Number.isInteger(product.stock) || product.stock < item.quantity) throw conflict('No hay stock suficiente para completar la reserva.');
  }
  return byId;
};

const insertMovement = async (tx, { id, productId, quantity, type, description, stockBefore, stockAfter, reason, reference, orderId }) => {
  if (typeof tx.runStrict !== 'function') throw new Error('The reservation repository must provide strict movement inserts.');
  return tx.runStrict(`INSERT INTO inventory_movements
    (id, productid, quantity, type, description, stockbefore, stockafter, reason, reference, orderid)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  [id, productId, quantity, type, description, stockBefore, stockAfter, reason, reference, orderId]);
};

const createReservation = async ({ orderId, idempotencyKey, expiresAt }, repository) => {
  const normalizedOrderId = requiredText(orderId, 'El pedido');
  const normalizedKey = requiredText(idempotencyKey, 'La clave de idempotencia');
  const normalizedExpiresAt = validateExpiration(expiresAt);
  return withRepositoryTransaction(repository, async (tx) => {
    const existingByKey = await tx.get(`${reservationSelect} WHERE idempotencykey = ? FOR UPDATE`, [normalizedKey]);
    if (existingByKey) {
      if (existingByKey.orderId !== normalizedOrderId) throw conflict('La clave de idempotencia ya pertenece a otro pedido.');
      return readReservation(tx, existingByKey.id, true);
    }
    const existingByOrder = await tx.get(`${reservationSelect} WHERE orderid = ? FOR UPDATE`, [normalizedOrderId]);
    if (existingByOrder) throw conflict('El pedido ya tiene una reserva de inventario.');
    const items = await loadOrderItems(tx, normalizedOrderId);
    const products = await lockProducts(tx, items);
    const reservationId = randomId('reservation');
    await tx.run(`INSERT INTO stock_reservations
      (id, orderid, status, idempotencykey, expiresat)
      VALUES (?, ?, 'ACTIVE', ?, ?)`, [reservationId, normalizedOrderId, normalizedKey, normalizedExpiresAt]);
    for (const item of items) {
      const product = products.get(item.productId);
      const result = await tx.run('UPDATE products SET stock = stock - ?, updatedat = CURRENT_TIMESTAMP WHERE id = ? AND stock >= ?', [item.quantity, item.productId, item.quantity]);
      if (result.changes !== 1) throw conflict('El stock cambió; vuelve a intentar la reserva.');
      await tx.run('INSERT INTO stock_reservation_items (id, reservationid, productid, quantity) VALUES (?, ?, ?, ?)', [randomId('reservation-item'), reservationId, item.productId, item.quantity]);
      await insertMovement(tx, {
        id: randomId('movement'), productId: item.productId, quantity: -item.quantity, type: 'reservation',
        description: 'Reserva de inventario', stockBefore: product.stock, stockAfter: product.stock - item.quantity,
        reason: 'Reserva de checkout', reference: `reservation/${reservationId}/${item.productId}`, orderId: normalizedOrderId,
      });
    }
    return readReservation(tx, reservationId, true);
  });
};

const resolveReadRepository = (repository) => repository || defaultRepository();
const getReservation = async (reservationId, repository) => readReservation(resolveReadRepository(repository), requiredText(reservationId, 'La reserva'));
const getReservationForOrder = async (orderId, repository) => {
  repository = resolveReadRepository(repository);
  const row = await repository.get(`${reservationSelect} WHERE orderid = ?`, [requiredText(orderId, 'El pedido')]);
  return row ? mapReservation(row, await reservationItems(repository, row.id)) : null;
};

const terminalNoOp = (reservation, target) => {
  return reservation.status === target;
};

const commitReservationSale = async ({ reservationId }, repository) => withRepositoryTransaction(repository, async (tx) => {
  const reservation = await readReservation(tx, requiredText(reservationId, 'La reserva'), true);
  if (!reservation) throw createError('La reserva no existe.', 404);
  if (terminalNoOp(reservation, 'COMMITTED')) return reservation;
  if (!canTransitionReservation(reservation.status, 'COMMITTED')) throw conflict('La reserva ya no puede convertirse en venta.');
  const items = [...reservation.items].sort((a, b) => a.productId.localeCompare(b.productId));
  const products = await lockProductsForExistingReservation(tx, items);
  for (const item of items) {
    const product = products.get(item.productId);
    const soldCountResult = await tx.run('UPDATE products SET soldcount = soldcount + ?, updatedat = CURRENT_TIMESTAMP WHERE id = ?', [item.quantity, item.productId]);
    if (soldCountResult.changes !== 1) throw conflict('No se pudo actualizar la venta de inventario.');
    // This is the audit record for finalizing already-reserved inventory.
    // Available-to-sell stock must not decrease a second time.
    await insertMovement(tx, {
      id: randomId('movement'), productId: item.productId, quantity: 0, type: 'sale',
      description: 'Venta confirmada', stockBefore: product.stock, stockAfter: product.stock,
      reason: 'Reserva aprobada', reference: `sale/${reservation.orderId}/${item.productId}`, orderId: reservation.orderId,
    });
  }
  const transitionResult = await tx.run("UPDATE stock_reservations SET status = 'COMMITTED', committedat = CURRENT_TIMESTAMP, updatedat = CURRENT_TIMESTAMP WHERE id = ? AND status = 'ACTIVE'", [reservation.id]);
  if (transitionResult.changes !== 1) throw conflict('La reserva cambió; no se pudo confirmar la venta.');
  return readReservation(tx, reservation.id, true);
});

const lockProductsForExistingReservation = async (tx, items) => {
  const placeholders = items.map(() => '?').join(', ');
  const products = await tx.all(`SELECT id, stock, status, soldcount AS "soldCount" FROM products WHERE id IN (${placeholders}) ORDER BY id FOR UPDATE`, items.map((item) => item.productId));
  if (products.length !== items.length) throw conflict('Uno de los productos reservados ya no existe.');
  return new Map(products.map((product) => [product.id, product]));
};

const releaseReservationInternal = async ({ reservationId, targetStatus, now = new Date() }, repository) => withRepositoryTransaction(repository, async (tx) => {
  const reservation = await readReservation(tx, requiredText(reservationId, 'La reserva'), true);
  if (!reservation) throw createError('La reserva no existe.', 404);
  if (terminalNoOp(reservation, targetStatus)) return reservation;
  if (!canTransitionReservation(reservation.status, targetStatus)) throw conflict('La reserva ya no puede liberarse.');
  if (targetStatus === 'EXPIRED' && new Date(reservation.expiresAt).getTime() > new Date(now).getTime()) throw conflict('La reserva todavía no ha expirado.');
  const items = [...reservation.items].sort((a, b) => a.productId.localeCompare(b.productId));
  const products = await lockProductsForExistingReservation(tx, items);
  for (const item of items) {
    const product = products.get(item.productId);
    const stockResult = await tx.run('UPDATE products SET stock = stock + ?, updatedat = CURRENT_TIMESTAMP WHERE id = ?', [item.quantity, item.productId]);
    if (stockResult.changes !== 1) throw conflict('No se pudo restaurar el inventario reservado.');
    await insertMovement(tx, {
      id: randomId('movement'), productId: item.productId, quantity: item.quantity, type: 'reservation_release',
      description: 'Liberación de reserva', stockBefore: product.stock, stockAfter: product.stock + item.quantity,
      reason: targetStatus === 'EXPIRED' ? 'Reserva expirada' : 'Reserva liberada',
      reference: `reservation-release/${reservation.id}/${item.productId}`, orderId: reservation.orderId,
    });
  }
  const transitionResult = await tx.run(`UPDATE stock_reservations SET status = ?, releasedat = CURRENT_TIMESTAMP, updatedat = CURRENT_TIMESTAMP WHERE id = ? AND status = 'ACTIVE'`, [targetStatus, reservation.id]);
  if (transitionResult.changes !== 1) throw conflict('La reserva cambió; no se pudo liberar el inventario.');
  return readReservation(tx, reservation.id, true);
});

const releaseReservation = (args, repository) => releaseReservationInternal({ ...args, targetStatus: 'RELEASED' }, repository);
const expireReservation = (args, repository) => releaseReservationInternal({ ...args, targetStatus: 'EXPIRED' }, repository);

module.exports = {
  createReservation,
  getReservation,
  getReservationForOrder,
  commitReservationSale,
  releaseReservation,
  expireReservation,
  RESERVATION_STATUS_VALUES,
};
