const crypto = require('node:crypto');
const { AIServiceError } = require('./errors');
const { BASE_SKIN_TYPES, SKIN_CONDITIONS, CONCERN_GOALS } = require('../../domain/productTaxonomy');
const { ROUTINE_STEPS } = require('../../domain/productTaxonomy');

const STATE_VERSION = 2;
const MAX_ARTIFACTS = 8;
const MAX_UNRESOLVED = 8;
const MAX_ID = 120;
const PROFILE_KEYS = ['skinType', 'conditions', 'targets', 'budget', 'routinePreference'];
const RELATION_STEPS = new Set(ROUTINE_STEPS);
const fail = (message, code = 'INVALID_CONVERSATION_STATE', status = 400) => { throw new AIServiceError(code, message, status); };

const ownKeys = (value) => Object.keys(value);
const text = (value, field, max = MAX_ID) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(`${field} no es válido.`);
  return value.trim();
};
const list = (value, allowed, field) => {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length > 20 || value.some((item) => typeof item !== 'string' || !allowed.includes(item))) fail(`${field} no es válida.`);
  return [...new Set(value)];
};
const nullableText = (value, field, max = 200) => value === null ? null : text(value, field, max);

const validateProfileState = (profile) => {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile) || ownKeys(profile).some((key) => !PROFILE_KEYS.includes(key)) || ownKeys(profile).length !== PROFILE_KEYS.length) fail('El perfil de conversación no es válido.');
  if (profile.skinType !== null && !BASE_SKIN_TYPES.includes(profile.skinType)) fail('El tipo de piel de la conversación no es válido.');
  return {
    skinType: profile.skinType,
    conditions: list(profile.conditions, SKIN_CONDITIONS, 'conditions'),
    targets: list(profile.targets, CONCERN_GOALS, 'targets'),
    budget: nullableText(profile.budget, 'budget'),
    routinePreference: nullableText(profile.routinePreference, 'routinePreference'),
  };
};

const validateReference = (item, field, allowPeriod = false) => {
  const allowedKeys = allowPeriod ? ['productId', 'routineStep', 'period'] : ['productId', 'routineStep'];
  if (!item || typeof item !== 'object' || Array.isArray(item) || ownKeys(item).some((key) => !allowedKeys.includes(key))) fail(`${field} no es válido.`);
  const productId = text(item.productId, `${field}.productId`);
  const routineStep = item.routineStep === null ? null : text(item.routineStep, `${field}.routineStep`, 40);
  if (routineStep !== null && !RELATION_STEPS.has(routineStep)) fail(`${field}.routineStep no es válido.`);
  return { productId, routineStep };
};

const uniqueReferences = (items, field) => {
  if (!Array.isArray(items) || items.length > MAX_ARTIFACTS) fail(`${field} no es válida.`);
  const seen = new Set();
  return items.map((item) => validateReference(item, field)).filter((item) => {
    const key = `${item.productId}|${item.routineStep || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const validateConversationState = (state) => {
  if (!state || typeof state !== 'object' || Array.isArray(state)) fail('El estado de conversación no es válido.');
  const allowed = ['version', 'revision', 'profile', 'ownership', 'artifacts'];
  if (ownKeys(state).some((key) => !allowed.includes(key))) fail('El estado de conversación contiene campos no permitidos.');
  if (state.version !== STATE_VERSION || !Number.isInteger(state.revision) || state.revision < 0) fail('La versión del estado de conversación no es válida.');
  const profile = validateProfileState(state.profile);
  const ownership = state.ownership;
  if (!ownership || typeof ownership !== 'object' || ownKeys(ownership).some((key) => !['verifiedProducts', 'unresolvedItems', 'ownedRoutineSteps'].includes(key))) fail('La propiedad de pertenencia no es válida.');
  const verifiedProducts = uniqueReferences(ownership.verifiedProducts, 'ownership.verifiedProducts');
  if (!Array.isArray(ownership.unresolvedItems) || ownership.unresolvedItems.length > MAX_UNRESOLVED || ownership.unresolvedItems.some((item) => !item || typeof item !== 'object' || ownKeys(item).some((key) => !['label', 'reportedRoutineStep'].includes(key)))) fail('Los productos externos no son válidos.');
  const unresolvedItems = ownership.unresolvedItems.map((item) => ({ label: text(item.label, 'ownership.unresolvedItems.label', 160), reportedRoutineStep: item.reportedRoutineStep === null ? null : text(item.reportedRoutineStep, 'ownership.unresolvedItems.reportedRoutineStep', 40) }));
  if (unresolvedItems.some((item) => item.reportedRoutineStep !== null && !RELATION_STEPS.has(item.reportedRoutineStep))) fail('El paso externo reportado no es válido.');
  const ownedRoutineSteps = list(ownership.ownedRoutineSteps, ROUTINE_STEPS, 'ownership.ownedRoutineSteps') || [];
  const artifacts = state.artifacts;
  if (!artifacts || typeof artifacts !== 'object' || ownKeys(artifacts).some((key) => !['recentRecommendations', 'recentRoutine', 'recentProductReferences'].includes(key))) fail('Los artefactos de conversación no son válidos.');
  const recentRecommendations = uniqueReferences(artifacts.recentRecommendations, 'artifacts.recentRecommendations');
  if (!Array.isArray(artifacts.recentRoutine) || artifacts.recentRoutine.length > MAX_ARTIFACTS || artifacts.recentRoutine.some((item) => !item || typeof item !== 'object' || ownKeys(item).some((key) => !['productId', 'routineStep', 'period'].includes(key)))) fail('La rutina reciente no es válida.');
  const recentRoutine = artifacts.recentRoutine.map((item) => ({ ...validateReference(item, 'artifacts.recentRoutine', true), period: item.period === null ? null : text(item.period, 'artifacts.recentRoutine.period', 20) }));
  if (recentRoutine.some((item) => item.period !== null && !['MORNING', 'EVENING'].includes(item.period))) fail('El periodo de la rutina reciente no es válido.');
  const recentProductReferences = uniqueReferences(artifacts.recentProductReferences || [], 'artifacts.recentProductReferences');
  return { version: STATE_VERSION, revision: state.revision, profile, ownership: { verifiedProducts, unresolvedItems, ownedRoutineSteps }, artifacts: { recentRecommendations, recentRoutine, recentProductReferences } };
};

const createEmptyConversationState = ({ revision = 0 } = {}) => validateConversationState({ version: STATE_VERSION, revision, profile: { skinType: null, conditions: null, targets: null, budget: null, routinePreference: null }, ownership: { verifiedProducts: [], unresolvedItems: [], ownedRoutineSteps: [] }, artifacts: { recentRecommendations: [], recentRoutine: [], recentProductReferences: [] } });

const validateProfileDelta = (delta = {}) => {
  if (!delta || typeof delta !== 'object' || Array.isArray(delta) || ownKeys(delta).some((key) => !PROFILE_KEYS.includes(key))) fail('El cambio de perfil no es válido.');
  const candidate = { skinType: null, conditions: null, targets: null, budget: null, routinePreference: null, ...delta };
  const validated = validateProfileState(candidate);
  return Object.fromEntries(Object.keys(delta).map((key) => [key, validated[key]]));
};

const validateOwnershipDelta = (delta = {}) => {
  const allowed = ['verifiedProducts', 'unresolvedItems', 'ownedRoutineSteps', 'addVerifiedProducts', 'addUnresolvedItems', 'addOwnedRoutineSteps', 'removeVerifiedProductIds', 'removeUnresolvedLabels', 'removeOwnedRoutineSteps'];
  if (!delta || typeof delta !== 'object' || Array.isArray(delta) || ownKeys(delta).some((key) => !allowed.includes(key))) {
    fail('El cambio de pertenencia no es válido.');
  }
  const verifiedProducts = uniqueReferences(delta.addVerifiedProducts || delta.verifiedProducts || [], 'ownershipDelta.addVerifiedProducts');
  const unresolvedItems = delta.addUnresolvedItems || delta.unresolvedItems || [];
  if (!Array.isArray(unresolvedItems) || unresolvedItems.length > MAX_UNRESOLVED) fail('Los productos externos del cambio no son válidos.');
  const normalizedUnresolved = unresolvedItems.map((item) => {
    if (!item || typeof item !== 'object' || ownKeys(item).some((key) => !['label', 'reportedRoutineStep'].includes(key))) fail('Los productos externos del cambio no son válidos.');
    const reportedRoutineStep = item.reportedRoutineStep === null ? null : text(item.reportedRoutineStep, 'ownershipDelta.unresolvedItems.reportedRoutineStep', 40);
    if (reportedRoutineStep !== null && !RELATION_STEPS.has(reportedRoutineStep)) fail('El paso externo reportado no es válido.');
    return { label: text(item.label, 'ownershipDelta.unresolvedItems.label', 160), reportedRoutineStep };
  });
  const ownedRoutineSteps = list(delta.addOwnedRoutineSteps || delta.ownedRoutineSteps || [], ROUTINE_STEPS, 'ownershipDelta.addOwnedRoutineSteps') || [];
  const boundedTextList = (value, field) => {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > MAX_ARTIFACTS || value.some((item) => typeof item !== 'string' || !item.trim() || item.trim().length > MAX_ID)) fail(`${field} no es válida.`);
    return [...new Set(value.map((item) => item.trim()))];
  };
  const removeOwnedRoutineSteps = list(delta.removeOwnedRoutineSteps || [], ROUTINE_STEPS, 'ownershipDelta.removeOwnedRoutineSteps') || [];
  return {
    verifiedProducts,
    unresolvedItems: normalizedUnresolved,
    ownedRoutineSteps,
    removeVerifiedProductIds: boundedTextList(delta.removeVerifiedProductIds, 'ownershipDelta.removeVerifiedProductIds'),
    removeUnresolvedLabels: boundedTextList(delta.removeUnresolvedLabels, 'ownershipDelta.removeUnresolvedLabels'),
    removeOwnedRoutineSteps,
  };
};

const validateArtifactEvidence = (evidence = {}) => {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence) || ownKeys(evidence).some((key) => !['recentRecommendations', 'recentRoutine', 'recentProductReferences'].includes(key))) fail('La evidencia de artefactos no es válida.');
  const recentRecommendations = uniqueReferences(evidence.recentRecommendations || [], 'artifactEvidence.recentRecommendations');
  const recentRoutine = evidence.recentRoutine || [];
  if (!Array.isArray(recentRoutine) || recentRoutine.length > MAX_ARTIFACTS || recentRoutine.some((item) => !item || typeof item !== 'object' || ownKeys(item).some((key) => !['productId', 'routineStep', 'period'].includes(key)))) fail('La rutina reciente del cambio no es válida.');
  const normalizedRoutine = recentRoutine.map((item) => ({ ...validateReference(item, 'artifactEvidence.recentRoutine', true), period: item.period === null ? null : text(item.period, 'artifactEvidence.recentRoutine.period', 20) }));
  if (normalizedRoutine.some((item) => item.period !== null && !['MORNING', 'EVENING'].includes(item.period))) fail('El periodo de la rutina reciente no es válido.');
  const recentProductReferences = uniqueReferences(evidence.recentProductReferences || [], 'artifactEvidence.recentProductReferences');
  return { recentRecommendations, recentRoutine: normalizedRoutine, recentProductReferences };
};

// An absent field means "no update". A present null is an explicit domain
// value (for example, clearing an unresolved profile field).
const mergeField = (previous, delta, key) => Object.prototype.hasOwnProperty.call(delta, key) ? delta[key] : previous[key];
const appendUnique = (current, incoming) => [...current, ...incoming].filter((item, index, all) => all.findIndex((candidate) => `${candidate.productId}|${candidate.routineStep || ''}|${candidate.period || ''}` === `${item.productId}|${item.routineStep || ''}|${item.period || ''}`) === index).slice(-MAX_ARTIFACTS);
const prioritizeUnique = (current, incoming) => [...incoming, ...current].filter((item, index, all) => all.findIndex((candidate) => `${candidate.productId}|${candidate.routineStep || ''}|${candidate.period || ''}` === `${item.productId}|${item.routineStep || ''}|${item.period || ''}`) === index).slice(0, MAX_ARTIFACTS);

const reduceConversationState = (previous, { profileDelta = {}, ownershipDelta = {}, artifactEvidence = {} } = {}) => {
  const base = validateConversationState(previous || createEmptyConversationState());
  const delta = validateProfileDelta(profileDelta);
  const ownership = validateOwnershipDelta(ownershipDelta);
  const evidence = validateArtifactEvidence(artifactEvidence);
  const profile = Object.fromEntries(PROFILE_KEYS.map((key) => [key, mergeField(base.profile, delta, key)]));
  const removeVerified = new Set(ownership.removeVerifiedProductIds.map(String));
  const removeLabels = new Set(ownership.removeUnresolvedLabels.map((label) => label.toLowerCase()));
  const removeSteps = new Set(ownership.removeOwnedRoutineSteps);
  const nextOwnership = {
    verifiedProducts: appendUnique(base.ownership.verifiedProducts.filter((item) => !removeVerified.has(String(item.productId))), ownership.verifiedProducts),
    unresolvedItems: [...base.ownership.unresolvedItems.filter((item) => !removeLabels.has(item.label.toLowerCase())), ...ownership.unresolvedItems].slice(-MAX_UNRESOLVED),
    ownedRoutineSteps: [...new Set([
      ...base.ownership.ownedRoutineSteps.filter((step) => !removeSteps.has(step)),
      ...ownership.ownedRoutineSteps,
      ...ownership.verifiedProducts.map((item) => item.routineStep).filter(Boolean),
    ])],
  };
  const nextArtifacts = {
    recentRecommendations: appendUnique(base.artifacts.recentRecommendations, evidence.recentRecommendations),
    recentRoutine: appendUnique(base.artifacts.recentRoutine, evidence.recentRoutine),
    recentProductReferences: evidence.recentProductReferences.length ? prioritizeUnique(base.artifacts.recentProductReferences, evidence.recentProductReferences) : base.artifacts.recentProductReferences,
  };
  return validateConversationState({ version: STATE_VERSION, revision: base.revision + 1, profile, ownership: nextOwnership, artifacts: nextArtifacts });
};

const isNewerConversationState = (current, incoming) => {
  const currentState = validateConversationState(current || createEmptyConversationState());
  const incomingState = validateConversationState(incoming);
  return incomingState.revision > currentState.revision;
};

const canonicalize = (value) => Array.isArray(value) ? value.map(canonicalize) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])])) : value;
const secretFrom = (secret) => {
  const value = secret || process.env.NARI_AI_STATE_SECRET;
  if (typeof value !== 'string' || value.length < 32) fail('La firma del estado AI no está configurada.', 'AI_STATE_AUTH_NOT_CONFIGURED', 503);
  return value;
};
const signState = (state, secret) => crypto.createHmac('sha256', secretFrom(secret)).update(JSON.stringify(canonicalize(validateConversationState(state)))).digest('base64url');
const createStateEnvelope = (state, secret) => { const validated = validateConversationState(state); return { state: validated, signature: signState(validated, secret) }; };
const verifyStateEnvelope = (envelope, secret) => {
  if (!envelope || typeof envelope !== 'object' || ownKeys(envelope).some((key) => !['state', 'signature'].includes(key)) || typeof envelope.signature !== 'string') fail('El estado AI firmado no es válido.');
  const state = validateConversationState(envelope.state);
  const expected = signState(state, secret);
  const actual = Buffer.from(envelope.signature);
  const expectedBuffer = Buffer.from(expected);
  if (actual.length !== expectedBuffer.length || !crypto.timingSafeEqual(actual, expectedBuffer)) fail('El estado AI firmado no pudo verificarse.');
  return state;
};

module.exports = { STATE_VERSION, MAX_ARTIFACTS, createEmptyConversationState, validateConversationState, validateProfileDelta, reduceConversationState, isNewerConversationState, signState, createStateEnvelope, verifyStateEnvelope };
