const { primaryImage, toPublicRecommendations } = require('./recommendationProjection');
const { customerRoutineStepLabel } = require('./routines/customerLabels');
const { parseBudget, budgetRank } = require('./budget');
const { isRecommendationEligibleProduct } = require('./candidates/catalogEligibility');
const { METADATA_MATCH, canonical, metadataListMatch } = require('./catalogMetadata');

const MAX_DISCOVERY_PRODUCTS = 12;
const normalize = (value) => canonical(value).toLowerCase();
const ROUTINE_TERMS = Object.freeze({
  MOISTURIZER: ['moisturizer', 'cream', 'crema', 'hidratante', 'lotion', 'locion', 'emulsion'],
  SERUM: ['serum', 'ampoule', 'ampolla', 'essence', 'esencia'],
  CLEANSER: ['cleanser', 'limpiador', 'cleansing', 'cleaning'],
  SUNSCREEN: ['sunscreen', 'sun serum', 'protector solar', 'spf'],
  TONER: ['toner', 'tonico'],
  ESSENCE: ['essence', 'esencia'],
});

const productText = (product) => normalize([product.brand, product.name, product.category, product.description].filter(Boolean).join(' '));
const hasRoutineTextSignal = (product, routineStep) => (ROUTINE_TERMS[routineStep] || []).some((term) => productText(product).includes(normalize(term)));
const isCommerciallyEligible = (product) => isRecommendationEligibleProduct(product) && product.catalogRole !== 'DEV_FIXTURE';

const relaxedScore = (product, { routineSteps, explicitSkinTypes, explicitConditions, explicitTargets }) => {
  let score = 0;
  const matchedCriteria = [];
  const unknownCriteria = [];
  let textEvidence = false;

  if (routineSteps.length) {
    const routineStep = routineSteps[0];
    if (product.routineStep === routineStep) {
      score += 40;
      matchedCriteria.push('ROUTINE_STEP');
    } else if (product.routineStep === null || product.routineStep === undefined || product.routineStep === '') {
      if (hasRoutineTextSignal(product, routineStep)) {
        score += 18;
        matchedCriteria.push('ROUTINE_TEXT');
        textEvidence = true;
      } else {
        score -= 2;
        unknownCriteria.push('ROUTINE_STEP');
      }
    } else return null;
  }
  if (explicitSkinTypes.length) {
    const status = metadataListMatch(product.suitableSkinTypes, explicitSkinTypes);
    if (status === METADATA_MATCH.NO_MATCH) return null;
    if (status === METADATA_MATCH.MATCH) { score += 30; matchedCriteria.push('SKIN_TYPE'); }
    else { score -= 2; unknownCriteria.push('SKIN_TYPE'); }
  }
  if (explicitConditions.length) {
    const status = metadataListMatch(product.suitableConditions, explicitConditions);
    if (status === METADATA_MATCH.MATCH) { score += 10; matchedCriteria.push('CONDITION'); }
    else if (status === METADATA_MATCH.UNKNOWN) { score -= 2; unknownCriteria.push('CONDITION'); }
  }
  if (explicitTargets.length) {
    const status = metadataListMatch(product.targets, explicitTargets);
    if (status === METADATA_MATCH.MATCH) { score += 10; matchedCriteria.push('TARGET'); }
    else if (status === METADATA_MATCH.UNKNOWN) { score -= 2; unknownCriteria.push('TARGET'); }
  }
  return { score, matchedCriteria, unknownCriteria, textEvidence };
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
  category: product.category || (product.routineStep ? customerRoutineStepLabel(product.routineStep) : null),
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
      if (explicitSkinTypes.length && metadataListMatch(product.suitableSkinTypes, explicitSkinTypes, { mode: 'ALL' }) !== METADATA_MATCH.MATCH) return false;
      if (explicitConditions.length && metadataListMatch(product.suitableConditions, explicitConditions, { mode: 'ALL' }) !== METADATA_MATCH.MATCH) return false;
      if (explicitTargets.length && metadataListMatch(product.targets, explicitTargets, { mode: 'ALL' }) !== METADATA_MATCH.MATCH) return false;
      return isCommerciallyEligible(product);
    }).sort(compareByBudget(budget)).slice(0, MAX_DISCOVERY_PRODUCTS);

    let filtered = exactFiltered;
    let searchQuality = 'EXACT';
    if (!filtered.length && (explicitSkinTypes.length || explicitConditions.length || explicitTargets.length || routineSteps.length)) {
      const relaxed = products
        .filter((product) => !requestedBrand || normalize(product.brand).includes(normalize(requestedBrand)))
        .filter(isCommerciallyEligible)
        .map((product) => ({ product, match: relaxedScore(product, { routineSteps, explicitSkinTypes, explicitConditions, explicitTargets }) }))
        .filter((item) => item.match && item.match.score >= 10)
        .sort((left, right) => right.match.score - left.match.score
          || left.match.unknownCriteria.length - right.match.unknownCriteria.length
          || budgetRank(left.product.price, budget) - budgetRank(right.product.price, budget)
          || normalize(left.product.name).localeCompare(normalize(right.product.name))
          || String(left.product.id).localeCompare(String(right.product.id)))
        .map((item) => item.product)
        .slice(0, MAX_DISCOVERY_PRODUCTS);
      if (relaxed.length) {
        filtered = relaxed;
        searchQuality = relaxed.some((product) => product.routineStep === null || product.routineStep === undefined) ? 'INFERRED' : 'RELAXED';
      }
    }

    const categoryText = routineSteps.length === 1 ? customerRoutineStepLabel(routineSteps[0]) : 'productos de skincare';
    const message = filtered.length
      ? searchQuality === 'INFERRED'
        ? `Encontré opciones disponibles de ${categoryText} que parecen relevantes por su información comercial; revisemos sus detalles antes de elegir.`
        : searchQuality === 'RELAXED'
          ? `No encontré una coincidencia exacta; te muestro opciones disponibles de ${categoryText} con información parcial para que las revises.`
          : routineSteps.length === 1 ? `En Nari encontré ${filtered.length} opciones de ${categoryText}.` : `En Nari encontré ${filtered.length} opciones de skincare para explorar.`
      : routineSteps.length === 1 ? `En este momento no encontré opciones públicas de ${categoryText} en Nari.` : 'En este momento no encontré productos públicos disponibles para explorar en Nari.';
    const catalogProducts = filtered.map(toCatalogProduct);
    return {
      intent: intent || 'DISCOVERY', mode: 'ANSWER', message, profile, catalogProducts,
      recommendations: toPublicRecommendations({ selectedProducts: filtered }), budget,
      __referenceArtifacts: filtered.slice(0, 8).map((product) => ({ productId: String(product.id), routineStep: product.routineStep || null })),
      searchQuality,
      __conversationDelta: !filtered.length && requestedBrand ? {
        activeIntent: 'ALTERNATIVE_SEARCH', pendingAction: 'CONFIRM_ALTERNATIVE', pendingQuestion: '¿Quieres que busque alternativas disponibles de NARI?',
        pendingAlternative: { routineSteps, excludedProductIds: [], targets: explicitTargets, conditions: explicitConditions, skinTypes: explicitSkinTypes },
      } : null,
      __discoveryOutcome: { filterCount: [routineSteps.length, requestedBrand, explicitSkinTypes.length, explicitConditions.length, explicitTargets.length].filter(Boolean).length, routineStepFilter: routineSteps.length ? routineSteps : [], brandFilterPresent: Boolean(requestedBrand), skinFilterCount: explicitSkinTypes.length, conditionFilterCount: explicitConditions.length, targetFilterCount: explicitTargets.length, eligibleRowsBeforeFilters: products.length, resultCount: filtered.length, emptyResult: filtered.length === 0, turnPlanAction: turnPlan?.action || 'CATALOG_DISCOVERY' },
    };
  },
});

module.exports = { MAX_DISCOVERY_PRODUCTS, createCatalogDiscoveryService, toCatalogProduct };
