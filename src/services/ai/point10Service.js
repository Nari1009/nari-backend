const { AIServiceError } = require('./errors');
const { isRecommendationEligibleProduct } = require('./candidates/catalogEligibility');
const { toProviderCandidate } = require('./candidates/candidateProviderProjection');
const { toPublicRecommendationProduct, toPublicRecommendations } = require('./recommendationProjection');
const { createRoutinePlan, createBasicRoutinePlan, applyOwnedRoutineSteps, CORE_MORNING_STEPS, CORE_EVENING_STEPS, planSteps } = require('./routines/routinePlan');
const { customerRoutineStepLabel } = require('./routines/customerLabels');
const { orderIndex, validateBudgetOutput, validateCompareOutput, validateCompatibilityOutput, validateOwnedOutput } = require('./point10Contract');

const MAX_COMPARE_PRODUCTS = 2;
const MAX_COMPATIBILITY_PRODUCTS = 2;
const MAX_BUDGET_COP = 10_000_000;
const safeProduct = (product) => toProviderCandidate({ productId: product.id, metadata: product });
const productIds = (products) => products.map((product) => String(product.id));
const genericFollowUp = (intent, profile, message) => ({ intent, mode: 'FOLLOW_UP', message, profile, recommendations: [] });
const safeAnswer = (intent, profile, message, extra = {}) => ({ intent, mode: 'ANSWER', message, profile, routine: null, recommendations: [], ...extra });
const parseBudget = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const compactInput = value.trim().toLowerCase().replace(/\s/g, '');
  const unitMatch = compactInput.match(/^(\d+(?:[.,]\d+)?)((?:mil|k|mill[oó]n(?:es)?))$/);
  if (unitMatch) {
    const unitValue = Number(unitMatch[1].replace(',', '.'));
    const multiplier = unitMatch[2].startsWith('mill') ? 1_000_000 : 1_000;
    return Number.isFinite(unitValue) ? unitValue * multiplier : null;
  }
  const compact = compactInput;
  const separators = [...compact].filter((character) => character === '.' || character === ',');
  const lastSeparator = separators.at(-1);
  const singleSeparatorLooksLikeThousands = separators.length === 1 && /^\d+[.,]\d{3}$/.test(compact);
  const normalized = separators.length > 1
    ? (lastSeparator === ',' ? compact.replace(/\./g, '').replace(',', '.') : compact.replace(/,/g, ''))
    : singleSeparatorLooksLikeThousands
      ? compact.replace(/[.,]/, '')
      : separators.length === 1 && lastSeparator === ','
      ? compact.replace(',', '.')
      : compact;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};
const validBudget = (value) => Number.isFinite(value) && value > 0 && value <= MAX_BUDGET_COP;
const resolveOrFollowUp = async (resolver, references, max, intent, profile, label) => {
  const result = await resolver.resolveReferences(references, { max });
  if (result.status === 'AMBIGUOUS') return { response: genericFollowUp(intent, profile, `No pude distinguir con seguridad ${label}. ¿Puedes indicar el nombre exacto o el identificador del producto?`) };
  if (result.status !== 'RESOLVED') return { response: genericFollowUp(intent, profile, `No pude encontrar con seguridad ${label} en el catálogo de NARI.`) };
  return { products: result.products };
};
const finalEligibleMap = (rows) => new Map(rows.filter(isRecommendationEligibleProduct).map((product) => [String(product.id), product]));
const structuralCompatibility = (products, period, orderProductIds) => {
  const steps = products.map((product) => product.routineStep);
  if (steps.some((step) => !step)) return 'UNKNOWN';
  if (new Set(steps).size !== steps.length) return 'CONFLICT';
  if (period === 'EVENING' && steps.includes('SUNSCREEN')) return 'CONFLICT';
  if (period === 'MORNING' && steps.includes('FIRST_CLEANSE')) return 'CONFLICT';
  const expected = [...products].sort((left, right) => orderIndex(left.routineStep) - orderIndex(right.routineStep)).map((product) => String(product.id));
  return expected.join('|') === orderProductIds.join('|') ? 'COMPATIBLE' : 'CONFLICT';
};
const deterministicRoutine = ({ plan, owned, selectedByStep, sourceById }) => {
  const build = (steps) => steps.map((step) => {
    const product = selectedByStep.get(step) || owned.find((item) => item.routineStep === step);
    return product ? { step, productId: String(product.id), source: sourceById.get(String(product.id)) || 'RECOMMENDED' } : null;
  }).filter(Boolean);
  return { morning: build(plan.morning), evening: build(plan.evening) };
};
const createPoint10Service = ({ resolver, candidateService, finalProductRepository } = {}) => ({
  supports(intent, profile = {}) { return ['COMPARE', 'COMPATIBILITY', 'BUDGET_ROUTINE'].includes(intent) || (intent === 'BUILD_ROUTINE' && Array.isArray(profile.knownProducts) && profile.knownProducts.length > 0 && (!Array.isArray(profile.unresolvedOwnedProducts) || profile.unresolvedOwnedProducts.length === 0)); },
  async handle({ request, interpretation, provider }) {
    if (interpretation.intent === 'COMPARE') return this.compare({ request, interpretation, provider });
    if (interpretation.intent === 'COMPATIBILITY') return this.compatibility({ request, interpretation, provider });
    if (interpretation.intent === 'BUDGET_ROUTINE') return this.budgetRoutine({ request, interpretation });
    return this.existingProducts({ request, interpretation });
  },
  async compare({ request, interpretation, provider }) {
    const refs = interpretation.productReferences?.length ? interpretation.productReferences : (interpretation.profile.knownProducts || []);
    const resolved = await resolveOrFollowUp(resolver, refs, MAX_COMPARE_PRODUCTS, interpretation.intent, interpretation.profile, 'los dos productos que quieres comparar');
    if (resolved.response) return resolved.response;
    if (resolved.products.length !== 2) return genericFollowUp(interpretation.intent, interpretation.profile, '¿Qué dos productos quieres comparar?');
    const products = resolved.products;
    if (typeof provider.reasonComparison !== 'function') throw new AIServiceError('AI_UNAVAILABLE', 'El servicio AI no está disponible.', 503);
    const output = validateCompareOutput(await provider.reasonComparison({ request, interpretation, products: products.map(safeProduct) }), { productIds: productIds(products) });
    const rows = await finalProductRepository.findCurrentEligibleProducts(productIds(products));
    const eligible = finalEligibleMap(rows);
    const winner = output.comparison.winnerProductId && eligible.has(output.comparison.winnerProductId) ? eligible.get(output.comparison.winnerProductId) : null;
    return { intent: interpretation.intent, mode: output.mode, message: output.message, profile: output.profile, comparison: { ...output.comparison, products: products.map((product) => ({ ...safeProduct(product), availableForPurchase: eligible.has(String(product.id)) })) }, recommendations: winner ? toPublicRecommendations({ selectedProducts: [winner], reasons: [{ productId: winner.id, reason: output.message }] }) : [] };
  },
  async compatibility({ request, interpretation, provider }) {
    const refs = interpretation.productReferences?.length ? interpretation.productReferences : (interpretation.profile.knownProducts || []);
    const resolved = await resolveOrFollowUp(resolver, refs, MAX_COMPATIBILITY_PRODUCTS, interpretation.intent, interpretation.profile, 'los dos productos que quieres combinar');
    if (resolved.response) return resolved.response;
    if (resolved.products.length !== 2) return genericFollowUp(interpretation.intent, interpretation.profile, '¿Qué dos productos quieres combinar?');
    const products = resolved.products;
    if (typeof provider.reasonCompatibility !== 'function') throw new AIServiceError('AI_UNAVAILABLE', 'El servicio AI no está disponible.', 503);
    const output = validateCompatibilityOutput(await provider.reasonCompatibility({ request, interpretation, products: products.map(safeProduct) }), { productIds: productIds(products) });
    const status = structuralCompatibility(products, output.compatibility.period, output.compatibility.orderProductIds);
    const compatibility = { ...output.compatibility, structuralStatus: status, formulaLevel: 'UNKNOWN', summary: 'Puedo confirmar únicamente el orden estructural; la compatibilidad de fórmula o activos no está confirmada con datos oficiales del catálogo.', products: products.map(safeProduct) };
    return { intent: interpretation.intent, mode: output.mode, message: 'Puedo revisar el orden y el uso estructural de estos productos, pero la compatibilidad de fórmula o activos no está confirmada con datos oficiales del catálogo.', profile: output.profile, compatibility, recommendations: [] };
  },
  async budgetRoutine({ request, interpretation, state = null, turnPlan = null }) {
    const budget = parseBudget(state?.profile?.budget ?? interpretation.profile.budget);
    if (!validBudget(budget)) return safeAnswer(interpretation.intent, interpretation.profile, 'Necesito un presupuesto total positivo en COP para construir la rutina.', { budget: { limit: null, total: null, currency: 'COP', withinBudget: false, outcome: 'NEED_MORE_PROFILE_INFO' } });
    const routineProfile = state?.profile ? { ...interpretation.profile, ...state.profile } : interpretation.profile;
    const basePlan = createRoutinePlan(routineProfile);
    if (!basePlan) return genericFollowUp(interpretation.intent, interpretation.profile, '¿Qué tipo de piel tienes o qué objetivo quieres priorizar para construir una rutina dentro de tu presupuesto?');
    const plan = applyOwnedRoutineSteps(basePlan, state?.ownership?.ownedRoutineSteps || routineProfile.ownedRoutineSteps || []);
    const ownedIds = state?.ownership?.verifiedProducts?.map((item) => String(item.productId)) || routineProfile.knownProducts || [];
    const ownedResult = ownedIds.length ? await resolver.resolveReferences(ownedIds, { max: 20 }) : { status: 'RESOLVED', products: [] };
    if (ownedResult.status === 'AMBIGUOUS' || ownedResult.status === 'NOT_FOUND' || ownedResult.status === 'INVALID') return genericFollowUp(interpretation.intent, interpretation.profile, 'No pude resolver con seguridad tus productos actuales para calcular el presupuesto.');
    if (ownedResult.products.some((product) => !product.routineStep)) return genericFollowUp(interpretation.intent, interpretation.profile, 'Uno de tus productos actuales no tiene un paso de rutina confirmado.');
    const owned = ownedResult.products;
    const ownedSteps = new Set([...(state?.ownership?.ownedRoutineSteps || []), ...owned.map((product) => product.routineStep)]);
    const requiredSteps = [...new Set([...CORE_MORNING_STEPS, ...CORE_EVENING_STEPS])].filter((step) => !ownedSteps.has(step));
    const groups = {};
    const missingEvidence = [];
    for (const step of requiredSteps) {
      const result = await candidateService.search({ intent: 'BUILD_ROUTINE', profile: routineProfile, requestedRoutineStep: step });
      groups[step] = (result.candidates || []).slice(0, 5).filter((candidate) => Number.isFinite(Number(candidate.price)) && Number(candidate.price) > 0);
      if (groups[step].length === 0) missingEvidence.push(step);
    }
    const combinations = [];
    const visit = (index, selected) => {
      if (index === requiredSteps.length) {
        const unique = [...new Map(selected.map((candidate) => [String(candidate.productId), candidate])).values()];
        const total = unique.reduce((sum, candidate) => sum + Number(candidate.price), 0);
        if (total <= budget) combinations.push({ selected, unique, total, covered: new Set(selected.map((candidate) => requiredSteps[selected.indexOf(candidate)])), score: selected.reduce((sum, candidate) => sum + Number(candidate.score || 0), 0) });
        return;
      }
      for (const candidate of groups[requiredSteps[index]] || []) visit(index + 1, [...selected, candidate]);
      visit(index + 1, selected);
    };
    visit(0, []);
    combinations.sort((left, right) => right.covered.size - left.covered.size || right.score - left.score || left.total - right.total || left.unique.map((item) => String(item.productId)).sort().join('|').localeCompare(right.unique.map((item) => String(item.productId)).sort().join('|')));
    const chosen = combinations[0];
    if (!chosen || chosen.covered.size === 0) return safeAnswer(interpretation.intent, interpretation.profile, missingEvidence.length ? 'No pude confirmar productos con suficiente respaldo para los pasos que faltan en tu rutina.' : 'El presupuesto indicado no alcanza para cubrir los pasos esenciales de una rutina sencilla.', { budget: { limit: budget, total: 0, currency: 'COP', withinBudget: false, outcome: missingEvidence.length ? 'INSUFFICIENT_CATALOG_EVIDENCE' : 'CORE_NOT_AFFORDABLE', uncoveredSteps: requiredSteps } });
    const ids = chosen.unique.map((candidate) => String(candidate.productId));
    const rows = await finalProductRepository.findCurrentEligibleProducts(ids);
    const byId = finalEligibleMap(rows);
    if (ids.some((id) => !byId.has(id))) return safeAnswer(interpretation.intent, interpretation.profile, 'Un producto necesario dejó de estar disponible y la rutina no puede confirmarse dentro del presupuesto.', { budget: { limit: budget, total: null, currency: 'COP', withinBudget: false, outcome: 'INSUFFICIENT_CATALOG_EVIDENCE' } });
    const finalPricesValid = ids.every((id) => Number.isFinite(Number(byId.get(id).price)) && Number(byId.get(id).price) > 0);
    if (!finalPricesValid) return safeAnswer(interpretation.intent, interpretation.profile, 'No pude confirmar precios válidos para todos los productos de la rutina.', { budget: { limit: budget, total: null, currency: 'COP', withinBudget: false, outcome: 'INSUFFICIENT_CATALOG_EVIDENCE' } });
    const finalTotal = ids.reduce((sum, id) => sum + Number(byId.get(id).price), 0);
    if (finalTotal > budget) return safeAnswer(interpretation.intent, interpretation.profile, 'El precio actual del catálogo supera el presupuesto indicado; no presentaré una rutina incompleta.', { budget: { limit: budget, total: finalTotal, currency: 'COP', withinBudget: false, outcome: 'CORE_NOT_AFFORDABLE' } });
    const selectedByStep = new Map();
    for (const candidate of chosen.selected) selectedByStep.set(requiredSteps[chosen.selected.indexOf(candidate)], byId.get(String(candidate.productId)));
    const sourceById = new Map(owned.map((product) => [String(product.id), 'OWNED']).concat(ids.map((id) => [id, 'RECOMMENDED'])));
    const routine = deterministicRoutine({ plan, owned, selectedByStep, sourceById });
    const recommendations = toPublicRecommendations({ selectedProducts: ids.map((id) => byId.get(id)), reasons: ids.map((id) => ({ productId: id, reason: 'Forma parte de una rutina confirmada dentro del presupuesto.' })) });
    const uncoveredSteps = requiredSteps.filter((step) => !chosen.covered.has(step));
    return { intent: interpretation.intent, mode: 'RECOMMENDATION', message: uncoveredSteps.length ? 'Puedo avanzar con parte de tu rutina sin superar el presupuesto; algunos pasos aún quedan pendientes.' : 'Esta es una rutina sencilla confirmada dentro de tu presupuesto.', profile: routineProfile, routine, recommendations, productsToBuy: recommendations, budget: { limit: budget, total: finalTotal, currency: 'COP', withinBudget: true, outcome: uncoveredSteps.length ? 'PARTIAL_WITHIN_BUDGET' : 'COMPLETE_WITHIN_BUDGET', uncoveredSteps } };
  },
  async existingProducts({ interpretation }) {
    const ownedResult = await resolver.resolveReferences(interpretation.profile.knownProducts || [], { max: 20 });
    if (ownedResult.status === 'AMBIGUOUS') return genericFollowUp(interpretation.intent, interpretation.profile, 'No pude distinguir con seguridad uno de tus productos. ¿Puedes indicar el nombre exacto o el identificador del producto?');
    if (ownedResult.status !== 'RESOLVED') return genericFollowUp(interpretation.intent, interpretation.profile, 'No pude resolver con seguridad todos los productos que ya tienes en el catálogo de NARI.');
    if (ownedResult.products.some((product) => !product.routineStep)) return genericFollowUp(interpretation.intent, interpretation.profile, 'Uno de tus productos no tiene un paso de rutina confirmado; necesito ese dato antes de completar la rutina.');
    const plan = createRoutinePlan(interpretation.profile) || createBasicRoutinePlan();
    const owned = ownedResult.products;
    const ownedSteps = new Set(owned.map((product) => product.routineStep));
    const missingSteps = planSteps(plan).filter((step) => !ownedSteps.has(step));
    const selectedByStep = new Map();
    for (const step of missingSteps) {
      const result = await candidateService.search({ intent: 'BUILD_ROUTINE', profile: interpretation.profile, requestedRoutineStep: step });
      const best = result.candidates.slice(0, 5)[0];
      if (!best && (plan.requiredMorning.includes(step) || plan.requiredEvening.includes(step))) return safeAnswer(interpretation.intent, interpretation.profile, `No pude confirmar un ${customerRoutineStepLabel(step)} que todavía necesitas.`, { routine: null, productsToBuy: [] });
      if (best) selectedByStep.set(step, best.metadata ? { ...best.metadata, id: best.productId } : best);
    }
    const purchaseIds = [...selectedByStep.values()].map((product) => String(product.id));
    const rows = await finalProductRepository.findCurrentEligibleProducts(purchaseIds);
    const purchaseById = finalEligibleMap(rows);
    if (purchaseIds.some((id) => !purchaseById.has(id))) return safeAnswer(interpretation.intent, interpretation.profile, 'Un producto necesario para completar la rutina ya no está disponible. No inventaré un reemplazo.', { routine: null, productsToBuy: [] });
    const finalSelected = new Map([...selectedByStep].map(([step, product]) => [step, purchaseById.get(String(product.id))]));
    const sourceById = new Map(owned.map((product) => [String(product.id), 'OWNED']).concat(purchaseIds.map((id) => [id, 'RECOMMENDED'])));
    const routine = deterministicRoutine({ plan, owned, selectedByStep: finalSelected, sourceById });
    const recommendations = toPublicRecommendations({ selectedProducts: purchaseIds.map((id) => purchaseById.get(id)), reasons: purchaseIds.map((id) => ({ productId: id, reason: 'Completa un paso que no estaba cubierto por tus productos.' })) });
    return { intent: interpretation.intent, mode: 'RECOMMENDATION', message: 'He mantenido tus productos y solo añadí los que faltaban para la rutina.', profile: interpretation.profile, routine, recommendations, productsToBuy: recommendations };
  },
});

module.exports = { MAX_BUDGET_COP, createPoint10Service, parseBudget, structuralCompatibility };
