const { AIServiceError } = require('../errors');
const { isRecommendationEligibleProduct } = require('../candidates/catalogEligibility');
const { toProviderCandidates } = require('../candidates/candidateProviderProjection');
const { toPublicRecommendations } = require('../recommendationProjection');
const { createRoutinePlan, applyOwnedRoutineSteps, MAX_ROUTINE_PRODUCTS, planSteps } = require('./routinePlan');
const { validateRoutineProviderOutput } = require('./routineContract');
const { customerRoutineStepLabel } = require('./customerLabels');

const unavailableResponse = ({ intent, profile, message, mode = 'ANSWER' }) => ({
  intent,
  mode,
  message,
  profile,
  routineComplete: false,
  missingSteps: [],
  routine: null,
  recommendations: [],
});

const createRoutineService = ({ candidateService, finalProductRepository } = {}) => ({
  async build({ request, interpretation, provider }) {
    const basePlan = createRoutinePlan(interpretation.profile);
    const plan = basePlan ? applyOwnedRoutineSteps(basePlan, interpretation.profile.ownedRoutineSteps) : null;
    if (!plan) return unavailableResponse({ intent: interpretation.intent, profile: interpretation.profile, mode: 'FOLLOW_UP', message: 'Para construir una rutina sencilla necesito conocer un poco más sobre tu piel o tu objetivo principal.' });
    if (typeof provider.reasonRoutine !== 'function') throw new AIServiceError('AI_UNAVAILABLE', 'El servicio AI no está disponible.', 503);

    const candidatesByStep = {};
    const missingRequiredSteps = [];
    for (const step of planSteps(plan)) {
      const result = await candidateService.search({ intent: 'BUILD_ROUTINE', profile: interpretation.profile, requestedRoutineStep: step, currentProductId: request.context?.currentProductId || null });
      const limitedCandidates = result.candidates.slice(0, 5);
      if (limitedCandidates.length > 0) candidatesByStep[step] = limitedCandidates;
      if ((plan.requiredMorning.includes(step) || plan.requiredEvening.includes(step)) && limitedCandidates.length === 0) missingRequiredSteps.push(step);
    }
    const missingRequiredSet = new Set(missingRequiredSteps);
    const availableStep = (step) => Boolean(candidatesByStep[step]?.length);
    const selectionPlan = {
      ...plan,
      morning: plan.morning.filter((step) => availableStep(step) && (!missingRequiredSet.size || plan.requiredMorning.includes(step))),
      evening: plan.evening.filter((step) => availableStep(step) && (!missingRequiredSet.size || plan.requiredEvening.includes(step))),
      requiredMorning: plan.requiredMorning.filter(availableStep),
      requiredEvening: plan.requiredEvening.filter(availableStep),
      optionalMorning: missingRequiredSet.size ? [] : plan.optionalMorning.filter(availableStep),
      optionalEvening: missingRequiredSet.size ? [] : plan.optionalEvening.filter(availableStep),
    };
    if (!planSteps(selectionPlan).length) {
      const missingLabel = missingRequiredSteps.length === 1 ? `un ${customerRoutineStepLabel(missingRequiredSteps[0])}` : 'uno o más pasos esenciales';
      return unavailableResponse({ intent: interpretation.intent, profile: interpretation.profile, message: `No encontré ${missingLabel} disponible en Nari con suficiente confianza para completar esta rutina. Podemos ajustar la recomendación.` });
    }

    let providerOutput;
    try {
      providerOutput = await provider.reasonRoutine({
        request,
        interpretation,
        plan: {
          morning: selectionPlan.morning,
          evening: selectionPlan.evening,
          missingRequiredSteps,
        },
        candidatesByStep: Object.fromEntries(Object.entries(candidatesByStep).map(([step, candidates]) => [step, toProviderCandidates(candidates)])),
      });
    } catch (error) {
      if (error instanceof AIServiceError) throw error;
      throw new AIServiceError('AI_UNAVAILABLE', 'El servicio AI no está disponible.', 503);
    }
    const validated = validateRoutineProviderOutput(providerOutput, { plan: selectionPlan, candidatesByStep });
    if (validated.mode !== 'RECOMMENDATION') return { intent: interpretation.intent, ...validated, recommendations: [] };

    const selectedIds = [...validated.routine.morning, ...validated.routine.evening].map((item) => item.selectedProductId);
    if (new Set(selectedIds).size > MAX_ROUTINE_PRODUCTS) throw new AIServiceError('INVALID_AI_RESPONSE', 'La rutina AI supera el máximo permitido.', 502);
    const rows = await finalProductRepository.findCurrentEligibleProducts([...new Set(selectedIds)]);
    const rowsById = new Map(rows.filter(isRecommendationEligibleProduct).map((product) => [String(product.id), product]));
    const validForStep = (item) => {
      const product = rowsById.get(item.selectedProductId);
      return product && product.routineStep === item.step ? product : null;
    };
    const morning = validated.routine.morning.filter((item) => validForStep(item));
    const evening = validated.routine.evening.filter((item) => validForStep(item));
    if (selectionPlan.requiredMorning.some((step) => !morning.some((item) => item.step === step)) || selectionPlan.requiredEvening.some((step) => !evening.some((item) => item.step === step))) {
      return unavailableResponse({ intent: interpretation.intent, profile: validated.profile, message: 'Uno de los productos necesarios dejó de estar disponible. La rutina no se presenta como completa y no inventaré un reemplazo.' });
    }
    const finalRoutine = {
      morning: morning.map(({ step, selectedProductId }) => ({ step, productId: selectedProductId })),
      evening: evening.map(({ step, selectedProductId }) => ({ step, productId: selectedProductId })),
    };
    const reasonById = new Map([...validated.routine.morning, ...validated.routine.evening].map((item) => [item.selectedProductId, item.reason]));
    const uniqueProducts = [...new Set([...morning, ...evening].map((item) => item.selectedProductId))].map((id) => rowsById.get(id));
    const missingLabels = missingRequiredSteps.map(customerRoutineStepLabel);
    return {
      intent: interpretation.intent,
      mode: 'RECOMMENDATION',
      message: missingLabels.length > 0
        ? `Puedo avanzar con parte de tu rutina, pero todavía no puedo confirmarla completa: falta ${missingLabels.join(' y ')}. No recomendaré un reemplazo sin suficiente confianza.`
        : validated.message,
      profile: validated.profile,
      routine: finalRoutine,
      routineComplete: missingLabels.length === 0,
      missingSteps: missingLabels,
      recommendations: toPublicRecommendations({ selectedProducts: uniqueProducts, reasons: [...reasonById].map(([productId, reason]) => ({ productId, reason })) }),
    };
  },
});

module.exports = { createRoutineService };
