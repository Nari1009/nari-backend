const test = require('node:test');
const assert = require('node:assert/strict');

const { defaults, publicSections, validateSetting, ContractValidationError } = require('../src/services/settingsContract');

test('all current default settings satisfy the centralized contract', () => {
  for (const [section, value] of Object.entries(defaults)) assert.deepEqual(validateSetting(section, value), value);
});

test('contact validation preserves the existing shape and rejects unsafe values', () => {
  const value = validateSetting('contact', { ...defaults.contact, supportEmail: '  ayuda@nari.co ', whatsappNumber: '+57 300 123 4567', instagram: 'https://instagram.com/nari' });
  assert.equal(value.supportEmail, 'ayuda@nari.co');
  assert.equal(value.whatsappNumber, '+57 300 123 4567');
  assert.throws(() => validateSetting('contact', { ...defaults.contact, supportEmail: 'not-an-email' }), ContractValidationError);
  assert.throws(() => validateSetting('contact', { ...defaults.contact, whatsappNumber: 'javascript:alert(1)' }), ContractValidationError);
  assert.throws(() => validateSetting('contact', { ...defaults.contact, instagram: 'javascript:alert(1)' }), ContractValidationError);
  assert.throws(() => validateSetting('contact', { ...defaults.contact, whatsappMessage: '<script>alert(1)</script>' }), ContractValidationError);
});

test('typed settings reject unknown fields and invalid numbers', () => {
  assert.throws(() => validateSetting('general', { ...defaults.general, secret: 'no' }), ContractValidationError);
  assert.throws(() => validateSetting('inventory', { ...defaults.inventory, defaultLowStock: Infinity }), ContractValidationError);
  assert.throws(() => validateSetting('shipping', { ...defaults.shipping, minDays: 6, maxDays: 2 }), ContractValidationError);
  assert.throws(() => validateSetting('shipping', { ...defaults.shipping, standardCost: -1 }), ContractValidationError);
  assert.throws(() => validateSetting('store', { ...defaults.store, storeActive: 'true' }), ContractValidationError);
});

test('only contact is exposed through the public settings contract', () => {
  assert.deepEqual([...publicSections], ['contact']);
});

test('settings writes remain behind requireAdmin and admin reads have a protected route', () => {
  const fs = require('node:fs');
  const routeSource = fs.readFileSync(require.resolve('../src/routes/settings'), 'utf8');
  const adminSource = fs.readFileSync(require.resolve('../src/routes/admin'), 'utf8');
  assert.match(routeSource, /router\.put\('\/:section', requireAdmin/);
  assert.match(adminSource, /router\.use\(requireAdmin\)/);
  assert.match(adminSource, /router\.get\('\/settings\/:section'/);
});

console.log('settingsContract tests: PASS');
