const { AI_INTENTS, AI_NEXT_ACTIONS, AI_LIMITS } = require('./constants');
const { ROUTINE_STEPS } = require('../../domain/productTaxonomy');
const { AIServiceError } = require('./errors');

const RELATIONS = Object.freeze(['NONE', 'ALTERNATIVE', 'FOLLOW_UP', 'CORRECTION']);
const ACTIONS = Object.freeze(['ASK_FOLLOW_UP', 'ANSWER', 'RECOMMEND', 'CATALOG_DISCOVERY', 'PRODUCT_INFO', 'COMPARE', 'COMPATIBILITY', 'BUDGET_ROUTINE']);
const TOOL_FAMILIES = Object.freeze(['NONE', 'CANDIDATE_SEARCH', 'ROUTINE', 'PRODUCT_INFO', 'COMPARE', 'COMPATIBILITY', 'BUDGET', 'CATALOG_DISCOVERY']);
const fail = (message) => { throw new AIServiceError('INVALID_TURN_PLAN', message, 502); };
const text = (value, field, max) => { if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(`${field} no es válido.`); return value.trim(); };

const validateTurnPlan = (plan) => {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) fail('El plan de turno no es válido.');
  const allowed = ['conversationalGoal', 'action', 'requestedSteps', 'discoveryCriteria', 'relationToPrevious', 'referencePhrases', 'resolvedProductIds', 'excludedProductIds', 'excludedProductIdsByStep', 'clarificationRequired', 'requiredToolFamily', 'responseMode'];
  if (Object.keys(plan).some((key) => !allowed.includes(key))) fail('El plan de turno contiene campos no permitidos.');
  if (!AI_INTENTS.includes(plan.conversationalGoal)) fail('El objetivo conversacional no es válido.');
  if (!ACTIONS.includes(plan.action)) fail('La acción del turno no es válida.');
  if (!RELATIONS.includes(plan.relationToPrevious)) fail('La relación con el turno anterior no es válida.');
  if (!Array.isArray(plan.requestedSteps) || plan.requestedSteps.some((step) => !ROUTINE_STEPS.includes(step))) fail('Los pasos solicitados no son válidos.');
  if (!Array.isArray(plan.referencePhrases) || plan.referencePhrases.length > AI_LIMITS.productReferences || plan.referencePhrases.some((item) => typeof item !== 'string' || !item.trim() || item.length > AI_LIMITS.productReference)) fail('Las referencias del turno no son válidas.');
  for (const field of ['resolvedProductIds', 'excludedProductIds']) if (!Array.isArray(plan[field]) || plan[field].length > AI_LIMITS.contextReferenceItems || plan[field].some((id) => typeof id !== 'string' || !id.trim() || id.length > AI_LIMITS.contextProductId)) fail(`Los IDs de ${field} no son válidos.`);
  if (!plan.excludedProductIdsByStep || typeof plan.excludedProductIdsByStep !== 'object' || Array.isArray(plan.excludedProductIdsByStep) || Object.keys(plan.excludedProductIdsByStep).some((step) => !ROUTINE_STEPS.includes(step) || !Array.isArray(plan.excludedProductIdsByStep[step]) || plan.excludedProductIdsByStep[step].length > AI_LIMITS.contextReferenceItems || plan.excludedProductIdsByStep[step].some((id) => typeof id !== 'string' || !id.trim() || id.length > AI_LIMITS.contextProductId))) fail('Las exclusiones por paso no son válidas.');
  if (typeof plan.clarificationRequired !== 'boolean' || !TOOL_FAMILIES.includes(plan.requiredToolFamily)) fail('La herramienta del turno no es válida.');
  if (!['FOLLOW_UP', 'ANSWER', 'RECOMMENDATION'].includes(plan.responseMode)) fail('El modo de respuesta del turno no es válido.');
  const discoveryCriteria = plan.discoveryCriteria || { routineSteps: [], brand: null, skinTypes: null, conditions: null, targets: null, useProfile: false, browseScope: 'BROAD' };
  if (!discoveryCriteria || typeof discoveryCriteria !== 'object' || Array.isArray(discoveryCriteria) || !Array.isArray(discoveryCriteria.routineSteps) || discoveryCriteria.routineSteps.some((step) => !ROUTINE_STEPS.includes(step)) || (discoveryCriteria.brand !== null && typeof discoveryCriteria.brand !== 'string') || (discoveryCriteria.skinTypes !== null && (!Array.isArray(discoveryCriteria.skinTypes) || discoveryCriteria.skinTypes.some((value) => typeof value !== 'string'))) || (discoveryCriteria.conditions !== null && (!Array.isArray(discoveryCriteria.conditions) || discoveryCriteria.conditions.some((value) => typeof value !== 'string'))) || (discoveryCriteria.targets !== null && (!Array.isArray(discoveryCriteria.targets) || discoveryCriteria.targets.some((value) => typeof value !== 'string'))) || typeof discoveryCriteria.useProfile !== 'boolean' || !['BROAD', 'FILTERED'].includes(discoveryCriteria.browseScope)) fail('Los criterios de descubrimiento no son válidos.');
  return { ...plan, requestedSteps: [...new Set(plan.requestedSteps)], discoveryCriteria: { ...discoveryCriteria, routineSteps: [...new Set(discoveryCriteria.routineSteps)], brand: discoveryCriteria.brand === null ? null : discoveryCriteria.brand.trim(), skinTypes: discoveryCriteria.skinTypes === undefined ? null : discoveryCriteria.skinTypes, conditions: discoveryCriteria.conditions === undefined ? null : discoveryCriteria.conditions, targets: discoveryCriteria.targets === undefined ? null : discoveryCriteria.targets }, referencePhrases: [...new Set(plan.referencePhrases.map((item) => item.trim()))], resolvedProductIds: [...new Set(plan.resolvedProductIds.map(String))], excludedProductIds: [...new Set(plan.excludedProductIds.map(String))], excludedProductIdsByStep: Object.fromEntries(Object.entries(plan.excludedProductIdsByStep).map(([step, ids]) => [step, [...new Set(ids.map(String))]])) };
};

const relationFallback = (message) => {
  const textValue = String(message || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (/son los mismos|ya me lo diste|me estas recomendando lo mismo|te dije que otro/.test(textValue)) return 'CORRECTION';
  if (/\botr[oa]s?\b|distint|diferent|que no sean|que no sea|alternativ/.test(textValue)) return 'ALTERNATIVE';
  if (/el que me recomendaste|el hidratante|el limpiador|el primero|el segundo|ese\b/.test(textValue)) return 'FOLLOW_UP';
  return 'NONE';
};

const stepsFrom = (interpretation, message) => {
  const declared = Array.isArray(interpretation.requestedSteps) ? interpretation.requestedSteps : [];
  const fromSingle = interpretation.requestedRoutineStep ? [interpretation.requestedRoutineStep] : [];
  const textValue = String(message || '').toLowerCase();
  const inferred = [];
  if (/limpiador|limpieza|jabon|cleanser/.test(textValue)) inferred.push('CLEANSER');
  if (/hidratante|moisturizer/.test(textValue)) inferred.push('MOISTURIZER');
  if (/protector|bloqueador|sunscreen/.test(textValue)) inferred.push('SUNSCREEN');
  return [...new Set([...declared, ...fromSingle, ...inferred].filter((step) => ROUTINE_STEPS.includes(step)))];
};

const actionFrom = (interpretation) => {
  if (interpretation.intent === 'PRODUCT_INFO' && interpretation.nextAction !== 'ASK_FOLLOW_UP') return 'PRODUCT_INFO';
  if (interpretation.intent === 'COMPARE' && interpretation.nextAction !== 'ASK_FOLLOW_UP') return 'COMPARE';
  if (interpretation.intent === 'COMPATIBILITY' && interpretation.nextAction !== 'ASK_FOLLOW_UP') return 'COMPATIBILITY';
  if (interpretation.intent === 'BUDGET_ROUTINE' && interpretation.nextAction !== 'ASK_FOLLOW_UP') return 'BUDGET_ROUTINE';
  if (interpretation.intent === 'DISCOVERY' && interpretation.nextAction !== 'ASK_FOLLOW_UP') return 'CATALOG_DISCOVERY';
  if (interpretation.nextAction && AI_NEXT_ACTIONS.includes(interpretation.nextAction)) return interpretation.nextAction;
  if (interpretation.intent === 'DISCOVERY') return 'CATALOG_DISCOVERY';
  if (interpretation.intent === 'PRODUCT_INFO') return 'PRODUCT_INFO';
  if (interpretation.intent === 'COMPARE') return 'COMPARE';
  if (interpretation.intent === 'COMPATIBILITY') return 'COMPATIBILITY';
  if (interpretation.intent === 'BUDGET_ROUTINE') return 'BUDGET_ROUTINE';
  return interpretation.mode === 'FOLLOW_UP' ? 'ASK_FOLLOW_UP' : interpretation.mode === 'RECOMMENDATION' ? 'RECOMMEND' : 'ANSWER';
};

const toolFor = (action, goal) => ({ RECOMMEND: goal === 'BUILD_ROUTINE' ? 'ROUTINE' : 'CANDIDATE_SEARCH', PRODUCT_INFO: 'PRODUCT_INFO', COMPARE: 'COMPARE', COMPATIBILITY: 'COMPATIBILITY', BUDGET_ROUTINE: 'BUDGET', CATALOG_DISCOVERY: 'CATALOG_DISCOVERY' }[action] || 'NONE');

const compileTurnPlan = ({ interpretation, state, message, resolution = {} } = {}) => {
  if (!interpretation || !AI_INTENTS.includes(interpretation.intent)) fail('La interpretación no puede compilarse.');
  const action = actionFrom(interpretation);
  const relation = RELATIONS.includes(interpretation.relationToPrevious) ? interpretation.relationToPrevious : relationFallback(message);
  const referencePhrases = interpretation.referencePhrases || interpretation.productReferences || [];
  const resolvedProductIds = resolution.resolvedProductIds || [];
  const recent = state?.artifacts?.recentRecommendations || [];
  const requestedSteps = stepsFrom(interpretation, message);
  const referencedIds = new Set(resolvedProductIds.map(String));
  const exclusionsByStep = {};
  const candidateRecent = recent.filter((item) => !requestedSteps.length || requestedSteps.includes(item.routineStep));
  const selectedRecent = referencedIds.size ? candidateRecent.filter((item) => referencedIds.has(String(item.productId))) : candidateRecent;
  if (relation === 'ALTERNATIVE' || relation === 'CORRECTION') {
    for (const item of selectedRecent) {
      if (!item.routineStep) continue;
      exclusionsByStep[item.routineStep] = [...(exclusionsByStep[item.routineStep] || []), String(item.productId)];
    }
  }
  const excludedProductIds = resolution.excludedProductIds || Object.values(exclusionsByStep).flat();
  return validateTurnPlan({ conversationalGoal: interpretation.intent, action, requestedSteps, discoveryCriteria: interpretation.discoveryCriteria, relationToPrevious: relation, referencePhrases, resolvedProductIds, excludedProductIds, excludedProductIdsByStep: resolution.excludedProductIdsByStep || exclusionsByStep, clarificationRequired: action === 'ASK_FOLLOW_UP', requiredToolFamily: toolFor(action, interpretation.intent), responseMode: action === 'ASK_FOLLOW_UP' ? 'FOLLOW_UP' : action === 'RECOMMEND' ? 'RECOMMENDATION' : 'ANSWER' });
};

module.exports = { RELATIONS, ACTIONS, TOOL_FAMILIES, validateTurnPlan, compileTurnPlan, relationFallback };
