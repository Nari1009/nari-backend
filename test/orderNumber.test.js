const test = require('node:test');
const assert = require('node:assert/strict');
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
