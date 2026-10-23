const assert = require('node:assert/strict');
const test = require('node:test');
const { createOpenAIProvider } = require('../src/services/ai/providers/openaiProvider');

const state = {
  profile: { skinType: 'DRY', conditions: ['SENSITIVE'], targets: ['HYDRATION'], budget: '250000', routinePreference: 'simple' },
  ownership: {},
  artifacts: {},
  conversation: {},
};

const searchArgs = (routineSteps = ['MOISTURIZER']) => ({
  mode: 'RECOMMENDATION',
  routineSteps,
  skinTypes: ['DRY'],
  conditions: ['SENSITIVE'],
  targets: ['HYDRATION'],
  limit: 3,
  referenceProductIds: [],
  profile: null,
  brand: null,
});

const response = (body) => ({ ok: true, async json() { return body; } });
const call = (id, args) => ({ type: 'function_call', call_id: id, name: 'search_catalog', arguments: JSON.stringify(args) });
const finalOutput = (text = 'Respuesta final') => ({ output_text: JSON.stringify({ mode: 'ANSWER', profile: {}, updatedProfileFields: [], segments: [{ kind: 'GENERAL', productId: null, evidenceKeys: [], text }], selectedProductIds: [] }) });

test('equivalent search calls are served from cache and do not consume tool budget twice', async () => {
  const requests = [
    { output: [call('one', searchArgs())] },
    { output: [call('two', { ...searchArgs(), conditions: ['SENSITIVE'], targets: ['HYDRATION'] })] },
    finalOutput(),
  ];
  let executions = 0;
  const provider = createOpenAIProvider({ apiKey: 'test-key', enabled: true, fetchImpl: async () => response(requests.shift()) });
  const result = await provider.runAgentTurn({ message: 'Busca un hidratante', conversationState: state, tools: [{}], maxToolCalls: 2, executeTool: async () => { executions += 1; return { tool: 'search_catalog', products: [] }; } });
  assert.equal(executions, 1);
  assert.equal(result.toolCallCount, 1);
  assert.equal(result.output.mode, 'ANSWER');
});

test('new calls are capped and the model receives one finalization turn instead of AGENT_TOOL_LIMIT', async () => {
  const requests = [
    { output: [call('one', searchArgs())] },
    { output: [call('two', searchArgs(['SERUM'])), call('three', searchArgs(['TONER']))] },
    finalOutput('Pude cerrar la búsqueda con la evidencia disponible.'),
  ];
  const executed = [];
  const provider = createOpenAIProvider({ apiKey: 'test-key', enabled: true, fetchImpl: async () => response(requests.shift()) });
  const result = await provider.runAgentTurn({ message: 'Busca opciones', conversationState: state, tools: [{}], maxToolCalls: 2, executeTool: async (name, args) => { executed.push(args.routineSteps); return { tool: name, products: [] }; } });
  assert.deepEqual(executed, [['MOISTURIZER'], ['SERUM']]);
  assert.equal(result.toolCallCount, 2);
  assert.equal(result.output.mode, 'ANSWER');
});

test('tool-limit recovery returns verified candidates when finalization still asks for tools', async () => {
  const requests = [
    { output: [call('one', searchArgs())] },
    { output: [call('two', searchArgs(['SERUM'])), call('three', searchArgs(['TONER']))] },
    { output: [call('four', searchArgs(['CLEANSER']))] },
  ];
  const candidate = { id: 'verified-moisturizer', availability: { purchasable: true }, product: { id: 'verified-moisturizer' } };
  const provider = createOpenAIProvider({ apiKey: 'test-key', enabled: true, fetchImpl: async () => response(requests.shift()) });
  const result = await provider.runAgentTurn({ message: 'Busca opciones', conversationState: state, tools: [{}], maxToolCalls: 2, executeTool: async (_name, args) => ({ tool: 'search_catalog', products: args.routineSteps[0] === 'SERUM' ? [candidate] : [] }) });
  assert.equal(result.toolCallCount, 2);
  assert.equal(result.output.mode, 'RECOMMENDATION');
  assert.deepEqual(result.output.selectedProductIds, ['verified-moisturizer']);
});
