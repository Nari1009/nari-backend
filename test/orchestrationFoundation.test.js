const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createEmptyConversationState,
  createStateEnvelope,
  isNewerConversationState,
  reduceConversationState,
  verifyStateEnvelope,
} = require('../src/services/ai/conversationState');
const { createConversationReferenceResolver } = require('../src/services/ai/conversationReferenceResolver');
const { compileTurnPlan } = require('../src/services/ai/turnPlan');
const { createAIService } = require('../src/services/ai/aiService');

const SECRET = 'stage-one-test-secret-that-is-at-least-32-chars';
const interpretation = (overrides = {}) => ({
  intent: 'BUILD_ROUTINE',
  mode: 'FOLLOW_UP',
  nextAction: 'ASK_FOLLOW_UP',
  requestedRoutineStep: null,
  requestedSteps: [],
  productReferences: [],
  profile: {},
  ...overrides,
});

const providerProfile = (overrides = {}) => ({
  skinType: null,
  conditions: [],
  targets: [],
  budget: null,
  routinePreference: null,
  knownProducts: [],
  unresolvedOwnedProducts: [],
  ownedRoutineSteps: [],
  ...overrides,
});

test('reducer preserves omitted profile fields and applies explicit updates', () => {
  const initial = createEmptyConversationState();
  const beginner = reduceConversationState(initial, { profileDelta: { routinePreference: 'simple' } });
  const oily = reduceConversationState(beginner, { profileDelta: { skinType: 'OILY' } });

  assert.equal(oily.profile.routinePreference, 'simple');
  assert.equal(oily.profile.skinType, 'OILY');
  assert.equal(oily.profile.targets, null);

  const cleared = reduceConversationState(oily, { profileDelta: { skinType: null } });
  assert.equal(cleared.profile.skinType, null);
});

test('recommendation artifacts resolve contextual product references', async () => {
  const state = reduceConversationState(createEmptyConversationState(), {
    artifactEvidence: { recentRecommendations: [{ productId: 'moist-1', routineStep: 'MOISTURIZER' }] },
  });
  const resolver = createConversationReferenceResolver({ productResolver: { async resolveReferences() { return { status: 'NOT_FOUND', products: [] }; } } });
  const result = await resolver.resolve({ referencePhrases: ['el hidratante que me recomendaste'], state });

  assert.equal(result.status, 'RESOLVED');
  assert.deepEqual(result.resolvedProductIds, ['moist-1']);
});

test('alternative TurnPlan derives exclusions from validated recent artifacts', () => {
  const state = reduceConversationState(createEmptyConversationState(), {
    artifactEvidence: {
      recentRecommendations: [
        { productId: 'clean-1', routineStep: 'CLEANSER' },
        { productId: 'moist-1', routineStep: 'MOISTURIZER' },
      ],
    },
  });
  const plan = compileTurnPlan({
    interpretation: interpretation({ intent: 'PRODUCT_SELECTION', mode: 'RECOMMENDATION', nextAction: 'RECOMMEND', requestedSteps: ['MOISTURIZER'] }),
    state,
    message: 'Quiero otro hidratante.',
  });

  assert.equal(plan.relationToPrevious, 'ALTERNATIVE');
  assert.deepEqual(plan.requestedSteps, ['MOISTURIZER']);
  assert.deepEqual(plan.excludedProductIds, ['moist-1']);
});

test('correction TurnPlan preserves the distinction from a normal recommendation', () => {
  const state = reduceConversationState(createEmptyConversationState(), {
    artifactEvidence: { recentRecommendations: [{ productId: 'p-1', routineStep: 'MOISTURIZER' }] },
  });
  const plan = compileTurnPlan({
    interpretation: interpretation({ intent: 'PRODUCT_SELECTION', mode: 'RECOMMENDATION', nextAction: 'RECOMMEND' }),
    state,
    message: 'Son los mismos, te dije que otro.',
  });

  assert.equal(plan.relationToPrevious, 'CORRECTION');
  assert.deepEqual(plan.excludedProductIds, ['p-1']);
});

test('state envelope rejects client tampering', () => {
  const state = createEmptyConversationState();
  const envelope = createStateEnvelope(state, SECRET);
  const tampered = { ...envelope, state: { ...envelope.state, revision: 99 } };

  assert.throws(() => verifyStateEnvelope(tampered, SECRET), (error) => error.code === 'INVALID_CONVERSATION_STATE');
});

test('stale state cannot replace a newer state revision', () => {
  const state = createEmptyConversationState();
  const newer = reduceConversationState(state, { profileDelta: { skinType: 'OILY' } });

  assert.equal(isNewerConversationState(state, newer), true);
  assert.equal(isNewerConversationState(newer, state), false);
});

test('explicit catalog references are delegated to the validated resolver', async () => {
  let received;
  const resolver = createConversationReferenceResolver({ productResolver: { async resolveReferences(references) { received = references; return { status: 'RESOLVED', products: [{ id: 'p-7' }] }; } } });
  const result = await resolver.resolve({ referencePhrases: ['Anua foam'], state: createEmptyConversationState() });

  assert.deepEqual(received, ['Anua foam']);
  assert.deepEqual(result.resolvedProductIds, ['p-7']);
});

test('state transport creates a signed first-turn snapshot and retains prior profile fields', async () => {
  let turn = 0;
  const service = createAIService({
    stateTransport: true,
    stateSecret: SECRET,
    provider: {
      async interpretConversation() {
        turn += 1;
        return {
          intent: 'GENERAL_SKINCARE', mode: 'ANSWER', nextAction: 'ANSWER',
          message: turn === 1 ? '¿Cómo sientes tu piel?' : 'Perfecto.',
          profile: providerProfile(turn === 1 ? { routinePreference: 'simple' } : { skinType: 'OILY' }),
          productReferences: [],
        };
      },
    },
  });

  const first = await service.advise({ message: 'Quiero algo sencillo.' });
  assert.equal(first.conversationState.state.revision, 1);
  assert.equal(first.conversationState.state.profile.routinePreference, 'simple');
  assert.equal(typeof first.conversationState.signature, 'string');

  const second = await service.advise({ message: 'Más grasa.', conversationState: first.conversationState });
  assert.equal(second.conversationState.state.revision, 2);
  assert.equal(second.conversationState.state.profile.routinePreference, 'simple');
  assert.equal(second.conversationState.state.profile.skinType, 'OILY');
});

test('state transport returns verified recommendation artifacts only', async () => {
  const row = { id: 'p-clean', name: 'Limpiador', slug: 'limpiador', price: 10, images: '[]', catalogRole: 'CATALOG', status: 'active', stock: 2, routineStep: 'CLEANSER' };
  const service = createAIService({
    stateTransport: true,
    stateSecret: SECRET,
    provider: {
        async interpretConversation() { return { intent: 'PRODUCT_SELECTION', mode: 'RECOMMENDATION', nextAction: 'RECOMMEND', message: 'Encontré una opción.', profile: providerProfile({ skinType: 'OILY' }), productReferences: [] }; },
      async reasonAmongCandidates() { return { mode: 'RECOMMENDATION', message: 'Esta opción encaja.', selectedProductIds: ['p-clean'], reasons: [{ productId: 'p-clean', reason: 'Encaja con tu solicitud.' }], profile: providerProfile({ skinType: 'OILY' }) }; },
    },
    candidateService: { async search() { return { searched: true, candidates: [{ productId: 'p-clean', score: 60, metadata: row }] }; } },
    finalProductRepository: { async findCurrentEligibleProducts(ids) { return ids.includes('p-clean') ? [row] : []; } },
    productResolver: { async resolveReferences() { return { status: 'NOT_FOUND', products: [] }; } },
    turnPlanSelectionFlow: true,
  });

  const result = await service.advise({ message: 'Recomiéndame un limpiador.' });
  assert.deepEqual(result.conversationState.state.artifacts.recentRecommendations, [{ productId: 'p-clean', routineStep: 'CLEANSER' }]);
  assert.equal('price' in result.conversationState.state.artifacts.recentRecommendations[0], false);
});

test('state transport drops artifacts whose Products are no longer eligible', async () => {
  const service = createAIService({
    stateTransport: true,
    stateSecret: SECRET,
    provider: { async interpretConversation() { return { intent: 'GENERAL_SKINCARE', mode: 'ANSWER', nextAction: 'ANSWER', message: '¿Qué más necesitas?', profile: providerProfile() }; } },
    finalProductRepository: { async findCurrentEligibleProducts() { return []; } },
  });
  const previous = createStateEnvelope(reduceConversationState(createEmptyConversationState(), { artifactEvidence: { recentRecommendations: [{ productId: 'stale', routineStep: 'MOISTURIZER' }] } }), SECRET);
  const result = await service.advise({ message: '¿Y el otro?', conversationState: previous });

  assert.deepEqual(result.conversationState.state.artifacts.recentRecommendations, []);
});

test('state transport rejects tampered state before provider interpretation', async () => {
  let called = false;
  const service = createAIService({
    stateTransport: true,
    stateSecret: SECRET,
    provider: { async interpretConversation() { called = true; return { intent: 'UNKNOWN', mode: 'ANSWER', nextAction: 'ANSWER', message: 'ok', profile: providerProfile() }; } },
  });
  const envelope = createStateEnvelope(createEmptyConversationState(), SECRET);
  const tampered = { ...envelope, state: { ...envelope.state, revision: 7 } };

  await assert.rejects(() => service.advise({ message: 'Hola', conversationState: tampered }), (error) => error.code === 'INVALID_CONVERSATION_STATE');
  assert.equal(called, false);
});

test('live state transport never silently falls back for an unconfigured migrated intent', async () => {
  const service = createAIService({
    stateTransport: true,
    stateSecret: SECRET,
    provider: {
      async interpretConversation() {
        return { intent: 'PRODUCT_SELECTION', mode: 'RECOMMENDATION', nextAction: 'RECOMMEND', message: 'Recomendaré una opción.', profile: providerProfile({ skinType: 'OILY' }), productReferences: [] };
      },
    },
  });

  await assert.rejects(() => service.advise({ message: 'Recomiéndame un hidratante.' }), (error) => error.code === 'TURNPLAN_NOT_CONFIGURED');
});
