const POLICY_VERSION = 'R12G_SHIPPING_V1';
const LOCAL_DEPARTMENT = 'Antioquia';
const BASE_RATES = Object.freeze({ LOCAL: 9000, REGIONAL: 10450, NATIONAL: 17830, OTHER: 27560 });
const COLOMBIA_KEYS = new Set(['colombia', 'co']);
const OTHER_DEPARTMENT_KEYS = new Set([
  'san andres, providencia y santa catalina',
  'archipielago de san andres, providencia y santa catalina',
]);

// This is NARI's provisional commercial classification, not Coordinadora's
// official origin/destination classification.
const KNOWN_DEPARTMENTS = new Set([
  'amazonas', 'antioquia', 'arauca', 'atlantico', 'bolivar', 'boyaca', 'caldas',
  'caqueta', 'casanare', 'cauca', 'cesar', 'choco', 'cordoba', 'cundinamarca',
  'guainia', 'guaviare', 'huila', 'la guajira', 'magdalena', 'meta', 'narino',
  'norte de santander', 'putumayo', 'quindio', 'risaralda', 'san andres',
  'santander', 'sucre', 'tolima', 'valle del cauca', 'vaupes', 'vichada',
  'bogota, d.c.', 'bogota d.c.', ...OTHER_DEPARTMENT_KEYS,
]);

class ShippingPolicyError extends Error {
  constructor(message, status = 400, code = 'SHIPPING_UNAVAILABLE') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const normalizeLocation = (value) => String(value || '')
  .trim()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, ' ')
  .toLowerCase();

const validateCountry = (country) => {
  const countryText = String(country || '').trim();
  if (!countryText || !COLOMBIA_KEYS.has(normalizeLocation(countryText))) {
    throw new ShippingPolicyError('Por ahora solo realizamos envíos dentro de Colombia.', 400, 'SHIPPING_COUNTRY_UNSUPPORTED');
  }
  return countryText;
};

const validateLocation = ({ country, department, city }) => {
  const countryText = validateCountry(country);
  const departmentText = String(department || '').trim();
  const cityText = String(city || '').trim();
  const departmentKey = normalizeLocation(departmentText);
  const cityKey = normalizeLocation(cityText);
  if (!departmentText || !cityText || !KNOWN_DEPARTMENTS.has(departmentKey)) {
    throw new ShippingPolicyError('Selecciona un departamento y municipio válidos.', 400, 'INVALID_SHIPPING_LOCATION');
  }
  return { country: countryText, department: departmentText, city: cityText, departmentKey, cityKey };
};

const validateMerchandiseSubtotal = (value) => {
  const subtotal = Number(value);
  if (!Number.isFinite(subtotal) || subtotal < 0) {
    throw new ShippingPolicyError('El subtotal de productos no es válido.', 400, 'INVALID_SHIPPING_SUBTOTAL');
  }
  return subtotal;
};

const calculateShipping = ({ country, department, city, merchandiseSubtotal }) => {
  const location = validateLocation({ country, department, city });
  const declaredValue = validateMerchandiseSubtotal(merchandiseSubtotal);
  const isAntioquia = location.departmentKey === normalizeLocation(LOCAL_DEPARTMENT);
  let shippingZone = 'NATIONAL';
  if (isAntioquia && location.cityKey === 'bello') shippingZone = 'LOCAL';
  else if (isAntioquia) shippingZone = 'REGIONAL';
  else if (OTHER_DEPARTMENT_KEYS.has(location.departmentKey) || location.departmentKey === 'san andres') shippingZone = 'OTHER';

  const baseRate = BASE_RATES[shippingZone];
  const variableCharge = Math.round(declaredValue * 0.01);
  const shippingTotal = baseRate + variableCharge;
  return {
    shippingZone,
    baseRate,
    declaredValue,
    variableCharge,
    shippingTotal,
    deliveryType: 'STANDARD',
    sameDayEligible: false,
    minDays: 2,
    maxDays: 5,
    estimatedTime: 'Entrega estándar en los próximos días',
    policyVersion: POLICY_VERSION,
    country: location.country,
    department: location.department,
    city: location.city,
  };
};

const canonicalMerchandiseSubtotal = async (items, repository) => {
  if (!Array.isArray(items) || items.length === 0) {
    throw new ShippingPolicyError('Agrega productos para cotizar el envío.', 400, 'INVALID_SHIPPING_ITEMS');
  }
  const normalizedItems = items.map((item) => {
    const productId = String(item?.productId || '').trim();
    const quantity = Number(item?.quantity);
    if (!productId || !Number.isInteger(quantity) || quantity <= 0) {
      throw new ShippingPolicyError('Los productos para cotizar el envío no son válidos.', 400, 'INVALID_SHIPPING_ITEMS');
    }
    return { productId, quantity };
  });
  const reader = repository || require('../db/init');
  const ids = [...new Set(normalizedItems.map((item) => item.productId))];
  const rows = await reader.all(`SELECT id, price, status FROM products WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  const products = new Map(rows.map((row) => [String(row.id), row]));
  return normalizedItems.reduce((sum, item) => {
    const product = products.get(item.productId);
    if (!product || String(product.status || '').toUpperCase() !== 'ACTIVE') {
      throw new ShippingPolicyError('Uno de los productos seleccionados ya no está disponible.', 409, 'PRODUCT_UNAVAILABLE');
    }
    const price = Number(product.price);
    if (!Number.isFinite(price) || price < 0) {
      throw new ShippingPolicyError('El precio de un producto no es válido.', 500, 'PRODUCT_PRICE_INVALID');
    }
    return sum + price * item.quantity;
  }, 0);
};

const getShippingQuote = async ({ country, department, city, items, merchandiseSubtotal }, repository) => {
  const subtotal = items !== undefined
    ? await canonicalMerchandiseSubtotal(items, repository)
    : merchandiseSubtotal;
  return calculateShipping({ country, department, city, merchandiseSubtotal: subtotal });
};

module.exports = {
  BASE_RATES,
  LOCAL_DEPARTMENT,
  OTHER_DEPARTMENT_KEYS,
  POLICY_VERSION,
  ShippingPolicyError,
  normalizeLocation,
  validateCountry,
  validateLocation,
  calculateShipping,
  canonicalMerchandiseSubtotal,
  getShippingQuote,
};
