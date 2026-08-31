const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const configuredPath = process.env.DATABASE_URL;
const dbPath = configuredPath
  ? path.resolve(process.cwd(), configuredPath)
  : path.join(__dirname, '../../nari.db');
const db = new sqlite3.Database(
  dbPath,
  sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
);

const initDb = () => {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(`
        CREATE TABLE IF NOT EXISTS products (
          id TEXT PRIMARY KEY,
          brand TEXT NOT NULL,
          name TEXT NOT NULL,
          slug TEXT NOT NULL UNIQUE,
          category TEXT NOT NULL,
          description TEXT,
          sku TEXT,
          price REAL NOT NULL,
          cost REAL,
          compareAtPrice REAL,
          stock INTEGER NOT NULL DEFAULT 0,
          minimumStock INTEGER NOT NULL DEFAULT 3,
          status TEXT DEFAULT 'active',
          rating REAL DEFAULT 0,
          reviewCount INTEGER DEFAULT 0,
          soldCount INTEGER DEFAULT 0,
          isBestSeller BOOLEAN DEFAULT 0,
          skinTypes TEXT,
          concerns TEXT,
          ingredients TEXT,
          benefits TEXT,
          howToUse TEXT,
          precautions TEXT,
          audience TEXT,
          skinBenefits TEXT,
          featuredIngredients TEXT,
          fullIngredients TEXT,
          productInfo TEXT,
          shippingReturns TEXT,
          images TEXT,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
          updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `, async (err) => {
        if (err) return reject(err);
        try {
          const columns = await new Promise((resolveColumns, rejectColumns) => {
            db.all('PRAGMA table_info(products)', (columnError, rows) => {
              if (columnError) rejectColumns(columnError); else resolveColumns(rows.map((row) => row.name));
            });
          });
          const additions = {
            sku: 'TEXT', compareAtPrice: 'REAL', audience: 'TEXT', skinBenefits: 'TEXT', featuredIngredients: 'TEXT',
            fullIngredients: 'TEXT', productInfo: 'TEXT', shippingReturns: 'TEXT',
          };
          for (const [name, type] of Object.entries(additions)) {
            if (!columns.includes(name)) await run(`ALTER TABLE products ADD COLUMN ${name} ${type}`);
          }
          resolve();
        } catch (migrationError) { reject(migrationError); }
      });
      db.run(`
        CREATE TABLE IF NOT EXISTS inventory_movements (
          id TEXT PRIMARY KEY,
          productId TEXT NOT NULL,
          quantity INTEGER NOT NULL,
          type TEXT NOT NULL,
          description TEXT NOT NULL,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
          stockBefore INTEGER,
          stockAfter INTEGER,
          reason TEXT,
          reference TEXT,
          orderId TEXT,
          purchaseId TEXT,
          performedBy TEXT,
          notes TEXT,
          FOREIGN KEY (productId) REFERENCES products(id)
        )
      `);
      db.run(`
        CREATE TABLE IF NOT EXISTS auth_users (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL UNIQUE,
          passwordHash TEXT NOT NULL,
          firstName TEXT NOT NULL,
          lastName TEXT NOT NULL,
          phone TEXT NOT NULL,
          phoneNormalized TEXT,
          isActive INTEGER NOT NULL DEFAULT 1,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
          updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
          lastLoginAt TEXT
        )
      `);
      db.run(`
        CREATE TABLE IF NOT EXISTS customers (
          id TEXT PRIMARY KEY,
          authUserId TEXT UNIQUE,
          email TEXT NOT NULL UNIQUE,
          firstName TEXT NOT NULL,
          lastName TEXT NOT NULL,
          phone TEXT NOT NULL,
          firstPurchaseAt TEXT,
          lastPurchaseAt TEXT,
          orderCount INTEGER NOT NULL DEFAULT 0,
          totalPurchased REAL NOT NULL DEFAULT 0,
          latestAddress TEXT,
          city TEXT,
          department TEXT,
          country TEXT DEFAULT 'Colombia',
          status TEXT NOT NULL DEFAULT 'active',
          notes TEXT NOT NULL DEFAULT '',
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
          updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (authUserId) REFERENCES auth_users(id)
        )
      `);
      db.run(`
        CREATE TABLE IF NOT EXISTS auth_sessions (
          id TEXT PRIMARY KEY,
          userId TEXT NOT NULL,
          expiresAt TEXT NOT NULL,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
          lastUsedAt TEXT DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (userId) REFERENCES auth_users(id) ON DELETE CASCADE
        )
      `);
      db.run(`
        CREATE TABLE IF NOT EXISTS account_addresses (
          id TEXT PRIMARY KEY,
          userId TEXT NOT NULL,
          firstName TEXT NOT NULL,
          lastName TEXT NOT NULL,
          phone TEXT NOT NULL,
          country TEXT NOT NULL DEFAULT 'Colombia',
          department TEXT NOT NULL,
          city TEXT NOT NULL,
          addressLine1 TEXT NOT NULL,
          addressLine2 TEXT,
          neighborhood TEXT,
          postalCode TEXT,
          deliveryInstructions TEXT,
          isDefault INTEGER NOT NULL DEFAULT 0,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
          updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (userId) REFERENCES auth_users(id) ON DELETE CASCADE
        )
      `);
      db.run(`CREATE TABLE IF NOT EXISTS public_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP)`);
      db.run(`CREATE TABLE IF NOT EXISTS abandoned_carts (id TEXT PRIMARY KEY, userId TEXT, email TEXT NOT NULL, items TEXT NOT NULL, lastActivityAt TEXT NOT NULL, reminder1SentAt TEXT, reminder2SentAt TEXT, convertedAt TEXT, createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (userId) REFERENCES auth_users(id) ON DELETE SET NULL)`);
      db.run(`CREATE TABLE IF NOT EXISTS password_reset_tokens (id TEXT PRIMARY KEY, userId TEXT NOT NULL, tokenHash TEXT NOT NULL UNIQUE, expiresAt TEXT NOT NULL, usedAt TEXT, createdAt TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (userId) REFERENCES auth_users(id) ON DELETE CASCADE)`);
      db.run(`CREATE TABLE IF NOT EXISTS review_links (id TEXT PRIMARY KEY, orderId TEXT NOT NULL, userId TEXT NOT NULL, tokenHash TEXT NOT NULL UNIQUE, expiresAt TEXT NOT NULL, sentAt TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (orderId) REFERENCES orders(id) ON DELETE CASCADE, FOREIGN KEY (userId) REFERENCES auth_users(id) ON DELETE CASCADE)`);
      db.run(`CREATE TABLE IF NOT EXISTS reviews (id TEXT PRIMARY KEY, orderId TEXT NOT NULL, userId TEXT NOT NULL, productId TEXT NOT NULL, rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5), comment TEXT NOT NULL DEFAULT '', createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(orderId, userId, productId), FOREIGN KEY (orderId) REFERENCES orders(id) ON DELETE CASCADE, FOREIGN KEY (userId) REFERENCES auth_users(id) ON DELETE CASCADE, FOREIGN KEY (productId) REFERENCES products(id) ON DELETE CASCADE)`);
      db.run(`CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, userId TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Pagado', total REAL NOT NULL, subtotal REAL, shippingTotal REAL, discountTotal REAL, paymentFee REAL, shippingCost REAL, refundedTotal REAL DEFAULT 0, shippingAddress TEXT NOT NULL, shippingProvider TEXT, trackingNumber TEXT, createdAt TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (userId) REFERENCES auth_users(id))`);
      db.run(`CREATE TABLE IF NOT EXISTS order_items (id TEXT PRIMARY KEY, orderId TEXT NOT NULL, productId TEXT NOT NULL, productName TEXT NOT NULL, quantity INTEGER NOT NULL, unitPrice REAL NOT NULL, unitCost REAL, FOREIGN KEY (orderId) REFERENCES orders(id) ON DELETE CASCADE)`);
    });
  });
};

const ensureOrderShippingColumns = async () => {
  const orderColumns = await all('PRAGMA table_info(orders)');
  const orderAdditions = { shippingProvider: 'TEXT', trackingNumber: 'TEXT', subtotal: 'REAL', shippingTotal: 'REAL', discountTotal: 'REAL', paymentFee: 'REAL', shippingCost: 'REAL', refundedTotal: 'REAL DEFAULT 0' };
  for (const [name, type] of Object.entries(orderAdditions)) if (!orderColumns.some((column) => column.name === name)) await run(`ALTER TABLE orders ADD COLUMN ${name} ${type}`);
  const customerColumns = await all('PRAGMA table_info(customers)');
  if (!customerColumns.some((column) => column.name === 'phoneNormalized')) await run('ALTER TABLE customers ADD COLUMN phoneNormalized TEXT');
  await run("UPDATE customers SET phoneNormalized = replace(replace(replace(replace(replace(replace(phone, ' ', ''), '-', ''), '(', ''), ')', ''), '+', ''), '.', '') WHERE phoneNormalized IS NULL OR phoneNormalized = ''");
  const refreshedOrderColumns = await all('PRAGMA table_info(orders)');
  if (!refreshedOrderColumns.some((column) => column.name === 'customerId')) await run('ALTER TABLE orders ADD COLUMN customerId TEXT');
  const userIdColumn = refreshedOrderColumns.find((column) => column.name === 'userId');
  if (userIdColumn?.notnull) {
    await run('PRAGMA foreign_keys = OFF');
    await run('BEGIN TRANSACTION');
    try {
      await run(`CREATE TABLE orders_guest_migration (
        id TEXT PRIMARY KEY, userId TEXT, customerId TEXT, status TEXT NOT NULL DEFAULT 'Pagado',
        total REAL NOT NULL, subtotal REAL, shippingTotal REAL, discountTotal REAL,
        paymentFee REAL, shippingCost REAL, refundedTotal REAL DEFAULT 0,
        shippingAddress TEXT NOT NULL, shippingProvider TEXT, trackingNumber TEXT,
        createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (userId) REFERENCES auth_users(id)
      )`);
      await run(`INSERT INTO orders_guest_migration (id, userId, customerId, status, total, subtotal, shippingTotal, discountTotal, paymentFee, shippingCost, refundedTotal, shippingAddress, shippingProvider, trackingNumber, createdAt)
        SELECT id, userId, customerId, status, total, subtotal, shippingTotal, discountTotal, paymentFee, shippingCost, refundedTotal, shippingAddress, shippingProvider, trackingNumber, createdAt FROM orders`);
      await run('DROP TABLE orders');
      await run('ALTER TABLE orders_guest_migration RENAME TO orders');
      await run('COMMIT');
    } catch (error) {
      await run('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      await run('PRAGMA foreign_keys = ON');
    }
  }
  const productColumns = await all('PRAGMA table_info(products)');
  if (!productColumns.some((column) => column.name === 'minimumStock')) await run('ALTER TABLE products ADD COLUMN minimumStock INTEGER NOT NULL DEFAULT 3');
  const itemColumns = await all('PRAGMA table_info(order_items)');
  if (!itemColumns.some((column) => column.name === 'unitCost')) await run('ALTER TABLE order_items ADD COLUMN unitCost REAL');
  const movementColumns = await all('PRAGMA table_info(inventory_movements)');
  const movementAdditions = { stockBefore: 'INTEGER', stockAfter: 'INTEGER', reason: 'TEXT', reference: 'TEXT', orderId: 'TEXT', purchaseId: 'TEXT', performedBy: 'TEXT', notes: 'TEXT' };
  for (const [name, type] of Object.entries(movementAdditions)) if (!movementColumns.some((column) => column.name === name)) await run(`ALTER TABLE inventory_movements ADD COLUMN ${name} ${type}`);
};

const ensureCatalogOptions = async () => {
  await run(`CREATE TABLE IF NOT EXISTS catalog_options (id TEXT PRIMARY KEY, type TEXT NOT NULL CHECK (type IN ('brand', 'category')), name TEXT NOT NULL COLLATE NOCASE, createdAt TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(type, name))`);
  await run(`INSERT OR IGNORE INTO catalog_options (id, type, name) SELECT 'brand-' || lower(hex(randomblob(12))), 'brand', brand FROM products WHERE trim(brand) <> ''`);
  await run(`INSERT OR IGNORE INTO catalog_options (id, type, name) SELECT 'category-' || lower(hex(randomblob(12))), 'category', category FROM products WHERE trim(category) <> ''`);
};

const run = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
};

const get = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

const all = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

module.exports = {
  db,
  initDb,
  ensureOrderShippingColumns,
  ensureCatalogOptions,
  run,
  get,
  all,
};
