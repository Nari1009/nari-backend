const MAX_DISCOUNT_PERCENT = 99;

const normalizeDiscountPercent = (value, field = 'discountPercent') => {
  if (value === null || value === undefined || value === '') return 0;
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || !Number.isInteger(numeric) || numeric < 0 || numeric > MAX_DISCOUNT_PERCENT) {
    const error = new Error(`${field} debe ser un número entero entre 0 y ${MAX_DISCOUNT_PERCENT}.`);
    error.status = 400;
    throw error;
  }
  return numeric;
};

const roundCop = (value) => Math.round(Number(value) + Number.EPSILON);

const calculateProductPricing = ({ basePrice, productDiscountPercent = 0, globalDiscountPercent = 0, globalEnabled = false }) => {
  const base = Number(basePrice);
  if (!Number.isFinite(base) || base < 0) throw new Error('El precio base del producto no es válido.');
  const productPercent = normalizeDiscountPercent(productDiscountPercent, 'productDiscountPercent');
  const globalPercent = globalEnabled ? normalizeDiscountPercent(globalDiscountPercent, 'globalDiscountPercent') : 0;
  const effectiveDiscountPercent = Math.max(productPercent, globalPercent);
  const discountSource = effectiveDiscountPercent === 0
    ? 'NONE'
    : productPercent >= globalPercent ? 'PRODUCT' : 'GLOBAL';
  const discounted = roundCop(base * (1 - effectiveDiscountPercent / 100));
  const effectivePrice = base > 0 && effectiveDiscountPercent > 0 ? Math.max(1, discounted) : discounted;
  return {
    basePrice: roundCop(base),
    productDiscountPercent: productPercent,
    globalDiscountPercent: globalPercent,
    effectiveDiscountPercent,
    discountSource,
    discountAmount: roundCop(base - effectivePrice),
    effectivePrice: roundCop(effectivePrice),
  };
};

const readGlobalDiscount = async (repository) => {
  const row = repository?.get ? await repository.get('SELECT value FROM public_settings WHERE key = ?', ['settings:store']) : null;
  let value = {};
  try { value = row?.value ? JSON.parse(row.value) : {}; } catch { value = {}; }
  return {
    enabled: value.globalDiscountEnabled === true,
    percent: normalizeDiscountPercent(value.globalDiscountPercent || 0, 'globalDiscountPercent'),
  };
};

module.exports = { MAX_DISCOUNT_PERCENT, normalizeDiscountPercent, calculateProductPricing, readGlobalDiscount };
