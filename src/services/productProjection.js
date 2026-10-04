const PUBLIC_PRODUCT_FIELDS = Object.freeze({
  id: 'id',
  brand: 'brand',
  name: 'name',
  slug: 'slug',
  category: 'category',
  description: 'description',
  price: 'price',
  discountPercent: 'discountpercent',
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

const GLOBAL_DISCOUNT_PERCENT = `CASE WHEN COALESCE((SELECT (value::jsonb->>'globalDiscountEnabled')::boolean FROM public_settings WHERE key = 'settings:store' LIMIT 1), false)
  THEN COALESCE((SELECT (value::jsonb->>'globalDiscountPercent')::integer FROM public_settings WHERE key = 'settings:store' LIMIT 1), 0)
  ELSE 0 END`;
const EFFECTIVE_DISCOUNT_PERCENT = `GREATEST(COALESCE(products.discountpercent, 0), (${GLOBAL_DISCOUNT_PERCENT}))`;
const EFFECTIVE_PRICE = `CASE WHEN products.price > 0 AND ${EFFECTIVE_DISCOUNT_PERCENT} > 0
  THEN GREATEST(1, ROUND(products.price * (100 - ${EFFECTIVE_DISCOUNT_PERCENT}) / 100.0))
  ELSE ROUND(products.price * (100 - ${EFFECTIVE_DISCOUNT_PERCENT}) / 100.0) END`;
const PUBLIC_PRODUCT_SELECT = `SELECT ${PUBLIC_PRODUCT_KEYS
  .map((key) => `${PUBLIC_PRODUCT_FIELDS[key]} AS "${key}"`)
  .join(', ')},
  products.price AS "basePrice",
  ${EFFECTIVE_DISCOUNT_PERCENT} AS "effectiveDiscountPercent",
  ${EFFECTIVE_PRICE} AS "effectivePrice",
  CASE WHEN ${EFFECTIVE_DISCOUNT_PERCENT} = 0 THEN 'NONE'
       WHEN COALESCE(products.discountpercent, 0) >= (${GLOBAL_DISCOUNT_PERCENT}) THEN 'PRODUCT'
       ELSE 'GLOBAL' END AS "discountSource"
  FROM products`;

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

  if (projected.basePrice === undefined) projected.basePrice = product.price;
  if (projected.effectivePrice === undefined) projected.effectivePrice = product.price;
  if (projected.effectiveDiscountPercent === undefined) projected.effectiveDiscountPercent = 0;
  if (projected.discountSource === undefined) projected.discountSource = 'NONE';

  return projected;
}

module.exports = {
  PUBLIC_PRODUCT_FIELDS,
  PUBLIC_PRODUCT_KEYS,
  PUBLIC_PRODUCT_SELECT,
  toPublicProduct,
};
