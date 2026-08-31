const { get, run, hashToken, ADMIN_SESSION_COOKIE } = require('../services/adminAuth');

const cookieValue = (header, name) => {
  const match = String(header || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
};

const requireAdmin = async (req, res, next) => {
  try {
    const raw = cookieValue(req.headers.cookie, ADMIN_SESSION_COOKIE);
    if (!raw) return res.status(401).json({ error: 'Sesión de administrador requerida.' });
    const session = await get(`SELECT s.id, s.adminUserId, s.expiresAt, a.name, a.email, a.role, a.isActive
      FROM admin_sessions s JOIN admin_users a ON a.id = s.adminUserId
      WHERE s.id = ?`, [hashToken(raw)]);
    if (!session || !session.isActive || new Date(session.expiresAt).getTime() <= Date.now()) {
      if (session) await run('DELETE FROM admin_sessions WHERE id = ?', [hashToken(raw)]);
      return res.status(401).json({ error: 'La sesión de administrador expiró.' });
    }
    await run('UPDATE admin_sessions SET lastUsedAt = CURRENT_TIMESTAMP WHERE id = ?', [hashToken(raw)]);
    req.admin = { id: session.adminUserId, name: session.name, email: session.email, role: session.role };
    next();
  } catch (error) { next(error); }
};

module.exports = { requireAdmin, cookieValue };
