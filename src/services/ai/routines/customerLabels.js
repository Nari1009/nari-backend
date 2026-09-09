const ROUTINE_STEP_LABELS = Object.freeze({
  FIRST_CLEANSE: 'primer paso de limpieza',
  CLEANSER: 'limpiador',
  TONER: 'tónico',
  ESSENCE: 'esencia',
  SERUM: 'sérum',
  EYE_CARE: 'contorno de ojos',
  MOISTURIZER: 'hidratante',
  SUNSCREEN: 'protector solar',
});

const customerRoutineStepLabel = (step) => ROUTINE_STEP_LABELS[step] || 'paso de la rutina';

module.exports = { customerRoutineStepLabel };
