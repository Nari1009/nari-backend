const { withTransaction, run } = require('../db/init');
const { sendAbandonedCartEmail } = require('./email');
const { getAppUrl } = require('./appUrl');

const LEASE_MINUTES = 10;
const MAX_ATTEMPTS = 8;
const BACKOFF_MINUTES = [5, 15, 60, 360];

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
const reminderStage = (cart) => (cart.reminder1SentAt || cart.reminder1sentat ? 2 : 1);
const idempotencyKey = (cartId, stage) => `abandoned-cart/${cartId}/day-${stage === 1 ? 1 : 3}`;
const retryAt = (attempt) => new Date(Date.now() + BACKOFF_MINUTES[Math.min(attempt - 1, BACKOFF_MINUTES.length - 1)] * 60000).toISOString();

const claimNext = () => withTransaction(async (tx) => {
  const row = await tx.get(`
    SELECT a.id, a.email, a.items, a.reminder1sentat AS "reminder1SentAt", a.reminder2sentat AS "reminder2SentAt",
      a.status, a.processingat AS "processingAt", a.nextattemptat AS "nextAttemptAt",
      a.firstreminderattemptcount AS "firstReminderAttemptCount", a.secondreminderattemptcount AS "secondReminderAttemptCount"
    FROM abandoned_carts a
    WHERE COALESCE(a.status, 'active') = 'active'
      AND (a.convertedat IS NULL OR trim(CAST(a.convertedat AS TEXT)) = '')
      AND (a.processingat IS NULL OR a.processingat < CURRENT_TIMESTAMP - INTERVAL '${LEASE_MINUTES} minutes')
      AND (a.nextattemptat IS NULL OR a.nextattemptat <= CURRENT_TIMESTAMP)
      AND (
        (a.reminder1sentat IS NULL AND a.lastactivityat <= CURRENT_TIMESTAMP - INTERVAL '1 day')
        OR
        (a.reminder1sentat IS NOT NULL AND a.reminder2sentat IS NULL AND a.lastactivityat <= CURRENT_TIMESTAMP - INTERVAL '3 days')
      )
      AND a.id = (
        SELECT canonical.id
        FROM abandoned_carts canonical
        WHERE COALESCE(canonical.status, 'active') = 'active'
          AND (canonical.convertedat IS NULL OR trim(CAST(canonical.convertedat AS TEXT)) = '')
          AND COALESCE(canonical.normalizedemail, lower(trim(canonical.email))) = COALESCE(a.normalizedemail, lower(trim(a.email)))
        ORDER BY canonical.lastactivityat DESC, canonical.updatedat DESC, canonical.id DESC
        LIMIT 1
      )
    ORDER BY a.lastactivityat ASC, a.updatedat ASC, a.id ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1`);
  if (!row) return null;
  const stage = reminderStage(row);
  const attemptColumn = stage === 1 ? 'firstreminderattemptcount' : 'secondreminderattemptcount';
  const claimed = await tx.run(`UPDATE abandoned_carts
    SET processingstage = ?, processingat = CURRENT_TIMESTAMP, ${attemptColumn} = COALESCE(${attemptColumn}, 0) + 1,
        nextattemptat = NULL, updatedat = CURRENT_TIMESTAMP
    WHERE id = ? AND COALESCE(status, 'active') = 'active'
      AND (processingat IS NULL OR processingat < CURRENT_TIMESTAMP - INTERVAL '${LEASE_MINUTES} minutes')`, [String(stage), row.id]);
  const previousAttempts = stage === 1 ? row.firstReminderAttemptCount : row.secondReminderAttemptCount;
  return claimed.changes === 1 ? { ...row, stage, attemptCount: Number(previousAttempts || 0) + 1 } : null;
});

const markSent = (cart, stage) => {
  const sentColumn = stage === 1 ? 'reminder1sentat' : 'reminder2sentat';
  const finalState = stage === 2 ? ", status = 'completed', completedat = CURRENT_TIMESTAMP" : '';
  return run(`UPDATE abandoned_carts
    SET ${sentColumn} = CURRENT_TIMESTAMP, processingstage = NULL, processingat = NULL,
        nextattemptat = NULL, lasterror = NULL, updatedat = CURRENT_TIMESTAMP${finalState}
    WHERE id = ? AND COALESCE(status, 'active') = 'active' AND processingstage = ?`, [cart.id, String(stage)]);
};

const markRetry = (cart, stage, code) => {
  const attemptColumn = stage === 1 ? 'firstreminderattemptcount' : 'secondreminderattemptcount';
  const nextAttempt = cart.attemptCount >= MAX_ATTEMPTS ? null : retryAt(cart.attemptCount);
  const nextStatus = cart.attemptCount >= MAX_ATTEMPTS ? 'blocked' : 'active';
  return run(`UPDATE abandoned_carts
    SET status = ?, processingstage = NULL, processingat = NULL, nextattemptat = ?, lasterror = ?,
        cancelledat = CASE WHEN ? = 'blocked' THEN CURRENT_TIMESTAMP ELSE cancelledat END,
        updatedat = CURRENT_TIMESTAMP
    WHERE id = ? AND COALESCE(status, 'active') = 'active' AND processingstage = ? AND ${attemptColumn} = ?`,
  [nextStatus, nextAttempt, code, nextStatus, cart.id, String(stage), cart.attemptCount]);
};

const markBlocked = (cart, stage, code) => run(`UPDATE abandoned_carts
  SET status = 'blocked', processingstage = NULL, processingat = NULL, nextattemptat = NULL,
      lasterror = ?, cancelledat = CURRENT_TIMESTAMP, updatedat = CURRENT_TIMESTAMP
  WHERE id = ? AND COALESCE(status, 'active') = 'active' AND processingstage = ?`, [code, cart.id, String(stage)]);

const markRecovered = (id) => run(`UPDATE abandoned_carts
  SET status = 'recovered', recoveredat = CURRENT_TIMESTAMP, processingstage = NULL, processingat = NULL,
      nextattemptat = NULL, updatedat = CURRENT_TIMESTAMP
  WHERE id = ? AND COALESCE(status, 'active') = 'active'
    AND (convertedat IS NULL OR trim(CAST(convertedat AS TEXT)) = '')`, [id]);

const processOne = async (cart) => {
  const stage = cart.stage;
  if (!isValidEmail(cart.email)) { await markBlocked(cart, stage, 'recipient_email_invalid'); return 'blocked'; }
  let items;
  try { items = JSON.parse(cart.items); } catch { items = null; }
  if (!Array.isArray(items) || !items.length) { await markBlocked(cart, stage, 'payload_invalid'); return 'blocked'; }
  try {
    const cartUrl = `${getAppUrl()}/carrito?cart=${encodeURIComponent(cart.id)}`;
    await sendAbandonedCartEmail({ to: normalizeEmail(cart.email), cartUrl, items, reminderNumber: stage, idempotencyKey: idempotencyKey(cart.id, stage) });
    await markSent(cart, stage);
    return stage === 2 ? 'completed' : 'sent';
  } catch (error) {
    await markRetry(cart, stage, error?.status >= 400 && error.status < 500 && error.status !== 429 ? 'provider_rejected' : 'resend_failed');
    return cart.attemptCount >= MAX_ATTEMPTS ? 'blocked' : 'retry';
  }
};

const processAbandonedCarts = async ({ limit = 20 } = {}) => {
  const results = [];
  for (let index = 0; index < limit; index += 1) {
    const cart = await claimNext();
    if (!cart) break;
    results.push({ id: cart.id, stage: cart.stage, result: await processOne(cart) });
  }
  return results;
};

module.exports = { processAbandonedCarts, claimNext, idempotencyKey, markRecovered, normalizeEmail, reminderStage };
