const crypto = require('crypto');
const { all, get, run, withTransaction } = require('../db/init');
const { generateReviewToken, hashReviewToken, encryptReviewToken, decryptReviewToken } = require('./reviewToken');
const { getAppUrl } = require('./appUrl');

const REVIEW_DELAY_DAYS = (() => { const value = Number.parseInt(process.env.REVIEW_REQUEST_DELAY_DAYS || '3', 10); return Number.isInteger(value) && value > 0 ? value : 3; })();
const REVIEW_WINDOW_DAYS = 30;
const LEASE_MS = 10 * 60 * 1000;
const BATCH_LIMIT = 20;
const randomId = () => `review-request-${crypto.randomBytes(12).toString('hex')}`;
const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());

const createReviewRequestForDeliveredOrder = async (tx, order) => {
  const deliveredAt = order.deliveredAt || new Date().toISOString();
  const eligibleAt = new Date(new Date(deliveredAt).getTime() + REVIEW_DELAY_DAYS * 86400000).toISOString();
  const expiresAt = new Date(new Date(eligibleAt).getTime() + REVIEW_WINDOW_DAYS * 86400000).toISOString();
  const result = await tx.run(`INSERT INTO order_review_requests (id, orderid, userid, status, eligibleat, expiresat, attemptcount, createdat)
    VALUES (?, ?, ?, 'pending', ?, ?, 0, CURRENT_TIMESTAMP) ON CONFLICT (orderid) DO NOTHING`, [randomId(), order.id, order.userId || null, eligibleAt, expiresAt]);
  if (result.changes > 1) throw new Error('Unexpected review request insert result.');
  return result.changes === 1;
};

const claimNextReviewRequest = async () => withTransaction(async (tx) => {
  const request = await tx.get(`SELECT id, orderid AS "orderId", userid AS "userId", tokenhash AS "tokenHash", tokenciphertext AS "tokenCiphertext", status, eligibleat AS "eligibleAt", sentat AS "sentAt", processingat AS "processingAt", expiresat AS "expiresAt", completedat AS "completedAt", attemptcount AS "attemptCount", lasterror AS "lastError"
    FROM order_review_requests
    WHERE ((status = 'pending' AND eligibleat <= CURRENT_TIMESTAMP)
        OR (status = 'processing' AND processingat < CURRENT_TIMESTAMP - INTERVAL '10 minutes'))
    ORDER BY eligibleat, createdat
    FOR UPDATE SKIP LOCKED LIMIT 1`);
  if (!request) return null;
  const claimed = await tx.run(`UPDATE order_review_requests SET status = 'processing', processingat = CURRENT_TIMESTAMP, attemptcount = attemptcount + 1 WHERE id = ? AND (status = 'pending' OR (status = 'processing' AND processingat < CURRENT_TIMESTAMP - INTERVAL '10 minutes'))`, [request.id]);
  return claimed.changes === 1 ? { ...request, status: 'processing', attemptCount: Number(request.attemptCount || 0) + 1 } : null;
});

const setRequest = (id, fields, expectedStatus = 'processing') => {
  const entries = Object.entries(fields); const values = entries.map(([, value]) => value);
  return run(`UPDATE order_review_requests SET ${entries.map(([key]) => `${key} = ?`).join(', ')} WHERE id = ? AND status = ?`, [...values, id, expectedStatus]);
};
const blockReviewRequest = (id, code) => setRequest(id, { status: 'blocked', processingat: null, lasterror: code });
const releaseReviewRequestForRetry = (id, code) => setRequest(id, { status: 'pending', processingat: null, lasterror: code });
const markReviewRequestSent = (id) => setRequest(id, { status: 'sent', sentat: new Date().toISOString(), processingat: null, tokenciphertext: null, lasterror: null });
const loadOrderForRequest = (orderId) => get(`SELECT id, status, deliveredat AS "deliveredAt", userid AS "userId", customeremailsnapshot AS "customerEmailSnapshot", customerfirstnamesnapshot AS "customerFirstNameSnapshot" FROM orders WHERE id = ?`, [orderId]);
const loadEligibleProducts = async (orderId) => all(`SELECT DISTINCT ON (oi.productid) oi.productid AS "productId", oi.productname AS "productName"
  FROM order_items oi WHERE oi.orderid = ? ORDER BY oi.productid, oi.id`, [orderId]);
const loadReviewState = async (orderId, productIds) => {
  if (!productIds.length) return new Set();
  const rows = await all(`SELECT productid AS "productId" FROM reviews WHERE orderid = ? AND productid = ANY(?)`, [orderId, productIds]);
  return new Set(rows.map((row) => row.productId));
};
const prepareToken = async (request) => {
  if (!request.tokenHash && !request.tokenCiphertext) {
    const rawToken = generateReviewToken();
    await run('UPDATE order_review_requests SET tokenhash = ?, tokenciphertext = ? WHERE id = ? AND status = \'processing\' AND tokenhash IS NULL AND tokenciphertext IS NULL', [hashReviewToken(rawToken), encryptReviewToken(rawToken), request.id]);
    return { rawToken, tokenHash: hashReviewToken(rawToken) };
  }
  if (!request.tokenHash || !request.tokenCiphertext) throw new Error('token_state_invalid');
  return { rawToken: decryptReviewToken(request.tokenCiphertext), tokenHash: request.tokenHash };
};
const processOne = async ({ request, sendReviewRequestEmail }) => {
  if (new Date(request.expiresAt).getTime() <= Date.now()) { await blockReviewRequest(request.id, 'expired_before_send'); return 'blocked'; }
  const order = await loadOrderForRequest(request.orderId);
  if (!order) { await blockReviewRequest(request.id, 'missing_order'); return 'blocked'; }
  if (order.status !== 'Entregado') { await blockReviewRequest(request.id, 'order_not_eligible'); return 'blocked'; }
  if (!order.deliveredAt) { await blockReviewRequest(request.id, 'missing_delivered_at'); return 'blocked'; }
  const products = await loadEligibleProducts(order.id);
  if (!products.length) { await blockReviewRequest(request.id, 'no_eligible_products'); return 'blocked'; }
  const reviewed = await loadReviewState(order.id, products.map((item) => item.productId));
  if (reviewed.size === products.length) { await setRequest(request.id, { status: 'completed', completedat: new Date().toISOString(), processingat: null, lasterror: null }); return 'completed'; }
  const email = String(order.customerEmailSnapshot || '').trim();
  if (!email) { await blockReviewRequest(request.id, 'missing_email_snapshot'); return 'blocked'; }
  if (!validEmail(email)) { await blockReviewRequest(request.id, 'invalid_email_snapshot'); return 'blocked'; }
  let token;
  try { token = await prepareToken(request); } catch (error) { await blockReviewRequest(request.id, error.message === 'token_state_invalid' ? 'token_state_invalid' : 'token_encryption_failed'); return 'blocked'; }
  let baseUrl;
  try { baseUrl = getAppUrl(); } catch { await blockReviewRequest(request.id, 'missing_client_app_url'); return 'blocked'; }
  try {
    await sendReviewRequestEmail({ to: email, customerName: order.customerFirstNameSnapshot, orderReference: order.id, products, reviewUrl: `${baseUrl}/review/${encodeURIComponent(token.rawToken)}`, idempotencyKey: `review-request/${request.id}` });
  } catch (error) { await releaseReviewRequestForRetry(request.id, 'resend_failed'); return 'retry'; }
  await markReviewRequestSent(request.id); return 'sent';
};
const processReviewRequests = async ({ sendReviewRequestEmail, limit = BATCH_LIMIT } = {}) => {
  const sender = sendReviewRequestEmail || require('./email').sendReviewRequestEmail;
  const results = [];
  for (let index = 0; index < limit; index += 1) {
    const request = await claimNextReviewRequest(); if (!request) break;
    try { results.push({ id: request.id, result: await processOne({ request, sendReviewRequestEmail: sender }) }); }
    catch (error) { await releaseReviewRequestForRetry(request.id, 'worker_error'); results.push({ id: request.id, result: 'retry' }); }
  }
  return results;
};

const findRequestByToken = async (rawToken) => get(`SELECT id, orderid AS "orderId", userid AS "userId", status, expiresat AS "expiresAt" FROM order_review_requests WHERE tokenhash = ?`, [hashReviewToken(rawToken)]);
const completeIfReviewed = async (requestId, orderId) => {
  const products = await loadEligibleProducts(orderId); const reviewed = await loadReviewState(orderId, products.map((item) => item.productId));
  if (products.length && reviewed.size === products.length) await run("UPDATE order_review_requests SET status = 'completed', completedat = COALESCE(completedat, CURRENT_TIMESTAMP) WHERE id = ? AND status = 'sent'", [requestId]);
};
module.exports = { REVIEW_DELAY_DAYS, REVIEW_WINDOW_DAYS, LEASE_MS, BATCH_LIMIT, createReviewRequestForDeliveredOrder, claimNextReviewRequest, processReviewRequests, findRequestByToken, loadOrderForRequest, loadEligibleProducts, loadReviewState, completeIfReviewed };
