const { AI_LIMITS } = require('./constants');

const CATALOG_PRODUCT_SELECT = `
  SELECT id, name, slug, price, images, status, stock,
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
  const boundedMatches = orderedProducts.filter((product) => {
    const name = normalizeReference(product.name);
    const slug = normalizeReference(product.slug);
    return normalized.length >= 3 && (name.includes(normalized) || slug.includes(normalized) || normalized.includes(name));
  });
  if (boundedMatches.length === 1) return { status: 'RESOLVED', reference, product: boundedMatches[0] };
  if (boundedMatches.length > 1) return { status: 'AMBIGUOUS', reference, products: boundedMatches };
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
