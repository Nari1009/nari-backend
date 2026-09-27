const test = require('node:test');
const assert = require('node:assert/strict');
const { isCommercialOrder } = require('../src/services/commercialOrder');
const { summarizePaymentAnalytics } = require('../src/services/analyticsService');

test('payment-aware commercial truth excludes failed attempts and includes approved pending fulfillment', () => {
  assert.equal(isCommercialOrder({ isTest: false, status: 'Pendiente', hasPayments: true, hasApprovedPayment: false }), false);
  assert.equal(isCommercialOrder({ isTest: false, status: 'Pendiente', hasPayments: true, hasApprovedPayment: true }), true);
  for (const status of ['CREATED', 'PENDING', 'DECLINED', 'ERROR', 'VOIDED']) assert.equal(isCommercialOrder({ isTest: false, status: 'Preparando', hasPayments: true, hasApprovedPayment: false }), false, status);
});

test('legacy orders without payments retain the historical status fallback', () => {
  assert.equal(isCommercialOrder({ isTest: false, status: 'Entregado', hasPayments: false, hasApprovedPayment: false }), true);
  assert.equal(isCommercialOrder({ isTest: false, status: 'Pendiente', hasPayments: false, hasApprovedPayment: false }), false);
});

test('payment analytics counts attempts and uses terminal-only approval denominator', () => {
  const result = summarizePaymentAnalytics([
    { status: 'APPROVED', paymentMethodType: 'CARD' },
    { status: 'DECLINED', paymentMethodType: 'CARD' },
    { status: 'PENDING', paymentMethodType: 'PSE' },
    { status: 'ERROR', paymentMethodType: null },
  ]);
  assert.deepEqual(result, { attempts: 4, approved: 1, declined: 1, pending: 1, error: 1, voided: 0, approvalRate: 1 / 3, byMethod: { CARD: 2, PSE: 1, 'Sin especificar': 1 } });
  assert.equal(summarizePaymentAnalytics([]).approvalRate, 0);
});
