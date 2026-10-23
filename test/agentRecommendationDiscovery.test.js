const assert = require('node:assert/strict');
const test = require('node:test');
const { createCatalogDiscoveryService } = require('../src/services/ai/catalogDiscoveryService');
const { createProductResolver } = require('../src/services/ai/productResolver');

const profile = {
  skinType: 'DRY',
  conditions: ['SENSITIVE'],
  targets: ['HYDRATION', 'BARRIER_SUPPORT'],
  budget: '250000',
  routinePreference: 'simple',
  knownProducts: [],
  unresolvedOwnedProducts: [],
  ownedRoutineSteps: [],
};

const product = (overrides = {}) => ({
  id: 'dr-althea-345',
  brand: 'Dr. Althea',
  name: 'Dr. Althea 345 Relief Cream',
  slug: 'dr-althea-345-relief-cream',
  price: 119900,
  images: '[]',
  routineStep: 'MOISTURIZER',
  suitableSkinTypes: ['DRY'],
  suitableConditions: ['SENSITIVE'],
  targets: [],
  status: 'active',
  stock: 4,
  catalogRole: 'CATALOG',
  ...overrides,
});

test('discovery broadens safely when canonical criteria have no exact intersection', async () => {
  const service = createCatalogDiscoveryService({ repository: { async findPublicCatalogProducts() { return [product()]; } } });
  const result = await service.discover({
    intent: 'DISCOVERY',
    profile,
    criteria: {
      routineSteps: ['MOISTURIZER'],
      brand: null,
      skinTypes: ['DRY'],
      conditions: ['SENSITIVE'],
      targets: ['HYDRATION', 'BARRIER_SUPPORT'],
      useProfile: false,
      browseScope: 'FILTERED',
    },
  });
  assert.equal(result.searchQuality, 'RELAXED');
  assert.equal(result.catalogProducts[0].id, 'dr-althea-345');
  assert.equal(result.recommendations[0].product.price, 119900);
  assert.match(result.message, /coincidencia exacta/i);
});

test('relaxed discovery still rejects inactive, unavailable and unclassified products', async () => {
  const service = createCatalogDiscoveryService({ repository: { async findPublicCatalogProducts() {
    return [
      product({ id: 'inactive', status: 'inactive' }),
      product({ id: 'empty-stock', stock: 0 }),
      product({ id: 'fixture', catalogRole: 'DEV_FIXTURE' }),
    ];
  } } });
  const result = await service.discover({
    intent: 'DISCOVERY',
    profile,
    criteria: { routineSteps: ['MOISTURIZER'], brand: null, skinTypes: ['DRY'], conditions: ['SENSITIVE'], targets: ['HYDRATION'], useProfile: false, browseScope: 'FILTERED' },
  });
  assert.deepEqual(result.catalogProducts, []);
  assert.equal(result.searchQuality, 'EXACT');
});

test('exact product lookup remains independent from needs discovery', async () => {
  const resolver = createProductResolver({ repository: { async findCatalogProducts() { return [product()]; } } });
  const result = await resolver.resolveReferences(['Dr. Althea 345 Relief Cream'], { max: 1 });
  assert.equal(result.status, 'RESOLVED');
  assert.equal(result.products[0].price, 119900);
});

test('commercially eligible cream with missing cosmetic metadata remains a candidate', async () => {
  const service = createCatalogDiscoveryService({ repository: { async findPublicCatalogProducts() {
    return [product({ id: 'purchase-somi-18', routineStep: null, suitableSkinTypes: null, suitableConditions: null, targets: null, price: 119900, stock: 10 })];
  } } });
  const result = await service.discover({
    intent: 'DISCOVERY', profile, criteria: {
      routineSteps: ['MOISTURIZER'], brand: null, skinTypes: ['DRY'], conditions: ['SENSITIVE'], targets: ['HYDRATION'], useProfile: false, browseScope: 'FILTERED',
    },
  });
  assert.equal(result.searchQuality, 'INFERRED');
  assert.deepEqual(result.catalogProducts.map((item) => item.id), ['purchase-somi-18']);
  assert.equal(result.recommendations[0].product.price, 119900);
});

test('explicitly incompatible routine remains excluded while unknown metadata is not treated as a match', async () => {
  const service = createCatalogDiscoveryService({ repository: { async findPublicCatalogProducts() {
    return [
      product({ id: 'serum', name: 'Calming Serum', routineStep: 'SERUM', suitableSkinTypes: null, suitableConditions: null, targets: null }),
      product({ id: 'cream-json', routineStep: null, name: 'Relief Cream', suitableSkinTypes: '["DRY"]', suitableConditions: 'invalid-json', targets: '[]' }),
      product({ id: 'inactive', status: 'inactive', routineStep: null, name: 'Inactive Cream' }),
      product({ id: 'empty', stock: 0, routineStep: null, name: 'Empty Cream' }),
    ];
  } } });
  const result = await service.discover({
    intent: 'DISCOVERY', profile, criteria: { routineSteps: ['MOISTURIZER'], brand: null, skinTypes: ['DRY'], conditions: [], targets: [], useProfile: false },
  });
  assert.deepEqual(result.catalogProducts.map((item) => item.id), ['cream-json']);
});
