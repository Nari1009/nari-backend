const assert = require('node:assert/strict');
const test = require('node:test');
const { createAIService } = require('../src/services/ai/aiService');
const { createPoint10Service, parseBudget } = require('../src/services/ai/point10Service');
const { createProductResolver } = require('../src/services/ai/productResolver');
const { CANDIDATE_WEIGHTS, MIN_CANDIDATE_SCORE, CANDIDATE_LIMIT } = require('../src/services/ai/candidates/candidateScoring');

const profile = (overrides = {}) => ({ skinType: 'DRY', conditions: [], targets: ['HYDRATION'], budget: null, routinePreference: null, knownProducts: [], ...overrides });
const product = (id, overrides = {}) => ({ id, name: `Product ${id}`, slug: `slug-${id}`, price: 100, images: JSON.stringify([`https://image/${id}.jpg`]), status: 'active', stock: 3, catalogRole: 'CATALOG', routineStep: 'MOISTURIZER', sizeLabel: '50 ml', suitableSkinTypes: ['DRY'], suitableConditions: [], targets: ['HYDRATION'], ...overrides });
const candidate = (id, step, price = 100, score = 80) => ({ productId: id, price, score, metadata: { id, name: `Candidate ${id}`, routineStep: step, sizeLabel: '50 ml', suitableSkinTypes: ['DRY'], suitableConditions: [], targets: ['HYDRATION'] } });

const createHarness = ({ interpretation, catalog, candidatesByStep = {}, finalRows = catalog, provider = {} } = {}) => {
  const resolver = createProductResolver({ repository: { async findCatalogProducts() { return catalog; } } });
  const candidateService = { async search({ requestedRoutineStep }) { return { searched: true, candidates: candidatesByStep[requestedRoutineStep] || [] }; } };
  const finalProductRepository = { async findCurrentEligibleProducts(ids) { return finalRows.filter((row) => ids.includes(String(row.id))); } };
  const point10Service = createPoint10Service({ resolver, candidateService, finalProductRepository });
  const initial = interpretation || { intent: 'COMPARE', mode: 'RECOMMENDATION', message: 'Solicitud.', profile: profile(), productReferences: [] };
  const baseProvider = {
    async interpretConversation() { return initial; },
    async reasonComparison(input) { return { mode: 'ANSWER', message: 'Comparación por evidencia confirmada.', profile: initial.profile, comparison: { productIds: input.products.map((item) => item.id), summary: 'Hay diferencias.', differences: ['La información disponible es parcial.'], winnerProductId: null }, ...provider.comparison }; },
    async reasonCompatibility(input) { return { mode: 'ANSWER', message: 'Puedo confirmar el orden estructural, no la fórmula.', profile: initial.profile, compatibility: { productIds: input.products.map((item) => item.id), period: 'SAME_ROUTINE', orderProductIds: input.products.map((item) => item.id), structuralStatus: 'COMPATIBLE', formulaLevel: 'UNKNOWN', summary: 'La fórmula permanece sin confirmar.' }, ...provider.compatibility }; },
  };
  Object.assign(baseProvider, provider);
  return createAIService({ provider: baseProvider, point10Service, candidateService, finalProductRepository });
};

test('Product resolver accepts exact ID/name and excludes DEV_FIXTURE', async () => {
  const catalog = [product('p-1', { name: 'Dr. Althea 345 Relief Cream' }), product('fixture', { catalogRole: 'DEV_FIXTURE' })];
  const resolver = createProductResolver({ repository: { async findCatalogProducts() { return catalog.filter((item) => item.catalogRole === 'CATALOG'); } } });
  assert.equal((await resolver.resolveReferences(['p-1'])).status, 'RESOLVED');
  assert.equal((await resolver.resolveReferences(['dr althea 345 relief cream'])).products[0].id, 'p-1');
  assert.equal((await resolver.resolveReferences(['fixture'])).status, 'NOT_FOUND');
});

test('ambiguous and unknown Product references require follow-up', async () => {
  const catalog = [product('p-1', { name: 'Anua Toner' }), product('p-2', { name: 'Anua Toner Plus' })];
  const service = createHarness({ catalog, interpretation: { intent: 'COMPARE', mode: 'RECOMMENDATION', message: 'Compara', profile: profile(), productReferences: ['Anua'] } });
  assert.equal((await service.advise({ message: 'Compara Anua' })).mode, 'FOLLOW_UP');
  const unknown = createHarness({ catalog, interpretation: { intent: 'COMPARE', mode: 'RECOMMENDATION', message: 'Compara', profile: profile(), productReferences: ['No existe'] } });
  assert.equal((await unknown.advise({ message: 'Compara' })).mode, 'FOLLOW_UP');
});

test('generic Product references never resolve an arbitrary catalog row', async () => {
  const catalog = [product('p-1', { name: 'Serum de hidratación' })];
  const resolver = createProductResolver({ repository: { async findCatalogProducts() { return catalog; } } });
  assert.equal((await resolver.resolveReferences(['serum'])).status, 'AMBIGUOUS');
  assert.equal((await resolver.resolveReferences(['toner'])).status, 'AMBIGUOUS');
});

test('Product reference matching is deterministic and excludes NULL catalog roles', async () => {
  const catalog = [
    product('p-2', { name: 'Crema NARI' }),
    product('p-1', { name: 'Crema NARI' }),
    product('unknown', { name: 'Crema NARI', catalogRole: null }),
  ];
  const resolver = createProductResolver({ repository: { async findCatalogProducts() { return catalog; } } });
  const result = await resolver.resolveReferences(['crema nari']);
  assert.equal(result.status, 'AMBIGUOUS');
  assert.deepEqual(result.results[0].products.map((item) => item.id), ['p-1', 'p-2']);
  assert.equal((await resolver.resolveReferences(['unknown'])).status, 'NOT_FOUND');
});

test('COMPARE uses resolved safe Products and does not declare a winner without evidence', async () => {
  let received;
  const catalog = [product('p-1', { suitableSkinTypes: ['DRY'] }), product('p-2', { suitableSkinTypes: null, supplier: 'private', cost: 2 })];
  const service = createHarness({ catalog, interpretation: { intent: 'COMPARE', mode: 'RECOMMENDATION', message: 'Compara', profile: profile(), productReferences: ['p-1', 'p-2'] }, provider: { async reasonComparison(input) { received = input; return { mode: 'ANSWER', message: 'No hay un ganador absoluto.', profile: profile(), comparison: { productIds: ['p-1', 'p-2'], summary: 'La segunda opción tiene datos sin resolver.', differences: ['El tipo de piel no está confirmado para una opción.'], winnerProductId: null } }; } } });
  const result = await service.advise({ message: 'Compara' });
  assert.equal(result.comparison.products.length, 2);
  assert.equal('supplier' in received.products[1], false);
  assert.equal(received.products[1].suitableSkinTypes, null);
  assert.deepEqual(result.recommendations, []);
});

test('COMPARE rejects provider winner outside resolved set and unavailable winner is not purchasable', async () => {
  const catalog = [product('p-1'), product('p-2')];
  const invalid = createHarness({ catalog, interpretation: { intent: 'COMPARE', mode: 'RECOMMENDATION', message: 'Compara', profile: profile(), productReferences: ['p-1', 'p-2'] }, provider: { async reasonComparison() { return { mode: 'RECOMMENDATION', message: 'A gana.', profile: profile(), comparison: { productIds: ['p-1', 'p-2'], summary: 'A.', differences: [], winnerProductId: 'invented' } }; } } });
  await assert.rejects(() => invalid.advise({ message: 'Compara' }), /ganador|válido/);
  const unavailable = createHarness({ catalog, finalRows: [product('p-2')], interpretation: { intent: 'COMPARE', mode: 'RECOMMENDATION', message: 'Compara', profile: profile(), productReferences: ['p-1', 'p-2'] }, provider: { async reasonComparison() { return { mode: 'RECOMMENDATION', message: 'A gana.', profile: profile(), comparison: { productIds: ['p-1', 'p-2'], summary: 'A.', differences: ['Tiene mejor ajuste según el criterio indicado.'], winnerProductId: 'p-1' } }; } } });
  assert.deepEqual((await unavailable.advise({ message: 'Compara' })).recommendations, []);
});

test('COMPATIBILITY confirms structure only and cannot assert formula compatibility', async () => {
  const catalog = [product('cleanser', { routineStep: 'CLEANSER' }), product('serum', { routineStep: 'SERUM' })];
  const service = createHarness({ catalog, interpretation: { intent: 'COMPATIBILITY', mode: 'RECOMMENDATION', message: '¿Puedo usarlos?', profile: profile(), productReferences: ['cleanser', 'serum'] } });
  const result = await service.advise({ message: '¿Puedo usarlos?' });
  assert.equal(result.compatibility.structuralStatus, 'COMPATIBLE');
  assert.equal(result.compatibility.formulaLevel, 'UNKNOWN');
  const unsafe = createHarness({ catalog, interpretation: { intent: 'COMPATIBILITY', mode: 'RECOMMENDATION', message: '¿Puedo usarlos?', profile: profile(), productReferences: ['cleanser', 'serum'] }, provider: { async reasonCompatibility(input) { return { mode: 'ANSWER', message: 'Son 100% compatibles.', profile: profile(), compatibility: { productIds: ['cleanser', 'serum'], period: 'SAME_ROUTINE', orderProductIds: input.products.map((item) => item.id), structuralStatus: 'COMPATIBLE', formulaLevel: 'CONFIRMED', summary: 'Seguro.' } }; } } });
  await assert.rejects(() => unsafe.advise({ message: '¿Puedo usarlos?' }), /fórmula/);
});

test('COMPATIBILITY does not expose unsupported provider formula claims', async () => {
  const catalog = [product('cleanser', { routineStep: 'CLEANSER' }), product('serum', { routineStep: 'SERUM' })];
  const service = createHarness({ catalog, interpretation: { intent: 'COMPATIBILITY', mode: 'RECOMMENDATION', message: '¿Puedo usarlos?', profile: profile(), productReferences: ['cleanser', 'serum'] }, provider: { async reasonCompatibility(input) { return { mode: 'ANSWER', message: 'Son 100% compatibles y no irritan.', profile: profile(), compatibility: { productIds: input.products.map((item) => item.id), period: 'SAME_ROUTINE', orderProductIds: input.products.map((item) => item.id), structuralStatus: 'COMPATIBLE', formulaLevel: 'UNKNOWN', summary: 'Todo bien.' } }; } } });
  const result = await service.advise({ message: '¿Puedo usarlos?' });
  assert.match(result.message, /compatibilidad de fórmula o activos no está confirmada/);
  assert.match(result.compatibility.summary, /compatibilidad de fórmula o activos no está confirmada/);
  assert.doesNotMatch(result.message, /100% compatibles/);
});

test('COMPATIBILITY rejects sunscreen in the evening structurally', async () => {
  const catalog = [product('cleanser', { routineStep: 'CLEANSER' }), product('spf', { routineStep: 'SUNSCREEN' })];
  const service = createHarness({ catalog, interpretation: { intent: 'COMPATIBILITY', mode: 'RECOMMENDATION', message: 'Noche', profile: profile(), productReferences: ['cleanser', 'spf'] }, provider: { async reasonCompatibility(input) { return { mode: 'ANSWER', message: 'Orden.', profile: profile(), compatibility: { productIds: ['cleanser', 'spf'], period: 'EVENING', orderProductIds: input.products.map((item) => item.id), structuralStatus: 'COMPATIBLE', formulaLevel: 'UNKNOWN', summary: 'Orden.' } }; } } });
  assert.equal((await service.advise({ message: 'Noche' })).compatibility.structuralStatus, 'CONFLICT');
});

test('BUDGET_ROUTINE optimizes unique current DB prices in COP and does not spend the full limit', async () => {
  const catalog = [];
  const candidatesByStep = {
    CLEANSER: [candidate('cleanser', 'CLEANSER', 100, 90)],
    MOISTURIZER: [candidate('moisturizer', 'MOISTURIZER', 150, 85)],
    SUNSCREEN: [candidate('sunscreen', 'SUNSCREEN', 80, 80)],
  };
  const rows = [product('cleanser', { routineStep: 'CLEANSER', price: 100 }), product('moisturizer', { price: 150 }), product('sunscreen', { routineStep: 'SUNSCREEN', price: 80 })];
  const service = createHarness({ catalog, candidatesByStep, finalRows: rows, interpretation: { intent: 'BUDGET_ROUTINE', mode: 'RECOMMENDATION', message: 'Rutina económica', profile: profile({ budget: '500000', targets: [] }), productReferences: [] } });
  const result = await service.advise({ message: 'Rutina económica' });
  assert.equal(result.budget.currency, 'COP');
  assert.equal(result.budget.total, 330);
  assert.equal(result.budget.withinBudget, true);
  assert.equal(result.recommendations.length, 3);
});

test('BUDGET_ROUTINE excludes owned Product price from purchase total', async () => {
  const owned = product('owned-moisturizer', { routineStep: 'MOISTURIZER', price: 999999, stock: 0 });
  const catalog = [owned, product('cleanser', { routineStep: 'CLEANSER' }), product('sunscreen', { routineStep: 'SUNSCREEN' })];
  const candidatesByStep = { CLEANSER: [candidate('cleanser', 'CLEANSER', 100)], SUNSCREEN: [candidate('sunscreen', 'SUNSCREEN', 80)] };
  const finalRows = [product('cleanser', { routineStep: 'CLEANSER', price: 100 }), product('sunscreen', { routineStep: 'SUNSCREEN', price: 80 })];
  const service = createHarness({ catalog, candidatesByStep, finalRows, interpretation: { intent: 'BUDGET_ROUTINE', mode: 'RECOMMENDATION', message: 'Rutina', profile: profile({ budget: '200000', targets: [], knownProducts: ['owned-moisturizer'] }), productReferences: [] } });
  const result = await service.advise({ message: 'Rutina' });
  assert.equal(result.budget.total, 180);
  assert.deepEqual(result.recommendations.map((item) => item.product.id).sort(), ['cleanser', 'sunscreen']);
  assert.equal(result.routine.morning.find((item) => item.step === 'MOISTURIZER').source, 'OWNED');
});

test('BUDGET_ROUTINE rejects a final current price change that breaks the limit', async () => {
  const candidatesByStep = {
    CLEANSER: [candidate('cleanser', 'CLEANSER', 100)],
    MOISTURIZER: [candidate('moisturizer', 'MOISTURIZER', 150)],
    SUNSCREEN: [candidate('sunscreen', 'SUNSCREEN', 80)],
  };
  const finalRows = [product('cleanser', { routineStep: 'CLEANSER', price: 100 }), product('moisturizer', { price: 500000 }), product('sunscreen', { routineStep: 'SUNSCREEN', price: 80 })];
  const service = createHarness({ catalog: [], candidatesByStep, finalRows, interpretation: { intent: 'BUDGET_ROUTINE', mode: 'RECOMMENDATION', message: 'Rutina', profile: profile({ budget: '400000', targets: [] }), productReferences: [] } });
  const result = await service.advise({ message: 'Rutina' });
  assert.equal(result.mode, 'ANSWER');
  assert.deepEqual(result.recommendations, []);
});

test('invalid or insufficient budget is safe and does not fabricate a routine', async () => {
  assert.equal(parseBudget('-10'), -10);
  const service = createHarness({ interpretation: { intent: 'BUDGET_ROUTINE', mode: 'RECOMMENDATION', message: 'Rutina', profile: profile({ budget: '0', targets: [] }), productReferences: [] } });
  const result = await service.advise({ message: 'Rutina' });
  assert.equal(result.mode, 'ANSWER');
  assert.equal(result.routine, null);
  assert.deepEqual(result.recommendations, []);
});

test('budget prefers stronger fit over a cheaper complete routine', async () => {
  const candidatesByStep = {
    CLEANSER: [candidate('cheap-cleanser', 'CLEANSER', 50, 20), candidate('fit-cleanser', 'CLEANSER', 100, 40)],
    MOISTURIZER: [candidate('cheap-moisturizer', 'MOISTURIZER', 50, 20), candidate('fit-moisturizer', 'MOISTURIZER', 100, 40)],
    SUNSCREEN: [candidate('cheap-sunscreen', 'SUNSCREEN', 150, 20), candidate('fit-sunscreen', 'SUNSCREEN', 80, 40)],
  };
  const rows = Object.entries({
    'cheap-cleanser': ['CLEANSER', 50], 'fit-cleanser': ['CLEANSER', 100],
    'cheap-moisturizer': ['MOISTURIZER', 50], 'fit-moisturizer': ['MOISTURIZER', 100],
    'cheap-sunscreen': ['SUNSCREEN', 150], 'fit-sunscreen': ['SUNSCREEN', 80],
  }).map(([id, [routineStep, price]]) => product(id, { routineStep, price }));
  const service = createHarness({ candidatesByStep, finalRows: rows, interpretation: { intent: 'BUDGET_ROUTINE', mode: 'RECOMMENDATION', message: 'Rutina', profile: profile({ budget: '300', targets: [] }), productReferences: [] } });
  const result = await service.advise({ message: 'Rutina' });
  assert.equal(result.budget.total, 280);
  assert.deepEqual(result.recommendations.map((item) => item.product.id).sort(), ['fit-cleanser', 'fit-moisturizer', 'fit-sunscreen'].sort());
});

test('candidate scoring constants preserve the R11D.6 contract', () => {
  assert.deepEqual(CANDIDATE_WEIGHTS, { routineStepMatch: 40, skinTypeMatch: 20, conditionMatch: 12, targetMatch: 10, unknownPenalty: 2 });
  assert.equal(MIN_CANDIDATE_SCORE, 10);
  assert.equal(CANDIDATE_LIMIT, 5);
});

test('owned Product covers its step without repurchase and may be out of stock', async () => {
  const owned = product('owned-cleanser', { routineStep: 'CLEANSER', status: 'inactive', stock: 0 });
  const catalog = [owned, product('moisturizer', { routineStep: 'MOISTURIZER' }), product('sunscreen', { routineStep: 'SUNSCREEN' })];
  const candidatesByStep = { MOISTURIZER: [candidate('moisturizer', 'MOISTURIZER')], SUNSCREEN: [candidate('sunscreen', 'SUNSCREEN')] };
  const service = createHarness({ catalog, candidatesByStep, finalRows: [product('moisturizer'), product('sunscreen', { routineStep: 'SUNSCREEN' })], interpretation: { intent: 'BUILD_ROUTINE', mode: 'RECOMMENDATION', message: 'Completa', profile: profile({ knownProducts: ['owned-cleanser'], targets: [] }), productReferences: [] } });
  const result = await service.advise({ message: 'Completa' });
  assert.equal(result.routine.morning.find((item) => item.step === 'CLEANSER').source, 'OWNED');
  assert.equal(result.routine.evening.find((item) => item.step === 'CLEANSER').source, 'OWNED');
  assert.deepEqual(result.recommendations.map((item) => item.product.id).sort(), ['moisturizer', 'sunscreen']);
  assert.equal(result.recommendations.some((item) => item.product.id === 'owned-cleanser'), false);
});

test('owned DEV_FIXTURE or unresolved routine step cannot enter the personal routine', async () => {
  const fixture = createHarness({ catalog: [product('fixture', { catalogRole: 'DEV_FIXTURE' })], interpretation: { intent: 'BUILD_ROUTINE', mode: 'RECOMMENDATION', message: 'Completa', profile: profile({ knownProducts: ['fixture'] }), productReferences: [] } });
  assert.equal((await fixture.advise({ message: 'Completa' })).mode, 'FOLLOW_UP');
  const unresolved = createHarness({ catalog: [product('unknown', { routineStep: null })], interpretation: { intent: 'BUILD_ROUTINE', mode: 'RECOMMENDATION', message: 'Completa', profile: profile({ knownProducts: ['unknown'] }), productReferences: [] } });
  assert.equal((await unresolved.advise({ message: 'Completa' })).mode, 'FOLLOW_UP');
});

test('budget parsing accepts COP thousands notation safely', () => {
  assert.equal(parseBudget('500.000'), 500000);
  assert.equal(parseBudget('500,000'), 500000);
  assert.equal(parseBudget('500.000,50'), 500000.5);
});
