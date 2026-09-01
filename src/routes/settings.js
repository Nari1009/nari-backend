const express = require('express');
const { get, run } = require('../db/init');
const { requireAdmin } = require('../middleware/adminAuth');
const router = express.Router();
const defaults = {
  contact: { supportEmail: '', whatsappNumber: '', whatsappMessage: 'Hola, vengo de la página de NARI y necesito ayuda.', businessPhone: '', instagram: '', tiktok: '' },
  general: { storeName: 'NARI', commercialName: '', country: 'Colombia', currency: 'COP', timezone: 'America/Bogota', language: 'Español' },
  store: { storeActive: true, showOutOfStock: true, allowOutOfStockPurchase: false, showAvailableQuantity: false, showInactiveProducts: false },
  inventory: { defaultLowStock: 3, notifyLowStock: true, notifyOutOfStock: true },
  checkout: { checkoutType: 'guest', requestPhone: true, requestNeighborhood: false, requestPostalCode: false, requestDocument: false, requestDeliveryInstructions: true, defaultCountry: 'Colombia' },
  shipping: { shippingEnabled: true, standardCost: 0, minDays: 2, maxDays: 5, freeShippingEnabled: false, freeShippingThreshold: 0 },
};
const validSections = new Set(Object.keys(defaults));
const storageKey = (section) => section === 'contact' ? 'contact' : `settings:${section}`;
const readSetting = async (section) => {
  const row = await get('SELECT value FROM public_settings WHERE key = ?', [storageKey(section)]);
  if (!row) return defaults[section];
  try { return { ...defaults[section], ...JSON.parse(row.value) }; } catch { return defaults[section]; }
};
const saveSetting = async (section, value) => {
  const next = { ...await readSetting(section), ...value };
  await run('INSERT INTO public_settings (key, value, updatedAt) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = CURRENT_TIMESTAMP', [storageKey(section), JSON.stringify(next)]);
  return next;
};
router.get('/:section', async (req, res, next) => { try { if (!validSections.has(req.params.section)) return res.status(404).json({ error: 'Setting section not found' }); const settings = await readSetting(req.params.section); if (req.params.section === 'contact') return res.json({ whatsappNumber: settings.whatsappNumber, whatsappMessage: settings.whatsappMessage, supportEmail: settings.supportEmail, businessPhone: settings.businessPhone, instagram: settings.instagram, tiktok: settings.tiktok }); res.json(settings); } catch (error) { next(error); } });
router.put('/:section', requireAdmin, async (req, res, next) => { try { if (!validSections.has(req.params.section)) return res.status(404).json({ error: 'Setting section not found' }); if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return res.status(400).json({ error: 'Settings must be an object' }); const value = req.params.section === 'contact' ? { supportEmail: String(req.body.supportEmail || '').trim(), whatsappNumber: String(req.body.whatsappNumber || '').trim(), whatsappMessage: String(req.body.whatsappMessage || '').trim(), businessPhone: String(req.body.businessPhone || '').trim(), instagram: String(req.body.instagram || '').trim(), tiktok: String(req.body.tiktok || '').trim() } : req.body; res.json(await saveSetting(req.params.section, value)); } catch (error) { next(error); } });
module.exports = router;
