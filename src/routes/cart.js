const express = require('express');
const crypto = require('crypto');
const { get, withTransaction } = require('../db/init');
const { markRecovered, normalizeEmail } = require('../services/abandonedCarts');

const router = express.Router();
const id = () => `cart-${crypto.randomBytes(18).toString('hex')}`;

router.post('/abandoned', async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const items = Array.isArray(req.body?.items) ? req.body.items.filter((item) => item && typeof item.productId === 'string' && Number.isInteger(item.quantity) && item.quantity > 0).slice(0, 30).map((item) => ({ productId: item.productId, name: String(item.name || '').slice(0, 180), quantity: item.quantity, unitPrice: Number(item.unitPrice || 0) })) : [];
    if (!/^\S+@\S+\.\S+$/.test(email) || !items.length) return res.status(400).json({ error: 'Se necesita un correo válido y al menos un producto.' });
    const now = new Date().toISOString();
    const cartId = await withTransaction(async (tx) => {
      await tx.get('SELECT pg_advisory_xact_lock(hashtext(?)) AS locked', [email]);
      let cart = await tx.get(`SELECT id FROM abandoned_carts
        WHERE lower(trim(email)) = ? AND COALESCE(status, 'active') = 'active'
          AND (convertedat IS NULL OR trim(CAST(convertedat AS TEXT)) = '')
        ORDER BY updatedat DESC, id DESC FOR UPDATE LIMIT 1`, [email]);
      if (cart) {
        await tx.run(`UPDATE abandoned_carts SET items = ?, lastactivityat = ?, normalizedemail = ?, updatedat = CURRENT_TIMESTAMP WHERE id = ?`, [JSON.stringify(items), now, email, cart.id]);
      } else {
        cart = { id: id() };
        await tx.run(`INSERT INTO abandoned_carts (id, email, normalizedemail, items, lastactivityat, status, createdat, updatedat)
          VALUES (?, ?, ?, ?, ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`, [cart.id, email, email, JSON.stringify(items), now]);
      }
      return cart.id;
    });
    res.status(201).json({ id: cartId });
  } catch (error) { next(error); }
});

router.get('/abandoned/:id', async (req, res, next) => {
  try {
    const cart = await get(`SELECT id, items FROM abandoned_carts
      WHERE id = ? AND COALESCE(status, 'active') = 'active'
        AND (convertedat IS NULL OR trim(CAST(convertedat AS TEXT)) = '')`, [req.params.id]);
    if (!cart) return res.status(404).json({ error: 'Este carrito ya no está disponible.' });
    await markRecovered(cart.id);
    res.json({ id: cart.id, items: JSON.parse(cart.items) });
  } catch (error) { next(error); }
});

module.exports = router;
