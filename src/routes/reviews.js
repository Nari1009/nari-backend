const express = require('express');
const crypto = require('crypto');
const { all, get, run } = require('../db/init');
const { hashToken } = require('../services/auth');
const { sendReviewLinkEmail } = require('../services/email');
const { requireUser } = require('../middleware/clientAuth');

const router = express.Router();
const linkQuery = `SELECT review_links.id, review_links.orderId, review_links.userId, orders.status, orders.createdAt, auth_users.firstName, auth_users.email FROM review_links JOIN orders ON orders.id = review_links.orderId JOIN auth_users ON auth_users.id = review_links.userId WHERE review_links.tokenHash = ? AND review_links.expiresAt > ?`;

const loadLink = async (token) => get(linkQuery, [hashToken(token), new Date().toISOString()]);

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
