const CATALOG_ROLES = Object.freeze(['CATALOG', 'DEV_FIXTURE']);

const isRecommendationEligibleProduct = (product = {}) => (
  product.catalogRole === 'CATALOG'
  && product.status === 'active'
  && Number.isFinite(Number(product.stock))
  && Number(product.stock) > 0
);

module.exports = { CATALOG_ROLES, isRecommendationEligibleProduct };
