const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = process.env.DATABASE_URL || path.join(__dirname, '../../nari.db');
const db = new sqlite3.Database(dbPath);

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
          price REAL NOT NULL,
          cost REAL,
          stock INTEGER NOT NULL DEFAULT 0,
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
          images TEXT,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
          updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });
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
  run,
  get,
  all,
};
