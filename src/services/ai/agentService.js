const { AI_LIMITS } = require('./constants');
const { AIServiceError } = require('./errors');
const { validateProfile, assertCustomerFacingMessage } = require('./contract');
const { isRecommendationEligibleProduct } = require('./candidates/catalogEligibility');
const { toPublicRecommendations } = require('./recommendationProjection');

const AGENT_TOOL_CALL_LIMIT = 2;
const CLAIM_KEYS = new Set(['productId', 'name', 'brand', 'routineStep', 'sizeLabel', 'suitableSkinTypes', 'suitableConditions', 'targets', 'availability', 'price']);
const fail = (message) => { throw new AIServiceError('INVALID_AI_RESPONSE', message, 502); };

const validateAgentSegments = (segments, evidenceById) => {
  if (!Array.isArray(segments) || segments.length > 8) fail('La respuesta del agente no contiene segmentos válidos.');
  return segments.map((segment) => {
    if (!segment || typeof segment !== 'object' || Array.isArray(segment) || Object.keys(segment).some((key) => !['kind', 'productId', 'evidenceKeys', 'text'].includes(key))) fail('Un segmento de la respuesta no es válido.');
    if (!['GENERAL', 'PRODUCT_FACT'].includes(segment.kind) || typeof segment.text !== 'string' || !segment.text.trim() || segment.text.length > AI_LIMITS.responseMessage) fail('Un segmento de la respuesta no es válido.');
    assertCustomerFacingMessage(segment.text.trim());
    if (segment.kind === 'GENERAL') {
      if (segment.productId !== null || !Array.isArray(segment.evidenceKeys) || segment.evidenceKeys.length) fail('El segmento general no es válido.');
      return { kind: segment.kind, productId: null, evidenceKeys: [], text: segment.text.trim() };
    }
    if (typeof segment.productId !== 'string' || !Array.isArray(segment.evidenceKeys) || !segment.evidenceKeys.length || segment.evidenceKeys.some((key) => !CLAIM_KEYS.has(key))) fail('El segmento de Product no está fundamentado.');
    const evidence = evidenceById.get(segment.productId);
    if (!evidence) fail('La respuesta del agente introdujo un Product no verificado.');
    for (const key of segment.evidenceKeys) {
      const value = evidence[key];
      if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) fail('La respuesta del agente usa evidencia de Product insuficiente.');
    }
    return { kind: segment.kind, productId: segment.productId, evidenceKeys: [...new Set(segment.evidenceKeys)], text: segment.text.trim() };
  });
};

const mergeAgentProfile = (stateProfile, outputProfile, updatedFields) => {
  const validated = validateProfile(outputProfile);
  const allowed = ['skinType', 'conditions', 'targets', 'budget', 'routinePreference'];
  if (!Array.isArray(updatedFields) || updatedFields.some((field) => !allowed.includes(field))) fail('La actualización de perfil del agente no es válida.');
  return { ...stateProfile, ...Object.fromEntries([...new Set(updatedFields)].map((field) => [field, validated[field]])) };
};

const createAgentService = ({ provider, toolFacade, finalProductRepository = null } = {}) => {
  if (!provider || typeof provider.runAgentTurn !== 'function' || !toolFacade) throw new TypeError('El proveedor y las herramientas del agente son obligatorios.');

  return {
    async advise({ request, state }) {
      const result = await provider.runAgentTurn({
        message: request.message,
        history: request.history,
        conversationState: state,
        tools: toolFacade.definitions,
        maxToolCalls: AGENT_TOOL_CALL_LIMIT,
        executeTool: (name, args) => toolFacade.execute(name, args, { state }),
      });
      if (!result || !result.output || !Array.isArray(result.toolResults)) throw new AIServiceError('INVALID_AI_RESPONSE', 'El agente no devolvió una respuesta válida.', 502);
      const output = result.output;
      const allowedKeys = ['mode', 'profile', 'updatedProfileFields', 'segments', 'selectedProductIds'];
      if (Object.keys(output).some((key) => !allowedKeys.includes(key))) fail('La respuesta del agente contiene campos no permitidos.');
      if (!['FOLLOW_UP', 'ANSWER', 'RECOMMENDATION'].includes(output.mode)) fail('El modo de respuesta del agente no es válido.');
      const profile = mergeAgentProfile(state.profile, output.profile, output.updatedProfileFields);
      const evidenceById = new Map();
      const purchasableById = new Map();
      const referenceArtifacts = [];
      for (const toolResult of result.toolResults) {
        for (const item of toolResult.products || []) {
          const id = String(item.id || item.product?.id || item.productId || '');
          if (!id) continue;
          evidenceById.set(id, item);
          if (item.product) {
            referenceArtifacts.push({ productId: id, routineStep: item.routineStep || item.product.routineStep || null });
            if (item.availability?.purchasable !== false) purchasableById.set(id, item.product);
          }
        }
        for (const item of toolResult.recommendations || []) {
          const id = String(item.product?.id || '');
          if (id) {
            evidenceById.set(id, { ...evidenceById.get(id), ...item.product, availability: { purchasable: true } });
            purchasableById.set(id, item.product);
            referenceArtifacts.push({ productId: id, routineStep: item.product.routineStep || null });
          }
        }
      }
      const segments = validateAgentSegments(output.segments, evidenceById);
      const selectedIds = Array.isArray(output.selectedProductIds) ? [...new Set(output.selectedProductIds.map(String))] : [];
      if (selectedIds.length > 3 || selectedIds.some((id) => !purchasableById.has(id))) fail('La respuesta del agente seleccionó un Product no elegible.');
      if (output.mode === 'RECOMMENDATION' && !selectedIds.length) fail('La respuesta del agente no seleccionó Products.');
      if (output.mode !== 'RECOMMENDATION' && selectedIds.length) fail('Solo una recomendación puede seleccionar Products.');
      let selectedProducts = selectedIds.map((id) => purchasableById.get(id));
      if (selectedProducts.length && finalProductRepository?.findCurrentEligibleProducts) {
        const currentRows = await finalProductRepository.findCurrentEligibleProducts(selectedIds);
        const currentById = new Map(currentRows.filter(isRecommendationEligibleProduct).map((product) => [String(product.id), product]));
        if (selectedIds.some((id) => !currentById.has(id))) fail('Un Product seleccionado dejó de ser elegible.');
        selectedProducts = selectedIds.map((id) => currentById.get(id));
      }
      const recommendations = output.mode === 'RECOMMENDATION'
        ? toPublicRecommendations({ selectedProducts, reasons: selectedProducts.map((product) => ({ productId: product.id, reason: 'Selección basada en la información verificada del catálogo de NARI.' })) })
        : [];
      const message = segments.map((segment) => segment.text).join(' ').trim();
      if (!message) fail('La respuesta del agente no contiene texto.');
      const lastTool = result.toolResults[result.toolResults.length - 1];
      const intent = lastTool?.tool === 'get_product_information'
        ? 'PRODUCT_INFO'
        : lastTool?.mode === 'DISCOVERY'
          ? 'DISCOVERY'
          : selectedIds.length || lastTool?.mode === 'ALTERNATIVE' || lastTool?.mode === 'RECOMMENDATION'
            ? 'PRODUCT_SELECTION'
            : 'GENERAL_SKINCARE';
      return {
        intent,
        mode: output.mode,
        message,
        profile,
        recommendations,
        __agentProfileDelta: Object.fromEntries((output.updatedProfileFields || []).map((field) => [field, profile[field]])),
        __referenceArtifacts: [...new Map(referenceArtifacts.map((item) => [item.productId, item])).values()].slice(0, 8),
        __agentToolCalls: result.toolCallCount || 0,
      };
    },
  };
};

module.exports = { AGENT_TOOL_CALL_LIMIT, createAgentService, validateAgentSegments };
