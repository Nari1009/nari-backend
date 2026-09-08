const toProviderCandidate = (candidate = {}) => {
  const metadata = candidate.metadata || {};
  return {
    id: String(metadata.id ?? candidate.productId),
    name: metadata.name ?? null,
    routineStep: metadata.routineStep ?? null,
    sizeLabel: metadata.sizeLabel ?? null,
    suitableSkinTypes: metadata.suitableSkinTypes === undefined ? null : metadata.suitableSkinTypes,
    suitableConditions: metadata.suitableConditions === undefined ? null : metadata.suitableConditions,
    targets: metadata.targets === undefined ? null : metadata.targets,
  };
};

const toProviderCandidates = (candidates = []) => candidates.slice(0, 5).map(toProviderCandidate);

module.exports = { toProviderCandidate, toProviderCandidates };
