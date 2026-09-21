const test = require('node:test');
const assert = require('node:assert/strict');
const { createEmptyConversationState } = require('../src/services/ai/conversationState');
const { createAgentToolFacade } = require('../src/services/ai/agentTools');
const { createAgentService } = require('../src/services/ai/agentService');

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

const product = (id, overrides = {}) => ({
  id,
  brand: 'NARI',
  name: `Product ${id}`,
  slug: `product-${id}`,
  price: 50000,
  images: ['https://cdn.example.test/product.jpg'],
  status: 'active',
  stock: 5,
  catalogRole: 'CATALOG',
  routineStep: 'MOISTURIZER',
  sizeLabel: '50 ml',
  suitableSkinTypes: ['OILY'],
  suitableConditions: [],
  targets: ['HYDRATION'],
  ...overrides,
});

const createHarness = ({ rows = [product('p-a'), product('p-b'), product('p-c')] } = {}) => {
  const byId = new Map(rows.map((row) => [String(row.id), row]));
  const productResolver = {
    async resolveReferences(references) {
      const resolved = references.map((reference) => byId.get(String(reference))).filter(Boolean);
      return resolved.length === references.length ? { status: 'RESOLVED', products: resolved } : { status: 'NOT_FOUND', products: [] };
    },
  };
  const candidateService = {
    async search({ excludeProductIds = [] } = {}) {
      return { searched: true, candidates: rows.filter((row) => !excludeProductIds.includes(String(row.id))).map((row) => ({ productId: row.id, metadata: row, score: 1 })) };
    },
  };
  const catalogDiscoveryService = {
    async discover() { return { catalogProducts: [], recommendations: [] }; },
  };
  return { rows, productResolver, toolFacade: createAgentToolFacade({ candidateService, catalogDiscoveryService, productResolver }) };
};

const agentOutput = ({ profileValue = { ...profile }, selectedProductIds = [], segments = [{ kind: 'GENERAL', productId: null, evidenceKeys: [], text: 'Puedo ayudarte con eso.' }], mode = 'ANSWER', updatedProfileFields = [] } = {}) => ({ mode, profile: profileValue, updatedProfileFields, segments, selectedProductIds });

test('search_catalog only returns eligible canonical Products and derives exclusions', async () => {
  const rows = [product('p-a'), product('p-b', { status: 'inactive' }), product('p-c', { stock: 0 }), product('fixture', { catalogRole: 'DEV_FIXTURE' })];
  const { toolFacade } = createHarness({ rows });
  const result = await toolFacade.execute('search_catalog', { mode: 'ALTERNATIVE', routineSteps: ['MOISTURIZER'], skinTypes: ['OILY'], conditions: null, targets: null, limit: 5, referenceProductIds: ['p-a'], profile: null, brand: null }, { state: createEmptyConversationState() });
  assert.deepEqual(result.excludedProductIds, ['p-a']);
  assert.deepEqual(result.products.map((item) => item.id), []);
});

test('search_catalog keeps exclusions step-scoped', async () => {
  const rows = [product('cleanser', { routineStep: 'CLEANSER' }), product('moisturizer', { routineStep: 'MOISTURIZER' })];
  const { toolFacade } = createHarness({ rows });
  const result = await toolFacade.execute('search_catalog', { mode: 'ALTERNATIVE', routineSteps: ['MOISTURIZER'], skinTypes: ['OILY'], conditions: null, targets: null, limit: 5, referenceProductIds: ['cleanser'], profile: null, brand: null }, { state: createEmptyConversationState() });
  assert.deepEqual(result.excludedProductIds, []);
  assert.deepEqual(result.products.map((item) => item.id), ['moisturizer']);
});

test('get_product_information can inspect unavailable Products without making them purchasable', async () => {
  const { toolFacade } = createHarness({ rows: [product('p-off', { stock: 0 })] });
  const result = await toolFacade.execute('get_product_information', { productIds: ['p-off'], productQuery: null }, { state: createEmptyConversationState() });
  assert.equal(result.products[0].availability.purchasable, false);
  assert.equal(result.products[0].product.id, 'p-off');
});

test('agent response creates cards only from tool results and updates canonical profile fields', async () => {
  const { toolFacade } = createHarness();
  const provider = {
    async runAgentTurn({ executeTool }) {
      const toolResult = await executeTool('search_catalog', { mode: 'RECOMMENDATION', routineSteps: ['MOISTURIZER'], skinTypes: ['OILY'], conditions: null, targets: null, limit: 5, referenceProductIds: [], profile: null, brand: null });
      return {
        toolCallCount: 1,
        toolResults: [toolResult],
        output: agentOutput({
          mode: 'RECOMMENDATION',
          selectedProductIds: ['p-a'],
          updatedProfileFields: ['skinType'],
          profileValue: { ...profile, skinType: 'OILY' },
          segments: [
            { kind: 'GENERAL', productId: null, evidenceKeys: [], text: 'Para empezar, esta opción encaja con lo que me contaste.' },
            { kind: 'PRODUCT_FACT', productId: 'p-a', evidenceKeys: ['routineStep', 'suitableSkinTypes'], text: 'Es un hidratante compatible con piel grasa.' },
          ],
        }),
      };
    },
  };
  const result = await createAgentService({ provider, toolFacade }).advise({ request: { message: '¿Qué productos me recomiendas?', history: [] }, state: createEmptyConversationState() });
  assert.equal(result.profile.skinType, 'OILY');
  assert.deepEqual(result.recommendations.map((item) => item.product.id), ['p-a']);
  assert.match(result.message, /hidratante/);
});

test('agent cannot select a Product that was not returned by a tool', async () => {
  const { toolFacade } = createHarness();
  const provider = {
    async runAgentTurn({ executeTool }) {
      const toolResult = await executeTool('search_catalog', { mode: 'RECOMMENDATION', routineSteps: ['MOISTURIZER'], skinTypes: ['OILY'], conditions: null, targets: null, limit: 1, referenceProductIds: [], profile: null, brand: null });
      return { toolCallCount: 1, toolResults: [toolResult], output: agentOutput({ mode: 'RECOMMENDATION', selectedProductIds: ['invented-id'], segments: [{ kind: 'GENERAL', productId: null, evidenceKeys: [], text: 'No puedo confirmar ese producto.' }] }) };
    },
  };
  await assert.rejects(() => createAgentService({ provider, toolFacade }).advise({ request: { message: 'recomiéndame algo', history: [] }, state: createEmptyConversationState() }), (error) => error.code === 'INVALID_AI_RESPONSE');
});

test('agent product claims cannot cite NULL or empty canonical evidence', async () => {
  const { toolFacade } = createHarness({ rows: [product('p-unknown', { suitableSkinTypes: null })] });
  const provider = {
    async runAgentTurn({ executeTool }) {
      const toolResult = await executeTool('get_product_information', { productIds: ['p-unknown'], productQuery: null });
      return { toolCallCount: 1, toolResults: [toolResult], output: agentOutput({ segments: [{ kind: 'PRODUCT_FACT', productId: 'p-unknown', evidenceKeys: ['suitableSkinTypes'], text: 'Es ideal para piel grasa.' }] }) };
    },
  };
  await assert.rejects(() => createAgentService({ provider, toolFacade }).advise({ request: { message: '¿me sirve?', history: [] }, state: createEmptyConversationState() }), (error) => error.code === 'INVALID_AI_RESPONSE');
});

test('general skincare guidance remains possible without Product evidence', async () => {
  const { toolFacade } = createHarness();
  const provider = { async runAgentTurn() { return { toolCallCount: 0, toolResults: [], output: agentOutput({ segments: [{ kind: 'GENERAL', productId: null, evidenceKeys: [], text: 'Introduce los productos de uno en uno y observa cómo responde tu piel.' }] }) }; } };
  const result = await createAgentService({ provider, toolFacade }).advise({ request: { message: '¿Cómo empiezo?', history: [] }, state: createEmptyConversationState() });
  assert.match(result.message, /uno en uno/);
  assert.deepEqual(result.recommendations, []);
});
