const { ROUTINE_STEPS } = require('../../../domain/productTaxonomy');

const MAX_ROUTINE_PRODUCTS = 5;
const MAX_PERIOD_STEPS = 5;
const CORE_MORNING_STEPS = Object.freeze(['CLEANSER', 'MOISTURIZER', 'SUNSCREEN']);
const CORE_EVENING_STEPS = Object.freeze(['CLEANSER', 'MOISTURIZER']);
const SERUM_TARGETS = new Set([
  'ACNE', 'HYDRATION', 'BARRIER_SUPPORT', 'DARK_SPOTS', 'UNEVEN_TONE',
  'TEXTURE', 'FINE_LINES', 'FIRMNESS', 'DULLNESS',
]);

const uniqueSteps = (steps) => [...new Set(steps)].filter((step) => ROUTINE_STEPS.includes(step));

const hasUsefulProfile = (profile = {}) => Boolean(
  profile.skinType
  || (Array.isArray(profile.conditions) && profile.conditions.length > 0)
  || (Array.isArray(profile.targets) && profile.targets.length > 0)
);

const createRoutinePlan = (profile = {}) => {
  if (!hasUsefulProfile(profile)) return null;
  const targets = Array.isArray(profile.targets) ? profile.targets : [];
  const includesTreatment = targets.some((target) => SERUM_TARGETS.has(target));
  const evening = [...CORE_EVENING_STEPS];
  if (includesTreatment) evening.splice(1, 0, 'SERUM');
  return {
    morning: uniqueSteps(CORE_MORNING_STEPS),
    evening: uniqueSteps(evening),
    requiredMorning: [...CORE_MORNING_STEPS],
    requiredEvening: [...CORE_EVENING_STEPS],
    optionalMorning: [],
    optionalEvening: includesTreatment ? ['SERUM'] : [],
  };
};

const createBasicRoutinePlan = () => ({
  morning: uniqueSteps(CORE_MORNING_STEPS),
  evening: uniqueSteps(CORE_EVENING_STEPS),
  requiredMorning: [...CORE_MORNING_STEPS],
  requiredEvening: [...CORE_EVENING_STEPS],
  optionalMorning: [],
  optionalEvening: [],
});

const planSteps = (plan) => uniqueSteps([...(plan?.morning || []), ...(plan?.evening || [])]);

const applyOwnedRoutineSteps = (plan, ownedRoutineSteps = []) => {
  const owned = new Set(Array.isArray(ownedRoutineSteps) ? ownedRoutineSteps : []);
  const removeOwned = (steps) => steps.filter((step) => !owned.has(step));
  return {
    ...plan,
    morning: removeOwned(plan.morning),
    evening: removeOwned(plan.evening),
    requiredMorning: removeOwned(plan.requiredMorning),
    requiredEvening: removeOwned(plan.requiredEvening),
    optionalMorning: removeOwned(plan.optionalMorning),
    optionalEvening: removeOwned(plan.optionalEvening),
  };
};

module.exports = {
  CORE_EVENING_STEPS,
  CORE_MORNING_STEPS,
  MAX_PERIOD_STEPS,
  MAX_ROUTINE_PRODUCTS,
  SERUM_TARGETS,
  createRoutinePlan,
  createBasicRoutinePlan,
  hasUsefulProfile,
  applyOwnedRoutineSteps,
  planSteps,
};
