const parseImages = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const primaryImage = (value) => {
  const first = parseImages(value)[0];
  if (typeof first === 'string') return first;
  if (first && typeof first === 'object' && typeof first.url === 'string') return first.url;
  return null;
};

const toPublicRecommendationProduct = (product = {}) => ({
  id: product.id,
  name: product.name,
  price: product.price ?? null,
  image: primaryImage(product.images),
  slug: product.slug,
  routineStep: product.routineStep ?? null,
});

const toPublicRecommendations = ({ selectedProducts = [], reasons = [] } = {}) => {
  const reasonByProductId = new Map(reasons.map((item) => [String(item.productId), item.reason]));
  return selectedProducts.map((product) => ({
    product: toPublicRecommendationProduct(product),
    reason: reasonByProductId.get(String(product.id)) || null,
  }));
};

module.exports = { primaryImage, toPublicRecommendationProduct, toPublicRecommendations };
