const assert = require('node:assert/strict');
const { calculateShipping, ShippingPolicyError } = require('../src/services/shippingPolicy');

const beforeCutoff = new Date('2026-09-07T15:59:59.000Z');
const atCutoff = new Date('2026-09-07T16:00:00.000Z');
const nationalFee = 18000;

const localBefore = calculateShipping({ department: 'Antioquia', city: 'Medellín', now: beforeCutoff, standardCost: nationalFee });
assert.equal(localBefore.shippingZone, 'LOCAL');
assert.equal(localBefore.shippingTotal, 0);
assert.equal(localBefore.deliveryType, 'SAME_DAY');
assert.equal(localBefore.sameDayEligible, true);

const localAtCutoff = calculateShipping({ department: 'Antioquia', city: 'Medellín', now: atCutoff, standardCost: nationalFee });
assert.equal(localAtCutoff.shippingTotal, 0);
assert.equal(localAtCutoff.deliveryType, 'STANDARD');
assert.equal(localAtCutoff.sameDayEligible, false);

const bello = calculateShipping({ department: 'Antioquia', city: 'Bello', now: beforeCutoff, standardCost: nationalFee });
assert.equal(bello.shippingZone, 'LOCAL');
assert.equal(bello.shippingTotal, 0);
assert.equal(bello.sameDayEligible, true);

const laEstrella = calculateShipping({ department: 'Antioquia', city: 'La Estrella', now: atCutoff, standardCost: nationalFee });
assert.equal(laEstrella.shippingZone, 'LOCAL');
assert.equal(laEstrella.shippingTotal, 0);
assert.equal(laEstrella.sameDayEligible, false);

const national = calculateShipping({ department: 'Cundinamarca', city: 'Bogotá, D.C.', now: beforeCutoff, standardCost: nationalFee });
assert.equal(national.shippingZone, 'NATIONAL');
assert.equal(national.shippingTotal, nationalFee);
assert.equal(national.deliveryType, 'STANDARD');
assert.equal(national.sameDayEligible, false);

const wrongDepartment = calculateShipping({ department: 'Cundinamarca', city: 'Medellín', now: beforeCutoff, standardCost: nationalFee });
assert.equal(wrongDepartment.shippingZone, 'NATIONAL');
assert.equal(wrongDepartment.sameDayEligible, false);

const accentMatch = calculateShipping({ department: 'Antioquia', city: 'Medellin', now: beforeCutoff, standardCost: nationalFee });
assert.equal(accentMatch.shippingZone, 'LOCAL');

assert.throws(() => calculateShipping({ department: 'Cundinamarca', city: 'Bogotá, D.C.', now: beforeCutoff }), ShippingPolicyError);
assert.throws(() => calculateShipping({ department: 'Unknown', city: 'Medellín', now: beforeCutoff, standardCost: nationalFee }), ShippingPolicyError);
assert.throws(() => calculateShipping({ department: 'Cundinamarca', city: 'Bogotá, D.C.', now: beforeCutoff, standardCost: 'abc' }), ShippingPolicyError);

console.log('shippingPolicy tests: PASS');
