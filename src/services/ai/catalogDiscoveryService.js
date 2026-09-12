const { primaryImage, toPublicRecommendations } = require('./recommendationProjection');
const { customerRoutineStepLabel } = require('./routines/customerLabels');

const MAX_DISCOVERY_PRODUCTS = 12;
const normalize = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const includesCanonical = (values, requested) => Array.isArray(values) && requested.every((item) => values.includes(item));

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
  async discover({ intent, profile, requestedRoutineStep = null, criteria = {}, turnPlan = null } = {}) {
    const routineSteps = criteria.routineSteps?.length ? criteria.routineSteps : (requestedRoutineStep ? [requestedRoutineStep] : []);
    const explicitSkinTypes = criteria.useProfile && criteria.skinTypes === null && profile?.skinType ? [profile.skinType] : (criteria.skinTypes || []);
    const explicitConditions = criteria.useProfile && criteria.conditions === null && Array.isArray(profile?.conditions) ? profile.conditions : (criteria.conditions || []);
    const explicitTargets = criteria.useProfile && criteria.targets === null && Array.isArray(profile?.targets) ? profile.targets : (criteria.targets || []);
    const requestedBrand = criteria.brand || null;
    const needsPostQueryFiltering = explicitSkinTypes.length || explicitConditions.length || explicitTargets.length || routineSteps.length > 1;
    const products = await repository.findPublicCatalogProducts({ routineStep: routineSteps.length === 1 ? routineSteps[0] : null, brand: requestedBrand, limit: needsPostQueryFiltering ? 100 : MAX_DISCOVERY_PRODUCTS });
    const filtered = products.filter((product) => {
      if (routineSteps.length && !routineSteps.includes(product.routineStep)) return false;
      if (requestedBrand && !normalize(product.brand).includes(normalize(requestedBrand))) return false;
      if (explicitSkinTypes.length && !includesCanonical(product.suitableSkinTypes, explicitSkinTypes)) return false;
      if (explicitConditions.length && !includesCanonical(product.suitableConditions, explicitConditions)) return false;
      if (explicitTargets.length && !includesCanonical(product.targets, explicitTargets)) return false;
      return Number(product.stock) > 0 && product.status === 'active' && product.catalogRole !== 'DEV_FIXTURE';
    }).sort((left, right) => normalize(left.name).localeCompare(normalize(right.name)) || String(left.id).localeCompare(String(right.id))).slice(0, MAX_DISCOVERY_PRODUCTS);
    const categoryText = routineSteps.length === 1 ? customerRoutineStepLabel(routineSteps[0]) : 'productos de skincare';
    const message = filtered.length
      ? routineSteps.length === 1
        ? `En Nari encontré ${filtered.length} opciones de ${categoryText}.`
        : `En Nari encontré ${filtered.length} opciones de skincare para explorar.`
      : routineSteps.length === 1
        ? `En este momento no encontré opciones públicas de ${categoryText} en Nari.`
        : 'En este momento no encontré productos públicos disponibles para explorar en Nari.';
    const catalogProducts = filtered.map(toCatalogProduct);
    return {
      intent: intent || 'DISCOVERY',
      mode: 'ANSWER',
      message,
      profile,
      catalogProducts,
      recommendations: toPublicRecommendations({ selectedProducts: filtered }),
      __referenceArtifacts: filtered.slice(0, 8).map((product) => ({ productId: String(product.id), routineStep: product.routineStep || null })),
      __discoveryOutcome: { filterCount: [routineSteps.length, requestedBrand, explicitSkinTypes.length, explicitConditions.length, explicitTargets.length].filter(Boolean).length, routineStepFilter: routineSteps.length ? routineSteps : [], brandFilterPresent: Boolean(requestedBrand), skinFilterCount: explicitSkinTypes.length, conditionFilterCount: explicitConditions.length, targetFilterCount: explicitTargets.length, eligibleRowsBeforeFilters: products.length, resultCount: filtered.length, emptyResult: filtered.length === 0, turnPlanAction: turnPlan?.action || 'CATALOG_DISCOVERY' },
    };
  },
});

module.exports = { MAX_DISCOVERY_PRODUCTS, createCatalogDiscoveryService, toCatalogProduct };
