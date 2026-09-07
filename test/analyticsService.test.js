const test = require('node:test');
const assert = require('node:assert/strict');
const { analyticsPeriod, buildAnalytics, zonedBoundary } = require('../src/services/analyticsService');

const range = { from: '2026-09-01T05:00:00.000Z', to: '2026-10-01T05:00:00.000Z' };
const order = (overrides = {}) => ({ id: `o-${Math.random()}`, customerId: 'c-1', status: 'Pagado', isTest: false, subtotal: 100000, shippingTotal: 15000, total: 115000, shippingCost: 10000, paymentFee: 1200, refundedTotal: 0, createdAt: '2026-09-10T15:00:00.000Z', ...overrides });
const item = (overrides = {}) => ({ orderId: 'o-1', productId: 'p-1', productName: 'Snapshot name', quantity: 2, unitPrice: 50000, unitCost: 30000, ...overrides });

test('canonical commercial metrics exclude shipping from product sales', () => {
  const result = buildAnalytics({ orders: [order({ id: 'o-1' })], items: [item()], products: [], ...range });
  assert.equal(result.productSales, 100000); assert.equal(result.discounts, 0); assert.equal(result.shippingRevenue, 15000); assert.equal(result.totalCollected, 115000); assert.equal(result.commercialOrders, 1); assert.equal(result.averageTicket, 100000); assert.equal(result.unitsSold, 2);
});

test('local free shipping and non-commercial statuses are handled canonically', () => {
  const result = buildAnalytics({ orders: [order({ id: 'o-1', shippingTotal: 0, total: 100000 }), order({ id: 'o-2', status: 'Pendiente' }), order({ id: 'o-3', status: 'Cancelado' }), order({ id: 'o-4', isTest: true })], items: [item({ orderId: 'o-1' })], products: [], ...range });
  assert.equal(result.productSales, 100000); assert.equal(result.shippingRevenue, 0); assert.equal(result.commercialOrders, 1);
});

test('historical unit cost is required and current catalog cost is never used as fallback', () => {
  const result = buildAnalytics({ orders: [order({ id: 'o-1' })], items: [item({ unitCost: null })], products: [{ id: 'p-1', name: 'Current catalog name' }], ...range });
  assert.equal(result.cogs, 0); assert.equal(result.costCoverage.costedItems, 0); assert.equal(result.costCoverage.missingCostItems, 1); assert.equal(result.grossProfitComplete, false);
});

test('shipping cost, payment fees and refunds remain separate from gross profit', () => {
  const result = buildAnalytics({ orders: [order({ id: 'o-1' })], items: [item()], products: [], ...range });
  assert.equal(result.cogs, 60000); assert.equal(result.grossProfit, 40000); assert.equal(result.shippingMargin, 5000); assert.equal(result.paymentFees, 1200); assert.equal(result.refunds, 0);
});

test('Bogota boundaries convert local midnight to UTC consistently', () => {
  assert.equal(zonedBoundary('2026-09-10'), '2026-09-10T05:00:00.000Z');
  assert.equal(zonedBoundary('2026-09-11'), '2026-09-11T05:00:00.000Z');
  const ranges = analyticsPeriod({ period: 'today', now: new Date('2026-09-10T04:59:59.000Z') });
  assert.equal(ranges.current.localFrom, '2026-09-09'); assert.equal(ranges.current.localTo, '2026-09-10');
});

test('top products preserve snapshot names and support safe catalog display fallback', () => {
  const result = buildAnalytics({ orders: [order({ id: 'o-1' })], items: [item({ productName: '', unitCost: 30000 }), item({ orderId: 'o-1', productId: 'p-2', productName: null, unitCost: 20000 })], products: [{ id: 'p-2', name: 'Catalog fallback' }], ...range });
  assert.equal(result.topProducts.find((row) => row.productId === 'p-1').productName, 'Producto sin nombre');
  assert.equal(result.topProducts.find((row) => row.productId === 'p-2').productName, 'Catalog fallback');
  assert.ok(Array.isArray(result.topProductsBy.unitsSold)); assert.ok(Array.isArray(result.topProductsBy.productSales)); assert.ok(Array.isArray(result.topProductsBy.grossProfit));
});

test('new customers are based on first qualifying order, not customer creation', () => {
  const result = buildAnalytics({ orders: [order({ id: 'o-old', customerId: 'c-1', createdAt: '2026-08-20T15:00:00.000Z' }), order({ id: 'o-new', customerId: 'c-2' }), order({ id: 'o-test', customerId: 'c-3', isTest: true })], items: [], products: [], ...range });
  assert.equal(result.newCustomers, 1);
});
