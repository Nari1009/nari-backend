const assert = require('node:assert/strict');
const test = require('node:test');
const { createAIService } = require('../src/services/ai/aiService');
const { createProductInfoService } = require('../src/services/ai/productInfoService');
const { validateRequest } = require('../src/services/ai/contract');

const profile = { skinType: 'OILY', conditions: [], targets: [], budget: null, routinePreference: 'simple', knownProducts: [], unresolvedOwnedProducts: [], ownedRoutineSteps: [] };
const product = { id: 'p-moist', name: 'Hidratante de prueba', slug: 'hidratante-de-prueba', price: 100, images: '[]', routineStep: 'MOISTURIZER', catalogRole: 'CATALOG', status: 'active', stock: 4, suitableSkinTypes: ['OILY'], suitableConditions: [], targets: [] };

test('bounded recommendation context accepts IDs and keeps commercial fields out of the request contract', () => {
  const request = validateRequest({ message: '¿y el hidratante?', history: [], context: { recentRecommendations: [{ productId: 'p-moist', routineStep: 'MOISTURIZER' }], recentRoutine: [{ productId: 'p-moist', routineStep: 'MOISTURIZER' }] } });
  assert.deepEqual(request.context.recentRecommendations, [{ productId: 'p-moist', routineStep: 'MOISTURIZER' }]);
  assert.throws(() => validateRequest({ message: 'x', context: { recentRecommendations: [{ productId: 'p-moist', price: 100 }] } }));
});

test('Backend revalidates recent product references before interpretation', async () => {
  let received;
  const provider = {
    async interpretConversation(input) {
      received = input.conversationContext;
      return { intent: 'PRODUCT_INFO', mode: 'ANSWER', nextAction: 'ANSWER', scope: 'IN_SCOPE', requestedRoutineStep: null, message: 'Puedo ayudarte con ese producto.', profile, productReferences: ['p-moist'] };
    },
    async reasonProductInfo() { return { mode: 'ANSWER', message: 'Es una opción para el paso de hidratación.' }; },
  };
  const finalProductRepository = { async findCurrentEligibleProducts(ids) { return ids.includes('p-moist') ? [product] : []; } };
  const service = createAIService({ provider, finalProductRepository, productInfoService: createProductInfoService({ resolver: { async resolveReferences() { return { status: 'RESOLVED', products: [product] }; } }, finalProductRepository }) });
  const result = await service.advise({ message: '¿y el hidratante que me recomendaste es bueno?', history: [], context: { recentRecommendations: [{ productId: 'p-moist', routineStep: 'MOISTURIZER' }] } });
  assert.equal(received.recentRecommendations[0].name, product.name);
  assert.equal(result.intent, 'PRODUCT_INFO');
  assert.equal(result.recommendations.length, 0);
});

test('product info resolves an unambiguous reference without trusting a product name from the client', async () => {
  let askedProducts;
  const resolver = { async resolveReferences() { return { status: 'RESOLVED', products: [product] }; } };
  const finalProductRepository = { async findCurrentEligibleProducts() { return [product]; } };
  const service = createProductInfoService({ resolver, finalProductRepository });
  const result = await service.handle({ request: { message: '¿para qué sirve?', history: [] }, interpretation: { intent: 'PRODUCT_INFO', profile, productReferences: ['nombre escrito por el usuario'] }, provider: { async reasonProductInfo(input) { askedProducts = input.products; return { mode: 'ANSWER', message: 'Puede formar parte de una rutina de hidratación.' }; } } });
  assert.deepEqual(askedProducts, [{ id: 'p-moist', name: product.name, routineStep: 'MOISTURIZER', sizeLabel: null, suitableSkinTypes: ['OILY'], suitableConditions: [], targets: [] }]);
  assert.match(result.message, /hidratación/i);
});
