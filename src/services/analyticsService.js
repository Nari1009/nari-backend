const ANALYTICS_TIME_ZONE = 'America/Bogota';
const COMMERCIAL_ORDER_STATUSES = Object.freeze(['Pagado', 'Preparando', 'Enviado', 'Entregado']);

const roundCop = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : 0;
};

const roundRatio = (value, places = 6) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  const factor = 10 ** places;
  return Math.round(number * factor) / factor;
};

const asDate = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const zonedParts = (value, timeZone = ANALYTICS_TIME_ZONE) => {
  const date = asDate(value) || new Date();
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).filter(({ type }) => type !== 'literal').map(({ type, value: part }) => [type, part]));
};

const offsetAt = (value, timeZone = ANALYTICS_TIME_ZONE) => {
  const parts = zonedParts(value, timeZone);
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second)) - asDate(value).getTime();
};

const zonedBoundary = (dateText, timeText = '00:00:00', timeZone = ANALYTICS_TIME_ZONE) => {
  const naive = new Date(`${dateText}T${timeText}Z`);
  if (Number.isNaN(naive.getTime())) throw new Error(`Invalid analytics date: ${dateText}`);
  let utc = new Date(naive.getTime() - offsetAt(naive, timeZone));
  utc = new Date(naive.getTime() - offsetAt(utc, timeZone));
  return utc.toISOString();
};

const dateText = (value) => {
  const parts = zonedParts(value);
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const shiftDate = (dateString, days) => {
  const date = new Date(`${dateString}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const periodFromDates = (from, to) => ({
  from: zonedBoundary(from),
  to: zonedBoundary(to),
  localFrom: from,
  localTo: to,
  localThrough: shiftDate(to, -1),
});

const analyticsPeriod = ({ period = '30d', from, to, now = new Date() } = {}) => {
  const today = dateText(now);
  let localFrom = from;
  let localTo = to;
  if (period === 'today') { localFrom = today; localTo = shiftDate(today, 1); }
  else if (period === '7d') { localFrom = shiftDate(today, -6); localTo = shiftDate(today, 1); }
  else if (period === '30d' || !period) { localFrom = shiftDate(today, -29); localTo = shiftDate(today, 1); }
  else if (period === 'month') { localFrom = `${today.slice(0, 7)}-01`; localTo = shiftDate(today, 1); }
  else if (period === 'custom' && from && to) localTo = shiftDate(to, 1);
  else { localFrom = localFrom || shiftDate(today, -29); localTo = localTo || shiftDate(today, 1); }
  const current = periodFromDates(localFrom, localTo);
  const days = Math.max(1, Math.round((new Date(current.to) - new Date(current.from)) / 86400000));
  const previousLocalTo = localFrom;
  const previousLocalFrom = shiftDate(localFrom, -days);
  return { current, previous: periodFromDates(previousLocalFrom, previousLocalTo), timeZone: ANALYTICS_TIME_ZONE };
};

const isCommercialOrder = (order) => COMMERCIAL_ORDER_STATUSES.includes(order.status) && order.isTest !== true;
const rankTopProducts = (rows, metric = 'unitsSold') => [...rows].sort((a, b) => Number(b[metric] || 0) - Number(a[metric] || 0));

const buildAnalytics = ({ orders = [], items = [], products = [], from, to }) => {
  const qualifying = orders.filter(isCommercialOrder);
  const inPeriod = qualifying.filter((order) => {
    const created = asDate(order.createdAt);
    return created && created >= new Date(from) && created < new Date(to);
  });
  const periodIds = new Set(inPeriod.map((order) => order.id));
  const periodItems = items.filter((item) => periodIds.has(item.orderId));
  const productSales = roundCop(inPeriod.reduce((sum, order) => sum + Number(order.subtotal || 0), 0));
  const discounts = roundCop(inPeriod.reduce((sum, order) => sum + Number(order.discountTotal || 0), 0));
  const shippingRevenue = roundCop(inPeriod.reduce((sum, order) => sum + Number(order.shippingTotal || 0), 0));
  const totalCollected = roundCop(inPeriod.reduce((sum, order) => sum + Number(order.total || 0), 0));
  const unitsSold = periodItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const costedItems = periodItems.filter((item) => item.unitCost !== null && item.unitCost !== undefined && Number.isFinite(Number(item.unitCost)));
  const missingCostItems = periodItems.length - costedItems.length;
  const cogs = roundCop(costedItems.reduce((sum, item) => sum + Number(item.unitCost) * Number(item.quantity || 0), 0));
  const grossProfit = roundCop(productSales - cogs);
  const productGroups = new Map();
  for (const item of periodItems) {
    const product = products.find((candidate) => candidate.id === item.productId);
    const key = item.productId;
    const current = productGroups.get(key) || { productId: key, productName: item.productName || product?.name || 'Producto sin nombre', unitsSold: 0, productSales: 0, grossProfit: 0, orders: new Set(), costComplete: true };
    const lineSales = roundCop(Number(item.unitPrice || 0) * Number(item.quantity || 0));
    const hasCost = item.unitCost !== null && item.unitCost !== undefined && Number.isFinite(Number(item.unitCost));
    current.unitsSold += Number(item.quantity || 0);
    current.productSales += lineSales;
    current.grossProfit += hasCost ? roundCop(lineSales - Number(item.unitCost) * Number(item.quantity || 0)) : 0;
    current.orders.add(item.orderId);
    current.costComplete = current.costComplete && hasCost;
    productGroups.set(key, current);
  }
  const topProducts = [...productGroups.values()].map((row) => ({ ...row, orders: row.orders.size, grossMargin: row.productSales ? roundRatio(row.grossProfit / row.productSales) : 0, costComplete: row.costComplete, _orders: undefined })).map(({ _orders, ...row }) => row);
  const shippingCost = roundCop(inPeriod.reduce((sum, order) => sum + Number(order.shippingCost || 0), 0));
  const paymentFees = roundCop(inPeriod.reduce((sum, order) => sum + Number(order.paymentFee || 0), 0));
  const refunds = roundCop(inPeriod.reduce((sum, order) => sum + Number(order.refundedTotal || 0), 0));
  const firstQualifyingByCustomer = new Map();
  for (const order of [...qualifying].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))) {
    if (order.customerId && !firstQualifyingByCustomer.has(order.customerId)) firstQualifyingByCustomer.set(order.customerId, order);
  }
  const newCustomers = [...firstQualifyingByCustomer.values()].filter((order) => {
    const created = new Date(order.createdAt);
    return created >= new Date(from) && created < new Date(to);
  }).length;
  const chart = new Map();
  for (const order of inPeriod) {
    const key = dateText(order.createdAt);
    const point = chart.get(key) || { label: key, productSales: 0, shippingRevenue: 0, totalCollected: 0, orders: 0 };
    point.productSales += Number(order.subtotal || 0); point.shippingRevenue += Number(order.shippingTotal || 0); point.totalCollected += Number(order.total || 0); point.orders += 1; chart.set(key, point);
  }
  return {
    productSales, discounts, shippingRevenue, totalCollected, commercialOrders: inPeriod.length,
    averageTicket: inPeriod.length ? roundCop(productSales / inPeriod.length) : 0,
    unitsSold, cogs, costCoverage: { eligibleItems: periodItems.length, costedItems: costedItems.length, missingCostItems, complete: missingCostItems === 0 },
    grossProfit, grossProfitComplete: missingCostItems === 0, grossMargin: productSales ? roundRatio(grossProfit / productSales) : 0,
    shippingCost, shippingMargin: shippingRevenue - shippingCost, paymentFees, refunds, newCustomers,
    topProducts: rankTopProducts(topProducts),
    topProductsBy: { unitsSold: rankTopProducts(topProducts, 'unitsSold'), productSales: rankTopProducts(topProducts, 'productSales'), grossProfit: rankTopProducts(topProducts, 'grossProfit') },
    chart: [...chart.values()].sort((a, b) => a.label.localeCompare(b.label)),
  };
};

const getAnalytics = async ({ period, from, to, now } = {}) => {
  const { all } = require('../db/init');
  const ranges = analyticsPeriod({ period, from, to, now });
  const rows = await all(`SELECT id, customerId, status, isTest, subtotal, shippingTotal, total, shippingCost, paymentFee, refundedTotal, createdAt FROM orders WHERE isTest = FALSE`);
  const items = await all('SELECT orderId, productId, productName, quantity, unitPrice, unitCost FROM order_items');
  const products = await all('SELECT id, name FROM products');
  const metrics = buildAnalytics({ orders: rows, items, products, from: ranges.current.from, to: ranges.current.to });
  const previous = buildAnalytics({ orders: rows, items, products, from: ranges.previous.from, to: ranges.previous.to });
  return { ...metrics, previous, period: ranges.current, previousPeriod: ranges.previous, timeZone: ranges.timeZone, commercialStatuses: COMMERCIAL_ORDER_STATUSES };
};

module.exports = { ANALYTICS_TIME_ZONE, COMMERCIAL_ORDER_STATUSES, analyticsPeriod, buildAnalytics, getAnalytics, isCommercialOrder, rankTopProducts, roundCop, roundRatio, zonedBoundary };
