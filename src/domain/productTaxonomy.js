/**
 * Canonical vocabulary for future recommendation matching.
 *
 * This module deliberately does not replace the legacy Product fields
 * skinTypes, concerns, skinBenefits, benefits, ingredients, or category.
 * Those fields remain backwards-compatible until a separately curated
 * migration is approved. The future recommendation model is intentionally
 * separate: routineStep, suitableSkinTypes, suitableConditions, targets,
 * featuredIngredients, fullIngredients, benefits, howToUse, precautions,
 * and sizeLabel. The suitable* and targets fields are not legacy aliases.
 */

const ROUTINE_STEPS = Object.freeze([
  'FIRST_CLEANSE',
  'CLEANSER',
  'TONER',
  'ESSENCE',
  'SERUM',
  'EYE_CARE',
  'MOISTURIZER',
  'SUNSCREEN',
]);

const BASE_SKIN_TYPES = Object.freeze([
  'OILY',
  'DRY',
  'COMBINATION',
  'NORMAL',
]);

const SKIN_CONDITIONS = Object.freeze([
  'SENSITIVE',
  'DEHYDRATED',
  'ACNE_PRONE',
  'REDNESS_PRONE',
  'BARRIER_COMPROMISED',
]);

const CONCERN_GOALS = Object.freeze([
  'ACNE',
  'EXCESS_OIL',
  'HYDRATION',
  'BARRIER_SUPPORT',
  'DARK_SPOTS',
  'UNEVEN_TONE',
  'TEXTURE',
  'PORES',
  'FINE_LINES',
  'FIRMNESS',
  'DULLNESS',
  'UV_PROTECTION',
]);

const ROUTINE_STEP_SET = new Set(ROUTINE_STEPS);
const BASE_SKIN_TYPE_SET = new Set(BASE_SKIN_TYPES);
const SKIN_CONDITION_SET = new Set(SKIN_CONDITIONS);
const CONCERN_GOAL_SET = new Set(CONCERN_GOALS);

class ProductMetadataValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProductMetadataValidationError';
  }
}

const validateCanonical = (value, set, label) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') throw new ProductMetadataValidationError(`${label} must be a string or null.`);
  const normalized = value.trim();
  if (!normalized) return null;
  if (!set.has(normalized)) throw new ProductMetadataValidationError(`${label} has an invalid canonical value.`);
  return normalized;
};

const validateRoutineStep = (value) => validateCanonical(value, ROUTINE_STEP_SET, 'routineStep');

const validateBaseSkinType = (value) => validateCanonical(value, BASE_SKIN_TYPE_SET, 'baseSkinType');

const validateSkinCondition = (value) => validateCanonical(value, SKIN_CONDITION_SET, 'skinCondition');

const validateConcernGoal = (value) => validateCanonical(value, CONCERN_GOAL_SET, 'concernGoal');

const validateCanonicalList = (value, set, label) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!Array.isArray(value)) throw new ProductMetadataValidationError(`${label} must be an array or null.`);

  const normalized = [];
  for (const item of value) {
    if (typeof item !== 'string' || !set.has(item.trim())) {
      throw new ProductMetadataValidationError(`${label} contains an invalid canonical value.`);
    }
    const canonical = item.trim();
    if (!normalized.includes(canonical)) normalized.push(canonical);
  }
  return normalized;
};

const validateSuitableSkinTypes = (value) => validateCanonicalList(value, BASE_SKIN_TYPE_SET, 'suitableSkinTypes');

const validateSuitableConditions = (value) => validateCanonicalList(value, SKIN_CONDITION_SET, 'suitableConditions');

const validateTargets = (value) => validateCanonicalList(value, CONCERN_GOAL_SET, 'targets');

const validateSafeDisplayText = (value, { field = 'sizeLabel', maxLength = 80 } = {}) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') throw new ProductMetadataValidationError(`${field} must be a string or null.`);
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > maxLength) throw new ProductMetadataValidationError(`${field} exceeds the maximum length of ${maxLength}.`);
  if (/<\/?[a-z][^>]*>/i.test(normalized) || /(?:javascript|vbscript|data)\s*:/i.test(normalized)) {
    throw new ProductMetadataValidationError(`${field} does not allow HTML or executable content.`);
  }
  return normalized;
};

const validateSizeLabel = (value) => validateSafeDisplayText(value, { field: 'sizeLabel', maxLength: 80 });

module.exports = {
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
};
