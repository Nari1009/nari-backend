const assert = require('node:assert/strict');
const test = require('node:test');
const { createAIService } = require('../src/services/ai/aiService');
const { createEmptyConversationState, createStateEnvelope, reduceConversationState } = require('../src/services/ai/conversationState');

const SECRET = 'stage-three-test-secret-that-is-at-least-32-chars';
const profile = { skinType: 'COMBINATION', conditions: [], targets: [], budget: null, routinePreference: 'simple', knownProducts: [], unresolvedOwnedProducts: [], ownedRoutineSteps: [] };
const row = (id, routineStep) => ({ id, name: id, slug: id, price: 100, images: '[]', routineStep, catalogRole: 'CATALOG', status: 'active', stock: 5, suitableSkinTypes: ['COMBINATION'], suitableConditions: [], targets: [] });
const candidate = (id, routineStep) => ({ productId: id, score: 60, confidence: 'HIGH', matchedCriteria: ['ROUTINE_STEP', 'SKIN_TYPE'], metadata: row(id, routineStep) });

const createHarness = ({ interpretation, candidatesByStep, selectedProductId, rows, referenceResult = { status: 'NOT_FOUND', products: [] } } = {}) => {
  const searches = [];
  const provider = {
    async interpretConversation() { return interpretation; },
    async reasonAmongCandidates({ candidates }) {
      const selected = selectedProductId || candidates[0]?.id;
      return { mode: 'RECOMMENDATION', message: 'Encontré una opción para ti.', selectedProductIds: selected ? [selected] : [], reasons: selected ? [{ productId: selected, reason: 'Encaja con el paso solicitado.' }] : [], profile };
    },
  };
  const service = createAIService({
    stateTransport: true,
    stateSecret: SECRET,
    turnPlanSelectionFlow: true,
    provider,
    productResolver: { async resolveReferences() { return referenceResult; } },
    candidateService: { async search(input) { searches.push(input); return { searched: true, candidates: candidatesByStep[input.requestedRoutineStep || '__general'] || [] }; } },
    finalProductRepository: { async findCurrentEligibleProducts(ids) { return (rows || []).filter((item) => ids.map(String).includes(String(item.id))); } },
  });
  return { service, searches };
};

const interpretation = ({ requestedSteps = ['MOISTURIZER'], relationToPrevious = 'NONE', referencePhrases = [] } = {}) => ({
  intent: 'PRODUCT_SELECTION', mode: 'RECOMMENDATION', nextAction: 'RECOMMEND', message: 'Buscaré una opción.', profile, productReferences: [], requestedSteps, relationToPrevious, referencePhrases,
});

test('authoritative TurnPlan performs normal Product selection without exclusions', async () => {
  const harness = createHarness({ interpretation: interpretation(), candidatesByStep: { MOISTURIZER: [candidate('moist-a', 'MOISTURIZER')] }, selectedProductId: 'moist-a', rows: [row('moist-a', 'MOISTURIZER')] });
  const result = await harness.service.advise({ message: '¿Qué hidratante me recomiendas?' });

  assert.deepEqual(harness.searches[0].excludeProductIds, []);
  assert.deepEqual(result.recommendations.map((item) => item.product.id), ['moist-a']);
});

test('broad alternative selection executes from three signed recommendation artifacts', async () => {
  const state = reduceConversationState(createEmptyConversationState(), {
    artifactEvidence: { recentRecommendations: [
      { productId: 'clean-a', routineStep: 'CLEANSER' },
      { productId: 'moist-a', routineStep: 'MOISTURIZER' },
      { productId: 'spf-a', routineStep: 'SUNSCREEN' },
    ] },
  });
  const harness = createHarness({
    interpretation: interpretation({ requestedSteps: [], relationToPrevious: 'ALTERNATIVE', referencePhrases: [] }),
    candidatesByStep: { __general: [candidate('clean-b', 'CLEANSER'), candidate('moist-b', 'MOISTURIZER'), candidate('spf-b', 'SUNSCREEN')] },
    selectedProductId: 'clean-b',
    rows: [row('clean-a', 'CLEANSER'), row('moist-a', 'MOISTURIZER'), row('spf-a', 'SUNSCREEN'), row('clean-b', 'CLEANSER'), row('moist-b', 'MOISTURIZER'), row('spf-b', 'SUNSCREEN')],
  });
  const result = await harness.service.advise({ message: '¿Qué otros productos me puedes recomendar?', conversationState: createStateEnvelope(state, SECRET) });

  assert.equal(harness.searches.length, 1);
  assert.deepEqual(harness.searches[0].excludeProductIds.sort(), ['clean-a', 'moist-a', 'spf-a']);
  assert.deepEqual(result.recommendations.map((item) => item.product.id), ['clean-b']);
});

test('broad alternative wording reaches candidates without a concrete reference', async () => {
  const state = reduceConversationState(createEmptyConversationState(), { artifactEvidence: { recentRecommendations: [{ productId: 'moist-a', routineStep: 'MOISTURIZER' }] } });
  const harness = createHarness({ interpretation: interpretation({ requestedSteps: [], relationToPrevious: 'ALTERNATIVE', referencePhrases: [] }), candidatesByStep: { __general: [candidate('moist-b', 'MOISTURIZER')] }, selectedProductId: 'moist-b', rows: [row('moist-a', 'MOISTURIZER'), row('moist-b', 'MOISTURIZER')] });
  const result = await harness.service.advise({ message: '¿Tienes otras opciones?', conversationState: createStateEnvelope(state, SECRET) });

  assert.deepEqual(harness.searches[0].excludeProductIds, ['moist-a']);
  assert.deepEqual(result.recommendations.map((item) => item.product.id), ['moist-b']);
});

test('alternative selection excludes the previous step-scoped Product before provider projection', async () => {
  const firstState = reduceConversationState(createEmptyConversationState(), { artifactEvidence: { recentRecommendations: [{ productId: 'moist-a', routineStep: 'MOISTURIZER' }] } });
  const harness = createHarness({ interpretation: interpretation({ relationToPrevious: 'ALTERNATIVE' }), candidatesByStep: { MOISTURIZER: [candidate('moist-b', 'MOISTURIZER')] }, selectedProductId: 'moist-b', rows: [row('moist-a', 'MOISTURIZER'), row('moist-b', 'MOISTURIZER')] });
  const result = await harness.service.advise({ message: 'Dame otro hidratante.', conversationState: createStateEnvelope(firstState, SECRET) });

  assert.deepEqual(harness.searches[0].excludeProductIds, ['moist-a']);
  assert.deepEqual(result.recommendations.map((item) => item.product.id), ['moist-b']);
});

test('step-scoped exclusions do not remove unrelated recent Products', async () => {
  const state = reduceConversationState(createEmptyConversationState(), {
    artifactEvidence: { recentRecommendations: [{ productId: 'clean-a', routineStep: 'CLEANSER' }, { productId: 'moist-a', routineStep: 'MOISTURIZER' }] },
  });
  const harness = createHarness({ interpretation: interpretation({ relationToPrevious: 'ALTERNATIVE' }), candidatesByStep: { MOISTURIZER: [candidate('moist-b', 'MOISTURIZER')] }, selectedProductId: 'moist-b', rows: [row('clean-a', 'CLEANSER'), row('moist-a', 'MOISTURIZER'), row('moist-b', 'MOISTURIZER')] });
  await harness.service.advise({ message: 'Dame otro hidratante.', conversationState: createStateEnvelope(state, SECRET) });

  assert.deepEqual(harness.searches[0].excludeProductIds, ['moist-a']);
  assert.equal(harness.searches[0].excludeProductIds.includes('clean-a'), false);
});

test('sunscreen alternative keeps unrelated routine Products eligible', async () => {
  const state = reduceConversationState(createEmptyConversationState(), { artifactEvidence: { recentRecommendations: [{ productId: 'clean-a', routineStep: 'CLEANSER' }, { productId: 'spf-a', routineStep: 'SUNSCREEN' }] } });
  const harness = createHarness({ interpretation: interpretation({ requestedSteps: ['SUNSCREEN'], relationToPrevious: 'ALTERNATIVE', referencePhrases: [] }), candidatesByStep: { SUNSCREEN: [candidate('spf-b', 'SUNSCREEN')] }, selectedProductId: 'spf-b', rows: [row('clean-a', 'CLEANSER'), row('spf-a', 'SUNSCREEN'), row('spf-b', 'SUNSCREEN')] });
  await harness.service.advise({ message: '¿Tienes otra opción para el protector solar?', conversationState: createStateEnvelope(state, SECRET) });

  assert.deepEqual(harness.searches[0].excludeProductIds, ['spf-a']);
  assert.equal(harness.searches[0].excludeProductIds.includes('clean-a'), false);
});

test('moisturizer alternative remains scoped to the moisturizer step', async () => {
  const state = reduceConversationState(createEmptyConversationState(), { artifactEvidence: { recentRecommendations: [{ productId: 'clean-a', routineStep: 'CLEANSER' }, { productId: 'moist-a', routineStep: 'MOISTURIZER' }] } });
  const harness = createHarness({ interpretation: interpretation({ requestedSteps: ['MOISTURIZER'], relationToPrevious: 'ALTERNATIVE', referencePhrases: [] }), candidatesByStep: { MOISTURIZER: [candidate('moist-b', 'MOISTURIZER')] }, selectedProductId: 'moist-b', rows: [row('clean-a', 'CLEANSER'), row('moist-a', 'MOISTURIZER'), row('moist-b', 'MOISTURIZER')] });
  await harness.service.advise({ message: '¿Tienes otra opción para el hidratante?', conversationState: createStateEnvelope(state, SECRET) });

  assert.deepEqual(harness.searches[0].excludeProductIds, ['moist-a']);
  assert.equal(harness.searches[0].excludeProductIds.includes('clean-a'), false);
});

test('no alternative returns no recommendations and never repeats the excluded Product', async () => {
  const state = reduceConversationState(createEmptyConversationState(), { artifactEvidence: { recentRecommendations: [{ productId: 'moist-a', routineStep: 'MOISTURIZER' }] } });
  const harness = createHarness({ interpretation: interpretation({ relationToPrevious: 'ALTERNATIVE' }), candidatesByStep: { MOISTURIZER: [] }, selectedProductId: 'moist-a', rows: [row('moist-a', 'MOISTURIZER')] });
  const result = await harness.service.advise({ message: 'Dame otro hidratante.', conversationState: createStateEnvelope(state, SECRET) });

  assert.deepEqual(result.recommendations, []);
  assert.match(result.message, /otra opción distinta/i);
});

test('provider re-selection of an excluded Product is rejected by the migrated flow', async () => {
  const state = reduceConversationState(createEmptyConversationState(), { artifactEvidence: { recentRecommendations: [{ productId: 'moist-a', routineStep: 'MOISTURIZER' }] } });
  const harness = createHarness({ interpretation: interpretation({ relationToPrevious: 'ALTERNATIVE' }), candidatesByStep: { MOISTURIZER: [candidate('moist-b', 'MOISTURIZER')] }, selectedProductId: 'moist-a', rows: [row('moist-a', 'MOISTURIZER'), row('moist-b', 'MOISTURIZER')] });

  await assert.rejects(() => harness.service.advise({ message: 'Dame otro hidratante.', conversationState: createStateEnvelope(state, SECRET) }), (error) => error.code === 'INVALID_AI_RESPONSE');
});

test('structured references resolve from signed artifacts without trusting prose identity', async () => {
  const state = reduceConversationState(createEmptyConversationState(), { artifactEvidence: { recentRecommendations: [{ productId: 'moist-a', routineStep: 'MOISTURIZER' }] } });
  const searches = [];
  const harness = createHarness({ interpretation: interpretation({ relationToPrevious: 'ALTERNATIVE', referencePhrases: ['el hidratante que me recomendaste'] }), candidatesByStep: { MOISTURIZER: [candidate('moist-b', 'MOISTURIZER')] }, selectedProductId: 'moist-b', rows: [row('moist-a', 'MOISTURIZER'), row('moist-b', 'MOISTURIZER')] });
  const result = await harness.service.advise({ message: 'Uno distinto al hidratante que me recomendaste.', conversationState: createStateEnvelope(state, SECRET) });

  searches.push(...harness.searches);
  assert.deepEqual(searches[0].excludeProductIds, ['moist-a']);
  assert.deepEqual(result.recommendations.map((item) => item.product.id), ['moist-b']);
});

test('specific unresolved alternative reference still requires clarification', async () => {
  const state = reduceConversationState(createEmptyConversationState(), { artifactEvidence: { recentRecommendations: [{ productId: 'moist-a', routineStep: 'MOISTURIZER' }] } });
  const harness = createHarness({ interpretation: interpretation({ relationToPrevious: 'ALTERNATIVE', referencePhrases: ['Round Lab azul'] }), candidatesByStep: { __general: [candidate('moist-b', 'MOISTURIZER')] }, selectedProductId: 'moist-b', rows: [row('moist-a', 'MOISTURIZER'), row('moist-b', 'MOISTURIZER')] });
  const result = await harness.service.advise({ message: '¿Tienes otra opción para ese Round Lab azul?', conversationState: createStateEnvelope(state, SECRET) });

  assert.equal(harness.searches.length, 0);
  assert.equal(result.mode, 'FOLLOW_UP');
  assert.match(result.message, /identificar con suficiente seguridad/i);
});

test('ambiguous singular catalog reference still requires clarification', async () => {
  const state = reduceConversationState(createEmptyConversationState(), { artifactEvidence: { recentRecommendations: [{ productId: 'moist-a', routineStep: 'MOISTURIZER' }] } });
  const harness = createHarness({ interpretation: interpretation({ relationToPrevious: 'ALTERNATIVE', referencePhrases: ['crema hidratante'] }), referenceResult: { status: 'AMBIGUOUS', products: [row('moist-a', 'MOISTURIZER'), row('moist-b', 'MOISTURIZER')] }, candidatesByStep: { __general: [candidate('moist-b', 'MOISTURIZER')] }, selectedProductId: 'moist-b', rows: [row('moist-a', 'MOISTURIZER'), row('moist-b', 'MOISTURIZER')] });
  const result = await harness.service.advise({ message: '¿Tienes otra opción para la crema hidratante?', conversationState: createStateEnvelope(state, SECRET) });

  assert.equal(harness.searches.length, 0);
  assert.equal(result.mode, 'FOLLOW_UP');
});

test('generic alternatives without prior context do not fabricate exclusions', async () => {
  const harness = createHarness({ interpretation: interpretation({ requestedSteps: [], relationToPrevious: 'ALTERNATIVE', referencePhrases: [] }), candidatesByStep: { __general: [candidate('moist-a', 'MOISTURIZER')] }, selectedProductId: 'moist-a', rows: [row('moist-a', 'MOISTURIZER')] });
  const result = await harness.service.advise({ message: '¿Qué otras alternativas hay?' });

  assert.deepEqual(harness.searches[0].excludeProductIds, []);
  assert.deepEqual(result.recommendations.map((item) => item.product.id), ['moist-a']);
});

test('alternative exclusions remain step-scoped across a two-step request', async () => {
  const state = reduceConversationState(createEmptyConversationState(), {
    artifactEvidence: { recentRecommendations: [
      { productId: 'clean-a', routineStep: 'CLEANSER' },
      { productId: 'moist-a', routineStep: 'MOISTURIZER' },
    ] },
  });
  const harness = createHarness({
    interpretation: interpretation({ requestedSteps: ['CLEANSER', 'MOISTURIZER'], relationToPrevious: 'ALTERNATIVE' }),
    candidatesByStep: {
      CLEANSER: [candidate('clean-b', 'CLEANSER')],
      MOISTURIZER: [candidate('moist-b', 'MOISTURIZER')],
    },
    selectedProductId: 'clean-b',
    rows: [row('clean-a', 'CLEANSER'), row('moist-a', 'MOISTURIZER'), row('clean-b', 'CLEANSER'), row('moist-b', 'MOISTURIZER')],
  });
  await harness.service.advise({ message: 'Quiero otros dos pasos.', conversationState: createStateEnvelope(state, SECRET) });

  assert.deepEqual(harness.searches.map((search) => search.excludeProductIds), [['clean-a'], ['moist-a']]);
});

test('partial alternatives return only the valid step and preserve incomplete truth', async () => {
  const state = reduceConversationState(createEmptyConversationState(), {
    artifactEvidence: { recentRecommendations: [
      { productId: 'clean-a', routineStep: 'CLEANSER' },
      { productId: 'moist-a', routineStep: 'MOISTURIZER' },
    ] },
  });
  const harness = createHarness({
    interpretation: interpretation({ requestedSteps: ['CLEANSER', 'MOISTURIZER'], relationToPrevious: 'ALTERNATIVE' }),
    candidatesByStep: { CLEANSER: [candidate('clean-b', 'CLEANSER')], MOISTURIZER: [] },
    selectedProductId: 'clean-b',
    rows: [row('clean-a', 'CLEANSER'), row('moist-a', 'MOISTURIZER'), row('clean-b', 'CLEANSER')],
  });
  const result = await harness.service.advise({ message: 'Quiero otros dos pasos.', conversationState: createStateEnvelope(state, SECRET) });

  assert.deepEqual(result.recommendations.map((item) => item.product.id), ['clean-b']);
  assert.match(result.message, /todos los pasos/i);
});
