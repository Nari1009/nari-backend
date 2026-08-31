const express = require('express');
const crypto = require('crypto');
const { get, run, normalizeAdminEmail, passwordHash, verifyPassword, publicAdmin, createAdminSession, ADMIN_SESSION_COOKIE, hashToken, ensureAdminSchema } = require('../services/adminAuth');
const { requireAdmin, cookieValue } = require('../middleware/adminAuth');

const router = express.Router();
const validEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const strongPassword = (password) => String(password || '').length >= 12 && /[A-Z]/.test(password) && /[a-z]/.test(password) && /\d/.test(password) && /[^A-Za-z0-9]/.test(password);

router.post('/login', async (req, res, next) => {
  try {
    await ensureAdminSchema();
    const email = normalizeAdminEmail(req.body?.email);
    const password = String(req.body?.password || '');
    if (!validEmail(email) || !password) return res.status(400).json({ error: 'Escribe un correo y una contraseña válidos.' });
    const admin = await get('SELECT * FROM admin_users WHERE email = ? AND isActive = 1', [email]);
    if (!admin || !verifyPassword(password, admin.passwordHash)) return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
    await run('UPDATE admin_users SET lastLoginAt = CURRENT_TIMESTAMP WHERE id = ?', [admin.id]);
    await createAdminSession(admin.id, res);
    res.json({ user: publicAdmin(admin) });
  } catch (error) { next(error); }
});

router.get('/me', requireAdmin, (req, res) => res.json({ user: req.admin }));

router.post('/logout', async (req, res, next) => {
  try {
    const raw = cookieValue(req.headers.cookie, ADMIN_SESSION_COOKIE);
    if (raw) await run('DELETE FROM admin_sessions WHERE id = ?', [hashToken(raw)]);
    res.clearCookie(ADMIN_SESSION_COOKIE, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' });
    res.status(204).end();
  } catch (error) { next(error); }
});

router.patch('/password', requireAdmin, async (req, res, next) => {
  try {
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');
    if (!strongPassword(newPassword)) return res.status(400).json({ error: 'La nueva contraseña debe tener mínimo 12 caracteres, mayúscula, minúscula, número y símbolo.' });
    const admin = await get('SELECT passwordHash FROM admin_users WHERE id = ? AND isActive = 1', [req.admin.id]);
    if (!admin || !verifyPassword(currentPassword, admin.passwordHash)) return res.status(400).json({ error: 'La contraseña actual es incorrecta.' });
    await run('UPDATE admin_users SET passwordHash = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?', [passwordHash(newPassword), req.admin.id]);
    await run('DELETE FROM admin_sessions WHERE adminUserId = ?', [req.admin.id]);
    res.clearCookie(ADMIN_SESSION_COOKIE, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' });
    res.json({ message: 'Contraseña actualizada. Debes iniciar sesión nuevamente.' });
  } catch (error) { next(error); }
});

module.exports = router;
