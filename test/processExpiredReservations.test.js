const assert = require('node:assert/strict');
const test = require('node:test');
const { processExpiredReservations, candidateQuery } = require('../scripts/processExpiredReservations');

const makeRepository = ({ paymentStatus = 'CREATED', reservationStatus = 'ACTIVE', expiresAt = '2026-09-27T00:00:00.000Z', now = '2026-09-27T00:30:00.000Z', candidates = null } = {}) => {
  const state = {
    payment: { id: 'payment-1', orderId: 'order-1', status: paymentStatus },
    reservation: { id: 'reservation-1', orderId: 'order-1', status: reservationStatus, expiresAt },
    now,
    releases: 0,
  };
  let transactionTail = Promise.resolve();
  const repository = {
    reservation: state.reservation,
    state,
    async all() {
      return candidates || [{ reservationId: state.reservation.id, orderId: state.reservation.orderId, paymentId: state.payment.id }];
    },
    async withTransaction(callback) {
      const current = transactionTail.then(() => callback(repository));
      transactionTail = current.catch(() => undefined);
      return current;
    },
    async get(sql, params = []) {
      if (/FROM payments/i.test(sql)) return params[0] === state.payment.id ? { ...state.payment } : null;
      if (/FROM stock_reservations/i.test(sql)) return params[0] === state.reservation.id ? { ...state.reservation } : null;
      if (/CURRENT_TIMESTAMP/i.test(sql)) return { now: state.now };
      return null;
    },
  };
  return { repository, state };
};

const expire = async ({ reservationId }, tx) => {
  if (tx.reservation?.id !== reservationId) throw new Error('wrong_reservation');
  if (tx.reservation.status !== 'ACTIVE') return;
  tx.reservation.status = 'EXPIRED';
  tx.state.releases += 1;
};

test('worker query is restricted to expired ACTIVE reservations with CREATED WOMPI Payments', () => {
  assert.match(candidateQuery, /r\.status = 'ACTIVE'/i);
  assert.match(candidateQuery, /r\.expiresat <= CURRENT_TIMESTAMP/i);
  assert.match(candidateQuery, /p\.provider = 'WOMPI'/i);
  assert.match(candidateQuery, /p\.status = 'CREATED'/i);
  assert.match(candidateQuery, /LIMIT \?/i);
});

test('expired CREATED reservation is expired once and stock-domain primitive is invoked', async () => {
  const { repository, state } = makeRepository();
  repository.reservation = state.reservation;
  repository.releases = state.releases;
  const result = await processExpiredReservations({ repository, expire: async (args, tx) => {
    if (state.reservation.status === 'ACTIVE') {
      state.reservation.status = 'EXPIRED';
      state.releases += 1;
    }
    return args;
  }, logger: { log() {}, error() {} } });
  assert.equal(result[0].result, 'expired');
  assert.equal(state.reservation.status, 'EXPIRED');
  assert.equal(state.releases, 1);
});

test('duplicate worker execution does not restore the same reservation twice', async () => {
  const { repository, state } = makeRepository();
  const first = await processExpiredReservations({ repository, expire, logger: { log() {}, error() {} } });
  const second = await processExpiredReservations({ repository, expire, logger: { log() {}, error() {} } });
  assert.equal(first[0].result, 'expired');
  assert.equal(second[0].result, 'skipped');
  assert.equal(state.releases, 1);
});

test('overlapping worker executions serialize and expire once', async () => {
  const { repository, state } = makeRepository();
  const [first, second] = await Promise.all([
    processExpiredReservations({ repository, expire, logger: { log() {}, error() {} } }),
    processExpiredReservations({ repository, expire, logger: { log() {}, error() {} } }),
  ]);
  assert.deepEqual([first[0].result, second[0].result].sort(), ['expired', 'skipped']);
  assert.equal(state.releases, 1);
});

test('worker skips pending, approved, terminal, active-unexpired, released, committed and expired reservations', async () => {
  for (const scenario of [
    { paymentStatus: 'PENDING', reservationStatus: 'ACTIVE' },
    { paymentStatus: 'APPROVED', reservationStatus: 'ACTIVE' },
    { paymentStatus: 'DECLINED', reservationStatus: 'ACTIVE' },
    { paymentStatus: 'ERROR', reservationStatus: 'ACTIVE' },
    { paymentStatus: 'VOIDED', reservationStatus: 'ACTIVE' },
    { paymentStatus: 'CREATED', reservationStatus: 'ACTIVE', expiresAt: '2026-09-27T01:00:00.000Z' },
    { paymentStatus: 'CREATED', reservationStatus: 'COMMITTED' },
    { paymentStatus: 'CREATED', reservationStatus: 'RELEASED' },
    { paymentStatus: 'CREATED', reservationStatus: 'EXPIRED' },
  ]) {
    const { repository, state } = makeRepository(scenario);
    const result = await processExpiredReservations({ repository, expire, logger: { log() {}, error() {} } });
    assert.equal(result[0].result, 'skipped', JSON.stringify(scenario));
    assert.equal(state.releases, 0, JSON.stringify(scenario));
  }
});

test('transactional re-check skips a Payment that changed after candidate selection', async () => {
  const { repository, state } = makeRepository();
  let firstTransaction = true;
  const original = repository.withTransaction;
  repository.withTransaction = async (callback) => {
    if (firstTransaction) { firstTransaction = false; state.payment.status = 'PENDING'; }
    return original(callback);
  };
  const result = await processExpiredReservations({ repository, expire, logger: { log() {}, error() {} } });
  assert.equal(result[0].result, 'skipped');
  assert.equal(result[0].reason, 'payment_not_created');
  assert.equal(state.releases, 0);
});

test('one failed reservation does not prevent later candidates from processing', async () => {
  const { repository, state } = makeRepository({ candidates: [
    { reservationId: 'reservation-1', orderId: 'order-1', paymentId: 'payment-1' },
    { reservationId: 'reservation-2', orderId: 'order-2', paymentId: 'payment-2' },
  ] });
  const originalGet = repository.get;
  repository.get = async (sql, params = []) => {
    if (/FROM payments/i.test(sql)) return params[0] === 'payment-2' ? { id: 'payment-2', orderId: 'order-2', status: 'CREATED' } : originalGet(sql, params);
    if (/FROM stock_reservations/i.test(sql)) return params[0] === 'reservation-2' ? { id: 'reservation-2', orderId: 'order-2', status: 'ACTIVE', expiresAt: state.reservation.expiresAt } : originalGet(sql, params);
    return originalGet(sql, params);
  };
  const result = await processExpiredReservations({ repository, expire: async ({ reservationId }) => {
    if (reservationId === 'reservation-1') throw Object.assign(new Error('movement_collision'), { code: '23505' });
    state.releases += 1;
  }, logger: { log() {}, error() {} } });
  assert.deepEqual(result.map((item) => item.result), ['failed', 'expired']);
  assert.equal(state.releases, 1);
});
