const { primaryImage, toPublicRecommendations } = require('./recommendationProjection');
const { customerRoutineStepLabel } = require('./routines/customerLabels');

const MAX_DISCOVERY_PRODUCTS = 12;

const toCatalogProduct = (product) => ({
  id: product.id,
  name: product.name,
  price: product.price ?? null,
  image: primaryImage(product.images),
  slug: product.slug,
  category: product.routineStep ? customerRoutineStepLabel(product.routineStep) : null,
  sizeLabel: product.sizeLabel ?? null,
  available: Number(product.stock) > 0,
});

const createCatalogDiscoveryService = ({ repository } = {}) => ({
  async discover({ intent, profile, requestedRoutineStep = null } = {}) {
    const products = await repository.findPublicCatalogProducts({ routineStep: requestedRoutineStep, limit: MAX_DISCOVERY_PRODUCTS });
    const categoryText = requestedRoutineStep ? customerRoutineStepLabel(requestedRoutineStep) : 'productos de skincare';
    const message = products.length
      ? requestedRoutineStep
        ? `En Nari encontré ${products.length} opciones de ${categoryText}.`
        : `En Nari encontré ${products.length} opciones de skincare para explorar.`
      : requestedRoutineStep
        ? `En este momento no encontré opciones públicas de ${categoryText} en Nari.`
        : 'En este momento no encontré productos públicos disponibles para explorar en Nari.';
    const catalogProducts = products.map(toCatalogProduct);
    return {
      intent: intent || 'DISCOVERY',
      mode: 'ANSWER',
      message,
      profile,
      catalogProducts,
      recommendations: toPublicRecommendations({ selectedProducts: products }),
    };
  },
});

module.exports = { MAX_DISCOVERY_PRODUCTS, createCatalogDiscoveryService, toCatalogProduct };
