const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('R12C movement inserts use the strict transaction primitive for every movement type', () => {
  const service = read('src/services/inventoryReservation.js');
  const adapter = read('src/db/init.js');
  assert.match(service, /const insertMovement[\s\S]*?tx\.runStrict\(/i);
  assert.match(adapter, /const translateStrict = \(sql\) => translateSql\(sql, \{ ignoreInsertConflicts: false \}\)/i);
  assert.match(adapter, /runStrict: async \(sql, params = \[\]\) => \{ const result = await client\.query\(translateStrict\(sql\), params\)/i);
  assert.doesNotMatch(service, /insertMovement[\s\S]*?ON CONFLICT\s*\(reference\)\s*DO NOTHING/i);
});

test('legacy run retains its existing implicit conflict behavior while strict path opts out', () => {
  const adapter = read('src/db/init.js');
  assert.match(adapter, /const translate = \(sql\) => translateSql\(sql\)/i);
  assert.match(adapter, /ignoreInsertConflicts &&/i);
});
