const assert = require('node:assert/strict');
const test = require('node:test');
const { createAIService } = require('../src/services/ai/aiService');
const { createCatalogDiscoveryRepository, CATALOG_DISCOVERY_SELECT } = require('../src/services/ai/catalogDiscoveryRepository');
const { createCatalogDiscoveryService } = require('../src/services/ai/catalogDiscoveryService');

const profile = {
  skinType: null,
  conditions: null,
  targets: null,
  budget: null,
  routinePreference: null,
  knownProducts: [],
  unresolvedOwnedProducts: [],
  ownedRoutineSteps: [],
};

const product = (id, routineStep) => ({
  id,
  name: `Producto ${id}`,
  slug: `producto-${id}`,
  price: 100000,
  images: JSON.stringify([`https://img/${id}.jpg`]),
  routineStep,
  sizeLabel: '50 ml',
  status: 'active',
  stock: 2,
  catalogRole: 'CATALOG',
});

test('catalog discovery uses an explicit public query and excludes private fields', () => {
  assert.match(CATALOG_DISCOVERY_SELECT, /catalogrole = 'CATALOG'/i);
  assert.match(CATALOG_DISCOVERY_SELECT, /status = 'active'/i);
  assert.doesNotMatch(CATALOG_DISCOVERY_SELECT, /SELECT \*/i);
  assert.doesNotMatch(CATALOG_DISCOVERY_SELECT, /supplier|cost|margin/i);
});

test('broad catalog discovery returns bounded DB-backed public Products without profile readiness', async () => {
  let received;
  const repository = createCatalogDiscoveryRepository({ query: async (sql, params) => {
    received = { sql, params };
    return [product('cleanser', 'CLEANSER'), product('spf', 'SUNSCREEN')];
  } });
  const catalogDiscoveryService = createCatalogDiscoveryService({ repository });
  const service = createAIService({
    catalogDiscoveryService,
    provider: { interpretConversation: async () => ({
      scope: 'IN_SCOPE', intent: 'DISCOVERY', mode: 'ANSWER', nextAction: 'CATALOG_DISCOVERY', requestedRoutineStep: null,
      message: 'Aquí está el catálogo.', profile,
      productReferences: [],
    }) },
  });
  const result = await service.advise({ message: '¿Qué productos maneja Nari?' });
  assert.equal(received.params.at(-1), 12);
  assert.equal(result.intent, 'DISCOVERY');
  assert.equal(result.catalogProducts.length, 2);
  assert.equal(result.recommendations.length, 2);
  assert.equal(result.catalogProducts[0].category, 'limpiador');
  assert.equal('catalogRole' in result.catalogProducts[0], false);
  assert.equal('supplier' in result.catalogProducts[0], false);
  assert.equal('cost' in result.catalogProducts[0], false);
});

test('category catalog discovery filters by canonical routine step and does not invoke recommendation reasoning', async () => {
  let reasoned = false;
  const repository = createCatalogDiscoveryRepository({ query: async (sql, params) => {
    assert.match(sql, /routinestep = \?/i);
    assert.deepEqual(params, ['SUNSCREEN', 12]);
    return [product('spf', 'SUNSCREEN')];
  } });
  const service = createAIService({
    catalogDiscoveryService: createCatalogDiscoveryService({ repository }),
    provider: {
      interpretConversation: async () => ({ scope: 'IN_SCOPE', intent: 'DISCOVERY', mode: 'ANSWER', nextAction: 'CATALOG_DISCOVERY', requestedRoutineStep: 'SUNSCREEN', message: 'Opciones.', profile, productReferences: [] }),
      reasonAmongCandidates: async () => { reasoned = true; return {}; },
    },
  });
  const result = await service.advise({ message: '¿Qué protectores solares tienen?' });
  assert.equal(result.catalogProducts[0].category, 'protector solar');
  assert.equal(reasoned, false);
});

test('current catalog request can switch from prior BUILD_ROUTINE context', async () => {
  const service = createAIService({
    catalogDiscoveryService: createCatalogDiscoveryService({ repository: { findPublicCatalogProducts: async () => [product('spf', 'SUNSCREEN')] } }),
    provider: { interpretConversation: async ({ history }) => {
      assert.equal(history[0].content, 'Quiero empezar una rutina.');
      return { scope: 'IN_SCOPE', intent: 'DISCOVERY', mode: 'ANSWER', nextAction: 'CATALOG_DISCOVERY', requestedRoutineStep: null, message: 'Opciones.', profile, productReferences: [] };
    } },
  });
  const result = await service.advise({ message: '¿Qué productos maneja Nari?', history: [{ role: 'user', content: 'Quiero empezar una rutina.' }] });
  assert.equal(result.intent, 'DISCOVERY');
  assert.equal(result.recommendations.length, 1);
});
