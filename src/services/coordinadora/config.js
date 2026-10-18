const { CoordinadoraError } = require('./errors');

const text = (value) => String(value || '').trim();
const enabled = (env = process.env) => text(env.COORDINADORA_ENABLED).toLowerCase() === 'true';

const requiredNames = [
  'COORDINADORA_API_BASE_URL',
  'COORDINADORA_OAUTH_URL',
  'COORDINADORA_CONSUMER_KEY',
  'COORDINADORA_CONSUMER_SECRET',
  'COORDINADORA_NIT',
  'COORDINADORA_DIV',
  'COORDINADORA_ACCOUNT',
  'COORDINADORA_PRODUCT',
  'COORDINADORA_API_KEY',
  'COORDINADORA_API_SECRET',
  'COORDINADORA_ORIGIN_DANE',
  'COORDINADORA_PACKAGE_PROFILE_ID',
  'COORDINADORA_PACKAGE_PROFILE_NAME',
  'COORDINADORA_PACKAGE_LENGTH_CM',
  'COORDINADORA_PACKAGE_WIDTH_CM',
  'COORDINADORA_PACKAGE_HEIGHT_CM',
  'COORDINADORA_PACKAGE_QUOTE_WEIGHT_KG',
  'COORDINADORA_PACKAGE_UNIT',
  'COORDINADORA_PACKAGE_UBL',
];

const optionalNames = [
  'COORDINADORA_ENV',
  'COORDINADORA_TIMEOUT_MS',
  'COORDINADORA_TOKEN_SKEW_SECONDS',
  'COORDINADORA_LOCATION_MAP_JSON',
  'COORDINADORA_LOCATION_MAP_SOURCE',
  'COORDINADORA_LOCATION_MAP_VERSION',
  'COORDINADORA_ORIGIN_PROVIDER_CODE',
];

const urlValue = (value, name) => {
  const result = text(value);
  if (!result) throw new CoordinadoraError(`Falta ${name}.`, { code: 'COORDINADORA_CONFIG_INCOMPLETE', status: 503 });
  let url;
  try { url = new URL(result); } catch { throw new CoordinadoraError(`${name} no es una URL válida.`, { code: 'COORDINADORA_CONFIG_INVALID', status: 503 }); }
  if (url.protocol !== 'https:') throw new CoordinadoraError(`${name} debe usar HTTPS.`, { code: 'COORDINADORA_CONFIG_INVALID', status: 503 });
  return url.toString().replace(/\/$/, '');
};

const standardPackageFromEnvironment = (env = process.env, { strict = false } = {}) => {
  const names = ['COORDINADORA_PACKAGE_PROFILE_ID', 'COORDINADORA_PACKAGE_PROFILE_NAME', 'COORDINADORA_PACKAGE_LENGTH_CM', 'COORDINADORA_PACKAGE_WIDTH_CM', 'COORDINADORA_PACKAGE_HEIGHT_CM', 'COORDINADORA_PACKAGE_QUOTE_WEIGHT_KG', 'COORDINADORA_PACKAGE_UNIT'];
  const present = names.filter((name) => text(env[name])).length;
  if (!present) return null;
  const missing = names.filter((name) => !text(env[name]));
  if (missing.length) {
    if (!strict) throw new CoordinadoraError(`Configuración incompleta del perfil estándar: ${missing.join(', ')}.`, { code: 'COORDINADORA_PACKAGE_CONFIG_INCOMPLETE', status: 503 });
    throw new CoordinadoraError(`Configuración incompleta de Coordinadora: ${missing.join(', ')}.`, { code: 'COORDINADORA_CONFIG_INCOMPLETE', status: 503 });
  }
  return {
    id: text(env.COORDINADORA_PACKAGE_PROFILE_ID),
    name: text(env.COORDINADORA_PACKAGE_PROFILE_NAME),
    length: Number(env.COORDINADORA_PACKAGE_LENGTH_CM),
    width: Number(env.COORDINADORA_PACKAGE_WIDTH_CM),
    height: Number(env.COORDINADORA_PACKAGE_HEIGHT_CM),
    quoteWeight: Number(env.COORDINADORA_PACKAGE_QUOTE_WEIGHT_KG),
    unit: text(env.COORDINADORA_PACKAGE_UNIT),
    ubl: text(env.COORDINADORA_PACKAGE_UBL) || null,
    active: text(env.COORDINADORA_PACKAGE_ACTIVE).toLowerCase() !== 'false',
  };
};

const getConfig = (env = process.env) => {
  if (!enabled(env)) return { enabled: false, environment: text(env.COORDINADORA_ENV) || null };
  const missing = requiredNames.filter((name) => !text(env[name]));
  if (missing.length) throw new CoordinadoraError(`Configuración incompleta de Coordinadora: ${missing.join(', ')}.`, { code: 'COORDINADORA_CONFIG_INCOMPLETE', status: 503 });
  const timeoutMs = Number(env.COORDINADORA_TIMEOUT_MS || 8000);
  const tokenSkewSeconds = Number(env.COORDINADORA_TOKEN_SKEW_SECONDS || 60);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000) throw new CoordinadoraError('COORDINADORA_TIMEOUT_MS no es válido.', { code: 'COORDINADORA_CONFIG_INVALID', status: 503 });
  if (!Number.isInteger(tokenSkewSeconds) || tokenSkewSeconds < 0 || tokenSkewSeconds > 3600) throw new CoordinadoraError('COORDINADORA_TOKEN_SKEW_SECONDS no es válido.', { code: 'COORDINADORA_CONFIG_INVALID', status: 503 });
  return {
    enabled: true,
    environment: text(env.COORDINADORA_ENV) || null,
    apiBaseUrl: urlValue(env.COORDINADORA_API_BASE_URL, 'COORDINADORA_API_BASE_URL'),
    oauthUrl: urlValue(env.COORDINADORA_OAUTH_URL, 'COORDINADORA_OAUTH_URL'),
    consumerKey: text(env.COORDINADORA_CONSUMER_KEY),
    consumerSecret: text(env.COORDINADORA_CONSUMER_SECRET),
    nit: text(env.COORDINADORA_NIT),
    div: text(env.COORDINADORA_DIV),
    account: text(env.COORDINADORA_ACCOUNT),
    product: text(env.COORDINADORA_PRODUCT),
    apiKey: text(env.COORDINADORA_API_KEY),
    apiSecret: text(env.COORDINADORA_API_SECRET),
    originDane: text(env.COORDINADORA_ORIGIN_DANE),
    originProviderCode: text(env.COORDINADORA_ORIGIN_PROVIDER_CODE) || null,
    locationMapJson: text(env.COORDINADORA_LOCATION_MAP_JSON) || null,
    locationMapSource: text(env.COORDINADORA_LOCATION_MAP_SOURCE) || null,
    locationMapVersion: text(env.COORDINADORA_LOCATION_MAP_VERSION) || null,
    standardPackage: standardPackageFromEnvironment(env, { strict: true }),
    timeoutMs,
    tokenSkewSeconds,
  };
};

module.exports = { enabled, getConfig, standardPackageFromEnvironment, requiredNames, optionalNames };
