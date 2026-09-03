const express = require('express');
const crypto = require('crypto');
const { all, get, run } = require('../db/init');
const { normalizeEmail, passwordHash, verifyPassword, publicUser, createSession, hashToken, SESSION_COOKIE } = require('../services/auth');
const { sendPasswordResetEmail, sendEmailVerification, sendWelcomeEmail, sendPasswordChangedEmail } = require('../services/email');
const { VERIFICATION_TTL_MS, clientAppUrl, createEmailVerification, canResendEmailVerification } = require('../services/emailVerification');
const { requireUser, cookieValue } = require('../middleware/clientAuth');
const { createOrder } = require('../services/orderCreation');
const router = express.Router();

const validEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const normalizePhone = (value) => String(value || '').replace(/\D/g, '');
const strongPassword = (password) => String(password || '').length >= 8 && /[A-Z]/.test(password) && /[a-z]/.test(password) && /\d/.test(password) && /[^A-Za-z0-9]/.test(password);
const validateRegistration = ({ firstName, lastName, email, phone, password, termsAccepted }) => {
  if (!String(firstName || '').trim() || !String(lastName || '').trim() || !validEmail(normalizeEmail(email)) || !String(phone || '').trim() || !/^\+\d{1,3} \d{7,15}$/.test(String(phone).trim()) || !strongPassword(password) || termsAccepted !== true) {
    return 'Revisa los campos requeridos y acepta los términos y condiciones.';
  }
  return null;
};

router.post('/register', async (req, res, next) => {
  try {
    const input = req.body || {};
    const validation = validateRegistration(input);
    if (validation) return res.status(400).json({ error: validation });
    const email = normalizeEmail(input.email);
    const existingAuthUser = await get('SELECT id, isactive AS "isActive", emailverifiedat AS "emailVerifiedAt" FROM auth_users WHERE email = ?', [email]);
    if (existingAuthUser) {
      if (Number(existingAuthUser.isActive) === 0) return res.status(409).json({ code: 'ACCOUNT_INACTIVE', error: 'Esta cuenta está desactivada. Contacta con soporte para recuperar el acceso.' });
      if (!existingAuthUser.emailVerifiedAt) return res.status(409).json({ code: 'EMAIL_NOT_VERIFIED', error: 'Este correo está pendiente de verificación.' });
      return res.status(409).json({ error: 'No fue posible crear la cuenta con esos datos.' });
    }
    const normalizedPhone = normalizePhone(input.phone);
    const matchingCustomer = await get('SELECT id, authuserid AS "authUserId" FROM customers WHERE lower(trim(email)) = ?', [email]);
    if (matchingCustomer?.authUserId) return res.status(409).json({ error: 'Ya existe una cuenta con esos datos.' });
    const id = `auth-${cryptoRandomId()}`;
    const customerId = `customer-${cryptoRandomId()}`;
    const user = { id, firstName: String(input.firstName).trim(), lastName: String(input.lastName).trim(), email, phone: String(input.phone).trim() };
    const rawVerificationToken = crypto.randomBytes(32).toString('base64url');
    const verification = { rawToken: rawVerificationToken, expiresAt: new Date(Date.now() + VERIFICATION_TTL_MS).toISOString() };
    await run('BEGIN TRANSACTION');
    try {
      await run('INSERT INTO auth_users (id, email, passwordHash, firstName, lastName, phone) VALUES (?, ?, ?, ?, ?, ?)', [id, email, passwordHash(input.password), user.firstName, user.lastName, user.phone]);
      const existingCustomer = matchingCustomer;
      if (existingCustomer) {
        await run(`UPDATE customers SET authUserId = ?, email = ?, firstName = COALESCE(NULLIF(?, ''), firstName), lastName = COALESCE(NULLIF(?, ''), lastName), phone = COALESCE(NULLIF(?, ''), phone), phoneNormalized = COALESCE(NULLIF(?, ''), phoneNormalized), updatedAt = CURRENT_TIMESTAMP WHERE id = ?`, [id, email, user.firstName, user.lastName, user.phone, normalizedPhone, existingCustomer.id]);
      } else {
        await run('INSERT INTO customers (id, authUserId, email, firstName, lastName, phone, phoneNormalized) VALUES (?, ?, ?, ?, ?, ?, ?)', [customerId, id, email, user.firstName, user.lastName, user.phone, normalizePhone(user.phone)]);
      }
      await run('DELETE FROM email_verification_tokens WHERE userid = ? AND usedat IS NULL', [id]);
      await run('INSERT INTO email_verification_tokens (id, userid, tokenhash, expiresat) VALUES (?, ?, ?, ?)', [`verify-${cryptoRandomId()}`, id, hashToken(verification.rawToken), verification.expiresAt]);
      await run('COMMIT');
    } catch (error) { await run('ROLLBACK').catch(() => undefined); throw error; }
    try {
      const appUrl = clientAppUrl();
      if (!appUrl) throw new Error('APP_URL is not configured.');
      await sendEmailVerification({ to: user.email, firstName: user.firstName, verifyUrl: `${appUrl}/verify-email?token=${encodeURIComponent(verification.rawToken)}` });
    } catch (emailError) {
      console.error('Email verification could not be sent:', emailError.message);
    }
    res.status(201).json({ registrationPendingVerification: true, message: 'Revisa tu correo para confirmar tu cuenta.' });
  } catch (error) { next(error); }
});

router.post('/login', async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');
    const user = await get('SELECT id, email, firstname AS "firstName", lastname AS "lastName", phone, passwordhash AS "passwordHash", isactive AS "isActive", emailverifiedat AS "emailVerifiedAt" FROM auth_users WHERE email = ? AND isactive = 1', [email]);
    if (!user) return res.status(401).json({ error: 'El correo no está registrado.' });
    if (!verifyPassword(password, user.passwordHash)) return res.status(401).json({ error: 'La contraseña es incorrecta.' });
    if (!user.emailVerifiedAt) return res.status(403).json({ code: 'EMAIL_NOT_VERIFIED', error: 'Debes confirmar tu correo antes de iniciar sesión.' });
    await run('UPDATE auth_users SET lastLoginAt = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);
    await createSession(run, user.id, res);
    res.json({ user: publicUser(user) });
  } catch (error) { next(error); }
});

router.get('/me', requireUser, (req, res) => res.json({ user: req.user }));

const verificationMessage = 'Si la cuenta existe y aún no está verificada, recibirás un nuevo correo de confirmación.';
router.post('/resend-verification', async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    if (!validEmail(email)) return res.json({ message: verificationMessage });
    const user = await get('SELECT id, email, firstname AS "firstName", emailverifiedat AS "emailVerifiedAt" FROM auth_users WHERE email = ? AND isactive = 1', [email]);
    if (user?.emailVerifiedAt) return res.json({ alreadyVerified: true, message: 'Tu correo ya está verificado. Ya puedes iniciar sesión.' });
    if (user && !user.emailVerifiedAt && await canResendEmailVerification(user.id)) {
      const verification = await createEmailVerification(user.id);
      try {
        const appUrl = clientAppUrl();
        if (!appUrl) throw new Error('APP_URL is not configured.');
        await sendEmailVerification({ to: user.email, firstName: user.firstName, verifyUrl: `${appUrl}/verify-email?token=${encodeURIComponent(verification.rawToken)}` });
      } catch (emailError) { console.error('Email verification resend could not be sent:', emailError.message); }
    }
    res.json({ message: verificationMessage });
  } catch (error) { next(error); }
});

router.post('/verify-email', async (req, res, next) => {
  try {
    const token = String(req.body?.token || '');
    if (!token) return res.status(400).json({ error: 'El enlace no es válido o ya expiró.' });
    const record = await get('SELECT id, userid AS "userId", usedat AS "usedAt", expiresat AS "expiresAt" FROM email_verification_tokens WHERE tokenhash = ?', [hashToken(token)]);
    if (!record || record.usedAt || new Date(record.expiresAt).getTime() <= Date.now()) return res.status(400).json({ error: 'El enlace no es válido o ya expiró.' });
    const user = await get('SELECT id, email, firstname AS "firstName", emailverifiedat AS "emailVerifiedAt", welcomeemailsentat AS "welcomeEmailSentAt", isactive AS "isActive" FROM auth_users WHERE id = ?', [record.userId]);
    if (!user || Number(user.isActive) === 0) return res.status(400).json({ error: 'El enlace no es válido o ya expiró.' });
    if (user.emailVerifiedAt) return res.json({ alreadyVerified: true, message: 'Este correo ya estaba confirmado.' });
    await run('BEGIN TRANSACTION');
    try {
      const used = await run('UPDATE email_verification_tokens SET usedat = CURRENT_TIMESTAMP WHERE id = ? AND usedat IS NULL', [record.id]);
      if (!used.changes) throw new Error('Verification token already used.');
      await run('UPDATE auth_users SET emailverifiedat = CURRENT_TIMESTAMP, updatedat = CURRENT_TIMESTAMP WHERE id = ? AND emailverifiedat IS NULL', [record.userId]);
      await run('DELETE FROM email_verification_tokens WHERE userid = ? AND id <> ?', [record.userId, record.id]);
      await run('COMMIT');
    } catch (error) { await run('ROLLBACK').catch(() => undefined); throw error; }
    if (!user.welcomeEmailSentAt) {
      try {
        await sendWelcomeEmail({ to: user.email, firstName: user.firstName });
        await run('UPDATE auth_users SET welcomeemailsentat = CURRENT_TIMESTAMP WHERE id = ? AND welcomeemailsentat IS NULL', [user.id]);
      } catch (emailError) {
        console.error('Welcome email could not be sent:', emailError.message);
      }
    }
    res.json({ message: 'Correo confirmado. Ya puedes iniciar sesión.' });
  } catch (error) { next(error); }
});
router.post('/logout', async (req, res, next) => {
  try {
    const raw = cookieValue(req.headers.cookie, SESSION_COOKIE);
    if (raw) await run('DELETE FROM auth_sessions WHERE id = ?', [hashToken(raw)]);
    res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', path: '/' });
    res.status(204).end();
  } catch (error) { next(error); }
});

router.patch('/profile', requireUser, async (req, res, next) => {
  try {
    const firstName = String(req.body?.firstName || '').trim();
    const lastName = String(req.body?.lastName || '').trim();
    const phone = String(req.body?.phone || '').trim();
    if (!firstName || !lastName || !phone) return res.status(400).json({ error: 'Nombre, apellido y teléfono son obligatorios.' });
    await run('BEGIN TRANSACTION');
    try {
      await run('UPDATE auth_users SET firstName = ?, lastName = ?, phone = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?', [firstName, lastName, phone, req.user.id]);
      await run('UPDATE customers SET firstName = ?, lastName = ?, phone = ?, updatedAt = CURRENT_TIMESTAMP WHERE authUserId = ?', [firstName, lastName, phone, req.user.id]);
      await run('COMMIT');
    } catch (error) { await run('ROLLBACK').catch(() => undefined); throw error; }
    res.json({ user: { ...req.user, firstName, lastName, phone } });
  } catch (error) { next(error); }
});

router.patch('/password', requireUser, async (req, res, next) => {
  try {
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');
    if (!currentPassword || !strongPassword(newPassword)) return res.status(400).json({ error: 'La nueva contraseña debe tener mínimo 8 caracteres, mayúscula, minúscula, número y símbolo.' });
    if (currentPassword === newPassword) return res.status(400).json({ error: 'La nueva contraseña debe ser diferente.' });
    const user = await get('SELECT passwordHash FROM auth_users WHERE id = ? AND isActive = 1', [req.user.id]);
    if (!user || !verifyPassword(currentPassword, user.passwordHash)) return res.status(400).json({ error: 'La contraseña actual es incorrecta.' });
    await run('UPDATE auth_users SET passwordHash = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?', [passwordHash(newPassword), req.user.id]);
    await run('DELETE FROM auth_sessions WHERE userId = ?', [req.user.id]);
    try {
      await sendPasswordChangedEmail({ to: req.user.email, firstName: req.user.firstName });
    } catch (emailError) {
      console.error('Password change notification could not be sent:', emailError.message);
    }
    res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', path: '/' });
    res.json({ message: 'Contraseña actualizada. Por seguridad, debes iniciar sesión nuevamente.' });
  } catch (error) { next(error); }
});

const addressFields = 'id, userId, firstName, lastName, phone, country, department, city, addressLine1, addressLine2, neighborhood, postalCode, deliveryInstructions, isDefault, createdAt, updatedAt';
const addressInput = (body) => ({ firstName: String(body?.firstName || '').trim(), lastName: String(body?.lastName || '').trim(), phone: String(body?.phone || '').trim(), country: String(body?.country || 'Colombia').trim(), department: String(body?.department || '').trim(), city: String(body?.city || '').trim(), addressLine1: String(body?.addressLine1 || '').trim(), addressLine2: String(body?.addressLine2 || '').trim(), neighborhood: String(body?.neighborhood || '').trim(), postalCode: String(body?.postalCode || '').trim(), deliveryInstructions: String(body?.deliveryInstructions || '').trim(), isDefault: Boolean(body?.isDefault) });
const validAddress = (address) => address.firstName && address.lastName && address.phone && address.country && address.department && address.city && address.addressLine1;

router.get('/addresses', requireUser, async (req, res, next) => { try { res.json(await require('../db/init').all(`SELECT ${addressFields} FROM account_addresses WHERE userId = ? ORDER BY isDefault DESC, createdAt DESC`, [req.user.id])); } catch (error) { next(error); } });
router.post('/addresses', requireUser, async (req, res, next) => {
  try {
    const address = addressInput(req.body);
    if (!validAddress(address)) return res.status(400).json({ error: 'Completa los datos obligatorios de la dirección.' });
    const id = `address-${cryptoRandomId()}`;
    await run('BEGIN TRANSACTION');
    try {
      if (address.isDefault) await run('UPDATE account_addresses SET isDefault = 0 WHERE userId = ?', [req.user.id]);
      await run('INSERT INTO account_addresses (id, firstName, lastName, phone, country, department, city, addressLine1, addressLine2, neighborhood, postalCode, deliveryInstructions, isDefault, userId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [id, address.firstName, address.lastName, address.phone, address.country, address.department, address.city, address.addressLine1, address.addressLine2, address.neighborhood, address.postalCode, address.deliveryInstructions, address.isDefault ? 1 : 0, req.user.id]);
      await run('UPDATE customers SET latestAddress = ?, city = ?, department = ?, country = ?, updatedAt = CURRENT_TIMESTAMP WHERE authUserId = ?', [address.addressLine1, address.city, address.department, address.country, req.user.id]);
      await run('COMMIT');
    } catch (error) { await run('ROLLBACK').catch(() => undefined); throw error; }
    const created = await require('../db/init').get(`SELECT ${addressFields} FROM account_addresses WHERE id = ?`, [id]);
    res.status(201).json(created);
  } catch (error) { next(error); }
});
router.patch('/addresses/:id', requireUser, async (req, res, next) => {
  try {
    const current = await require('../db/init').get('SELECT * FROM account_addresses WHERE id = ? AND userId = ?', [req.params.id, req.user.id]);
    if (!current) return res.status(404).json({ error: 'Address not found' });
    const address = { ...current, ...addressInput({ ...current, ...req.body }) };
    if (!validAddress(address)) return res.status(400).json({ error: 'Completa los datos obligatorios de la dirección.' });
    await run('BEGIN TRANSACTION');
    try {
      if (address.isDefault) await run('UPDATE account_addresses SET isDefault = 0 WHERE userId = ?', [req.user.id]);
      await run('UPDATE account_addresses SET firstName = ?, lastName = ?, phone = ?, country = ?, department = ?, city = ?, addressLine1 = ?, addressLine2 = ?, neighborhood = ?, postalCode = ?, deliveryInstructions = ?, isDefault = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND userId = ?', [address.firstName, address.lastName, address.phone, address.country, address.department, address.city, address.addressLine1, address.addressLine2, address.neighborhood, address.postalCode, address.deliveryInstructions, address.isDefault ? 1 : 0, req.params.id, req.user.id]);
      await run('UPDATE customers SET latestAddress = ?, city = ?, department = ?, country = ?, updatedAt = CURRENT_TIMESTAMP WHERE authUserId = ?', [address.addressLine1, address.city, address.department, address.country, req.user.id]);
      await run('COMMIT');
    } catch (error) { await run('ROLLBACK').catch(() => undefined); throw error; }
    res.json(await require('../db/init').get(`SELECT ${addressFields} FROM account_addresses WHERE id = ?`, [req.params.id]));
  } catch (error) { next(error); }
});
router.delete('/addresses/:id', requireUser, async (req, res, next) => { try { const result = await run('DELETE FROM account_addresses WHERE id = ? AND userId = ?', [req.params.id, req.user.id]); if (!result.changes) return res.status(404).json({ error: 'Address not found' }); res.status(204).end(); } catch (error) { next(error); } });

router.get('/orders', requireUser, async (req, res, next) => {
  try {
    const customer = await get('SELECT id FROM customers WHERE authuserid = ?', [req.user.id]);
    if (!customer) return res.json([]);
    const orders = await all('SELECT id, createdat AS date, status, total, customeremailsnapshot AS "customerEmailSnapshot", customerfirstnamesnapshot AS "customerFirstNameSnapshot", customerlastnamesnapshot AS "customerLastNameSnapshot", customerphonesnapshot AS "customerPhoneSnapshot" FROM orders WHERE customerid = ? ORDER BY createdat DESC', [customer.id]);
    const result = await Promise.all(orders.map(async (order) => ({ ...order, products: await all('SELECT productid AS "productId", productname AS "productName", quantity, unitprice AS "unitPrice" FROM order_items WHERE orderid = ? ORDER BY id', [order.id]) })));
    res.json(result);
  } catch (error) { next(error); }
});

router.get('/orders/:id', requireUser, async (req, res, next) => {
  try {
    const customer = await get('SELECT id FROM customers WHERE authuserid = ?', [req.user.id]);
    if (!customer) return res.status(404).json({ error: 'Pedido no encontrado.' });
    const order = await get(`SELECT id, createdat AS date, status, total, subtotal, shippingtotal AS "shippingTotal", discounttotal AS "discountTotal", shippingaddress AS "shippingAddress", customeremailsnapshot AS "customerEmailSnapshot", customerfirstnamesnapshot AS "customerFirstNameSnapshot", customerlastnamesnapshot AS "customerLastNameSnapshot", customerphonesnapshot AS "customerPhoneSnapshot"
      FROM orders WHERE id = ? AND customerid = ?`, [req.params.id, customer.id]);
    if (!order) return res.status(404).json({ error: 'Pedido no encontrado.' });
    const products = await all('SELECT productid AS "productId", productname AS "productName", quantity, unitprice AS "unitPrice" FROM order_items WHERE orderid = ? ORDER BY id', [order.id]);
    let shippingAddress = {};
    try { shippingAddress = typeof order.shippingAddress === 'string' ? JSON.parse(order.shippingAddress) : order.shippingAddress || {}; } catch { /* dirección histórica incompleta */ }
    delete order.shippingAddress;
    res.json({ ...order, shippingAddress, products });
  } catch (error) { next(error); }
});

router.post('/orders', requireUser, async (req, res, next) => {
  try {
    res.status(201).json(await createOrder({ payload: req.body || {}, userId: req.user.id }));
  } catch (error) { next(error); }
});

// El checkout invitado no crea una cuenta: guarda el cliente por correo y el pedido queda visible para administración.
router.post('/guest-orders', async (req, res, next) => {
  try {
    res.status(201).json(await createOrder({ payload: req.body || {} }));
  } catch (error) { next(error); }
});

const resetMessage = 'Si existe una cuenta asociada a este correo, recibirás instrucciones para recuperar tu contraseña.';
router.post('/forgot-password', async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    if (!validEmail(email)) return res.json({ message: resetMessage });
    const user = await get('SELECT id, email, firstName FROM auth_users WHERE email = ? AND isActive = 1', [email]);
    if (user) {
      const rawToken = crypto.randomBytes(32).toString('base64url');
      const tokenHash = hashToken(rawToken);
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      await run('DELETE FROM password_reset_tokens WHERE userId = ? OR expiresAt < ?', [user.id, new Date().toISOString()]);
      await run('INSERT INTO password_reset_tokens (id, userId, tokenHash, expiresAt) VALUES (?, ?, ?, ?)', [`reset-${cryptoRandomId()}`, user.id, tokenHash, expiresAt]);
      const appUrl = String(process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
      const resetUrl = `${appUrl}/reset-password?token=${encodeURIComponent(rawToken)}`;
      try {
        await sendPasswordResetEmail({ to: user.email, firstName: user.firstName, resetUrl });
      } catch (emailError) {
        console.error('Password reset email could not be sent:', emailError.message);
      }
    }
    res.json({ message: resetMessage });
  } catch (error) { next(error); }
});

router.get('/reset-password/validate', async (req, res, next) => {
  try {
    const token = String(req.query?.token || '');
    if (!token) return res.status(400).json({ valid: false, error: 'El enlace no es válido o ya expiró.' });
    const reset = await get('SELECT id FROM password_reset_tokens WHERE tokenHash = ? AND usedAt IS NULL AND expiresAt > ?', [hashToken(token), new Date().toISOString()]);
    if (!reset) return res.status(400).json({ valid: false, error: 'El enlace no es válido o ya expiró.' });
    res.json({ valid: true });
  } catch (error) { next(error); }
});

router.post('/reset-password', async (req, res, next) => {
  try {
    const token = String(req.body?.token || '');
    const password = String(req.body?.password || '');
    if (!token || !strongPassword(password)) return res.status(400).json({ error: 'La contraseña debe tener mínimo 8 caracteres, mayúscula, minúscula, número y símbolo.' });
    const reset = await get('SELECT id, userid AS "userId" FROM password_reset_tokens WHERE tokenHash = ? AND usedAt IS NULL AND expiresAt > ?', [hashToken(token), new Date().toISOString()]);
    if (!reset) return res.status(400).json({ error: 'El enlace no es válido o ya expiró.' });
    await run('BEGIN TRANSACTION');
    try {
      const passwordUpdate = await run('UPDATE auth_users SET passwordHash = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?', [passwordHash(password), reset.userId]);
      if (passwordUpdate.changes !== 1) throw new Error('Password reset user was not updated.');
      const tokenUpdate = await run('UPDATE password_reset_tokens SET usedAt = CURRENT_TIMESTAMP WHERE id = ? AND usedAt IS NULL', [reset.id]);
      if (tokenUpdate.changes !== 1) throw new Error('Password reset token was not consumed.');
      await run('DELETE FROM auth_sessions WHERE userId = ?', [reset.userId]);
      await run('COMMIT');
    } catch (error) { await run('ROLLBACK').catch(() => undefined); throw error; }
    const user = await get('SELECT email, firstname AS "firstName" FROM auth_users WHERE id = ?', [reset.userId]);
    if (user) {
      try {
        await sendPasswordChangedEmail({ to: user.email, firstName: user.firstName });
      } catch (emailError) {
        console.error('Password reset notification could not be sent:', emailError.message);
      }
    }
    res.json({ message: 'Contraseña actualizada. Ya puedes iniciar sesión.' });
  } catch (error) { next(error); }
});

function cryptoRandomId() { return require('crypto').randomBytes(12).toString('hex'); }
module.exports = router;
