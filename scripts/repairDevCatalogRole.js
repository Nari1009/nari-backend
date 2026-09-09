const { Client } = require('pg');

const EXPECTED = Object.freeze({ total: 25, catalog: 20, fixture: 5, unclassified: 0 });

const fail = (message) => {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
};

const assertDevOnlyConfiguration = () => {
  if (process.env.NARI_ALLOW_DEV_ROLE_REPAIR !== 'YES') throw new Error('Set NARI_ALLOW_DEV_ROLE_REPAIR=YES to authorize this DEV-only repair.');
  if (!process.env.DEV_DATABASE_URL) throw new Error('DEV_DATABASE_URL is required; no database connection was attempted.');
  if (process.env.DATABASE_URL || process.env.PROD_DATABASE_URL) throw new Error('Refusing to run while generic or PROD database variables are present.');
  const parsed = new URL(process.env.DEV_DATABASE_URL);
  const isSupabaseHost = parsed.hostname.endsWith('.supabase.co') || parsed.hostname.endsWith('.supabase.com');
  if (!isSupabaseHost || !parsed.username.startsWith('postgres.')) throw new Error('Refusing to run: DEV_DATABASE_URL must target a Supabase DEV Postgres host.');
};

const readCounts = async (client) => {
  const result = await client.query(`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE catalogrole = 'CATALOG')::int AS catalog,
           COUNT(*) FILTER (WHERE catalogrole = 'DEV_FIXTURE')::int AS fixture,
           COUNT(*) FILTER (WHERE catalogrole IS NULL)::int AS unclassified
    FROM public.products
  `);
  return result.rows[0];
};

const main = async () => {
  assertDevOnlyConfiguration();
  const client = new Client({ connectionString: process.env.DEV_DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    await client.query('BEGIN');

    const source = await client.query(`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE "catalogRole" = 'CATALOG')::int AS catalog,
             COUNT(*) FILTER (WHERE "catalogRole" = 'DEV_FIXTURE')::int AS fixture,
             COUNT(*) FILTER (WHERE "catalogRole" IS NULL)::int AS unclassified,
             COUNT(*) FILTER (WHERE "catalogRole" IS NOT NULL AND "catalogRole" NOT IN ('CATALOG', 'DEV_FIXTURE'))::int AS invalid
      FROM public.products
    `);
    const sourceCounts = source.rows[0];
    if (sourceCounts.total !== EXPECTED.total || sourceCounts.catalog !== EXPECTED.catalog || sourceCounts.fixture !== EXPECTED.fixture || sourceCounts.unclassified !== EXPECTED.unclassified || sourceCounts.invalid !== 0) {
      throw new Error(`Unexpected quoted catalogRole source counts: ${JSON.stringify(sourceCounts)}`);
    }

    const conflicts = await client.query(`
      SELECT COUNT(*)::int AS count
      FROM public.products
      WHERE catalogrole IS NOT NULL
        AND catalogrole IS DISTINCT FROM "catalogRole"
    `);
    if (conflicts.rows[0].count !== 0) throw new Error(`Refusing to overwrite ${conflicts.rows[0].count} conflicting lowercase catalogrole values.`);

    const before = await readCounts(client);
    await client.query(`
      UPDATE public.products
      SET catalogrole = "catalogRole"
      WHERE catalogrole IS NULL
        AND "catalogRole" IN ('CATALOG', 'DEV_FIXTURE')
    `);
    const after = await readCounts(client);
    if (after.total !== EXPECTED.total || after.catalog !== EXPECTED.catalog || after.fixture !== EXPECTED.fixture || after.unclassified !== EXPECTED.unclassified) {
      throw new Error(`Post-repair lowercase catalogrole counts are unsafe: ${JSON.stringify(after)}`);
    }
    const invalidAfter = await client.query(`SELECT COUNT(*)::int AS count FROM public.products WHERE catalogrole IS NOT NULL AND catalogrole NOT IN ('CATALOG', 'DEV_FIXTURE')`);
    if (invalidAfter.rows[0].count !== 0) throw new Error('Post-repair lowercase catalogrole contains an invalid value.');

    await client.query('COMMIT');
    process.stdout.write(`${JSON.stringify({ environment: 'DEV', readOnly: false, mutation: 'catalogrole <- "catalogRole" only', before, source: sourceCounts, after }, null, 2)}\n`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end().catch(() => {});
  }
};

main().catch((error) => fail(error.message));
