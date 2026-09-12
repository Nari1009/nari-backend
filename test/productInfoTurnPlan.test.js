const assert = require('node:assert/strict');
const test = require('node:test');
const { createAIService } = require('../src/services/ai/aiService');
const { createProductInfoService } = require('../src/services/ai/productInfoService');
const { createEmptyConversationState, createStateEnvelope, reduceConversationState, verifyStateEnvelope } = require('../src/services/ai/conversationState');

const SECRET = 'stage-five-product-info-test-secret-32-chars';
const profile = { skinType: 'OILY', conditions: [], targets: [], budget: null, routinePreference: 'simple', knownProducts: [], unresolvedOwnedProducts: [], ownedRoutineSteps: [] };
const product = (overrides = {}) => ({ id: 'p-moist', brand: 'Nari', name: 'Hidratante de prueba', slug: 'hidratante-de-prueba', price: 100, images: '[]', routineStep: 'MOISTURIZER', catalogRole: 'CATALOG', status: 'active', stock: 4, suitableSkinTypes: ['OILY'], suitableConditions: [], targets: ['HYDRATION'], ...overrides });

const interpretation = (referencePhrases = ['ese']) => ({
  intent: 'PRODUCT_INFO', mode: 'ANSWER', nextAction: 'ANSWER', scope: 'IN_SCOPE', requestedRoutineStep: null,
  message: 'Puedo ayudarte con ese producto.', profile, productReferences: referencePhrases, requestedSteps: [], relationToPrevious: 'FOLLOW_UP', referencePhrases,
});

const harness = ({ rows = [product()], providerMessage = 'Es un hidratante para el paso de hidratación.', providerMode = 'ANSWER', currentProductId = null } = {}) => {
  const byId = new Map(rows.map((row) => [String(row.id), row]));
  const provider = {
    async interpretConversation() { return interpretation(currentProductId ? [] : ['ese']); },
    async reasonProductInfo(input) {
      assert.ok(input.turnPlan);
      assert.ok(input.evidence);
      return { mode: providerMode, message: providerMessage };
    },
  };
  const productResolver = {
    async resolveReferences(references) {
      const ref = String(references[0]);
      const match = byId.get(ref) || (ref === 'ese' && currentProductId ? byId.get(String(currentProductId)) : rows.find((row) => row.name.toLowerCase().includes(ref.toLowerCase())));
      return match ? { status: 'RESOLVED', products: [match] } : { status: 'NOT_FOUND', products: [] };
    },
  };
  const service = createAIService({
    stateTransport: true,
    stateSecret: SECRET,
    turnPlanProductInfoFlow: true,
    provider,
    productResolver,
    productInfoService: createProductInfoService({ resolver: productResolver, finalProductRepository: { async findCurrentEligibleProducts(ids) { return rows.filter((row) => ids.map(String).includes(String(row.id)) && row.status === 'active' && Number(row.stock) > 0); } } }),
    finalProductRepository: { async findCurrentEligibleProducts(ids) { return rows.filter((row) => ids.map(String).includes(String(row.id)) && row.status === 'active' && Number(row.stock) > 0); } },
  });
  return { service };
};

test('authoritative PRODUCT_INFO resolves a recent recommendation and preserves a bounded focus artifact', async () => {
  const state = reduceConversationState(createEmptyConversationState(), { artifactEvidence: { recentRecommendations: [{ productId: 'p-moist', routineStep: 'MOISTURIZER' }] } });
  const result = await harness().service.advise({ message: '¿para qué sirve ese?', history: [], conversationState: createStateEnvelope(state, SECRET) });
  assert.equal(result.mode, 'ANSWER');
  const next = verifyStateEnvelope(result.conversationState, SECRET);
  assert.deepEqual(next.artifacts.recentProductReferences, [{ productId: 'p-moist', routineStep: 'MOISTURIZER' }]);
  assert.deepEqual(result.recommendations, []);
});

test('Product Info can explain a real catalog Product that is unavailable without presenting it as purchasable', async () => {
  const unavailable = product({ status: 'inactive', stock: 0 });
  const state = reduceConversationState(createEmptyConversationState(), { artifactEvidence: { recentProductReferences: [{ productId: unavailable.id, routineStep: unavailable.routineStep }] } });
  const result = await harness({ rows: [unavailable], providerMode: 'RECOMMENDATION', providerMessage: 'Puedo explicarte su función general, aunque ahora no está disponible para compra.' }).service.advise({ message: '¿me lo recomiendas?', history: [], conversationState: createStateEnvelope(state, SECRET) });
  assert.equal(result.mode, 'ANSWER');
  assert.deepEqual(result.recommendations, []);
});

test('Product Info preserves NULL metadata uncertainty and rejects unsupported suitability claims', async () => {
  const incomplete = product({ suitableSkinTypes: null });
  const state = reduceConversationState(createEmptyConversationState(), { artifactEvidence: { recentProductReferences: [{ productId: incomplete.id, routineStep: incomplete.routineStep }] } });
  await assert.rejects(
    () => harness({ rows: [incomplete], providerMessage: 'Es ideal para piel seca.' }).service.advise({ message: '¿es para piel seca?', history: [], conversationState: createStateEnvelope(state, SECRET) }),
    (error) => error.code === 'INVALID_AI_RESPONSE',
  );
});

test('Product Info resolves the current Product page context through Backend Product identity', async () => {
  const current = product({ id: 'p-current', name: 'Producto actual' });
  const result = await harness({ rows: [current], currentProductId: current.id }).service.advise({ message: '¿para qué sirve?', history: [], context: { currentProductId: current.id } });
  assert.equal(result.intent, 'PRODUCT_INFO');
  assert.match(result.message, /hidratante/i);
});

test('Product Info returns a recommendation only from currently purchasable resolved Products', async () => {
  const result = await harness({ providerMode: 'RECOMMENDATION', providerMessage: 'Te lo recomiendo como opción para el paso de hidratación.' }).service.advise({ message: '¿me lo recomiendas?', history: [], context: { currentProductId: 'p-moist' } });
  assert.equal(result.mode, 'RECOMMENDATION');
  assert.deepEqual(result.recommendations.map((item) => item.product.id), ['p-moist']);
});
