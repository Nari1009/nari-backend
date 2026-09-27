#!/usr/bin/env node
require('dotenv').config();
const { pool, withTransaction, run } = require('../src/db/init');
const { sendOrderReceivedEmail, sendOrderShippedEmail, sendOrderDeliveredEmail, sendPaymentApprovedEmail, sendPaymentDeclinedEmail } = require('../src/services/email');

const LIMIT = 20;
const LEASE_MINUTES = 10;
const MAX_ATTEMPTS = 8;
const BACKOFF_MINUTES = [5, 15, 60, 360];
const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());

const claimNext = ({ idempotencyKey = null } = {}) => withTransaction(async (tx) => {
  const targetClause = idempotencyKey ? ' AND idempotencykey = ?' : '';
  const targetParams = idempotencyKey ? [idempotencyKey] : [];
  const row = await tx.get(`SELECT id, eventtype AS "eventType", orderid AS "orderId", recipientemail AS "recipientEmail", payload, idempotencykey AS "idempotencyKey", attemptcount AS "attemptCount"
    FROM email_outbox
    WHERE ((status = 'pending' AND eligibleat <= CURRENT_TIMESTAMP)
       OR (status = 'processing' AND processingat < CURRENT_TIMESTAMP - INTERVAL '${LEASE_MINUTES} minutes'))${targetClause}
    ORDER BY eligibleat, createdat
    FOR UPDATE SKIP LOCKED LIMIT 1`, targetParams);
  if (!row) return null;
  const claimed = await tx.run(`UPDATE email_outbox SET status = 'processing', processingat = CURRENT_TIMESTAMP, attemptcount = attemptcount + 1, updatedat = CURRENT_TIMESTAMP
    WHERE id = ? AND (status = 'pending' OR (status = 'processing' AND processingat < CURRENT_TIMESTAMP - INTERVAL '${LEASE_MINUTES} minutes'))`, [row.id]);
  return claimed.changes === 1 ? { ...row, attemptCount: Number(row.attemptCount || 0) + 1 } : null;
});

const safeError = (error) => (error?.status === 429 || Number(error?.status) >= 500 || !error?.status ? 'resend_failed' : 'provider_rejected');
const isPermanentProviderError = (error) => Number(error?.status) >= 400 && Number(error?.status) < 500 && Number(error?.status) !== 429;
const retryAt = (attempt) => new Date(Date.now() + (BACKOFF_MINUTES[Math.min(attempt - 1, BACKOFF_MINUTES.length - 1)] * 60000)).toISOString();

const markBlocked = (id, code) => run(`UPDATE email_outbox SET status = 'blocked', processingat = NULL, lastError = ?, updatedat = CURRENT_TIMESTAMP WHERE id = ? AND status = 'processing'`, [code, id]);
const markRetry = (id, attempt, code) => run(`UPDATE email_outbox SET status = ?, processingat = NULL, eligibleat = ?, lastError = ?, updatedat = CURRENT_TIMESTAMP WHERE id = ? AND status = 'processing'`, [attempt >= MAX_ATTEMPTS ? 'blocked' : 'pending', retryAt(attempt), code, id]);
const markSent = (id, providerMessageId) => run(`UPDATE email_outbox SET status = 'sent', processingat = NULL, sentat = CURRENT_TIMESTAMP, lastError = NULL, providerMessageId = ?, updatedat = CURRENT_TIMESTAMP WHERE id = ? AND status = 'processing'`, [providerMessageId || null, id]);

const sendEvent = async (row) => {
  if (!['order_received', 'order_shipped', 'order_delivered', 'payment_approved', 'payment_declined'].includes(row.eventType)) throw Object.assign(new Error('event_type_invalid'), { permanent: true });
  if (!validEmail(row.recipientEmail)) throw Object.assign(new Error('recipient_email_invalid'), { permanent: true });
  const payload = row.payload;
  if (!payload || !payload.order || !Array.isArray(payload.items)) throw Object.assign(new Error('payload_invalid'), { permanent: true });
  const args = { order: payload.order, items: payload.items, accountUrl: payload.order.accountUrl || null, idempotencyKey: row.idempotencyKey };
  if (row.eventType === 'order_received') return sendOrderReceivedEmail(args);
  if (row.eventType === 'order_shipped') return sendOrderShippedEmail(args);
  if (row.eventType === 'payment_approved') return sendPaymentApprovedEmail(args);
  if (row.eventType === 'payment_declined') return sendPaymentDeclinedEmail({ order: payload.order, to: row.recipientEmail, idempotencyKey: row.idempotencyKey });
  return sendOrderDeliveredEmail(args);
};

const processOne = async (row) => {
  try {
    const result = await sendEvent(row);
    await markSent(row.id, result?.id);
    return 'sent';
  } catch (error) {
    if (error?.permanent || isPermanentProviderError(error)) {
      await markBlocked(row.id, error?.permanent ? error.message : 'provider_rejected');
      return 'blocked';
    }
    const code = safeError(error);
    await markRetry(row.id, row.attemptCount, code);
    return row.attemptCount >= MAX_ATTEMPTS ? 'blocked' : 'retry';
  }
};

const processEmailOutbox = async ({ limit = LIMIT, idempotencyKey = null } = {}) => {
  const results = [];
  for (let index = 0; index < limit; index += 1) {
    const row = await claimNext({ idempotencyKey });
    if (!row) break;
    results.push({ id: row.id, result: await processOne(row) });
  }
  return results;
};

if (require.main === module) {
  processEmailOutbox().then((results) => {
    const summary = results.reduce((counts, item) => { counts[item.result] = (counts[item.result] || 0) + 1; return counts; }, {});
    console.log(`Email outbox worker finished: ${results.length} processed.`, summary);
  }).catch((error) => { console.error('Email outbox worker failed:', error.message); process.exitCode = 1; })
    .finally(() => pool.end().catch(() => undefined));
}

module.exports = { processEmailOutbox, claimNext, retryAt };
