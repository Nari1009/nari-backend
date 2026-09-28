#!/usr/bin/env node
require('dotenv').config();

const { expireReservation } = require('../src/services/inventoryReservation');

const DEFAULT_LIMIT = 20;
const defaultRepository = () => {
  const { all, withTransaction } = require('../src/db/init');
  return { all, withTransaction };
};

const candidateQuery = `SELECT DISTINCT ON (r.id)
    r.id AS "reservationId", r.orderid AS "orderId", p.id AS "paymentId"
  FROM stock_reservations r
  JOIN payments p ON p.orderid = r.orderid AND p.provider = 'WOMPI'
  WHERE r.status = 'ACTIVE'
    AND r.expiresat <= CURRENT_TIMESTAMP
    AND p.status = 'CREATED'
  ORDER BY r.id, p.createdat ASC
  LIMIT ?`;

const asTime = (value) => new Date(value).getTime();

const processCandidate = async ({ candidate, repository, expire = expireReservation }) => repository.withTransaction(async (tx) => {
  // Match the webhook lock order: Payment, Reservation, then Product rows
  // inside expireReservation(). Candidate selection is only advisory.
  const payment = await tx.get('SELECT id, orderid AS "orderId", status FROM payments WHERE id = ? FOR UPDATE', [candidate.paymentId]);
  if (!payment || payment.orderId !== candidate.orderId || payment.status !== 'CREATED') return { result: 'skipped', reason: 'payment_not_created' };

  const reservation = await tx.get(`SELECT id, orderid AS "orderId", status, expiresat AS "expiresAt"
    FROM stock_reservations WHERE id = ? FOR UPDATE`, [candidate.reservationId]);
  if (!reservation || reservation.orderId !== candidate.orderId || reservation.status !== 'ACTIVE') return { result: 'skipped', reason: 'reservation_not_active' };

  const clock = await tx.get('SELECT CURRENT_TIMESTAMP AS "now"');
  if (asTime(reservation.expiresAt) > asTime(clock.now)) return { result: 'skipped', reason: 'reservation_not_expired' };

  await expire({ reservationId: reservation.id, now: clock.now }, tx);
  await tx.run(`UPDATE orders
    SET status = 'Cancelado'
    WHERE id = ? AND status = 'Pendiente'`, [candidate.orderId]);
  return { result: 'expired', orderStatus: 'Cancelado' };
});

const processExpiredReservations = async ({ repository = defaultRepository(), limit = DEFAULT_LIMIT, expire = expireReservation, logger = console } = {}) => {
  const candidates = await repository.all(candidateQuery, [Math.max(1, Math.min(Number(limit) || DEFAULT_LIMIT, 100))]);
  const results = [];
  for (const candidate of candidates) {
    try {
      const outcome = await processCandidate({ candidate, repository, expire });
      results.push({ ...candidate, ...outcome });
      logger.log('Expired reservation worker result', { reservationId: candidate.reservationId, orderId: candidate.orderId, paymentId: candidate.paymentId, result: outcome.result, reason: outcome.reason || null });
    } catch (error) {
      const code = error?.code || error?.name || 'reservation_expiration_failed';
      results.push({ ...candidate, result: 'failed', errorCode: code });
      logger.error('Expired reservation worker failure', { reservationId: candidate.reservationId, orderId: candidate.orderId, paymentId: candidate.paymentId, errorCode: code });
    }
  }
  return results;
};

if (require.main === module) {
  processExpiredReservations()
    .then((results) => {
      const summary = results.reduce((counts, item) => { counts[item.result] = (counts[item.result] || 0) + 1; return counts; }, {});
      console.log('Expired reservation worker finished.', summary);
    })
    .catch((error) => { console.error('Expired reservation worker failed:', error.message); process.exitCode = 1; })
    .finally(() => require('../src/db/init').pool.end().catch(() => undefined));
}

module.exports = { candidateQuery, processCandidate, processExpiredReservations };
