const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const { isCommercialOrder } = require('../src/services/commercialOrder');

const adminSource = fs.readFileSync(require.resolve('../src/routes/admin'), 'utf8');

const summarize = (orders) => {
  const qualifying = orders.filter(isCommercialOrder);
  return {
    orderCount: qualifying.length,
    totalPurchased: qualifying.reduce((sum, order) => sum + Number(order.total || 0), 0),
    firstPurchaseAt: qualifying.length ? qualifying.reduce((first, order) => (order.createdAt < first ? order.createdAt : first), qualifying[0].createdAt) : null,
    lastPurchaseAt: qualifying.length ? qualifying.reduce((last, order) => (order.createdAt > last ? order.createdAt : last), qualifying[0].createdAt) : null,
  };
};

const order = (overrides = {}) => ({
  id: 'order-1',
  customerId: 'customer-1',
  status: 'Preparando',
  isTest: false,
  total: 10452,
  createdAt: '2026-10-01T15:00:00.000Z',
  hasPayments: true,
  hasApprovedPayment: true,
  ...overrides,
});

test('customer endpoints use one canonical payment-aware aggregate projection', () => {
  assert.match(adminSource, /const customerPurchaseMetricsJoin = `LEFT JOIN \(/);
  assert.match(adminSource, /MIN\(purchase_orders\.createdat\) AS firstpurchaseat/);
  assert.match(adminSource, /MAX\(purchase_orders\.createdat\) AS lastpurchaseat/);
  assert.match(adminSource, /COUNT\(purchase_orders\.id\) AS ordercount/);
  assert.match(adminSource, /COALESCE\(SUM\(purchase_orders\.total\), 0\) AS totalpurchased/);
  assert.match(adminSource, /WHERE \$\{commercialOrderClause\('purchase_orders'\)\}/);
  assert.match(adminSource, /customerProjection} ORDER BY customers\.createdat DESC/);
  assert.match(adminSource, /customerProjection} WHERE customers\.id = \?/);
  assert.doesNotMatch(adminSource, /customers\.ordercount AS "orderCount"/);
  assert.doesNotMatch(adminSource, /customers\.totalpurchased AS "totalPurchased"/);
});

test('approved payment is the qualifying purchase and failed or pending payments are excluded', () => {
  assert.deepEqual(summarize([order()]), {
    orderCount: 1, totalPurchased: 10452,
    firstPurchaseAt: '2026-10-01T15:00:00.000Z', lastPurchaseAt: '2026-10-01T15:00:00.000Z',
  });
  assert.equal(summarize([order({ hasApprovedPayment: false, hasPayments: true, paymentStatus: 'DECLINED' })]).orderCount, 0);
  assert.equal(summarize([order({ hasApprovedPayment: false, hasPayments: true, paymentStatus: 'PENDING' })]).orderCount, 0);
  assert.equal(summarize([order({ hasApprovedPayment: false, hasPayments: true, paymentStatus: 'CREATED' })]).orderCount, 0);
  assert.equal(summarize([order({ hasApprovedPayment: false, hasPayments: true, paymentStatus: 'ERROR' })]).orderCount, 0);
  assert.equal(summarize([order({ hasApprovedPayment: false, hasPayments: true, paymentStatus: 'VOIDED' })]).orderCount, 0);
});

test('test orders are excluded and legacy orders without payments remain compatible', () => {
  assert.equal(summarize([order({ isTest: true })]).orderCount, 0);
  assert.deepEqual(summarize([order({ hasPayments: false, hasApprovedPayment: false, status: 'Pagado' })]).orderCount, 1);
  assert.equal(summarize([order({ hasPayments: false, hasApprovedPayment: false, status: 'Pendiente' })]).orderCount, 0);
});

test('non-commercial history rows do not overwrite canonical purchase dates', () => {
  assert.doesNotMatch(adminSource, /const purchaseDates = orders\.map/);
  assert.match(adminSource, /res\.json\(\{ \.\.\.customer, \.\.\.customerAccountState\(customer\), orders, addresses \}\)/);
  assert.deepEqual(summarize([order({ hasApprovedPayment: true, createdAt: '2026-10-02T15:00:00.000Z' }), order({ id: 'pending', hasApprovedPayment: false, hasPayments: true, status: 'PENDING', createdAt: '2026-10-03T15:00:00.000Z' })]), {
    orderCount: 1, totalPurchased: 10452,
    firstPurchaseAt: '2026-10-02T15:00:00.000Z', lastPurchaseAt: '2026-10-02T15:00:00.000Z',
  });
});

console.log('customerPurchaseMetrics tests: PASS');
