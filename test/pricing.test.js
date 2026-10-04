const assert = require('assert');
const { calculateProductPricing, normalizeDiscountPercent } = require('../src/services/pricing');

assert.deepStrictEqual(calculateProductPricing({ basePrice: 146900 }), {
  basePrice: 146900, productDiscountPercent: 0, globalDiscountPercent: 0,
  effectiveDiscountPercent: 0, discountSource: 'NONE', discountAmount: 0, effectivePrice: 146900,
});
assert.strictEqual(calculateProductPricing({ basePrice: 146900, productDiscountPercent: 30 }).effectivePrice, 102830);
assert.strictEqual(calculateProductPricing({ basePrice: 146900, globalDiscountPercent: 15, globalEnabled: true }).effectivePrice, 124865);
assert.deepStrictEqual(calculateProductPricing({ basePrice: 146900, productDiscountPercent: 10, globalDiscountPercent: 15, globalEnabled: true }), {
  basePrice: 146900, productDiscountPercent: 10, globalDiscountPercent: 15,
  effectiveDiscountPercent: 15, discountSource: 'GLOBAL', discountAmount: 22035, effectivePrice: 124865,
});
assert.strictEqual(calculateProductPricing({ basePrice: 100000, productDiscountPercent: 20, globalDiscountPercent: 20, globalEnabled: true }).discountSource, 'PRODUCT');
assert.strictEqual(calculateProductPricing({ basePrice: 101, productDiscountPercent: 99 }).effectivePrice, 1);
assert.throws(() => normalizeDiscountPercent(-1), /entre 0 y 99/);
assert.throws(() => normalizeDiscountPercent(100), /entre 0 y 99/);
assert.throws(() => normalizeDiscountPercent(10.5), /entero/);
console.log('pricing.test.js PASS');
