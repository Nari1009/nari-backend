const PUBLIC_PRODUCT_FIELDS = Object.freeze({
  id: 'id',
  brand: 'brand',
  name: 'name',
  slug: 'slug',
  category: 'category',
  description: 'description',
  price: 'price',
  compareAtPrice: 'compareatprice',
  stock: 'stock',
  status: 'status',
  skinTypes: 'skintypes',
  concerns: 'concerns',
  ingredients: 'ingredients',
  benefits: 'benefits',
  howToUse: 'howtouse',
  precautions: 'precautions',
  audience: 'audience',
  skinBenefits: 'skinbenefits',
  featuredIngredients: 'featuredingredients',
  fullIngredients: 'fullingredients',
  productInfo: 'productinfo',
  shippingReturns: 'shippingreturns',
  images: 'images',
  rating: 'rating',
  reviewCount: 'reviewcount',
  soldCount: 'soldcount',
  isBestSeller: 'isbestseller',
});

const PUBLIC_PRODUCT_KEYS = Object.freeze(Object.keys(PUBLIC_PRODUCT_FIELDS));

const PUBLIC_PRODUCT_SELECT = `SELECT ${PUBLIC_PRODUCT_KEYS
  .map((key) => `${PUBLIC_PRODUCT_FIELDS[key]} AS "${key}"`)
  .join(', ')} FROM products`;

function toPublicProduct(product = {}) {
  const projected = {};

  for (const key of PUBLIC_PRODUCT_KEYS) {
    const sourceKey = PUBLIC_PRODUCT_FIELDS[key];
    if (Object.prototype.hasOwnProperty.call(product, key)) {
      projected[key] = product[key];
    } else if (Object.prototype.hasOwnProperty.call(product, sourceKey)) {
      projected[key] = product[sourceKey];
    }
  }

  return projected;
}

module.exports = {
  PUBLIC_PRODUCT_FIELDS,
  PUBLIC_PRODUCT_KEYS,
  PUBLIC_PRODUCT_SELECT,
  toPublicProduct,
};
