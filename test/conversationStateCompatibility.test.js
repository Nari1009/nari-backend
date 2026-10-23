const assert = require('node:assert/strict');
const test = require('node:test');
const { createAIService } = require('../src/services/ai/aiService');
const { createEmptyConversationState, createStateEnvelope, verifyStateEnvelope } = require('../src/services/ai/conversationState');

const SECRET = 'r11-conversation-state-compatibility-secret';
const profile = {
  skinType: 'DRY',
  conditions: ['SENSITIVE'],
  targets: ['HYDRATION'],
  budget: '$250.000',
  routinePreference: 'simple',
  knownProducts: [],
  unresolvedOwnedProducts: [],
  ownedRoutineSteps: [],
};

const agentOutput = (message) => ({
  mode: 'FOLLOW_UP',
  profile,
  updatedProfileFields: ['skinType', 'conditions', 'targets', 'budget'],
  segments: [{ kind: 'GENERAL', productId: null, evidenceKeys: [], text: message }],
  selectedProductIds: [],
});

test('missing pendingQuestion is normalized to null without weakening the state envelope', () => {
  const state = createEmptyConversationState();
  const legacyLike = { ...state, conversation: { ...state.conversation, pendingQuestion: undefined } };
  const envelope = createStateEnvelope(legacyLike, SECRET);
  assert.equal(verifyStateEnvelope(envelope, SECRET).conversation.pendingQuestion, null);
});

test('long agent messages preserve a complete bounded question instead of arbitrary truncation', async () => {
  const longQuestion = `${'Cuéntame más sobre tu piel y tu rutina para elegir una crema hidratante segura. '.repeat(8)} ¿Qué producto quieres priorizar?`;
  const service = createAIService({
    stateTransport: true,
    stateSecret: SECRET,
    agentEnabled: true,
    agentToolFacade: { definitions: [], execute: async () => { throw new Error('no tool expected'); } },
    provider: { async runAgentTurn() { return { toolCallCount: 0, toolResults: [], output: agentOutput(longQuestion) }; } },
  });
  const first = await service.advise({ message: '¿Cómo uso esta crema hidratante?', conversationState: createStateEnvelope(createEmptyConversationState(), SECRET) });
  const state = verifyStateEnvelope(first.conversationState, SECRET);
  assert.equal(state.conversation.pendingAction, 'ANSWER_USAGE');
  assert.equal(state.conversation.pendingQuestion, '¿Qué producto quieres priorizar?');

  const second = await service.advise({ message: 'Sí', conversationState: first.conversationState });
  assert.ok(second.conversationState);
});

test('an oversized message without a complete bounded question does not enter signed state', async () => {
  const oversizedStatement = 'Cuéntame más sobre tu piel y tu rutina para elegir una crema hidratante segura '.repeat(8);
  const service = createAIService({
    stateTransport: true,
    stateSecret: SECRET,
    agentEnabled: true,
    agentToolFacade: { definitions: [], execute: async () => { throw new Error('no tool expected'); } },
    provider: { async runAgentTurn() { return { toolCallCount: 0, toolResults: [], output: agentOutput(oversizedStatement) }; } },
  });
  const result = await service.advise({ message: '¿Cómo uso esta crema hidratante?' });
  assert.equal(verifyStateEnvelope(result.conversationState, SECRET).conversation.pendingQuestion, null);
});

test('altered conversation state is still rejected even when pendingQuestion is optional', () => {
  const envelope = createStateEnvelope(createEmptyConversationState(), SECRET);
  envelope.state.conversation.pendingQuestion = 'altered';
  assert.throws(() => verifyStateEnvelope(envelope, SECRET), /estado AI firmado/);
});
