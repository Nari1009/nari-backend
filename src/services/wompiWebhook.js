const crypto = require('crypto');
const defaultDb = () => require('../db/init');
const { getWompiEventsConfig, environmentRules } = require('./wompiConfig');
const { transitionPaymentStatus } = require('./paymentService');
const { commitReservationSale, releaseReservation } = require('./inventoryReservation');
const { enqueueOrderEmail } = require('./emailOutbox');

const createError = (message, status, code) => Object.assign(new Error(message), { status, code });
const conflict = (message, code = 'WOMPI_VALIDATION') => createError(message, 409, code);

const requiredObject = (value, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw createError(`${label} no es válido.`, 400, 'WOMPI_PAYLOAD_INVALID');
  return value;
};

const safeEqual = (left, right) => {
  const a = Buffer.from(String(left || '').trim().toLowerCase(), 'utf8');
  const b = Buffer.from(String(right || '').trim().toLowerCase(), 'utf8');
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
};

const resolvePath = (value, path) => {
  const parts = String(path || '').split('.');
  let current = value;
  for (const part of parts) {
    if (!part || current == null || !Object.hasOwn(current, part)) throw createError('La firma Wompi referencia un campo ausente.', 401, 'WOMPI_SIGNATURE_INVALID');
    current = current[part];
  }
  if (current == null || typeof current === 'object') throw createError('La firma Wompi referencia un valor inválido.', 401, 'WOMPI_SIGNATURE_INVALID');
  return String(current);
};

const verifyWompiEvent = ({ body, checksumHeader = null, secret, environment = 'sandbox' }) => {
  const event = requiredObject(body, 'El evento');
  const data = requiredObject(event.data, 'Los datos del evento');
  const transaction = requiredObject(data.transaction, 'La transacción');
  const signature = requiredObject(event.signature, 'La firma');
  if (event.event !== 'transaction.updated') throw createError('El evento Wompi no está soportado.', 400, 'WOMPI_EVENT_UNSUPPORTED');
  const rules = environmentRules(environment);
  if (!rules || event.environment !== rules.eventEnvironment) throw createError('El ambiente del evento Wompi no es válido.', 400, 'WOMPI_ENVIRONMENT_INVALID');
  if (!Array.isArray(signature.properties) || !signature.properties.length || typeof signature.checksum !== 'string' || !/^\w{64}$/i.test(signature.checksum)) throw createError('La firma del evento Wompi no es válida.', 401, 'WOMPI_SIGNATURE_INVALID');
  if (!Number.isSafeInteger(event.timestamp) || event.timestamp <= 0) throw createError('El timestamp del evento Wompi no es válido.', 400, 'WOMPI_PAYLOAD_INVALID');
  const material = signature.properties.map((property) => resolvePath(data, property)).join('') + String(event.timestamp) + String(secret || '');
  const expected = crypto.createHash('sha256').update(material, 'utf8').digest('hex');
  if (!safeEqual(expected, signature.checksum) || (checksumHeader && !safeEqual(expected, checksumHeader))) throw createError('La firma del evento Wompi no coincide.', 401, 'WOMPI_SIGNATURE_INVALID');
  const status = String(transaction.status || '').trim().toUpperCase();
  if (!['PENDING', 'APPROVED', 'DECLINED', 'ERROR', 'VOIDED'].includes(status)) throw createError('El estado de la transacción Wompi no está soportado.', 400, 'WOMPI_STATUS_UNSUPPORTED');
  const reference = String(transaction.reference || '').trim();
  const transactionId = String(transaction.id || '').trim();
  const amountInCents = String(transaction.amount_in_cents ?? '').trim();
  const currency = String(transaction.currency || '').trim().toUpperCase();
  if (!reference || !transactionId || !/^\d+$/.test(amountInCents) || BigInt(amountInCents) <= 0n || currency !== 'COP') throw createError('Los datos canónicos de la transacción Wompi no son válidos.', 400, 'WOMPI_PAYLOAD_INVALID');
  return {
    event,
    checksum: signature.checksum.toLowerCase(),
    payloadHash: crypto.createHash('sha256').update(JSON.stringify(event), 'utf8').digest('hex'),
    eventType: event.event,
    transaction: {
      id: transactionId,
      reference,
      status,
      amountInCents,
      currency,
      paymentMethodType: transaction.payment_method_type ? String(transaction.payment_method_type) : null,
      providerStatus: status,
      failureCode: transaction.failure_reason?.code ? String(transaction.failure_reason.code) : null,
      failureMessage: transaction.failure_reason?.message ? String(transaction.failure_reason.message) : null,
    },
  };
};

const paymentSelect = `SELECT id, orderid AS "orderId", provider, status, amount, currency,
  idempotencykey AS "idempotencyKey", providertransactionid AS "providerTransactionId",
  providerreference AS "providerReference", paymentmethodtype AS "paymentMethodType",
  providerstatus AS "providerStatus", failurecode AS "failureCode", failuremessage AS "failureMessage"
  FROM payments`;

const eventSelect = `SELECT id, provider, providereventid AS "providerEventId", providertransactionid AS "providerTransactionId",
  paymentid AS "paymentId", eventtype AS "eventType", status, payloadhash AS "payloadHash",
  processedat AS "processedAt", processingstatus AS "processingStatus" FROM payment_events`;

const orderForEmail = async (tx, orderId) => {
  const order = await tx.get(`SELECT id, ordernumber AS "orderNumber", userid AS "userId",
    customeremailsnapshot AS "customerEmailSnapshot", customerfirstnamesnapshot AS "customerFirstNameSnapshot",
    customerlastnamesnapshot AS "customerLastNameSnapshot", shippingaddress AS "shippingAddress",
    subtotal, discounttotal AS "discountTotal", shippingtotal AS "shippingTotal", shippingzone AS "shippingZone",
    deliverytype AS "deliveryType", samedayeligible AS "sameDayEligible", shippingpolicyversion AS "shippingPolicyVersion", total
    FROM orders WHERE id = ? FOR UPDATE`, [orderId]);
  if (!order) throw createError('El pedido asociado al pago no existe.', 409, 'WOMPI_ORDER_MISSING');
  const items = await tx.all('SELECT productname AS "productName", quantity, unitprice AS "unitPrice" FROM order_items WHERE orderid = ? ORDER BY id', [orderId]);
  return { order, items };
};

const markEvent = (tx, eventId, status, paymentId, providerTransactionId, processingStatus) => tx.run(`UPDATE payment_events
  SET paymentid = ?, providertransactionid = ?, status = ?, processingstatus = ?, processedat = CASE WHEN ? = 'PROCESSED' OR ? = 'IGNORED' THEN CURRENT_TIMESTAMP ELSE processedat END
  WHERE id = ?`, [paymentId, providerTransactionId, status, processingStatus, processingStatus, processingStatus, eventId]);

const processWompiEvent = async ({ body, checksumHeader = null, repository = null } = {}) => {
  repository = repository || defaultDb();
  const { environment, eventsSecret } = getWompiEventsConfig();
  const verified = verifyWompiEvent({ body, checksumHeader, secret: eventsSecret, environment });
  return repository.withTransaction(async (tx) => {
    const incoming = verified.transaction;
    const payment = await tx.get(`${paymentSelect} WHERE provider = 'WOMPI' AND providerreference = ? FOR UPDATE`, [incoming.reference]);
    if (!payment) throw createError('La referencia de pago no existe.', 404, 'WOMPI_REFERENCE_UNKNOWN');
    if (payment.provider !== 'WOMPI' || payment.providerReference !== incoming.reference) throw conflict('La referencia no coincide con el Payment.', 'WOMPI_REFERENCE_MISMATCH');
    if (String(payment.amount) !== incoming.amountInCents) throw conflict('El monto de la transacción no coincide.', 'WOMPI_AMOUNT_MISMATCH');
    if (String(payment.currency).toUpperCase() !== incoming.currency) throw conflict('La moneda de la transacción no coincide.', 'WOMPI_CURRENCY_MISMATCH');
    if (payment.providerTransactionId && payment.providerTransactionId !== incoming.id) throw conflict('La transacción ya está asociada a otro identificador.', 'WOMPI_TRANSACTION_MISMATCH');
    const conflictingPayment = await tx.get(`SELECT id FROM payments WHERE provider = 'WOMPI' AND providertransactionid = ? AND id <> ? FOR UPDATE`, [incoming.id, payment.id]);
    if (conflictingPayment) throw conflict('El identificador de transacción ya pertenece a otro Payment.', 'WOMPI_TRANSACTION_MISMATCH');

    let eventRow = await tx.get(`${eventSelect} WHERE provider = 'WOMPI' AND providereventid = ? FOR UPDATE`, [verified.checksum]);
    if (!eventRow) {
      await tx.run(`INSERT INTO payment_events (id, provider, providereventid, providertransactionid, paymentid, eventtype, status, payloadhash, processingstatus)
        VALUES (?, 'WOMPI', ?, ?, ?, ?, ?, ?, 'RECEIVED') ON CONFLICT (provider, providereventid) WHERE providereventid IS NOT NULL DO NOTHING`, [`payment-event-${crypto.randomBytes(12).toString('hex')}`, verified.checksum, incoming.id, payment.id, verified.eventType, incoming.status, verified.payloadHash]);
      eventRow = await tx.get(`${eventSelect} WHERE provider = 'WOMPI' AND providereventid = ? FOR UPDATE`, [verified.checksum]);
    }
    if (!eventRow) throw new Error('No fue posible registrar el evento Wompi.');
    if (eventRow.payloadHash && eventRow.payloadHash !== verified.payloadHash) throw conflict('La identidad del evento Wompi es ambigua.', 'WOMPI_EVENT_IDENTITY_MISMATCH');
    if (eventRow.processingStatus === 'PROCESSED' || eventRow.processingStatus === 'IGNORED') return { duplicate: true, status: eventRow.processingStatus };

    if (payment.status === 'APPROVED' && incoming.status !== 'APPROVED') {
      await markEvent(tx, eventRow.id, incoming.status, payment.id, incoming.id, 'IGNORED');
      return { duplicate: false, ignored: true, status: payment.status };
    }

    const updatedPayment = await transitionPaymentStatus({
      paymentId: payment.id,
      status: incoming.status,
      providerStatus: incoming.providerStatus,
      providerTransactionId: incoming.id,
      paymentMethodType: incoming.paymentMethodType,
      failureCode: incoming.failureCode,
      failureMessage: incoming.failureMessage,
    }, tx);

    let emailIdempotencyKey = null;
    if (incoming.status === 'APPROVED') {
      const reservation = await tx.get('SELECT id, status FROM stock_reservations WHERE orderid = ? FOR UPDATE', [payment.orderId]);
      if (!reservation) throw createError('La aprobación requiere conciliación: no existe la reserva.', 409, 'WOMPI_RECONCILIATION_REQUIRED');
      if (['EXPIRED', 'RELEASED'].includes(reservation.status)) throw createError('La aprobación requiere conciliación: la reserva no está activa.', 409, 'WOMPI_RECONCILIATION_REQUIRED');
      if (reservation.status === 'ACTIVE') await commitReservationSale({ reservationId: reservation.id }, tx);
      const { order, items } = await orderForEmail(tx, payment.orderId);
      await enqueueOrderEmail(tx, 'payment_approved', { ...order, paymentId: payment.id }, items);
      emailIdempotencyKey = `payment_approved/${payment.id}`;
    } else if (['DECLINED', 'ERROR', 'VOIDED'].includes(incoming.status)) {
      const reservation = await tx.get('SELECT id, status FROM stock_reservations WHERE orderid = ? FOR UPDATE', [payment.orderId]);
      if (!reservation) throw createError('El rechazo requiere conciliación: no existe la reserva.', 409, 'WOMPI_RECONCILIATION_REQUIRED');
      if (reservation.status === 'COMMITTED') throw createError('El rechazo requiere conciliación: la reserva ya está comprometida.', 409, 'WOMPI_RECONCILIATION_REQUIRED');
      if (reservation.status === 'ACTIVE') await releaseReservation({ reservationId: reservation.id }, tx);
      if (incoming.status === 'DECLINED') {
        const { order, items } = await orderForEmail(tx, payment.orderId);
        await enqueueOrderEmail(tx, 'payment_declined', { ...order, paymentId: payment.id }, items);
        emailIdempotencyKey = `payment_declined/${payment.id}`;
      }
    }
    await markEvent(tx, eventRow.id, incoming.status, payment.id, incoming.id, 'PROCESSED');
    return { duplicate: false, payment: updatedPayment, status: incoming.status, emailIdempotencyKey };
  });
};

module.exports = { verifyWompiEvent, processWompiEvent };
