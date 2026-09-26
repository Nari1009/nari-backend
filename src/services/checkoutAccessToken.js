const crypto = require('crypto');

const TOKEN_VERSION = 'v1';
const TOKEN_TTL_SECONDS = 30 * 60;

const getSecret = () => {
  const secret = String(process.env.CHECKOUT_ACCESS_SECRET || '').trim();
  if (secret.length < 32) throw new Error('CHECKOUT_ACCESS_SECRET must contain at least 32 characters.');
  return secret;
};

const assertCheckoutAccessSecret = () => { getSecret(); };

const sign = (value, secret) => crypto.createHmac('sha256', secret).update(value, 'utf8').digest('base64url');

const createCheckoutAccessToken = ({ orderId, paymentId, expiresAt = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS }) => {
  const normalizedOrderId = String(orderId || '').trim();
  const normalizedPaymentId = String(paymentId || '').trim();
  const expiration = Number(expiresAt);
  if (!normalizedOrderId || !normalizedPaymentId || !Number.isSafeInteger(expiration) || expiration <= Math.floor(Date.now() / 1000)) {
    throw new Error('Los datos del token de checkout no son válidos.');
  }
  const payload = Buffer.from(JSON.stringify({ version: 1, orderId: normalizedOrderId, paymentId: normalizedPaymentId, expiresAt: expiration }), 'utf8').toString('base64url');
  const unsigned = `${TOKEN_VERSION}.${payload}`;
  return `${unsigned}.${sign(unsigned, getSecret())}`;
};

const verifyCheckoutAccessToken = (token) => {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) return null;
    const unsigned = `${parts[0]}.${parts[1]}`;
    const expected = Buffer.from(sign(unsigned, getSecret()));
    const received = Buffer.from(parts[2]);
    if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (payload?.version !== 1 || typeof payload.orderId !== 'string' || typeof payload.paymentId !== 'string' || !Number.isSafeInteger(payload.expiresAt) || payload.expiresAt <= Math.floor(Date.now() / 1000)) return null;
    return { version: payload.version, orderId: payload.orderId, paymentId: payload.paymentId, expiresAt: payload.expiresAt };
  } catch {
    return null;
  }
};

module.exports = { TOKEN_TTL_SECONDS, assertCheckoutAccessSecret, createCheckoutAccessToken, verifyCheckoutAccessToken };
