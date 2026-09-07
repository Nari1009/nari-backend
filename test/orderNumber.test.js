const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { formatOrderNumber } = require('../src/services/orderNumber');

test('formats public order numbers with minimum six-digit padding', () => {
  assert.equal(formatOrderNumber(1), 'NAR-000001');
  assert.equal(formatOrderNumber(42), 'NAR-000042');
  assert.equal(formatOrderNumber(999999), 'NAR-999999');
  assert.equal(formatOrderNumber(1000000), 'NAR-1000000');
});

test('rejects invalid sequence values', () => {
  assert.throws(() => formatOrderNumber(0));
  assert.throws(() => formatOrderNumber(Number.NaN));
  assert.throws(() => formatOrderNumber(Number.POSITIVE_INFINITY));
});

test('order INSERT maps one generated public number to one database column', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/services/orderCreation.js'), 'utf8');
  const match = source.match(/INSERT INTO orders \(([^]+?)\) VALUES \(([^]+?)\)'/);
  assert.ok(match, 'order INSERT should exist');
  const columns = match[1].split(',').map((value) => value.trim());
  const placeholders = match[2].match(/\?/g) || [];
  assert.equal(columns.filter((column) => column === 'ordernumber').length, 1);
  assert.equal(columns.length, placeholders.length);
  assert.equal(columns[1], 'ordernumber');
  assert.match(source, /orderNumber = await nextOrderNumber\(tx\)/);
  assert.match(source, /return \{ id, orderNumber,/);
  assert.doesNotMatch(source, /payload\.(?:orderNumber|ordernumber)/);
});
