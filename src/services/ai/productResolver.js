const { AI_LIMITS } = require('./constants');

const CATALOG_PRODUCT_SELECT = `
  SELECT id, brand, name, slug, price, images, status, stock,
         catalogRole AS "catalogRole",
         routineStep AS "routineStep",
         sizeLabel AS "sizeLabel",
         suitableSkinTypes AS "suitableSkinTypes",
         suitableConditions AS "suitableConditions",
         targets AS "targets"
  FROM products
  WHERE catalogRole = 'CATALOG'`;

const normalizeReference = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()
  .replace(/\s+/g, ' ');

const GENERIC_PRODUCT_REFERENCES = new Set([
  'serum', 'toner', 'protector', 'protector solar', 'limpiador', 'cleanser',
  'hidratante', 'moisturizer', 'crema', 'esencia', 'essence', 'sunscreen',
]);

const toReference = (value) => {
  if (typeof value !== 'string') return null;
  const result = value.trim();
  if (!result || result.length > AI_LIMITS.historyMessage) return null;
  return result;
};

const STOP_WORDS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'con', 'para', 'por', 'and', 'the', 'ml', 'oz']);
const tokens = (value) => normalizeReference(value).split(' ').filter((token) => token && !STOP_WORDS.has(token) && !/^\d+(?:ml|g|oz)?$/.test(token));
const distance = (left, right) => {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (left[i - 1] === right[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[right.length];
};
const tokenMatches = (referenceTokens, productTokens) => productTokens.filter((productToken) => referenceTokens.some((referenceToken) => referenceToken === productToken || (productToken.length >= 5 && referenceToken.length >= 5 && distance(productToken, referenceToken) <= 1)));
const productMatchScore = (reference, product) => {
  const normalized = normalizeReference(reference);
  const name = normalizeReference(product.name);
  const slug = normalizeReference(product.slug);
  const brand = normalizeReference(product.brand);
  if (name === normalized || slug === normalized) return 1000;
  if (`${brand} ${name}`.trim() === normalized) return 950;
  if (normalized.length >= 3 && (name.includes(normalized) || slug.includes(normalized) || normalized.includes(name))) return 800;
  const referenceTokens = tokens(reference);
  const productTokens = [...new Set([...tokens(product.brand), ...tokens(product.name)])];
  const matched = tokenMatches(referenceTokens, productTokens);
  const nameTokens = tokens(product.name);
  const matchedName = tokenMatches(referenceTokens, nameTokens);
  if (matched.length >= 2 && matchedName.length === nameTokens.length) return 700 + matched.length;
  if (brand && referenceTokens.includes(brand) && matchedName.length >= 1) return 650 + matchedName.length;
  if (matchedName.length >= 2 && matchedName.length >= Math.ceil(nameTokens.length * 0.75)) return 600 + matchedName.length;
  return 0;
};

const createProductResolverRepository = ({ query } = {}) => ({
  async findCatalogProducts() {
    const execute = query || ((sql, params) => require('../../db/init').all(sql, params));
    return execute(CATALOG_PRODUCT_SELECT);
  },
});

const resolveOne = (reference, products) => {
  const normalized = normalizeReference(reference);
  if (!normalized) return { status: 'NOT_FOUND', reference };

  const orderedProducts = [...products].sort((left, right) => String(left.id).localeCompare(String(right.id)));
  const exactId = orderedProducts.filter((product) => String(product.id) === reference.trim());
  if (exactId.length === 1) return { status: 'RESOLVED', reference, product: exactId[0] };

  const exact = orderedProducts.filter((product) => (
    normalizeReference(product.slug) === normalized
    || normalizeReference(product.name) === normalized
  ));
  if (exact.length === 1) return { status: 'RESOLVED', reference, product: exact[0] };
  if (exact.length > 1) return { status: 'AMBIGUOUS', reference, products: exact };

  if (GENERIC_PRODUCT_REFERENCES.has(normalized)) return { status: 'AMBIGUOUS', reference, products: [] };
  const brandMatches = orderedProducts.filter((product) => normalizeReference(product.brand) === normalized);
  if (brandMatches.length > 1) return { status: 'AMBIGUOUS', reference, products: brandMatches };
  if (brandMatches.length === 1) return { status: 'RESOLVED', reference, product: brandMatches[0] };
  const scoredMatches = orderedProducts.map((product) => ({ product, score: productMatchScore(reference, product) })).filter((match) => match.score > 0).sort((left, right) => right.score - left.score || String(left.product.id).localeCompare(String(right.product.id)));
  if (scoredMatches.length === 1) return { status: 'RESOLVED', reference, product: scoredMatches[0].product };
  if (scoredMatches.length > 1) {
    const topScore = scoredMatches[0].score;
    const topMatches = scoredMatches.filter((match) => match.score === topScore).map((match) => match.product);
    if (topMatches.length === 1) return { status: 'RESOLVED', reference, product: topMatches[0] };
    return { status: 'AMBIGUOUS', reference, products: topMatches };
  }
  return { status: 'NOT_FOUND', reference };
};

const createProductResolver = ({ repository = createProductResolverRepository() } = {}) => ({
  async resolveReferences(rawReferences, { max = 3 } = {}) {
    if (!Array.isArray(rawReferences) || rawReferences.length === 0 || rawReferences.length > max) {
      return { status: 'INVALID', references: [], results: [], products: [] };
    }
    const references = rawReferences.map(toReference);
    if (references.some((reference) => !reference)) return { status: 'INVALID', references, results: [], products: [] };
    const products = (await repository.findCatalogProducts()).filter((product) => product.catalogRole === 'CATALOG');
    const results = references.map((reference) => resolveOne(reference, products));
    const resolvedProducts = results.filter((result) => result.status === 'RESOLVED').map((result) => result.product);
    const uniqueIds = new Set(resolvedProducts.map((product) => String(product.id)));
    if (results.some((result) => result.status === 'AMBIGUOUS')) return { status: 'AMBIGUOUS', references, results, products: resolvedProducts };
    if (results.some((result) => result.status !== 'RESOLVED') || uniqueIds.size !== resolvedProducts.length) return { status: 'NOT_FOUND', references, results, products: resolvedProducts };
    return { status: 'RESOLVED', references, results, products: resolvedProducts };
  },
});

module.exports = {
  CATALOG_PRODUCT_SELECT,
  GENERIC_PRODUCT_REFERENCES,
  createProductResolver,
  createProductResolverRepository,
  normalizeReference,
};
