const crypto = require('crypto');
const { getAppUrl } = require('./appUrl');

const EVENT_TYPES = new Set(['order_received', 'order_shipped', 'order_delivered']);
const randomId = () => `email-${crypto.randomBytes(12).toString('hex')}`;

const snapshotOrder = (eventType, order) => {
  const payload = {
    id: String(order?.id || ''),
    customerEmailSnapshot: String(order?.customerEmailSnapshot || '').trim(),
    customerFirstNameSnapshot: String(order?.customerFirstNameSnapshot || '').trim(),
    customerLastNameSnapshot: String(order?.customerLastNameSnapshot || '').trim(),
  };
  if (eventType === 'order_received') {
    Object.assign(payload, {
      shippingAddress: order?.shippingAddress || null,
      subtotal: order?.subtotal,
      discountTotal: order?.discountTotal,
      shippingTotal: order?.shippingTotal,
      total: order?.total,
    });
  }
  if (eventType === 'order_shipped' || eventType === 'order_delivered') {
    Object.assign(payload, {
      shippingProvider: String(order?.shippingProvider || '').trim(),
      trackingNumber: String(order?.trackingNumber || '').trim(),
      deliveredAt: order?.deliveredAt || null,
    });
  }
  if (order?.userId) payload.accountUrl = `${getAppUrl()}/account/orders/${encodeURIComponent(payload.id)}`;
  return payload;
};

const enqueueOrderEmail = async (tx, eventType, order, items) => {
  if (!EVENT_TYPES.has(eventType)) throw new Error('Unknown email outbox event type.');
  const idempotencyKey = `${eventType}/${order.id}`;
  const payload = {
    order: snapshotOrder(eventType, order),
    items: (Array.isArray(items) ? items : []).map((item) => ({
      productName: String(item?.productName || '').trim(),
      quantity: Number(item?.quantity || 0),
      ...(eventType === 'order_received' ? { unitPrice: Number(item?.unitPrice || 0) } : {}),
    })),
  };
  const result = await tx.run(`INSERT INTO email_outbox
    (id, eventtype, orderid, recipientemail, payload, status, attemptcount, eligibleat, idempotencykey, createdat, updatedat)
    VALUES (?, ?, ?, ?, ?::jsonb, 'pending', 0, CURRENT_TIMESTAMP, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT (idempotencykey) DO NOTHING`, [
    randomId(), eventType, order.id, payload.order.customerEmailSnapshot, JSON.stringify(payload), idempotencyKey,
  ]);
  return result.changes === 1;
};

module.exports = { EVENT_TYPES, enqueueOrderEmail };
