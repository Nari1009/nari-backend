const assert = require('node:assert/strict');
const test = require('node:test');
const { getShippingQuote, ShippingPolicyError } = require('../src/services/shippingPolicy');

const repository = {
  all: async () => [
    { id: 'p-1', price: 100000, status: 'ACTIVE' },
    { id: 'p-2', price: 25000, status: 'ACTIVE' },
  ],
};

test('shipping quote derives declared value from canonical product prices', async () => {
  const quote = await getShippingQuote({ country: 'Colombia', department: 'Antioquia', city: 'Bello', items: [{ productId: 'p-1', quantity: 1 }] }, repository);
  assert.equal(quote.declaredValue, 100000);
  assert.equal(quote.shippingTotal, 10000);
});

test('shipping quote ignores arbitrary client subtotal', async () => {
  const quote = await getShippingQuote({ country: 'Colombia', department: 'Antioquia', city: 'Bello', items: [{ productId: 'p-1', quantity: 1 }], merchandiseSubtotal: 1 }, repository);
  assert.equal(quote.declaredValue, 100000);
  assert.equal(quote.shippingTotal, 10000);
});

test('shipping quote requires cart items when called as a public quote', async () => {
  await assert.rejects(() => getShippingQuote({ country: 'Colombia', department: 'Antioquia', city: 'Bello' }, repository), ShippingPolicyError);
});
