const assert = require('node:assert/strict');
const test = require('node:test');
const { createProductResolver } = require('../src/services/ai/productResolver');
const { createConversationReferenceResolver } = require('../src/services/ai/conversationReferenceResolver');
const { createAIService } = require('../src/services/ai/aiService');
const { createCatalogDiscoveryService } = require('../src/services/ai/catalogDiscoveryService');
const { createEmptyConversationState, createStateEnvelope, reduceConversationState, verifyStateEnvelope } = require('../src/services/ai/conversationState');

const SECRET = 'r11-conversational-refinement-test-secret-32';
const profile = { skinType: 'DRY', conditions: [], targets: [], budget: null, routinePreference: null, knownProducts: [], unresolvedOwnedProducts: [], ownedRoutineSteps: [] };
const ampoule = { id: 'skin1004-ampoule', brand: 'SKIN1004', name: 'Madagascar Centella Tone Brightening Capsule Ampoule', slug: 'skin1004-madagascar-centella-tone-brightening-capsule-ampoule', routineStep: 'SERUM', catalogRole: 'CATALOG', status: 'active', stock: 4, price: 90000, suitableSkinTypes: ['DRY'], suitableConditions: ['REDNESS'], targets: ['DULLNESS'] };
const sunscreen = { id: 'skin1004-sunscreen', brand: 'SKIN1004', name: 'Madagascar Centella Hyalu-Cica Water-Fit Sun Serum SPF50+', slug: 'skin1004-hyalu-cica-sun-serum', routineStep: 'SUNSCREEN', catalogRole: 'CATALOG', status: 'active', stock: 4, price: 80000, suitableSkinTypes: ['DRY'], suitableConditions: [], targets: [] };

test('resolver accepts brand, complete name, partial name and a bounded typo', async () => {
  const resolver = createProductResolver({ repository: { async findCatalogProducts() { return [ampoule, sunscreen]; } } });
  for (const reference of [
    'SKIN1004 Madagascar Centella Tone Brightening Capsule Ampoule (30ml)',
    'Centella Tone Brightening Capsule Ampoule',
    'skin1004 tone brightening capsule ampoule',
    'Skin1004 Tone Brightening Capsule Ampoulee',
  ]) {
    const result = await resolver.resolveReferences([reference]);
    assert.equal(result.status, 'RESOLVED', reference);
    assert.equal(result.products[0].id, ampoule.id);
  }
});
test('generic product descriptors remain ambiguous while contextual references use signed artifacts', async () => {
  const resolver = createProductResolver({ repository: { async findCatalogProducts() { return [ampoule, sunscreen]; } } });
  const generic = await resolver.resolveReferences(['serum']);
  assert.equal(generic.status, 'AMBIGUOUS');
  const references = createConversationReferenceResolver({ productResolver: resolver });
  const state = reduceConversationState(createEmptyConversationState(), { artifactEvidence: { recentRecommendations: [{ productId: ampoule.id, routineStep: 'SERUM' }, { productId: sunscreen.id, routineStep: 'SUNSCREEN' }] } });
  const contextual = await references.resolve({ referencePhrases: ['la ampolla que me recomendaste'], state });
  assert.equal(contextual.status, 'RESOLVED');
  assert.deepEqual(contextual.resolvedProductIds, [ampoule.id]);
  const ordinal = await references.resolve({ referencePhrases: ['el segundo producto'], state });
  assert.deepEqual(ordinal.resolvedProductIds, [sunscreen.id]);
});

test('signed state preserves bounded pending conversational intent', () => {
  const state = reduceConversationState(createEmptyConversationState(), {
    conversationDelta: {
      activeIntent: 'ALTERNATIVE_SEARCH',
      pendingAction: 'CONFIRM_ALTERNATIVE',
      pendingQuestion: '¿Quieres que busque otra opción?',
      focusProductIds: ['p-1'],
      pendingAlternative: { routineSteps: ['SERUM'], excludedProductIds: ['p-1'], targets: [], conditions: [], skinTypes: ['DRY'] },
    },
  });
  const restored = verifyStateEnvelope(createStateEnvelope(state, SECRET), SECRET);
  assert.equal(restored.conversation.pendingAction, 'CONFIRM_ALTERNATIVE');
  assert.deepEqual(restored.conversation.pendingAlternative.routineSteps, ['SERUM']);
});

test('routine-use wording is routed to Product Info instead of compatibility', async () => {
  let productInfoCalls = 0;
  const provider = {
    async interpretConversation() {
      return { scope: 'IN_SCOPE', intent: 'COMPATIBILITY', mode: 'ANSWER', nextAction: 'ANSWER', message: '¿Qué dos productos quieres usar juntos?', profile, productReferences: [], requestedSteps: [], relationToPrevious: 'NONE', referencePhrases: ['la ampolla que me recomendaste'], discoveryCriteria: { routineSteps: [], brand: null, skinTypes: null, conditions: null, targets: null, useProfile: false, browseScope: 'BROAD' }, ownershipDelta: {} };
    },
  };
  const resolver = { async resolveReferences() { return { status: 'RESOLVED', resolvedProductIds: [ampoule.id], products: [ampoule], matches: [], unresolvedPhrases: [] }; } };
  const service = createAIService({ provider, productResolver: resolver, finalProductRepository: { async findCurrentEligibleProducts() { return [ampoule]; } }, productInfoService: { async handle() { productInfoCalls += 1; return { intent: 'PRODUCT_INFO', mode: 'ANSWER', message: 'Explicación de uso.', profile, recommendations: [] }; } }, stateTransport: true, stateSecret: SECRET, turnPlanProductInfoFlow: true });
  const result = await service.advise({ message: 'La ampolla de SKIN1004, ¿la puedo usar sola o debo aplicarme otro producto?' });
  assert.equal(productInfoCalls, 1);
  assert.equal(result.intent, 'PRODUCT_INFO');
});

test('a short affirmative executes the signed pending alternative instead of restarting the conversation', async () => {
  const alternative = { ...ampoule, id: 'alternative-serum', name: 'Alternative Calming Serum', slug: 'alternative-calming-serum' };
  const provider = {
    async interpretConversation() { return { scope: 'IN_SCOPE', intent: 'GENERAL_SKINCARE', mode: 'ANSWER', nextAction: 'ANSWER', message: 'Entendido.', profile, productReferences: [], requestedSteps: [], relationToPrevious: 'NONE', referencePhrases: [], discoveryCriteria: { routineSteps: [], brand: null, skinTypes: null, conditions: null, targets: null, useProfile: false, browseScope: 'BROAD' }, ownershipDelta: {} }; },
    async reasonAmongCandidates() { return { mode: 'RECOMMENDATION', message: 'Encontré una alternativa.', selectedProductIds: [alternative.id], reasons: [{ productId: alternative.id, reason: 'Encaja con el paso de rutina solicitado.' }], profile }; },
  };
  const candidateService = { async search() { return { searched: true, candidates: [{ productId: alternative.id, score: 60, confidence: 'HIGH', matchedCriteria: ['ROUTINE_STEP'], metadata: alternative }] }; } };
  const repo = { async findCurrentEligibleProducts(ids) { return ids.map(String).includes(alternative.id) ? [alternative] : []; } };
  let state = reduceConversationState(createEmptyConversationState(), { artifactEvidence: { recentRecommendations: [{ productId: ampoule.id, routineStep: 'SERUM' }] }, conversationDelta: { activeIntent: 'ALTERNATIVE_SEARCH', pendingAction: 'CONFIRM_ALTERNATIVE', pendingQuestion: '¿Busco otra opción?', pendingAlternative: { routineSteps: ['SERUM'], excludedProductIds: [ampoule.id], targets: [], conditions: [], skinTypes: ['DRY'] } } });
  const service = createAIService({ provider, candidateService, finalProductRepository: repo, productResolver: { async resolveReferences() { return { status: 'NONE', products: [], resolvedProductIds: [], matches: [], unresolvedPhrases: [] }; } }, stateTransport: true, stateSecret: SECRET, turnPlanSelectionFlow: true });
  const result = await service.advise({ message: 'Sí', conversationState: createStateEnvelope(state, SECRET) });
  assert.equal(result.mode, 'RECOMMENDATION');
  assert.equal(result.recommendations[0].product.id, alternative.id);
  assert.equal(verifyStateEnvelope(result.conversationState, SECRET).conversation.pendingAction, null);
});

test('an unavailable brand creates a signed alternative intention for the next turn', async () => {
  const provider = {
    async interpretConversation() { return { scope: 'IN_SCOPE', intent: 'DISCOVERY', mode: 'ANSWER', nextAction: 'CATALOG_DISCOVERY', requestedRoutineStep: 'SERUM', message: 'No encontré esa marca.', profile, productReferences: [], requestedSteps: ['SERUM'], relationToPrevious: 'NONE', referencePhrases: [], discoveryCriteria: { routineSteps: ['SERUM'], brand: 'Celimax', skinTypes: null, conditions: null, targets: null, useProfile: true, browseScope: 'FILTERED' }, ownershipDelta: {} }; },
  };
  const service = createAIService({ provider, catalogDiscoveryService: createCatalogDiscoveryService({ repository: { async findPublicCatalogProducts() { return []; } } }), stateTransport: true, stateSecret: SECRET });
  const result = await service.advise({ message: '¿Tienen productos Celimax?' });
  const state = verifyStateEnvelope(result.conversationState, SECRET);
  assert.equal(state.conversation.pendingAction, 'CONFIRM_ALTERNATIVE');
  assert.deepEqual(state.conversation.pendingAlternative.routineSteps, ['SERUM']);
});
