const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const migrationPath = path.join(__dirname, '../migrations/20260912_r11d_catalog_role.sql');
const fixtureIds = new Set([
  'p-1788269661494',
  'p-1788269781556',
  'p-1788392449895',
  'p-1788392928433',
  'p-1788390859776',
]);
const catalogIds = new Set([
  'purchase-h8809640731433',
  'purchase-h8809640734427',
  'purchase-h8809640733550',
  'purchase-somi-18',
  'purchase-h8809447255071',
  'purchase-somi-20',
  'purchase-somi-19',
  'purchase-nh4485324519',
  'purchase-h8809732911880',
  'purchase-h8809732911583',
  'purchase-h8809657114731',
  'purchase-h8809782551814',
  'purchase-somi-15',
  'purchase-somi-16',
  'purchase-h8809576261110',
  'purchase-h8809576261646',
  'purchase-h8809576261417',
  'purchase-h8809576261141',
  'purchase-somi-17',
  'purchase-h880983506045',
]);

const required = (name) => {
  if (process.env[name] !== 'YES') throw new Error(`${name}=YES is required.`);
};

const assertDevUrl = () => {
  const value = process.env.DEV_DATABASE_URL;
  if (!value) throw new Error('DEV_DATABASE_URL is required.');
  const parsed = new URL(value);
  if (!/supabase\.com$/i.test(parsed.hostname) || !/^postgres\./i.test(parsed.username)) throw new Error('DEV_DATABASE_URL is not a Supabase PostgreSQL URL.');
  if (process.env.DATABASE_URL || process.env.PROD_DATABASE_URL) throw new Error('Fallback or PROD connection variables are not allowed.');
  return value;
};

const classify = (id) => (catalogIds.has(id) ? 'CATALOG' : fixtureIds.has(id) ? 'DEV_FIXTURE' : null);

const main = async () => {
  required('NARI_ALLOW_DEV_CATALOG_ROLE_CLASSIFICATION');
  const connectionString = assertDevUrl();
  const migration = fs.readFileSync(migrationPath, 'utf8');
  if (!/^\s*--[\s\S]*?ALTER TABLE public\.products[\s\S]*ADD COLUMN IF NOT EXISTS catalogRole TEXT NULL[\s\S]*DO \$\$/i.test(migration)) {
    throw new Error('Unexpected catalogRole migration content.');
  }
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  let transaction = 'NOT_RUN';
  try {
    await client.query('BEGIN');
    const before = await client.query('SELECT id, brand, name, slug, status, stock, supplier, catalogRole FROM public.products ORDER BY id');
    const rows = before.rows;
    const rowIds = new Set(rows.map((row) => row.id));
    const expectedIds = new Set([...fixtureIds, ...catalogIds]);
    if (rows.length !== 25 || rowIds.size !== 25 || expectedIds.size !== 25 || [...expectedIds].some((id) => !rowIds.has(id))) {
      throw new Error(`Expected exactly 25 verified DEV Products; found ${rows.length}.`);
    }
    if (rows.some((row) => !['CATALOG', 'DEV_FIXTURE', null].includes(row.catalogrole))) throw new Error('Unexpected existing catalogRole value.');
    fs.mkdirSync(path.join(__dirname, '../tmp'), { recursive: true });
    fs.writeFileSync(path.join(__dirname, '../tmp/r11d-catalog-role-before.json'), JSON.stringify({ environment: 'DEV', rows }, null, 2));
    await client.query(migration);
    for (const row of rows) {
      const role = classify(row.id);
      if (!role) throw new Error(`Unclassified Product: ${row.id}`);
      await client.query('UPDATE public.products SET catalogRole = $1 WHERE id = $2', [role, row.id]);
    }
    const after = await client.query('SELECT id, brand, name, slug, status, stock, supplier, catalogRole FROM public.products ORDER BY id');
    const report = {
      environment: 'DEV',
      totalBefore: rows.length,
      totalAfter: after.rows.length,
      catalogCount: after.rows.filter((row) => row.catalogrole === 'CATALOG').length,
      fixtureCount: after.rows.filter((row) => row.catalogrole === 'DEV_FIXTURE').length,
      unclassifiedCount: after.rows.filter((row) => row.catalogrole === null).length,
      rows: after.rows,
    };
    fs.writeFileSync(path.join(__dirname, '../tmp/r11d-catalog-role-classification.json'), JSON.stringify(report, null, 2));
    await client.query('COMMIT');
    transaction = 'COMMITTED';
    console.log(JSON.stringify({ ...report, transaction, sensitiveDataQueried: false, prodAccessed: false }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    transaction = 'ROLLED_BACK';
    console.error(JSON.stringify({ environment: 'DEV', transaction, status: 'FAIL', error: error.message }));
    process.exitCode = 1;
  } finally {
    await client.end();
  }
};

main().catch((error) => {
  console.error(JSON.stringify({ environment: 'DEV', transaction: 'NOT_RUN', status: 'FAIL', error: error.message }));
  process.exitCode = 1;
});
