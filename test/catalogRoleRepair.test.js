const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createCandidateService } = require('../src/services/ai/candidates/candidateService');
const { isRecommendationEligibleProduct } = require('../src/services/ai/candidates/catalogEligibility');

const profile = {
  skinType: 'OILY',
  conditions: null,
  targets: null,
  budget: null,
  routinePreference: 'simple',
  knownProducts: [],
};

const product = (id, routineStep, catalogRole = 'CATALOG') => ({
  id,
  name: id,
  status: 'active',
  stock: 10,
  catalogRole,
  routineStep,
  suitableSkinTypes: JSON.stringify(['OILY']),
  suitableConditions: '[]',
  targets: '[]',
});

test('post-repair lowercase catalogrole state exposes all OILY core routine candidates while excluding fixtures', async () => {
  const rows = [
    product('cleanser', 'CLEANSER'),
    product('moisturizer', 'MOISTURIZER'),
    product('sunscreen', 'SUNSCREEN'),
    ...Array.from({ length: 17 }, (_, index) => product(`catalog-${index}`, 'SERUM')),
    ...Array.from({ length: 5 }, (_, index) => product(`fixture-${index}`, 'CLEANSER', 'DEV_FIXTURE')),
  ];
  assert.equal(rows.filter((row) => row.catalogRole === 'CATALOG').length, 20);
  assert.equal(rows.filter((row) => row.catalogRole === 'DEV_FIXTURE').length, 5);
  assert.equal(rows.filter((row) => row.catalogRole == null).length, 0);

  const service = createCandidateService({ repository: { findEligibleProducts: async () => rows.filter(isRecommendationEligibleProduct) } });
  for (const routineStep of ['CLEANSER', 'MOISTURIZER', 'SUNSCREEN']) {
    const result = await service.search({ intent: 'BUILD_ROUTINE', profile, requestedRoutineStep: routineStep });
    assert.ok(result.candidates.length >= 1, routineStep);
    assert.ok(result.candidates.every((candidate) => candidate.metadata.routineStep === routineStep));
  }
  assert.equal(rows.filter((row) => row.catalogRole === 'DEV_FIXTURE').filter(isRecommendationEligibleProduct).length, 0);
});

test('catalog-role visibility is independent of skin type and preserves coverage gaps', async () => {
  const rows = [
    product('oily-cleanser', 'CLEANSER'),
    product('oily-moisturizer', 'MOISTURIZER'),
    product('oily-sunscreen', 'SUNSCREEN'),
    { ...product('dry-cleanser', 'CLEANSER'), suitableSkinTypes: JSON.stringify(['DRY']) },
  ];
  const service = createCandidateService({ repository: { findEligibleProducts: async () => rows.filter(isRecommendationEligibleProduct) } });

  for (const skinType of ['OILY', 'DRY', 'COMBINATION', 'NORMAL']) {
    const counts = {};
    for (const routineStep of ['CLEANSER', 'MOISTURIZER', 'SUNSCREEN']) {
      const result = await service.search({
        intent: 'BUILD_ROUTINE',
        profile: { ...profile, skinType },
        requestedRoutineStep: routineStep,
      });
      counts[routineStep] = result.candidates.length;
      assert.ok(result.candidates.every((candidate) => candidate.metadata.routineStep === routineStep));
    }
    assert.deepEqual(counts, skinType === 'OILY'
      ? { CLEANSER: 1, MOISTURIZER: 1, SUNSCREEN: 1 }
      : skinType === 'DRY'
        ? { CLEANSER: 1, MOISTURIZER: 0, SUNSCREEN: 0 }
        : { CLEANSER: 0, MOISTURIZER: 0, SUNSCREEN: 0 });
  }
});

test('runtime SQL uses the lowercase physical catalogrole column and aliases it to the domain field', () => {
  const files = [
    path.join(__dirname, '../src/services/ai/candidates/candidateRepository.js'),
    path.join(__dirname, '../src/services/ai/candidates/finalProductRepository.js'),
    path.join(__dirname, '../src/services/ai/productResolver.js'),
  ];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.match(source, /catalogRole AS "catalogRole"/i);
    assert.match(source, /(?:WHERE|AND)\s+catalogRole = 'CATALOG'/i);
  }
});

test('guarded repair is DEV-only, transactional, and updates only lowercase catalogrole', () => {
  const source = fs.readFileSync(path.join(__dirname, '../scripts/repairDevCatalogRole.js'), 'utf8');
  assert.match(source, /NARI_ALLOW_DEV_ROLE_REPAIR/);
  assert.match(source, /DEV_DATABASE_URL/);
  assert.match(source, /await client\.query\('BEGIN'\)/);
  assert.match(source, /await client\.query\('COMMIT'\)/);
  assert.match(source, /client\.query\('ROLLBACK'\)/);
  assert.match(source, /SET catalogrole = "catalogRole"/);
  assert.doesNotMatch(source, /ALTER\s+TABLE|\b(INSERT|DELETE|TRUNCATE)\b/i);
  assert.doesNotMatch(source, /SET\s+"catalogRole"\s*=/i);
});

test('diagnostic reports no exclusion for an eligible normalized runtime row', () => {
  const source = fs.readFileSync(path.join(__dirname, '../scripts/diagnoseDevCleanserCandidates.js'), 'utf8');
  assert.match(source, /exclusionReason:\s*exclusionReason\(\{\s*product:\s*normalized/);
});
