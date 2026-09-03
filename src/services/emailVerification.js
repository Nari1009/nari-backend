const crypto = require('crypto');
const { get, run } = require('../db/init');
const { hashToken } = require('./auth');

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;

const clientAppUrl = () => String(process.env.APP_URL || '').trim().replace(/\/$/, '');

const createEmailVerification = async (userId) => {
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + VERIFICATION_TTL_MS).toISOString();
  await run('DELETE FROM email_verification_tokens WHERE userid = ? AND usedat IS NULL', [userId]);
  await run('INSERT INTO email_verification_tokens (id, userid, tokenhash, expiresat) VALUES (?, ?, ?, ?)', [`verify-${crypto.randomBytes(12).toString('hex')}`, userId, tokenHash, expiresAt]);
  return { rawToken, expiresAt };
};

const canResendEmailVerification = async (userId) => {
  const latest = await get('SELECT createdat AS "createdAt" FROM email_verification_tokens WHERE userid = ? ORDER BY createdat DESC LIMIT 1', [userId]);
  return !latest || Date.now() - new Date(latest.createdAt).getTime() >= RESEND_COOLDOWN_MS;
};

module.exports = { VERIFICATION_TTL_MS, RESEND_COOLDOWN_MS, clientAppUrl, createEmailVerification, canResendEmailVerification };
