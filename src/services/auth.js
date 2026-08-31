const crypto = require('crypto');

const SESSION_COOKIE = 'nari_session';
const SESSION_DAYS = 7;

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const normalizeEmail = (email) => String(email || '').trim().toLowerCase();
const passwordHash = (password) => {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return `scrypt$${salt}$${derived}`;
};
const verifyPassword = (password, encoded) => {
  const [, salt, expected] = String(encoded || '').split('$');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  const expectedBuffer = Buffer.from(expected, 'hex');
  return actual.length === expectedBuffer.length && crypto.timingSafeEqual(actual, expectedBuffer);
};
const publicUser = (user) => ({ id: user.id, firstName: user.firstName, lastName: user.lastName, email: user.email, phone: user.phone });
const createSession = async (run, userId, res) => {
  const raw = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  await run('INSERT INTO auth_sessions (id, userId, expiresAt) VALUES (?, ?, ?)', [hashToken(raw), userId, expires]);
  res.cookie(SESSION_COOKIE, raw, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: SESSION_DAYS * 86400000, path: '/' });
};

module.exports = { SESSION_COOKIE, hashToken, normalizeEmail, passwordHash, verifyPassword, publicUser, createSession };
