const { AI_INTENTS, AI_LIMITS } = require('../constants');
const { validateProfile } = require('../contract');
const { ProductMetadataValidationError, validateRoutineStep } = require('../../../domain/productTaxonomy');
const { createCandidateRepository } = require('./candidateRepository');
const {
  CANDIDATE_LIMIT,
  compareCandidates,
  scoreCandidate,
} = require('./candidateScoring');

const CANDIDATE_SEARCH_INTENTS = Object.freeze(new Set(['PRODUCT_SELECTION', 'BUILD_ROUTINE']));

const validateCandidateInput = (input = {}) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Candidate input must be an object.');
  const allowed = ['intent', 'profile', 'requestedRoutineStep', 'currentProductId', 'budget', 'excludeProductIds'];
  if (Object.keys(input).some((key) => !allowed.includes(key))) throw new Error('Candidate input contains unsupported fields.');
  if (!AI_INTENTS.includes(input.intent)) throw new Error('Candidate input intent is invalid.');
  const profile = validateProfile(input.profile || { skinType: null, conditions: null, targets: null, budget: null, routinePreference: null, knownProducts: [] });
  let requestedRoutineStep;
  try {
    requestedRoutineStep = validateRoutineStep(input.requestedRoutineStep);
  } catch (error) {
    if (error instanceof ProductMetadataValidationError) throw new Error('Candidate routineStep is invalid.');
    throw error;
  }
  const currentProductId = input.currentProductId === undefined || input.currentProductId === null ? null : String(input.currentProductId).trim();
  if (currentProductId && currentProductId.length > AI_LIMITS.contextProductId) throw new Error('Candidate currentProductId is too long.');
  const budget = input.budget === undefined || input.budget === null ? profile.budget : String(input.budget).trim();
  const excludeProductIds = input.excludeProductIds === undefined ? [] : input.excludeProductIds;
  if (!Array.isArray(excludeProductIds) || excludeProductIds.length > AI_LIMITS.contextReferenceItems || excludeProductIds.some((id) => typeof id !== 'string' || !id.trim() || id.trim().length > AI_LIMITS.contextProductId)) throw new Error('Candidate exclusions are invalid.');
  return { intent: input.intent, profile, requestedRoutineStep, currentProductId, budget, excludeProductIds: [...new Set(excludeProductIds.map((id) => id.trim()))] };
};

const hasSearchCriteria = ({ profile, requestedRoutineStep }) => Boolean(
  requestedRoutineStep
  || profile.skinType
  || (profile.conditions && profile.conditions.length > 0)
  || (profile.targets && profile.targets.length > 0)
);

const shouldSearchCandidates = (input) => {
  if (!CANDIDATE_SEARCH_INTENTS.has(input.intent)) return false;
  if (input.intent === 'BUILD_ROUTINE' && !input.requestedRoutineStep) return false;
  return hasSearchCriteria(input);
};

const createCandidateService = ({ repository = createCandidateRepository() } = {}) => ({
  async search(rawInput) {
    const input = validateCandidateInput(rawInput);
    if (!shouldSearchCandidates(input)) return { searched: false, reason: 'INTENT_OR_CRITERIA_NOT_READY', candidates: [] };

    const products = await repository.findEligibleProducts(input);
    const candidates = products
      .map((product) => scoreCandidate({ product, requestedRoutineStep: input.requestedRoutineStep, profile: input.profile }))
      .filter(Boolean)
      .sort(compareCandidates)
      .slice(0, CANDIDATE_LIMIT);

    return {
      searched: true,
      reason: candidates.length ? 'CANDIDATES_FOUND' : 'NO_QUALIFYING_CANDIDATES',
      candidates,
    };
  },
});

module.exports = {
  CANDIDATE_SEARCH_INTENTS,
  createCandidateService,
  hasSearchCriteria,
  shouldSearchCandidates,
  validateCandidateInput,
};
