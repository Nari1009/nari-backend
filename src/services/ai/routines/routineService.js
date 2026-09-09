const { AIServiceError } = require('../errors');
const { isRecommendationEligibleProduct } = require('../candidates/catalogEligibility');
const { toProviderCandidates } = require('../candidates/candidateProviderProjection');
const { toPublicRecommendations } = require('../recommendationProjection');
const { createRoutinePlan, MAX_ROUTINE_PRODUCTS, planSteps } = require('./routinePlan');
const { validateRoutineProviderOutput } = require('./routineContract');
const { customerRoutineStepLabel } = require('./customerLabels');

const unavailableResponse = ({ intent, profile, message, mode = 'ANSWER' }) => ({
  intent,
  mode,
  message,
  profile,
  routine: null,
  recommendations: [],
});

const createRoutineService = ({ candidateService, finalProductRepository } = {}) => ({
  async build({ request, interpretation, provider }) {
    const plan = createRoutinePlan(interpretation.profile);
    if (!plan) return unavailableResponse({ intent: interpretation.intent, profile: interpretation.profile, mode: 'FOLLOW_UP', message: 'Para construir una rutina sencilla necesito conocer un poco más sobre tu piel o tu objetivo principal.' });
    if (typeof provider.reasonRoutine !== 'function') throw new AIServiceError('AI_UNAVAILABLE', 'El servicio AI no está disponible.', 503);

    const candidatesByStep = {};
    for (const step of planSteps(plan)) {
      const result = await candidateService.search({ intent: 'BUILD_ROUTINE', profile: interpretation.profile, requestedRoutineStep: step, currentProductId: request.context?.currentProductId || null });
      const limitedCandidates = result.candidates.slice(0, 5);
      if (limitedCandidates.length > 0) candidatesByStep[step] = limitedCandidates;
      if ((plan.requiredMorning.includes(step) || plan.requiredEvening.includes(step)) && limitedCandidates.length === 0) {
        return unavailableResponse({ intent: interpretation.intent, profile: interpretation.profile, message: `No encontré en este momento un ${customerRoutineStepLabel(step)} disponible en Nari que pueda recomendarte con suficiente confianza. Podemos ajustar la recomendación antes de completar la rutina.` });
      }
    }

    let providerOutput;
    try {
      providerOutput = await provider.reasonRoutine({
        request,
        interpretation,
        plan: { morning: plan.morning, evening: plan.evening },
        candidatesByStep: Object.fromEntries(Object.entries(candidatesByStep).map(([step, candidates]) => [step, toProviderCandidates(candidates)])),
      });
    } catch (error) {
      if (error instanceof AIServiceError) throw error;
      throw new AIServiceError('AI_UNAVAILABLE', 'El servicio AI no está disponible.', 503);
    }
    const validated = validateRoutineProviderOutput(providerOutput, { plan, candidatesByStep });
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
    if (plan.requiredMorning.some((step) => !morning.some((item) => item.step === step)) || plan.requiredEvening.some((step) => !evening.some((item) => item.step === step))) {
      return unavailableResponse({ intent: interpretation.intent, profile: validated.profile, message: 'Uno de los productos necesarios dejó de estar disponible. La rutina no se presenta como completa y no inventaré un reemplazo.' });
    }
    const finalRoutine = {
      morning: morning.map(({ step, selectedProductId }) => ({ step, productId: selectedProductId })),
      evening: evening.map(({ step, selectedProductId }) => ({ step, productId: selectedProductId })),
    };
    const reasonById = new Map([...validated.routine.morning, ...validated.routine.evening].map((item) => [item.selectedProductId, item.reason]));
    const uniqueProducts = [...new Set([...morning, ...evening].map((item) => item.selectedProductId))].map((id) => rowsById.get(id));
    return {
      intent: interpretation.intent,
      mode: 'RECOMMENDATION',
      message: validated.message,
      profile: validated.profile,
      routine: finalRoutine,
      recommendations: toPublicRecommendations({ selectedProducts: uniqueProducts, reasons: [...reasonById].map(([productId, reason]) => ({ productId, reason })) }),
    };
  },
});

module.exports = { createRoutineService };
