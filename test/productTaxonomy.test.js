const assert = require('node:assert/strict');
const test = require('node:test');

const {
  ROUTINE_STEPS,
  BASE_SKIN_TYPES,
  SKIN_CONDITIONS,
  CONCERN_GOALS,
  ProductMetadataValidationError,
  validateRoutineStep,
  validateBaseSkinType,
  validateSkinCondition,
  validateConcernGoal,
  validateSuitableSkinTypes,
  validateSuitableConditions,
  validateTargets,
  validateSizeLabel,
} = require('../src/domain/productTaxonomy');

test('canonical taxonomy contains the approved semantic groups', () => {
  assert.deepEqual(ROUTINE_STEPS, ['FIRST_CLEANSE', 'CLEANSER', 'TONER', 'ESSENCE', 'SERUM', 'EYE_CARE', 'MOISTURIZER', 'SUNSCREEN']);
  assert.deepEqual(BASE_SKIN_TYPES, ['OILY', 'DRY', 'COMBINATION', 'NORMAL']);
  assert.deepEqual(SKIN_CONDITIONS, ['SENSITIVE', 'DEHYDRATED', 'ACNE_PRONE', 'REDNESS_PRONE', 'BARRIER_COMPROMISED']);
  assert.deepEqual(CONCERN_GOALS, ['ACNE', 'EXCESS_OIL', 'HYDRATION', 'BARRIER_SUPPORT', 'DARK_SPOTS', 'UNEVEN_TONE', 'TEXTURE', 'PORES', 'FINE_LINES', 'FIRMNESS', 'DULLNESS', 'UV_PROTECTION']);
  assert.equal(BASE_SKIN_TYPES.includes('SENSITIVE'), false);
  assert.equal(BASE_SKIN_TYPES.includes('MATURE'), false);
  assert.equal(SKIN_CONDITIONS.includes('ACNE'), false);
  assert.equal(CONCERN_GOALS.includes('ACNE_PRONE'), false);
  assert.equal(CONCERN_GOALS.includes('DEHYDRATED'), false);
});

test('routineStep accepts only canonical nullable values', () => {
  for (const value of ROUTINE_STEPS) assert.equal(validateRoutineStep(value), value);
  assert.equal(validateRoutineStep(null), null);
  assert.equal(validateRoutineStep('  SERUM  '), 'SERUM');
  for (const value of ['Protector solar', 'MATURE', 'SENSITIVE', 'INVALID', 123, [], {}]) {
    assert.throws(() => validateRoutineStep(value), ProductMetadataValidationError);
  }
});

test('future taxonomy validators stay separate from legacy product arrays', () => {
  assert.equal(validateBaseSkinType('DRY'), 'DRY');
  assert.equal(validateSkinCondition('SENSITIVE'), 'SENSITIVE');
  assert.equal(validateConcernGoal('HYDRATION'), 'HYDRATION');
  assert.throws(() => validateBaseSkinType('SENSITIVE'), ProductMetadataValidationError);
  assert.throws(() => validateSkinCondition('HYDRATION'), ProductMetadataValidationError);
  assert.throws(() => validateConcernGoal('DEHYDRATED'), ProductMetadataValidationError);
});

test('canonical recommendation lists preserve null and empty-array semantics', () => {
  assert.deepEqual(validateSuitableSkinTypes(['OILY', ' DRY ', 'OILY']), ['OILY', 'DRY']);
  assert.deepEqual(validateSuitableConditions(['SENSITIVE', 'DEHYDRATED']), ['SENSITIVE', 'DEHYDRATED']);
  assert.deepEqual(validateTargets(['HYDRATION', 'BARRIER_SUPPORT']), ['HYDRATION', 'BARRIER_SUPPORT']);
  assert.equal(validateSuitableSkinTypes(null), null);
  assert.deepEqual(validateSuitableSkinTypes([]), []);
  assert.equal(validateSuitableConditions(null), null);
  assert.deepEqual(validateTargets([]), []);
  for (const value of ['SENSITIVE', 'MATURE', 'Todas', 123, {}, [['OILY']]]) {
    assert.throws(() => validateSuitableSkinTypes(value), ProductMetadataValidationError);
  }
  assert.throws(() => validateSuitableConditions(['OILY']), ProductMetadataValidationError);
  assert.throws(() => validateTargets(['DEHYDRATED']), ProductMetadataValidationError);
});

test('targets accept UV_PROTECTION without changing other taxonomy boundaries', () => {
  assert.equal(validateConcernGoal('UV_PROTECTION'), 'UV_PROTECTION');
  assert.deepEqual(validateTargets(['UV_PROTECTION', 'HYDRATION']), ['UV_PROTECTION', 'HYDRATION']);
  assert.throws(() => validateTargets(['NOT_A_TARGET']), ProductMetadataValidationError);
  assert.throws(() => validateSuitableSkinTypes(['SENSITIVE']), ProductMetadataValidationError);
  assert.throws(() => validateSuitableConditions(['OILY']), ProductMetadataValidationError);
  assert.equal(validateTargets(null), null);
  assert.deepEqual(validateTargets([]), []);
});

test('sizeLabel accepts trimmed safe display text and rejects unsafe values', () => {
  for (const value of ['50 ml', '30 g', '75 ml', '150 ml', '250 ml']) assert.equal(validateSizeLabel(value), value);
  assert.equal(validateSizeLabel('  50 ml  '), '50 ml');
  assert.equal(validateSizeLabel(null), null);
  assert.equal(validateSizeLabel(''), null);
  assert.throws(() => validateSizeLabel([]), ProductMetadataValidationError);
  assert.throws(() => validateSizeLabel({}), ProductMetadataValidationError);
  assert.throws(() => validateSizeLabel('<script>alert(1)</script>'), ProductMetadataValidationError);
  assert.throws(() => validateSizeLabel('x'.repeat(81)), ProductMetadataValidationError);
});
