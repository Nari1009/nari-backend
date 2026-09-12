const {
  AI_INTENTS,
  AI_MODES,
  AI_NEXT_ACTIONS,
  AI_LIMITS,
  BASE_SKIN_TYPES,
  SKIN_CONDITIONS,
  CONCERN_GOALS,
  PROFILE_KEYS,
} = require('./constants');
const { AIServiceError } = require('./errors');
const { ROUTINE_STEPS } = require('../../domain/productTaxonomy');

const ownKeys = (value) => Object.keys(value);
const fail = (message, code = 'INVALID_AI_REQUEST') => { throw new AIServiceError(code, message, 400); };

const boundedString = (value, field, max, { required = false } = {}) => {
  if (typeof value !== 'string') {
    if (!required && (value === undefined || value === null)) return undefined;
    fail(`${field} debe ser texto.`);
  }
  const result = value.trim();
  if (required && !result) fail(`${field} es obligatorio.`);
  if (result.length > max) fail(`${field} supera el máximo permitido.`);
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(result)) fail(`${field} contiene caracteres no permitidos.`);
  return result;
};

const providerString = (value, field, max) => {
  if (typeof value !== 'string') throw new AIServiceError('INVALID_AI_RESPONSE', `La respuesta AI contiene ${field} no válido.`, 502);
  const result = value.trim();
  if (result.length > max || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(result)) {
    throw new AIServiceError('INVALID_AI_RESPONSE', `La respuesta AI contiene ${field} no válido.`, 502);
  }
  return result;
};

const assertCustomerFacingMessage = (message) => {
  const internalStatePattern = /(unresolvedOwnedProducts|ownedRoutineSteps|knownProducts|catalogRole|recommendation readiness|recommendation readiness|\bcandidatos?\b|\bscores?\b|queda registrado|producto verificado|clasificación provisional|identidad como producto nari)/i;
  if (internalStatePattern.test(message)) throw new AIServiceError('INVALID_AI_RESPONSE', 'La respuesta AI contiene lenguaje interno no permitido.', 502);
  return message;
};

const normalizeSkinType = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return {
    GRASA: 'OILY',
    GRASO: 'OILY',
    SECA: 'DRY',
    SECO: 'DRY',
    MIXTA: 'COMBINATION',
    MIXTO: 'COMBINATION',
    NORMAL: 'NORMAL',
  }[normalized] || value;
};

const uniqueCanonicalList = (value, allowed, field, { nullable = true } = {}) => {
  if (value === undefined) return nullable ? null : undefined;
  if (value === null) return nullable ? null : fail(`${field} no puede ser null.`);
  if (!Array.isArray(value)) fail(`${field} debe ser una lista o null.`);
  const result = [];
  for (const item of value) {
    if (typeof item !== 'string' || !allowed.includes(item.trim())) fail(`${field} contiene un valor no permitido.`);
    const canonical = item.trim();
    if (!result.includes(canonical)) result.push(canonical);
  }
  return result;
};

const validateRequest = (input) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('La solicitud debe ser un objeto.');
  const allowed = ['message', 'history', 'context', 'conversationState'];
  if (ownKeys(input).some((key) => !allowed.includes(key))) fail('La solicitud contiene campos no permitidos.');
  const message = boundedString(input.message, 'message', AI_LIMITS.message, { required: true });
  const history = input.history === undefined ? [] : input.history;
  if (!Array.isArray(history)) fail('history debe ser una lista.');
  if (history.length > AI_LIMITS.historyItems) fail('history supera el máximo permitido.');
  const normalizedHistory = history.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) fail(`history[${index}] no es válido.`);
    if (ownKeys(item).some((key) => !['role', 'content'].includes(key))) fail(`history[${index}] contiene campos no permitidos.`);
    if (!['user', 'assistant'].includes(item.role)) fail(`history[${index}].role no es válido.`);
    return { role: item.role, content: boundedString(item.content, `history[${index}].content`, AI_LIMITS.historyMessage, { required: true }) };
  });
  const totalCharacters = message.length + normalizedHistory.reduce((sum, item) => sum + item.content.length, 0);
  if (totalCharacters > AI_LIMITS.totalConversation) fail('La conversación supera el máximo permitido.');
  let context;
  if (input.context !== undefined) {
    if (!input.context || typeof input.context !== 'object' || Array.isArray(input.context)) fail('context debe ser un objeto.');
    if (ownKeys(input.context).some((key) => !['currentProductId', 'recentRecommendations', 'recentRoutine'].includes(key))) fail('context contiene campos no permitidos.');
    const currentProductId = input.context.currentProductId === null || input.context.currentProductId === undefined
      ? null
      : boundedString(input.context.currentProductId, 'context.currentProductId', AI_LIMITS.contextProductId, { required: true });
    const validateReferences = (value, field) => {
      if (value === undefined) return [];
      if (!Array.isArray(value) || value.length > AI_LIMITS.contextReferenceItems) fail(`${field} no es válido.`);
      return value.map((item, index) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) fail(`${field}[${index}] no es válido.`);
        if (ownKeys(item).some((key) => !['productId', 'routineStep'].includes(key))) fail(`${field}[${index}] contiene campos no permitidos.`);
        const productId = boundedString(item.productId, `${field}[${index}].productId`, AI_LIMITS.contextProductId, { required: true });
        const routineStep = item.routineStep === null || item.routineStep === undefined ? null : boundedString(item.routineStep, `${field}[${index}].routineStep`, AI_LIMITS.contextReferenceStep, { required: true });
        if (routineStep !== null && !ROUTINE_STEPS.includes(routineStep)) fail(`${field}[${index}].routineStep no es válido.`);
        return { productId, routineStep };
      });
    };
    context = { currentProductId };
    if (input.context.recentRecommendations !== undefined) context.recentRecommendations = validateReferences(input.context.recentRecommendations, 'context.recentRecommendations');
    if (input.context.recentRoutine !== undefined) context.recentRoutine = validateReferences(input.context.recentRoutine, 'context.recentRoutine');
  }
  let conversationState;
  if (input.conversationState !== undefined) {
    if (!input.conversationState || typeof input.conversationState !== 'object' || Array.isArray(input.conversationState)) fail('conversationState debe ser un envelope válido.', 'INVALID_CONVERSATION_STATE');
    if (ownKeys(input.conversationState).some((key) => !['state', 'signature'].includes(key)) || typeof input.conversationState.signature !== 'string' || !input.conversationState.state || typeof input.conversationState.state !== 'object' || Array.isArray(input.conversationState.state)) {
      fail('conversationState no es válido.', 'INVALID_CONVERSATION_STATE');
    }
    conversationState = { state: input.conversationState.state, signature: input.conversationState.signature };
  }
  return conversationState === undefined
    ? { message, history: normalizedHistory, context }
    : { message, history: normalizedHistory, context, conversationState };
};

const validateProfile = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AIServiceError('INVALID_AI_RESPONSE', 'El perfil AI no es válido.', 502);
  if (ownKeys(value).some((key) => !PROFILE_KEYS.includes(key))) throw new AIServiceError('INVALID_AI_RESPONSE', 'El perfil AI contiene campos no permitidos.', 502);
  const skinType = normalizeSkinType(value.skinType);
  if (skinType !== null && (typeof skinType !== 'string' || !BASE_SKIN_TYPES.includes(skinType.trim()))) throw new AIServiceError('INVALID_AI_RESPONSE', 'El perfil AI contiene un tipo de piel no permitido.', 502);
  const conditions = uniqueCanonicalList(value.conditions, SKIN_CONDITIONS, 'conditions');
  const targets = uniqueCanonicalList(value.targets, CONCERN_GOALS, 'targets');
  const budget = value.budget === null || value.budget === undefined ? null : providerString(value.budget, 'budget', 200);
  const routinePreference = value.routinePreference === null || value.routinePreference === undefined ? null : providerString(value.routinePreference, 'routinePreference', 200);
  const knownProducts = value.knownProducts === null || value.knownProducts === undefined ? [] : value.knownProducts;
  if (!Array.isArray(knownProducts) || knownProducts.some((item) => typeof item !== 'string' || item.trim().length > 160)) throw new AIServiceError('INVALID_AI_RESPONSE', 'El perfil AI contiene productos conocidos no válidos.', 502);
  const unresolvedOwnedProducts = value.unresolvedOwnedProducts === null || value.unresolvedOwnedProducts === undefined ? [] : value.unresolvedOwnedProducts;
  if (!Array.isArray(unresolvedOwnedProducts) || unresolvedOwnedProducts.some((item) => typeof item !== 'string' || item.trim().length > 160)) throw new AIServiceError('INVALID_AI_RESPONSE', 'El perfil AI contiene referencias externas no válidas.', 502);
  const ownedRoutineSteps = value.ownedRoutineSteps === null || value.ownedRoutineSteps === undefined ? [] : value.ownedRoutineSteps;
  if (!Array.isArray(ownedRoutineSteps) || ownedRoutineSteps.some((item) => typeof item !== 'string' || !ROUTINE_STEPS.includes(item.trim()))) throw new AIServiceError('INVALID_AI_RESPONSE', 'El perfil AI contiene pasos de rutina reportados no válidos.', 502);
  return {
    skinType: skinType === null ? null : skinType.trim(),
    conditions,
    targets,
    budget,
    routinePreference,
    knownProducts: knownProducts.map((item) => item.trim()).filter(Boolean).slice(0, 20),
    unresolvedOwnedProducts: unresolvedOwnedProducts.map((item) => item.trim()).filter(Boolean).slice(0, 20),
    ownedRoutineSteps: [...new Set(ownedRoutineSteps.map((item) => item.trim()))],
  };
};

const validateProviderOutput = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AIServiceError('INVALID_AI_RESPONSE', 'La respuesta AI no es válida.', 502);
  if (ownKeys(value).some((key) => !['intent', 'mode', 'message', 'profile', 'productReferences', 'scope', 'nextAction', 'requestedRoutineStep', 'requestedSteps', 'relationToPrevious', 'referencePhrases', 'ownershipDelta', 'discoveryCriteria'].includes(key))) throw new AIServiceError('INVALID_AI_RESPONSE', 'La respuesta AI contiene campos no permitidos.', 502);
  if (!AI_INTENTS.includes(value.intent)) throw new AIServiceError('INVALID_AI_RESPONSE', 'La respuesta AI contiene un intent no permitido.', 502);
  if (!AI_MODES.includes(value.mode)) throw new AIServiceError('INVALID_AI_RESPONSE', 'La respuesta AI contiene un modo no permitido.', 502);
  const message = assertCustomerFacingMessage(providerString(value.message, 'message', AI_LIMITS.responseMessage));
  if (!message) throw new AIServiceError('INVALID_AI_RESPONSE', 'La respuesta AI requiere un mensaje.', 502);
  const productReferences = value.productReferences === undefined ? [] : value.productReferences;
  if (!Array.isArray(productReferences) || productReferences.length > AI_LIMITS.productReferences || productReferences.some((item) => typeof item !== 'string' || !item.trim() || item.trim().length > AI_LIMITS.productReference)) throw new AIServiceError('INVALID_AI_RESPONSE', 'Las referencias de Products no son válidas.', 502);
  const scope = value.scope === undefined ? 'IN_SCOPE' : value.scope;
  if (!['IN_SCOPE', 'OUT_OF_SCOPE'].includes(scope)) throw new AIServiceError('INVALID_AI_RESPONSE', 'La respuesta AI contiene un scope no permitido.', 502);
  const nextAction = value.nextAction === undefined
    ? value.mode === 'FOLLOW_UP' ? 'ASK_FOLLOW_UP' : value.mode === 'ANSWER' ? 'ANSWER' : 'RECOMMEND'
    : value.nextAction;
  const requestedRoutineStep = value.requestedRoutineStep === undefined || value.requestedRoutineStep === null ? null : value.requestedRoutineStep;
  if (requestedRoutineStep !== null && (typeof requestedRoutineStep !== 'string' || !ROUTINE_STEPS.includes(requestedRoutineStep.trim()))) throw new AIServiceError('INVALID_AI_RESPONSE', 'La respuesta AI contiene un paso de catálogo no permitido.', 502);
  const requestedSteps = value.requestedSteps === undefined ? (requestedRoutineStep ? [requestedRoutineStep.trim()] : []) : value.requestedSteps;
  if (!Array.isArray(requestedSteps) || requestedSteps.length > ROUTINE_STEPS.length || requestedSteps.some((step) => typeof step !== 'string' || !ROUTINE_STEPS.includes(step.trim()))) throw new AIServiceError('INVALID_AI_RESPONSE', 'La respuesta AI contiene pasos solicitados no permitidos.', 502);
  const relationToPrevious = value.relationToPrevious === undefined ? 'NONE' : value.relationToPrevious;
  if (!['NONE', 'ALTERNATIVE', 'FOLLOW_UP', 'CORRECTION'].includes(relationToPrevious)) throw new AIServiceError('INVALID_AI_RESPONSE', 'La respuesta AI contiene una relación de conversación no permitida.', 502);
  const referencePhrases = value.referencePhrases === undefined ? productReferences : value.referencePhrases;
  if (!Array.isArray(referencePhrases) || referencePhrases.length > AI_LIMITS.productReferences || referencePhrases.some((item) => typeof item !== 'string' || !item.trim() || item.trim().length > AI_LIMITS.productReference)) throw new AIServiceError('INVALID_AI_RESPONSE', 'Las referencias conversacionales no son válidas.', 502);
  if (!AI_NEXT_ACTIONS.includes(nextAction)) throw new AIServiceError('INVALID_AI_RESPONSE', 'La respuesta AI contiene una acción no permitida.', 502);
  const ownershipDelta = value.ownershipDelta === undefined ? {} : value.ownershipDelta;
  if (!ownershipDelta || typeof ownershipDelta !== 'object' || Array.isArray(ownershipDelta) || ownKeys(ownershipDelta).some((key) => !['addVerifiedProductReferences', 'addUnresolvedItems', 'addOwnedRoutineSteps', 'removeReferences', 'removeUnresolvedLabels', 'removeOwnedRoutineSteps'].includes(key))) throw new AIServiceError('INVALID_AI_RESPONSE', 'La respuesta AI contiene cambios de pertenencia no permitidos.', 502);
  const validateTextList = (input, field, max = AI_LIMITS.contextReferenceItems) => {
    if (input === undefined) return [];
    if (!Array.isArray(input) || input.length > max || input.some((item) => typeof item !== 'string' || !item.trim() || item.trim().length > AI_LIMITS.productReference)) throw new AIServiceError('INVALID_AI_RESPONSE', `La respuesta AI contiene ${field} no válido.`, 502);
    return [...new Set(input.map((item) => item.trim()))];
  };
  const addUnresolvedItems = ownershipDelta.addUnresolvedItems === undefined ? [] : ownershipDelta.addUnresolvedItems;
  if (!Array.isArray(addUnresolvedItems) || addUnresolvedItems.length > AI_LIMITS.contextReferenceItems || addUnresolvedItems.some((item) => !item || typeof item !== 'object' || ownKeys(item).some((key) => !['label', 'reportedRoutineStep'].includes(key)) || typeof item.label !== 'string' || !item.label.trim() || item.label.trim().length > AI_LIMITS.productReference || (item.reportedRoutineStep !== null && item.reportedRoutineStep !== undefined && !ROUTINE_STEPS.includes(item.reportedRoutineStep)))) throw new AIServiceError('INVALID_AI_RESPONSE', 'La respuesta AI contiene productos externos no válidos.', 502);
  const addOwnedRoutineSteps = ownershipDelta.addOwnedRoutineSteps === undefined ? [] : ownershipDelta.addOwnedRoutineSteps;
  const removeOwnedRoutineSteps = ownershipDelta.removeOwnedRoutineSteps === undefined ? [] : ownershipDelta.removeOwnedRoutineSteps;
  for (const [field, input] of [['addOwnedRoutineSteps', addOwnedRoutineSteps], ['removeOwnedRoutineSteps', removeOwnedRoutineSteps]]) {
    if (!Array.isArray(input) || input.length > ROUTINE_STEPS.length || input.some((step) => typeof step !== 'string' || !ROUTINE_STEPS.includes(step))) throw new AIServiceError('INVALID_AI_RESPONSE', `La respuesta AI contiene ${field} no válido.`, 502);
  }
  const normalizedOwnershipDelta = {
    addVerifiedProductReferences: validateTextList(ownershipDelta.addVerifiedProductReferences, 'addVerifiedProductReferences'),
    addUnresolvedItems: addUnresolvedItems.map((item) => ({ label: item.label.trim(), reportedRoutineStep: item.reportedRoutineStep === undefined ? null : item.reportedRoutineStep })),
    addOwnedRoutineSteps: [...new Set(addOwnedRoutineSteps)],
    removeReferences: validateTextList(ownershipDelta.removeReferences, 'removeReferences'),
    removeUnresolvedLabels: validateTextList(ownershipDelta.removeUnresolvedLabels, 'removeUnresolvedLabels'),
    removeOwnedRoutineSteps: [...new Set(removeOwnedRoutineSteps)],
  };
  if (nextAction === 'ASK_FOLLOW_UP' && value.mode === 'RECOMMENDATION') {
    return { intent: value.intent, mode: 'FOLLOW_UP', message, profile: validateProfile(value.profile), ownershipDelta: normalizedOwnershipDelta, productReferences: productReferences.map((item) => item.trim()), referencePhrases: referencePhrases.map((item) => item.trim()), requestedSteps: [...new Set(requestedSteps.map((step) => step.trim()))], relationToPrevious, scope, nextAction, requestedRoutineStep };
  }
  if (nextAction === 'CATALOG_DISCOVERY' && value.mode !== 'ANSWER') throw new AIServiceError('INVALID_AI_RESPONSE', 'La acción de descubrimiento requiere un modo de respuesta.', 502);
  if (nextAction === 'CATALOG_DISCOVERY' && value.intent !== 'DISCOVERY') throw new AIServiceError('INVALID_AI_RESPONSE', 'La acción de descubrimiento requiere el intent DISCOVERY.', 502);
  if (nextAction === 'RECOMMEND' && value.mode === 'FOLLOW_UP') throw new AIServiceError('INVALID_AI_RESPONSE', 'La acción de recomendación requiere un modo válido.', 502);
  const rawDiscovery = value.discoveryCriteria || {};
  if (!rawDiscovery || typeof rawDiscovery !== 'object' || Array.isArray(rawDiscovery) || ownKeys(rawDiscovery).some((key) => !['routineSteps', 'brand', 'skinTypes', 'conditions', 'targets', 'useProfile', 'browseScope'].includes(key))) throw new AIServiceError('INVALID_AI_RESPONSE', 'Los filtros de catálogo no son válidos.', 502);
  const discoveryCriteria = {
    routineSteps: uniqueCanonicalList(rawDiscovery.routineSteps === undefined ? requestedSteps : rawDiscovery.routineSteps, ROUTINE_STEPS, 'discoveryCriteria.routineSteps', { nullable: false }) || [],
    brand: rawDiscovery.brand === undefined || rawDiscovery.brand === null ? null : providerString(rawDiscovery.brand, 'discoveryCriteria.brand', 120),
    skinTypes: uniqueCanonicalList(rawDiscovery.skinTypes === undefined ? null : rawDiscovery.skinTypes, BASE_SKIN_TYPES, 'discoveryCriteria.skinTypes'),
    conditions: uniqueCanonicalList(rawDiscovery.conditions === undefined ? null : rawDiscovery.conditions, SKIN_CONDITIONS, 'discoveryCriteria.conditions'),
    targets: uniqueCanonicalList(rawDiscovery.targets === undefined ? null : rawDiscovery.targets, CONCERN_GOALS, 'discoveryCriteria.targets'),
    useProfile: rawDiscovery.useProfile === true,
    browseScope: rawDiscovery.browseScope === 'FILTERED' ? 'FILTERED' : 'BROAD',
  };
  return { intent: value.intent, mode: value.mode, message, profile: validateProfile(value.profile), ownershipDelta: normalizedOwnershipDelta, productReferences: productReferences.map((item) => item.trim()), referencePhrases: referencePhrases.map((item) => item.trim()), requestedSteps: [...new Set(requestedSteps.map((step) => step.trim()))], relationToPrevious, scope, nextAction, requestedRoutineStep, discoveryCriteria };
};

module.exports = { validateRequest, validateProviderOutput, validateProfile, assertCustomerFacingMessage };
