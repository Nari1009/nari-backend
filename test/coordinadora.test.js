const assert = require('node:assert/strict');
const test = require('node:test');
const {
  CoordinadoraError,
  CoordinadoraOAuth,
  DaneCatalogError,
  PackageProfileError,
  getConfig,
  quoteNational,
  normalizeQuote,
  buildProviderPayload,
  createDaneResolver,
  createOfficialDaneResolver,
  prepareNationalQuoteInput,
  validatePackageProfile,
  buildStandardQuotePayload,
} = require('../src/services/coordinadora');

const env = {
  COORDINADORA_ENABLED: 'true',
  COORDINADORA_ENV: 'test',
  COORDINADORA_API_BASE_URL: 'https://api.example.test',
  COORDINADORA_OAUTH_URL: 'https://oauth.example.test/token',
  COORDINADORA_CONSUMER_KEY: 'consumer-key',
  COORDINADORA_CONSUMER_SECRET: 'consumer-secret',
  COORDINADORA_NIT: 'nit',
  COORDINADORA_DIV: '01',
  COORDINADORA_ACCOUNT: 'account',
  COORDINADORA_PRODUCT: 'product',
  COORDINADORA_API_KEY: 'api-key',
  COORDINADORA_API_SECRET: 'commercial-secret',
  COORDINADORA_ORIGIN_DANE: '05001000',
  COORDINADORA_PACKAGE_PROFILE_ID: 'NARI_STANDARD_BOX',
  COORDINADORA_PACKAGE_PROFILE_NAME: 'Caja estándar NARI',
  COORDINADORA_PACKAGE_LENGTH_CM: '24',
  COORDINADORA_PACKAGE_WIDTH_CM: '13.5',
  COORDINADORA_PACKAGE_HEIGHT_CM: '6.8',
  COORDINADORA_PACKAGE_QUOTE_WEIGHT_KG: '2',
  COORDINADORA_PACKAGE_UNIT: 'cm',
  COORDINADORA_PACKAGE_UBL: 'TEST_UBL_FIXTURE',
};

const payload = {
  codigo_postal_origen: '', codigo_postal_destino: '', origen: '05001000', destino: '11001000',
  valoracion: 100000, nivel_servicio: '',
  detalle: [{ ubl: 'configured', alto: '20', ancho: '20', largo: '50', peso: '2', unidades: '1' }],
};

test('Coordinadora permanece desactivada sin credenciales', () => {
  assert.deepEqual(getConfig({ COORDINADORA_ENABLED: 'false' }), { enabled: false, environment: null });
});

test('configuración activa exige todos los valores sin exponerlos', () => {
  assert.throws(() => getConfig({ ...env, COORDINADORA_API_KEY: '' }), (error) => error.code === 'COORDINADORA_CONFIG_INCOMPLETE' && !error.message.includes('commercial-secret'));
});

test('OAuth reutiliza el token y coordina solicitudes concurrentes', async () => {
  let calls = 0;
  const oauth = new CoordinadoraOAuth({ config: { ...getConfig(env), timeoutMs: 1000, tokenSkewSeconds: 0 }, fetchImpl: async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return new Response(JSON.stringify({ access_token: 'token', expires_in: 300 }), { status: 200 });
  } });
  const tokens = await Promise.all([oauth.getToken(), oauth.getToken(), oauth.getToken()]);
  assert.deepEqual(tokens, ['token', 'token', 'token']);
  assert.equal(calls, 1);
});

test('token expirado se renueva', async () => {
  let now = 1000;
  let calls = 0;
  const oauth = new CoordinadoraOAuth({ config: { ...getConfig(env), timeoutMs: 1000, tokenSkewSeconds: 0 }, now: () => now, fetchImpl: async () => {
    calls += 1;
    return new Response(JSON.stringify({ access_token: `token-${calls}`, expires_in: 1 }), { status: 200 });
  } });
  assert.equal(await oauth.getToken(), 'token-1');
  now += 2000;
  assert.equal(await oauth.getToken(), 'token-2');
});

test('cotización exitosa se normaliza sin elegir aún el importe comercial', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url === env.COORDINADORA_OAUTH_URL) return new Response(JSON.stringify({ access_token: 'token', expires_in: 300 }), { status: 200 });
    return new Response(JSON.stringify({ isError: false, id: 'quote-1', timestamp: 'now', data: { flete_fijo: 1000, flete_variable: 200, flete_total: 1200, valor_envio: 1300, impuestos: 100, dias_entrega: 3 } }), { status: 200 });
  };
  const result = await quoteNational({ config: getConfig(env), payload, fetchImpl });
  assert.equal(result.fleteTotal, 1200);
  assert.equal(result.valorEnvio, 1300);
  assert.equal(result.shippingAmount, null);
  assert.equal(result.commercialAmountSelectionPending, true);
  assert.equal(calls.length, 2);
});

test('401 del cotizador renueva el token una sola vez', async () => {
  let oauthCalls = 0;
  let quoteCalls = 0;
  const fetchImpl = async (url) => {
    if (url === env.COORDINADORA_OAUTH_URL) { oauthCalls += 1; return new Response(JSON.stringify({ access_token: `token-${oauthCalls}`, expires_in: 300 }), { status: 200 }); }
    quoteCalls += 1;
    if (quoteCalls === 1) return new Response(JSON.stringify({ error: 'expired' }), { status: 401 });
    return new Response(JSON.stringify({ isError: false, data: { flete_total: 1000, valor_envio: 1000 } }), { status: 200 });
  };
  const result = await quoteNational({ config: getConfig(env), payload, fetchImpl });
  assert.equal(result.fleteTotal, 1000);
  assert.equal(oauthCalls, 2);
});

test('errores HTTP, timeout y respuestas malformadas se normalizan', async () => {
  const oauth = { getToken: async () => 'token', invalidate() {} };
  await assert.rejects(() => quoteNational({ config: getConfig(env), payload, oauth, fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'bad' } }), { status: 400 }) }), (error) => error.code === 'COORDINADORA_VALIDATION_ERROR' && error.providerStatus === 400);
  await assert.rejects(() => quoteNational({ config: getConfig(env), payload, oauth, fetchImpl: async () => new Response('<html>', { status: 200 }) }), (error) => error.code === 'COORDINADORA_MALFORMED_RESPONSE');
  await assert.rejects(() => quoteNational({ config: getConfig(env), payload, oauth, fetchImpl: async () => { const error = new Error('aborted'); error.name = 'AbortError'; throw error; } }), (error) => error.code === 'COORDINADORA_TIMEOUT');
});

test('validación evita activar una cotización sin datos físicos', async () => {
  await assert.rejects(() => quoteNational({ config: getConfig(env), payload: { ...payload, detalle: [{}] }, fetchImpl: async () => { throw new Error('no debe llamarse'); } }), (error) => error.code === 'COORDINADORA_PACKAGE_DATA_INCOMPLETE');
});

test('DANE resuelve únicamente coincidencias exactas no ambiguas', () => {
  const resolver = createDaneResolver({ source: 'fixture oficial verificado', version: 'test-1', entries: [{ department: 'Antioquia', municipality: 'Bello', code: '05088' }] });
  assert.equal(resolver.resolve({ department: 'antioquia', municipality: 'BÉLLO' }), '05088');
  assert.throws(() => resolver.resolve({ department: 'Antioquia', municipality: 'Medellín' }), DaneCatalogError);
});

test('perfil de empaque incompleto es rechazado', () => {
  assert.throws(() => validatePackageProfile({ id: 'standard', name: 'Standard' }), PackageProfileError);
});

test('normalización rechaza respuestas sin data', () => {
  assert.throws(() => normalizeQuote({ isError: false }), CoordinadoraError);
});

test('configuración del perfil estándar conserva dimensiones y peso de referencia', () => {
  const config = getConfig(env);
  const result = buildStandardQuotePayload({ config, destinationDane: '11001', declaredValue: 100000 });
  assert.equal(result.origen, '05001000');
  assert.equal(result.destino, '11001');
  assert.deepEqual(result.detalle[0], { ubl: 'TEST_UBL_FIXTURE', alto: '6.8', ancho: '13.5', largo: '24', peso: '2', unidades: '1' });
  assert.equal(Object.hasOwn(result, 'apikey'), false);
  assert.equal(Object.hasOwn(result, 'clave'), false);
  const providerPayload = buildProviderPayload(config, result);
  assert.equal(providerPayload.apikey, 'api-key');
  assert.equal(providerPayload.clave, 'commercial-secret');
});

test('el mismo perfil estándar se usa sin depender de la cantidad de productos', () => {
  const config = getConfig(env);
  const one = buildStandardQuotePayload({ config, destinationDane: '05088', declaredValue: 1 });
  const many = buildStandardQuotePayload({ config, destinationDane: '05088', declaredValue: 999999 });
  assert.deepEqual(one.detalle, many.detalle);
});

test('origen, UBL y valor declarado incompletos fallan controladamente', () => {
  const config = getConfig(env);
  assert.throws(() => buildStandardQuotePayload({ config: { ...config, originDane: '' }, destinationDane: '05088', declaredValue: 1 }), /incompleta/);
  assert.throws(() => buildStandardQuotePayload({ config: { ...config, standardPackage: { ...config.standardPackage, ubl: '' } }, destinationDane: '05088', declaredValue: 1 }), /incompleta/);
  assert.throws(() => buildStandardQuotePayload({ config, destinationDane: '05088', declaredValue: -1 }), /declarado/);
});

test('catálogo DANE exige fuente y versión y rechaza ambigüedad', () => {
  assert.throws(() => createDaneResolver({ entries: [] }), (error) => error.code === 'DANE_CATALOG_METADATA_REQUIRED');
  const resolver = createDaneResolver({ source: 'fixture', version: '1', entries: [
    { department: 'Antioquia', municipality: 'Bello', code: '05088' },
    { department: 'Antioquia', municipality: 'Bello', code: '05088000' },
  ] });
  assert.throws(() => resolver.resolve({ department: 'Antioquia', municipality: 'Bello' }), (error) => error.code === 'DANE_CODE_AMBIGUOUS');
});

test('catálogo oficial resuelve Bello, Medellín y Bogotá D.C.', () => {
  const resolver = createOfficialDaneResolver();
  assert.equal(resolver.size, 1122);
  assert.equal(resolver.resolveLocation({ department: 'Antioquia', municipality: 'Bello' }).daneCode, '05088');
  assert.equal(resolver.resolveLocation({ department: 'Antioquia', municipality: 'Medellín' }).daneCode, '05001');
  assert.equal(resolver.resolveLocation({ department: 'Bogotá, D.C.', municipality: 'Bogotá, D.C.' }).daneCode, '11001');
  assert.equal(resolver.metadata.source, 'Datos Abiertos Colombia / DANE');
});

test('preparación nacional devuelve mapeo pendiente sin inventar código Coordinadora', () => {
  const config = getConfig(env);
  const result = prepareNationalQuoteInput({ country: 'CO', department: 'Antioquia', city: 'Bello', declaredValue: 100000, config, daneResolver: createOfficialDaneResolver(), providerCodeResolver: () => null, price: 1, dimensions: { length: 1 } });
  assert.equal(result.status, 'PENDING_PROVIDER_MAPPING');
  assert.equal(result.location.daneCode, '05088');
  assert.equal(result.location.providerCode, null);
  assert.equal(result.payload, null);
});

test('preparación nacional construye payload solo con mapeos confiables', () => {
  const config = { ...getConfig(env), originProviderCode: '05088000' };
  const result = prepareNationalQuoteInput({ country: 'Colombia', department: 'Antioquia', city: 'Bello', declaredValue: 100000, config, daneResolver: createOfficialDaneResolver(), providerCodeResolver: () => '11001000' });
  assert.equal(result.status, 'READY_FOR_PROVIDER_ADAPTER');
  assert.equal(result.payload.origen, '05088000');
  assert.equal(result.payload.destino, '11001000');
  assert.equal(result.payload.detalle[0].peso, '2');
});

test('preparación rechaza país, municipio, catálogo o valor inválidos', () => {
  const config = getConfig(env);
  const resolver = createOfficialDaneResolver();
  assert.throws(() => prepareNationalQuoteInput({ country: 'EC', department: 'Antioquia', city: 'Bello', declaredValue: 1, config, daneResolver: resolver }), (error) => error.code === 'COORDINADORA_COUNTRY_UNSUPPORTED');
  assert.throws(() => prepareNationalQuoteInput({ country: 'CO', department: 'Antioquia', city: 'No existe', declaredValue: 1, config, daneResolver: resolver }), (error) => error.code === 'DANE_CODE_NOT_FOUND');
  assert.throws(() => prepareNationalQuoteInput({ country: 'CO', department: 'Antioquia', city: 'Bello', declaredValue: -1, config, daneResolver: resolver }), (error) => error.code === 'COORDINADORA_DECLARED_VALUE_INVALID');
  assert.throws(() => createDaneResolver({ source: 'verified', version: '1', entries: [{ department: 'A', municipality: 'B', code: 'not-code' }] }), (error) => error.code === 'DANE_CATALOG_INVALID');
  assert.throws(() => createDaneResolver({ source: 'unknown source', version: '1', entries: [] }), (error) => error.code === 'DANE_CATALOG_METADATA_REQUIRED');
});
