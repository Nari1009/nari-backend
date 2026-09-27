const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync(require.resolve('../src/routes/admin'), 'utf8');

test('Admin fulfillment guard requires an approved payment for payment-aware orders', () => {
  assert.match(source, /fulfillmentStatusesRequiringApproval = new Set\(\['Preparando', 'Enviado', 'Entregado'\]\)/);
  assert.match(source, /EXISTS \(SELECT 1 FROM payments WHERE orderid = \?\) AS "hasPayments"/);
  assert.match(source, /EXISTS \(SELECT 1 FROM payments WHERE orderid = \? AND status = 'APPROVED'\) AS "hasApprovedPayment"/);
  assert.match(source, /paymentState\?\.hasPayments && !paymentState\.hasApprovedPayment/);
  assert.match(source, /paymentApprovalGuard\(tx, req\.params\.id, 'Enviado'\)/);
  assert.match(source, /paymentApprovalGuard\(tx, req\.params\.id, status\)/);
});

test('legacy orders without payments remain compatible with the guard', () => {
  assert.match(source, /if \(paymentState\?\.hasPayments && !paymentState\.hasApprovedPayment\)/);
});
