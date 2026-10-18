class DaneCatalogError extends Error {
  constructor(message, code = 'DANE_CATALOG_UNAVAILABLE') {
    super(message);
    this.name = 'DaneCatalogError';
    this.code = code;
    this.status = 400;
  }
}

const clean = (value) => String(value || '').trim().toLocaleLowerCase('es-CO').normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const validateDaneCode = (code) => typeof code === 'string' && /^\d+$/.test(code.trim());

const createDaneResolver = ({ entries = [], source = null, version = null } = {}) => {
  if (!source || !version || /pending|unknown|unverified/i.test(`${source} ${version}`)) throw new DaneCatalogError('El catálogo DANE requiere procedencia y versión verificables.', 'DANE_CATALOG_METADATA_REQUIRED');
  if (!Array.isArray(entries)) throw new DaneCatalogError('El catálogo DANE no tiene un formato válido.', 'DANE_CATALOG_INVALID');
  const catalog = entries.map((entry) => ({
    department: String(entry.department || '').trim(),
    municipality: String(entry.municipality || '').trim(),
    departmentCode: String(entry.departmentCode || '').trim(),
    code: String(entry.code || '').trim(),
  }));
  if (catalog.some((entry) => !entry.department || !entry.municipality || !validateDaneCode(entry.code))) throw new DaneCatalogError('El catálogo DANE contiene registros inválidos.', 'DANE_CATALOG_INVALID');

  return {
    resolveLocation({ department, municipality, providerCode = null }) {
      const matches = catalog.filter((entry) => clean(entry.department) === clean(department) && clean(entry.municipality) === clean(municipality));
      if (matches.length === 0) throw new DaneCatalogError('No existe un código DANE verificable para el municipio.', 'DANE_CODE_NOT_FOUND');
      if (matches.length > 1) throw new DaneCatalogError('El municipio tiene una coincidencia DANE ambigua.', 'DANE_CODE_AMBIGUOUS');
      const match = matches[0];
      return {
        department: match.department,
        municipality: match.municipality,
        departmentCode: match.departmentCode || null,
        daneCode: match.code,
        providerCode: providerCode || null,
        providerCodeConfirmed: Boolean(providerCode),
        source,
        version,
      };
    },
    // Compatibility with R14.1/R14.2 callers that only need the official code.
    resolve(input) { return this.resolveLocation(input).daneCode; },
    size: catalog.length,
    metadata: { source, version },
  };
};

const createOfficialDaneResolver = () => {
  const catalog = require('./daneCatalog');
  return createDaneResolver({ entries: catalog.entries, source: catalog.source, version: catalog.version });
};

module.exports = { DaneCatalogError, createDaneResolver, createOfficialDaneResolver, validateDaneCode };
