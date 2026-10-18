class PackageProfileError extends Error {
  constructor(message, code = 'COORDINADORA_PACKAGE_PROFILE_INVALID') {
    super(message);
    this.name = 'PackageProfileError';
    this.code = code;
    this.status = 400;
  }
}

const positive = (value) => Number.isFinite(Number(value)) && Number(value) > 0;
const nonNegative = (value) => Number.isFinite(Number(value)) && Number(value) >= 0;

const validatePackageProfile = (profile) => {
  if (!profile || typeof profile !== 'object') throw new PackageProfileError('El perfil de empaque no es válido.');
  const required = ['id', 'name', 'length', 'width', 'height', 'unit'];
  const missing = required.filter((key) => profile[key] === undefined || profile[key] === null || String(profile[key]).trim() === '');
  if (missing.length) throw new PackageProfileError(`Faltan datos del perfil de empaque: ${missing.join(', ')}.`);
  for (const key of ['length', 'width', 'height']) if (!positive(profile[key])) throw new PackageProfileError(`${key} debe ser positivo.`);
  const hasQuoteWeight = profile.quoteWeight !== undefined && profile.quoteWeight !== null && profile.quoteWeight !== '';
  const hasCapacity = profile.emptyWeight !== undefined && profile.emptyWeight !== null && profile.maxWeight !== undefined && profile.maxWeight !== null;
  if (hasQuoteWeight && !positive(profile.quoteWeight)) throw new PackageProfileError('quoteWeight debe ser positivo.');
  if (!hasQuoteWeight && !hasCapacity) throw new PackageProfileError('El perfil debe definir quoteWeight o capacidad física.');
  if (hasCapacity) {
    if (!nonNegative(profile.emptyWeight)) throw new PackageProfileError('emptyWeight debe ser cero o positivo.');
    if (!positive(profile.maxWeight) || Number(profile.emptyWeight) >= Number(profile.maxWeight)) throw new PackageProfileError('El peso vacío debe ser menor que el peso máximo.');
  }
  return {
    id: String(profile.id).trim(), name: String(profile.name).trim(),
    length: Number(profile.length), width: Number(profile.width), height: Number(profile.height),
    quoteWeight: hasQuoteWeight ? Number(profile.quoteWeight) : null,
    emptyWeight: hasCapacity ? Number(profile.emptyWeight) : null,
    maxWeight: hasCapacity ? Number(profile.maxWeight) : null,
    unit: String(profile.unit).trim(), active: profile.active !== false,
  };
};

const createPackageCatalog = (profiles = []) => {
  const normalized = profiles.map(validatePackageProfile);
  return {
    listActive: () => normalized.filter((profile) => profile.active),
    get: (id) => normalized.find((profile) => profile.id === id) || null,
  };
};

const calculatePackageWeight = ({ profile, itemWeights = [] } = {}) => {
  const normalized = validatePackageProfile(profile);
  const productWeight = itemWeights.reduce((sum, item) => sum + (Number(item.weight) * Number(item.quantity || 1)), 0);
  const total = normalized.emptyWeight + productWeight;
  if (!Number.isFinite(total) || total <= 0 || total > normalized.maxWeight) throw new PackageProfileError('El peso del paquete supera el perfil configurado.', 'COORDINADORA_PACKAGE_WEIGHT_INVALID');
  return total;
};

const profileFromConfiguration = (config) => validatePackageProfile({
  id: config.id,
  name: config.name,
  length: config.length,
  width: config.width,
  height: config.height,
  quoteWeight: config.quoteWeight,
  unit: config.unit,
  active: config.active,
});

module.exports = { PackageProfileError, validatePackageProfile, createPackageCatalog, calculatePackageWeight, profileFromConfiguration };
