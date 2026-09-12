const { customerRoutineStepLabel } = require('./routines/customerLabels');

const SKIN_LABELS = { OILY: 'grasa', DRY: 'seca', COMBINATION: 'mixta', NORMAL: 'normal' };

const deterministicRecommendationReason = ({ candidate, profile = {} } = {}) => {
  const matched = new Set(candidate?.matchedCriteria || []);
  const step = candidate?.metadata?.routineStep;
  const parts = [];
  if (matched.has('ROUTINE_STEP') && step) parts.push(`encaja con el paso de ${customerRoutineStepLabel(step)}`);
  if (matched.has('SKIN_TYPE') && profile.skinType) parts.push(`es compatible con piel ${SKIN_LABELS[profile.skinType] || 'de tu tipo'}`);
  if (matched.has('CONDITION')) parts.push('coincide con una condición que mencionaste');
  if (matched.has('TARGET')) parts.push('se alinea con uno de tus objetivos');
  return parts.length ? `${parts[0].charAt(0).toUpperCase()}${parts[0].slice(1)}${parts.length > 1 ? ` y ${parts.slice(1).join(' y ')}` : ''}.` : 'Es una opción disponible que encaja con los criterios revisados.';
};

module.exports = { deterministicRecommendationReason };
