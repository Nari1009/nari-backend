const express = require('express');
const { get, run } = require('../db/init');
const { adminAuth } = require('../middleware/auth');
const router = express.Router();
const defaultContact = { supportEmail: '', whatsappNumber: '', whatsappMessage: 'Hola, vengo de la página de NARI y necesito ayuda.', businessPhone: '', instagram: '', tiktok: '' };
const readContact = async () => { const row = await get('SELECT value FROM public_settings WHERE key = ?', ['contact']); return row ? { ...defaultContact, ...JSON.parse(row.value) } : defaultContact; };

router.get('/contact', async (req, res, next) => { try { const contact = await readContact(); res.json({ whatsappNumber: contact.whatsappNumber, whatsappMessage: contact.whatsappMessage, supportEmail: contact.supportEmail }); } catch (error) { next(error); } });
router.put('/contact', adminAuth, async (req, res, next) => { try { const current = await readContact(); const nextContact = { ...current, supportEmail: String(req.body?.supportEmail || '').trim(), whatsappNumber: String(req.body?.whatsappNumber || '').trim(), whatsappMessage: String(req.body?.whatsappMessage || '').trim(), businessPhone: String(req.body?.businessPhone || '').trim(), instagram: String(req.body?.instagram || '').trim(), tiktok: String(req.body?.tiktok || '').trim() }; await run('INSERT INTO public_settings (key, value, updatedAt) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = CURRENT_TIMESTAMP', ['contact', JSON.stringify(nextContact)]); res.json(nextContact); } catch (error) { next(error); } });
module.exports = router;
