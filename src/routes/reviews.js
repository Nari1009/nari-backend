const express = require('express');
const crypto = require('crypto');
const { all, get, run } = require('../db/init');
const { hashToken } = require('../services/auth');
const { sendReviewLinkEmail } = require('../services/email');
const { hashReviewToken } = require('../services/reviewToken');
const { completeIfReviewed } = require('../services/reviewRequests');
const { withTransaction } = require('../db/init');
const { requireUser } = require('../middleware/clientAuth');

const router = express.Router();
const linkQuery = `SELECT review_links.id, review_links.orderId, review_links.userId, orders.status, orders.createdAt, auth_users.firstName, auth_users.email FROM review_links JOIN orders ON orders.id = review_links.orderId JOIN auth_users ON auth_users.id = review_links.userId WHERE review_links.tokenHash = ? AND review_links.expiresAt > ?`;

const loadLink = async (token) => get(linkQuery, [hashToken(token), new Date().toISOString()]);
const neutralError = 'El enlace no es válido, expiró o ya no está disponible.';
const loadAutomaticRequest = async (rawToken) => {
  const request = rawToken ? await get('SELECT id, orderid AS "orderId", userid AS "userId", status, expiresat AS "expiresAt" FROM order_review_requests WHERE tokenhash = ?', [hashReviewToken(rawToken)]) : null;
  if (!request || !['sent', 'completed'].includes(request.status) || new Date(request.expiresAt).getTime() <= Date.now()) return null;
  const order = await get('SELECT id, status, deliveredat AS "deliveredAt" FROM orders WHERE id = ?', [request.orderId]);
  if (!order || order.status !== 'Entregado' || !order.deliveredAt) return null;
  return { request, order };
};

router.get('/request', async (req, res, next) => {
  try {
    const loaded = await loadAutomaticRequest(String(req.query?.token || ''));
    if (!loaded) return res.status(400).json({ error: neutralError });
    const products = await all('SELECT DISTINCT ON (oi.productid) oi.productid AS "productId", oi.productname AS "name" FROM order_items oi WHERE oi.orderid = ? ORDER BY oi.productid, oi.id', [loaded.order.id]);
    const ids = products.map((product) => product.productId);
    const reviewed = ids.length ? await all(`SELECT productid AS "productId" FROM reviews WHERE orderid = ? AND productid IN (${ids.map(() => '?').join(',')})`, [loaded.order.id, ...ids]) : [];
    const reviewedIds = new Set(reviewed.map((row) => row.productId));
    res.json({ status: loaded.request.status, products: products.map((product) => ({ ...product, reviewed: reviewedIds.has(product.productId) })) });
  } catch (error) { next(error); }
});

router.post('/request', async (req, res, next) => {
  try {
    const token = String(req.body?.token || ''); const payload = Array.isArray(req.body?.reviews) ? req.body.reviews : [];
    if (!token || !payload.length || payload.length > 50) return res.status(400).json({ error: 'La solicitud de reseña no es válida.' });
    const result = await withTransaction(async (tx) => {
      const loaded = await tx.get('SELECT id, orderid AS "orderId", userid AS "userId", status, expiresat AS "expiresAt" FROM order_review_requests WHERE tokenhash = ? FOR UPDATE', [hashReviewToken(token)]);
      if (!loaded || !['sent', 'completed'].includes(loaded.status) || new Date(loaded.expiresAt).getTime() <= Date.now()) return { error: neutralError, status: 400 };
      const order = await tx.get('SELECT id, status, deliveredat AS "deliveredAt" FROM orders WHERE id = ?', [loaded.orderId]);
      if (!order || order.status !== 'Entregado' || !order.deliveredAt) return { error: neutralError, status: 400 };
      const products = await tx.all('SELECT DISTINCT ON (oi.productid) oi.productid AS "productId" FROM order_items oi WHERE oi.orderid = ? ORDER BY oi.productid, oi.id', [order.id]);
      const productIds = new Set(products.map((item) => item.productId)); const submitted = new Map();
      for (const item of payload) {
        const productId = String(item?.productId || ''); const rating = Number(item?.rating); const comment = String(item?.comment || '').trim();
        if (!productIds.has(productId)) return { error: 'Uno de los productos no pertenece a este pedido.', status: 400 };
        if (submitted.has(productId)) return { error: 'No puedes enviar el mismo producto más de una vez.', status: 400 };
        if (!Number.isInteger(rating) || rating < 1 || rating > 5 || comment.length > 2000) return { error: 'Revisa la valoración y el comentario.', status: 400 };
        submitted.set(productId, { rating, comment });
      }
      const existing = await tx.all(`SELECT productid AS "productId" FROM reviews WHERE orderid = ? AND productid IN (${[...submitted.keys()].map(() => '?').join(',')})`, [order.id, ...submitted.keys()]);
      if (existing.length) return { error: 'Uno de los productos ya fue valorado.', status: 409 };
      for (const [productId, review] of submitted) {
        await tx.run('INSERT INTO reviews (id, orderid, userid, productid, rating, comment) VALUES (?, ?, ?, ?, ?, ?)', [`review-${crypto.randomBytes(12).toString('hex')}`, order.id, loaded.userId || null, productId, review.rating, review.comment]);
        const average = await tx.get('SELECT ROUND(AVG(rating), 1) AS rating, COUNT(*) AS reviewCount FROM reviews WHERE productid = ?', [productId]);
        await tx.run('UPDATE products SET rating = ?, reviewcount = ?, updatedat = CURRENT_TIMESTAMP WHERE id = ?', [average.rating || 0, average.reviewCount || 0, productId]);
      }
      const eligibleCount = products.length; const reviewedCount = await tx.get(`SELECT COUNT(DISTINCT productid) AS count FROM reviews WHERE orderid = ? AND productid IN (${products.map(() => '?').join(',')})`, [order.id, ...products.map((item) => item.productId)]);
      const completed = Number(reviewedCount.count) === eligibleCount;
      if (completed) await tx.run("UPDATE order_review_requests SET status = 'completed', completedat = COALESCE(completedat, CURRENT_TIMESTAMP) WHERE id = ? AND status = 'sent'", [loaded.id]);
      return { productIds: [...submitted.keys()], completed };
    });
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.status(201).json(result);
  } catch (error) { next(error); }
});

router.get('/link', async (req, res, next) => {
  try {
    const token = String(req.query?.token || '');
    const link = token ? await loadLink(token) : null;
    if (!link || link.status !== 'Entregado') return res.status(400).json({ error: 'El enlace no es válido, expiró o el pedido aún no está entregado.' });
    const products = await all(`SELECT order_items.productId, order_items.productName, reviews.rating, reviews.comment FROM order_items LEFT JOIN reviews ON reviews.orderId = order_items.orderId AND reviews.productId = order_items.productId AND reviews.userId = ? WHERE order_items.orderId = ? ORDER BY order_items.id`, [link.userId, link.orderId]);
    res.json({ orderId: link.orderId, customerName: link.firstName, products });
  } catch (error) { next(error); }
});

router.post('/', requireUser, async (req, res, next) => {
  try {
    const token = String(req.body?.token || '');
    const productId = String(req.body?.productId || '');
    const rating = Number(req.body?.rating);
    const comment = String(req.body?.comment || '').trim().slice(0, 2000);
    const link = token ? await loadLink(token) : null;
    if (!link || link.status !== 'Entregado' || link.userId !== req.user.id) return res.status(400).json({ error: 'El enlace no es válido o el pedido aún no está entregado.' });
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ error: 'La valoración debe estar entre 1 y 5 estrellas.' });
    const item = await get('SELECT productId FROM order_items WHERE orderId = ? AND productId = ?', [link.orderId, productId]);
    if (!item) return res.status(400).json({ error: 'Este producto no pertenece al pedido.' });
    if (await get('SELECT id FROM reviews WHERE orderId = ? AND userId = ? AND productId = ?', [link.orderId, req.user.id, productId])) return res.status(409).json({ error: 'Este producto ya fue valorado.' });
    await run('INSERT INTO reviews (id, orderId, userId, productId, rating, comment) VALUES (?, ?, ?, ?, ?, ?)', [`review-${crypto.randomBytes(12).toString('hex')}`, link.orderId, req.user.id, productId, rating, comment]);
    const average = await get('SELECT ROUND(AVG(rating), 1) AS rating, COUNT(*) AS reviewCount FROM reviews WHERE productId = ?', [productId]);
    await run('UPDATE products SET rating = ?, reviewCount = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?', [average.rating || 0, average.reviewCount || 0, productId]);
    res.status(201).json({ productId, rating: average.rating, reviewCount: average.reviewCount });
  } catch (error) { next(error); }
});

module.exports = router;
