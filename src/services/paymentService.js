const crypto = require('crypto');
const { PAYMENT_STATUS_VALUES, canTransitionPayment } = require('../domain/paymentStatus');

const resolveRepository = (repository) => repository || require('../db/init');

const randomId = (prefix) => `${prefix}-${crypto.randomBytes(12).toString('hex')}`;
const validProvider = (value) => {
  const provider = String(value || '').trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_-]{1,31}$/.test(provider)) throw createError('El proveedor de pago no es válido.', 400);
  return provider;
};
const normalizeMoney = (value) => {
  const text = String(value ?? '').trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw createError('El monto de pago no es válido.', 400);
  const [whole, decimals = ''] = text.split('.');
  return `${whole.replace(/^0+(?=\d)/, '')}.${decimals.padEnd(2, '0')}`;
};
const normalizeAmountInCents = (value) => {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text) || BigInt(text) <= 0n) throw createError('El monto de pago no es válido.', 400);
  return BigInt(text).toString();
};
const orderTotalInCents = (value) => {
  const normalized = normalizeMoney(value);
  const [whole, decimals] = normalized.split('.');
  return (BigInt(whole) * 100n + BigInt(decimals)).toString();
};
const validCurrency = (value) => {
  const currency = String(value || '').trim().toUpperCase();
  if (currency !== 'COP') throw createError('La moneda de pago no es válida.', 400);
  return currency;
};
const requiredText = (value, label, max = 160) => {
  const text = String(value || '').trim();
  if (!text || text.length > max) throw createError(`${label} no es válido.`, 400);
  return text;
};
const createError = (message, status) => Object.assign(new Error(message), { status });
const conflict = (message) => createError(message, 409);

const mapPayment = (row) => row && ({
  id: row.id,
  orderId: row.orderId,
  provider: row.provider,
  status: row.status,
  amount: row.amount,
  currency: row.currency,
  idempotencyKey: row.idempotencyKey,
  providerTransactionId: row.providerTransactionId || null,
  providerReference: row.providerReference || null,
  paymentMethodType: row.paymentMethodType || null,
  providerStatus: row.providerStatus || null,
  failureCode: row.failureCode || null,
  failureMessage: row.failureMessage || null,
  approvedAt: row.approvedAt || null,
  failedAt: row.failedAt || null,
  expiresAt: row.expiresAt || null,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const paymentSelect = `SELECT id, orderid AS "orderId", provider, status, amount, currency,
  idempotencykey AS "idempotencyKey", providertransactionid AS "providerTransactionId",
  providerreference AS "providerReference", paymentmethodtype AS "paymentMethodType",
  providerstatus AS "providerStatus", failurecode AS "failureCode", failuremessage AS "failureMessage",
  approvedat AS "approvedAt", failedat AS "failedAt", expiresat AS "expiresAt",
  createdat AS "createdAt", updatedat AS "updatedAt" FROM payments`;

async function createPaymentAttempt({ orderId, provider, amount, currency = 'COP', idempotencyKey, expiresAt = null }, repository) {
  repository = resolveRepository(repository);
  const normalizedOrderId = requiredText(orderId, 'El pedido', 120);
  const normalizedProvider = validProvider(provider);
  const normalizedAmount = normalizeAmountInCents(amount);
  const normalizedCurrency = validCurrency(currency);
  const normalizedKey = requiredText(idempotencyKey, 'La clave de idempotencia', 200);
  const order = await repository.get('SELECT id, total FROM orders WHERE id = ?', [normalizedOrderId]);
  if (!order) throw createError('El pedido no existe.', 404);
  if (orderTotalInCents(order.total) !== normalizedAmount) throw conflict('El monto no coincide con el total canónico del pedido.');

  const id = randomId('payment');
  await repository.run(`INSERT INTO payments
    (id, orderid, provider, status, amount, currency, idempotencykey, expiresat)
    VALUES (?, ?, ?, 'CREATED', ?, ?, ?, ?)
    ON CONFLICT (provider, idempotencykey) DO NOTHING`,
  [id, normalizedOrderId, normalizedProvider, normalizedAmount, normalizedCurrency, normalizedKey, expiresAt]);

  const existing = await repository.get(`${paymentSelect} WHERE provider = ? AND idempotencykey = ?`, [normalizedProvider, normalizedKey]);
  if (!existing) throw new Error('No fue posible persistir el intento de pago.');
  if (existing.orderId !== normalizedOrderId || String(existing.amount) !== normalizedAmount || existing.currency !== normalizedCurrency) {
    throw conflict('La clave de idempotencia ya está asociada a otro intento incompatible.');
  }
  return mapPayment(existing);
}

const getPayment = async (id, repository) => { repository = resolveRepository(repository); return mapPayment(await repository.get(`${paymentSelect} WHERE id = ?`, [id])); };
const listPaymentsForOrder = async (orderId, repository) => { repository = resolveRepository(repository); return (await repository.all(`${paymentSelect} WHERE orderid = ? ORDER BY createdat ASC`, [orderId])).map(mapPayment); };
const findByProviderTransactionId = async (provider, transactionId, repository) => { repository = resolveRepository(repository); return mapPayment(await repository.get(`${paymentSelect} WHERE provider = ? AND providertransactionid = ?`, [validProvider(provider), requiredText(transactionId, 'La transacción del proveedor', 200)])); };
const findByIdempotencyKey = async (provider, idempotencyKey, repository) => { repository = resolveRepository(repository); return mapPayment(await repository.get(`${paymentSelect} WHERE provider = ? AND idempotencykey = ?`, [validProvider(provider), requiredText(idempotencyKey, 'La clave de idempotencia', 200)])); };

async function transitionPaymentStatus({ paymentId, status, providerStatus = null, providerTransactionId = null, failureCode = null, failureMessage = null }, repository) {
  repository = resolveRepository(repository);
  const nextStatus = String(status || '').trim().toUpperCase();
  if (!PAYMENT_STATUS_VALUES.includes(nextStatus)) throw createError('El estado de pago no es válido.', 400);
  const current = await repository.get(`${paymentSelect} WHERE id = ?`, [paymentId]);
  if (!current) throw createError('El intento de pago no existe.', 404);
  if (current.status === nextStatus) return mapPayment(current);
  if (!canTransitionPayment(current.status, nextStatus)) throw conflict(`La transición ${current.status} → ${nextStatus} no está permitida.`);
  const now = new Date().toISOString();
  const approvedAt = nextStatus === 'APPROVED' ? now : null;
  const failedAt = ['DECLINED', 'ERROR'].includes(nextStatus) ? now : null;
  const result = await repository.run(`UPDATE payments SET status = ?, providerstatus = COALESCE(?, providerstatus),
    providertransactionid = COALESCE(?, providertransactionid), failurecode = COALESCE(?, failurecode),
    failuremessage = COALESCE(?, failuremessage), approvedat = COALESCE(?, approvedat),
    failedat = COALESCE(?, failedat), updatedat = CURRENT_TIMESTAMP WHERE id = ? AND status = ?`,
  [nextStatus, providerStatus, providerTransactionId, failureCode, failureMessage, approvedAt, failedAt, paymentId, current.status]);
  if (!result.changes) throw conflict('El intento de pago cambió; vuelve a consultar su estado.');
  return getPayment(paymentId, repository);
}

async function recordPaymentEvent({ provider, providerEventId = null, providerTransactionId = null, paymentId = null, eventType, status, payloadHash, processingStatus = 'RECEIVED' }, repository) {
  repository = resolveRepository(repository);
  const normalizedProvider = validProvider(provider);
  const normalizedEventType = requiredText(eventType, 'El tipo de evento', 120);
  const normalizedStatus = requiredText(status, 'El estado del evento', 80).toUpperCase();
  const normalizedProcessingStatus = requiredText(processingStatus, 'El estado de procesamiento', 40).toUpperCase();
  if (!['RECEIVED', 'PROCESSING', 'PROCESSED', 'IGNORED', 'FAILED'].includes(normalizedProcessingStatus)) throw createError('El estado de procesamiento no es válido.', 400);
  if (payloadHash != null && !/^[a-f0-9]{64}$/i.test(String(payloadHash))) throw createError('El hash del evento no es válido.', 400);
  const id = randomId('payment-event');
  const sql = `INSERT INTO payment_events
    (id, provider, providereventid, providertransactionid, paymentid, eventtype, status, payloadhash, processingstatus)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (provider, providereventid) DO NOTHING`;
  await repository.run(sql, [id, normalizedProvider, providerEventId, providerTransactionId, paymentId, normalizedEventType, normalizedStatus, payloadHash || null, normalizedProcessingStatus]);
  if (providerEventId) return repository.get('SELECT id, provider, providereventid AS "providerEventId", providertransactionid AS "providerTransactionId", paymentid AS "paymentId", eventtype AS "eventType", status, payloadhash AS "payloadHash", receivedat AS "receivedAt", processedat AS "processedAt", processingstatus AS "processingStatus" FROM payment_events WHERE provider = ? AND providereventid = ?', [normalizedProvider, providerEventId]);
  return repository.get('SELECT id, provider, providereventid AS "providerEventId", providertransactionid AS "providerTransactionId", paymentid AS "paymentId", eventtype AS "eventType", status, payloadhash AS "payloadHash", receivedat AS "receivedAt", processedat AS "processedAt", processingstatus AS "processingStatus" FROM payment_events WHERE id = ?', [id]);
}

module.exports = {
  normalizeMoney,
  normalizeAmountInCents,
  orderTotalInCents,
  createPaymentAttempt,
  getPayment,
  listPaymentsForOrder,
  findByProviderTransactionId,
  findByIdempotencyKey,
  transitionPaymentStatus,
  recordPaymentEvent,
};
