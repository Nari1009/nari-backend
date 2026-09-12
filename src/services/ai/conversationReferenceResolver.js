const { ROUTINE_STEPS } = require('../../domain/productTaxonomy');
const { normalizeReference } = require('./productResolver');

const STEP_ALIASES = Object.freeze({
  cleanser: 'CLEANSER', limpiador: 'CLEANSER', limpieza: 'CLEANSER', jabon: 'CLEANSER',
  hidratante: 'MOISTURIZER', moisturizer: 'MOISTURIZER', crema: 'MOISTURIZER',
  protector: 'SUNSCREEN', 'protector solar': 'SUNSCREEN', bloqueador: 'SUNSCREEN',
  serum: 'SERUM', sérum: 'SERUM', tonico: 'TONER', tónico: 'TONER',
});

const normalizePhrase = (value) => normalizeReference(value).replace(/\b(el|la|los|las|que|me|recomendaste|recomendado|producto|productos)\b/g, ' ').replace(/\s+/g, ' ').trim();
const unique = (items) => [...new Set(items.map(String))];

const recentArtifacts = (state) => [
  ...(state?.artifacts?.recentProductReferences || []).map((item) => ({ ...item, source: 'product-info' })),
  ...(state?.artifacts?.recentRecommendations || []).map((item) => ({ ...item, source: 'recommendation' })),
  ...(state?.artifacts?.recentRoutine || []).map((item) => ({ ...item, source: 'routine' })),
  ...(state?.ownership?.verifiedProducts || []).map((item) => ({ ...item, source: 'owned' })),
  ...(state?.ownership?.unresolvedItems || []).map((item) => ({ productId: null, label: item.label, routineStep: item.reportedRoutineStep, source: 'external' })),
];

const createConversationReferenceResolver = ({ productResolver } = {}) => {
  if (!productResolver || typeof productResolver.resolveReferences !== 'function') throw new TypeError('productResolver es obligatorio.');

  const resolveArtifactPhrase = (phrase, state) => {
    const normalized = normalizePhrase(phrase);
    const artifacts = recentArtifacts(state);
    if (!artifacts.length) return { status: 'NOT_FOUND', reference: phrase, productIds: [] };

    let matches = [];
    const externalLabelMatches = artifacts.filter((item) => item.source === 'external' && normalized && (normalizeReference(item.label).includes(normalized) || normalized.includes(normalizeReference(item.label))));
    if (externalLabelMatches.length) matches = externalLabelMatches;
    else if (/\bprimero\b/.test(normalized)) matches = artifacts.slice(0, 1);
    else if (/\bsegundo\b/.test(normalized)) matches = artifacts.slice(1, 2);
    else if (/\b(dos|ambos|entre estos)\b/.test(normalized)) matches = artifacts.slice(0, 2);
    else {
      const step = STEP_ALIASES[normalized];
      if (step) matches = artifacts.filter((item) => item.routineStep === step);
      else if (/\b(ese|esa|el que|la que|recomendaste)\b/.test(normalized)) matches = artifacts.slice(-1);
    }
    const productIds = unique(matches.map((item) => item.productId).filter(Boolean));
    const externalItems = matches.filter((item) => item.source === 'external').map((item) => ({ label: item.label, routineStep: item.routineStep || null }));
    if (productIds.length === 1 && externalItems.length === 0) return { status: 'RESOLVED', reference: phrase, productIds };
    if (productIds.length > 1 || externalItems.length > 1) return { status: 'AMBIGUOUS', reference: phrase, productIds, externalItems };
    if (externalItems.length === 1) return { status: 'RESOLVED', reference: phrase, productIds, externalItems };
    return { status: 'NOT_FOUND', reference: phrase, productIds: [] };
  };

  return {
    async resolve({ referencePhrases = [], state, currentProductId = null } = {}) {
      if (!Array.isArray(referencePhrases) || referencePhrases.length === 0) return { status: 'NONE', resolvedProductIds: [], products: [], matches: [], unresolvedPhrases: [] };
      const matches = [];
      const unresolvedPhrases = [];
      const expandedPhrases = referencePhrases.slice(0, 8).flatMap((phrase) => String(phrase).split(/\s+(?:vs\.?|versus)\s+/i).map((item) => item.trim()).filter(Boolean));
      for (const phrase of expandedPhrases.slice(0, 8)) {
        const artifactMatch = resolveArtifactPhrase(phrase, state);
        if (artifactMatch.status === 'RESOLVED' || artifactMatch.status === 'AMBIGUOUS') {
          matches.push(artifactMatch);
          continue;
        }
        const explicit = currentProductId && /\b(ese|esta|este|actual)\b/i.test(phrase)
          ? String(currentProductId)
          : phrase;
        const result = await productResolver.resolveReferences([explicit]);
        if (result.status === 'RESOLVED') matches.push({ status: 'RESOLVED', reference: phrase, productIds: result.products.map((product) => String(product.id)), products: result.products });
        else if (result.status === 'AMBIGUOUS') matches.push({ status: 'AMBIGUOUS', reference: phrase, productIds: [], products: result.products || [] });
        else unresolvedPhrases.push(phrase);
      }
      const ambiguous = matches.some((match) => match.status === 'AMBIGUOUS');
      const resolvedProductIds = unique(matches.flatMap((match) => match.productIds || []));
      const externalItems = matches.flatMap((match) => match.externalItems || []);
      return { status: ambiguous ? 'AMBIGUOUS' : (resolvedProductIds.length || externalItems.length) ? 'RESOLVED' : 'NOT_FOUND', resolvedProductIds, externalItems, products: matches.flatMap((match) => match.products || []), matches, unresolvedPhrases };
    },
  };
};

module.exports = { STEP_ALIASES, createConversationReferenceResolver };
