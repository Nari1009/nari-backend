const { AIServiceError } = require('./errors');

const MEDICAL_ESCALATION = /(?:difficulty breathing|trouble breathing|shortness of breath|dificultad para respirar|hinchaz[oó]n|swelling|burn(?:s|ed|ing)?|quemadura|infection|infecci[oó]n|bleeding|sangrado|severe pain|dolor intenso|rapid(?:ly)? worsening|empeora\s+r[aá]pidamente|eye involvement|afectaci[oó]n ocular)/i;

const assessSafety = ({ message, history = [] }) => {
  const text = [message, ...history.map((item) => item.content)].join('\n');
  if (!MEDICAL_ESCALATION.test(text)) return null;
  return {
    intent: 'GENERAL_SKINCARE',
    mode: 'ANSWER',
    message: 'NARI brinda orientación cosmética y no puede diagnosticar ni tratar una condición médica. Si tienes síntomas intensos, una reacción importante o afectación de los ojos o la respiración, busca atención médica inmediata. Para síntomas persistentes o preocupantes, consulta a un profesional de salud.',
    profile: { skinType: null, conditions: null, targets: null, budget: null, routinePreference: null, knownProducts: [], unresolvedOwnedProducts: [], ownedRoutineSteps: [] },
  };
};

const assertNoPrivilegedInstruction = (request) => {
  if (request.history.some((item) => item.role === 'system')) throw new AIServiceError('INVALID_AI_REQUEST', 'Los mensajes system no son aceptados desde el cliente.', 400);
};

module.exports = { assessSafety, assertNoPrivilegedInstruction };
