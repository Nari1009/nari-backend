const crypto = require('crypto');
const { all, get, run } = require('../db/init');

const ADMIN_SESSION_COOKIE = 'nari_admin_session';
const ADMIN_SESSION_HOURS = 12;
const normalizeAdminEmail = (email) => String(email || '').trim().toLowerCase();
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const passwordHash = (password) => {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return `scrypt$${salt}$${derived}`;
};
const verifyPassword = (password, encoded) => {
  const [, salt, expected] = String(encoded || '').split('$');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(String(password || ''), salt, 64, { N: 16384, r: 8, p: 1 });
  const expectedBuffer = Buffer.from(expected, 'hex');
  return actual.length === expectedBuffer.length && crypto.timingSafeEqual(actual, expectedBuffer);
};
const publicAdmin = (admin) => ({ id: admin.id, name: admin.name, email: admin.email, role: admin.role });

const ensureAdminSchema = async () => {
  await run(`CREATE TABLE IF NOT EXISTS admin_users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    passwordHash TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'super_admin' CHECK (role = 'super_admin'),
    isActive INTEGER NOT NULL DEFAULT 1,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
    updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
    lastLoginAt TEXT
  )`);
  await run(`CREATE TABLE IF NOT EXISTS admin_sessions (
    id TEXT PRIMARY KEY,
    adminUserId TEXT NOT NULL,
    expiresAt TEXT NOT NULL,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
    lastUsedAt TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (adminUserId) REFERENCES admin_users(id) ON DELETE CASCADE
  )`);
};

const strongAdminPassword = (password) => String(password || '').length >= 12 && /[A-Z]/.test(password) && /[a-z]/.test(password) && /\d/.test(password) && /[^A-Za-z0-9]/.test(password);

const ensureAdminUser = async () => {
  await ensureAdminSchema();
  const existing = await get('SELECT id FROM admin_users LIMIT 1');
  if (existing) return;
  const email = normalizeAdminEmail(process.env.SUPER_ADMIN_EMAIL);
  const password = String(process.env.SUPER_ADMIN_PASSWORD || '');
  const name = String(process.env.SUPER_ADMIN_NAME || 'Super Admin').trim() || 'Super Admin';
  if (!email || !strongAdminPassword(password)) {
    console.warn('⚠ No se creó el super admin: configura SUPER_ADMIN_EMAIL y SUPER_ADMIN_PASSWORD (mínimo 12 caracteres, mayúscula, minúscula, número y símbolo).');
    return;
  }
  await run('INSERT INTO admin_users (id, email, passwordHash, name) VALUES (?, ?, ?, ?)', [`admin-${crypto.randomBytes(12).toString('hex')}`, email, passwordHash(password), name]);
  console.log(`✓ Super admin creado para ${email}`);
};

const createAdminSession = async (adminId, res) => {
  const raw = crypto.randomBytes(32).toString('base64url');
  const maxAge = ADMIN_SESSION_HOURS * 60 * 60 * 1000;
  const expiresAt = new Date(Date.now() + maxAge).toISOString();
  await run('INSERT INTO admin_sessions (id, adminUserId, expiresAt) VALUES (?, ?, ?)', [hashToken(raw), adminId, expiresAt]);
  res.cookie(ADMIN_SESSION_COOKIE, raw, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', maxAge, path: '/' });
};

module.exports = { ADMIN_SESSION_COOKIE, normalizeAdminEmail, passwordHash, verifyPassword, publicAdmin, ensureAdminSchema, ensureAdminUser, createAdminSession, hashToken, all, get, run };
