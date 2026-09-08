const { AI_LIMITS, AI_MODES } = require('./constants');
const { AIServiceError } = require('./errors');
const { validateProfile } = require('./contract');
const { ROUTINE_ORDER } = require('./routines/routineContract');

const fail = (message) => { throw new AIServiceError('INVALID_AI_RESPONSE', message, 502); };
const boundedText = (value, field, max = AI_LIMITS.responseMessage) => {
  if (typeof value !== 'string') fail(`${field} no es válido.`);
  const result = value.trim();
  if (!result || result.length > max || /[\u0000-\u001F]/.test(result)) fail(`${field} no es válido.`);
  return result;
};
const exactKeys = (value, keys, field) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !keys.includes(key))) fail(`${field} no es válido.`);
};

const validateBase = (value, keys) => {
  exactKeys(value, keys, 'respuesta');
  if (!AI_MODES.includes(value.mode)) fail('El modo de respuesta no es válido.');
  return { mode: value.mode, message: boundedText(value.message, 'message'), profile: validateProfile(value.profile) };
};

const validateCompareOutput = (value, { productIds = [] } = {}) => {
  const base = validateBase(value, ['mode', 'message', 'profile', 'comparison']);
  if (!value.comparison || typeof value.comparison !== 'object' || Array.isArray(value.comparison)) fail('La comparación no es válida.');
  exactKeys(value.comparison, ['productIds', 'summary', 'differences', 'winnerProductId'], 'comparison');
  const allowed = new Set(productIds.map(String));
  if (!Array.isArray(value.comparison.productIds) || value.comparison.productIds.length !== productIds.length || value.comparison.productIds.some((id) => typeof id !== 'string' || !allowed.has(id))) fail('Los Products comparados no son válidos.');
  const comparisonIds = value.comparison.productIds.map(String);
  if (new Set(comparisonIds).size !== comparisonIds.length) fail('Los Products comparados están duplicados.');
  const differences = value.comparison.differences === undefined ? [] : value.comparison.differences;
  if (!Array.isArray(differences) || differences.length > 8 || differences.some((item) => typeof item !== 'string')) fail('Las diferencias no son válidas.');
  const winnerProductId = value.comparison.winnerProductId === null || value.comparison.winnerProductId === undefined ? null : value.comparison.winnerProductId;
  if (winnerProductId !== null && (typeof winnerProductId !== 'string' || !allowed.has(winnerProductId))) fail('El Product ganador no es válido.');
  if (winnerProductId !== null && differences.length === 0) fail('Un Product ganador requiere diferencias o criterios explícitos.');
  return { ...base, comparison: { productIds: comparisonIds, summary: boundedText(value.comparison.summary, 'comparison.summary'), differences: differences.map((item) => boundedText(item, 'comparison.difference', 320)), winnerProductId } };
};

const validateCompatibilityOutput = (value, { productIds = [] } = {}) => {
  const base = validateBase(value, ['mode', 'message', 'profile', 'compatibility']);
  if (!value.compatibility || typeof value.compatibility !== 'object' || Array.isArray(value.compatibility)) fail('La compatibilidad no es válida.');
  exactKeys(value.compatibility, ['productIds', 'period', 'orderProductIds', 'structuralStatus', 'formulaLevel', 'summary'], 'compatibility');
  const allowed = new Set(productIds.map(String));
  const ids = value.compatibility.productIds;
  if (!Array.isArray(ids) || ids.length !== 2 || ids.some((id) => typeof id !== 'string' || !allowed.has(id)) || new Set(ids).size !== ids.length) fail('Los Products de compatibilidad no son válidos.');
  const order = value.compatibility.orderProductIds;
  if (!Array.isArray(order) || order.length !== 2 || order.some((id) => !allowed.has(id)) || new Set(order).size !== order.length) fail('El orden de compatibilidad no es válido.');
  if (![null, 'MORNING', 'EVENING', 'SAME_ROUTINE'].includes(value.compatibility.period)) fail('El periodo de compatibilidad no es válido.');
  if (!['COMPATIBLE', 'CONFLICT', 'UNKNOWN'].includes(value.compatibility.structuralStatus)) fail('El estado estructural no es válido.');
  if (value.compatibility.formulaLevel !== 'UNKNOWN') fail('La compatibilidad de fórmula no puede afirmarse en este alcance.');
  return { ...base, compatibility: { productIds: ids, period: value.compatibility.period, orderProductIds: order, structuralStatus: value.compatibility.structuralStatus, formulaLevel: 'UNKNOWN', summary: boundedText(value.compatibility.summary, 'compatibility.summary') } };
};

const validateBudgetOutput = (value) => {
  const base = validateBase(value, ['mode', 'message', 'profile', 'budgetSelection']);
  if (value.budgetSelection !== null && value.budgetSelection !== undefined) {
    exactKeys(value.budgetSelection, ['productIds'], 'budgetSelection');
    if (!Array.isArray(value.budgetSelection.productIds) || value.budgetSelection.productIds.some((id) => typeof id !== 'string')) fail('La selección de presupuesto no es válida.');
  }
  return { ...base, budgetSelection: value.budgetSelection ? { productIds: [...new Set(value.budgetSelection.productIds)] } : null };
};

const validateOwnedOutput = (value) => {
  const base = validateBase(value, ['mode', 'message', 'profile', 'ownedSelection']);
  if (value.ownedSelection !== null && value.ownedSelection !== undefined) {
    exactKeys(value.ownedSelection, ['productIds'], 'ownedSelection');
    if (!Array.isArray(value.ownedSelection.productIds) || value.ownedSelection.productIds.some((id) => typeof id !== 'string')) fail('La selección de Products conocidos no es válida.');
  }
  return { ...base, ownedSelection: value.ownedSelection ? { productIds: [...new Set(value.ownedSelection.productIds)] } : null };
};

const orderIndex = (step) => ROUTINE_ORDER.indexOf(step);
module.exports = { orderIndex, validateBudgetOutput, validateCompareOutput, validateCompatibilityOutput, validateOwnedOutput };
