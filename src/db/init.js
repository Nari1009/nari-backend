const { Pool } = require('pg');

const connectionString = String(process.env.DATABASE_URL || '');
if (!/^postgres(ql)?:\/\//i.test(connectionString)) {
  throw new Error('DATABASE_URL debe ser una conexión PostgreSQL de Supabase. SQLite ya no está soportado.');
}

const pool = new Pool({ connectionString, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined, max: 10 });
const translate = (sql) => {
  let translated = String(sql)
    .replace(/\bdatetime\('now',\s*'-1 day'\)/gi, `(CURRENT_TIMESTAMP - INTERVAL '1 day')`)
    .replace(/\bdatetime\('now',\s*'-3 days'\)/gi, `(CURRENT_TIMESTAMP - INTERVAL '3 days')`)
    .replace(/\bdatetime\(([^)]+)\)/gi, '$1')
    .replace(/\bCOLLATE\s+NOCASE\b/gi, '')
    .replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, 'INSERT INTO');
  if (/INSERT\s+INTO/i.test(translated) && !/ON\s+CONFLICT/i.test(translated)) translated += ' ON CONFLICT DO NOTHING';
  return translated.replace(/\?/g, (_, offset, text) => `$${(text.slice(0, offset).match(/\?/g) || []).length + 1}`);
};
const run = (sql, params = []) => pool.query(translate(sql), params).then((result) => ({ changes: result.rowCount, lastID: result.rows[0]?.id }));
const get = (sql, params = []) => pool.query(translate(sql), params).then((result) => result.rows[0]);
const all = (sql, params = []) => pool.query(translate(sql), params).then((result) => result.rows);
const withTransaction = async (callback) => {
  const client = await pool.connect();
  const tx = {
    query: (sql, params = []) => client.query(translate(sql), params),
    get: async (sql, params = []) => (await client.query(translate(sql), params)).rows[0],
    all: async (sql, params = []) => (await client.query(translate(sql), params)).rows,
    run: async (sql, params = []) => { const result = await client.query(translate(sql), params); return { changes: result.rowCount, lastID: result.rows[0]?.id }; },
  };
  try {
    await client.query('BEGIN');
    const result = await callback(tx);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally { client.release(); }
};

const initDb = async () => {
  const statements = [
    `CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, brand TEXT NOT NULL, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, category TEXT NOT NULL, description TEXT, sku TEXT, price NUMERIC, cost NUMERIC, compareAtPrice NUMERIC, stock INTEGER NOT NULL DEFAULT 0, minimumStock INTEGER NOT NULL DEFAULT 3, status TEXT DEFAULT 'active', rating NUMERIC DEFAULT 0, reviewCount INTEGER DEFAULT 0, soldCount INTEGER DEFAULT 0, isBestSeller INTEGER DEFAULT 0, skinTypes TEXT, concerns TEXT, ingredients TEXT, benefits TEXT, howToUse TEXT, precautions TEXT, audience TEXT, skinBenefits TEXT, featuredIngredients TEXT, fullIngredients TEXT, productInfo TEXT, shippingReturns TEXT, images TEXT, supplier TEXT, createdAt TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, updatedAt TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS auth_users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, passwordHash TEXT NOT NULL, firstName TEXT NOT NULL, lastName TEXT NOT NULL, phone TEXT NOT NULL, phoneNormalized TEXT, isActive INTEGER NOT NULL DEFAULT 1, createdAt TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, updatedAt TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, lastLoginAt TIMESTAMPTZ)`,
    `CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY, authUserId TEXT UNIQUE REFERENCES auth_users(id), email TEXT NOT NULL UNIQUE, firstName TEXT NOT NULL, lastName TEXT NOT NULL, phone TEXT NOT NULL, phoneNormalized TEXT, firstPurchaseAt TIMESTAMPTZ, lastPurchaseAt TIMESTAMPTZ, orderCount INTEGER NOT NULL DEFAULT 0, totalPurchased NUMERIC NOT NULL DEFAULT 0, latestAddress TEXT, city TEXT, department TEXT, country TEXT DEFAULT 'Colombia', status TEXT NOT NULL DEFAULT 'active', notes TEXT NOT NULL DEFAULT '', createdAt TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, updatedAt TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, userId TEXT REFERENCES auth_users(id), customerId TEXT, status TEXT NOT NULL DEFAULT 'Pagado', total NUMERIC NOT NULL, subtotal NUMERIC, shippingTotal NUMERIC, discountTotal NUMERIC, paymentFee NUMERIC, shippingCost NUMERIC, refundedTotal NUMERIC DEFAULT 0, shippingAddress TEXT NOT NULL, shippingProvider TEXT, trackingNumber TEXT, createdAt TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS order_items (id TEXT PRIMARY KEY, orderId TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE, productId TEXT NOT NULL, productName TEXT NOT NULL, quantity INTEGER NOT NULL, unitPrice NUMERIC NOT NULL, unitCost NUMERIC)`,
    `CREATE TABLE IF NOT EXISTS inventory_movements (id TEXT PRIMARY KEY, productId TEXT NOT NULL REFERENCES products(id), quantity INTEGER NOT NULL, type TEXT NOT NULL, description TEXT NOT NULL, createdAt TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, stockBefore INTEGER, stockAfter INTEGER, reason TEXT, reference TEXT, orderId TEXT, purchaseId TEXT, performedBy TEXT, notes TEXT)`,
    `CREATE TABLE IF NOT EXISTS auth_sessions (id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE, expiresAt TIMESTAMPTZ NOT NULL, createdAt TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, lastUsedAt TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS account_addresses (id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE, firstName TEXT NOT NULL, lastName TEXT NOT NULL, phone TEXT NOT NULL, country TEXT NOT NULL DEFAULT 'Colombia', department TEXT NOT NULL, city TEXT NOT NULL, addressLine1 TEXT NOT NULL, addressLine2 TEXT, neighborhood TEXT, postalCode TEXT, deliveryInstructions TEXT, isDefault INTEGER NOT NULL DEFAULT 0, createdAt TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, updatedAt TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS public_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updatedAt TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS abandoned_carts (id TEXT PRIMARY KEY, userId TEXT REFERENCES auth_users(id) ON DELETE SET NULL, email TEXT NOT NULL, items TEXT NOT NULL, lastActivityAt TIMESTAMPTZ NOT NULL, reminder1SentAt TIMESTAMPTZ, reminder2SentAt TIMESTAMPTZ, convertedAt TIMESTAMPTZ, createdAt TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, updatedAt TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS password_reset_tokens (id TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE, tokenHash TEXT NOT NULL UNIQUE, expiresAt TIMESTAMPTZ NOT NULL, usedAt TIMESTAMPTZ, createdAt TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS review_links (id TEXT PRIMARY KEY, orderId TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE, userId TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE, tokenHash TEXT NOT NULL UNIQUE, expiresAt TIMESTAMPTZ NOT NULL, sentAt TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS reviews (id TEXT PRIMARY KEY, orderId TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE, userId TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE, productId TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE, rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5), comment TEXT NOT NULL DEFAULT '', createdAt TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, updatedAt TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, UNIQUE(orderId, userId, productId))`,
    `CREATE TABLE IF NOT EXISTS site_content (page TEXT PRIMARY KEY, content TEXT NOT NULL, updatedAt TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS catalog_options (id TEXT PRIMARY KEY, type TEXT NOT NULL CHECK (type IN ('brand', 'category', 'skinType', 'concern', 'ingredient')), name TEXT NOT NULL, createdAt TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, UNIQUE(type, name))`,
  ];
  for (const statement of statements) await pool.query(statement);
  await pool.query('ALTER TABLE catalog_options DROP CONSTRAINT IF EXISTS catalog_options_type_check');
  await pool.query(`DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'catalog_options_type_check'
        AND conrelid = 'catalog_options'::regclass
    ) THEN
      ALTER TABLE catalog_options ADD CONSTRAINT catalog_options_type_check
        CHECK (type IN ('brand', 'category', 'skinType', 'concern', 'ingredient'));
    END IF;
  END $$`);
  await pool.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS supplier TEXT');
  await pool.query('ALTER TABLE products ALTER COLUMN price DROP NOT NULL');
};

const ensureOrderShippingColumns = async () => {
  const additions = { shippingProvider: 'TEXT', trackingNumber: 'TEXT', subtotal: 'NUMERIC', shippingTotal: 'NUMERIC', discountTotal: 'NUMERIC', paymentFee: 'NUMERIC', shippingCost: 'NUMERIC', refundedTotal: 'NUMERIC DEFAULT 0', customerId: 'TEXT' };
  for (const [name, type] of Object.entries(additions)) await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS ${name} ${type}`);
  await pool.query('ALTER TABLE customers ADD COLUMN IF NOT EXISTS phoneNormalized TEXT');
  await pool.query("UPDATE customers SET phoneNormalized = regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') WHERE phoneNormalized IS NULL OR phoneNormalized = ''");
  for (const [name, type] of Object.entries({ stockBefore: 'INTEGER', stockAfter: 'INTEGER', reason: 'TEXT', reference: 'TEXT', orderId: 'TEXT', purchaseId: 'TEXT', performedBy: 'TEXT', notes: 'TEXT' })) await pool.query(`ALTER TABLE inventory_movements ADD COLUMN IF NOT EXISTS ${name} ${type}`);
};

const ensureCatalogOptions = async () => {
  const fields = [
    ['brand', 'brand'],
    ['category', 'category'],
    ['skinType', 'skinTypes'],
    ['concern', 'concerns'],
    ['ingredient', 'ingredients'],
  ];
  for (const [type, column] of fields) {
    if (type === 'skinType') {
      const canonicalSkinTypes = ['Todas', 'Grasa', 'Seca', 'Mixta', 'Sensible', 'Acnéica', 'Normal', 'Madura', 'Deshidratada'];
      for (const name of canonicalSkinTypes) {
        const existing = await get('SELECT id FROM catalog_options WHERE type = ? AND lower(name) = lower(?)', [type, name]);
        if (!existing) await run('INSERT INTO catalog_options (id, type, name) VALUES (?, ?, ?)', [`${type}-${require('crypto').randomBytes(12).toString('hex')}`, type, name]);
      }
      continue;
    }
    const rows = await all(`SELECT ${column} AS value FROM products WHERE ${column} IS NOT NULL AND trim(${column}) <> ''`);
    const unique = new Map();
    for (const row of rows) {
      let values = row.value;
      if (type === 'brand' || type === 'category') values = [values];
      else {
        try { values = JSON.parse(values); } catch { values = String(values).split(/\r?\n/); }
      }
      if (!Array.isArray(values)) values = [values];
      for (const value of values) {
        for (const line of String(value || '').split(/\r?\n/)) {
          const name = line.trim().replace(/\s+/g, ' ');
          if (name && !unique.has(name.toLowerCase())) unique.set(name.toLowerCase(), name);
        }
      }
    }
    for (const name of unique.values()) {
      const existing = await get('SELECT id FROM catalog_options WHERE type = ? AND lower(name) = lower(?)', [type, name]);
      if (!existing) await run('INSERT INTO catalog_options (id, type, name) VALUES (?, ?, ?)', [`${type}-${require('crypto').randomBytes(12).toString('hex')}`, type, name]);
    }
  }
};

module.exports = { pool, initDb, ensureOrderShippingColumns, ensureCatalogOptions, run, get, all, withTransaction };
