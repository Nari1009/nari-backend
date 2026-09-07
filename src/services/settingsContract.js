class ContractValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ContractValidationError';
    this.status = 400;
  }
}

const MAX = {
  short: 120,
  medium: 500,
  message: 1000,
  url: 300,
};

const defaults = {
  contact: { supportEmail: '', whatsappNumber: '', whatsappMessage: 'Hola, vengo de la página de NARI y necesito ayuda.', businessPhone: '', instagram: '', tiktok: '' },
  general: { storeName: 'NARI', commercialName: '', country: 'Colombia', currency: 'COP', timezone: 'America/Bogota', language: 'Español' },
  store: { storeActive: true, showOutOfStock: true, allowOutOfStockPurchase: false, showAvailableQuantity: false, showInactiveProducts: false },
  inventory: { defaultLowStock: 3, notifyLowStock: true, notifyOutOfStock: true },
  checkout: { checkoutType: 'guest', requestPhone: true, requestNeighborhood: false, requestPostalCode: false, requestDocument: false, requestDeliveryInstructions: true, defaultCountry: 'Colombia' },
  shipping: { shippingEnabled: true, standardCost: 0, minDays: 2, maxDays: 5, freeShippingEnabled: false, freeShippingThreshold: 0 },
};

const validSections = new Set(Object.keys(defaults));
const publicSections = new Set(['contact']);

const fail = (message) => { throw new ContractValidationError(message); };

const assertObject = (value, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} debe ser un objeto.`);
};

const assertKnownKeys = (value, known, label, rejectUnknown) => {
  if (!rejectUnknown) return;
  const unknown = Object.keys(value).filter((key) => !known.includes(key));
  if (unknown.length) fail(`${label} contiene campos no permitidos: ${unknown.join(', ')}.`);
};

const stringValue = (value, field, max = MAX.short, { optional = false } = {}) => {
  if (value === undefined && optional) return '';
  if (typeof value !== 'string') fail(`${field} debe ser texto.`);
  const result = value.trim();
  if (result.length > max) fail(`${field} supera el máximo permitido.`);
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(result)) fail(`${field} contiene caracteres no permitidos.`);
  if (/<\/?[a-z][^>]*>/i.test(result)) fail(`${field} no admite HTML.`);
  return result;
};

const booleanValue = (value, field) => {
  if (typeof value !== 'boolean') fail(`${field} debe ser booleano.`);
  return value;
};

const numberValue = (value, field, { min = 0, max = 100000000, integer = false } = {}) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${field} debe ser un número finito.`);
  if (integer && !Number.isInteger(value)) fail(`${field} debe ser un número entero.`);
  if (value < min || value > max) fail(`${field} está fuera del rango permitido.`);
  return value;
};

const safeUrlOrHandle = (value, field) => {
  const result = stringValue(value, field, MAX.url, { optional: true });
  if (!result) return result;
  if (result.startsWith('@')) {
    if (!/^@[A-Za-z0-9._]{1,50}$/.test(result)) fail(`${field} no es válido.`);
    return result;
  }
  let url;
  try { url = new URL(result); } catch { fail(`${field} debe ser una URL HTTPS o un usuario válido.`); }
  if (url.protocol !== 'https:') fail(`${field} debe usar HTTPS.`);
  return url.toString().replace(/\/$/, '');
};

const contactValue = (value) => {
  assertObject(value, 'Contacto');
  const fields = ['supportEmail', 'whatsappNumber', 'whatsappMessage', 'businessPhone', 'instagram', 'tiktok'];
  assertKnownKeys(value, fields, 'Contacto', true);
  const supportEmail = stringValue(value.supportEmail, 'supportEmail', MAX.short, { optional: true });
  if (supportEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supportEmail)) fail('supportEmail no es válido.');
  const phone = (field) => {
    const result = stringValue(value[field], field, MAX.short, { optional: true });
    if (result && !/^\+?[0-9() .-]{7,25}$/.test(result)) fail(`${field} no es válido.`);
    if (result && result.replace(/\D/g, '').length < 7) fail(`${field} no es válido.`);
    return result;
  };
  return {
    supportEmail,
    whatsappNumber: phone('whatsappNumber'),
    whatsappMessage: stringValue(value.whatsappMessage, 'whatsappMessage', MAX.message, { optional: true }),
    businessPhone: phone('businessPhone'),
    instagram: safeUrlOrHandle(value.instagram, 'instagram'),
    tiktok: safeUrlOrHandle(value.tiktok, 'tiktok'),
  };
};

const settingValidators = {
  contact: contactValue,
  general: (value) => {
    assertObject(value, 'General');
    const fields = Object.keys(defaults.general);
    assertKnownKeys(value, fields, 'General', true);
    const result = {
      storeName: stringValue(value.storeName, 'storeName'),
      commercialName: stringValue(value.commercialName, 'commercialName', MAX.short, { optional: true }),
      country: stringValue(value.country, 'country'),
      currency: stringValue(value.currency, 'currency'),
      timezone: stringValue(value.timezone, 'timezone'),
      language: stringValue(value.language, 'language'),
    };
    if (!['Colombia', 'Ecuador', 'Panamá'].includes(result.country)) fail('country no está soportado.');
    if (!['COP', 'USD'].includes(result.currency)) fail('currency no está soportada.');
    if (!['America/Bogota', 'America/New_York'].includes(result.timezone)) fail('timezone no está soportada.');
    if (!['Español', 'English'].includes(result.language)) fail('language no está soportado.');
    return result;
  },
  store: (value) => {
    assertObject(value, 'Tienda');
    const fields = Object.keys(defaults.store);
    assertKnownKeys(value, fields, 'Tienda', true);
    return Object.fromEntries(fields.map((field) => [field, booleanValue(value[field], field)]));
  },
  inventory: (value) => {
    assertObject(value, 'Inventario');
    const fields = Object.keys(defaults.inventory);
    assertKnownKeys(value, fields, 'Inventario', true);
    return {
      defaultLowStock: numberValue(value.defaultLowStock, 'defaultLowStock', { max: 100000, integer: true }),
      notifyLowStock: booleanValue(value.notifyLowStock, 'notifyLowStock'),
      notifyOutOfStock: booleanValue(value.notifyOutOfStock, 'notifyOutOfStock'),
    };
  },
  checkout: (value) => {
    assertObject(value, 'Checkout');
    const fields = Object.keys(defaults.checkout);
    assertKnownKeys(value, fields, 'Checkout', true);
    const result = {
      checkoutType: stringValue(value.checkoutType, 'checkoutType'),
      requestPhone: booleanValue(value.requestPhone, 'requestPhone'),
      requestNeighborhood: booleanValue(value.requestNeighborhood, 'requestNeighborhood'),
      requestPostalCode: booleanValue(value.requestPostalCode, 'requestPostalCode'),
      requestDocument: booleanValue(value.requestDocument, 'requestDocument'),
      requestDeliveryInstructions: booleanValue(value.requestDeliveryInstructions, 'requestDeliveryInstructions'),
      defaultCountry: stringValue(value.defaultCountry, 'defaultCountry'),
    };
    if (result.checkoutType !== 'guest') fail('checkoutType no está soportado.');
    if (!['Colombia', 'Ecuador', 'Panamá'].includes(result.defaultCountry)) fail('defaultCountry no está soportado.');
    return result;
  },
  shipping: (value) => {
    assertObject(value, 'Envíos');
    const fields = Object.keys(defaults.shipping);
    assertKnownKeys(value, fields, 'Envíos', true);
    const result = {
      shippingEnabled: booleanValue(value.shippingEnabled, 'shippingEnabled'),
      standardCost: numberValue(value.standardCost, 'standardCost', { max: 100000000 }),
      minDays: numberValue(value.minDays, 'minDays', { max: 365, integer: true }),
      maxDays: numberValue(value.maxDays, 'maxDays', { max: 365, integer: true }),
      freeShippingEnabled: booleanValue(value.freeShippingEnabled, 'freeShippingEnabled'),
      freeShippingThreshold: numberValue(value.freeShippingThreshold, 'freeShippingThreshold', { max: 100000000 }),
    };
    if (result.minDays > result.maxDays) fail('minDays no puede superar maxDays.');
    return result;
  },
};

const validateSetting = (section, value, { rejectUnknown = true } = {}) => {
  if (!validSections.has(section)) fail('Setting section not found');
  if (rejectUnknown) return settingValidators[section](value);
  try { return settingValidators[section](value); } catch { return { ...defaults[section] }; }
};

module.exports = { ContractValidationError, defaults, validSections, publicSections, validateSetting };
