const { getConfig } = require('./config');
const { CoordinadoraError } = require('./errors');
const { createOfficialDaneResolver, providerCodeMapFromConfig } = require('./dane');
const { prepareNationalQuoteInput, quoteNational } = require('./quote');

const PROVIDER = 'COORDINADORA';

const baseResult = ({ status, config = null, origin = null, destination = null, packageProfile = null, errors = [] } = {}) => ({
  status,
  provider: PROVIDER,
  integrationEnabled: Boolean(config?.enabled),
  origin,
  destination,
  packageProfile,
  quote: null,
  shippingAmount: null,
  checkoutReady: false,
  errors,
});

const errorStatus = (error) => {
  if (!error) return 'PROVIDER_ERROR';
  if (['COORDINADORA_CONFIG_INCOMPLETE', 'COORDINADORA_CONFIG_INVALID', 'COORDINADORA_QUOTE_CONFIG_INCOMPLETE', 'PROVIDER_MAP_INVALID', 'PROVIDER_MAP_CONFLICT', 'PROVIDER_MAP_METADATA_REQUIRED'].includes(error.code)) return 'CONFIGURATION_INCOMPLETE';
  if (['DANE_CATALOG_UNAVAILABLE', 'DANE_CATALOG_INVALID', 'DANE_CATALOG_METADATA_REQUIRED'].includes(error.code)) return 'DANE_CATALOG_UNAVAILABLE';
  if (error.code === 'DANE_CODE_NOT_FOUND') return 'DESTINATION_NOT_FOUND';
  if (error.code === 'DANE_CODE_AMBIGUOUS') return 'DESTINATION_AMBIGUOUS';
  if (error.code === 'COORDINADORA_COUNTRY_UNSUPPORTED') return 'COUNTRY_UNSUPPORTED';
  if (error.code === 'COORDINADORA_DECLARED_VALUE_INVALID') return 'DECLARED_VALUE_INVALID';
  if (error.code === 'COORDINADORA_TIMEOUT') return 'TIMEOUT';
  if (error.code === 'COORDINADORA_MALFORMED_RESPONSE' || error.code === 'COORDINADORA_EMPTY_RESPONSE') return 'INVALID_PROVIDER_RESPONSE';
  if (error.code === 'COORDINADORA_AUTHENTICATION_ERROR' || error.code === 'COORDINADORA_TOKEN_INVALID') return 'AUTHENTICATION_ERROR';
  if (error.code === 'COORDINADORA_RATE_LIMITED') return 'RATE_LIMITED';
  if (error.code === 'COORDINADORA_QUOTE_REJECTED' && /SIFA/i.test(error.details?.providerMessage || '')) return 'PROVIDER_BUSINESS_ERROR';
  if (error.code === 'COORDINADORA_QUOTE_REJECTED' && /cobertura|coverage|no cubierto/i.test(error.details?.providerMessage || '')) return 'DESTINATION_NOT_COVERED';
  return 'PROVIDER_ERROR';
};

const safeError = (error) => ({
  code: error?.code || 'COORDINADORA_ERROR',
  status: error?.providerStatus || error?.status || 502,
  retryable: Boolean(error?.retryable),
});

const quoteNationalShipping = async ({ input, config, daneResolver, providerCodeMap, adapter, fetchImpl } = {}) => {
  let resolvedConfig;
  try { resolvedConfig = config || getConfig(); } catch (error) { return baseResult({ status: 'CONFIGURATION_INCOMPLETE', errors: [safeError(error)] }); }
  if (!resolvedConfig.enabled) return baseResult({ status: 'DISABLED', config: resolvedConfig });

  let resolver = daneResolver;
  let locationMap = providerCodeMap;
  try {
    resolver = resolver || createOfficialDaneResolver();
    locationMap = locationMap || providerCodeMapFromConfig(resolvedConfig);
    const prepared = prepareNationalQuoteInput({
      ...input,
      config: resolvedConfig,
      daneResolver: resolver,
      providerCodeResolver: locationMap ? (location) => locationMap.resolve(location.daneCode) : null,
    });
    if (prepared.status === 'PENDING_PROVIDER_MAPPING') return baseResult({
      status: 'PENDING_PROVIDER_MAPPING',
      config: resolvedConfig,
      origin: prepared.origin,
      destination: prepared.location,
      packageProfile: prepared.packageProfile,
      errors: prepared.pendingReasons.map((code) => ({ code, status: 409, retryable: false })),
    });

    const invoke = adapter || ((context) => quoteNational({ ...context, fetchImpl }));
    const quote = await invoke({ payload: prepared.payload, config: resolvedConfig, input });
    const normalizedFields = ['fleteFijo', 'fleteVariable', 'fleteTotal', 'impuestos', 'valorEnvio'];
    if (!quote || typeof quote !== 'object' || normalizedFields.some((field) => !Object.hasOwn(quote, field)) || quote.shippingAmount !== null || quote.checkoutReady === true) {
      return baseResult({ status: 'INVALID_PROVIDER_RESPONSE', config: resolvedConfig, origin: prepared.origin, destination: prepared.location, packageProfile: prepared.packageProfile, errors: [{ code: 'COORDINADORA_RESULT_CONTRACT_INVALID', status: 502, retryable: false }] });
    }
    return {
      ...baseResult({ status: quote.simulated === true ? 'SIMULATED_SUCCESS' : 'PRICE_SELECTION_PENDING', config: resolvedConfig, origin: prepared.origin, destination: prepared.location, packageProfile: prepared.packageProfile }),
      quote: {
        fleteFijo: quote.fleteFijo ?? null,
        fleteVariable: quote.fleteVariable ?? null,
        fleteTotal: quote.fleteTotal ?? null,
        impuestos: quote.impuestos ?? null,
        valorEnvio: quote.valorEnvio ?? null,
        pesoLiquidado: quote.pesoLiquidado ?? null,
        diasEntrega: quote.diasEntrega ?? null,
        providerId: quote.providerId ?? null,
        timestamp: quote.timestamp ?? null,
        priceSelectionPending: true,
      },
    };
  } catch (error) {
    const status = errorStatus(error);
    const destination = error.code?.startsWith('DANE_') ? null : undefined;
    return baseResult({ status, config: resolvedConfig, destination, errors: [safeError(error)] });
  }
};

module.exports = { PROVIDER, quoteNationalShipping, errorStatus };
