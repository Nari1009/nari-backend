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
  const isSupabaseHost = parsed.hostname.endsWith('.supabase.co') || parsed.hostname.endsWith('.supabase.com');
  if (!isSupabaseHost || !parsed.username.startsWith('postgres.')) {
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

const profileList = (variable) => {
  if (!process.env[variable]) return null;
  const parsed = parseList(process.env[variable]);
  if (!parsed) throw new Error(`${variable} must be a JSON array when provided.`);
  return parsed;
};

const exclusionReason = ({ product, step, profile, scored }) => {
  if (product.catalogRole !== 'CATALOG') return 'CATALOG_ROLE_NOT_CATALOG';
  if (product.status !== 'active') return 'STATUS_NOT_ACTIVE';
  if (Number(product.stock) <= 0) return 'STOCK_NOT_POSITIVE';
  if (product.routineStep !== step) return 'ROUTINE_STEP_MISMATCH';
  const skinTypes = parseList(product.suitableSkinTypes);
  if (profile.skinType && Array.isArray(skinTypes) && skinTypes.length > 0 && !skinTypes.includes(profile.skinType)) return 'KNOWN_SKIN_TYPE_CONFLICT';
  return scored ? null : 'MINIMUM_SCORE_OR_UNKNOWN_CONFLICT';
};

const main = async () => {
  assertDevOnlyConfiguration();
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    const counts = await client.query(`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE catalogrole = 'CATALOG')::int AS runtime_catalog,
             COUNT(*) FILTER (WHERE catalogrole = 'DEV_FIXTURE')::int AS runtime_dev_fixture,
             COUNT(*) FILTER (WHERE catalogrole IS NULL)::int AS runtime_unclassified,
             COUNT(*) FILTER (WHERE catalogrole = 'CATALOG' AND status = 'active')::int AS runtime_active_catalog,
             COUNT(*) FILTER (WHERE catalogrole = 'CATALOG' AND status = 'active' AND stock > 0)::int AS runtime_active_in_stock_catalog,
             COUNT(*) FILTER (WHERE catalogrole = 'CATALOG' AND routinestep IS NOT NULL)::int AS runtime_catalog_with_routine_step,
             COUNT(*) FILTER (WHERE catalogrole = 'CATALOG' AND suitableskintypes IS NOT NULL)::int AS runtime_catalog_with_skin_types,
             COUNT(*) FILTER (WHERE "catalogRole" = 'CATALOG')::int AS quoted_catalog,
             COUNT(*) FILTER (WHERE "catalogRole" = 'DEV_FIXTURE')::int AS quoted_dev_fixture,
             COUNT(*) FILTER (WHERE "catalogRole" IS NULL)::int AS quoted_unclassified,
             COUNT(*) FILTER (WHERE catalogrole IS DISTINCT FROM "catalogRole")::int AS catalog_role_column_mismatches
      FROM products
    `);
    const result = await client.query(`
      SELECT id, name, status, stock,
             catalogrole AS "runtimeCatalogRole",
             "catalogRole" AS "quotedCatalogRole",
             routinestep AS "routineStep",
             sizelabel AS "sizeLabel",
             suitableskintypes AS "suitableSkinTypes",
             suitableconditions AS "suitableConditions",
             targets
      FROM products
      WHERE (catalogrole = 'CATALOG' OR "catalogRole" = 'CATALOG')
        AND routinestep IN ('CLEANSER', 'MOISTURIZER', 'SUNSCREEN')
      ORDER BY routinestep, id
    `);
    const profile = {
      skinType: process.env.DEV_DIAGNOSTIC_SKIN_TYPE || 'OILY',
      conditions: profileList('DEV_DIAGNOSTIC_CONDITIONS'),
      targets: profileList('DEV_DIAGNOSTIC_TARGETS'),
    };
    const steps = ['CLEANSER', 'MOISTURIZER', 'SUNSCREEN'];
    const rows = result.rows.map((product) => {
      const normalized = {
        ...product,
        catalogRole: product.runtimeCatalogRole,
        suitableSkinTypes: parseList(product.suitableSkinTypes),
        suitableConditions: parseList(product.suitableConditions),
        targets: parseList(product.targets),
      };
      const scored = scoreCandidate({ product: normalized, requestedRoutineStep: product.routineStep, profile });
      return {
        id: product.id,
        name: product.name,
        catalogRole: product.catalogRole,
        quotedCatalogRole: product.quotedCatalogRole,
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
        eligible: Boolean(scored),
        exclusionReason: exclusionReason({ product: normalized, step: product.routineStep, profile, scored }),
        minimumScore: MIN_CANDIDATE_SCORE,
      };
    });
    const perStep = Object.fromEntries(steps.map((step) => {
      const stepRows = rows.filter((row) => row.routineStep === step);
      return [step, {
        catalogRows: stepRows.length,
        activeInStockRows: stepRows.filter((row) => row.status === 'active' && row.stock > 0).length,
        eligibleRows: stepRows.filter((row) => row.eligible).length,
      }];
    }));
    process.stdout.write(`${JSON.stringify({
      environment: 'DEV',
      readOnly: true,
      profile,
      counts: counts.rows[0],
      perStep,
      weights: CANDIDATE_WEIGHTS,
      minimumScore: MIN_CANDIDATE_SCORE,
      rows,
    }, null, 2)}\n`);
  } finally {
    await client.end().catch(() => {});
  }
};

main().catch((error) => fail(error.message));
