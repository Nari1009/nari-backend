const assert = require('node:assert/strict');
const { calculateShipping, ShippingPolicyError } = require('../src/services/shippingPolicy');

const quote = (department, city, merchandiseSubtotal = 100000) => calculateShipping({
  country: 'Colombia', department, city, merchandiseSubtotal,
});

const bello = quote('Antioquia', 'Bello');
assert.deepEqual({ zone: bello.shippingZone, base: bello.baseRate, variable: bello.variableCharge, total: bello.shippingTotal }, { zone: 'LOCAL', base: 9000, variable: 1000, total: 10000 });

const medellin = quote('Antioquia', 'Medellín');
assert.deepEqual({ zone: medellin.shippingZone, base: medellin.baseRate, variable: medellin.variableCharge, total: medellin.shippingTotal }, { zone: 'REGIONAL', base: 10450, variable: 1000, total: 11450 });

assert.equal(quote('Antioquia', 'Envigado').shippingZone, 'REGIONAL');
assert.equal(quote('Antioquia', 'Sabaneta').shippingZone, 'REGIONAL');
assert.equal(quote('Antioquia', 'Itagüí').shippingZone, 'REGIONAL');
assert.equal(quote('Antioquia', 'La Estrella').shippingZone, 'REGIONAL');

const bogota = quote('Cundinamarca', 'Bogotá, D.C.');
assert.deepEqual({ zone: bogota.shippingZone, base: bogota.baseRate, variable: bogota.variableCharge, total: bogota.shippingTotal }, { zone: 'NATIONAL', base: 17830, variable: 1000, total: 18830 });
assert.equal(quote('Valle del Cauca', 'Cali').shippingZone, 'NATIONAL');

const sanAndres = quote('Archipiélago de San Andrés, Providencia y Santa Catalina', 'San Andrés');
assert.deepEqual({ zone: sanAndres.shippingZone, base: sanAndres.baseRate, variable: sanAndres.variableCharge, total: sanAndres.shippingTotal }, { zone: 'OTHER', base: 27560, variable: 1000, total: 28560 });

assert.equal(quote(' antioquia ', '  MEDellin  ').shippingZone, 'REGIONAL');
assert.equal(quote('ANTIOQUIA', 'BÉLLO').shippingZone, 'LOCAL');
assert.equal(quote('Antioquia', 'Bello', 1).shippingTotal, 9000);
assert.equal(quote('Antioquia', 'Bello', 149).variableCharge, 1);
assert.equal(quote('Antioquia', 'Bello', 150).variableCharge, 2);
assert.throws(() => calculateShipping({ country: 'Ecuador', department: 'Pichincha', city: 'Quito', merchandiseSubtotal: 100000 }), ShippingPolicyError);
assert.throws(() => calculateShipping({ country: 'Colombia', department: 'Unknown', city: 'Bogotá', merchandiseSubtotal: 100000 }), ShippingPolicyError);
assert.throws(() => calculateShipping({ country: 'Colombia', department: 'Antioquia', city: 'Bello', merchandiseSubtotal: -1 }), ShippingPolicyError);

console.log('shippingPolicy tests: PASS');
