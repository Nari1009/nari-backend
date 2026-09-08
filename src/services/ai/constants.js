const { BASE_SKIN_TYPES, SKIN_CONDITIONS, CONCERN_GOALS } = require('../../domain/productTaxonomy');

const AI_INTENTS = Object.freeze([
  'DISCOVERY',
  'BUILD_ROUTINE',
  'PRODUCT_SELECTION',
  'COMPARE',
  'COMPATIBILITY',
  'BUDGET_ROUTINE',
  'PRODUCT_INFO',
  'GENERAL_SKINCARE',
  'UNKNOWN',
]);

const AI_MODES = Object.freeze(['FOLLOW_UP', 'ANSWER', 'RECOMMENDATION']);

const AI_LIMITS = Object.freeze({
  message: 2000,
  historyItems: 12,
  historyMessage: 1000,
  totalConversation: 8000,
  responseMessage: 3000,
  contextProductId: 120,
  providerTimeoutMs: 8000,
  rateWindowMs: 60_000,
  rateMaxRequests: 20,
});

const PROFILE_KEYS = Object.freeze([
  'skinType',
  'conditions',
  'targets',
  'budget',
  'routinePreference',
  'knownProducts',
]);

module.exports = {
  AI_INTENTS,
  AI_MODES,
  AI_LIMITS,
  BASE_SKIN_TYPES,
  SKIN_CONDITIONS,
  CONCERN_GOALS,
  PROFILE_KEYS,
};
