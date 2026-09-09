const { AIServiceError } = require('./errors');
const { isRecommendationEligibleProduct } = require('./candidates/catalogEligibility');
const { toProviderCandidate } = require('./candidates/candidateProviderProjection');
const { toPublicRecommendations } = require('./recommendationProjection');

const createProductInfoService = ({ resolver, finalProductRepository } = {}) => ({
  supports(intent) { return intent === 'PRODUCT_INFO'; },

  async handle({ request, interpretation, provider }) {
    const references = interpretation.productReferences || [];
    const resolved = await resolver.resolveReferences(references, { max: 3 });
    if (resolved.status === 'AMBIGUOUS') return { intent: interpretation.intent, mode: 'FOLLOW_UP', message: '¿Puedes indicarme el nombre más completo o el identificador del producto?', profile: interpretation.profile, recommendations: [] };
    if (resolved.status !== 'RESOLVED') return { intent: interpretation.intent, mode: 'FOLLOW_UP', message: 'No pude identificar con seguridad ese producto en Nari. ¿Puedes compartir su nombre completo?', profile: interpretation.profile, recommendations: [] };

    const ids = resolved.products.map((product) => String(product.id));
    const rows = await finalProductRepository.findCurrentEligibleProducts(ids);
    const byId = new Map(rows.filter(isRecommendationEligibleProduct).map((product) => [String(product.id), product]));
    const products = resolved.products.filter((product) => byId.has(String(product.id))).map((product) => byId.get(String(product.id)));
    if (!products.length) return { intent: interpretation.intent, mode: 'ANSWER', message: 'Ese producto no está disponible para compra en este momento, pero puedo ayudarte con información general sobre su lugar en una rutina.', profile: interpretation.profile, recommendations: [] };
    if (typeof provider.reasonProductInfo !== 'function') throw new AIServiceError('AI_UNAVAILABLE', 'El servicio AI no está disponible.', 503);
    const output = await provider.reasonProductInfo({ request, interpretation, products: products.map((product) => toProviderCandidate({ productId: product.id, metadata: product })) });
    if (!output || typeof output !== 'object' || !['ANSWER', 'RECOMMENDATION'].includes(output.mode) || typeof output.message !== 'string' || !output.message.trim()) throw new AIServiceError('INVALID_AI_RESPONSE', 'La respuesta AI de información de producto no es válida.', 502);
    return {
      intent: interpretation.intent,
      mode: output.mode,
      message: output.message.trim(),
      profile: interpretation.profile,
      recommendations: output.mode === 'RECOMMENDATION'
        ? toPublicRecommendations({ selectedProducts: products, reasons: products.map((product) => ({ productId: product.id, reason: 'Es una opción disponible de Nari relacionada con lo que preguntaste.' })) })
        : [],
    };
  },
});

module.exports = { createProductInfoService };
