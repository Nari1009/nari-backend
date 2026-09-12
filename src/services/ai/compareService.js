const { AIServiceError } = require('./errors');
const { assertCustomerFacingMessage } = require('./contract');
const { validateCompareOutput } = require('./point10Contract');
const { isRecommendationEligibleProduct } = require('./candidates/catalogEligibility');
const { toPublicRecommendations } = require('./recommendationProjection');

const toComparisonEvidence = (product = {}, profile = {}) => {
  const fit = (values, requested) => {
    if (!requested) return 'NEUTRAL';
    if (values === null || values === undefined) return 'INSUFFICIENT_EVIDENCE';
    if (!Array.isArray(values) || values.length === 0) return 'NEUTRAL';
    return values.includes(requested) ? 'SUPPORTED' : 'CONFLICT';
  };
  const conditionFits = Array.isArray(profile.conditions) && profile.conditions.length
    ? profile.conditions.map((condition) => fit(product.suitableConditions, condition))
    : [];
  const targetFits = Array.isArray(profile.targets) && profile.targets.length
    ? profile.targets.map((target) => fit(product.targets, target))
    : [];
  const allFits = [fit(product.suitableSkinTypes, profile.skinType), ...conditionFits, ...targetFits];
  const fitStatus = allFits.includes('CONFLICT') ? 'CONFLICT' : allFits.includes('INSUFFICIENT_EVIDENCE') ? 'INSUFFICIENT_EVIDENCE' : allFits.includes('SUPPORTED') ? 'SUPPORTED' : 'NEUTRAL';
  return {
    productId: String(product.id),
    name: product.name ?? null,
    brand: product.brand ?? null,
    routineStep: product.routineStep ?? null,
    sizeLabel: product.sizeLabel ?? null,
    suitableSkinTypes: product.suitableSkinTypes === undefined ? null : product.suitableSkinTypes,
    suitableConditions: product.suitableConditions === undefined ? null : product.suitableConditions,
    targets: product.targets === undefined ? null : product.targets,
    price: product.price ?? null,
    availability: {
      status: product.status ?? null,
      inStock: Number(product.stock) > 0,
      purchasable: isRecommendationEligibleProduct(product),
    },
    fit: {
      skinType: fit(product.suitableSkinTypes, profile.skinType),
      conditions: conditionFits,
      targets: targetFits,
      overall: fitStatus,
    },
  };
};

const comparisonFacts = (products, profile = {}) => {
  const evidence = products.map((product) => toComparisonEvidence(product, profile));
  const sameRoutineStep = evidence[0]?.routineStep !== null && evidence[0]?.routineStep === evidence[1]?.routineStep;
  const outcome = !sameRoutineStep
    ? 'NON_SUBSTITUTABLE'
    : evidence.some((item) => item.fit.overall === 'INSUFFICIENT_EVIDENCE')
      ? 'INSUFFICIENT_EVIDENCE'
      : evidence[0].fit.overall === 'SUPPORTED' && evidence[1].fit.overall === 'CONFLICT'
        ? 'A_PREFERRED'
        : evidence[1].fit.overall === 'SUPPORTED' && evidence[0].fit.overall === 'CONFLICT'
          ? 'B_PREFERRED'
          : 'TIE';
  return { sameRoutineStep, routineSteps: evidence.map((item) => item.routineStep), fit: evidence.map((item) => item.fit), availability: evidence.map((item) => item.availability), outcome, evidence };
};

const unsupportedComparisonClaim = /(\d+\s*%|concentraci[oó]n|inci|ingredientes?\s+(principales?|activos?)|textura|catalogRole|suitableSkinTypes|suitableConditions|routineStep|DEV_FIXTURE|\bstock\b|cura|reemplaza\s+(mi|el)\s+tratamiento)/i;

const assertComparisonMessage = (message) => {
  assertCustomerFacingMessage(message);
  if (unsupportedComparisonClaim.test(message)) throw new AIServiceError('INVALID_AI_RESPONSE', 'La respuesta AI contiene una afirmación de comparación no respaldada.', 502);
  return message;
};

const createCompareService = () => ({
  supports(intent) { return intent === 'COMPARE'; },

  async handle({ request, interpretation, provider, resolvedProducts, turnPlan, conversationState }) {
    if (!Array.isArray(resolvedProducts) || resolvedProducts.length !== 2) throw new AIServiceError('TURNPLAN_REFERENCE_NOT_FOUND', 'Necesito exactamente dos productos para compararlos.', 409);
    if (typeof provider.reasonComparison !== 'function') throw new AIServiceError('AI_UNAVAILABLE', 'El servicio AI no está disponible.', 503);
    const facts = comparisonFacts(resolvedProducts, conversationState?.profile || interpretation.profile);
    const evidence = facts.evidence;
    const output = validateCompareOutput(await provider.reasonComparison({ request, interpretation, turnPlan, conversationState, evidence, facts, products: evidence }), { productIds: resolvedProducts.map((product) => String(product.id)) });
    const orderedIds = resolvedProducts.map((product) => String(product.id));
    if (output.comparison.productIds.some((id) => !orderedIds.includes(String(id))) || new Set(output.comparison.productIds).size !== 2) throw new AIServiceError('INVALID_AI_RESPONSE', 'La respuesta AI cambió los productos comparados.', 502);
    const winnerId = output.comparison.winnerProductId ? String(output.comparison.winnerProductId) : null;
    if (winnerId) {
      const winnerEvidence = evidence.find((item) => item.productId === winnerId);
      const otherEvidence = evidence.find((item) => item.productId !== winnerId);
      const defensible = facts.sameRoutineStep && winnerEvidence.fit.overall === 'SUPPORTED' && otherEvidence.fit.overall === 'CONFLICT' && facts.outcome !== 'INSUFFICIENT_EVIDENCE';
      if (!defensible) throw new AIServiceError('INVALID_AI_RESPONSE', 'La respuesta AI declaró una preferencia que no está respaldada por la evidencia.', 502);
    }
    const message = assertComparisonMessage(output.message);
    const publicProducts = resolvedProducts.map((product, index) => {
      const { fit, ...publicEvidence } = evidence[index];
      return publicEvidence;
    });
    const winner = winnerId && resolvedProducts.find((product) => String(product.id) === winnerId);
    return {
      intent: interpretation.intent,
      mode: output.mode,
      message,
      profile: conversationState?.profile || interpretation.profile,
      comparison: { ...output.comparison, productIds: orderedIds, products: publicProducts },
      recommendations: winner && isRecommendationEligibleProduct(winner)
        ? toPublicRecommendations({ selectedProducts: [winner], reasons: [{ productId: winner.id, reason: 'La comparación muestra un ajuste canónico más claro para tu perfil.' }] })
        : [],
      __comparisonOutcome: facts.outcome,
    };
  },
});

module.exports = { createCompareService, comparisonFacts, toComparisonEvidence, assertComparisonMessage };
