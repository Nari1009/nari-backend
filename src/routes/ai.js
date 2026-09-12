const express = require('express');
const { AI_LIMITS } = require('../services/ai/constants');
const { AIServiceError } = require('../services/ai/errors');
const { createAIService } = require('../services/ai/aiService');
const { createRateLimiter } = require('../services/ai/rateLimiter');
const { createCandidateService } = require('../services/ai/candidates/candidateService');
const { createFinalProductRepository } = require('../services/ai/candidates/finalProductRepository');
const { createRoutineService } = require('../services/ai/routines/routineService');
const { createProductResolver } = require('../services/ai/productResolver');
const { createPoint10Service } = require('../services/ai/point10Service');
const { createCatalogDiscoveryRepository } = require('../services/ai/catalogDiscoveryRepository');
const { createCatalogDiscoveryService } = require('../services/ai/catalogDiscoveryService');
const { createProductInfoService } = require('../services/ai/productInfoService');
const { createCompareService } = require('../services/ai/compareService');
const { createCompatibilityService } = require('../services/ai/compatibilityService');

const router = express.Router();
const candidateService = createCandidateService();
const finalProductRepository = createFinalProductRepository();
const productResolver = createProductResolver();
const point10Service = createPoint10Service({ resolver: productResolver, candidateService, finalProductRepository });
const catalogDiscoveryService = createCatalogDiscoveryService({ repository: createCatalogDiscoveryRepository() });
const productInfoService = createProductInfoService({ resolver: productResolver, finalProductRepository });
const service = createAIService({
  candidateService,
  finalProductRepository,
  routineService: createRoutineService({ candidateService, finalProductRepository }),
  point10Service,
  catalogDiscoveryService,
  productInfoService,
  compareService: createCompareService(),
  compatibilityService: createCompatibilityService(),
  stateTransport: true,
  stateSecret: process.env.NARI_AI_STATE_SECRET,
  turnPlanSelectionFlow: true,
  turnPlanRoutineFlow: true,
  turnPlanProductInfoFlow: true,
  turnPlanCompareFlow: true,
  turnPlanCompatibilityFlow: true,
  turnPlanBudgetFlow: true,
  productResolver,
});
const allowRequest = createRateLimiter({ windowMs: AI_LIMITS.rateWindowMs, maxRequests: AI_LIMITS.rateMaxRequests });

router.post('/adviser', async (req, res) => {
  const key = String(req.ip || req.socket?.remoteAddress || 'unknown');
  if (!allowRequest(key)) return res.status(429).json({ success: false, code: 'AI_RATE_LIMITED', error: 'Demasiadas solicitudes. Inténtalo de nuevo más tarde.' });
  try {
    const result = await service.advise(req.body);
    const { conversationState, ...data } = result;
    return res.json({ success: true, data, conversationState });
  } catch (error) {
    if (error instanceof AIServiceError) return res.status(error.status).json({ success: false, code: error.code, error: error.message });
    console.error('AI adviser request failed', { category: 'AI_INTERNAL_ERROR' });
    return res.status(503).json({ success: false, code: 'AI_UNAVAILABLE', error: 'El servicio AI no está disponible.' });
  }
});

module.exports = router;
