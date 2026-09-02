const { get, run } = require('../db/init');
const { SESSION_COOKIE, hashToken, publicUser } = require('../services/auth');

const cookieValue = (header, name) => {
  const match = String(header || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
};

const requireUser = async (req, res, next) => {
  try {
    const raw = cookieValue(req.headers.cookie, SESSION_COOKIE);
    if (!raw) return res.status(401).json({ error: 'Sesión requerida.' });
    const session = await get(`SELECT auth_sessions.id, auth_sessions.userid AS "userId", auth_sessions.expiresat AS "expiresAt", auth_sessions.createdat AS "createdAt", auth_sessions.lastusedat AS "lastUsedAt", auth_users.email, auth_users.firstname AS "firstName", auth_users.lastname AS "lastName", auth_users.phone, auth_users.isactive AS "isActive"
      FROM auth_sessions JOIN auth_users ON auth_users.id = auth_sessions.userid WHERE auth_sessions.id = ?`, [hashToken(raw)]);
    if (!session || !session.isActive || new Date(session.expiresAt).getTime() <= Date.now()) {
      if (session) await run('DELETE FROM auth_sessions WHERE id = ?', [hashToken(raw)]);
      return res.status(401).json({ error: 'Sesión expirada.' });
    }
    await run('UPDATE auth_sessions SET lastUsedAt = CURRENT_TIMESTAMP WHERE id = ?', [hashToken(raw)]);
    req.user = { id: session.userId, firstName: session.firstName, lastName: session.lastName, email: session.email, phone: session.phone };
    next();
  } catch (error) { next(error); }
};

module.exports = { requireUser, cookieValue };
