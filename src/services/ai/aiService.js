const { AI_LIMITS } = require('./constants');
const { AIServiceError } = require('./errors');
const { validateRequest, validateProviderOutput } = require('./contract');
const { validateProviderReasoningOutput } = require('./reasoningContract');
const { assessSafety, assertNoPrivilegedInstruction } = require('./safety');
const { createOpenAIProvider } = require('./providers/openaiProvider');
const { isRecommendationEligibleProduct } = require('./candidates/catalogEligibility');
const { toProviderCandidates } = require('./candidates/candidateProviderProjection');
const { toPublicRecommendations } = require('./recommendationProjection');
const { isRoutineRecommendationReady, routineReadinessQuestion } = require('./routineReadiness');
const { deterministicRecommendationReason } = require('./recommendationReason');
const {
  createEmptyConversationState,
  createStateEnvelope,
  reduceConversationState,
  validateConversationState,
  verifyStateEnvelope,
} = require('./conversationState');
const { compileTurnPlan, relationFallback } = require('./turnPlan');
const { createConversationReferenceResolver } = require('./conversationReferenceResolver');

// These intents are owned by the signed-state TurnPlan router whenever the
// live transport is enabled.  A missing flow is a configuration defect, not
// permission to re-enter the legacy conversation manager.
const TURNPLAN_INTENTS = new Set([
  'PRODUCT_SELECTION',
  'BUILD_ROUTINE',
  'PRODUCT_INFO',
  'COMPARE',
  'COMPATIBILITY',
  'BUDGET_ROUTINE',
  'DISCOVERY',
]);

const publicReasoningResponse = ({ intent, reasoning, recommendations = [] }) => ({
  intent,
  mode: reasoning.mode,
  message: reasoning.message,
  profile: reasoning.profile,
  recommendations,
});

const buildReferenceContext = async (request, finalProductRepository, productResolver = null) => {
  if (!finalProductRepository?.findCurrentEligibleProducts && !productResolver) return { recentRecommendations: [], recentRoutine: [], recentProductReferences: [] };
  const references = [...(request.context?.recentRecommendations || []), ...(request.context?.recentRoutine || []), ...(request.context?.recentProductReferences || [])];
  const ids = [...new Set(references.map((item) => String(item.productId)))].slice(0, 8);
  if (!ids.length) return { recentRecommendations: [], recentRoutine: [], recentProductReferences: [] };
  const rows = productResolver
    ? (await Promise.all(ids.map((id) => productResolver.resolveReferences([id], { max: 1 })))).flatMap((result) => result.status === 'RESOLVED' ? result.products : [])
    : await finalProductRepository.findCurrentEligibleProducts(ids);
  const byId = new Map(rows.map((row) => [String(row.id), row]));
  const safe = (items) => items.map((item) => {
    const row = byId.get(String(item.productId));
    return row ? { productId: String(row.id), name: row.name, routineStep: row.routineStep || item.routineStep || null } : null;
  }).filter(Boolean);
  return { recentRecommendations: safe(request.context?.recentRecommendations || []), recentRoutine: safe(request.context?.recentRoutine || []), recentProductReferences: safe(request.context?.recentProductReferences || []) };
};

const profileDeltaFromValidatedResult = (previousProfile, profile = {}) => {
  const delta = {};
  for (const key of ['skinType', 'conditions', 'targets', 'budget', 'routinePreference']) {
    const next = profile[key];
    if (next === undefined || next === null || next === '' || (Array.isArray(next) && next.length === 0)) continue;
    if (JSON.stringify(previousProfile[key]) !== JSON.stringify(next)) delta[key] = next;
  }
  return delta;
};

const ownershipEvidenceFromValidatedResult = (profile = {}) => ({
  verifiedProducts: [],
  unresolvedItems: (profile.unresolvedOwnedProducts || []).map((label) => ({ label, reportedRoutineStep: null })),
  ownedRoutineSteps: profile.ownedRoutineSteps || [],
});

const artifactEvidenceFromValidatedResult = (result = {}, referenceArtifacts = []) => {
  const routineArtifacts = [];
  const routineByProductId = new Map();
  for (const [period, items] of [['MORNING', result.routine?.morning || []], ['EVENING', result.routine?.evening || []]]) {
    for (const item of items) if (item?.productId) {
      const artifact = { productId: String(item.productId), routineStep: item.step || null, period };
      routineArtifacts.push(artifact);
      if (!routineByProductId.has(String(item.productId))) routineByProductId.set(String(item.productId), artifact);
    }
  }
  const recommendations = result.catalogProducts
    ? []
    : [...(result.recommendations || []), ...(result.productsToBuy || [])]
    .map((item) => item?.product?.id ? { productId: String(item.product.id), routineStep: item.product.routineStep || routineByProductId.get(String(item.product.id))?.routineStep || null } : null)
    .filter(Boolean);
  return { recentRecommendations: recommendations, recentRoutine: routineArtifacts, recentProductReferences: referenceArtifacts.map((item) => ({ productId: String(item.productId), routineStep: item.routineStep || null })) };
};

const revalidateStateArtifacts = async (state, finalProductRepository) => {
  if (!finalProductRepository?.findCurrentEligibleProducts) return state;
  const references = [...state.artifacts.recentRecommendations, ...state.artifacts.recentRoutine];
  const ids = [...new Set(references.map((item) => String(item.productId)))];
  if (!ids.length) return state;
  const rows = await finalProductRepository.findCurrentEligibleProducts(ids);
  const eligibleIds = new Set(rows.filter(isRecommendationEligibleProduct).map((row) => String(row.id)));
  return validateConversationState({
    ...state,
    artifacts: {
      recentRecommendations: state.artifacts.recentRecommendations.filter((item) => eligibleIds.has(String(item.productId))),
      recentRoutine: state.artifacts.recentRoutine.filter((item) => eligibleIds.has(String(item.productId))),
      recentProductReferences: state.artifacts.recentProductReferences || [],
    },
  });
};

const alternativeSteps = (message) => {
  const text = String(message || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const steps = [];
  if (/limpiador|limpieza|jabon|cleanser/.test(text)) steps.push('CLEANSER');
  if (/hidratante|moisturizer/.test(text)) steps.push('MOISTURIZER');
  if (/protector|bloqueador|sunscreen/.test(text)) steps.push('SUNSCREEN');
  if (/serum|serum|tratamiento/.test(text)) steps.push('SERUM');
  return steps;
};

const deriveAlternativeConstraints = (message, safeContext) => {
  const text = String(message || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const correction = /son los mismos|ya me lo diste|me estas recomendando lo mismo|te dije que otro/.test(text);
  const isAlternative = /\botr[oa]s?\b|distint|diferent|que no sean|que no sea|alternativ/.test(text) || correction;
  if (!isAlternative) return { excludeProductIds: [], isAlternativeRequest: false, correction: false };
  const steps = alternativeSteps(message);
  const references = safeContext.recentRecommendations || [];
  return {
    isAlternativeRequest: true,
    correction,
    excludeProductIds: references.filter((item) => !steps.length || steps.includes(item.routineStep)).map((item) => String(item.productId)).slice(0, AI_LIMITS.contextReferenceItems),
  };
};

const turnPlanDiagnostics = (event, plan = null, details = {}) => {
  if (process.env.AI_TURNPLAN_DEBUG !== 'true') return;
  console.info('AI TurnPlan diagnostic', {
    flow: 'MIGRATED_TURNPLAN_FLOW',
    event,
    goal: plan?.conversationalGoal || null,
    action: plan?.action || null,
    relationToPrevious: plan?.relationToPrevious || null,
    requestedSteps: plan?.requestedSteps?.length || 0,
    resolvedReferences: plan?.resolvedProductIds?.length || 0,
    exclusions: plan?.excludedProductIds?.length || 0,
    ...details,
  });
};

const stateReferenceContext = async (state, finalProductRepository, productResolver = null) => buildReferenceContext({
  context: {
    recentRecommendations: state.artifacts.recentRecommendations,
    recentRoutine: state.artifacts.recentRoutine,
    recentProductReferences: state.artifacts.recentProductReferences,
  },
}, finalProductRepository, productResolver);

const safeSelectionResponse = ({ interpretation, message, mode = 'ANSWER' }) => ({
  intent: interpretation.intent,
  mode,
  message,
  profile: interpretation.profile,
  recommendations: [],
});

const emptyOwnershipDelta = () => ({ addVerifiedProducts: [], addUnresolvedItems: [], addOwnedRoutineSteps: [], removeVerifiedProductIds: [], removeUnresolvedLabels: [], removeOwnedRoutineSteps: [] });

const resolveOwnershipDelta = async ({ interpretation, state, resolver }) => {
  const declared = interpretation.ownershipDelta || {};
  const delta = emptyOwnershipDelta();
  const resolveReferences = async (references, field) => {
    for (const reference of references || []) {
      const result = await resolver.resolve({ referencePhrases: [reference], state });
      if (result.status === 'AMBIGUOUS') throw new AIServiceError('TURNPLAN_REFERENCE_AMBIGUOUS', `No pude distinguir con seguridad la referencia de pertenencia (${field}).`, 409);
      if (result.status !== 'RESOLVED' || !result.resolvedProductIds.length) throw new AIServiceError('TURNPLAN_REFERENCE_NOT_FOUND', `No pude confirmar con seguridad la referencia de pertenencia (${field}).`, 409);
      if (field === 'add') {
        const known = [...(state.artifacts.recentRecommendations || []), ...(state.artifacts.recentRoutine || []), ...(state.ownership.verifiedProducts || [])];
        for (const productId of result.resolvedProductIds) {
          const product = (result.products || []).find((item) => String(item.id) === String(productId));
          const knownReference = known.find((item) => String(item.productId) === String(productId));
          delta.addVerifiedProducts.push({ productId: String(productId), routineStep: product?.routineStep || knownReference?.routineStep || null });
        }
      } else {
        delta.removeVerifiedProductIds.push(...result.resolvedProductIds.map(String));
      }
    }
  };
  await resolveReferences(declared.addVerifiedProductReferences, 'add');
  await resolveReferences(declared.removeReferences, 'remove');
  delta.addUnresolvedItems = declared.addUnresolvedItems || [];
  delta.addOwnedRoutineSteps = declared.addOwnedRoutineSteps || [];
  delta.removeUnresolvedLabels = declared.removeUnresolvedLabels || [];
  delta.removeOwnedRoutineSteps = declared.removeOwnedRoutineSteps || [];
  const hasStructuredOwnership = Object.values(declared).some((value) => Array.isArray(value) && value.length > 0);
  if (!hasStructuredOwnership) {
    const legacy = ownershipEvidenceFromValidatedResult(interpretation.profile);
    delta.addUnresolvedItems = legacy.unresolvedItems;
    delta.addOwnedRoutineSteps = legacy.ownedRoutineSteps;
  }
  return delta;
};

const createProductSelectionTurnPlanFlow = ({ provider, candidateService, finalProductRepository, productResolver }) => {
  const resolver = productResolver ? createConversationReferenceResolver({ productResolver }) : null;

  return async ({ request, previousState, safeContext, interpretation }) => {
    if (!resolver || !candidateService || !finalProductRepository || typeof provider.reasonAmongCandidates !== 'function') {
      throw new AIServiceError('TURNPLAN_NOT_CONFIGURED', 'La selección de productos no está disponible.', 503);
    }
    const preExecutionState = reduceConversationState(previousState, {
      profileDelta: profileDeltaFromValidatedResult(previousState.profile, interpretation.profile),
      ownershipDelta: ownershipEvidenceFromValidatedResult(interpretation.profile),
    });
    const effectiveInterpretation = { ...interpretation, profile: preExecutionState.profile };
    let resolution;
    try {
      resolution = interpretation.referencePhrases?.length
        ? await resolver.resolve({ referencePhrases: interpretation.referencePhrases, state: preExecutionState, currentProductId: request.context?.currentProductId || null })
        : { status: 'NONE', resolvedProductIds: [], products: [], matches: [], unresolvedPhrases: [] };
    } catch (error) {
      if (error instanceof AIServiceError) throw error;
      throw new AIServiceError('TURNPLAN_EXECUTION_FAILED', 'No pude resolver la referencia del producto de forma segura.', 502);
    }
    if (resolution.status === 'AMBIGUOUS') {
      const plan = compileTurnPlan({ interpretation, state: preExecutionState, message: request.message, resolution });
      turnPlanDiagnostics('reference-ambiguous', plan);
      return safeSelectionResponse({ interpretation: effectiveInterpretation, mode: 'FOLLOW_UP', message: 'No pude distinguir con seguridad el producto al que te refieres. ¿Puedes indicarme cuál de los productos quieres usar como referencia?' });
    }
    if (resolution.unresolvedPhrases?.length) {
      const plan = compileTurnPlan({ interpretation, state: preExecutionState, message: request.message, resolution });
      turnPlanDiagnostics('reference-not-found', plan);
      return safeSelectionResponse({ interpretation: effectiveInterpretation, mode: 'FOLLOW_UP', message: 'No pude identificar con suficiente seguridad el producto al que te refieres. ¿Puedes decirme su nombre o indicar el paso de rutina?' });
    }
    let plan;
    try {
      plan = compileTurnPlan({ interpretation, state: preExecutionState, message: request.message, resolution });
    } catch (error) {
      if (error instanceof AIServiceError) throw error;
      throw new AIServiceError('TURNPLAN_EXECUTION_FAILED', 'No pude preparar la selección de productos de forma segura.', 502);
    }
    const fallbackRelation = relationFallback(request.message);
    turnPlanDiagnostics('compiled', plan, { relationDisagreement: fallbackRelation !== 'NONE' && fallbackRelation !== plan.relationToPrevious });
    if (fallbackRelation !== 'NONE' && fallbackRelation !== plan.relationToPrevious) {
      turnPlanDiagnostics('relation-disagreement', plan);
    }
    if (plan.action !== 'RECOMMEND') return safeSelectionResponse({ interpretation: effectiveInterpretation, mode: plan.action === 'ASK_FOLLOW_UP' ? 'FOLLOW_UP' : 'ANSWER', message: interpretation.message });

    const groups = {};
    const allCandidates = [];
    const excludedFor = (step = null) => step ? (plan.excludedProductIdsByStep[step] || []) : plan.excludedProductIds;
    const steps = plan.requestedSteps;
    const searchStep = async (step) => {
      try {
        const result = await candidateService.search({ intent: 'PRODUCT_SELECTION', profile: preExecutionState.profile, requestedRoutineStep: step, currentProductId: request.context?.currentProductId || null, excludeProductIds: excludedFor(step) });
        const candidates = (result.candidates || []).filter((candidate) => !excludedFor(step).includes(String(candidate.productId)));
        groups[step || '__general'] = candidates;
        allCandidates.push(...candidates);
      } catch (error) {
        if (error instanceof AIServiceError) throw error;
        throw new AIServiceError('TURNPLAN_EXECUTION_FAILED', 'No pude buscar productos de forma segura.', 502);
      }
    };
    if (steps.length) for (const step of steps) await searchStep(step);
    else await searchStep(null);
    const uniqueCandidates = [...new Map(allCandidates.map((candidate) => [String(candidate.productId), candidate])).values()];
    const missingSteps = steps.filter((step) => !(groups[step] || []).length);
    turnPlanDiagnostics('candidates', plan, { candidateCount: uniqueCandidates.length, missingSteps: missingSteps.length });
    if (!uniqueCandidates.length) {
      return safeSelectionResponse({
        interpretation: effectiveInterpretation,
        message: plan.relationToPrevious === 'ALTERNATIVE' || plan.relationToPrevious === 'CORRECTION'
          ? 'No encontré otra opción distinta que pueda recomendarte con suficiente confianza en este momento.'
          : 'No encontré un producto de NARI que pueda recomendarte con suficiente confianza en este momento.',
      });
    }

    let reasoningOutput;
    try {
      const providerCandidates = steps.length
        ? steps.flatMap((step) => toProviderCandidates(groups[step] || [])).slice(0, 15)
        : toProviderCandidates(uniqueCandidates);
      reasoningOutput = await provider.reasonAmongCandidates({ request, interpretation: effectiveInterpretation, turnPlan: plan, conversationState: { profile: preExecutionState.profile }, candidates: providerCandidates });
    } catch (error) {
      if (error instanceof AIServiceError) throw error;
      throw new AIServiceError('AI_UNAVAILABLE', 'El servicio AI no está disponible.', 503);
    }
    const allowedProductIds = uniqueCandidates.map((candidate) => String(candidate.productId));
    const reasoning = validateProviderReasoningOutput(reasoningOutput, { allowedProductIds });
    if (reasoning.mode !== 'RECOMMENDATION') return safeSelectionResponse({ interpretation: effectiveInterpretation, mode: reasoning.mode, message: reasoning.message });
    const selectedRows = await finalProductRepository.findCurrentEligibleProducts(reasoning.selectedProductIds);
    const eligibleById = new Map(selectedRows.filter(isRecommendationEligibleProduct).map((product) => [String(product.id), product]));
    const excludedIds = new Set(plan.excludedProductIds.map(String));
    const selected = reasoning.selectedProductIds.map((id) => eligibleById.get(String(id))).filter(Boolean);
    if (selected.some((product) => excludedIds.has(String(product.id)))) throw new AIServiceError('INVALID_AI_RESPONSE', 'La respuesta AI seleccionó un producto excluido.', 502);
    if (steps.length && selected.some((product) => !steps.includes(product.routineStep))) throw new AIServiceError('INVALID_AI_RESPONSE', 'La respuesta AI seleccionó un producto para un paso distinto.', 502);
    if (!selected.length) {
      turnPlanDiagnostics('final-validation-empty', plan, { candidateCount: uniqueCandidates.length });
      return safeSelectionResponse({ interpretation: effectiveInterpretation, message: 'Los productos seleccionados ya no están disponibles para confirmación.' });
    }
    const candidateById = new Map(uniqueCandidates.map((candidate) => [String(candidate.productId), candidate]));
    const recommendations = toPublicRecommendations({
      selectedProducts: selected,
      reasons: selected.map((product) => ({ productId: product.id, reason: deterministicRecommendationReason({ candidate: candidateById.get(String(product.id)), profile: preExecutionState.profile }) })),
    });
    const message = missingSteps.length
      ? `${reasoning.message} No encontré otra opción suficientemente respaldada para todos los pasos que pediste.`
      : reasoning.message;
    turnPlanDiagnostics('completed', plan, { finalRecommendationCount: recommendations.length });
    return { intent: effectiveInterpretation.intent, mode: 'RECOMMENDATION', message, profile: preExecutionState.profile, recommendations };
  };
};

const createBuildRoutineTurnPlanFlow = ({ provider, routineService, productResolver }) => {
  const resolver = productResolver ? createConversationReferenceResolver({ productResolver }) : null;

  return async ({ request, previousState, interpretation }) => {
    if (!resolver || !routineService || typeof routineService.build !== 'function') {
      throw new AIServiceError('TURNPLAN_NOT_CONFIGURED', 'La construcción de rutinas no está disponible.', 503);
    }
    let ownershipDelta;
    try {
      ownershipDelta = await resolveOwnershipDelta({ interpretation, state: previousState, resolver });
    } catch (error) {
      if (error instanceof AIServiceError) throw error;
      throw new AIServiceError('TURNPLAN_EXECUTION_FAILED', 'No pude actualizar de forma segura los productos que ya tienes.', 502);
    }
    const effectiveState = reduceConversationState(previousState, {
      profileDelta: profileDeltaFromValidatedResult(previousState.profile, interpretation.profile),
      ownershipDelta,
    });
    const effectiveProfile = {
      ...interpretation.profile,
      ...effectiveState.profile,
      knownProducts: effectiveState.ownership.verifiedProducts.map((item) => String(item.productId)),
      unresolvedOwnedProducts: effectiveState.ownership.unresolvedItems.map((item) => item.label),
      ownedRoutineSteps: effectiveState.ownership.ownedRoutineSteps,
    };
    const plan = compileTurnPlan({ interpretation: { ...interpretation, profile: effectiveProfile }, state: effectiveState, message: request.message });
    turnPlanDiagnostics('routine-compiled', plan, {
      flow: 'BUILD_ROUTINE',
      stateProfileComplete: Boolean(effectiveState.profile.skinType || (effectiveState.profile.conditions || []).length || (effectiveState.profile.targets || []).length),
      ownedStepCount: effectiveState.ownership.ownedRoutineSteps.length,
    });
    const ready = Boolean(effectiveState.profile.skinType || (effectiveState.profile.conditions || []).length || (effectiveState.profile.targets || []).length);
    if (plan.action !== 'RECOMMEND' || !ready) {
      return {
        intent: interpretation.intent,
        mode: 'FOLLOW_UP',
        message: interpretation.message || routineReadinessQuestion(),
        profile: effectiveProfile,
        routine: null,
        routineComplete: false,
        missingSteps: [],
        recommendations: [],
        __ownershipDelta: ownershipDelta,
      };
    }
    try {
      const result = await routineService.build({
        request: { ...request, executionContext: {} },
        interpretation: { ...interpretation, profile: effectiveProfile },
        provider,
        state: effectiveState,
        turnPlan: plan,
      });
      turnPlanDiagnostics('routine-completed', plan, {
        missingPurchaseSteps: result.missingSteps?.length || 0,
        missingCanonicalEvidenceSteps: result.missingEvidence?.length || 0,
        finalRoutineStepCount: (result.routine?.morning?.length || 0) + (result.routine?.evening?.length || 0),
        finalRecommendationCount: result.recommendations?.length || 0,
      });
      const { missingEvidence, ...publicResult } = result;
      return { ...publicResult, profile: effectiveProfile, __ownershipDelta: ownershipDelta, __missingEvidence: missingEvidence || [] };
    } catch (error) {
      if (error instanceof AIServiceError) throw error;
      throw new AIServiceError('TURNPLAN_EXECUTION_FAILED', 'No pude construir la rutina de forma segura.', 502);
    }
  };
};

const createProductInfoTurnPlanFlow = ({ provider, productInfoService, productResolver }) => {
  const resolver = productResolver ? createConversationReferenceResolver({ productResolver }) : null;

  return async ({ request, previousState, interpretation }) => {
    if (!resolver || !productInfoService || typeof productInfoService.handle !== 'function') {
      throw new AIServiceError('TURNPLAN_NOT_CONFIGURED', 'La información de productos no está disponible.', 503);
    }
    const effectiveState = reduceConversationState(previousState, {
      profileDelta: profileDeltaFromValidatedResult(previousState.profile, interpretation.profile),
    });
    const effectiveInterpretation = { ...interpretation, profile: effectiveState.profile };
    const referencePhrases = interpretation.referencePhrases?.length
      ? interpretation.referencePhrases
      : interpretation.productReferences?.length
        ? interpretation.productReferences
        : request.context?.currentProductId ? ['ese'] : [];
    let resolution;
    try {
      resolution = await resolver.resolve({ referencePhrases, state: effectiveState, currentProductId: request.context?.currentProductId || null });
    } catch (error) {
      if (error instanceof AIServiceError) throw error;
      throw new AIServiceError('TURNPLAN_EXECUTION_FAILED', 'No pude resolver el producto de forma segura.', 502);
    }
    let plan;
    try {
      plan = compileTurnPlan({ interpretation: effectiveInterpretation, state: effectiveState, message: request.message, resolution });
    } catch (error) {
      if (error instanceof AIServiceError) throw error;
      throw new AIServiceError('TURNPLAN_EXECUTION_FAILED', 'No pude preparar la consulta del producto de forma segura.', 502);
    }
    turnPlanDiagnostics('product-info-compiled', plan, {
      flow: 'PRODUCT_INFO',
      referenceStatus: resolution.status,
      resolvedReferences: resolution.resolvedProductIds?.length || 0,
    });
    if (resolution.status === 'AMBIGUOUS') {
      return { intent: effectiveInterpretation.intent, mode: 'FOLLOW_UP', message: '¿Puedes indicarme cuál de los productos quieres consultar?', profile: effectiveState.profile, recommendations: [] };
    }
    if (resolution.unresolvedPhrases?.length || !resolution.resolvedProductIds?.length) {
      return { intent: effectiveInterpretation.intent, mode: 'FOLLOW_UP', message: '¿Puedes compartir el nombre del producto o decirme a cuál te refieres?', profile: effectiveState.profile, recommendations: [] };
    }
    if (plan.action === 'ASK_FOLLOW_UP') {
      return { intent: effectiveInterpretation.intent, mode: 'FOLLOW_UP', message: interpretation.message, profile: effectiveState.profile, recommendations: [] };
    }
    let resolvedProducts = resolution.products || [];
    if (resolvedProducts.length !== resolution.resolvedProductIds.length) {
      const byId = await Promise.all(resolution.resolvedProductIds.map((id) => productResolver.resolveReferences([id], { max: 1 })));
      resolvedProducts = byId.flatMap((item) => item.status === 'RESOLVED' ? item.products : []);
    }
    const byId = new Map(resolvedProducts.map((product) => [String(product.id), product]));
    const orderedProducts = resolution.resolvedProductIds.map((id) => byId.get(String(id))).filter(Boolean);
    if (orderedProducts.length !== resolution.resolvedProductIds.length) {
      throw new AIServiceError('TURNPLAN_REFERENCE_NOT_FOUND', 'No pude confirmar el producto solicitado.', 409);
    }
    const result = await productInfoService.handle({
      request,
      interpretation: effectiveInterpretation,
      provider,
      resolvedProducts: orderedProducts,
      turnPlan: plan,
      conversationState: effectiveState,
    });
    const purchasable = orderedProducts.filter(isRecommendationEligibleProduct).length;
    turnPlanDiagnostics('product-info-completed', plan, {
      resolvedReferences: orderedProducts.length,
      purchasableProducts: purchasable,
      canonicalMetadataComplete: orderedProducts.filter((product) => Array.isArray(product.suitableSkinTypes) && Array.isArray(product.suitableConditions) && Array.isArray(product.targets)).length,
    });
    return {
      ...result,
      profile: effectiveState.profile,
      __referenceArtifacts: orderedProducts.map((product) => ({ productId: String(product.id), routineStep: product.routineStep || null })),
    };
  };
};

const createCompareTurnPlanFlow = ({ provider, compareService, productResolver }) => {
  const resolver = productResolver ? createConversationReferenceResolver({ productResolver }) : null;

  return async ({ request, previousState, interpretation }) => {
    if (!resolver || !compareService || typeof compareService.handle !== 'function') {
      throw new AIServiceError('TURNPLAN_NOT_CONFIGURED', 'La comparación de productos no está disponible.', 503);
    }
    const effectiveState = reduceConversationState(previousState, {
      profileDelta: profileDeltaFromValidatedResult(previousState.profile, interpretation.profile),
    });
    const effectiveInterpretation = { ...interpretation, profile: effectiveState.profile };
    const focus = effectiveState.artifacts.recentProductReferences || [];
    const referencePhrases = interpretation.referencePhrases?.length
      ? interpretation.referencePhrases
      : interpretation.productReferences?.length
        ? interpretation.productReferences
        : focus.length >= 2 ? focus.slice(0, 2).map((item) => String(item.productId)) : [];
    let resolution;
    try {
      resolution = await resolver.resolve({ referencePhrases, state: effectiveState, currentProductId: request.context?.currentProductId || null });
    } catch (error) {
      if (error instanceof AIServiceError) throw error;
      throw new AIServiceError('TURNPLAN_EXECUTION_FAILED', 'No pude resolver los productos de forma segura.', 502);
    }
    let plan;
    try {
      plan = compileTurnPlan({ interpretation: effectiveInterpretation, state: effectiveState, message: request.message, resolution });
    } catch (error) {
      if (error instanceof AIServiceError) throw error;
      throw new AIServiceError('TURNPLAN_EXECUTION_FAILED', 'No pude preparar la comparación de forma segura.', 502);
    }
    turnPlanDiagnostics('compare-compiled', plan, { flow: 'COMPARE', referenceStatus: resolution.status, resolvedReferences: resolution.resolvedProductIds?.length || 0 });
    if (resolution.status === 'AMBIGUOUS' || resolution.unresolvedPhrases?.length || resolution.resolvedProductIds.length < 2 || resolution.resolvedProductIds.length > 2) {
      return { intent: effectiveInterpretation.intent, mode: 'FOLLOW_UP', message: resolution.resolvedProductIds.length > 2 ? 'Puedo comparar hasta dos productos a la vez. ¿Cuáles dos quieres poner lado a lado?' : '¿Qué dos productos quieres comparar?', profile: effectiveState.profile, recommendations: [] };
    }
    if (plan.action === 'ASK_FOLLOW_UP') {
      return { intent: effectiveInterpretation.intent, mode: 'FOLLOW_UP', message: interpretation.message, profile: effectiveState.profile, recommendations: [] };
    }
    let resolvedProducts = resolution.products || [];
    if (resolvedProducts.length !== resolution.resolvedProductIds.length) {
      resolvedProducts = (await Promise.all(resolution.resolvedProductIds.map((id) => productResolver.resolveReferences([id], { max: 1 })))).flatMap((result) => result.status === 'RESOLVED' ? result.products : []);
    }
    const byId = new Map(resolvedProducts.map((product) => [String(product.id), product]));
    const orderedProducts = resolution.resolvedProductIds.map((id) => byId.get(String(id))).filter(Boolean);
    if (orderedProducts.length !== 2) throw new AIServiceError('TURNPLAN_REFERENCE_NOT_FOUND', 'No pude confirmar los dos productos solicitados.', 409);
    const result = await compareService.handle({ request, interpretation: effectiveInterpretation, provider, resolvedProducts: orderedProducts, turnPlan: plan, conversationState: effectiveState });
    turnPlanDiagnostics('compare-completed', plan, { flow: 'COMPARE', outcome: result.__comparisonOutcome || null });
    const { __comparisonOutcome, ...publicResult } = result;
    return { ...publicResult, __referenceArtifacts: orderedProducts.map((product) => ({ productId: String(product.id), routineStep: product.routineStep || null })) };
  };
};

const createCompatibilityTurnPlanFlow = ({ provider, compatibilityService, productResolver }) => {
  const resolver = productResolver ? createConversationReferenceResolver({ productResolver }) : null;

  return async ({ request, previousState, interpretation }) => {
    if (!resolver || !compatibilityService || typeof compatibilityService.handle !== 'function') {
      throw new AIServiceError('TURNPLAN_NOT_CONFIGURED', 'La compatibilidad de productos no está disponible.', 503);
    }
    const effectiveState = reduceConversationState(previousState, { profileDelta: profileDeltaFromValidatedResult(previousState.profile, interpretation.profile) });
    const effectiveInterpretation = { ...interpretation, profile: effectiveState.profile };
    const focus = effectiveState.artifacts.recentProductReferences || [];
    const referencePhrases = interpretation.referencePhrases?.length
      ? interpretation.referencePhrases
      : interpretation.productReferences?.length
        ? interpretation.productReferences
        : focus.length >= 2 ? focus.slice(0, 2).map((item) => String(item.productId)) : [];
    let resolution;
    try {
      resolution = await resolver.resolve({ referencePhrases, state: effectiveState, currentProductId: request.context?.currentProductId || null });
    } catch (error) {
      if (error instanceof AIServiceError) throw error;
      throw new AIServiceError('TURNPLAN_EXECUTION_FAILED', 'No pude resolver los productos de forma segura.', 502);
    }
    const plan = compileTurnPlan({ interpretation: effectiveInterpretation, state: effectiveState, message: request.message, resolution });
    turnPlanDiagnostics('compatibility-compiled', plan, { flow: 'COMPATIBILITY', referenceStatus: resolution.status, resolvedReferences: resolution.resolvedProductIds?.length || 0 });
    if (resolution.status === 'AMBIGUOUS' || resolution.unresolvedPhrases?.length) return { intent: effectiveInterpretation.intent, mode: 'FOLLOW_UP', message: 'No pude distinguir con seguridad los productos. ¿Puedes indicar cuáles dos quieres usar juntos?', profile: effectiveState.profile, recommendations: [] };
    let resolvedProducts = resolution.products || [];
    if (resolvedProducts.length !== resolution.resolvedProductIds.length) {
      resolvedProducts = (await Promise.all(resolution.resolvedProductIds.map((id) => productResolver.resolveReferences([id], { max: 1 })))).flatMap((result) => result.status === 'RESOLVED' ? result.products : []);
    }
    const byId = new Map(resolvedProducts.map((product) => [String(product.id), product]));
    const resolvedItems = [];
    for (const match of resolution.matches || []) {
      for (const productId of match.productIds || []) {
        const product = byId.get(String(productId));
        if (product) resolvedItems.push({ kind: 'CATALOG', product });
      }
      for (const external of match.externalItems || []) resolvedItems.push({ kind: 'EXTERNAL', label: external.label, routineStep: external.routineStep });
    }
    if (!resolvedItems.length && resolvedProducts.length) resolvedItems.push(...resolvedProducts.map((product) => ({ kind: 'CATALOG', product })));
    if (resolvedItems.length !== 2) return { intent: effectiveInterpretation.intent, mode: 'FOLLOW_UP', message: resolvedItems.length > 2 ? 'Puedo revisar dos productos a la vez. ¿Cuáles quieres comparar?' : '¿Qué dos productos quieres usar juntos?', profile: effectiveState.profile, recommendations: [] };
    if (plan.action === 'ASK_FOLLOW_UP') return { intent: effectiveInterpretation.intent, mode: 'FOLLOW_UP', message: interpretation.message, profile: effectiveState.profile, recommendations: [] };
    const result = await compatibilityService.handle({ request, interpretation: effectiveInterpretation, provider, resolvedItems, turnPlan: plan, conversationState: effectiveState });
    turnPlanDiagnostics('compatibility-completed', plan, { flow: 'COMPATIBILITY', structuralStatus: result.compatibility?.structuralStatus || null, formulaCompatibility: result.compatibility?.formulaCompatibility || 'UNKNOWN', placementGenerated: Boolean(result.compatibility?.placement), externalProductInvolved: Boolean(result.__compatibilityOutcome?.externalProductInvolved), medicalBoundaryTriggered: Boolean(result.__compatibilityOutcome?.medicalBoundaryTriggered) });
    const { __compatibilityOutcome, ...publicResult } = result;
    return { ...publicResult, __referenceArtifacts: resolvedItems.filter((item) => item.kind === 'CATALOG').map((item) => ({ productId: String(item.product.id), routineStep: item.product.routineStep || null })) };
  };
};

const createBudgetRoutineTurnPlanFlow = ({ point10Service, productResolver }) => {
  const resolver = productResolver ? createConversationReferenceResolver({ productResolver }) : null;

  return async ({ request, previousState, interpretation }) => {
    if (!point10Service || typeof point10Service.budgetRoutine !== 'function' || !resolver) {
      throw new AIServiceError('TURNPLAN_NOT_CONFIGURED', 'La rutina con presupuesto no está disponible.', 503);
    }
    let ownershipDelta;
    try {
      ownershipDelta = await resolveOwnershipDelta({ interpretation, state: previousState, resolver });
    } catch (error) {
      if (error instanceof AIServiceError) throw error;
      throw new AIServiceError('TURNPLAN_EXECUTION_FAILED', 'No pude actualizar de forma segura los productos que ya tienes.', 502);
    }
    const effectiveState = reduceConversationState(previousState, {
      profileDelta: profileDeltaFromValidatedResult(previousState.profile, interpretation.profile),
      ownershipDelta,
    });
    const effectiveProfile = {
      ...interpretation.profile,
      ...effectiveState.profile,
      knownProducts: effectiveState.ownership.verifiedProducts.map((item) => String(item.productId)),
      unresolvedOwnedProducts: effectiveState.ownership.unresolvedItems.map((item) => item.label),
      ownedRoutineSteps: effectiveState.ownership.ownedRoutineSteps,
    };
    const plan = compileTurnPlan({ interpretation: { ...interpretation, profile: effectiveProfile }, state: effectiveState, message: request.message });
    turnPlanDiagnostics('budget-compiled', plan, {
      flow: 'BUDGET_ROUTINE',
      validatedBudget: effectiveState.profile.budget,
      ownedCoverageCount: effectiveState.ownership.ownedRoutineSteps.length,
    });
    if (plan.action !== 'BUDGET_ROUTINE' || !effectiveState.profile.budget) {
      return { intent: interpretation.intent, mode: 'FOLLOW_UP', message: interpretation.message || '¿Qué presupuesto máximo quieres destinar a la rutina?', profile: effectiveProfile, budget: { limit: null, total: null, currency: 'COP', withinBudget: false, outcome: 'NEED_MORE_PROFILE_INFO' }, recommendations: [], __ownershipDelta: ownershipDelta };
    }
    try {
      const result = await point10Service.budgetRoutine({ request: { ...request, executionContext: {} }, interpretation: { ...interpretation, profile: effectiveProfile }, state: effectiveState, turnPlan: plan });
      turnPlanDiagnostics('budget-completed', plan, {
        selectedUniqueProductCount: result.recommendations?.length || 0,
        currentTotalCost: result.budget?.total ?? null,
        remainingBudget: result.budget?.limit !== null && result.budget?.total !== null ? result.budget.limit - result.budget.total : null,
        uncoveredStepCount: result.budget?.uncoveredSteps?.length || 0,
        outcome: result.budget?.outcome || null,
      });
      return { ...result, profile: effectiveProfile, __ownershipDelta: ownershipDelta };
    } catch (error) {
      if (error instanceof AIServiceError) throw error;
      throw new AIServiceError('TURNPLAN_EXECUTION_FAILED', 'No pude calcular una rutina segura dentro de tu presupuesto.', 502);
    }
  };
};

const createCatalogDiscoveryTurnPlanFlow = ({ catalogDiscoveryService }) => async ({ previousState, interpretation }) => {
  if (!catalogDiscoveryService || typeof catalogDiscoveryService.discover !== 'function') throw new AIServiceError('TURNPLAN_NOT_CONFIGURED', 'La exploración del catálogo no está disponible.', 503);
  const effectiveState = reduceConversationState(previousState, { profileDelta: profileDeltaFromValidatedResult(previousState.profile, interpretation.profile) });
  const effectiveProfile = { ...interpretation.profile, ...effectiveState.profile };
  const plan = compileTurnPlan({ interpretation: { ...interpretation, profile: effectiveProfile }, state: effectiveState, message: interpretation.message });
  turnPlanDiagnostics('catalog-discovery-compiled', plan, { flow: 'CATALOG_DISCOVERY', profileUsed: Boolean(plan.discoveryCriteria?.useProfile), requestedStepCount: plan.discoveryCriteria?.routineSteps?.length || 0 });
  if (plan.action !== 'CATALOG_DISCOVERY') return { intent: interpretation.intent, mode: 'FOLLOW_UP', message: interpretation.message, profile: effectiveProfile, catalogProducts: [], recommendations: [] };
  const result = await catalogDiscoveryService.discover({ intent: interpretation.intent, profile: effectiveProfile, requestedRoutineStep: interpretation.requestedRoutineStep, criteria: plan.discoveryCriteria, turnPlan: plan });
  turnPlanDiagnostics('catalog-discovery-completed', plan, { ...result.__discoveryOutcome });
  const { __discoveryOutcome, ...publicResult } = result;
  return { ...publicResult, profile: effectiveProfile };
};

const createAIService = ({ provider = createOpenAIProvider(), candidateService = null, finalProductRepository = null, routineService = null, point10Service = null, catalogDiscoveryService = null, productInfoService = null, compareService = null, compatibilityService = null, stateTransport = false, stateSecret = undefined, turnPlanSelectionFlow = false, turnPlanRoutineFlow = false, turnPlanProductInfoFlow = false, turnPlanCompareFlow = false, turnPlanCompatibilityFlow = false, turnPlanBudgetFlow = false, productResolver = null } = {}) => {
  const adviseLegacy = async (input, prepared = null) => {
    const request = validateRequest(input);
    // The signed transport envelope is Backend state, never provider input.
    delete request.conversationState;
    assertNoPrivilegedInstruction(request);
    const safetyResponse = assessSafety(request);
    if (safetyResponse) return { ...safetyResponse, recommendations: [] };
    let output;
    try {
      const safeContext = prepared?.safeContext || await buildReferenceContext(request, finalProductRepository);
      const alternative = deriveAlternativeConstraints(request.message, safeContext);
      output = prepared?.interpretation || await provider.interpretConversation({ ...request, conversationContext: safeContext, alternativeRequest: alternative.isAlternativeRequest });
      request.executionContext = { safeContext, ...alternative };
    } catch (error) {
      if (error instanceof AIServiceError) throw error;
      throw new AIServiceError('AI_UNAVAILABLE', 'El servicio AI no está disponible.', 503);
    }
    const validated = validateProviderOutput(output);
    if (validated.scope === 'OUT_OF_SCOPE') {
      return {
        intent: 'UNKNOWN',
        mode: 'ANSWER',
        message: 'Puedo ayudarte únicamente con cuidado cosmético de la piel, productos de NARI y rutinas de skincare. ¿Qué necesitas saber sobre esos temas?',
        profile: validated.profile,
        recommendations: [],
      };
    }
    if (productInfoService && productInfoService.supports(validated.intent)) {
      return productInfoService.handle({ request, interpretation: validated, provider });
    }
    if (request.executionContext?.correction && validated.nextAction !== 'RECOMMEND') {
      return { ...validated, mode: 'ANSWER', message: 'Tienes razón; buscaré una opción diferente a las anteriores.', routine: null, routineComplete: false, recommendations: [] };
    }
    if (validated.nextAction !== 'RECOMMEND') {
      if (validated.nextAction === 'CATALOG_DISCOVERY' && catalogDiscoveryService) {
        return catalogDiscoveryService.discover({ intent: validated.intent, profile: validated.profile, requestedRoutineStep: validated.requestedRoutineStep });
      }
      return {
        ...validated,
        mode: validated.nextAction === 'ASK_FOLLOW_UP' ? 'FOLLOW_UP' : 'ANSWER',
        routine: null,
        routineComplete: false,
        recommendations: [],
      };
    }
    if (validated.intent === 'BUILD_ROUTINE' && validated.mode === 'RECOMMENDATION' && !isRoutineRecommendationReady(validated.profile)) {
      return { ...validated, mode: 'FOLLOW_UP', message: routineReadinessQuestion(), routine: null, routineComplete: false, recommendations: [] };
    }
    if (point10Service && point10Service.supports(validated.intent, validated.profile)) {
      return point10Service.handle({ request, interpretation: validated, provider });
    }
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

    const excludeProductIds = request.executionContext?.excludeProductIds || [];
    const candidateResult = await candidateService.search({
      intent: validated.intent,
      profile: validated.profile,
      currentProductId: request.context?.currentProductId || null,
      excludeProductIds,
    });
    const availableCandidates = candidateResult.candidates.filter((candidate) => !excludeProductIds.includes(String(candidate.productId)));
    if (!candidateResult.searched || availableCandidates.length === 0) {
      return {
        ...validated,
        mode: 'ANSWER',
        message: request.executionContext?.isAlternativeRequest ? 'No encontré una alternativa distinta que pueda recomendarte con suficiente confianza en este momento.' : 'No encontré un producto de NARI que pueda recomendarte con suficiente confianza en este momento. Podemos ajustar lo que buscas.',
        recommendations: [],
      };
    }

    let reasoningOutput;
    try {
      reasoningOutput = await provider.reasonAmongCandidates({
        request,
        interpretation: validated,
        candidates: toProviderCandidates(availableCandidates),
      });
    } catch (error) {
      if (error instanceof AIServiceError) throw error;
      throw new AIServiceError('AI_UNAVAILABLE', 'El servicio AI no está disponible.', 503);
    }
    const allowedProductIds = availableCandidates.map((candidate) => String(candidate.productId));
    const reasoning = validateProviderReasoningOutput(reasoningOutput, { allowedProductIds });
    if (reasoning.mode !== 'RECOMMENDATION') return publicReasoningResponse({ intent: validated.intent, reasoning });

    const selectedRows = await finalProductRepository.findCurrentEligibleProducts(reasoning.selectedProductIds);
    const eligibleById = new Map(selectedRows.filter(isRecommendationEligibleProduct).map((product) => [String(product.id), product]));
    const stillEligible = reasoning.selectedProductIds.map((id) => eligibleById.get(String(id))).filter((product) => product && !excludeProductIds.includes(String(product.id)));
    if (stillEligible.length === 0) {
      return publicReasoningResponse({
        intent: validated.intent,
        reasoning: {
          mode: 'ANSWER',
          message: 'Los productos seleccionados ya no están disponibles para confirmación.',
          profile: reasoning.profile,
        },
      });
    }
    return publicReasoningResponse({
      intent: validated.intent,
      reasoning,
      recommendations: toPublicRecommendations({ selectedProducts: stillEligible, reasons: stillEligible.map((product) => ({ productId: product.id, reason: deterministicRecommendationReason({ candidate: availableCandidates.find((candidate) => String(candidate.productId) === String(product.id)), profile: validated.profile }) })) }),
    });
  };
  const productSelectionTurnPlan = turnPlanSelectionFlow
    ? createProductSelectionTurnPlanFlow({ provider, candidateService, finalProductRepository, productResolver })
    : null;
  const buildRoutineTurnPlan = turnPlanRoutineFlow
    ? createBuildRoutineTurnPlanFlow({ provider, routineService, productResolver })
    : null;
  const productInfoTurnPlan = turnPlanProductInfoFlow
    ? createProductInfoTurnPlanFlow({ provider, productInfoService, productResolver })
    : null;
  const compareTurnPlan = turnPlanCompareFlow
    ? createCompareTurnPlanFlow({ provider, compareService, productResolver })
    : null;
  const compatibilityTurnPlan = turnPlanCompatibilityFlow
    ? createCompatibilityTurnPlanFlow({ provider, compatibilityService, productResolver })
    : null;
  const budgetRoutineTurnPlan = turnPlanBudgetFlow
    ? createBudgetRoutineTurnPlanFlow({ point10Service, productResolver })
    : null;
  const catalogDiscoveryTurnPlan = catalogDiscoveryService
    ? createCatalogDiscoveryTurnPlanFlow({ catalogDiscoveryService })
    : null;

  return {
    async advise(input) {
      if (!stateTransport) return adviseLegacy(input);
      // Fail before any provider call when the live transport is enabled but
      // the dedicated signing secret is absent.
      createStateEnvelope(createEmptyConversationState(), stateSecret);
      const request = validateRequest(input);
      const previousState = request.conversationState
        ? await revalidateStateArtifacts(verifyStateEnvelope(request.conversationState, stateSecret), finalProductRepository)
        : createEmptyConversationState();
      const safetyResponse = assessSafety(request);
      let result;
      if (safetyResponse) {
        result = { ...safetyResponse, recommendations: [] };
      } else {
        const safeContext = await stateReferenceContext(previousState, finalProductRepository);
        let interpretation;
        try {
          interpretation = validateProviderOutput(await provider.interpretConversation({
            message: request.message,
            history: request.history,
            context: request.context,
            conversationContext: safeContext,
            conversationProfile: previousState.profile,
            alternativeRequest: false,
          }));
        } catch (error) {
          if (error instanceof AIServiceError) throw error;
          throw new AIServiceError('AI_UNAVAILABLE', 'El servicio AI no está disponible.', 503);
        }
        if (productSelectionTurnPlan && interpretation.scope !== 'OUT_OF_SCOPE' && interpretation.intent === 'PRODUCT_SELECTION') {
          result = await productSelectionTurnPlan({ request, previousState, safeContext, interpretation });
        } else if (buildRoutineTurnPlan && interpretation.scope !== 'OUT_OF_SCOPE' && interpretation.intent === 'BUILD_ROUTINE') {
          result = await buildRoutineTurnPlan({ request, previousState, interpretation });
        } else if (productInfoTurnPlan && interpretation.scope !== 'OUT_OF_SCOPE' && interpretation.intent === 'PRODUCT_INFO') {
          result = await productInfoTurnPlan({ request, previousState, interpretation });
        } else if (compareTurnPlan && interpretation.scope !== 'OUT_OF_SCOPE' && interpretation.intent === 'COMPARE') {
          result = await compareTurnPlan({ request, previousState, interpretation });
        } else if (compatibilityTurnPlan && interpretation.scope !== 'OUT_OF_SCOPE' && interpretation.intent === 'COMPATIBILITY') {
          result = await compatibilityTurnPlan({ request, previousState, interpretation });
        } else if (budgetRoutineTurnPlan && interpretation.scope !== 'OUT_OF_SCOPE' && interpretation.intent === 'BUDGET_ROUTINE') {
          result = await budgetRoutineTurnPlan({ request, previousState, interpretation });
        } else if (catalogDiscoveryTurnPlan && interpretation.scope !== 'OUT_OF_SCOPE' && interpretation.intent === 'DISCOVERY') {
          result = await catalogDiscoveryTurnPlan({ request, previousState, interpretation });
        } else if (interpretation.scope !== 'OUT_OF_SCOPE' && TURNPLAN_INTENTS.has(interpretation.intent)) {
          throw new AIServiceError('TURNPLAN_NOT_CONFIGURED', 'El flujo conversacional solicitado no está disponible.', 503);
        } else {
          result = await adviseLegacy(input, { interpretation, safeContext });
        }
      }
      const { __ownershipDelta, __missingEvidence, __referenceArtifacts, ...publicResult } = result;
      const nextState = reduceConversationState(previousState, {
        profileDelta: profileDeltaFromValidatedResult(previousState.profile, publicResult.profile),
        ownershipDelta: __ownershipDelta || ownershipEvidenceFromValidatedResult(publicResult.profile),
        artifactEvidence: artifactEvidenceFromValidatedResult(publicResult, __referenceArtifacts || []),
      });
      return { ...publicResult, conversationState: createStateEnvelope(nextState, stateSecret) };
    },
    limits: AI_LIMITS,
    discoverCandidates(input) {
    if (!candidateService) return Promise.resolve({ searched: false, reason: 'CANDIDATE_SERVICE_NOT_CONFIGURED', candidates: [] });
    return candidateService.search(input);
    },
  };
};

module.exports = { createAIService };
