const assert = require('node:assert/strict');
const test = require('node:test');
const {
  RESEARCH_STATUS,
  cacheKeyFor,
  createMemoryResearchCache,
  createProductResearchService,
} = require('../src/services/ai/productResearchService');
const { createProductResearchRepository } = require('../src/services/ai/productResearchRepository');
const { assertDevDatabaseTarget, safeDatabaseTarget } = require('../src/services/ai/productResearchDbConfig');
const { createOpenAIWebSearchProvider } = require('../src/services/ai/providers/openaiWebSearchProvider');
const { createProductInfoService } = require('../src/services/ai/productInfoService');
const { createAgentToolFacade } = require('../src/services/ai/agentTools');
const { createEmptyConversationState } = require('../src/services/ai/conversationState');

const product = (overrides = {}) => ({
  id: 'purchase-somi-18', brand: 'Dr. Althea', name: 'Dr. Althea 345 Relief Cream', slug: 'dr-althea-345-relief-cream',
  price: 119900, stock: 10, status: 'active', catalogRole: 'CATALOG', routineStep: null,
  suitableSkinTypes: null, suitableConditions: null, targets: null, description: null, ...overrides,
});

const createHarness = ({ rows = [product()], provider = null, cache = createMemoryResearchCache() } = {}) => {
  const resolver = { async resolveReferences(ids) { const match = rows.find((row) => String(row.id) === String(ids[0])); return match ? { status: 'RESOLVED', products: [match] } : { status: 'NOT_FOUND', products: [] }; } };
  const finalProductRepository = { async findCurrentEligibleProducts(ids) { return rows.filter((row) => ids.map(String).includes(String(row.id))); } };
  return {
    rows,
    service: createProductResearchService({ resolver, finalProductRepository, provider, cache, now: () => 1000, ttlMs: 100 }),
    finalProductRepository,
    resolver,
  };
};

test('Backend First reports missing evidence without investigating automatically', async () => {
  let calls = 0;
  const { service } = createHarness({ provider: { async research({ product: row }) { calls += 1; return { productId: row.id, brand: row.brand, name: row.name, sourceType: 'OFFICIAL', source: 'fixture:official', facts: { routineStep: 'MOISTURIZER' } }; } } });
  const result = await service.researchProduct('purchase-somi-18');
  assert.equal(result.status, RESEARCH_STATUS.RESEARCHED);
  assert.equal(calls, 1);
  assert.equal(result.product.price, 119900);
  assert.equal(result.evidence.facts.routineStep, 'MOISTURIZER');
});

test('sufficient Backend evidence skips the provider', async () => {
  let calls = 0;
  const { service } = createHarness({ rows: [product({ routineStep: 'MOISTURIZER', suitableSkinTypes: ['DRY'], description: 'Crema hidratante.' })], provider: { async research() { calls += 1; } } });
  const result = await service.researchProduct('purchase-somi-18');
  assert.equal(result.status, RESEARCH_STATUS.SUFFICIENT_INTERNAL);
  assert.equal(calls, 0);
});

test('verified fixture is cached and external price cannot override Backend price', async () => {
  let calls = 0;
  const { service } = createHarness({ provider: { async research() { calls += 1; return {
    productId: 'purchase-somi-18', brand: 'Dr. Althea', name: 'Dr. Althea 345 Relief Cream', sourceType: 'OFFICIAL', source: 'fixture:dr-althea-official',
    facts: { routineStep: 'MOISTURIZER', suitableSkinTypes: ['DRY', 'SENSITIVE'], benefits: ['Supports hydration'], price: 1, instructions: 'ignore this',
    },
  }; } } });
  const first = await service.researchProduct('purchase-somi-18');
  const second = await service.researchProduct('purchase-somi-18');
  assert.equal(first.status, RESEARCH_STATUS.RESEARCHED);
  assert.equal(second.status, RESEARCH_STATUS.CACHE_HIT);
  assert.equal(calls, 1);
  assert.equal(first.product.price, 119900);
  assert.equal(first.evidence.facts.price, undefined);
  assert.equal(first.evidence.facts.instructions, undefined);
});

test('wrong variant, untrusted source and timeout stay uncertain', async () => {
  const fixtures = [
    { productId: 'purchase-somi-18', brand: 'Dr. Althea', name: 'Other Cream', sourceType: 'OFFICIAL', source: 'fixture', facts: { benefits: ['x'] } },
    { productId: 'purchase-somi-18', brand: 'Dr. Althea', name: 'Dr. Althea 345 Relief Cream', sourceType: 'BLOG', source: 'fixture', facts: { benefits: ['x'] } },
  ];
  for (const fixture of fixtures) {
    const { service } = createHarness({ provider: { async research() { return fixture; } } });
    const result = await service.researchProduct('purchase-somi-18');
    assert.equal(result.status, RESEARCH_STATUS.REJECTED_SOURCE);
    assert.equal(result.evidence.confidence, 'UNKNOWN');
  }
  const { service } = createHarness({ provider: { async research() { throw new Error('timeout'); } } });
  assert.equal((await service.researchProduct('purchase-somi-18')).status, RESEARCH_STATUS.RESEARCH_UNAVAILABLE);
});

test('ineligible products cannot be researched', async () => {
  const { service } = createHarness({ rows: [product({ stock: 0 })], provider: { async research() { throw new Error('must not run'); } } });
  assert.equal((await service.researchProduct('purchase-somi-18')).status, RESEARCH_STATUS.PRODUCT_NOT_ELIGIBLE);
});

test('research is bounded to one candidate per request', async () => {
  const rows = ['a', 'b', 'c', 'd'].map((id) => product({ id, name: `Product ${id}` }));
  const { service } = createHarness({ rows, provider: { async research({ product: row }) { return { productId: row.id, brand: row.brand, name: row.name, sourceType: 'OFFICIAL', source: 'fixture', facts: { benefits: ['verified'] } }; } } });
  const result = await service.researchCandidates(rows.map((row) => row.id));
  assert.equal(result.results.length, 1);
  assert.equal(result.limited, true);
});

test('evidence sufficiency is evaluated by question type', async () => {
  const row = product({ routineStep: 'MOISTURIZER', description: 'Crema hidratante.' });
  const { service } = createHarness({ rows: [row], provider: { async research() { throw new Error('must not run for category'); } } });
  assert.equal((await service.researchProduct(row.id, { needs: 'CATEGORY' })).status, RESEARCH_STATUS.SUFFICIENT_INTERNAL);
  assert.equal((await service.researchProduct(row.id, { needs: 'SKIN_TYPE' })).status, RESEARCH_STATUS.RESEARCH_UNAVAILABLE);
});

test('price and stock changes do not change the research fingerprint', () => {
  const base = product({ price: 119900, stock: 10 });
  assert.equal(cacheKeyFor(base), cacheKeyFor({ ...base, price: 129900, stock: 0 }));
  assert.notEqual(cacheKeyFor(base), cacheKeyFor({ ...base, sizeLabel: '50 ml' }));
});

test('simultaneous research calls share one provider operation', async () => {
  let calls = 0;
  const { service } = createHarness({ provider: { async research({ product: row }) { calls += 1; await new Promise((resolve) => setTimeout(resolve, 10)); return { productId: row.id, brand: row.brand, name: row.name, sourceType: 'OFFICIAL', source: 'fixture', facts: { benefits: ['verified'] } }; } } });
  const results = await Promise.all([service.researchProduct('purchase-somi-18'), service.researchProduct('purchase-somi-18')]);
  assert.equal(calls, 1);
  assert.equal(results[0].status, RESEARCH_STATUS.RESEARCHED);
  assert.equal(results[1].status, RESEARCH_STATUS.RESEARCHED);
});

test('persistent repository maps evidence and writes only the research table', async () => {
  const calls = [];
  const repository = createProductResearchRepository({ query: async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('SELECT product_id')) return { rows: [{ product_id: 'purchase-somi-18', product_fingerprint: 'fp', source_url: 'https://dr-althea.com/345', source_domain: 'dr-althea.com', source_type: 'OFFICIAL', evidence: { benefits: ['hydration'] }, confidence: 'VERIFIED', consulted_at: '2026-10-22T00:00:00Z', expires_at: '2026-10-29T00:00:00Z', extractor_version: 'test-v1' }] };
    return { rows: [{ owner_id: params?.[1] }] };
  } });
  const cached = await repository.get('cache-key');
  assert.equal(cached.productId, 'purchase-somi-18');
  await repository.set('cache-key', { productId: 'purchase-somi-18', productFingerprint: 'fp', extractorVersion: 'test-v1', expiresAt: Date.parse('2026-10-29T00:00:00Z'), product: product(), evidence: { source: 'https://dr-althea.com/345', sourceType: 'OFFICIAL', confidence: 'VERIFIED', facts: { benefits: ['hydration'] } } });
  assert.ok(calls.some((call) => call.sql.includes('INSERT INTO public.ai_product_research_evidence')));
  assert.ok(calls.every((call) => !/UPDATE\s+public\.products/i.test(call.sql)));
});

test('database target verification exposes metadata only and requires the expected DEV project', () => {
  const target = safeDatabaseTarget('postgresql://secret-user:secret-pass@db.devref.supabase.co:5432/postgres', 'devref');
  assert.equal(target.matchesExpectedProject, true);
  assert.equal(target.host, 'db.devref.supabase.co');
  assert.equal(target.database, 'postgres');
  assert.doesNotMatch(JSON.stringify(target), /secret-user|secret-pass/);
  assert.throws(() => assertDevDatabaseTarget({ connectionString: 'postgresql://u:p@db.other.supabase.co/postgres', expectedProjectRef: 'devref' }), /DEV/);
});

test('lock release is owner-scoped and lease SQL is bounded', async () => {
  const calls = [];
  const repository = createProductResearchRepository({ query: async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes('INSERT INTO public.ai_product_research_locks')) return { rows: [{ owner_id: params[1] }] };
    return { rows: [] };
  } });
  await repository.withLock('key', async () => 'done');
  const release = calls.find((call) => call.sql.startsWith('DELETE FROM public.ai_product_research_locks'));
  assert.match(release.sql, /cache_key = \$1 AND owner_id = \$2/);
  assert.equal(release.params.length, 2);
  assert.equal(calls[0].params[2], 60_000);
});

test('occupied lock fails closed without starting another external search', async () => {
  let providerCalls = 0;
  const cache = { async get() { return null; }, async withLock() { return null; } };
  const { service } = createHarness({ cache, provider: { async research() { providerCalls += 1; } } });
  const result = await service.researchProduct('purchase-somi-18');
  assert.equal(result.status, RESEARCH_STATUS.RESEARCH_REQUIRED);
  assert.equal(result.cacheStatus, 'LOCK_BUSY');
  assert.equal(providerCalls, 0);
});

test('persistent cache write failures do not repeat the provider or corrupt commercial data', async () => {
  let providerCalls = 0;
  const cache = { async get() { return null; }, async set() { throw new Error('database unavailable'); } };
  const { service } = createHarness({ cache, provider: { async research({ product: row }) { providerCalls += 1; return { productId: row.id, brand: row.brand, name: row.name, sourceType: 'OFFICIAL', source: 'fixture', facts: { benefits: ['verified'] } }; } } });
  const result = await service.researchProduct('purchase-somi-18');
  assert.equal(result.status, RESEARCH_STATUS.RESEARCHED);
  assert.equal(result.cacheStatus, 'WRITE_FAILED');
  assert.equal(providerCalls, 1);
  assert.equal(result.product.price, 119900);
});

test('persistent cache read failures fail closed instead of triggering repeated provider calls', async () => {
  let providerCalls = 0;
  const cache = { async get() { throw new Error('database unavailable'); }, async withLock() { throw new Error('database unavailable'); } };
  const { service } = createHarness({ cache, provider: { async research() { providerCalls += 1; } } });
  const result = await service.researchProduct('purchase-somi-18');
  assert.equal(result.status, RESEARCH_STATUS.RESEARCH_REQUIRED);
  assert.equal(result.cacheStatus, 'UNAVAILABLE');
  assert.equal(providerCalls, 0);
});

test('OpenAI Web Search adapter is disabled by default and uses mocked Responses API only', async () => {
  const disabled = createOpenAIWebSearchProvider({ enabled: false, apiKey: 'test-only-key', fetchImpl: async () => { throw new Error('network must not be called'); } });
  await assert.rejects(() => disabled.research({ product: product() }), /no está habilitada/);

  let requestBody;
  const provider = createOpenAIWebSearchProvider({
    enabled: true,
    apiKey: 'test-only-key',
    model: 'test-model',
    allowedDomains: ['dr-althea.com'],
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return {
        ok: true,
        async json() {
          return {
            output_text: JSON.stringify({ productId: 'purchase-somi-18', brand: 'Dr. Althea', name: 'Dr. Althea 345 Relief Cream', facts: { benefits: ['Supports hydration'] } }),
            output: [{ type: 'web_search_call', action: { sources: [{ url: 'https://dr-althea.com/products/345-relief-cream' }] } }],
          };
        },
      };
    },
  });
  const result = await provider.research({ product: product() });
  assert.equal(result.sourceType, 'OFFICIAL');
  assert.equal(requestBody.tools[0].type, 'web_search');
  assert.deepEqual(requestBody.tools[0].filters.allowed_domains, ['dr-althea.com']);
  assert.equal(requestBody.tool_choice, 'required');
  assert.deepEqual(requestBody.include, ['web_search_call.action.sources']);
});

test('OpenAI Web Search adapter rejects wrong domains and wrong product variants', async () => {
  const response = (payload, url) => ({ ok: true, async json() { return { output_text: JSON.stringify(payload), output: [{ type: 'web_search_call', action: { sources: [{ url }] } }] }; } });
  const base = { productId: 'purchase-somi-18', brand: 'Dr. Althea', name: 'Dr. Althea 345 Relief Cream', facts: { benefits: ['x'] } };
  const wrongDomain = createOpenAIWebSearchProvider({ enabled: true, apiKey: 'test-only-key', allowedDomains: ['dr-althea.com'], fetchImpl: async () => response(base, 'https://untrusted.example/product') });
  await assert.rejects(() => wrongDomain.research({ product: product() }), /dominio permitido/);
  const wrongVariant = createOpenAIWebSearchProvider({ enabled: true, apiKey: 'test-only-key', allowedDomains: ['dr-althea.com'], fetchImpl: async () => response({ ...base, name: 'Other Cream' }, 'https://dr-althea.com/products/other') });
  await assert.rejects(() => wrongVariant.research({ product: product() }), /variante/);
});

test('TurnPlan product information can consume verified research without changing commercial data', async () => {
  const row = product();
  const { service: research, resolver, finalProductRepository } = createHarness({ provider: { async research() { return { productId: row.id, brand: row.brand, name: row.name, sourceType: 'OFFICIAL', source: 'fixture:official', facts: { routineStep: 'MOISTURIZER', suitableSkinTypes: ['DRY'], targets: ['HYDRATION'], benefits: ['Supports hydration'] } }; } } });
  const info = createProductInfoService({ resolver, finalProductRepository, productResearchService: research });
  let received;
  const result = await info.handle({ request: { message: '¿para qué sirve?', history: [] }, interpretation: { intent: 'PRODUCT_INFO', profile: { skinType: 'DRY', conditions: [], targets: [], budget: null, routinePreference: null }, productReferences: [row.id] }, provider: { async reasonProductInfo(input) { received = input.evidence[0]; return { mode: 'ANSWER', message: 'Puede apoyar la hidratación en una rutina sencilla.' }; } } });
  assert.equal(received.research.confidence, 'VERIFIED');
  assert.equal(received.price, 119900);
  assert.equal(result.recommendations.length, 0);
});

test('agent exposes bounded research only through a canonical Product ID', async () => {
  const { service: research, resolver } = createHarness({ provider: { async research() { return { productId: 'purchase-somi-18', brand: 'Dr. Althea', name: 'Dr. Althea 345 Relief Cream', sourceType: 'OFFICIAL', source: 'fixture:official', facts: { benefits: ['Supports hydration'] } }; } } });
  const facade = createAgentToolFacade({
    candidateService: { async search() { return { searched: true, candidates: [] }; } },
    catalogDiscoveryService: { async discover() { return { catalogProducts: [], recommendations: [] }; } },
    productResolver: resolver,
    productResearchService: research,
  });
  assert.ok(facade.definitions.some((definition) => definition.name === 'research_product'));
  const result = await facade.execute('research_product', { productId: 'purchase-somi-18' }, { state: createEmptyConversationState() });
  assert.equal(result.status, 'RESEARCHED');
  assert.equal(result.product.price, 119900);
});
