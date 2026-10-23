const { isRecommendationEligibleProduct } = require('./candidates/catalogEligibility');
const { toPublicRecommendationProduct } = require('./recommendationProjection');
const { canonical } = require('./catalogMetadata');

const RESEARCH_STATUS = Object.freeze({
  SUFFICIENT_INTERNAL: 'SUFFICIENT_INTERNAL',
  CACHE_HIT: 'CACHE_HIT',
  RESEARCHED: 'RESEARCHED',
  RESEARCH_REQUIRED: 'RESEARCH_REQUIRED',
  RESEARCH_UNAVAILABLE: 'RESEARCH_UNAVAILABLE',
  REJECTED_SOURCE: 'REJECTED_SOURCE',
  PRODUCT_NOT_ELIGIBLE: 'PRODUCT_NOT_ELIGIBLE',
});

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_EXTRACTOR_VERSION = 'r11-product-research-v1';
const MAX_RESEARCH_CANDIDATES = 1;
const FACT_KEYS = Object.freeze(['routineStep', 'suitableSkinTypes', 'suitableConditions', 'targets', 'ingredients', 'benefits', 'usage', 'variant']);
const identity = (value) => canonical(value).replace(/[^A-Z0-9]+/g, '');

const createMemoryResearchCache = () => {
  const values = new Map();
  return {
    async get(key) { return values.get(key) || null; },
    async set(key, value) { values.set(key, value); },
    async delete(key) { values.delete(key); },
    clear() { values.clear(); },
  };
};

const cacheKeyFor = (product) => [
  product.id,
  identity(product.brand),
  identity(product.name),
  identity(product.slug),
  identity(product.variant || product.sizeLabel),
  JSON.stringify([product.description, product.routineStep, product.suitableSkinTypes, product.suitableConditions, product.targets, product.ingredients, product.benefits, product.howToUse]),
].join(':');
const hasValue = (value) => (Array.isArray(value) ? value.length > 0 : typeof value === 'string' ? Boolean(value.trim()) : value !== null && value !== undefined);

const EVIDENCE_REQUIREMENTS = Object.freeze({
  IDENTITY: [['brand'], ['name']],
  CATEGORY: [['routineStep', 'category', 'description']],
  SKIN_TYPE: [['suitableSkinTypes']],
  NEEDS: [['suitableConditions', 'targets', 'benefits']],
  USAGE: [['usage', 'howToUse']],
  ORDER: [['routineStep']],
  COMPATIBILITY: [['routineStep'], ['ingredients', 'formulaCompatibility']],
  RECOMMENDATION: [['routineStep', 'category', 'description'], ['suitableSkinTypes', 'suitableConditions', 'targets', 'benefits']],
  PRODUCT_INFO: [['routineStep', 'category', 'description'], ['usage', 'howToUse']],
});

const internalEvidence = (product, { needs = 'RECOMMENDATION' } = {}) => {
  const facts = {};
  for (const key of FACT_KEYS) if (hasValue(product[key])) facts[key] = product[key];
  if (hasValue(product.description)) facts.description = product.description;
  const requirements = EVIDENCE_REQUIREMENTS[needs] || EVIDENCE_REQUIREMENTS.RECOMMENDATION;
  const missing = requirements.filter((group) => !group.some((key) => hasValue(product[key]))).map((group) => group.join('|'));
  const sufficient = missing.length === 0;
  return { facts, missing, requirements, sufficient };
};

const sanitizeFacts = (facts) => {
  if (!facts || typeof facts !== 'object' || Array.isArray(facts)) return null;
  const safe = {};
  for (const key of FACT_KEYS) {
    const value = facts[key];
    if (Array.isArray(value)) {
      const strings = value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim());
      if (strings.length) safe[key] = strings;
    } else if (typeof value === 'string' && value.trim()) safe[key] = value.trim();
  }
  return Object.keys(safe).length ? safe : {};
};

const validateProviderResult = (result, product) => {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  if (result.productId !== undefined && String(result.productId) !== String(product.id)) return null;
  if (identity(result.brand) !== identity(product.brand) || identity(result.name) !== identity(product.name)) return null;
  if (!['OFFICIAL', 'VERIFIED'].includes(result.sourceType) || typeof result.source !== 'string' || !result.source.trim()) return null;
  const facts = sanitizeFacts(result.facts);
  if (!facts) return null;
  return {
    productId: String(product.id), source: result.source.trim(), sourceType: result.sourceType,
    consultedAt: result.consultedAt || new Date().toISOString(), extractorVersion: result.extractorVersion || DEFAULT_EXTRACTOR_VERSION,
    facts, confidence: 'VERIFIED',
  };
};

const createProductResearchService = ({ resolver, finalProductRepository, cache = createMemoryResearchCache(), provider = null, now = () => Date.now(), ttlMs = DEFAULT_TTL_MS, extractorVersion = DEFAULT_EXTRACTOR_VERSION, maxCandidates = MAX_RESEARCH_CANDIDATES } = {}) => {
  if (!resolver || typeof resolver.resolveReferences !== 'function') throw new TypeError('El resolver de productos es obligatorio.');
  if (!finalProductRepository || typeof finalProductRepository.findCurrentEligibleProducts !== 'function') throw new TypeError('El repositorio final de productos es obligatorio.');
  const boundedMax = Math.max(1, Math.min(MAX_RESEARCH_CANDIDATES, Number(maxCandidates) || MAX_RESEARCH_CANDIDATES));
  const inFlight = new Map();

  const loadEligibleProduct = async (productId) => {
    const resolved = await resolver.resolveReferences([String(productId)], { max: 1 });
    if (resolved.status !== 'RESOLVED' || resolved.products.length !== 1) return null;
    const product = resolved.products[0];
    const rows = await finalProductRepository.findCurrentEligibleProducts([String(product.id)]);
    return rows.find((row) => String(row.id) === String(product.id) && isRecommendationEligibleProduct(row)) || null;
  };

  const researchProduct = async (productId, { needs = 'RECOMMENDATION' } = {}) => {
    const product = await loadEligibleProduct(productId);
    if (!product) return { status: RESEARCH_STATUS.PRODUCT_NOT_ELIGIBLE, productId: String(productId), evidence: null };
    const internal = internalEvidence(product, { needs });
    if (internal.sufficient) return { status: RESEARCH_STATUS.SUFFICIENT_INTERNAL, product: toPublicRecommendationProduct(product), evidence: { source: 'NARI_BACKEND', confidence: 'CONFIRMED', facts: internal.facts, missing: internal.missing } };

    const key = cacheKeyFor(product);
    let cached = null;
    let cacheStatus = 'AVAILABLE';
    try {
      cached = await cache.get(key);
    } catch {
      cacheStatus = 'UNAVAILABLE';
    }
    if (cached && cached.expiresAt > now() && cached.productFingerprint === key && cached.extractorVersion === extractorVersion) {
      return { status: RESEARCH_STATUS.CACHE_HIT, product: toPublicRecommendationProduct(product), evidence: cached.evidence };
    }
    const cacheState = cached ? (cached.evidence?.confidence === 'REJECTED' ? 'REJECTED' : 'EXPIRED') : cacheStatus;
    if (!provider || typeof provider.research !== 'function') return { status: RESEARCH_STATUS.RESEARCH_REQUIRED, product: toPublicRecommendationProduct(product), cacheStatus: cacheState, evidence: { source: 'NARI_BACKEND', confidence: 'UNKNOWN', facts: internal.facts, missing: internal.missing } };
    const runResearch = async () => {
      let raw;
      try {
        raw = await provider.research({ product: { id: String(product.id), brand: product.brand, name: product.name, slug: product.slug } });
      } catch {
        return { status: RESEARCH_STATUS.RESEARCH_UNAVAILABLE, product: toPublicRecommendationProduct(product), evidence: { source: 'NARI_BACKEND', confidence: 'UNKNOWN', facts: internal.facts, missing: internal.missing } };
      }
      const evidence = validateProviderResult(raw, product);
      if (!evidence) return { status: RESEARCH_STATUS.REJECTED_SOURCE, product: toPublicRecommendationProduct(product), evidence: { source: 'NARI_BACKEND', confidence: 'UNKNOWN', facts: internal.facts, missing: internal.missing } };
      evidence.extractorVersion = extractorVersion;
      try {
        await cache.set(key, { cacheKey: key, productId: String(product.id), product, productFingerprint: key, extractorVersion, expiresAt: now() + ttlMs, evidence });
      } catch {
        return { status: RESEARCH_STATUS.RESEARCHED, product: toPublicRecommendationProduct(product), cacheStatus: 'WRITE_FAILED', evidence };
      }
      return { status: RESEARCH_STATUS.RESEARCHED, product: toPublicRecommendationProduct(product), evidence };
    };
    if (inFlight.has(key)) return inFlight.get(key);
    const pending = (typeof cache.withLock === 'function'
      ? cache.withLock(key, runResearch)
        .then((result) => result || ({ status: RESEARCH_STATUS.RESEARCH_REQUIRED, product: toPublicRecommendationProduct(product), cacheStatus: 'LOCK_BUSY', evidence: { source: 'NARI_BACKEND', confidence: 'UNKNOWN', facts: internal.facts, missing: internal.missing } }))
        .catch(() => ({ status: RESEARCH_STATUS.RESEARCH_REQUIRED, product: toPublicRecommendationProduct(product), cacheStatus: 'UNAVAILABLE', evidence: { source: 'NARI_BACKEND', confidence: 'UNKNOWN', facts: internal.facts, missing: internal.missing } }))
      : runResearch()).finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
    return pending;
  };

  const researchCandidates = async (productIds = [], { needs = 'RECOMMENDATION' } = {}) => {
    const unique = [...new Set(productIds.map(String))].slice(0, boundedMax);
    const results = [];
    for (const productId of unique) results.push(await researchProduct(productId, { needs }));
    return { results, limited: productIds.length > unique.length, maxCandidates: boundedMax };
  };

  return { researchProduct, researchCandidates, cache, maxCandidates: boundedMax };
};

module.exports = { DEFAULT_TTL_MS, MAX_RESEARCH_CANDIDATES, EVIDENCE_REQUIREMENTS, RESEARCH_STATUS, cacheKeyFor, createMemoryResearchCache, createProductResearchService, internalEvidence, validateProviderResult };
