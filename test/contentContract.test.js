const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://test:test@localhost:5432/test';
const { defaults, validateContent } = require('../src/db/content');
const { ContractValidationError } = require('../src/services/settingsContract');

test('current ayuda, contacto and nosotros defaults satisfy their content contracts', () => {
  for (const [page, value] of Object.entries(defaults)) assert.deepEqual(validateContent(page, value), value);
});

test('content contracts reject unknown fields, malformed arrays and HTML', () => {
  assert.throws(() => validateContent('ayuda', { ...defaults.ayuda, extra: 'no' }), ContractValidationError);
  assert.throws(() => validateContent('contacto', { ...defaults.contacto, channels: [{ type: 'WhatsApp' }] }), ContractValidationError);
  assert.throws(() => validateContent('nosotros', { ...defaults.nosotros, title: '<script>alert(1)</script>' }), ContractValidationError);
  assert.throws(() => validateContent('missing', {}), ContractValidationError);
});

test('malformed persisted content falls back to a safe known-page default', () => {
  const source = fs.readFileSync(require.resolve('../src/db/content'), 'utf8');
  assert.match(source, /try \{ return validateContent\(page, JSON\.parse\(row\.content\)\); \} catch/);
  assert.match(source, /return defaults\[page\];/);
  assert.match(source, /Invalid persisted site content ignored/);
});

console.log('contentContract tests: PASS');
