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

test('home contract accepts current copy and trims bounded FAQ content', () => {
  const home = structuredClone(defaults.home);
  home.hero.title = '  Skincare con criterio.  ';
  home.faq[0].question = '  ¿Cómo sé qué productos son adecuados para mi piel?  ';
  const validated = validateContent('home', home);
  assert.equal(validated.hero.title, 'Skincare con criterio.');
  assert.equal(validated.faq[0].question, '¿Cómo sé qué productos son adecuados para mi piel?');
});

test('home contract rejects malformed hero, FAQ entries, unknown fields and oversized content', () => {
  const home = structuredClone(defaults.home);
  assert.throws(() => validateContent('home', { ...home, layout: {} }), ContractValidationError);
  assert.throws(() => validateContent('home', { ...home, hero: { ...home.hero, imageUrl: '/banner.png' } }), ContractValidationError);
  assert.throws(() => validateContent('home', { ...home, faq: [{ question: 'Pregunta', answer: 'Respuesta', html: '<b>no</b>' }] }), ContractValidationError);
  assert.throws(() => validateContent('home', { ...home, hero: { ...home.hero, title: 42 } }), ContractValidationError);
  assert.throws(() => validateContent('home', { ...home, faq: [{ question: '<script>alert(1)</script>', answer: 'Respuesta' }] }), ContractValidationError);
  assert.throws(() => validateContent('home', { ...home, faq: Array.from({ length: 13 }, () => ({ question: 'Pregunta', answer: 'Respuesta' })) }), ContractValidationError);
  assert.throws(() => validateContent('home', { ...home, hero: { ...home.hero, description: 'x'.repeat(1201) } }), ContractValidationError);
});

test('malformed persisted content falls back to a safe known-page default', () => {
  const source = fs.readFileSync(require.resolve('../src/db/content'), 'utf8');
  assert.match(source, /try \{ return validateContent\(page, JSON\.parse\(row\.content\)\); \} catch/);
  assert.match(source, /return defaults\[page\];/);
  assert.match(source, /Invalid persisted site content ignored/);
  assert.match(source, /if \(!row\) return defaults\[page\];/);
  assert.match(source, /if \(page === 'home'\)/);
  assert.match(source, /if \(page === 'home'\) continue;/);
});

console.log('contentContract tests: PASS');
