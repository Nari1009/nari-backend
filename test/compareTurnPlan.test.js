const assert = require('node:assert/strict');
const test = require('node:test');
const { createAIService } = require('../src/services/ai/aiService');
const { createCompareService, comparisonFacts } = require('../src/services/ai/compareService');
const { createEmptyConversationState, createStateEnvelope, reduceConversationState, verifyStateEnvelope } = require('../src/services/ai/conversationState');

const SECRET = 'stage-six-compare-test-secret-that-is-32-chars';
const profile = { skinType: 'DRY', conditions: [], targets: ['HYDRATION'], budget: null, routinePreference: null, knownProducts: [], unresolvedOwnedProducts: [], ownedRoutineSteps: [] };
const product = (id, overrides = {}) => ({ id, brand: 'Nari', name: `Product ${id}`, slug: `product-${id}`, price: 100, images: '[]', status: 'active', stock: 3, catalogRole: 'CATALOG', routineStep: 'MOISTURIZER', sizeLabel: '50 ml', suitableSkinTypes: ['DRY'], suitableConditions: [], targets: ['HYDRATION'], ...overrides });

const createHarness = ({ catalog, providerResult, referencePhrases = ['p-a', 'p-b'] } = {}) => {
  const byId = new Map(catalog.map((item) => [String(item.id), item]));
  const provider = {
    async interpretConversation() { return { intent: 'COMPARE', mode: 'ANSWER', nextAction: 'ANSWER', scope: 'IN_SCOPE', requestedRoutineStep: null, message: 'Compararé esos productos.', profile, productReferences: referencePhrases, requestedSteps: [], relationToPrevious: 'NONE', referencePhrases }; },
    async reasonComparison({ evidence }) {
      return providerResult || { mode: 'ANSWER', message: 'La comparación depende de la información disponible.', profile, comparison: { productIds: evidence.map((item) => item.productId), summary: 'Hay diferencias canónicas.', differences: ['La evidencia disponible no permite establecer un ganador absoluto.'], winnerProductId: null } };
    },
  };
  const productResolver = { async resolveReferences(refs) {
    const products = refs.map((ref) => byId.get(String(ref))).filter(Boolean);
    return products.length === refs.length ? { status: 'RESOLVED', products } : { status: 'NOT_FOUND', products: [] };
  } };
  const finalProductRepository = { async findCurrentEligibleProducts(ids) { return catalog.filter((item) => ids.map(String).includes(String(item.id)) && item.status === 'active' && Number(item.stock) > 0); } };
  const service = createAIService({ stateTransport: true, stateSecret: SECRET, turnPlanCompareFlow: true, provider, productResolver, compareService: createCompareService(), finalProductRepository });
  return { service };
};

test('authoritative COMPARE resolves exactly two explicit catalog Products and returns ordered focus', async () => {
  const rows = [product('p-a'), product('p-b')];
  const result = await createHarness({ catalog: rows }).service.advise({ message: 'p-a vs p-b' });
  assert.equal(result.intent, 'COMPARE');
  assert.deepEqual(result.comparison.productIds, ['p-a', 'p-b']);
  const state = verifyStateEnvelope(result.conversationState, SECRET);
  assert.deepEqual(state.artifacts.recentProductReferences.map((item) => item.productId), ['p-a', 'p-b']);
});

test('comparison follow-up reuses the same pair from signed Product focus', async () => {
  const rows = [product('p-a'), product('p-b')];
  const first = await createHarness({ catalog: rows }).service.advise({ message: 'p-a vs p-b' });
  const provider = {
    async interpretConversation() { return { intent: 'COMPARE', mode: 'ANSWER', nextAction: 'ANSWER', scope: 'IN_SCOPE', requestedRoutineStep: null, message: 'Revisaré los dos.', profile, productReferences: [], requestedSteps: [], relationToPrevious: 'FOLLOW_UP', referencePhrases: [] }; },
    async reasonComparison({ evidence }) { return { mode: 'ANSWER', message: 'Ambos tienen respaldo equivalente en lo conocido.', profile, comparison: { productIds: evidence.map((item) => item.productId), summary: 'Empate con la información disponible.', differences: ['No hay una diferencia canónica suficiente para elegir uno.'], winnerProductId: null } }; },
  };
  const byId = new Map(rows.map((row) => [row.id, row]));
  const resolver = { async resolveReferences(refs) { const products = refs.map((ref) => byId.get(String(ref))).filter(Boolean); return products.length === refs.length ? { status: 'RESOLVED', products } : { status: 'NOT_FOUND', products: [] }; } };
  const repo = { async findCurrentEligibleProducts(ids) { return rows.filter((row) => ids.includes(row.id)); } };
  const service = createAIService({ stateTransport: true, stateSecret: SECRET, turnPlanCompareFlow: true, provider, productResolver: resolver, compareService: createCompareService(), finalProductRepository: repo });
  const second = await service.advise({ message: '¿cuál de los dos es mejor para mí?', conversationState: first.conversationState });
  assert.equal(second.intent, 'COMPARE');
  assert.deepEqual(second.comparison.productIds, ['p-a', 'p-b']);
});

test('comparison permits unavailable Products but does not create a purchase card for them', async () => {
  const rows = [product('p-a', { stock: 0 }), product('p-b')];
  const result = await createHarness({ catalog: rows }).service.advise({ message: 'p-a vs p-b' });
  assert.equal(result.comparison.products[0].availability.purchasable, false);
  assert.deepEqual(result.recommendations, []);
});

test('comparison facts preserve NULL versus empty metadata and do not force a winner', () => {
  const facts = comparisonFacts([product('p-a', { suitableSkinTypes: ['DRY'] }), product('p-b', { suitableSkinTypes: null, suitableConditions: [], targets: [] })], profile);
  assert.equal(facts.fit[0].overall, 'SUPPORTED');
  assert.equal(facts.fit[1].overall, 'INSUFFICIENT_EVIDENCE');
  assert.equal(facts.outcome, 'INSUFFICIENT_EVIDENCE');
});

test('provider winner is rejected when evidence cannot defensibly support it', async () => {
  const rows = [product('p-a'), product('p-b')];
  const providerResult = { mode: 'RECOMMENDATION', message: 'El primero es mejor.', profile, comparison: { productIds: ['p-a', 'p-b'], summary: 'El primero gana.', differences: ['Diferencia.'], winnerProductId: 'p-a' } };
  await assert.rejects(() => createHarness({ catalog: rows, providerResult }).service.advise({ message: 'p-a vs p-b' }), (error) => error.code === 'INVALID_AI_RESPONSE');
});

test('different routine steps are non-substitutable and a provider winner is rejected', async () => {
  const rows = [product('p-a', { routineStep: 'CLEANSER' }), product('p-b', { routineStep: 'MOISTURIZER' })];
  const providerResult = { mode: 'RECOMMENDATION', message: 'El primero es mejor.', profile, comparison: { productIds: ['p-a', 'p-b'], summary: 'El primero gana.', differences: ['Cumplen funciones distintas.'], winnerProductId: 'p-a' } };
  await assert.rejects(() => createHarness({ catalog: rows, providerResult }).service.advise({ message: 'p-a vs p-b' }), (error) => error.code === 'INVALID_AI_RESPONSE');
});

test('ambiguous or incomplete comparison references return a follow-up without guessing', async () => {
  const result = await createHarness({ catalog: [product('p-a'), product('p-b')], referencePhrases: ['p-a'] }).service.advise({ message: 'Compara este producto' });
  assert.equal(result.mode, 'FOLLOW_UP');
  assert.deepEqual(result.recommendations, []);
});

test('provider cannot introduce a third Product into a comparison', async () => {
  const rows = [product('p-a'), product('p-b')];
  const providerResult = { mode: 'ANSWER', message: 'Comparación.', profile, comparison: { productIds: ['p-a', 'p-b', 'p-c'], summary: 'Tres.', differences: [], winnerProductId: null } };
  await assert.rejects(() => createHarness({ catalog: rows, providerResult }).service.advise({ message: 'p-a vs p-b' }), (error) => error.code === 'INVALID_AI_RESPONSE');
});
