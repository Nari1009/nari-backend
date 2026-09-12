const assert = require('node:assert/strict');
const test = require('node:test');
const { createAIService } = require('../src/services/ai/aiService');
const { createCompatibilityService } = require('../src/services/ai/compatibilityService');
const { createEmptyConversationState, createStateEnvelope, reduceConversationState, verifyStateEnvelope } = require('../src/services/ai/conversationState');

const SECRET = 'stage-seven-compatibility-test-secret-32chars';
const profile = { skinType: 'COMBINATION', conditions: [], targets: [], budget: null, routinePreference: null, knownProducts: [], unresolvedOwnedProducts: [], ownedRoutineSteps: [] };
const product = (id, overrides = {}) => ({ id, brand: 'Nari', name: `Product ${id}`, slug: `product-${id}`, price: 100, images: '[]', status: 'active', stock: 3, catalogRole: 'CATALOG', routineStep: 'SERUM', sizeLabel: '30 ml', suitableSkinTypes: ['COMBINATION'], suitableConditions: [], targets: [], ...overrides });

const interpretation = (referencePhrases = ['p-serum', 'p-moist'], message = '¿puedo usarlos juntos?') => ({ intent: 'COMPATIBILITY', mode: 'ANSWER', nextAction: 'ANSWER', scope: 'IN_SCOPE', requestedRoutineStep: null, message, profile, productReferences: referencePhrases, requestedSteps: [], relationToPrevious: 'NONE', referencePhrases });
const outputFor = (ids, overrides = {}) => ({ mode: 'ANSWER', message: 'Pueden organizarse en una rutina por sus pasos, pero la fórmula permanece sin confirmar.', profile, compatibility: { productIds: ids, period: null, orderProductIds: ids, structuralStatus: 'COMPATIBLE', formulaLevel: 'UNKNOWN', summary: 'La colocación estructural es la información confirmada.', ...overrides } });

const createHarness = ({ catalog, currentInterpretation = interpretation(), providerOutput = null } = {}) => {
  const byId = new Map(catalog.map((row) => [String(row.id), row]));
  const provider = {
    async interpretConversation() { return currentInterpretation; },
    async reasonCompatibility({ evidence }) { return providerOutput || outputFor(evidence.filter((item) => item.productId).map((item) => item.productId)); },
  };
  const resolver = { async resolveReferences(refs) { const products = refs.map((ref) => byId.get(String(ref))).filter(Boolean); return products.length === refs.length ? { status: 'RESOLVED', products } : { status: 'NOT_FOUND', products: [] }; } };
  const repo = { async findCurrentEligibleProducts(ids) { return catalog.filter((row) => ids.map(String).includes(String(row.id)) && row.status === 'active' && Number(row.stock) > 0); } };
  const service = createAIService({ stateTransport: true, stateSecret: SECRET, turnPlanCompatibilityFlow: true, provider, productResolver: resolver, compatibilityService: createCompatibilityService(), finalProductRepository: repo });
  return { service };
};

test('authoritative COMPATIBILITY derives structural placement for two known Products', async () => {
  const rows = [product('p-serum', { routineStep: 'SERUM' }), product('p-moist', { routineStep: 'MOISTURIZER' })];
  const result = await createHarness({ catalog: rows }).service.advise({ message: '¿puedo usar el sérum y el hidratante juntos?' });
  assert.equal(result.compatibility.structuralStatus, 'COMPATIBLE_WITH_PLACEMENT');
  assert.equal(result.compatibility.formulaCompatibility, 'UNKNOWN');
  assert.ok(result.compatibility.placement.evening.length === 2);
});

test('compatibility reuses a recent comparison pair from signed focus', async () => {
  const rows = [product('p-serum'), product('p-moist', { routineStep: 'MOISTURIZER' })];
  const firstState = reduceConversationState(createEmptyConversationState(), { artifactEvidence: { recentProductReferences: rows.map((row) => ({ productId: row.id, routineStep: row.routineStep })) } });
  const result = await createHarness({ catalog: rows, currentInterpretation: interpretation([], '¿puedo usar los dos juntos?') }).service.advise({ message: '¿puedo usar los dos juntos?', conversationState: createStateEnvelope(firstState, SECRET) });
  assert.equal(result.intent, 'COMPATIBILITY');
  assert.deepEqual(result.compatibility.productIds, ['p-serum', 'p-moist']);
});

test('formula compatibility remains UNKNOWN even when structural placement is known', async () => {
  const rows = [product('p-serum'), product('p-moist', { routineStep: 'MOISTURIZER' })];
  const result = await createHarness({ catalog: rows }).service.advise({ message: '¿son compatibles sus ingredientes?' });
  assert.equal(result.compatibility.formulaLevel, 'UNKNOWN');
  assert.equal(result.compatibility.formulaCompatibility, 'UNKNOWN');
});

test('unsupported formula or active claims are rejected by the compatibility guard', async () => {
  const rows = [product('p-serum'), product('p-moist', { routineStep: 'MOISTURIZER' })];
  const providerOutput = outputFor(['p-serum', 'p-moist'], { summary: 'Sus ingredientes son 100% compatibles.' });
  await assert.rejects(() => createHarness({ catalog: rows, providerOutput }).service.advise({ message: '¿puedo usarlos juntos?' }), (error) => error.code === 'INVALID_AI_RESPONSE');
});

test('external owned sunscreen participates only through its reported routine step', async () => {
  const cleanser = product('p-cleanser', { routineStep: 'CLEANSER' });
  const state = reduceConversationState(createEmptyConversationState(), { ownershipDelta: { addUnresolvedItems: [{ label: 'bloqueador Mixsoon', reportedRoutineStep: 'SUNSCREEN' }] }, artifactEvidence: { recentProductReferences: [{ productId: cleanser.id, routineStep: cleanser.routineStep }] } });
  const result = await createHarness({ catalog: [cleanser], currentInterpretation: interpretation(['el limpiador', 'el bloqueador'], '¿puedo usar ambos juntos?') }).service.advise({ message: '¿puedo usar ambos juntos?', conversationState: createStateEnvelope(state, SECRET) });
  assert.equal(result.compatibility.structuralStatus, 'COMPATIBLE_WITH_PLACEMENT');
  assert.equal(result.compatibility.products.some((item) => item.external), false);
  assert.equal(result.compatibility.products.some((item) => item.productId === null), true);
});

test('medication compatibility triggers the medical boundary without formula claims', async () => {
  const rows = [product('p-serum'), product('p-moist', { routineStep: 'MOISTURIZER' })];
  const result = await createHarness({ catalog: rows }).service.advise({ message: '¿puedo usarlo con tretinoína?' });
  assert.match(result.message, /profesional|tratamiento/i);
  assert.equal(result.compatibility.formulaCompatibility, 'UNKNOWN');
});

test('ambiguous references return a follow-up without guessing', async () => {
  const rows = [product('p-a', { name: 'Crema Nari' }), product('p-b', { name: 'Crema Nari' })];
  const result = await createHarness({ catalog: rows, currentInterpretation: interpretation(['crema nari', 'p-a']) }).service.advise({ message: '¿puedo usar esa crema con la otra?' });
  assert.equal(result.mode, 'FOLLOW_UP');
  assert.deepEqual(result.recommendations, []);
});

test('compatibility focus remains available for a placement follow-up', async () => {
  const rows = [product('p-serum'), product('p-moist', { routineStep: 'MOISTURIZER' })];
  const first = await createHarness({ catalog: rows }).service.advise({ message: '¿puedo usar el sérum y el hidratante juntos?' });
  const nextState = verifyStateEnvelope(first.conversationState, SECRET);
  assert.deepEqual(nextState.artifacts.recentProductReferences.map((item) => item.productId), ['p-serum', 'p-moist']);
});
