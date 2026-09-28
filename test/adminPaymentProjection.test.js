const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SAFE_PAYMENT_SELECT, latestPaymentForOrder } = require('../src/services/adminPayment');

test('Admin payment projection contains only the approved safe allowlist', () => {
  assert.match(SAFE_PAYMENT_SELECT, /providertransactionid/);
  assert.match(SAFE_PAYMENT_SELECT, /paymentmethodtype/);
  assert.match(SAFE_PAYMENT_SELECT, /approvedat/);
  assert.match(SAFE_PAYMENT_SELECT, /failedat/);
  assert.match(SAFE_PAYMENT_SELECT, /reservationStatus/);
  assert.doesNotMatch(SAFE_PAYMENT_SELECT, /token|signature|payload|failurecode|failuremessage|secret|private/i);
});

test('Admin derives expired CREATED checkouts as Cancelado without changing Payment status', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/routes/admin.js'), 'utf8');
  assert.match(source, /expired_payment\.status = 'CREATED'/);
  assert.match(source, /expired_reservation\.status IN \('EXPIRED', 'RELEASED'\)/);
  assert.match(source, /THEN 'Cancelado'/);
  assert.match(source, /approved_payment\.status = 'APPROVED'/);
});

test('Admin list payment summary gives an existing APPROVED attempt precedence', async () => {
  let query = '';
  await latestPaymentForOrder({ get: async (sql) => { query = sql; return null; } }, 'order-1');
  assert.match(query, /CASE WHEN status = 'APPROVED' THEN 0 ELSE 1 END/);
  assert.match(query, /createdat DESC, id DESC/);
});
