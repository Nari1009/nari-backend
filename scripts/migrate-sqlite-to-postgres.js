require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const { Pool } = require('pg');
const path = require('path');

const sourcePath = path.resolve(process.env.SOURCE_SQLITE_PATH || path.join(__dirname, '../../nari.db'));
const source = new sqlite3.Database(sourcePath, sqlite3.OPEN_READONLY);
const target = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const tables = ['products', 'auth_users', 'customers', 'orders', 'order_items', 'inventory_movements', 'auth_sessions', 'account_addresses', 'public_settings', 'abandoned_carts', 'password_reset_tokens', 'review_links', 'reviews', 'site_content', 'catalog_options', 'admin_users', 'admin_sessions'];
const primaryKeys = { public_settings: 'key', site_content: 'page' };
const readRows = (table) => new Promise((resolve, reject) => source.all(`SELECT * FROM "${table}"`, (error, rows) => error ? reject(error) : resolve(rows)));
const quote = (value) => `"${String(value).replace(/"/g, '""')}"`;
const targetColumns = async (table) => (await target.query('SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1', [table])).rows.map((row) => row.column_name);

(async () => {
  if (!/^postgres(ql)?:\/\//i.test(String(process.env.DATABASE_URL || ''))) throw new Error('DATABASE_URL debe ser la conexión PostgreSQL de Supabase.');
  const { initDb, ensureOrderShippingColumns, ensureCatalogOptions } = require('../src/db/init');
  const { ensureAdminSchema } = require('../src/services/adminAuth');
  await initDb(); await ensureOrderShippingColumns(); await ensureAdminSchema(); await ensureCatalogOptions();
  await target.query('BEGIN');
  try {
    for (const table of tables) {
      const rows = await readRows(table); const allowed = new Set(await targetColumns(table));
      for (const row of rows) {
        const columns = Object.keys(row).filter((column) => allowed.has(column));
        if (!columns.length) continue;
        const values = columns.map((column) => row[column]); const placeholders = values.map((_, index) => `$${index + 1}`); const primaryKey = primaryKeys[table] || 'id';
        const updates = columns.filter((column) => column !== primaryKey).map((column) => `${quote(column)} = EXCLUDED.${quote(column)}`);
        const sql = `INSERT INTO ${quote(table)} (${columns.map(quote).join(', ')}) VALUES (${placeholders.join(', ')}) ON CONFLICT (${quote(primaryKey)}) DO ${updates.length ? `UPDATE SET ${updates.join(', ')}` : 'NOTHING'}`;
        await target.query(sql, values);
      }
      console.log(`✓ ${table}: ${rows.length} registros procesados`);
    }
    await target.query('COMMIT'); console.log('✓ Migración completada.');
  } catch (error) { await target.query('ROLLBACK'); throw error; }
})().catch((error) => { console.error('Migración fallida:', error.message); process.exitCode = 1; }).finally(async () => { source.close(); await target.end(); });
