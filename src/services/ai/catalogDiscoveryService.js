const { primaryImage, toPublicRecommendations } = require('./recommendationProjection');
const { customerRoutineStepLabel } = require('./routines/customerLabels');
const { parseBudget, budgetRank } = require('./budget');

const MAX_DISCOVERY_PRODUCTS = 12;
const normalize = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const includesCanonical = (values, requested) => Array.isArray(values) && requested.every((item) => values.includes(item));
const overlapsCanonical = (values, requested) => Array.isArray(values) && requested.some((item) => values.includes(item));

const relaxedScore = (product, { explicitSkinTypes, explicitConditions, explicitTargets }) => {
  let score = 0;
  const matchedCriteria = [];
  const unknownCriteria = [];
  if (explicitSkinTypes.length) {
    if (Array.isArray(product.suitableSkinTypes) && product.suitableSkinTypes.length) {
      if (!overlapsCanonical(product.suitableSkinTypes, explicitSkinTypes)) return null;
      score += 30;
      matchedCriteria.push('SKIN_TYPE');
    } else unknownCriteria.push('SKIN_TYPE');
  }
  if (explicitConditions.length) {
    if (Array.isArray(product.suitableConditions) && product.suitableConditions.length && overlapsCanonical(product.suitableConditions, explicitConditions)) {
      score += 10;
      matchedCriteria.push('CONDITION');
    } else if (!Array.isArray(product.suitableConditions)) unknownCriteria.push('CONDITION');
  }
  if (explicitTargets.length) {
    if (Array.isArray(product.targets) && product.targets.length && overlapsCanonical(product.targets, explicitTargets)) {
      score += 10;
      matchedCriteria.push('TARGET');
    } else if (!Array.isArray(product.targets)) unknownCriteria.push('TARGET');
  }
  return { score, matchedCriteria, unknownCriteria };
};

const compareByBudget = (budget) => (left, right) => budgetRank(left.price, budget) - budgetRank(right.price, budget)
  || normalize(left.name).localeCompare(normalize(right.name))
  || String(left.id).localeCompare(String(right.id));

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
    const budget = parseBudget(profile?.budget);
    const requestedBrand = criteria.brand || null;
    const needsPostQueryFiltering = explicitSkinTypes.length || explicitConditions.length || explicitTargets.length || routineSteps.length > 1;
    const products = await repository.findPublicCatalogProducts({ routineStep: routineSteps.length === 1 ? routineSteps[0] : null, brand: requestedBrand, limit: needsPostQueryFiltering ? 100 : MAX_DISCOVERY_PRODUCTS });
    const exactFiltered = products.filter((product) => {
      if (routineSteps.length && !routineSteps.includes(product.routineStep)) return false;
      if (requestedBrand && !normalize(product.brand).includes(normalize(requestedBrand))) return false;
      if (explicitSkinTypes.length && !includesCanonical(product.suitableSkinTypes, explicitSkinTypes)) return false;
      if (explicitConditions.length && !includesCanonical(product.suitableConditions, explicitConditions)) return false;
      if (explicitTargets.length && !includesCanonical(product.targets, explicitTargets)) return false;
      return Number(product.stock) > 0 && product.status === 'active' && product.catalogRole !== 'DEV_FIXTURE';
    }).sort(compareByBudget(budget)).slice(0, MAX_DISCOVERY_PRODUCTS);
    let filtered = exactFiltered;
    let searchQuality = 'EXACT';
    if (!filtered.length && (explicitSkinTypes.length || explicitConditions.length || explicitTargets.length)) {
      const relaxed = products
        .filter((product) => {
          if (routineSteps.length && !routineSteps.includes(product.routineStep)) return false;
          if (requestedBrand && !normalize(product.brand).includes(normalize(requestedBrand))) return false;
          return Number(product.stock) > 0 && product.status === 'active' && product.catalogRole !== 'DEV_FIXTURE';
        })
        .map((product) => ({ product, match: relaxedScore(product, { explicitSkinTypes, explicitConditions, explicitTargets }) }))
        .filter((item) => item.match && (item.match.score > 0 || item.match.unknownCriteria.length > 0))
        .sort((left, right) => right.match.score - left.match.score
          || left.match.unknownCriteria.length - right.match.unknownCriteria.length
          || budgetRank(left.product.price, budget) - budgetRank(right.product.price, budget)
          || normalize(left.product.name).localeCompare(normalize(right.product.name))
          || String(left.product.id).localeCompare(String(right.product.id)))
        .map((item) => item.product)
        .slice(0, MAX_DISCOVERY_PRODUCTS);
      if (relaxed.length) {
        filtered = relaxed;
        searchQuality = 'RELAXED';
      }
    }
    const categoryText = routineSteps.length === 1 ? customerRoutineStepLabel(routineSteps[0]) : 'productos de skincare';
    const message = filtered.length
      ? searchQuality === 'RELAXED'
        ? `No encontré una coincidencia exacta; te muestro opciones disponibles de ${categoryText} con información parcial para que las revises.`
        : routineSteps.length === 1
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
      budget,
      __referenceArtifacts: filtered.slice(0, 8).map((product) => ({ productId: String(product.id), routineStep: product.routineStep || null })),
      searchQuality,
      __conversationDelta: !filtered.length && requestedBrand ? {
        activeIntent: 'ALTERNATIVE_SEARCH',
        pendingAction: 'CONFIRM_ALTERNATIVE',
        pendingQuestion: '¿Quieres que busque alternativas disponibles de NARI?',
        pendingAlternative: { routineSteps, excludedProductIds: [], targets: explicitTargets, conditions: explicitConditions, skinTypes: explicitSkinTypes },
      } : null,
      __discoveryOutcome: { filterCount: [routineSteps.length, requestedBrand, explicitSkinTypes.length, explicitConditions.length, explicitTargets.length].filter(Boolean).length, routineStepFilter: routineSteps.length ? routineSteps : [], brandFilterPresent: Boolean(requestedBrand), skinFilterCount: explicitSkinTypes.length, conditionFilterCount: explicitConditions.length, targetFilterCount: explicitTargets.length, eligibleRowsBeforeFilters: products.length, resultCount: filtered.length, emptyResult: filtered.length === 0, turnPlanAction: turnPlan?.action || 'CATALOG_DISCOVERY' },
    };
  },
});

module.exports = { MAX_DISCOVERY_PRODUCTS, createCatalogDiscoveryService, toCatalogProduct };
