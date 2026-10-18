const test = require('node:test');
const assert = require('node:assert/strict');
const {
  LOGISTICS_STATUS,
  normalizePayload,
  snapshotFromOrder,
  saveDraft,
} = require('../src/services/logisticsPreparation');
const { createOfficialDaneResolver } = require('../src/services/coordinadora/dane');

const resolver = createOfficialDaneResolver();
const profile = { id: 'NARI_STANDARD_BOX', name: 'Caja estándar NARI', length: 24, width: 13.5, height: 6.8, quoteWeight: 2, unit: 'cm' };

test('R14.5 normaliza una preparación válida con Bello y el perfil estándar', () => {
  const value = normalizePayload({
    recipientName: 'Cliente NARI', recipientPhone: '3001234567', addressLine1: 'Calle 1 # 2-3',
    department: 'Antioquia', municipality: 'Bello', packageProfileId: profile.id,
    weightKg: 2, lengthCm: 24, widthCm: 13.5, heightCm: 6.8, units: 1,
  }, { ready: true, daneResolver: resolver, packageProfile: profile });
  assert.equal(value.daneCode, '05088');
  assert.equal(value.providerCode, null);
  assert.equal(value.weightKg, 2);
  assert.equal(value.widthCm, 13.5);
});

test('R14.5 resuelve Bogotá y normaliza tildes/mayúsculas sin coincidencia difusa', () => {
  const bogota = normalizePayload({ department: 'bogotá, d.c.', municipality: 'BOGOTÁ, D.C.' }, { daneResolver: resolver });
  assert.ok(bogota.daneCode);
  assert.throws(() => normalizePayload({ department: 'Antioquia', municipality: 'Municipio inventado' }, { daneResolver: resolver }), /código DANE/i);
});

test('R14.5 rechaza preparación lista incompleta o con magnitudes inválidas', () => {
  assert.throws(() => normalizePayload({ department: 'Antioquia', municipality: 'Bello', weightKg: 0 }, { ready: true, daneResolver: resolver, packageProfile: profile }), /peso/i);
  assert.throws(() => normalizePayload({ department: 'Antioquia', municipality: 'Bello', packageProfileId: profile.id, weightKg: 2, lengthCm: 24, widthCm: 13.5, heightCm: 6.8, units: 1 }, { ready: true, daneResolver: resolver, packageProfile: profile }), /nombre|teléfono|dirección/i);
});

test('R14.5 conserva una instantánea inicial sin inventar datos de proveedor', () => {
  const snapshot = snapshotFromOrder({
    shippingAddress: JSON.stringify({ fullName: 'Cliente', phone: '300', addressLine1: 'Carrera 1', department: 'Antioquia', city: 'Bello' }),
    shippingTotal: 9000,
  }, profile);
  assert.equal(snapshot.packageProfileId, 'NARI_STANDARD_BOX');
  assert.equal(snapshot.weightKg, 2);
  assert.equal(snapshot.shippingAmountPaidByCustomer, undefined);
  assert.equal(snapshot.providerCode, undefined);
});

test('R14.5 expone estados explícitos y no habilita generación de guías', () => {
  assert.deepEqual(LOGISTICS_STATUS, { DRAFT: 'DRAFT', READY_FOR_GUIDE: 'READY_FOR_GUIDE', GUIDE_CREATION_DISABLED: 'GUIDE_CREATION_DISABLED' });
});

test('R14.5 ignora campos comerciales enviados por el cliente', () => {
  const value = normalizePayload({ shippingAmountPaidByCustomer: 1, total: 1, actualCarrierShippingCost: 1, department: 'Antioquia', municipality: 'Medellín' }, { daneResolver: resolver });
  assert.equal(value.shippingAmountPaidByCustomer, undefined);
  assert.equal(value.total, undefined);
  assert.equal(value.actualCarrierShippingCost, undefined);
  assert.ok(value.daneCode);
});

test('R14.5 persiste el envío pagado desde el pedido y no desde el payload administrativo', async () => {
  const calls = [];
  const row = {
    id: 'logistics-test', orderId: 'order-test', status: 'DRAFT', recipientName: 'Cliente', recipientPhone: '300', addressLine1: 'Carrera 1',
    addressLine2: null, department: 'Antioquia', municipality: 'Bello', daneCode: '05088', providerCode: null, deliveryObservations: null,
    packageProfileId: profile.id, weightKg: 2, lengthCm: 24, widthCm: 13.5, heightCm: 6.8, units: 1, declaredValue: null,
    shippingAmountPaidByCustomer: 9000, version: 1,
  };
  const repository = { withTransaction: async (callback) => callback({
    get: async (sql) => sql.includes('WHERE orderid') ? null : row,
    run: async (sql, params) => { calls.push({ sql, params }); return { changes: 1 }; },
  }) };
  await saveDraft({ repository, orderId: 'order-test', adminId: 'admin-test', order: { id: 'order-test', shippingTotal: 9000, shippingAddress: '{}' }, payload: { department: 'Antioquia', municipality: 'Bello', shippingAmountPaidByCustomer: 1, actualCarrierShippingCost: 1 }, standardPackage: profile, daneResolver: resolver });
  const insert = calls.find((call) => call.sql.includes('INSERT INTO order_logistics_preparations'));
  assert.equal(insert.params[18], 9000);
  assert.notEqual(insert.params[18], 1);
});
