const POLICY_VERSION = 'R5_V1';
const BOGOTA_TIME_ZONE = 'America/Bogota';
const LOCAL_DEPARTMENT = 'Antioquia';
const LOCAL_MUNICIPALITIES = new Set(['medellin', 'bello', 'envigado', 'sabaneta', 'itagui', 'la estrella']);

// This list protects the policy from accepting an arbitrary department label.
// Municipality names remain canonical in the client location catalog; R5 only
// needs the six Antioquia pairs for local eligibility.
const KNOWN_DEPARTMENTS = new Set([
  'amazonas', 'antioquia', 'arauca', 'atlantico', 'bolivar', 'boyaca', 'caldas',
  'caqueta', 'casanare', 'cauca', 'cesar', 'choco', 'cordoba', 'cundinamarca',
  'guainia', 'guaviare', 'huila', 'la guajira', 'magdalena', 'meta', 'narino',
  'norte de santander', 'putumayo', 'quindio', 'risaralda', 'san andres',
  'santander', 'sucre', 'tolima', 'valle del cauca', 'vaupes', 'vichada',
  'bogota, d.c.', 'archipielago de san andres, providencia y santa catalina',
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

const validateLocation = ({ department, city }) => {
  const departmentText = String(department || '').trim();
  const cityText = String(city || '').trim();
  const departmentKey = normalizeLocation(departmentText);
  const cityKey = normalizeLocation(cityText);
  if (!departmentText || !cityText || !KNOWN_DEPARTMENTS.has(departmentKey)) {
    throw new ShippingPolicyError('Selecciona un departamento y municipio válidos.', 400, 'INVALID_SHIPPING_LOCATION');
  }
  return { department: departmentText, city: cityText, departmentKey, cityKey };
};

const bogotaTimeParts = (now = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BOGOTA_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
  return { hour: values.hour, minute: values.minute, second: values.second };
};

const calculateShipping = ({ department, city, now = new Date(), standardCost }) => {
  const location = validateLocation({ department, city });
  const local = location.departmentKey === normalizeLocation(LOCAL_DEPARTMENT) && LOCAL_MUNICIPALITIES.has(location.cityKey);
  if (local) {
    const time = bogotaTimeParts(now);
    const sameDayEligible = time.hour < 11;
    return {
      shippingZone: 'LOCAL',
      deliveryType: sameDayEligible ? 'SAME_DAY' : 'STANDARD',
      sameDayEligible,
      shippingTotal: 0,
      minDays: sameDayEligible ? 0 : 2,
      maxDays: sameDayEligible ? 0 : 5,
      estimatedTime: sameDayEligible ? 'Puede llegar hoy hasta las 10:00 p. m.' : 'Entrega en los próximos días',
      policyVersion: POLICY_VERSION,
      department: location.department,
      city: location.city,
    };
  }
  const fee = Number(standardCost);
  if (!Number.isFinite(fee) || fee <= 0) {
    throw new ShippingPolicyError('El costo nacional de envío no está disponible.', 503, 'SHIPPING_CONFIGURATION_INVALID');
  }
  return {
    shippingZone: 'NATIONAL',
    deliveryType: 'STANDARD',
    sameDayEligible: false,
    shippingTotal: fee,
    minDays: 2,
    maxDays: 5,
    estimatedTime: 'Entrega en los próximos días',
    policyVersion: POLICY_VERSION,
    department: location.department,
    city: location.city,
  };
};

const configuredNationalShippingCost = async () => {
  const { get } = require('../db/init');
  const row = await get('SELECT value FROM public_settings WHERE key = ?', ['settings:shipping']);
  if (!row) throw new ShippingPolicyError('La tarifa nacional de envío no está configurada.', 503, 'SHIPPING_CONFIGURATION_INVALID');
  let settings;
  try { settings = JSON.parse(row.value); } catch { throw new ShippingPolicyError('La configuración nacional de envío no es válida.', 503, 'SHIPPING_CONFIGURATION_INVALID'); }
  const fee = Number(settings?.standardCost);
  if (!Number.isFinite(fee) || fee <= 0) throw new ShippingPolicyError('La tarifa nacional de envío no es válida.', 503, 'SHIPPING_CONFIGURATION_INVALID');
  return fee;
};

const getShippingQuote = async ({ department, city, now = new Date() }) => {
  const location = validateLocation({ department, city });
  const local = location.departmentKey === normalizeLocation(LOCAL_DEPARTMENT) && LOCAL_MUNICIPALITIES.has(location.cityKey);
  const standardCost = local ? undefined : await configuredNationalShippingCost();
  return calculateShipping({ department, city, now, standardCost });
};

module.exports = {
  BOGOTA_TIME_ZONE,
  LOCAL_DEPARTMENT,
  LOCAL_MUNICIPALITIES,
  POLICY_VERSION,
  ShippingPolicyError,
  normalizeLocation,
  validateLocation,
  bogotaTimeParts,
  calculateShipping,
  configuredNationalShippingCost,
  getShippingQuote,
};
