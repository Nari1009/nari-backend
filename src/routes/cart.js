const express = require('express');
const crypto = require('crypto');
const { all, get, run } = require('../db/init');

const router = express.Router();
const id = () => `cart-${crypto.randomBytes(18).toString('hex')}`;

router.post('/abandoned', async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const items = Array.isArray(req.body?.items) ? req.body.items.filter((item) => item && typeof item.productId === 'string' && Number.isInteger(item.quantity) && item.quantity > 0).slice(0, 30).map((item) => ({ productId: item.productId, name: String(item.name || '').slice(0, 180), quantity: item.quantity, unitPrice: Number(item.unitPrice || 0) })) : [];
    if (!/^\S+@\S+\.\S+$/.test(email) || !items.length) return res.status(400).json({ error: 'Se necesita un correo válido y al menos un producto.' });
    const now = new Date().toISOString();
    let cart = await get("SELECT id FROM abandoned_carts WHERE email = ? AND (convertedAt IS NULL OR trim(CAST(convertedAt AS TEXT)) = '') ORDER BY updatedAt DESC LIMIT 1", [email]);
    if (cart) {
      await run('UPDATE abandoned_carts SET items = ?, lastActivityAt = ?, reminder1SentAt = NULL, reminder2SentAt = NULL, updatedAt = CURRENT_TIMESTAMP WHERE id = ?', [JSON.stringify(items), now, cart.id]);
    } else {
      cart = { id: id() };
      await run('INSERT INTO abandoned_carts (id, email, items, lastActivityAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)', [cart.id, email, JSON.stringify(items), now]);
    }
    res.status(201).json({ id: cart.id });
  } catch (error) { next(error); }
});

module.exports = router;
