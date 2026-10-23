const crypto = require('node:crypto');

const safeDatabaseTarget = (connectionString, expectedProjectRef = '') => {
  let parsed;
  try {
    parsed = new URL(String(connectionString || ''));
  } catch {
    return { valid: false, reason: 'DATABASE_URL inválida', host: null, database: null, projectRef: null, matchesExpectedProject: false };
  }
  const host = parsed.hostname || null;
  const database = parsed.pathname.replace(/^\//, '') || null;
  const projectRef = host?.match(/^db\.([a-z0-9-]+)\.supabase\.co$/i)?.[1] || null;
  const expected = String(expectedProjectRef || '').trim().toLowerCase();
  return {
    valid: ['postgres:', 'postgresql:'].includes(parsed.protocol),
    host,
    database,
    projectRef,
    matchesExpectedProject: Boolean(expected && projectRef && projectRef.toLowerCase() === expected),
    credentialFingerprint: crypto.createHash('sha256').update(`${host || ''}/${database || ''}`).digest('hex').slice(0, 12),
  };
};

const assertDevDatabaseTarget = ({ connectionString, expectedProjectRef }) => {
  const target = safeDatabaseTarget(connectionString, expectedProjectRef);
  if (!target.valid || !target.matchesExpectedProject) {
    const error = new Error('No se pudo confirmar inequívocamente la base Supabase DEV.');
    error.code = 'DEV_DATABASE_TARGET_UNCONFIRMED';
    throw error;
  }
  return target;
};

module.exports = { safeDatabaseTarget, assertDevDatabaseTarget };
