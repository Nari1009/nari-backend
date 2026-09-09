const hasItems = (value) => Array.isArray(value) && value.length > 0;

const isRoutineRecommendationReady = (profile = {}) => Boolean(
  profile.skinType
  || hasItems(profile.conditions)
  || hasItems(profile.targets)
  || hasItems(profile.knownProducts),
);

const routineReadinessQuestion = () => 'Para armarte una rutina sencilla sin complicarte, ¿cómo sientes normalmente tu piel: más grasa, más seca, mixta o no estás seguro?';

module.exports = { isRoutineRecommendationReady, routineReadinessQuestion };
