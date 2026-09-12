const { AIServiceError } = require('./errors');
const { validateProfile, assertCustomerFacingMessage } = require('./contract');
const { isRecommendationEligibleProduct } = require('./candidates/catalogEligibility');

const MEDICATION_REFERENCE = /\b(tretino[ií]na|isotretino[ií]na|isotretinoin|antibi[oó]tico|corticoide|esteroide|medicamento|tratamiento m[eé]dico|prescripci[oó]n)\b/i;
const UNSUPPORTED_FORMULA_CLAIM = /(100\s*%|ingredientes?\s+(combinan|compatibles)|f[oó]rmulas?\s+(combinan|compatibles)|activos?.{0,20}(compatibles|seguros)|concentraci[oó]n|inci|ph|pH|textura|acabado|cura|reemplaza\s+(mi|el)\s+tratamiento)/i;

const evidenceFor = (item) => {
  if (item.kind === 'EXTERNAL') return { productId: null, name: item.label, brand: null, routineStep: item.routineStep || null, sizeLabel: null, suitableSkinTypes: null, suitableConditions: null, targets: null, availability: null, external: true };
  const product = item.product;
  return { productId: String(product.id), name: product.name ?? null, brand: product.brand ?? null, routineStep: product.routineStep ?? null, sizeLabel: product.sizeLabel ?? null, suitableSkinTypes: product.suitableSkinTypes === undefined ? null : product.suitableSkinTypes, suitableConditions: product.suitableConditions === undefined ? null : product.suitableConditions, targets: product.targets === undefined ? null : product.targets, availability: { status: product.status ?? null, inStock: Number(product.stock) > 0, purchasable: isRecommendationEligibleProduct(product) }, external: false };
};

const itemStep = (item) => item.kind === 'EXTERNAL' ? item.routineStep || null : item.product?.routineStep || null;

const orderedPlacement = (items, period) => items
  .filter((item) => itemStep(item) && (period === 'MORNING' ? itemStep(item) !== 'FIRST_CLEANSE' : itemStep(item) !== 'SUNSCREEN'))
  .sort((left, right) => {
    const order = { FIRST_CLEANSE: 10, CLEANSER: 20, TONER: 30, ESSENCE: 40, SERUM: 50, EYE_CARE: 60, MOISTURIZER: 70, SUNSCREEN: 80 };
    return (order[itemStep(left)] || 999) - (order[itemStep(right)] || 999);
  })
  .map((item) => item.productId || item.label);

const analyzeStructuralCompatibility = (items) => {
  const steps = items.map(itemStep);
  if (steps.some((step) => !step)) return { status: 'INSUFFICIENT_CONTEXT', placement: { morning: [], evening: [] }, reason: 'A routine step is not confirmed.' };
  if (new Set(steps).size !== steps.length) return { status: 'REDUNDANT_STEP', placement: { morning: orderedPlacement(items, 'MORNING'), evening: orderedPlacement(items, 'EVENING') }, reason: 'Both Products occupy the same routine step.' };
  return { status: 'COMPATIBLE_WITH_PLACEMENT', placement: { morning: orderedPlacement(items, 'MORNING'), evening: orderedPlacement(items, 'EVENING') }, reason: 'The routine steps can be arranged without a known structural conflict.' };
};

const validateCompatibilityResponse = (value, allowedProductIds) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !['mode', 'message', 'profile', 'compatibility'].includes(key))) throw new AIServiceError('INVALID_AI_RESPONSE', 'La respuesta AI de compatibilidad no es válida.', 502);
  if (!['FOLLOW_UP', 'ANSWER', 'RECOMMENDATION'].includes(value.mode) || typeof value.message !== 'string' || !value.message.trim()) throw new AIServiceError('INVALID_AI_RESPONSE', 'La respuesta AI de compatibilidad no es válida.', 502);
  const profile = validateProfile(value.profile);
  const comparison = value.compatibility;
  if (!comparison || typeof comparison !== 'object' || Array.isArray(comparison) || Object.keys(comparison).some((key) => !['productIds', 'period', 'orderProductIds', 'structuralStatus', 'formulaLevel', 'summary'].includes(key))) throw new AIServiceError('INVALID_AI_RESPONSE', 'La evidencia de compatibilidad no es válida.', 502);
  const productIds = comparison.productIds || [];
  const orderProductIds = comparison.orderProductIds || [];
  if (!Array.isArray(productIds) || productIds.some((id) => typeof id !== 'string' || !allowedProductIds.has(id)) || new Set(productIds).size !== productIds.length) throw new AIServiceError('INVALID_AI_RESPONSE', 'La respuesta AI cambió los Products de compatibilidad.', 502);
  if (!Array.isArray(orderProductIds) || orderProductIds.some((id) => typeof id !== 'string' || !allowedProductIds.has(id) || !productIds.includes(id))) throw new AIServiceError('INVALID_AI_RESPONSE', 'El orden de compatibilidad no es válido.', 502);
  if (typeof comparison.summary !== 'string' || !comparison.summary.trim()) throw new AIServiceError('INVALID_AI_RESPONSE', 'El resumen de compatibilidad no es válido.', 502);
  return { mode: value.mode, message: value.message.trim(), profile, summary: comparison.summary.trim(), providerProductIds: productIds, providerOrderProductIds: orderProductIds };
};

const createCompatibilityService = () => ({
  supports(intent) { return intent === 'COMPATIBILITY'; },

  async handle({ request, interpretation, provider, resolvedItems, conversationState, turnPlan }) {
    if (!Array.isArray(resolvedItems) || resolvedItems.length !== 2) throw new AIServiceError('TURNPLAN_REFERENCE_NOT_FOUND', 'Necesito dos referencias para revisar su compatibilidad.', 409);
    const evidence = resolvedItems.map(evidenceFor);
    const structural = analyzeStructuralCompatibility(resolvedItems);
    const profile = conversationState?.profile || interpretation.profile;
    const allowedProductIds = new Set(evidence.map((item) => item.productId).filter(Boolean));
    const medication = MEDICATION_REFERENCE.test(request.message);
    const facts = { structuralCompatibility: structural.status, formulaCompatibility: 'UNKNOWN', placement: structural.placement, limitations: ['No hay evidencia específica de fórmula o activos para confirmar compatibilidad a ese nivel.'], externalProductInvolved: evidence.some((item) => item.external), medicalBoundaryTriggered: medication };
    let response;
    if (medication) {
      response = { mode: 'ANSWER', message: 'No puedo confirmar compatibilidad con un medicamento o tratamiento prescrito. No cambies ni suspendas tu tratamiento; consulta al profesional que te lo indicó.', providerProductIds: [], providerOrderProductIds: [], profile };
    } else {
      if (typeof provider.reasonCompatibility !== 'function') throw new AIServiceError('AI_UNAVAILABLE', 'El servicio AI no está disponible.', 503);
      const output = validateCompatibilityResponse(await provider.reasonCompatibility({ request, interpretation, turnPlan, conversationState, evidence, facts, products: evidence }), allowedProductIds);
      if (output.providerProductIds.length !== allowedProductIds.size) throw new AIServiceError('INVALID_AI_RESPONSE', 'La respuesta AI omitió o alteró la identidad de los Products.', 502);
      response = output;
    }
    const responseText = [response.message, response.summary].filter(Boolean).join(' ');
    assertCustomerFacingMessage(responseText);
    if (UNSUPPORTED_FORMULA_CLAIM.test(responseText)) throw new AIServiceError('INVALID_AI_RESPONSE', 'La respuesta AI contiene una afirmación de fórmula no respaldada.', 502);
    const publicProducts = evidence.map(({ external, ...item }) => item);
    return { intent: interpretation.intent, mode: response.mode, message: response.message, profile, compatibility: { productIds: evidence.map((item) => item.productId).filter(Boolean), period: null, orderProductIds: structural.placement.evening.length ? structural.placement.evening.filter((id) => allowedProductIds.has(String(id))) : [], structuralStatus: structural.status, formulaLevel: 'UNKNOWN', formulaCompatibility: 'UNKNOWN', summary: structural.reason, placement: structural.placement, limitations: facts.limitations, products: publicProducts }, recommendations: [], __compatibilityOutcome: { ...facts, resolvedProductCount: resolvedItems.length } };
  },
});

module.exports = { createCompatibilityService, evidenceFor, analyzeStructuralCompatibility, validateCompatibilityResponse, MEDICATION_REFERENCE };
