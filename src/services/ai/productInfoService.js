const { AIServiceError } = require('./errors');
const { isRecommendationEligibleProduct } = require('./candidates/catalogEligibility');
const { toProviderCandidate } = require('./candidates/candidateProviderProjection');
const { toPublicRecommendations } = require('./recommendationProjection');
const { assertCustomerFacingMessage } = require('./contract');

const toProductInfoEvidence = (product = {}) => ({
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
});

const positiveSkinTypeClaim = /(compatible|adecuad[ao]|apto|ideal|sirve|recomendad[ao]).{0,50}piel\s+(grasa|seca|mixta|normal)/i;
const unsupportedProductClaim = /(\d+\s*%|concentraci[oó]n|inci|ingredientes?\s+(principales?|activos?)|contiene\s+(niacinamida|retinol|[aá]cido|vitamina)|textura|catalogRole|suitableSkinTypes|suitableConditions|routineStep|DEV_FIXTURE|\bstock\b)/i;
const targetClaims = [
  [/acn[eé]|granitos|brotes/i, 'ACNE'],
  [/grasa|brillo/i, 'EXCESS_OIL'],
  [/hidrata|resequedad|deshidrat/i, 'HYDRATION'],
  [/manchas|tono desigual/i, 'DARK_SPOTS'],
  [/textura/i, 'TEXTURE'],
  [/poros/i, 'PORES'],
];
const targetClaimPrefix = /(ayud[ae]|sirve|ideal|adecuad[ao]|pensad[ao]|enfocad[ao]|recomendad[ao]|apoya).{0,35}/i;

const assertProductInfoMessage = (message, products) => {
  assertCustomerFacingMessage(message);
  if (unsupportedProductClaim.test(message)) throw new AIServiceError('INVALID_AI_RESPONSE', 'La respuesta AI contiene una afirmación de producto no respaldada.', 502);
  const skinClaim = message.match(positiveSkinTypeClaim);
  if (skinClaim) {
    const requestedType = skinClaim[2].toUpperCase() === 'GRASA' ? 'OILY' : skinClaim[2].toUpperCase() === 'SECA' ? 'DRY' : skinClaim[2].toUpperCase() === 'MIXTA' ? 'COMBINATION' : 'NORMAL';
    for (const product of products) {
      if (!Array.isArray(product.suitableSkinTypes) || !product.suitableSkinTypes.includes(requestedType)) throw new AIServiceError('INVALID_AI_RESPONSE', 'La respuesta AI contiene una afirmación de compatibilidad no respaldada.', 502);
    }
  }
  for (const [pattern, target] of targetClaims) {
    if (targetClaimPrefix.test(message) && pattern.test(message) && products.some((product) => !Array.isArray(product.targets) || !product.targets.includes(target))) {
      throw new AIServiceError('INVALID_AI_RESPONSE', 'La respuesta AI contiene una afirmación de objetivo no respaldada.', 502);
    }
  }
  return message;
};

const followUp = (interpretation, message) => ({ intent: interpretation.intent, mode: 'FOLLOW_UP', message, profile: interpretation.profile, recommendations: [] });

const createProductInfoService = ({ resolver, finalProductRepository } = {}) => ({
  supports(intent) { return intent === 'PRODUCT_INFO'; },

  async handle({ request, interpretation, provider, resolvedProducts = null, turnPlan = null, conversationState = null }) {
    let products = resolvedProducts;
    const authoritative = Array.isArray(resolvedProducts);
    if (!authoritative) {
      const references = interpretation.productReferences || interpretation.referencePhrases || [];
      const resolved = await resolver.resolveReferences(references, { max: 3 });
      if (resolved.status === 'AMBIGUOUS') return followUp(interpretation, '¿Puedes indicarme el nombre más completo o el identificador del producto?');
      if (resolved.status !== 'RESOLVED') return followUp(interpretation, 'No pude identificar con seguridad ese producto en Nari. ¿Puedes compartir su nombre completo?');
      const ids = resolved.products.map((product) => String(product.id));
      const rows = await finalProductRepository.findCurrentEligibleProducts(ids);
      products = resolved.products.filter((product) => rows.some((row) => String(row.id) === String(product.id) && isRecommendationEligibleProduct(row)));
      if (!products.length) return { intent: interpretation.intent, mode: 'ANSWER', message: 'Ese producto no está disponible para compra en este momento, pero puedo ayudarte con información general sobre su lugar en una rutina.', profile: interpretation.profile, recommendations: [] };
    }
    if (!products.length) return followUp(interpretation, '¿Puedes indicarme qué producto quieres consultar?');
    if (typeof provider.reasonProductInfo !== 'function') throw new AIServiceError('AI_UNAVAILABLE', 'El servicio AI no está disponible.', 503);
    const evidence = products.map(toProductInfoEvidence);
    const output = await provider.reasonProductInfo({ request, interpretation, turnPlan, conversationState, evidence, products: products.map((product) => toProviderCandidate({ productId: product.id, metadata: product })) });
    if (!output || typeof output !== 'object' || !['ANSWER', 'RECOMMENDATION'].includes(output.mode) || typeof output.message !== 'string' || !output.message.trim()) throw new AIServiceError('INVALID_AI_RESPONSE', 'La respuesta AI de información de producto no es válida.', 502);
    const message = assertProductInfoMessage(output.message.trim(), products);
    if (output.mode === 'RECOMMENDATION' && conversationState?.profile?.skinType && products.some((product) => Array.isArray(product.suitableSkinTypes) && product.suitableSkinTypes.length > 0 && !product.suitableSkinTypes.includes(conversationState.profile.skinType))) {
      throw new AIServiceError('INVALID_AI_RESPONSE', 'La respuesta AI recomienda un producto incompatible con el perfil validado.', 502);
    }
    const purchasable = products.filter(isRecommendationEligibleProduct);
    const shouldRenderCards = output.mode === 'RECOMMENDATION' && purchasable.length === products.length;
    return { intent: interpretation.intent, mode: shouldRenderCards ? 'RECOMMENDATION' : 'ANSWER', message, profile: interpretation.profile, recommendations: shouldRenderCards ? toPublicRecommendations({ selectedProducts: purchasable, reasons: purchasable.map((product) => ({ productId: product.id, reason: 'Información basada en los datos públicos disponibles de Nari.' })) }) : [] };
  },
});

module.exports = { createProductInfoService, toProductInfoEvidence, assertProductInfoMessage };
