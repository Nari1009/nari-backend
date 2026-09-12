const assert = require('node:assert/strict');
const test = require('node:test');
const { createAIService } = require('../src/services/ai/aiService');
const { createPoint10Service } = require('../src/services/ai/point10Service');
const { createRoutineService } = require('../src/services/ai/routines/routineService');
const { createStateEnvelope, createEmptyConversationState, verifyStateEnvelope } = require('../src/services/ai/conversationState');

const SECRET = 'stage-eight-budget-test-secret-32chars';
const profile = (overrides = {}) => ({ skinType: 'OILY', conditions: [], targets: [], budget: '300000', routinePreference: 'simple', knownProducts: [], unresolvedOwnedProducts: [], ownedRoutineSteps: [], ...overrides });
const product = (id, step, price, overrides = {}) => ({ id, name: `Product ${id}`, slug: `product-${id}`, brand: 'Nari', price, stock: 4, status: 'active', catalogRole: 'CATALOG', routineStep: step, suitableSkinTypes: ['OILY'], suitableConditions: [], targets: [], ...overrides });
const candidate = (row, score = 60) => ({ productId: row.id, price: row.price, score, metadata: row });

const createHarness = ({ rows, candidatesByStep, interpretationProfile = profile(), ownershipDelta = {}, reason = 'Rutina ajustada al presupuesto y a los pasos esenciales.' } = {}) => {
  const byId = new Map(rows.map((row) => [String(row.id), row]));
  const resolver = {
    async resolveReferences(references) {
      const products = references.map((reference) => byId.get(String(reference))).filter(Boolean);
      return products.length === references.length ? { status: 'RESOLVED', products } : { status: 'NOT_FOUND', products: [] };
    },
  };
  const candidateService = { async search({ requestedRoutineStep }) { return { searched: true, candidates: candidatesByStep[requestedRoutineStep] || [] }; } };
  const finalProductRepository = { async findCurrentEligibleProducts(ids) { return ids.map((id) => byId.get(String(id))).filter((row) => row && row.status === 'active' && Number(row.stock) > 0); } };
  const provider = {
    async interpretConversation() {
      return { scope: 'IN_SCOPE', intent: 'BUDGET_ROUTINE', mode: 'RECOMMENDATION', nextAction: 'RECOMMEND', requestedRoutineStep: null, message: 'Prepararé una rutina sencilla.', profile: interpretationProfile, productReferences: [], requestedSteps: [], relationToPrevious: 'NONE', referencePhrases: [], ownershipDelta: { addVerifiedProductReferences: [], addUnresolvedItems: [], addOwnedRoutineSteps: [], removeReferences: [], removeUnresolvedLabels: [], removeOwnedRoutineSteps: [], ...ownershipDelta } };
    },
    async reasonRoutine() { return { mode: 'RECOMMENDATION', message: reason, profile: interpretationProfile, routine: { morning: [], evening: [] } }; },
  };
  const point10Service = createPoint10Service({ resolver, candidateService, finalProductRepository });
  const service = createAIService({ provider, point10Service, candidateService, finalProductRepository, routineService: createRoutineService({ candidateService, finalProductRepository }), productResolver: resolver, stateTransport: true, stateSecret: SECRET, turnPlanBudgetFlow: true });
  return { service, resolver };
};

test('authoritative budget flow returns a complete plan with unique integer-COP total', async () => {
  const rows = [product('c', 'CLEANSER', 70000), product('m', 'MOISTURIZER', 90000), product('s', 'SUNSCREEN', 85000)];
  const result = await createHarness({ rows, candidatesByStep: { CLEANSER: [candidate(rows[0])], MOISTURIZER: [candidate(rows[1])], SUNSCREEN: [candidate(rows[2])] } }).service.advise({ message: 'Hazme una rutina por 300 mil' });
  assert.equal(result.budget.outcome, 'COMPLETE_WITHIN_BUDGET');
  assert.equal(result.budget.total, 245000);
  assert.equal(result.budget.currency, 'COP');
  assert.ok(result.budget.total <= result.budget.limit);
  assert.equal(new Set(result.recommendations.map((item) => item.product.id)).size, 3);
});

test('budget parser supports Colombian thousands units through authoritative flow', async () => {
  const rows = [product('c', 'CLEANSER', 70000), product('m', 'MOISTURIZER', 90000), product('s', 'SUNSCREEN', 85000)];
  const result = await createHarness({ rows, interpretationProfile: profile({ budget: '250 mil' }), candidatesByStep: { CLEANSER: [candidate(rows[0])], MOISTURIZER: [candidate(rows[1])], SUNSCREEN: [candidate(rows[2])] } }).service.advise({ message: 'tengo 250 mil' });
  assert.equal(result.budget.limit, 250000);
  assert.equal(result.budget.outcome, 'COMPLETE_WITHIN_BUDGET');
});

test('owned external sunscreen covers the step and is not purchased', async () => {
  const rows = [product('c', 'CLEANSER', 70000), product('m', 'MOISTURIZER', 90000)];
  const result = await createHarness({ rows, ownershipDelta: { addOwnedRoutineSteps: ['SUNSCREEN'] }, candidatesByStep: { CLEANSER: [candidate(rows[0])], MOISTURIZER: [candidate(rows[1])], SUNSCREEN: [] } }).service.advise({ message: 'Ya tengo el protector; arma la rutina por 200 mil' });
  assert.equal(result.budget.total, 160000);
  assert.equal(result.recommendations.some((item) => item.product.id === 's'), false);
  assert.equal(result.budget.outcome, 'COMPLETE_WITHIN_BUDGET');
});

test('insufficient budget returns a truthful partial plan without exceeding the limit', async () => {
  const rows = [product('c', 'CLEANSER', 70000), product('m', 'MOISTURIZER', 90000), product('s', 'SUNSCREEN', 85000)];
  const result = await createHarness({ rows, interpretationProfile: profile({ budget: '100000' }), candidatesByStep: { CLEANSER: [candidate(rows[0])], MOISTURIZER: [candidate(rows[1])], SUNSCREEN: [candidate(rows[2])] } }).service.advise({ message: 'Solo puedo gastar 100 mil' });
  assert.equal(result.budget.outcome, 'PARTIAL_WITHIN_BUDGET');
  assert.ok(result.budget.total <= 100000);
  assert.ok(result.budget.uncoveredSteps.length > 0);
});

test('optional treatment candidates never displace required core coverage', async () => {
  const rows = [product('c', 'CLEANSER', 70000), product('m', 'MOISTURIZER', 90000), product('s', 'SUNSCREEN', 85000), product('serum', 'SERUM', 10000)];
  const result = await createHarness({ rows, interpretationProfile: profile({ budget: '245000', targets: ['ACNE'] }), candidatesByStep: { CLEANSER: [candidate(rows[0])], MOISTURIZER: [candidate(rows[1])], SUNSCREEN: [candidate(rows[2])], SERUM: [candidate(rows[3], 100) ] } }).service.advise({ message: 'Quiero una rutina sencilla por 245 mil' });
  assert.equal(result.budget.outcome, 'COMPLETE_WITHIN_BUDGET');
  assert.equal(result.recommendations.some((item) => item.product.id === 'serum'), false);
});

test('returned signed state retains the accepted budget for a later recomputation', async () => {
  const rows = [product('c', 'CLEANSER', 70000), product('m', 'MOISTURIZER', 90000), product('s', 'SUNSCREEN', 85000)];
  const harness = createHarness({ rows, interpretationProfile: profile({ budget: '245000' }), candidatesByStep: { CLEANSER: [candidate(rows[0])], MOISTURIZER: [candidate(rows[1])], SUNSCREEN: [candidate(rows[2])] } });
  const first = await harness.service.advise({ message: 'Rutina por 245 mil' });
  const state = verifyStateEnvelope(first.conversationState, SECRET);
  assert.equal(state.profile.budget, '245000');
  const second = await harness.service.advise({ message: 'Recalcula la rutina', conversationState: createStateEnvelope(state, SECRET) });
  assert.equal(second.budget.limit, 245000);
});

test('provider cannot change the deterministic budget result', async () => {
  const rows = [product('c', 'CLEANSER', 70000), product('m', 'MOISTURIZER', 90000), product('s', 'SUNSCREEN', 85000)];
  const result = await createHarness({ rows, interpretationProfile: profile({ budget: '245000' }), candidatesByStep: { CLEANSER: [candidate(rows[0])], MOISTURIZER: [candidate(rows[1])], SUNSCREEN: [candidate(rows[2])] } }).service.advise({ message: 'Rutina por 245 mil' });
  assert.equal(result.budget.total, 245000);
  assert.equal(result.budget.currency, 'COP');
  assert.equal(result.budget.withinBudget, true);
});

test('new conversation starts without prior budget state', async () => {
  const rows = [product('c', 'CLEANSER', 70000), product('m', 'MOISTURIZER', 90000), product('s', 'SUNSCREEN', 85000)];
  const result = await createHarness({ rows, interpretationProfile: profile({ budget: null }), candidatesByStep: { CLEANSER: [candidate(rows[0])], MOISTURIZER: [candidate(rows[1])], SUNSCREEN: [candidate(rows[2])] } }).service.advise({ message: 'Quiero una rutina' });
  assert.equal(result.mode, 'FOLLOW_UP');
  assert.equal(result.budget.outcome, 'NEED_MORE_PROFILE_INFO');
});
