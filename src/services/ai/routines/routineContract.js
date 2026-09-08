const { ROUTINE_STEPS } = require('../../../domain/productTaxonomy');
const { AI_MODES, AI_LIMITS } = require('../constants');
const { AIServiceError } = require('../errors');
const { validateProfile } = require('../contract');
const { MAX_PERIOD_STEPS, MAX_ROUTINE_PRODUCTS } = require('./routinePlan');

const ROUTINE_ORDER = Object.freeze([
  'FIRST_CLEANSE', 'CLEANSER', 'TONER', 'ESSENCE', 'SERUM', 'EYE_CARE', 'MOISTURIZER', 'SUNSCREEN',
]);
const fail = (message) => { throw new AIServiceError('INVALID_AI_RESPONSE', message, 502); };

const text = (value, field, max) => {
  if (typeof value !== 'string') fail(`${field} no es válido.`);
  const result = value.trim();
  if (!result || result.length > max || /[\u0000-\u001F]/.test(result)) fail(`${field} no es válido.`);
  return result;
};

const validatePeriod = (value, period, allowedSteps, candidatesByStep) => {
  if (!Array.isArray(value) || value.length > MAX_PERIOD_STEPS) fail(`La rutina ${period} no es válida.`);
  const seenSteps = new Set();
  let previousOrder = -1;
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some((key) => !['step', 'selectedProductId', 'reason'].includes(key))) fail(`La rutina ${period}[${index}] no es válida.`);
    if (!ROUTINE_STEPS.includes(item.step) || !allowedSteps.includes(item.step)) fail(`El paso ${item.step || ''} no está permitido en ${period}.`);
    if (seenSteps.has(item.step)) fail(`El paso ${item.step} está duplicado en ${period}.`);
    const currentOrder = ROUTINE_ORDER.indexOf(item.step);
    if (currentOrder < previousOrder) fail(`El orden de pasos de ${period} no es válido.`);
    previousOrder = currentOrder;
    seenSteps.add(item.step);
    if (period === 'morning' && item.step === 'FIRST_CLEANSE') fail('FIRST_CLEANSE debe permanecer en la rutina nocturna.');
    if (period === 'morning' && item.step === 'SERUM') fail('SERUM de tratamiento queda restringido a la rutina nocturna en V1.');
    if (period === 'evening' && item.step === 'SUNSCREEN') fail('SUNSCREEN solo puede aparecer en la rutina de mañana.');
    if (typeof item.selectedProductId !== 'string' || !item.selectedProductId.trim()) fail(`El Product seleccionado en ${period}[${index}] no es válido.`);
    const selectedProductId = item.selectedProductId.trim();
    const allowedIds = new Set((candidatesByStep[item.step] || []).map((candidate) => String(candidate.productId)));
    if (!allowedIds.has(selectedProductId)) fail(`El Product seleccionado para ${item.step} no pertenece a sus candidatos.`);
    return { step: item.step, selectedProductId, reason: text(item.reason, `reason ${period}[${index}]`, AI_LIMITS.reason) };
  });
};

const validateRoutineProviderOutput = (value, { plan, candidatesByStep } = {}) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('La respuesta de rutina AI no es válida.');
  const allowedKeys = ['mode', 'message', 'routine', 'profile'];
  if (Object.keys(value).some((key) => !allowedKeys.includes(key))) fail('La respuesta de rutina AI contiene campos no permitidos.');
  if (!AI_MODES.includes(value.mode)) fail('La respuesta de rutina AI contiene un modo no permitido.');
  const message = text(value.message, 'message', AI_LIMITS.responseMessage);
  const profile = validateProfile(value.profile);
  if (value.mode !== 'RECOMMENDATION') {
    if (value.routine !== null) fail('Una respuesta sin recomendación no puede contener rutina.');
    return { mode: value.mode, message, profile, routine: null };
  }
  if (!value.routine || typeof value.routine !== 'object' || Array.isArray(value.routine) || Object.keys(value.routine).some((key) => !['morning', 'evening'].includes(key))) fail('La rutina AI no es válida.');
  const morning = validatePeriod(value.routine.morning, 'morning', plan.morning, candidatesByStep);
  const evening = validatePeriod(value.routine.evening, 'evening', plan.evening, candidatesByStep);
  for (const requiredStep of plan.requiredMorning) if (!morning.some((item) => item.step === requiredStep)) fail(`Falta el paso obligatorio ${requiredStep} de la mañana.`);
  for (const requiredStep of plan.requiredEvening) if (!evening.some((item) => item.step === requiredStep)) fail(`Falta el paso obligatorio ${requiredStep} de la noche.`);
  const selectedIds = [...morning, ...evening].map((item) => item.selectedProductId);
  if (new Set(selectedIds).size > MAX_ROUTINE_PRODUCTS) fail('La rutina supera el máximo de Products únicos.');
  return { mode: value.mode, message, profile, routine: { morning, evening } };
};

module.exports = { ROUTINE_ORDER, validateRoutineProviderOutput };
