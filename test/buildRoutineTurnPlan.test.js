const assert = require('node:assert/strict');
const test = require('node:test');
const { createAIService } = require('../src/services/ai/aiService');
const { createRoutineService } = require('../src/services/ai/routines/routineService');
const { createEmptyConversationState, createStateEnvelope, reduceConversationState } = require('../src/services/ai/conversationState');

const SECRET = 'stage-four-test-secret-that-is-at-least-32-chars';
const profile = (overrides = {}) => ({ skinType: 'OILY', conditions: [], targets: [], budget: null, routinePreference: 'simple', knownProducts: [], unresolvedOwnedProducts: [], ownedRoutineSteps: [], ...overrides });
const row = (id, routineStep) => ({ id, name: id, slug: id, price: 100, images: '[]', routineStep, catalogRole: 'CATALOG', status: 'active', stock: 5, suitableSkinTypes: ['OILY'], suitableConditions: [], targets: [] });
const candidate = (id, routineStep) => ({ productId: id, score: 60, confidence: 'HIGH', matchedCriteria: ['ROUTINE_STEP', 'SKIN_TYPE'], metadata: row(id, routineStep) });
const interpretation = (overrides = {}) => ({
  intent: 'BUILD_ROUTINE', mode: 'RECOMMENDATION', nextAction: 'RECOMMEND', message: 'Puedo armar una rutina sencilla.', profile: profile(), productReferences: [], requestedSteps: [], relationToPrevious: 'NONE', referencePhrases: [], ...overrides,
});

const createHarness = ({ interpretationValue = interpretation(), ownedState = createEmptyConversationState(), routineOutput, candidatesByStep, rows }) => {
  let routineCalls = 0;
  const provider = {
    async interpretConversation() { return interpretationValue; },
    async reasonRoutine(input) { routineCalls += 1; return routineOutput(input); },
  };
  const candidateService = {
    async search({ requestedRoutineStep }) { return { searched: true, candidates: candidatesByStep[requestedRoutineStep] || [] }; },
  };
  const finalProductRepository = {
    async findCurrentEligibleProducts(ids) { return rows.filter((item) => ids.map(String).includes(String(item.id))); },
  };
  const routineService = createRoutineService({ candidateService, finalProductRepository });
  const service = createAIService({ provider, candidateService, finalProductRepository, routineService, productResolver: { async resolveReferences() { return { status: 'NOT_FOUND', products: [] }; } }, stateTransport: true, stateSecret: SECRET, turnPlanRoutineFlow: true });
  return { service, getRoutineCalls: () => routineCalls };
};

const basicRoutineOutput = () => ({
  mode: 'RECOMMENDATION',
  message: 'Esta rutina cubre los pasos básicos para empezar.',
  profile: profile(),
  routine: {
    morning: [
      { step: 'CLEANSER', selectedProductId: 'clean', reason: 'Limpieza.' },
      { step: 'MOISTURIZER', selectedProductId: 'moist', reason: 'Hidratación.' },
    ],
    evening: [
      { step: 'CLEANSER', selectedProductId: 'clean', reason: 'Limpieza nocturna.' },
      { step: 'MOISTURIZER', selectedProductId: 'moist', reason: 'Hidratación nocturna.' },
    ],
  },
});

test('authoritative BUILD_ROUTINE waits for state/profile readiness without invoking the routine tool', async () => {
  const harness = createHarness({
    interpretationValue: interpretation({ mode: 'FOLLOW_UP', nextAction: 'ASK_FOLLOW_UP', message: '¿Cómo sientes tu piel?', profile: profile({ skinType: null }) }),
    routineOutput: basicRoutineOutput,
    candidatesByStep: {},
    rows: [],
  });
  const result = await harness.service.advise({ message: 'No sé nada de skincare.' });

  assert.equal(result.mode, 'FOLLOW_UP');
  assert.equal(result.routine, null);
  assert.equal(harness.getRoutineCalls(), 0);
});

test('authoritative BUILD_ROUTINE uses validated owned sunscreen coverage and returns routine artifacts by period', async () => {
  const state = reduceConversationState(createEmptyConversationState(), {
    profileDelta: { skinType: 'OILY', routinePreference: 'simple' },
    ownershipDelta: { addOwnedRoutineSteps: ['SUNSCREEN'], addUnresolvedItems: [{ label: 'bloqueador externo', reportedRoutineStep: 'SUNSCREEN' }] },
  });
  const harness = createHarness({
    ownedState: state,
    routineOutput: basicRoutineOutput,
    candidatesByStep: {
      CLEANSER: [candidate('clean', 'CLEANSER')],
      MOISTURIZER: [candidate('moist', 'MOISTURIZER')],
    },
    rows: [row('clean', 'CLEANSER'), row('moist', 'MOISTURIZER')],
  });
  const result = await harness.service.advise({ message: 'Quiero empezar una rutina.', conversationState: createStateEnvelope(state, SECRET) });

  assert.equal(result.mode, 'RECOMMENDATION');
  assert.equal(harness.getRoutineCalls(), 1);
  assert.deepEqual(result.recommendations.map((item) => item.product.id).sort(), ['clean', 'moist']);
  assert.equal(result.recommendations.some((item) => item.product.routineStep === 'SUNSCREEN'), false);
  assert.deepEqual(result.conversationState.state.ownership.ownedRoutineSteps, ['SUNSCREEN']);
  assert.equal(result.conversationState.state.artifacts.recentRoutine.some((item) => item.period === 'MORNING'), true);
  assert.equal(result.conversationState.state.artifacts.recentRoutine.some((item) => item.period === 'EVENING'), true);
});

test('ownership reducer supports removing a previously reported owned step', () => {
  const initial = reduceConversationState(createEmptyConversationState(), { ownershipDelta: { addOwnedRoutineSteps: ['SUNSCREEN', 'CLEANSER'] } });
  const corrected = reduceConversationState(initial, { ownershipDelta: { removeOwnedRoutineSteps: ['CLEANSER'] } });

  assert.deepEqual(corrected.ownership.ownedRoutineSteps, ['SUNSCREEN']);
});

test('verified owned Product references contribute their trusted routine step', () => {
  const state = reduceConversationState(createEmptyConversationState(), {
    ownershipDelta: { addVerifiedProducts: [{ productId: 'owned-clean', routineStep: 'CLEANSER' }] },
  });

  assert.deepEqual(state.ownership.verifiedProducts, [{ productId: 'owned-clean', routineStep: 'CLEANSER' }]);
  assert.deepEqual(state.ownership.ownedRoutineSteps, ['CLEANSER']);
});

test('authoritative routine flow applies an ownership correction before planning missing purchases', async () => {
  const state = reduceConversationState(createEmptyConversationState(), {
    profileDelta: { skinType: 'OILY' },
    ownershipDelta: { addOwnedRoutineSteps: ['CLEANSER'] },
  });
  const harness = createHarness({
    interpretationValue: interpretation({ ownershipDelta: { removeOwnedRoutineSteps: ['CLEANSER'] } }),
    routineOutput: () => ({
      ...basicRoutineOutput(),
      routine: {
        morning: [
          { step: 'CLEANSER', selectedProductId: 'clean', reason: 'Limpieza.' },
          { step: 'MOISTURIZER', selectedProductId: 'moist', reason: 'Hidratación.' },
          { step: 'SUNSCREEN', selectedProductId: 'screen', reason: 'Protección.' },
        ],
        evening: [
          { step: 'CLEANSER', selectedProductId: 'clean', reason: 'Limpieza nocturna.' },
          { step: 'MOISTURIZER', selectedProductId: 'moist', reason: 'Hidratación nocturna.' },
        ],
      },
    }),
    candidatesByStep: {
      CLEANSER: [candidate('clean', 'CLEANSER')],
      MOISTURIZER: [candidate('moist', 'MOISTURIZER')],
      SUNSCREEN: [candidate('screen', 'SUNSCREEN')],
    },
    rows: [row('clean', 'CLEANSER'), row('moist', 'MOISTURIZER'), row('screen', 'SUNSCREEN')],
  });
  const result = await harness.service.advise({ message: 'Me equivoqué, ya no tengo limpiador.', conversationState: createStateEnvelope(state, SECRET) });

  assert.equal(result.mode, 'RECOMMENDATION');
  assert.equal(result.recommendations.some((item) => item.product.id === 'clean'), true);
  assert.deepEqual(result.conversationState.state.ownership.ownedRoutineSteps, []);
});

test('provider routine selection outside a planned candidate group is rejected in the migrated path', async () => {
  const harness = createHarness({
    routineOutput: () => ({ ...basicRoutineOutput(), routine: { morning: [{ step: 'MOISTURIZER', selectedProductId: 'clean', reason: 'Incorrecto.' }], evening: [] } }),
    candidatesByStep: { CLEANSER: [candidate('clean', 'CLEANSER')], MOISTURIZER: [candidate('moist', 'MOISTURIZER')] },
    rows: [row('clean', 'CLEANSER'), row('moist', 'MOISTURIZER')],
  });

  await assert.rejects(() => harness.service.advise({ message: 'Quiero una rutina.' }), /INVALID_AI_RESPONSE|Product|rutina/i);
});
