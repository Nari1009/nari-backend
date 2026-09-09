const assert = require('node:assert/strict');
const test = require('node:test');
const { createAIService } = require('../src/services/ai/aiService');
const { AIServiceError } = require('../src/services/ai/errors');
const { createOpenAIProvider } = require('../src/services/ai/providers/openaiProvider');

const profile = (overrides = {}) => ({
  skinType: 'DRY',
  conditions: ['SENSITIVE'],
  targets: ['HYDRATION'],
  budget: null,
  routinePreference: null,
  knownProducts: [],
  ...overrides,
});

const candidate = (id, metadata = {}) => ({
  productId: id,
  score: 80,
  confidence: 'HIGH',
  matchedCriteria: ['ROUTINE_STEP'],
  unknownCriteria: [],
  neutralCriteria: [],
  conflicts: [],
  metadata: {
    id,
    name: `Candidato ${id}`,
    routineStep: 'MOISTURIZER',
    sizeLabel: '50 ml',
    suitableSkinTypes: ['DRY'],
    suitableConditions: ['SENSITIVE'],
    targets: ['HYDRATION'],
    ...metadata,
  },
});

const row = (id, overrides = {}) => ({
  id,
  name: `Nombre DB ${id}`,
  slug: `slug-${id}`,
  price: 123,
  images: JSON.stringify([`https://cdn.example/${id}.jpg`]),
  catalogRole: 'CATALOG',
  status: 'active',
  stock: 4,
  ...overrides,
});

const createHarness = ({ candidates = [candidate('p-1')], rows = [row('p-1')], reasoning = {}, onProviderInput = () => {}, onRefetch = () => {} } = {}) => {
  const initial = {
    intent: 'PRODUCT_SELECTION',
    mode: 'RECOMMENDATION',
    message: 'Encontré una opción.',
    profile: profile(),
  };
  const provider = {
    async interpretConversation() { return initial; },
    async reasonAmongCandidates(input) {
      onProviderInput(input);
      return {
        mode: 'RECOMMENDATION',
        message: 'Esta opción puede ayudarte.',
        selectedProductIds: ['p-1'],
        reasons: [{ productId: 'p-1', reason: 'Coincide con tu objetivo de hidratación.' }],
        profile: profile(),
        ...reasoning,
      };
    },
  };
  const service = createAIService({
    provider,
    candidateService: { search: async () => ({ searched: candidates.length > 0, candidates }) },
    finalProductRepository: { findCurrentEligibleProducts: async (ids) => { onRefetch(ids); return rows; } },
  });
  return service;
};

test('provider receives at most five safe candidates and preserves NULL versus []', async () => {
  let received;
  const candidates = [
    candidate('p-null', { suitableSkinTypes: null, suitableConditions: null, targets: null }),
    candidate('p-empty', { suitableSkinTypes: [], suitableConditions: [], targets: [] }),
    ...Array.from({ length: 6 }, (_, index) => candidate(`p-${index + 2}`)),
  ];
  const service = createHarness({ candidates, onProviderInput: (input) => { received = input; }, reasoning: { selectedProductIds: ['p-null'], reasons: [{ productId: 'p-null', reason: 'La información permanece parcialmente no resuelta.' }] }, rows: [row('p-null')] });
  await service.advise({ message: 'Quiero una hidratante' });
  assert.equal(received.candidates.length, 5);
  assert.equal('supplier' in received.candidates[0], false);
  assert.equal('cost' in received.candidates[0], false);
  assert.equal('catalogRole' in received.candidates[0], false);
  assert.equal(received.candidates[0].suitableSkinTypes, null);
  assert.deepEqual(received.candidates[1].suitableSkinTypes, []);
});

test('valid selected IDs are accepted and final Product data comes from DB', async () => {
  let refetched;
  const service = createHarness({ onRefetch: (ids) => { refetched = ids; } });
  const result = await service.advise({ message: 'Quiero una hidratante' });
  assert.deepEqual(refetched, ['p-1']);
  assert.deepEqual(result.recommendations, [{ product: { id: 'p-1', name: 'Nombre DB p-1', price: 123, image: 'https://cdn.example/p-1.jpg', slug: 'slug-p-1' }, reason: 'Coincide con tu objetivo de hidratación.' }]);
  assert.equal('selectedProductIds' in result, false);
  assert.equal('reasons' in result, false);
});

test('provider cannot select an invented or out-of-set Product ID', async () => {
  for (const selectedProductIds of [['invented'], ['p-2']]) {
    const service = createHarness({ reasoning: { selectedProductIds, reasons: [{ productId: selectedProductIds[0], reason: 'No válido.' }] } });
    await assert.rejects(() => service.advise({ message: 'Quiero una hidratante' }), (error) => error instanceof AIServiceError && error.code === 'INVALID_AI_RESPONSE');
  }
});

test('too many and duplicate selected IDs are rejected', async () => {
  const tooMany = createHarness({ candidates: Array.from({ length: 5 }, (_, index) => candidate(`p-${index + 1}`)), reasoning: { selectedProductIds: ['p-1', 'p-2', 'p-3', 'p-4'], reasons: ['x'] } });
  await assert.rejects(() => tooMany.advise({ message: 'Quiero opciones' }), /selección AI/);
  const duplicate = createHarness({ reasoning: { selectedProductIds: ['p-1', 'p-1'], reasons: [{ productId: 'p-1', reason: 'x' }] } });
  await assert.rejects(() => duplicate.advise({ message: 'Quiero opciones' }), /duplicados/);
});

test('recommendation mode without candidates falls back safely', async () => {
  const service = createHarness({ candidates: [], rows: [] });
  const result = await service.advise({ message: 'Quiero opciones' });
  assert.equal(result.mode, 'ANSWER');
  assert.deepEqual(result.recommendations, []);
});

test('final DB re-fetch removes Products that became unavailable and never replaces them', async () => {
  const service = createHarness({ candidates: [candidate('p-1'), candidate('p-2')], rows: [row('p-1')], reasoning: { selectedProductIds: ['p-1', 'p-2'], reasons: [{ productId: 'p-1', reason: 'Primera razón.' }, { productId: 'p-2', reason: 'Segunda razón.' }] } });
  const result = await service.advise({ message: 'Quiero opciones' });
  assert.deepEqual(result.recommendations.map((item) => item.product.id), ['p-1']);
});

test('all selected Products unavailable returns a safe non-recommendation', async () => {
  const service = createHarness({ rows: [], reasoning: { selectedProductIds: ['p-1'], reasons: [{ productId: 'p-1', reason: 'Razón.' }] } });
  const result = await service.advise({ message: 'Quiero opciones' });
  assert.equal(result.mode, 'ANSWER');
  assert.deepEqual(result.recommendations, []);
  assert.match(result.message, /ya no están disponibles/);
  assert.equal('selectedProductIds' in result, false);
  assert.equal('reasons' in result, false);
});

test('final eligibility rejects inactive, zero-stock and non-CATALOG rows', async () => {
  for (const invalid of [{ status: 'inactive' }, { stock: 0 }, { catalogRole: 'DEV_FIXTURE' }]) {
    const service = createHarness({ rows: [row('p-1', invalid)] });
    const result = await service.advise({ message: 'Quiero opciones' });
    assert.equal(result.mode, 'ANSWER');
    assert.deepEqual(result.recommendations, []);
  }
});

test('FOLLOW_UP reasoning returns no recommendations and validates the profile', async () => {
  const service = createHarness({ reasoning: { mode: 'FOLLOW_UP', message: '¿Cuál es tu tipo de piel?', selectedProductIds: [], reasons: [], profile: profile({ skinType: null }) } });
  const result = await service.advise({ message: 'Quiero opciones' });
  assert.equal(result.mode, 'FOLLOW_UP');
  assert.deepEqual(result.recommendations, []);
});

test('reason for an unselected Product is rejected and provider commercial fields do not pass through', async () => {
  const invalidReason = createHarness({ reasoning: { reasons: [{ productId: 'p-2', reason: 'No corresponde.' }] } });
  await assert.rejects(() => invalidReason.advise({ message: 'Quiero opciones' }), /razón AI/);
  const providerFields = createHarness({ reasoning: { price: 1, selectedProductIds: ['p-1'], reasons: [{ productId: 'p-1', reason: 'Válido.' }] } });
  await assert.rejects(() => providerFields.advise({ message: 'Quiero opciones' }), /campos no permitidos/);
});

test('partial Product with NULL skin suitability remains selectable without becoming universal', async () => {
  const service = createHarness({ candidates: [candidate('partial', { suitableSkinTypes: null })], rows: [row('partial')], reasoning: { selectedProductIds: ['partial'], reasons: [{ productId: 'partial', reason: 'El tipo de piel aún no está confirmado en el catálogo.' }] } });
  const result = await service.advise({ message: 'Quiero opciones' });
  assert.equal(result.recommendations[0].product.id, 'partial');
  assert.doesNotMatch(result.recommendations[0].reason, /todo tipo de piel/i);
});

test('invalid transient profile update is rejected', async () => {
  const service = createHarness({ reasoning: { profile: profile({ skinType: 'SENSITIVE' }) } });
  await assert.rejects(() => service.advise({ message: 'Quiero opciones' }), /tipo de piel/);
});

test('OpenAI adapter normalizes structured JSON and uses a bounded timeout without a live request', async () => {
  let requestBody;
  const provider = createOpenAIProvider({
    apiKey: 'test-only-key',
    enabled: true,
    timeoutMs: 50,
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      requestBody = JSON.parse(options.body);
      return { ok: true, json: async () => ({ output_text: JSON.stringify({ mode: 'FOLLOW_UP', message: '¿Qué buscas?', selectedProductIds: [], reasons: [], profile: profile() }) }) };
    },
  });
  const result = await provider.reasonAmongCandidates({ request: { message: 'x', history: [] }, interpretation: { intent: 'PRODUCT_SELECTION', profile: profile() }, candidates: [candidate('p-1')] });
  assert.equal(result.mode, 'FOLLOW_UP');
  assert.equal(requestBody.input[0].role, 'system');
  assert.match(requestBody.input[0].content, /solo puedes seleccionar/i);
  assert.equal(requestBody.store, false);
  assert.equal(requestBody.text.format.type, 'json_schema');
  assert.equal(requestBody.text.format.name, 'nari_candidate_reasoning');

  const nestedOutputProvider = createOpenAIProvider({
    apiKey: 'test-only-key',
    enabled: true,
    fetchImpl: async () => ({ ok: true, json: async () => ({ output: [
      { type: 'reasoning', content: [] },
      { type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ mode: 'FOLLOW_UP', message: '¿Qué buscas?', selectedProductIds: [], reasons: [], profile: profile() }) }] },
    ] }) }),
  });
  const nestedResult = await nestedOutputProvider.reasonAmongCandidates({ request: { message: 'x', history: [] }, interpretation: { intent: 'PRODUCT_SELECTION', profile: profile() }, candidates: [candidate('p-1')] });
  assert.equal(nestedResult.mode, 'FOLLOW_UP');

  const timeoutProvider = createOpenAIProvider({ apiKey: 'test-only-key', enabled: true, timeoutMs: 5, fetchImpl: (_url, options) => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => { const error = new Error('aborted'); error.name = 'AbortError'; reject(error); })) });
  await assert.rejects(() => timeoutProvider.interpretConversation({ message: 'x', history: [] }), (error) => error.code === 'AI_TIMEOUT');
});

test('OpenAI adapter is disabled without explicit DEV enablement or a key', async () => {
  const provider = createOpenAIProvider({ enabled: false, apiKey: 'test-only-key', fetchImpl: async () => { throw new Error('network must not be called'); } });
  await assert.rejects(() => provider.interpretConversation({ message: 'x', history: [] }), (error) => error.code === 'AI_UNAVAILABLE');
});
