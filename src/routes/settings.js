const express = require('express');
const { get, run } = require('../db/init');
const { requireAdmin } = require('../middleware/adminAuth');
const { ContractValidationError, defaults, validSections, publicSections, validateSetting } = require('../services/settingsContract');
const router = express.Router();
const storageKey = (section) => section === 'contact' ? 'contact' : `settings:${section}`;
const readSetting = async (section) => {
  const row = await get('SELECT value FROM public_settings WHERE key = ?', [storageKey(section)]);
  if (!row) return defaults[section];
  try {
    const parsed = JSON.parse(row.value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('setting must be an object');
    const known = Object.fromEntries(Object.keys(defaults[section]).map((key) => [key, parsed[key] === undefined ? defaults[section][key] : parsed[key]]));
    return validateSetting(section, { ...defaults[section], ...known });
  } catch {
    console.error('Invalid persisted setting ignored', { section });
    return defaults[section];
  }
};
const saveSetting = async (section, value) => {
  const next = validateSetting(section, { ...await readSetting(section), ...value });
  await run('INSERT INTO public_settings (key, value, updatedAt) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = CURRENT_TIMESTAMP', [storageKey(section), JSON.stringify(next)]);
  return next;
};
router.get('/:section', async (req, res, next) => {
  try {
    if (!publicSections.has(req.params.section)) return res.status(404).json({ error: 'Setting section not found' });
    const settings = await readSetting(req.params.section);
    res.json(settings);
  } catch (error) { next(error); }
});
router.put('/:section', requireAdmin, async (req, res, next) => {
  try {
    if (!validSections.has(req.params.section)) return res.status(404).json({ error: 'Setting section not found' });
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return res.status(400).json({ error: 'Settings must be an object' });
    res.json(await saveSetting(req.params.section, req.body));
  } catch (error) {
    if (error instanceof ContractValidationError) return res.status(400).json({ error: error.message });
    next(error);
  }
});

const getSetting = readSetting;
const updateSetting = saveSetting;
module.exports = router;
module.exports.getSetting = getSetting;
module.exports.updateSetting = updateSetting;
module.exports.validSections = validSections;
