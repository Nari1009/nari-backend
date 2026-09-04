const crypto = require('crypto');

const getEncryptionKey = () => {
  const value = String(process.env.REVIEW_TOKEN_ENCRYPTION_KEY || '').trim();
  if (!value) throw new Error('Review token encryption is not configured.');
  let key;
  try { key = Buffer.from(value, 'base64'); } catch { throw new Error('Review token encryption key is invalid.'); }
  if (key.length !== 32) throw new Error('Review token encryption key must decode to 32 bytes.');
  return key;
};

const generateReviewToken = () => crypto.randomBytes(32).toString('base64url');
const hashReviewToken = (rawToken) => crypto.createHash('sha256').update(String(rawToken)).digest('hex');
const encryptReviewToken = (rawToken) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(rawToken), 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${ciphertext.toString('base64url')}`;
};
const decryptReviewToken = (payload) => {
  const parts = String(payload || '').split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('Review token ciphertext is invalid.');
  const [, ivText, tagText, ciphertextText] = parts;
  const iv = Buffer.from(ivText, 'base64url'); const tag = Buffer.from(tagText, 'base64url'); const ciphertext = Buffer.from(ciphertextText, 'base64url');
  if (iv.length !== 12 || tag.length !== 16 || !ciphertext.length) throw new Error('Review token ciphertext is invalid.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), iv); decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
};

module.exports = { generateReviewToken, hashReviewToken, encryptReviewToken, decryptReviewToken };
