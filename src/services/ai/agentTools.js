const { AI_LIMITS, BASE_SKIN_TYPES, SKIN_CONDITIONS, CONCERN_GOALS } = require('./constants');
const { validateProfile } = require('./contract');
const { AIServiceError } = require('./errors');
const { isRecommendationEligibleProduct } = require('./candidates/catalogEligibility');
const { toProviderCandidates } = require('./candidates/candidateProviderProjection');
const { toPublicRecommendationProduct } = require('./recommendationProjection');
const { toProductInfoEvidence } = require('./productInfoService');

const MAX_TOOL_RESULTS = 8;
const MAX_TOOL_PRODUCT_IDS = 8;
const TOOL_MODES = ['DISCOVERY', 'RECOMMENDATION', 'ALTERNATIVE'];
const TOOL_STEPS = ['CLEANSER', 'MOISTURIZER', 'SUNSCREEN', 'SERUM', 'TONER', 'ESSENCE', 'EYE_CARE', 'FIRST_CLEANSE'];
const fail = (message) => { throw new AIServiceError('AGENT_TOOL_INVALID', message, 502); };

const exactObject = (value, allowed, field) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !allowed.includes(key))) fail(`${field} no es válido.`);
};

const boundedIds = (value, field, max = MAX_TOOL_PRODUCT_IDS) => {
  if (!Array.isArray(value) || value.length > max || value.some((id) => typeof id !== 'string' || !id.trim() || id.trim().length > AI_LIMITS.contextProductId)) fail(`${field} no es válido.`);
  return [...new Set(value.map((id) => id.trim()))];
};

const boundedSteps = (value, field) => {
  if (!Array.isArray(value) || value.length > TOOL_STEPS.length || value.some((step) => typeof step !== 'string' || !TOOL_STEPS.includes(step))) fail(`${field} no es válido.`);
  return [...new Set(value)];
};

const optionalCanonicalList = (value, allowed, field) => {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length > 20 || value.some((item) => typeof item !== 'string' || !allowed.includes(item))) fail(`${field} no es válido.`);
  return [...new Set(value)];
};

const inputProfile = (value, stateProfile = {}) => {
  const base = {
    skinType: stateProfile.skinType ?? null,
    conditions: stateProfile.conditions ?? null,
    targets: stateProfile.targets ?? null,
    budget: stateProfile.budget ?? null,
    routinePreference: stateProfile.routinePreference ?? null,
    knownProducts: [],
    unresolvedOwnedProducts: [],
    ownedRoutineSteps: [],
  };
  if (value !== undefined && value !== null) {
    exactObject(value, ['skinType', 'conditions', 'targets', 'budget', 'routinePreference'], 'profile');
    Object.assign(base, value);
  }
  return validateProfile(base);
};

const safeCandidate = (candidate) => {
  const product = candidate.metadata || {};
  return {
    id: String(product.id ?? candidate.productId),
    name: product.name ?? null,
    brand: product.brand ?? null,
    routineStep: product.routineStep ?? null,
    sizeLabel: product.sizeLabel ?? null,
    suitableSkinTypes: product.suitableSkinTypes === undefined ? null : product.suitableSkinTypes,
    suitableConditions: product.suitableConditions === undefined ? null : product.suitableConditions,
    targets: product.targets === undefined ? null : product.targets,
    availability: { purchasable: true },
    product: toPublicRecommendationProduct(product),
  };

};

const createAgentToolFacade = ({ candidateService, catalogDiscoveryService, productResolver } = {}) => {
  if (!candidateService || !catalogDiscoveryService || !productResolver) throw new TypeError('Los servicios de herramientas AI son obligatorios.');

  const resolveCanonicalIds = async (ids) => {
    const products = [];
    for (const id of ids) {
      const result = await productResolver.resolveReferences([id], { max: 1 });
      if (result.status !== 'RESOLVED' || result.products.length !== 1) fail('Una referencia de Product no pudo revalidarse.');
      products.push(result.products[0]);
    }
    return products;
  };

  const searchCatalog = async (raw, { state } = {}) => {
    exactObject(raw, ['mode', 'routineSteps', 'skinTypes', 'conditions', 'targets', 'limit', 'referenceProductIds', 'profile', 'brand'], 'search_catalog');
    if (!TOOL_MODES.includes(raw.mode)) fail('El modo de búsqueda no es válido.');
    const routineSteps = boundedSteps(raw.routineSteps || [], 'routineSteps');
    const skinTypes = optionalCanonicalList(raw.skinTypes, BASE_SKIN_TYPES, 'skinTypes');
    const conditions = optionalCanonicalList(raw.conditions, SKIN_CONDITIONS, 'conditions');
    const targets = optionalCanonicalList(raw.targets, CONCERN_GOALS, 'targets');
    const referenceProductIds = boundedIds(raw.referenceProductIds || [], 'referenceProductIds');
    const limit = raw.limit === undefined ? 5 : Number(raw.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_TOOL_RESULTS) fail('El límite de búsqueda no es válido.');
    const references = await resolveCanonicalIds(referenceProductIds);
    const profile = inputProfile(raw.profile, state?.profile);
    if (skinTypes?.length === 1) profile.skinType = skinTypes[0];
    if (conditions !== null) profile.conditions = conditions;
    if (targets !== null) profile.targets = targets;
    const exclusionByStep = new Map();
    for (const product of references) {
      if (!product.routineStep) continue;
      if (routineSteps.length && !routineSteps.includes(product.routineStep)) continue;
      const ids = exclusionByStep.get(product.routineStep) || [];
      ids.push(String(product.id));
      exclusionByStep.set(product.routineStep, ids);
    }
    const exclusions = referenceProductIds.filter((id) => !routineSteps.length || references.some((product) => String(product.id) === id && (!product.routineStep || routineSteps.includes(product.routineStep))));
    if (raw.mode === 'DISCOVERY') {
      const result = await catalogDiscoveryService.discover({
        intent: 'DISCOVERY',
        profile,
        criteria: { routineSteps, brand: raw.brand || null, skinTypes, conditions, targets, useProfile: false, browseScope: routineSteps.length || raw.brand || skinTypes || conditions || targets ? 'FILTERED' : 'BROAD' },
      });
      const recommendations = result.recommendations.slice(0, limit);
      const products = recommendations.map((item) => ({
        ...item.product,
        product: item.product,
        availability: { purchasable: true },
      }));
      return { tool: 'search_catalog', mode: raw.mode, products, recommendations, referenceProductIds, excludedProductIds: [], resultCount: Math.min(result.catalogProducts.length, limit), missingSteps: [] };
    }
    const groups = {};
    const all = [];
    const search = async (step) => {
      const result = await candidateService.search({ intent: 'PRODUCT_SELECTION', profile, requestedRoutineStep: step || null, excludeProductIds: step ? (exclusionByStep.get(step) || []) : exclusions });
      const candidates = result.candidates.filter((candidate) => {
        const product = candidate.metadata || {};
        return isRecommendationEligibleProduct(product)
          && (!step || product.routineStep === step)
          && !exclusions.includes(String(candidate.productId));
      }).slice(0, limit);
      groups[step || '__general'] = candidates;
      all.push(...candidates);
    };
    if (routineSteps.length) for (const step of routineSteps) await search(step);
    else await search(null);
    const unique = [...new Map(all.map((candidate) => [String(candidate.productId), candidate])).values()].slice(0, limit);
    return {
      tool: 'search_catalog',
      mode: raw.mode,
      products: unique.map(safeCandidate),
      candidateGroups: Object.fromEntries(Object.entries(groups).map(([step, candidates]) => [step, candidates.map(safeCandidate)])),
      referenceProductIds,
      excludedProductIds: exclusions,
      resultCount: unique.length,
      missingSteps: routineSteps.filter((step) => !(groups[step] || []).length),
    };
  };

  const getProductInformation = async (raw) => {
    exactObject(raw, ['productIds', 'productQuery'], 'get_product_information');
    const ids = boundedIds(raw.productIds || [], 'productIds', 3);
    if (ids.length && raw.productQuery) fail('No se pueden mezclar IDs y búsqueda textual.');
    let products;
    if (ids.length) products = await resolveCanonicalIds(ids);
    else if (typeof raw.productQuery === 'string' && raw.productQuery.trim()) {
      const result = await productResolver.resolveReferences([raw.productQuery.trim()], { max: 1 });
      if (result.status !== 'RESOLVED' || result.products.length !== 1) fail('La referencia textual no pudo resolverse de forma unívoca.');
      products = result.products;
    } else fail('Se requiere un Product ID o una referencia textual.');
    return {
      tool: 'get_product_information',
      products: products.map((product) => ({ ...toProductInfoEvidence(product), product: toPublicRecommendationProduct(product) })),
      resultCount: products.length,
    };
  };

  return {
    definitions: [
      { type: 'function', name: 'search_catalog', description: 'Busca Products reales de NARI para descubrir, recomendar o encontrar alternativas.', parameters: { type: 'object', additionalProperties: false, properties: { mode: { type: 'string', enum: TOOL_MODES }, routineSteps: { type: 'array', items: { type: 'string', enum: TOOL_STEPS }, maxItems: TOOL_STEPS.length }, skinTypes: { anyOf: [{ type: 'array', items: { type: 'string', enum: BASE_SKIN_TYPES }, maxItems: 4 }, { type: 'null' }] }, conditions: { anyOf: [{ type: 'array', items: { type: 'string', enum: SKIN_CONDITIONS }, maxItems: 20 }, { type: 'null' }] }, targets: { anyOf: [{ type: 'array', items: { type: 'string', enum: CONCERN_GOALS }, maxItems: 20 }, { type: 'null' }] }, limit: { type: 'integer', minimum: 1, maximum: MAX_TOOL_RESULTS }, referenceProductIds: { type: 'array', items: { type: 'string', maxLength: AI_LIMITS.contextProductId }, maxItems: MAX_TOOL_PRODUCT_IDS }, profile: { anyOf: [{ type: 'object', additionalProperties: false, properties: { skinType: { anyOf: [{ type: 'string', enum: BASE_SKIN_TYPES }, { type: 'null' }] }, conditions: { anyOf: [{ type: 'array', items: { type: 'string', enum: SKIN_CONDITIONS } }, { type: 'null' }] }, targets: { anyOf: [{ type: 'array', items: { type: 'string', enum: CONCERN_GOALS } }, { type: 'null' }] }, budget: { anyOf: [{ type: 'string', maxLength: 200 }, { type: 'null' }] }, routinePreference: { anyOf: [{ type: 'string', maxLength: 200 }, { type: 'null' }] } }, required: ['skinType', 'conditions', 'targets', 'budget', 'routinePreference'] }, { type: 'null' }] }, brand: { anyOf: [{ type: 'string', maxLength: 120 }, { type: 'null' }] } }, required: ['mode', 'routineSteps', 'skinTypes', 'conditions', 'targets', 'limit', 'referenceProductIds', 'profile', 'brand'] } },
      { type: 'function', name: 'get_product_information', description: 'Obtiene información canónica de Products de NARI ya identificados o de una referencia textual inequívoca.', parameters: { type: 'object', additionalProperties: false, properties: { productIds: { type: 'array', items: { type: 'string', maxLength: AI_LIMITS.contextProductId }, maxItems: 3 }, productQuery: { anyOf: [{ type: 'string', maxLength: AI_LIMITS.productReference }, { type: 'null' }] } }, required: ['productIds', 'productQuery'] } },
    ],
    async execute(name, args, context) {
      if (name === 'search_catalog') return searchCatalog(args, context);
      if (name === 'get_product_information') return getProductInformation(args, context);
      fail('La herramienta solicitada no existe.');
    },
  };
};

module.exports = { MAX_TOOL_RESULTS, createAgentToolFacade };
