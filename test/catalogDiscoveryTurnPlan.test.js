const assert = require('node:assert/strict');
const test = require('node:test');
const { createAIService } = require('../src/services/ai/aiService');
const { createCatalogDiscoveryService } = require('../src/services/ai/catalogDiscoveryService');
const { createCatalogDiscoveryRepository } = require('../src/services/ai/catalogDiscoveryRepository');
const { verifyStateEnvelope } = require('../src/services/ai/conversationState');

const SECRET = 'stage-nine-discovery-test-secret-32chars';
const profile = (overrides = {}) => ({ skinType: null, conditions: null, targets: null, budget: null, routinePreference: null, knownProducts: [], unresolvedOwnedProducts: [], ownedRoutineSteps: [], ...overrides });
const product = (id, overrides = {}) => ({ id, brand: 'Nari', name: `Product ${id}`, slug: `product-${id}`, price: 100000, images: JSON.stringify([`https://img/${id}.jpg`]), routineStep: 'MOISTURIZER', sizeLabel: '50 ml', suitableSkinTypes: ['OILY'], suitableConditions: [], targets: [], status: 'active', stock: 2, catalogRole: 'CATALOG', ...overrides });

const createHarness = ({ rows, interpretationProfile = profile(), criteria = {}, message = 'Muéstrame productos' } = {}) => {
  const repository = { async findPublicCatalogProducts() { return rows; } };
  const provider = { async interpretConversation() { return { scope: 'IN_SCOPE', intent: 'DISCOVERY', mode: 'ANSWER', nextAction: 'CATALOG_DISCOVERY', requestedRoutineStep: null, message: 'Encontré estas opciones.', profile: interpretationProfile, productReferences: [], requestedSteps: [], relationToPrevious: 'NONE', referencePhrases: [], discoveryCriteria: criteria, ownershipDelta: { addVerifiedProductReferences: [], addUnresolvedItems: [], addOwnedRoutineSteps: [], removeReferences: [], removeUnresolvedLabels: [], removeOwnedRoutineSteps: [] } }; } };
  return createAIService({ provider, catalogDiscoveryService: createCatalogDiscoveryService({ repository }), stateTransport: true, stateSecret: SECRET });
};

test('authoritative discovery returns only eligible sunscreen Products', async () => {
  const rows = [product('spf-1', { routineStep: 'SUNSCREEN' }), product('spf-out', { routineStep: 'SUNSCREEN', stock: 0 }), product('fixture', { routineStep: 'SUNSCREEN', catalogRole: 'DEV_FIXTURE' })];
  const result = await createHarness({ rows, criteria: { routineSteps: ['SUNSCREEN'], brand: null, skinTypes: null, conditions: null, targets: null, useProfile: false, browseScope: 'FILTERED' }, message: 'Muéstrame protectores solares' }).advise({ message: 'Muéstrame protectores solares' });
  assert.deepEqual(result.recommendations.map((item) => item.product.id), ['spf-1']);
  assert.equal(result.catalogProducts[0].category, 'protector solar');
});

test('discovery applies explicit brand and routine-step filters without recommendation reasoning', async () => {
  const rows = [product('a', { brand: 'SKIN1004', routineStep: 'MOISTURIZER' }), product('b', { brand: 'Anua', routineStep: 'MOISTURIZER' }), product('c', { brand: 'SKIN1004', routineStep: 'SERUM' })];
  const result = await createHarness({ rows, criteria: { routineSteps: ['MOISTURIZER'], brand: 'skin1004', skinTypes: null, conditions: null, targets: null, useProfile: false, browseScope: 'FILTERED' } }).advise({ message: 'Muéstrame hidratantes de SKIN1004' });
  assert.deepEqual(result.recommendations.map((item) => item.product.id), ['a']);
});

test('explicit skin filtering excludes NULL and mismatched canonical metadata', async () => {
  const rows = [product('oily', { suitableSkinTypes: ['OILY'] }), product('unknown', { suitableSkinTypes: null }), product('dry', { suitableSkinTypes: ['DRY'] })];
  const result = await createHarness({ rows, criteria: { routineSteps: ['MOISTURIZER'], brand: null, skinTypes: ['OILY'], conditions: null, targets: null, useProfile: false, browseScope: 'FILTERED' } }).advise({ message: 'Hidratantes para piel grasa' });
  assert.deepEqual(result.recommendations.map((item) => item.product.id), ['oily']);
});

test('profile is applied only when discovery explicitly requests products for the user', async () => {
  const rows = [product('oily', { suitableSkinTypes: ['OILY'] }), product('dry', { suitableSkinTypes: ['DRY'] })];
  const broad = await createHarness({ rows, interpretationProfile: profile({ skinType: 'OILY' }), criteria: { routineSteps: ['MOISTURIZER'], brand: null, skinTypes: null, conditions: null, targets: null, useProfile: false, browseScope: 'FILTERED' } }).advise({ message: '¿Qué hidratantes tienen?' });
  const personal = await createHarness({ rows, interpretationProfile: profile({ skinType: 'OILY' }), criteria: { routineSteps: ['MOISTURIZER'], brand: null, skinTypes: null, conditions: null, targets: null, useProfile: true, browseScope: 'FILTERED' } }).advise({ message: 'Muéstrame hidratantes para mí' });
  assert.equal(broad.recommendations.length, 2);
  assert.deepEqual(personal.recommendations.map((item) => item.product.id), ['oily']);
});

test('broad discovery is bounded and deterministically ordered', async () => {
  const rows = Array.from({ length: 20 }, (_, index) => product(`p-${20 - index}`, { name: `Product ${20 - index}` }));
  const result = await createHarness({ rows, criteria: { routineSteps: [], brand: null, skinTypes: null, conditions: null, targets: null, useProfile: false, browseScope: 'BROAD' } }).advise({ message: '¿Qué productos tienen?' });
  assert.equal(result.recommendations.length, 12);
  assert.equal(result.recommendations[0].product.name, 'Product 1');
  assert.equal(result.recommendations.at(-1).product.name, 'Product 2');
});

test('empty discovery returns no fabricated Products and preserves a signed bounded reference set', async () => {
  const result = await createHarness({ rows: [], criteria: { routineSteps: ['TONER'], brand: null, skinTypes: ['OILY'], conditions: null, targets: null, useProfile: false, browseScope: 'FILTERED' } }).advise({ message: 'Muéstrame tónicos para piel grasa' });
  assert.deepEqual(result.recommendations, []);
  assert.deepEqual(result.catalogProducts, []);
  const state = verifyStateEnvelope(result.conversationState, SECRET);
  assert.deepEqual(state.artifacts.recentProductReferences, []);
});

test('discovery repository uses storefront eligibility and canonical physical fields', async () => {
  let received;
  const repository = createCatalogDiscoveryRepository({ query: async (sql, params) => { received = { sql, params }; return []; } });
  await repository.findPublicCatalogProducts({ routineStep: 'SUNSCREEN', brand: 'SKIN1004', limit: 12 });
  assert.match(received.sql, /catalogrole = 'CATALOG'/i);
  assert.match(received.sql, /status = 'active'/i);
  assert.match(received.sql, /stock > 0/i);
  assert.match(received.sql, /suitableskintypes AS "suitableSkinTypes"/i);
  assert.deepEqual(received.params, ['SUNSCREEN', '%SKIN1004%', 12]);
});

test('discovery results are stored as references, not recommendations in signed state', async () => {
  const rows = [product('a'), product('b')];
  const result = await createHarness({ rows, criteria: { routineSteps: ['MOISTURIZER'], brand: null, skinTypes: null, conditions: null, targets: null, useProfile: false, browseScope: 'FILTERED' } }).advise({ message: 'Muéstrame hidratantes' });
  const state = verifyStateEnvelope(result.conversationState, SECRET);
  assert.deepEqual(state.artifacts.recentProductReferences.map((item) => item.productId), ['a', 'b']);
  assert.deepEqual(state.artifacts.recentRecommendations, []);
});
