const METADATA_MATCH = Object.freeze({
  MATCH: 'MATCH',
  NO_MATCH: 'NO_MATCH',
  UNKNOWN: 'UNKNOWN',
});

const canonical = (value) => String(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toUpperCase();

const normalizeMetadataList = (value) => {
  if (Array.isArray(value)) {
    const values = value.filter((item) => typeof item === 'string' && item.trim());
    return { values, normalizedValues: values.map(canonical), known: true };
  }
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) {
    return { values: null, normalizedValues: null, known: false };
  }
  if (typeof value !== 'string') return { values: null, normalizedValues: null, known: false };
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return { values: null, normalizedValues: null, known: false };
    const values = parsed.filter((item) => typeof item === 'string' && item.trim());
    return { values, normalizedValues: values.map(canonical), known: true };
  } catch {
    return { values: null, normalizedValues: null, known: false };
  }
};

const metadataListMatch = (value, requested, { mode = 'ANY' } = {}) => {
  const requestedValues = Array.isArray(requested) ? requested.filter((item) => typeof item === 'string' && item.trim()) : [];
  if (!requestedValues.length) return METADATA_MATCH.MATCH;
  const normalized = normalizeMetadataList(value);
  if (!normalized.known || !normalized.values.length) return METADATA_MATCH.UNKNOWN;
  const requestedCanonical = requestedValues.map(canonical);
  const matched = mode === 'ALL'
    ? requestedCanonical.every((item) => normalized.normalizedValues.includes(item))
    : requestedCanonical.some((item) => normalized.normalizedValues.includes(item));
  return matched ? METADATA_MATCH.MATCH : METADATA_MATCH.NO_MATCH;
};

module.exports = { METADATA_MATCH, canonical, metadataListMatch, normalizeMetadataList };
