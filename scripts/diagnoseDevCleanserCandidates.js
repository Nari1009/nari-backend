const { Client } = require('pg');
const { scoreCandidate, CANDIDATE_WEIGHTS, MIN_CANDIDATE_SCORE } = require('../src/services/ai/candidates/candidateScoring');

const requiredFlag = 'YES';
const diagnosticEnabled = process.env.NARI_ALLOW_DEV_READONLY_DIAGNOSTIC === requiredFlag;
const connectionString = process.env.DEV_DATABASE_URL;

const fail = (message) => {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
};

const assertDevOnlyConfiguration = () => {
  if (!diagnosticEnabled) throw new Error('Set NARI_ALLOW_DEV_READONLY_DIAGNOSTIC=YES to run this read-only DEV diagnostic.');
  if (!connectionString) throw new Error('DEV_DATABASE_URL is required; no database connection was attempted.');
  if (process.env.DATABASE_URL || process.env.PROD_DATABASE_URL) throw new Error('Refusing to run while generic or PROD database variables are present.');
  const parsed = new URL(connectionString);
  if (!parsed.hostname.endsWith('supabase.com') || !parsed.username.startsWith('postgres.')) {
    throw new Error('Refusing to run: DEV_DATABASE_URL must target a Supabase DEV Postgres host.');
  }
};

const parseList = (value) => {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || value.trim() === '') return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const main = async () => {
  assertDevOnlyConfiguration();
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    const result = await client.query(`
      SELECT id, name, price, status, stock,
             "catalogRole" AS "catalogRole",
             "routineStep" AS "routineStep",
             "suitableSkinTypes" AS "suitableSkinTypes",
             "suitableConditions" AS "suitableConditions",
             targets
      FROM products
      WHERE "catalogRole" = 'CATALOG'
        AND "routineStep" = 'CLEANSER'
      ORDER BY id
    `);
    const profile = {
      skinType: process.env.DEV_DIAGNOSTIC_SKIN_TYPE || 'OILY',
      conditions: null,
      targets: null,
    };
    const rows = result.rows.map((product) => {
      const normalized = {
        ...product,
        suitableSkinTypes: parseList(product.suitableSkinTypes),
        suitableConditions: parseList(product.suitableConditions),
        targets: parseList(product.targets),
      };
      const scored = scoreCandidate({ product: normalized, requestedRoutineStep: 'CLEANSER', profile });
      return {
        id: product.id,
        name: product.name,
        catalogRole: product.catalogRole,
        status: product.status,
        stock: product.stock,
        routineStep: product.routineStep,
        suitableSkinTypes: normalized.suitableSkinTypes,
        suitableConditions: normalized.suitableConditions,
        targets: normalized.targets,
        score: scored?.score ?? null,
        confidence: scored?.confidence ?? null,
        matchedCriteria: scored?.matchedCriteria ?? [],
        unknownCriteria: scored?.unknownCriteria ?? [],
        neutralCriteria: scored?.neutralCriteria ?? [],
        hardConflicts: scored?.conflicts ?? (product.status !== 'active' || Number(product.stock) <= 0 ? ['COMMERCIAL_ELIGIBILITY'] : ['MINIMUM_SCORE_OR_CONFLICT']),
        minimumScore: MIN_CANDIDATE_SCORE,
      };
    });
    process.stdout.write(`${JSON.stringify({
      environment: 'DEV',
      readOnly: true,
      requestedRoutineStep: 'CLEANSER',
      profile,
      weights: CANDIDATE_WEIGHTS,
      minimumScore: MIN_CANDIDATE_SCORE,
      rows,
    }, null, 2)}\n`);
  } finally {
    await client.end().catch(() => {});
  }
};

main().catch((error) => fail(error.message));
