const express = require('express');
const crypto = require('crypto');
const { get, run } = require('../db/init');
const router = express.Router();

// Adaptador interno: la pasarela real deberá llamar este endpoint después de validar su firma.
router.post('/webhook', async (req, res, next) => {
  try {
    const configuredSecret = process.env.PAYMENT_WEBHOOK_SECRET;
    const receivedSecret = req.get('x-payment-webhook-secret');
    if (!configuredSecret || !receivedSecret || receivedSecret.length !== configuredSecret.length || !crypto.timingSafeEqual(Buffer.from(receivedSecret), Buffer.from(configuredSecret))) return res.status(401).json({ error: 'Webhook no autorizado.' });
    const event = req.body || {};
    const paymentStatus = { paid: 'Pagado', approved: 'Pagado', failed: 'Cancelado', rejected: 'Cancelado', refunded: 'Cancelado' }[String(event.status || '').toLowerCase()];
    if (!event.orderId || !paymentStatus) return res.status(400).json({ error: 'Evento de pago inválido.' });
    const result = await run('UPDATE orders SET status = ? WHERE id = ? AND status IN (?, ?)', [paymentStatus, event.orderId, 'Pendiente', 'Pagado']);
    if (!result.changes) return res.status(404).json({ error: 'Pedido no encontrado o ya procesado.' });
    res.json({ received: true });
  } catch (error) { next(error); }
});
module.exports = router;
