const { isRecommendationEligibleProduct } = require('./catalogEligibility');

const CANDIDATE_LIMIT = 5;
const MIN_CANDIDATE_SCORE = 10;
const CANDIDATE_WEIGHTS = Object.freeze({
  routineStepMatch: 40,
  skinTypeMatch: 20,
  conditionMatch: 12,
  targetMatch: 10,
  unknownPenalty: 2,
});

const CONFIDENCE_ORDER = Object.freeze({ HIGH: 3, MEDIUM: 2, LOW: 1 });

const parseCanonicalList = (value) => {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) return [...value];
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed === null ? null : Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const addUnknown = (unknownCriteria, criterion) => {
  if (!unknownCriteria.includes(criterion)) unknownCriteria.push(criterion);
};

const addNeutral = (neutralCriteria, criterion) => {
  if (!neutralCriteria.includes(criterion)) neutralCriteria.push(criterion);
};

const scoreCandidate = ({ product, requestedRoutineStep, profile }) => {
  if (!isRecommendationEligibleProduct(product)) return null;

  const matchedCriteria = [];
  const unknownCriteria = [];
  const neutralCriteria = [];
  const conflicts = [];
  let score = 0;

  if (requestedRoutineStep) {
    if (product.routineStep === requestedRoutineStep) {
      score += CANDIDATE_WEIGHTS.routineStepMatch;
      matchedCriteria.push('ROUTINE_STEP');
    } else if (product.routineStep === null || product.routineStep === undefined) {
      addUnknown(unknownCriteria, 'ROUTINE_STEP');
      score -= CANDIDATE_WEIGHTS.unknownPenalty;
    } else {
      conflicts.push('ROUTINE_STEP');
      return null;
    }
  }

  if (profile.skinType) {
    const skinTypes = parseCanonicalList(product.suitableSkinTypes);
    if (skinTypes === null) {
      addUnknown(unknownCriteria, 'SKIN_TYPE');
      score -= CANDIDATE_WEIGHTS.unknownPenalty;
    } else if (skinTypes.length === 0) {
      addNeutral(neutralCriteria, 'SKIN_TYPE');
    } else if (skinTypes.includes(profile.skinType)) {
      score += CANDIDATE_WEIGHTS.skinTypeMatch;
      matchedCriteria.push('SKIN_TYPE');
    } else {
      conflicts.push('SKIN_TYPE');
      return null;
    }
  }

  if (profile.conditions !== null && profile.conditions.length > 0) {
    const conditions = parseCanonicalList(product.suitableConditions);
    if (conditions === null) {
      addUnknown(unknownCriteria, 'CONDITION');
      score -= CANDIDATE_WEIGHTS.unknownPenalty;
    } else if (conditions.length === 0) {
      addNeutral(neutralCriteria, 'CONDITION');
    } else {
      const overlap = profile.conditions.filter((condition) => conditions.includes(condition));
      if (overlap.length > 0) {
        score += CANDIDATE_WEIGHTS.conditionMatch;
        matchedCriteria.push('CONDITION');
      }
    }
  }

  if (profile.targets !== null && profile.targets.length > 0) {
    const targets = parseCanonicalList(product.targets);
    if (targets === null) {
      addUnknown(unknownCriteria, 'TARGET');
      score -= CANDIDATE_WEIGHTS.unknownPenalty;
    } else if (targets.length === 0) {
      addNeutral(neutralCriteria, 'TARGET');
    } else {
      const overlap = profile.targets.filter((target) => targets.includes(target));
      if (overlap.length > 0) {
        score += CANDIDATE_WEIGHTS.targetMatch * overlap.length;
        matchedCriteria.push('TARGET');
      }
    }
  }

  if (score < MIN_CANDIDATE_SCORE) return null;

  const uncertaintyCount = unknownCriteria.length + neutralCriteria.length;
  const confidence = matchedCriteria.length === 0
    ? 'LOW'
    : uncertaintyCount === 0
      ? 'HIGH'
      : 'MEDIUM';

  return {
    productId: product.id,
    price: Number(product.price),
    score,
    confidence,
    matchedCriteria,
    unknownCriteria,
    neutralCriteria,
    conflicts,
    metadata: {
      id: product.id,
      name: product.name,
      routineStep: product.routineStep ?? null,
      sizeLabel: product.sizeLabel ?? null,
      suitableSkinTypes: parseCanonicalList(product.suitableSkinTypes),
      suitableConditions: parseCanonicalList(product.suitableConditions),
      targets: parseCanonicalList(product.targets),
    },
  };
};

const compareCandidates = (left, right) => (
  right.score - left.score
  || CONFIDENCE_ORDER[right.confidence] - CONFIDENCE_ORDER[left.confidence]
  || String(left.productId).localeCompare(String(right.productId))
);

module.exports = {
  CANDIDATE_LIMIT,
  MIN_CANDIDATE_SCORE,
  CANDIDATE_WEIGHTS,
  compareCandidates,
  parseCanonicalList,
  scoreCandidate,
};
