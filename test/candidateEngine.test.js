const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createAIService } = require('../src/services/ai/aiService');
const { createCandidateService, shouldSearchCandidates } = require('../src/services/ai/candidates/candidateService');
const { CANDIDATE_LIMIT, scoreCandidate } = require('../src/services/ai/candidates/candidateScoring');
const { CANDIDATE_PRODUCT_SELECT } = require('../src/services/ai/candidates/candidateRepository');

const profile = (overrides = {}) => ({
  skinType: null,
  conditions: null,
  targets: null,
  budget: null,
  routinePreference: null,
  knownProducts: [],
  ...overrides,
});

const product = (overrides = {}) => ({
  id: 'purchase-a',
  name: 'Producto real',
  status: 'active',
  stock: 4,
  catalogRole: 'CATALOG',
  routineStep: 'MOISTURIZER',
  sizeLabel: '50 ml',
  suitableSkinTypes: JSON.stringify(['DRY']),
  suitableConditions: JSON.stringify(['SENSITIVE']),
  targets: JSON.stringify(['HYDRATION', 'BARRIER_SUPPORT']),
  supplier: 'private supplier',
  cost: 10,
  ...overrides,
});

const search = (products, input = {}) => createCandidateService({
  repository: { findEligibleProducts: async () => products },
}).search({ intent: 'PRODUCT_SELECTION', profile: profile({ targets: ['HYDRATION'] }), ...input });

test('only CATALOG, active, positive-stock Products are eligible', async () => {
  const result = await search([
    product({ id: 'catalog' }),
    product({ id: 'fixture', catalogRole: 'DEV_FIXTURE' }),
    product({ id: 'unknown', catalogRole: null }),
    product({ id: 'inactive', status: 'inactive' }),
    product({ id: 'empty', stock: 0 }),
  ]);
  assert.deepEqual(result.candidates.map((item) => item.productId), ['catalog']);
});

test('candidate repository aliases PostgreSQL camelCase fields for the scoring contract', () => {
  for (const field of ['catalogRole', 'routineStep', 'sizeLabel', 'suitableSkinTypes', 'suitableConditions', 'targets']) {
    assert.match(CANDIDATE_PRODUCT_SELECT, new RegExp(`${field} AS "${field}"`));
  }
});

test('routineStep match ranks and conflict excludes', () => {
  const matched = scoreCandidate({ product: product(), requestedRoutineStep: 'MOISTURIZER', profile: profile({ targets: ['HYDRATION', 'BARRIER_SUPPORT'] }) });
  const unknown = scoreCandidate({ product: product({ id: 'unknown-step', routineStep: null }), requestedRoutineStep: 'MOISTURIZER', profile: profile({ targets: ['HYDRATION', 'BARRIER_SUPPORT'] }) });
  const conflict = scoreCandidate({ product: product({ routineStep: 'CLEANSER' }), requestedRoutineStep: 'MOISTURIZER', profile: profile({ targets: ['HYDRATION', 'BARRIER_SUPPORT'] }) });
  assert.ok(matched.score > unknown.score);
  assert.deepEqual(unknown.unknownCriteria, ['ROUTINE_STEP']);
  assert.equal(conflict, null);
});

test('skin type match, NULL uncertainty, [] neutrality and known mismatch are distinct', () => {
  const match = scoreCandidate({ product: product(), requestedRoutineStep: 'MOISTURIZER', profile: profile({ skinType: 'DRY' }) });
  const unknown = scoreCandidate({ product: product({ id: 'unknown-skin', suitableSkinTypes: null }), requestedRoutineStep: 'MOISTURIZER', profile: profile({ skinType: 'DRY' }) });
  const neutral = scoreCandidate({ product: product({ id: 'empty-skin', suitableSkinTypes: '[]' }), requestedRoutineStep: 'MOISTURIZER', profile: profile({ skinType: 'DRY' }) });
  const conflict = scoreCandidate({ product: product({ id: 'oily-only', suitableSkinTypes: JSON.stringify(['OILY']) }), requestedRoutineStep: 'MOISTURIZER', profile: profile({ skinType: 'DRY' }) });
  assert.ok(match.score > unknown.score);
  assert.deepEqual(unknown.unknownCriteria, ['SKIN_TYPE']);
  assert.deepEqual(neutral.neutralCriteria, ['SKIN_TYPE']);
  assert.equal(conflict, null);
});

test('condition match, NULL uncertainty and [] neutrality are distinct', () => {
  const match = scoreCandidate({ product: product(), requestedRoutineStep: 'MOISTURIZER', profile: profile({ conditions: ['SENSITIVE'] }) });
  const unknown = scoreCandidate({ product: product({ id: 'unknown-condition', suitableConditions: null }), requestedRoutineStep: 'MOISTURIZER', profile: profile({ conditions: ['SENSITIVE'] }) });
  const neutral = scoreCandidate({ product: product({ id: 'empty-condition', suitableConditions: '[]' }), requestedRoutineStep: 'MOISTURIZER', profile: profile({ conditions: ['SENSITIVE'] }) });
  assert.ok(match.score > unknown.score);
  assert.deepEqual(unknown.unknownCriteria, ['CONDITION']);
  assert.deepEqual(neutral.neutralCriteria, ['CONDITION']);
});

test('target overlap rewards requested overlap, not unrelated target quantity', () => {
  const both = scoreCandidate({ product: product({ id: 'both' }), requestedRoutineStep: 'MOISTURIZER', profile: profile({ targets: ['HYDRATION', 'BARRIER_SUPPORT'] }) });
  const one = scoreCandidate({ product: product({ id: 'one', targets: JSON.stringify(['HYDRATION']) }), requestedRoutineStep: 'MOISTURIZER', profile: profile({ targets: ['HYDRATION', 'BARRIER_SUPPORT'] }) });
  const unrelated = scoreCandidate({ product: product({ id: 'unrelated', targets: JSON.stringify(['DULLNESS', 'TEXTURE', 'PORES']) }), requestedRoutineStep: 'MOISTURIZER', profile: profile({ targets: ['HYDRATION', 'BARRIER_SUPPORT'] }) });
  assert.ok(both.score > one.score);
  assert.ok(one.score > unrelated.score);
});

test('target NULL is unknown and [] is reviewed without a target bonus', () => {
  const unknown = scoreCandidate({ product: product({ targets: null }), requestedRoutineStep: 'MOISTURIZER', profile: profile({ targets: ['HYDRATION'] }) });
  const neutral = scoreCandidate({ product: product({ targets: '[]' }), requestedRoutineStep: 'MOISTURIZER', profile: profile({ targets: ['HYDRATION'] }) });
  assert.deepEqual(unknown.unknownCriteria, ['TARGET']);
  assert.deepEqual(neutral.neutralCriteria, ['TARGET']);
});

test('partial Product remains a candidate when other evidence is strong', async () => {
  const result = await search([product({ id: 'partial', suitableSkinTypes: null })], {
    requestedRoutineStep: 'MOISTURIZER',
    profile: profile({ skinType: 'DRY', targets: ['HYDRATION', 'BARRIER_SUPPORT'] }),
  });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].confidence, 'MEDIUM');
  assert.deepEqual(result.candidates[0].unknownCriteria, ['SKIN_TYPE']);
});

test('maximum is five, fewer candidates are allowed, and zero is allowed', async () => {
  const products = Array.from({ length: 8 }, (_, index) => product({ id: `p-${index}` }));
  const five = await search(products);
  assert.equal(five.candidates.length, CANDIDATE_LIMIT);
  const two = await search(products.slice(0, 2));
  assert.equal(two.candidates.length, 2);
  const none = await search([product({ routineStep: 'CLEANSER' })], { requestedRoutineStep: 'MOISTURIZER' });
  assert.equal(none.candidates.length, 0);
});

test('ordering is deterministic with stable Product ID tie-breaker', async () => {
  const result = await search([product({ id: 'b' }), product({ id: 'a' })]);
  assert.deepEqual(result.candidates.map((item) => item.productId), ['a', 'b']);
});

test('candidate projection excludes private commercial fields and catalogRole', async () => {
  const result = await search([product({ id: 'safe' })]);
  const candidate = result.candidates[0];
  assert.deepEqual(Object.keys(candidate.metadata).sort(), ['id', 'name', 'routineStep', 'sizeLabel', 'suitableConditions', 'suitableSkinTypes', 'targets'].sort());
  assert.equal('supplier' in candidate.metadata, false);
  assert.equal('cost' in candidate.metadata, false);
  assert.equal('catalogRole' in candidate.metadata, false);
});

test('unsupported intents do not force search; Product selection does', async () => {
  assert.equal(shouldSearchCandidates({ intent: 'GENERAL_SKINCARE', profile: profile({ targets: ['HYDRATION'] }), requestedRoutineStep: null }), false);
  assert.equal(shouldSearchCandidates({ intent: 'DISCOVERY', profile: profile({ targets: ['HYDRATION'] }), requestedRoutineStep: null }), false);
  assert.equal(shouldSearchCandidates({ intent: 'PRODUCT_SELECTION', profile: profile({ targets: ['HYDRATION'] }), requestedRoutineStep: null }), true);
  assert.equal(shouldSearchCandidates({ intent: 'BUILD_ROUTINE', profile: profile({ targets: ['HYDRATION'] }), requestedRoutineStep: null }), false);
  assert.equal(shouldSearchCandidates({ intent: 'BUILD_ROUTINE', profile: profile({ targets: ['HYDRATION'] }), requestedRoutineStep: 'MOISTURIZER' }), true);
});

test('AI service exposes candidate discovery internally without changing public R11C response', async () => {
  const candidateService = { search: async (input) => ({ searched: true, input, candidates: [] }) };
  const service = createAIService({ provider: { interpretConversation: async () => ({ intent: 'PRODUCT_SELECTION', mode: 'ANSWER', message: 'Necesito más información.', profile: profile() }) }, candidateService });
  const response = await service.advise({ message: 'Quiero ayuda' });
  assert.deepEqual(response.recommendations, []);
  const internal = await service.discoverCandidates({ intent: 'PRODUCT_SELECTION', profile: profile({ targets: ['HYDRATION'] }) });
  assert.equal(internal.searched, true);
});

test('runtime candidate files contain no historical fixture IDs', () => {
  const runtimeFiles = [
    path.join(__dirname, '../src/services/ai/candidates/catalogEligibility.js'),
    path.join(__dirname, '../src/services/ai/candidates/candidateScoring.js'),
    path.join(__dirname, '../src/services/ai/candidates/candidateRepository.js'),
    path.join(__dirname, '../src/services/ai/candidates/candidateService.js'),
  ];
  const source = runtimeFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  for (const id of ['p-1788390859776', 'p-1788269661494', 'p-1788269781556', 'p-1788392449895', 'p-1788392928433']) assert.doesNotMatch(source, new RegExp(id));
});
