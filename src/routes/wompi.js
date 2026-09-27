const express = require('express');
const { get } = require('../db/init');
const { SESSION_COOKIE, hashToken } = require('../services/auth');
const { cookieValue } = require('../middleware/clientAuth');
const { getAppUrl } = require('../services/appUrl');
const { getWompiConfig } = require('../services/wompiConfig');
const { createIntegritySignature, wompiReferenceForPaymentId } = require('../services/wompiSignature');
const { verifyCheckoutAccessToken } = require('../services/checkoutAccessToken');

const router = express.Router();

const findSessionUser = async (req) => {
  const raw = cookieValue(req.headers.cookie, SESSION_COOKIE);
  if (!raw) return null;
  const session = await get(`SELECT auth_sessions.userid AS "userId", auth_sessions.expiresat AS "expiresAt", auth_users.isactive AS "isActive"
    FROM auth_sessions JOIN auth_users ON auth_users.id = auth_sessions.userid WHERE auth_sessions.id = ?`, [hashToken(raw)]);
  if (!session || !session.isActive || new Date(session.expiresAt).getTime() <= Date.now()) return null;
  return { id: session.userId };
};

router.post('/wompi/widget-config', async (req, res, next) => {
  try {
    const { publicKey, integritySecret } = getWompiConfig();
    const paymentId = String(req.body?.paymentId || '').trim();
    if (!/^payment-[a-f0-9]{24}$/.test(paymentId)) return res.status(400).json({ error: 'El Payment ID no es válido.' });
    const payment = await get(`SELECT p.id, p.orderid AS "orderId", p.provider, p.status, p.amount, p.currency,
      p.providerreference AS "providerReference", o.userid AS "userId"
      FROM payments p JOIN orders o ON o.id = p.orderid WHERE p.id = ?`, [paymentId]);
    if (!payment) return res.status(404).json({ error: 'El intento de pago no existe.' });

    const sessionUser = await findSessionUser(req);
    if (sessionUser) {
      if (payment.userId !== sessionUser.id) return res.status(403).json({ error: 'No tienes acceso a este pago.' });
    } else {
      const access = verifyCheckoutAccessToken(req.body?.checkoutAccessToken);
      if (!access || access.paymentId !== payment.id || access.orderId !== payment.orderId) return res.status(401).json({ error: 'Se requiere autorización del checkout.' });
    }

    if (payment.provider !== 'WOMPI') return res.status(409).json({ error: 'El intento no está configurado para Wompi.' });
    if (payment.status !== 'CREATED') return res.status(409).json({ error: 'El intento de pago ya no está disponible.' });
    if (payment.currency !== 'COP' || !payment.providerReference) return res.status(409).json({ error: 'El intento de pago no tiene datos Wompi válidos.' });
    const reference = wompiReferenceForPaymentId(payment.id);
    if (payment.providerReference !== reference) return res.status(409).json({ error: 'La referencia Wompi no coincide con el Payment.' });
    const amountInCents = String(payment.amount);
    const integritySignature = createIntegritySignature({ reference, amountInCents, currency: payment.currency, integritySecret });
    const redirectUrl = `${getAppUrl()}/checkout/success?paymentId=${encodeURIComponent(payment.id)}`;
    res.json({ publicKey, currency: payment.currency, amountInCents: Number(amountInCents), reference, integritySignature, redirectUrl });
  } catch (error) { next(error); }
});

router.post('/status', async (req, res, next) => {
  try {
    const paymentId = String(req.body?.paymentId || '').trim();
    if (!/^payment-[a-f0-9]{24}$/.test(paymentId)) return res.status(400).json({ error: 'El Payment ID no es válido.' });
    const sessionUser = await findSessionUser(req);
    const access = sessionUser ? null : verifyCheckoutAccessToken(req.body?.checkoutAccessToken);
    if (!sessionUser && (!access || access.paymentId !== paymentId)) return res.status(401).json({ error: 'Se requiere autorización del checkout.' });
    const scopeValue = sessionUser ? sessionUser.id : access.orderId;
    const scopeClause = sessionUser ? 'o.userid = ?' : 'p.orderid = ?';
    const payment = await get(`SELECT p.id, p.orderid AS "orderId", p.status AS "paymentStatus", p.providerstatus AS "providerStatus",
      o.ordernumber AS "orderNumber", o.userid AS "userId", r.status AS "reservationStatus"
      FROM payments p JOIN orders o ON o.id = p.orderid
      LEFT JOIN stock_reservations r ON r.orderid = p.orderid
      WHERE p.id = ? AND ${scopeClause}`, [paymentId, scopeValue]);
    if (!payment) return res.status(404).json({ error: 'El intento de pago no existe.' });
    if (!sessionUser && access.orderId !== payment.orderId) return res.status(401).json({ error: 'Se requiere autorización del checkout.' });

    return res.json({
      paymentId: payment.id,
      paymentStatus: payment.paymentStatus,
      providerStatus: payment.providerStatus || null,
      orderId: payment.orderId,
      orderNumber: payment.orderNumber,
      reservationStatus: payment.reservationStatus || null,
    });
  } catch (error) { return next(error); }
});

module.exports = router;
