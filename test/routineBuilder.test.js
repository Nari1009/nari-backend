const assert = require('node:assert/strict');
const test = require('node:test');
const { createAIService } = require('../src/services/ai/aiService');
const { AIServiceError } = require('../src/services/ai/errors');
const { createRoutinePlan } = require('../src/services/ai/routines/routinePlan');
const { validateRoutineProviderOutput } = require('../src/services/ai/routines/routineContract');

const profile = (overrides = {}) => ({ skinType: 'DRY', conditions: [], targets: ['HYDRATION'], budget: null, routinePreference: null, knownProducts: [], unresolvedOwnedProducts: [], ownedRoutineSteps: [], ...overrides });
const candidate = (id, step, overrides = {}) => ({
  productId: id,
  metadata: { id, name: `Candidate ${id}`, routineStep: step, sizeLabel: '50 ml', suitableSkinTypes: null, suitableConditions: [], targets: ['HYDRATION'], ...overrides },
});
const row = (id, step, overrides = {}) => ({ id, name: `DB ${id}`, routineStep: step, slug: `slug-${id}`, price: 100, images: JSON.stringify([`https://img/${id}.jpg`]), catalogRole: 'CATALOG', status: 'active', stock: 3, ...overrides });

const createHarness = ({ profileValue = profile(), candidatesByStep = {}, routineOutput, rows = [], onRoutineInput = () => {} } = {}) => {
  const interpretation = { intent: 'BUILD_ROUTINE', mode: 'RECOMMENDATION', message: 'Rutina sencilla.', profile: profileValue };
  const provider = {
    async interpretConversation() { return interpretation; },
    async reasonRoutine(input) { onRoutineInput(input); return routineOutput(input); },
  };
  const candidateService = {
    async search({ requestedRoutineStep }) { return { searched: true, candidates: candidatesByStep[requestedRoutineStep] || [] }; },
  };
  const finalProductRepository = { async findCurrentEligibleProducts(ids) { return rows.filter((item) => ids.includes(item.id)); } };
  const routineService = require('../src/services/ai/routines/routineService').createRoutineService({ candidateService, finalProductRepository });
  return createAIService({ provider, candidateService, finalProductRepository, routineService });
};

const completeRoutine = ({ includeSerum = false, overrides = {} } = {}) => (input) => {
  const result = {
    mode: 'RECOMMENDATION',
    message: 'Rutina sencilla para comenzar.',
    profile: profile(),
    routine: {
      morning: [
        { step: 'CLEANSER', selectedProductId: 'cleanser', reason: 'Limpieza suave.' },
        { step: 'MOISTURIZER', selectedProductId: 'moisturizer', reason: 'Apoya la hidratación.' },
        { step: 'SUNSCREEN', selectedProductId: 'sunscreen', reason: 'Protege durante el día.' },
      ],
      evening: [
        { step: 'CLEANSER', selectedProductId: 'cleanser', reason: 'Retira impurezas.' },
        ...(includeSerum ? [{ step: 'SERUM', selectedProductId: 'serum', reason: 'Apoya el objetivo indicado.' }] : []),
        { step: 'MOISTURIZER', selectedProductId: 'moisturizer', reason: 'Completa la rutina.' },
      ],
    },
  };
  return { ...result, ...overrides };
};

const baseCandidates = () => ({
  CLEANSER: [candidate('cleanser', 'CLEANSER')],
  MOISTURIZER: [candidate('moisturizer', 'MOISTURIZER')],
  SUNSCREEN: [candidate('sunscreen', 'SUNSCREEN')],
  SERUM: [candidate('serum', 'SERUM')],
});
const baseRows = () => [row('cleanser', 'CLEANSER'), row('moisturizer', 'MOISTURIZER'), row('sunscreen', 'SUNSCREEN'), row('serum', 'SERUM')];

test('BUILD_ROUTINE with insufficient profile returns FOLLOW_UP', async () => {
  const service = createHarness({ profileValue: profile({ skinType: null, targets: [], conditions: [] }), routineOutput: completeRoutine() });
  const result = await service.advise({ message: 'Quiero una rutina' });
  assert.equal(result.mode, 'FOLLOW_UP');
  assert.deepEqual(result.recommendations, []);
  assert.equal(result.routine, null);
});

test('required-step fallback uses natural customer language instead of internal engine terms', async () => {
  const service = createHarness({
    candidatesByStep: { MOISTURIZER: [candidate('moisturizer', 'MOISTURIZER')], SUNSCREEN: [candidate('sunscreen', 'SUNSCREEN')] },
    routineOutput: () => ({
      mode: 'RECOMMENDATION',
      message: 'Puedo avanzar con parte de la rutina.',
      profile: profile(),
      routine: {
        morning: [{ step: 'MOISTURIZER', selectedProductId: 'moisturizer', reason: 'Hidratación.' }, { step: 'SUNSCREEN', selectedProductId: 'sunscreen', reason: 'Protección.' }],
        evening: [{ step: 'MOISTURIZER', selectedProductId: 'moisturizer', reason: 'Hidratación.' }],
      },
    }),
    rows: baseRows(),
  });
  const result = await service.advise({ message: 'Quiero una rutina sencilla' });
  assert.equal(result.mode, 'RECOMMENDATION');
  assert.match(result.message, /limpiador/i);
  assert.doesNotMatch(result.message, /CLEANSER|Product|candidato|catalogRole|score/i);
  assert.equal(result.routineComplete, false);
});

test('enough profile produces a bounded basic AM/PM routine', async () => {
  const service = createHarness({ candidatesByStep: baseCandidates(), routineOutput: completeRoutine(), rows: baseRows() });
  const result = await service.advise({ message: 'Quiero una rutina sencilla' });
  assert.deepEqual(result.routine.morning.map((item) => item.step), ['CLEANSER', 'MOISTURIZER', 'SUNSCREEN']);
  assert.deepEqual(result.routine.evening.map((item) => item.step), ['CLEANSER', 'MOISTURIZER']);
  assert.equal(result.recommendations.length, 3);
});

test('external owned sunscreen is acknowledged as context without becoming a NARI Product', async () => {
  const searchedSteps = [];
  const routineOutput = () => ({
    mode: 'RECOMMENDATION',
    message: 'Rutina sencilla para comenzar.',
    profile: profile({ unresolvedOwnedProducts: ['bloqueador de marca externa'], ownedRoutineSteps: ['SUNSCREEN'] }),
    routine: {
      morning: [
        { step: 'CLEANSER', selectedProductId: 'cleanser', reason: 'Limpieza suave.' },
        { step: 'MOISTURIZER', selectedProductId: 'moisturizer', reason: 'Apoya la hidratación.' },
      ],
      evening: [
        { step: 'CLEANSER', selectedProductId: 'cleanser', reason: 'Retira impurezas.' },
        { step: 'MOISTURIZER', selectedProductId: 'moisturizer', reason: 'Completa la rutina.' },
      ],
    },
  });
  const service = createHarness({
    profileValue: profile({ unresolvedOwnedProducts: ['bloqueador de marca externa'], ownedRoutineSteps: ['SUNSCREEN'] }),
    candidatesByStep: { CLEANSER: [candidate('cleanser', 'CLEANSER')], MOISTURIZER: [candidate('moisturizer', 'MOISTURIZER')] },
    routineOutput,
    rows: [row('cleanser', 'CLEANSER'), row('moisturizer', 'MOISTURIZER')],
    onRoutineInput: (input) => searchedSteps.push(...Object.keys(input.candidatesByStep)),
  });
  const result = await service.advise({ message: 'Quiero empezar una rutina y ya uso un bloqueador externo.' });
  assert.equal(result.mode, 'RECOMMENDATION');
  assert.equal(searchedSteps.includes('SUNSCREEN'), false);
  assert.equal(result.recommendations.some((item) => item.product.id === 'sunscreen'), false);
  assert.equal(result.routine.morning.some((item) => item.step === 'SUNSCREEN'), false);
});

test('external owned item with unknown category does not fabricate a routine step', async () => {
  const service = createHarness({
    profileValue: profile({ unresolvedOwnedProducts: ['crema XYZ'], ownedRoutineSteps: [] }),
    candidatesByStep: baseCandidates(),
    routineOutput: completeRoutine(),
    rows: baseRows(),
  });
  const result = await service.advise({ message: 'Uso una crema XYZ pero no sé qué es.' });
  assert.equal(result.mode, 'RECOMMENDATION');
  assert.equal(result.routine.morning.some((item) => item.productId === 'crema XYZ'), false);
  assert.equal(result.recommendations.some((item) => item.product.id === 'crema XYZ'), false);
});

test('SUNSCREEN is morning-only and optional steps are not forced', async () => {
  const service = createHarness({ candidatesByStep: baseCandidates(), routineOutput: completeRoutine(), rows: baseRows() });
  const result = await service.advise({ message: 'Rutina' });
  assert.equal(result.routine.morning.some((item) => item.step === 'SUNSCREEN'), true);
  assert.equal(result.routine.evening.some((item) => item.step === 'SUNSCREEN'), false);
  assert.equal(result.routine.evening.some((item) => item.step === 'SERUM'), false);
});

test('provider receives grouped safe candidates with no full catalog or private fields', async () => {
  let input;
  const many = Array.from({ length: 7 }, (_, index) => candidate(`cleanser-${index}`, 'CLEANSER', { supplier: 'private', cost: 2, catalogRole: 'CATALOG', suitableSkinTypes: null }));
  const candidates = { ...baseCandidates(), CLEANSER: many };
  const service = createHarness({ candidatesByStep: candidates, routineOutput: completeRoutine({ overrides: { routine: { morning: [{ step: 'CLEANSER', selectedProductId: 'cleanser-0', reason: 'Limpieza.' }, { step: 'MOISTURIZER', selectedProductId: 'moisturizer', reason: 'Hidratación.' }, { step: 'SUNSCREEN', selectedProductId: 'sunscreen', reason: 'Protección.' }], evening: [{ step: 'CLEANSER', selectedProductId: 'cleanser-0', reason: 'Limpieza.' }, { step: 'MOISTURIZER', selectedProductId: 'moisturizer', reason: 'Hidratación.' }] } } }), rows: [...baseRows(), row('cleanser-0', 'CLEANSER')], onRoutineInput: (value) => { input = value; } });
  await service.advise({ message: 'Rutina' });
  assert.equal(input.candidatesByStep.CLEANSER.length, 5);
  assert.equal('supplier' in input.candidatesByStep.CLEANSER[0], false);
  assert.equal('cost' in input.candidatesByStep.CLEANSER[0], false);
  assert.equal('catalogRole' in input.candidatesByStep.CLEANSER[0], false);
  assert.equal(input.candidatesByStep.CLEANSER[0].suitableSkinTypes, null);
});

test('provider cannot cross-select a Product into another routine step', async () => {
  const candidates = baseCandidates();
  const service = createHarness({ candidatesByStep: candidates, routineOutput: completeRoutine({ overrides: { routine: { morning: [{ step: 'MOISTURIZER', selectedProductId: 'sunscreen', reason: 'No.' }], evening: [] } } }), rows: baseRows() });
  await assert.rejects(() => service.advise({ message: 'Rutina' }), (error) => error instanceof AIServiceError && error.code === 'INVALID_AI_RESPONSE');
});

test('routine provider cannot invent steps, use invalid order, duplicate steps or place sunscreen at night', async () => {
  const variants = [
    { morning: [{ step: 'UNKNOWN', selectedProductId: 'cleanser', reason: 'x' }], evening: [] },
    { morning: [{ step: 'SUNSCREEN', selectedProductId: 'sunscreen', reason: 'x' }, { step: 'CLEANSER', selectedProductId: 'cleanser', reason: 'x' }], evening: [] },
    { morning: [{ step: 'CLEANSER', selectedProductId: 'cleanser', reason: 'x' }, { step: 'CLEANSER', selectedProductId: 'cleanser', reason: 'x' }], evening: [] },
    { morning: [{ step: 'CLEANSER', selectedProductId: 'cleanser', reason: 'x' }, { step: 'MOISTURIZER', selectedProductId: 'moisturizer', reason: 'x' }], evening: [{ step: 'SUNSCREEN', selectedProductId: 'sunscreen', reason: 'x' }] },
  ];
  for (const routine of variants) {
    const service = createHarness({ candidatesByStep: baseCandidates(), routineOutput: completeRoutine({ overrides: { routine } }), rows: baseRows() });
    await assert.rejects(() => service.advise({ message: 'Rutina' }), /INVALID_AI_RESPONSE|rutina|paso|duplicado|orden|obligatorio/);
  }
});

test('optional treatment serum is PM-only and cannot be moved to AM', async () => {
  const service = createHarness({
    candidatesByStep: baseCandidates(),
    routineOutput: completeRoutine({ overrides: { routine: {
      morning: [
        { step: 'CLEANSER', selectedProductId: 'cleanser', reason: 'Limpieza.' },
        { step: 'SERUM', selectedProductId: 'serum', reason: 'Tratamiento.' },
        { step: 'MOISTURIZER', selectedProductId: 'moisturizer', reason: 'Hidratación.' },
        { step: 'SUNSCREEN', selectedProductId: 'sunscreen', reason: 'Protección.' },
      ],
      evening: [
        { step: 'CLEANSER', selectedProductId: 'cleanser', reason: 'Limpieza.' },
        { step: 'MOISTURIZER', selectedProductId: 'moisturizer', reason: 'Hidratación.' },
      ],
    } } }),
    rows: baseRows(),
  });
  await assert.rejects(() => service.advise({ message: 'Rutina' }), /SERUM|rutina|INVALID_AI_RESPONSE/);
});

test('routine requires core steps', async () => {
  const missing = createHarness({ candidatesByStep: baseCandidates(), routineOutput: completeRoutine({ overrides: { routine: { morning: [{ step: 'CLEANSER', selectedProductId: 'cleanser', reason: 'x' }], evening: [] } } }), rows: baseRows() });
  await assert.rejects(() => missing.advise({ message: 'Rutina' }), /obligatorio|INVALID_AI_RESPONSE/);
});

test('routine contract rejects more than five unique Products', () => {
  const plan = { morning: ['CLEANSER', 'TONER', 'ESSENCE', 'MOISTURIZER', 'SUNSCREEN'], evening: ['FIRST_CLEANSE'], requiredMorning: [], requiredEvening: [], optionalMorning: [], optionalEvening: [] };
  const steps = [...plan.morning, ...plan.evening];
  const candidatesByStep = Object.fromEntries(steps.map((step) => [step, [{ productId: step.toLowerCase() }]]));
  const morning = plan.morning.map((step) => ({ step, selectedProductId: step.toLowerCase(), reason: 'Paso.' }));
  const evening = [{ step: 'FIRST_CLEANSE', selectedProductId: 'first_cleanse', reason: 'Paso.' }];
  assert.throws(() => validateRoutineProviderOutput({ mode: 'RECOMMENDATION', message: 'Rutina.', profile: profile(), routine: { morning, evening } }, { plan, candidatesByStep }), /máximo/);
});

test('same cleanser and moisturizer may be reused and appear once in recommendations', async () => {
  const service = createHarness({ candidatesByStep: baseCandidates(), routineOutput: completeRoutine(), rows: baseRows() });
  const result = await service.advise({ message: 'Rutina' });
  assert.equal(result.routine.morning[0].productId, result.routine.evening[0].productId);
  assert.equal(result.routine.morning[1].productId, result.routine.evening[1].productId);
  assert.deepEqual(result.recommendations.map((item) => item.product.id).sort(), ['cleanser', 'moisturizer', 'sunscreen']);
});

test('treatment serum is planned only for relevant canonical targets', () => {
  assert.equal(createRoutinePlan(profile({ targets: ['HYDRATION'] })).evening.includes('SERUM'), true);
  assert.equal(createRoutinePlan(profile({ targets: [] })).evening.includes('SERUM'), false);
});

test('missing optional serum does not invalidate the core routine', async () => {
  const candidates = baseCandidates();
  candidates.SERUM = [];
  const service = createHarness({ candidatesByStep: candidates, routineOutput: completeRoutine(), rows: baseRows() });
  const result = await service.advise({ message: 'Rutina' });
  assert.equal(result.mode, 'RECOMMENDATION');
  assert.equal(result.routine.evening.some((item) => item.step === 'SERUM'), false);
});

test('a missing required step preserves truthful partial routine progress', async () => {
  let providerInput;
  const service = createHarness({
    profileValue: profile({ skinType: 'OILY', targets: [], ownedRoutineSteps: ['SUNSCREEN'] }),
    candidatesByStep: { MOISTURIZER: [candidate('moisturizer', 'MOISTURIZER')] },
    routineOutput: () => ({
      mode: 'RECOMMENDATION',
      message: 'Puedes empezar con hidratación.',
      profile: profile({ skinType: 'OILY', targets: [], ownedRoutineSteps: ['SUNSCREEN'] }),
      routine: {
        morning: [{ step: 'MOISTURIZER', selectedProductId: 'moisturizer', reason: 'Aporta hidratación.' }],
        evening: [{ step: 'MOISTURIZER', selectedProductId: 'moisturizer', reason: 'Acompaña la rutina.' }],
      },
    }),
    rows: [row('moisturizer', 'MOISTURIZER')],
    onRoutineInput: (input) => { providerInput = input; },
  });
  const result = await service.advise({ message: 'Quiero una rutina sencilla para piel grasa.' });
  assert.equal(result.mode, 'RECOMMENDATION');
  assert.equal(result.routineComplete, false);
  assert.deepEqual(result.missingSteps, ['limpiador']);
  assert.match(result.message, /no puedo confirmarla completa/i);
  assert.deepEqual(result.recommendations.map((item) => item.product.id), ['moisturizer']);
  assert.deepEqual(providerInput.plan.missingRequiredSteps, ['CLEANSER']);
  assert.equal(providerInput.plan.morning.includes('CLEANSER'), false);
});

test('final DB truth is used and invalidated Products do not receive replacements', async () => {
  for (const invalid of [{ status: 'inactive' }, { stock: 0 }, { catalogRole: 'DEV_FIXTURE' }]) {
    const service = createHarness({ candidatesByStep: baseCandidates(), routineOutput: completeRoutine(), rows: [row('cleanser', 'CLEANSER'), row('moisturizer', 'MOISTURIZER'), row('sunscreen', 'SUNSCREEN', { ...invalid, price: 999, slug: 'provider-must-not-win' })] });
    const result = await service.advise({ message: 'Rutina' });
    assert.equal(result.mode, 'ANSWER');
    assert.equal(result.routine, null);
    assert.deepEqual(result.recommendations, []);
  }
});

test('provider price/image/slug cannot override final DB values', async () => {
  const service = createHarness({ candidatesByStep: baseCandidates(), routineOutput: completeRoutine(), rows: baseRows().map((item) => ({ ...item, price: 77, images: JSON.stringify(['db-image']), slug: 'db-slug' })) });
  const result = await service.advise({ message: 'Rutina' });
  assert.equal(result.recommendations[0].product.price, 77);
  assert.equal(result.recommendations[0].product.image, 'db-image');
  assert.equal(result.recommendations[0].product.slug, 'db-slug');
});
