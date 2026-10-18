const { getConfig } = require('./config');
const { requestJson } = require('./httpClient');
const { CoordinadoraOAuth } = require('./auth');
const { CoordinadoraError } = require('./errors');
const { profileFromConfiguration } = require('./packageProfiles');
const { CoordinadoraError: LocationError } = require('./errors');

const required = ['origen', 'destino', 'valoracion', 'detalle'];

const validDetail = (detail) => detail && typeof detail === 'object'
  && ['ubl', 'alto', 'ancho', 'largo', 'peso', 'unidades'].every((field) => detail[field] !== undefined && detail[field] !== null && String(detail[field]).trim() !== '');

const validatePayload = (payload) => {
  if (!payload || typeof payload !== 'object') throw new CoordinadoraError('La solicitud de cotización no es válida.', { code: 'COORDINADORA_INVALID_QUOTE', status: 400 });
  const missing = required.filter((field) => payload[field] === undefined || payload[field] === null || (typeof payload[field] === 'string' && !payload[field].trim()));
  if (missing.length) throw new CoordinadoraError(`Faltan campos de cotización: ${missing.join(', ')}.`, { code: 'COORDINADORA_INVALID_QUOTE', status: 400 });
  if (!Array.isArray(payload.detalle) || payload.detalle.length === 0 || payload.detalle.some((detail) => !validDetail(detail))) throw new CoordinadoraError('El detalle físico del paquete está incompleto.', { code: 'COORDINADORA_PACKAGE_DATA_INCOMPLETE', status: 400 });
  if (!Number.isFinite(Number(payload.valoracion)) || Number(payload.valoracion) < 0) throw new CoordinadoraError('La valoración del envío no es válida.', { code: 'COORDINADORA_INVALID_QUOTE', status: 400 });
  return {
    ...payload,
    codigo_postal_origen: payload.codigo_postal_origen || '',
    codigo_postal_destino: payload.codigo_postal_destino || '',
    nivel_servicio: payload.nivel_servicio || '',
  };
};

const buildProviderPayload = (config, payload) => ({
  nit: config.nit,
  div: config.div,
  cuenta: config.account,
  producto: config.product,
  codigo_postal_origen: payload.codigo_postal_origen,
  codigo_postal_destino: payload.codigo_postal_destino,
  origen: payload.origen,
  destino: payload.destino,
  valoracion: payload.valoracion,
  nivel_servicio: payload.nivel_servicio,
  detalle: payload.detalle,
  apikey: config.apiKey,
  clave: config.apiSecret,
});

const buildStandardQuotePayload = ({ config, destinationDane, declaredValue, profile } = {}) => {
  if (!config || !config.originDane || !config.standardPackage || !config.standardPackage.ubl) throw new CoordinadoraError('La configuración de origen, empaque o UBL está incompleta.', { code: 'COORDINADORA_QUOTE_CONFIG_INCOMPLETE', status: 503 });
  if (typeof destinationDane !== 'string' || !/^\d+$/.test(destinationDane.trim())) throw new CoordinadoraError('El código DANE de destino no es válido.', { code: 'DANE_CODE_INVALID', status: 400 });
  if (!Number.isFinite(Number(declaredValue)) || Number(declaredValue) < 0) throw new CoordinadoraError('El valor declarado no es válido.', { code: 'COORDINADORA_DECLARED_VALUE_INVALID', status: 400 });
  const standardProfile = profile || profileFromConfiguration(config.standardPackage);
  if (standardProfile.active === false) throw new CoordinadoraError('El perfil estándar de empaque está inactivo.', { code: 'COORDINADORA_PACKAGE_PROFILE_INACTIVE', status: 503 });
  if (!standardProfile.quoteWeight) throw new CoordinadoraError('El perfil estándar no tiene peso de cotización.', { code: 'COORDINADORA_PACKAGE_DATA_INCOMPLETE', status: 503 });
  return {
    origen: config.originDane,
    destino: destinationDane.trim(),
    valoracion: Number(declaredValue),
    codigo_postal_origen: '',
    codigo_postal_destino: '',
    nivel_servicio: '',
    detalle: [{
      ubl: config.standardPackage.ubl,
      alto: String(standardProfile.height),
      ancho: String(standardProfile.width),
      largo: String(standardProfile.length),
      peso: String(standardProfile.quoteWeight),
      unidades: '1',
    }],
  };
};

const prepareNationalQuoteInput = ({ country, department, city, declaredValue, config, daneResolver, providerCodeResolver, profile } = {}) => {
  const countryKey = String(country || '').trim().toLowerCase();
  if (countryKey !== 'co' && countryKey !== 'colombia') throw new LocationError('Solo se preparan cotizaciones para Colombia.', { code: 'COORDINADORA_COUNTRY_UNSUPPORTED', status: 400 });
  if (!Number.isFinite(Number(declaredValue)) || Number(declaredValue) < 0) throw new LocationError('El valor declarado no es válido.', { code: 'COORDINADORA_DECLARED_VALUE_INVALID', status: 400 });
  if (!daneResolver || typeof daneResolver.resolveLocation !== 'function') throw new LocationError('El catálogo DANE no está disponible.', { code: 'DANE_CATALOG_UNAVAILABLE', status: 503 });
  const location = daneResolver.resolveLocation({ department, municipality: city });
  if (!config || !config.originDane || !config.standardPackage) throw new LocationError('La configuración de origen o empaque está incompleta.', { code: 'COORDINADORA_QUOTE_CONFIG_INCOMPLETE', status: 503 });
  const providerCode = typeof providerCodeResolver === 'function' ? providerCodeResolver(location) : null;
  const originProviderCode = config.originProviderCode || null;
  const pendingReasons = [];
  if (!originProviderCode) pendingReasons.push('ORIGIN_PROVIDER_CODE_PENDING');
  if (!providerCode) pendingReasons.push('DESTINATION_PROVIDER_CODE_PENDING');
  if (pendingReasons.length) return {
    status: 'PENDING_PROVIDER_MAPPING',
    location: { ...location, providerCode },
    origin: { daneCode: config.originDane, providerCode: originProviderCode, providerCodeConfirmed: Boolean(originProviderCode) },
    packageProfile: config.standardPackage,
    declaredValue: Number(declaredValue),
    pendingReasons,
    payload: null,
  };
  const payload = buildStandardQuotePayload({ config: { ...config, originDane: originProviderCode }, destinationDane: providerCode, declaredValue, profile });
  return { status: 'READY_FOR_PROVIDER_ADAPTER', location: { ...location, providerCode, providerCodeConfirmed: true }, origin: { daneCode: config.originDane, providerCode: originProviderCode, providerCodeConfirmed: true }, packageProfile: config.standardPackage, declaredValue: Number(declaredValue), pendingReasons: [], payload };
};

const normalizeQuote = (body) => {
  if (!body || typeof body !== 'object' || !('data' in body)) throw new CoordinadoraError('La respuesta de cotización no tiene el formato esperado.', { code: 'COORDINADORA_MALFORMED_RESPONSE', status: 502 });
  if (body.isError === true) throw new CoordinadoraError('Coordinadora no pudo cotizar el envío.', { code: 'COORDINADORA_QUOTE_REJECTED', status: 502, details: { providerMessage: typeof body.error === 'string' ? body.error : null } });
  if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) throw new CoordinadoraError('La respuesta de cotización no tiene datos válidos.', { code: 'COORDINADORA_MALFORMED_RESPONSE', status: 502 });
  const data = body.data;
  return {
    provider: 'coordinadora',
    providerId: body.id || null,
    timestamp: body.timestamp || null,
    fleteFijo: data.flete_fijo ?? null,
    fleteVariable: data.flete_variable ?? null,
    fleteTotal: data.flete_total ?? null,
    impuestos: data.impuestos ?? null,
    valorEnvio: data.valor_envio ?? null,
    pesoLiquidado: data.peso_liquidado ?? null,
    diasEntrega: data.dias_entrega ?? null,
    tipoTrayecto: data.tipo_trayecto ?? null,
    commercialAmountSelectionPending: true,
    shippingAmount: null,
    rawData: data,
  };
};

const quoteNational = async ({ payload, config, oauth, fetchImpl = globalThis.fetch } = {}) => {
  const resolvedConfig = config || getConfig();
  if (!resolvedConfig.enabled) throw new CoordinadoraError('Coordinadora está desactivada.', { code: 'COORDINADORA_DISABLED', status: 503 });
  const normalizedPayload = validatePayload(payload);
  const providerPayload = buildProviderPayload(resolvedConfig, normalizedPayload);
  const tokenClient = oauth || new CoordinadoraOAuth({ config: resolvedConfig, fetchImpl });
  let token = await tokenClient.getToken();
  const request = () => requestJson(`${resolvedConfig.apiBaseUrl}/cotizador/nacional`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(providerPayload),
    timeoutMs: resolvedConfig.timeoutMs,
    fetchImpl,
  });
  try {
    return normalizeQuote((await request()).body);
  } catch (error) {
    if (error.providerStatus !== 401) throw error;
    tokenClient.invalidate();
    token = await tokenClient.getToken();
    return normalizeQuote((await request()).body);
  }
};

module.exports = { quoteNational, normalizeQuote, validatePayload, buildProviderPayload, buildStandardQuotePayload, prepareNationalQuoteInput };
