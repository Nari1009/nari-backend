const { AI_LIMITS } = require('./constants');
const { AIServiceError } = require('./errors');
const { validateRequest, validateProviderOutput } = require('./contract');
const { validateProviderReasoningOutput } = require('./reasoningContract');
const { assessSafety, assertNoPrivilegedInstruction } = require('./safety');
const { createOpenAIProvider } = require('./providers/openaiProvider');
const { isRecommendationEligibleProduct } = require('./candidates/catalogEligibility');
const { toProviderCandidates } = require('./candidates/candidateProviderProjection');
const { toPublicRecommendations } = require('./recommendationProjection');

const publicReasoningResponse = ({ intent, reasoning, recommendations = [] }) => ({
  intent,
  mode: reasoning.mode,
  message: reasoning.message,
  profile: reasoning.profile,
  recommendations,
});

const createAIService = ({ provider = createOpenAIProvider(), candidateService = null, finalProductRepository = null, routineService = null } = {}) => ({
  async advise(input) {
    const request = validateRequest(input);
    assertNoPrivilegedInstruction(request);
    const safetyResponse = assessSafety(request);
    if (safetyResponse) return { ...safetyResponse, recommendations: [] };
    let output;
    try {
      output = await provider.interpretConversation(request);
    } catch (error) {
      if (error instanceof AIServiceError) throw error;
      throw new AIServiceError('AI_UNAVAILABLE', 'El servicio AI no está disponible.', 503);
    }
    const validated = validateProviderOutput(output);
    if (validated.mode !== 'RECOMMENDATION') {
      return { ...validated, recommendations: [] };
    }
    if (validated.intent === 'BUILD_ROUTINE' && routineService && typeof provider.reasonRoutine === 'function') {
      return routineService.build({ request, interpretation: validated, provider });
    }
    if (!candidateService || !finalProductRepository || typeof provider.reasonAmongCandidates !== 'function') {
      return {
        ...validated,
        message: 'La selección de productos se habilitará cuando esté conectado el motor de catálogo de NARI.',
        recommendations: [],
      };
    }

    const candidateResult = await candidateService.search({
      intent: validated.intent,
      profile: validated.profile,
      currentProductId: request.context?.currentProductId || null,
    });
    if (!candidateResult.searched || candidateResult.candidates.length === 0) {
      return {
        ...validated,
        mode: 'ANSWER',
        message: 'No encontré candidatos de catálogo suficientemente compatibles para esta solicitud.',
        recommendations: [],
      };
    }

    let reasoningOutput;
    try {
      reasoningOutput = await provider.reasonAmongCandidates({
        request,
        interpretation: validated,
        candidates: toProviderCandidates(candidateResult.candidates),
      });
    } catch (error) {
      if (error instanceof AIServiceError) throw error;
      throw new AIServiceError('AI_UNAVAILABLE', 'El servicio AI no está disponible.', 503);
    }
    const allowedProductIds = candidateResult.candidates.map((candidate) => String(candidate.productId));
    const reasoning = validateProviderReasoningOutput(reasoningOutput, { allowedProductIds });
    if (reasoning.mode !== 'RECOMMENDATION') return publicReasoningResponse({ intent: validated.intent, reasoning });

    const selectedRows = await finalProductRepository.findCurrentEligibleProducts(reasoning.selectedProductIds);
    const eligibleById = new Map(selectedRows.filter(isRecommendationEligibleProduct).map((product) => [String(product.id), product]));
    const stillEligible = reasoning.selectedProductIds.map((id) => eligibleById.get(String(id))).filter(Boolean);
    if (stillEligible.length === 0) {
      return publicReasoningResponse({
        intent: validated.intent,
        reasoning: {
          mode: 'ANSWER',
          message: 'Los candidatos seleccionados ya no están disponibles para confirmación.',
          profile: reasoning.profile,
        },
      });
    }
    return publicReasoningResponse({
      intent: validated.intent,
      reasoning,
      recommendations: toPublicRecommendations({ selectedProducts: stillEligible, reasons: reasoning.reasons }),
    });
  },
  limits: AI_LIMITS,
  discoverCandidates(input) {
    if (!candidateService) return Promise.resolve({ searched: false, reason: 'CANDIDATE_SERVICE_NOT_CONFIGURED', candidates: [] });
    return candidateService.search(input);
  },
});

module.exports = { createAIService };
