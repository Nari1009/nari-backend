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
  const allowed = ['message', 'history', 'context'];
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
    if (ownKeys(input.context).some((key) => key !== 'currentProductId')) fail('context contiene campos no permitidos.');
    const currentProductId = input.context.currentProductId === null || input.context.currentProductId === undefined
      ? null
      : boundedString(input.context.currentProductId, 'context.currentProductId', AI_LIMITS.contextProductId, { required: true });
    context = { currentProductId };
  }
  return { message, history: normalizedHistory, context };
};

const validateProfile = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AIServiceError('INVALID_AI_RESPONSE', 'El perfil AI no es válido.', 502);
  if (ownKeys(value).some((key) => !PROFILE_KEYS.includes(key))) throw new AIServiceError('INVALID_AI_RESPONSE', 'El perfil AI contiene campos no permitidos.', 502);
  const skinType = value.skinType === null || value.skinType === undefined ? null : value.skinType;
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
  if (ownKeys(value).some((key) => !['intent', 'mode', 'message', 'profile', 'productReferences', 'scope', 'nextAction'].includes(key))) throw new AIServiceError('INVALID_AI_RESPONSE', 'La respuesta AI contiene campos no permitidos.', 502);
  if (!AI_INTENTS.includes(value.intent)) throw new AIServiceError('INVALID_AI_RESPONSE', 'La respuesta AI contiene un intent no permitido.', 502);
  if (!AI_MODES.includes(value.mode)) throw new AIServiceError('INVALID_AI_RESPONSE', 'La respuesta AI contiene un modo no permitido.', 502);
  const message = providerString(value.message, 'message', AI_LIMITS.responseMessage);
  if (!message) throw new AIServiceError('INVALID_AI_RESPONSE', 'La respuesta AI requiere un mensaje.', 502);
  const productReferences = value.productReferences === undefined ? [] : value.productReferences;
  if (!Array.isArray(productReferences) || productReferences.length > AI_LIMITS.productReferences || productReferences.some((item) => typeof item !== 'string' || !item.trim() || item.trim().length > AI_LIMITS.productReference)) throw new AIServiceError('INVALID_AI_RESPONSE', 'Las referencias de Products no son válidas.', 502);
  const scope = value.scope === undefined ? 'IN_SCOPE' : value.scope;
  if (!['IN_SCOPE', 'OUT_OF_SCOPE'].includes(scope)) throw new AIServiceError('INVALID_AI_RESPONSE', 'La respuesta AI contiene un scope no permitido.', 502);
  const nextAction = value.nextAction === undefined
    ? value.mode === 'FOLLOW_UP' ? 'ASK_FOLLOW_UP' : value.mode === 'ANSWER' ? 'ANSWER' : 'RECOMMEND'
    : value.nextAction;
  if (!AI_NEXT_ACTIONS.includes(nextAction)) throw new AIServiceError('INVALID_AI_RESPONSE', 'La respuesta AI contiene una acción no permitida.', 502);
  if (nextAction === 'ASK_FOLLOW_UP' && value.mode === 'RECOMMENDATION') {
    return { intent: value.intent, mode: 'FOLLOW_UP', message, profile: validateProfile(value.profile), productReferences: productReferences.map((item) => item.trim()), scope, nextAction };
  }
  if (nextAction === 'RECOMMEND' && value.mode === 'FOLLOW_UP') throw new AIServiceError('INVALID_AI_RESPONSE', 'La acción de recomendación requiere un modo válido.', 502);
  return { intent: value.intent, mode: value.mode, message, profile: validateProfile(value.profile), productReferences: productReferences.map((item) => item.trim()), scope, nextAction };
};

module.exports = { validateRequest, validateProviderOutput, validateProfile };
