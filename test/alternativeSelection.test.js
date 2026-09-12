const assert = require('node:assert/strict');
const test = require('node:test');
const { createAIService } = require('../src/services/ai/aiService');

const profile = { skinType: 'COMBINATION', conditions: [], targets: [], budget: null, routinePreference: 'simple', knownProducts: [], unresolvedOwnedProducts: [], ownedRoutineSteps: [] };
const row = (id, step) => ({ id, name: id, slug: id, price: 100, images: '[]', routineStep: step, catalogRole: 'CATALOG', status: 'active', stock: 4 });
const candidate = (id, step) => ({ productId: id, score: 60, confidence: 'HIGH', matchedCriteria: ['ROUTINE_STEP', 'SKIN_TYPE'], metadata: { id, name: id, routineStep: step, suitableSkinTypes: ['COMBINATION'], suitableConditions: [], targets: [] } });

const createHarness = ({ candidates, selectedId = 'B', expectedExclusions, finalRows = [row('A', 'CLEANSER'), row('B', 'CLEANSER')] } = {}) => {
  let receivedCandidates;
  let receivedExclusions;
  const provider = {
    async interpretConversation() { return { scope: 'IN_SCOPE', intent: 'PRODUCT_SELECTION', mode: 'RECOMMENDATION', nextAction: 'RECOMMEND', requestedRoutineStep: null, message: 'Puedo buscar otra opción.', profile, productReferences: [] }; },
    async reasonAmongCandidates(input) { receivedCandidates = input.candidates; return { mode: 'RECOMMENDATION', message: 'Te muestro una opción distinta.', selectedProductIds: [selectedId], reasons: [{ productId: selectedId, reason: 'Texto del proveedor no usado.' }], profile }; },
  };
  const candidateService = { async search(input) { receivedExclusions = input.excludeProductIds; return { searched: true, candidates }; } };
  const finalProductRepository = { async findCurrentEligibleProducts(ids) { return finalRows.filter((item) => ids.map(String).includes(String(item.id))); } };
  const service = createAIService({ provider, candidateService, finalProductRepository });
  return { service, getCandidates: () => receivedCandidates, getExclusions: () => receivedExclusions };
};

test('alternative request excludes recent Product IDs before provider reasoning', async () => {
  const harness = createHarness({ candidates: [candidate('A', 'CLEANSER'), candidate('B', 'CLEANSER')] });
  const result = await harness.service.advise({ message: 'Dame otro limpiador que no sea ese.', context: { recentRecommendations: [{ productId: 'A', routineStep: 'CLEANSER' }] } });
  assert.deepEqual(harness.getExclusions(), ['A']);
  assert.deepEqual(harness.getCandidates().map((item) => item.id), ['B']);
  assert.deepEqual(result.recommendations.map((item) => item.product.id), ['B']);
  assert.match(result.recommendations[0].reason, /paso de limpiador|piel mixta/i);
});

test('provider cannot reselect an excluded Product', async () => {
  const harness = createHarness({ candidates: [candidate('A', 'CLEANSER'), candidate('B', 'CLEANSER')], selectedId: 'A' });
  await assert.rejects(() => harness.service.advise({ message: 'Dame otro que no sea ese.', context: { recentRecommendations: [{ productId: 'A', routineStep: 'CLEANSER' }] } }), (error) => error.code === 'INVALID_AI_RESPONSE');
});

test('normal recommendation does not automatically exclude recent Products', async () => {
  const harness = createHarness({ candidates: [candidate('A', 'CLEANSER'), candidate('B', 'CLEANSER')], selectedId: 'A' });
  const result = await harness.service.advise({ message: '¿Cuál me recomiendas?', context: { recentRecommendations: [{ productId: 'A', routineStep: 'CLEANSER' }] } });
  assert.deepEqual(harness.getExclusions(), []);
  assert.deepEqual(result.recommendations.map((item) => item.product.id), ['A']);
});

test('no eligible alternative returns no repeated Product', async () => {
  const harness = createHarness({ candidates: [candidate('A', 'CLEANSER')], selectedId: 'A', finalRows: [row('A', 'CLEANSER')] });
  const result = await harness.service.advise({ message: 'Otro limpiador distinto.', context: { recentRecommendations: [{ productId: 'A', routineStep: 'CLEANSER' }] } });
  assert.deepEqual(result.recommendations, []);
  assert.match(result.message, /alternativa distinta/i);
});
