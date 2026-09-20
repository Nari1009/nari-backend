const assert = require('node:assert/strict');
const test = require('node:test');
const { createAIService } = require('../src/services/ai/aiService');
const { createEmptyConversationState, createStateEnvelope, verifyStateEnvelope } = require('../src/services/ai/conversationState');

const SECRET = 'follow-up-advisory-test-secret-at-least-32-chars';
const profile = { skinType: 'OILY', conditions: [], targets: [], budget: null, routinePreference: 'simple', knownProducts: [], unresolvedOwnedProducts: [], ownedRoutineSteps: [] };
const products = [
  { id: 'clean', name: 'Anua cleanser', routineStep: 'CLEANSER', catalogRole: 'CATALOG', status: 'active', stock: 5, price: 10, suitableSkinTypes: ['OILY'], suitableConditions: [], targets: [] },
  { id: 'moist', name: 'Skin1004 moisturizer', routineStep: 'MOISTURIZER', catalogRole: 'CATALOG', status: 'active', stock: 5, price: 10, suitableSkinTypes: ['OILY'], suitableConditions: [], targets: [] },
  { id: 'spf', name: 'Round Lab sunscreen', routineStep: 'SUNSCREEN', catalogRole: 'CATALOG', status: 'active', stock: 5, price: 10, suitableSkinTypes: ['OILY'], suitableConditions: [], targets: [] },
];

const interpretation = (intent, message, overrides = {}) => ({
  scope: 'IN_SCOPE', intent, mode: intent === 'BUILD_ROUTINE' ? 'RECOMMENDATION' : 'ANSWER', nextAction: intent === 'BUILD_ROUTINE' ? 'RECOMMEND' : 'ANSWER', requestedRoutineStep: null, requestedSteps: [], relationToPrevious: 'NONE', referencePhrases: [], productReferences: [], message, profile, ownershipDelta: { addVerifiedProductReferences: [], addUnresolvedItems: [], addOwnedRoutineSteps: [], removeReferences: [], removeUnresolvedLabels: [], removeOwnedRoutineSteps: [] }, ...overrides,
});

test('routine follow-up about product tolerance stays advisory and preserves signed routine context', async () => {
  let turn = 0;
  let receivedContext;
  const provider = {
    async interpretConversation(input) {
      turn += 1;
      receivedContext = input.conversationContext;
      return turn === 1
        ? interpretation('BUILD_ROUTINE', 'Rutina lista.')
        : interpretation('GENERAL_SKINCARE', 'Puedes observar cómo responde tu piel y cambiar un producto si lo necesitas.', { profile });
    },
    async reasonRoutine() {
      return {
        mode: 'RECOMMENDATION',
        message: 'Rutina sencilla para empezar.',
        profile,
        routine: {
          morning: [
            { step: 'CLEANSER', selectedProductId: 'clean', reason: 'Limpiador.' },
            { step: 'MOISTURIZER', selectedProductId: 'moist', reason: 'Hidratante.' },
            { step: 'SUNSCREEN', selectedProductId: 'spf', reason: 'Protector.' },
          ],
          evening: [
            { step: 'CLEANSER', selectedProductId: 'clean', reason: 'Limpiador.' },
            { step: 'MOISTURIZER', selectedProductId: 'moist', reason: 'Hidratante.' },
          ],
        },
      };
    },
  };
  const resolver = { async resolveReferences() { return { status: 'NOT_FOUND', products: [] }; } };
  const repository = { async findCurrentEligibleProducts(ids) { return products.filter((product) => ids.map(String).includes(String(product.id))); } };
  const routineService = { async build() { return { intent: 'BUILD_ROUTINE', mode: 'RECOMMENDATION', message: 'Rutina sencilla para empezar.', profile, routine: { morning: [{ step: 'CLEANSER', productId: 'clean' }, { step: 'MOISTURIZER', productId: 'moist' }, { step: 'SUNSCREEN', productId: 'spf' }], evening: [{ step: 'CLEANSER', productId: 'clean' }, { step: 'MOISTURIZER', productId: 'moist' }] }, recommendations: products.map((product) => ({ product: { ...product } })) }; } };
  const service = createAIService({ provider, finalProductRepository: repository, routineService, productResolver: resolver, stateTransport: true, stateSecret: SECRET, turnPlanRoutineFlow: true });

  const first = await service.advise({ message: 'Quiero una rutina sencilla.', conversationState: createStateEnvelope(createEmptyConversationState(), SECRET) });
  const firstState = verifyStateEnvelope(first.conversationState, SECRET);
  assert.deepEqual([...new Set(firstState.artifacts.recentRoutine.map((item) => item.productId))], ['clean', 'moist', 'spf']);

  const second = await service.advise({ message: '¿Y cómo sé si me caen bien esos productos o mal o si debo cambiarlos?', conversationState: first.conversationState });
  assert.equal(second.intent, 'GENERAL_SKINCARE');
  assert.notEqual(second.intent, 'COMPATIBILITY');
  assert.match(second.message, /observar|responde|cambiar/i);
  assert.deepEqual([...new Set(receivedContext.recentRoutine.map((item) => item.productId))], ['clean', 'moist', 'spf']);
  assert.deepEqual([...new Set(verifyStateEnvelope(second.conversationState, SECRET).artifacts.recentRoutine.map((item) => item.productId))], ['clean', 'moist', 'spf']);
});

test('compatibility can resolve a plural contextual reference from recent routine artifacts', async () => {
  const { createConversationReferenceResolver } = require('../src/services/ai/conversationReferenceResolver');
  const state = { ...createEmptyConversationState(), artifacts: { recentRecommendations: [], recentProductReferences: [], recentRoutine: products.map((product) => ({ productId: product.id, routineStep: product.routineStep, period: 'MORNING' })) } };
  const resolver = createConversationReferenceResolver({ productResolver: { async resolveReferences() { return { status: 'NOT_FOUND', products: [] }; } } });
  const result = await resolver.resolve({ referencePhrases: ['esos productos'], state });
  assert.equal(result.status, 'AMBIGUOUS');
  assert.deepEqual(result.resolvedProductIds, ['clean', 'moist', 'spf']);
});
