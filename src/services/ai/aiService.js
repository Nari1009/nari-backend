const { AI_LIMITS } = require('./constants');
const { AIServiceError } = require('./errors');
const { validateRequest, validateProviderOutput } = require('./contract');
const { assessSafety, assertNoPrivilegedInstruction } = require('./safety');
const { createOpenAIProvider } = require('./providers/openaiProvider');

const createAIService = ({ provider = createOpenAIProvider(), candidateService = null } = {}) => ({
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
    if (validated.mode === 'RECOMMENDATION') {
      return {
        ...validated,
        mode: 'RECOMMENDATION',
        message: 'La selección de productos se habilitará cuando esté conectado el motor de catálogo de NARI.',
        recommendations: [],
      };
    }
    return { ...validated, recommendations: [] };
  },
  limits: AI_LIMITS,
  discoverCandidates(input) {
    if (!candidateService) return Promise.resolve({ searched: false, reason: 'CANDIDATE_SERVICE_NOT_CONFIGURED', candidates: [] });
    return candidateService.search(input);
  },
});

module.exports = { createAIService };
