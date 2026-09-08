const express = require('express');
const { AI_LIMITS } = require('../services/ai/constants');
const { AIServiceError } = require('../services/ai/errors');
const { createAIService } = require('../services/ai/aiService');
const { createRateLimiter } = require('../services/ai/rateLimiter');
const { createCandidateService } = require('../services/ai/candidates/candidateService');
const { createFinalProductRepository } = require('../services/ai/candidates/finalProductRepository');

const router = express.Router();
const service = createAIService({
  candidateService: createCandidateService(),
  finalProductRepository: createFinalProductRepository(),
});
const allowRequest = createRateLimiter({ windowMs: AI_LIMITS.rateWindowMs, maxRequests: AI_LIMITS.rateMaxRequests });

router.post('/adviser', async (req, res) => {
  const key = String(req.ip || req.socket?.remoteAddress || 'unknown');
  if (!allowRequest(key)) return res.status(429).json({ success: false, code: 'AI_RATE_LIMITED', error: 'Demasiadas solicitudes. Inténtalo de nuevo más tarde.' });
  try {
    const data = await service.advise(req.body);
    return res.json({ success: true, data });
  } catch (error) {
    if (error instanceof AIServiceError) return res.status(error.status).json({ success: false, code: error.code, error: error.message });
    console.error('AI adviser request failed', { category: 'AI_INTERNAL_ERROR' });
    return res.status(503).json({ success: false, code: 'AI_UNAVAILABLE', error: 'El servicio AI no está disponible.' });
  }
});

module.exports = router;
