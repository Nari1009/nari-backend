const { all, get } = require('../db/init');

const validSaleStatuses = ['Pagado', 'Preparando', 'Enviado', 'Entregado'];
const validSalePlaceholders = validSaleStatuses.map(() => '?').join(',');

const periodClause = (alias = 'o') => `${alias}.status IN (${validSalePlaceholders}) AND datetime(${alias}.createdAt) >= datetime(?) AND datetime(${alias}.createdAt) < datetime(?)`;

async function getReportData({ from, to, lowStockThreshold = 3 }) {
  const orderParams = [...validSaleStatuses, from, to];
  const [orders, items, inventory, movements, customers, totals, financial, abandonedCarts] = await Promise.all([
    all(`SELECT o.id, o.createdAt, o.status, o.total, o.subtotal, o.shippingTotal, o.discountTotal, o.paymentFee, o.shippingCost, o.refundedTotal, o.shippingProvider, o.trackingNumber, c.firstName, c.lastName, c.email, c.phone, (SELECT city FROM account_addresses WHERE userId = o.userId AND isDefault = 1 ORDER BY updatedAt DESC LIMIT 1) AS city, (SELECT department FROM account_addresses WHERE userId = o.userId AND isDefault = 1 ORDER BY updatedAt DESC LIMIT 1) AS department, (SELECT country FROM account_addresses WHERE userId = o.userId AND isDefault = 1 ORDER BY updatedAt DESC LIMIT 1) AS country
      FROM orders o LEFT JOIN customers c ON c.id = o.customerId OR c.authUserId = o.userId
      WHERE ${periodClause('o')} ORDER BY o.createdAt DESC`, orderParams),
    all(`SELECT oi.orderId, o.createdAt, o.status, oi.productId, oi.productName, oi.quantity, oi.unitPrice, oi.unitCost, p.sku, p.brand, p.category, p.supplier, p.cost AS currentCost, p.price AS currentPrice, c.firstName, c.lastName, c.email, (SELECT city FROM account_addresses WHERE userId = o.userId AND isDefault = 1 ORDER BY updatedAt DESC LIMIT 1) AS city, (SELECT department FROM account_addresses WHERE userId = o.userId AND isDefault = 1 ORDER BY updatedAt DESC LIMIT 1) AS department
      FROM order_items oi JOIN orders o ON o.id = oi.orderId LEFT JOIN products p ON p.id = oi.productId LEFT JOIN customers c ON c.id = o.customerId OR c.authUserId = o.userId
      WHERE ${periodClause('o')} ORDER BY o.createdAt DESC, oi.id`, orderParams),
    all('SELECT id, sku, name, brand, supplier, category, stock, minimumStock, cost, price, status FROM products ORDER BY brand, name'),
    all(`SELECT m.createdAt, m.productId, p.sku, p.name AS productName, m.type, m.quantity, m.description, m.stockBefore, m.stockAfter, m.reason, m.reference, m.orderId, m.purchaseId, m.performedBy, m.notes FROM inventory_movements m LEFT JOIN products p ON p.id = m.productId WHERE datetime(m.createdAt) >= datetime(?) AND datetime(m.createdAt) < datetime(?) ORDER BY m.createdAt DESC`, [from, to]),
    all(`SELECT c.id, c.authUserId, c.firstName, c.lastName, c.email, c.phone, c.city, c.department, c.firstPurchaseAt, c.lastPurchaseAt, c.orderCount, c.totalPurchased FROM customers c ORDER BY c.totalPurchased DESC`),
    get(`SELECT (SELECT COALESCE(SUM(o.total), 0) FROM orders o WHERE ${periodClause('o')}) AS sales, (SELECT COUNT(*) FROM orders o WHERE ${periodClause('o')}) AS orders, (SELECT COALESCE(SUM(oi.quantity), 0) FROM order_items oi JOIN orders o ON o.id = oi.orderId WHERE ${periodClause('o')}) AS units`, [...orderParams, ...orderParams, ...orderParams]),
    get(`SELECT (SELECT COALESCE(SUM(o.subtotal), 0) FROM orders o WHERE ${periodClause('o')}) AS grossSales, (SELECT COALESCE(SUM(o.discountTotal), 0) FROM orders o WHERE ${periodClause('o')}) AS discounts, (SELECT COALESCE(SUM(o.paymentFee), 0) FROM orders o WHERE ${periodClause('o')}) AS paymentFees, (SELECT COALESCE(SUM(o.shippingCost), 0) FROM orders o WHERE ${periodClause('o')}) AS shippingCosts, (SELECT COALESCE(SUM(o.refundedTotal), 0) FROM orders o WHERE ${periodClause('o')}) AS refunds, (SELECT COALESCE(SUM(oi.quantity * COALESCE(oi.unitCost, p.cost, 0)), 0) FROM order_items oi JOIN orders o ON o.id = oi.orderId LEFT JOIN products p ON p.id = oi.productId WHERE ${periodClause('o')}) AS productCost`, [...orderParams, ...orderParams, ...orderParams, ...orderParams, ...orderParams, ...orderParams]),
    get('SELECT COUNT(*) AS count FROM abandoned_carts WHERE convertedAt IS NULL'),
  ]);
  const productGroups = new Map();
  for (const item of items) {
    const key = item.productId || item.productName;
    const current = productGroups.get(key) || { productId: item.productId, sku: item.sku || '', productName: item.productName, brand: item.brand || '', supplier: item.supplier || '', category: item.category || '', units: 0, orders: new Set(), grossSales: 0, discounts: 0, sales: 0, cost: 0, profit: 0 };
    const unitCost = Number(item.unitCost ?? item.currentCost ?? 0); const gross = Number(item.unitPrice || 0) * Number(item.quantity || 0);
    current.units += Number(item.quantity || 0); current.orders.add(item.orderId); current.grossSales += gross; current.sales += gross; current.cost += unitCost * Number(item.quantity || 0); current.profit += (Number(item.unitPrice || 0) - unitCost) * Number(item.quantity || 0); productGroups.set(key, current);
  }
  const productRows = [...productGroups.values()].map((row) => ({ ...row, orders: row.orders.size, margin: row.sales ? row.profit / row.sales : 0 })).sort((a, b) => b.profit - a.profit);
  const inventoryTotals = await get('SELECT COALESCE(SUM(stock), 0) AS units, COALESCE(SUM(stock * cost), 0) AS costValue, COALESCE(SUM(stock * price), 0) AS saleValue, COUNT(CASE WHEN status = \'active\' THEN 1 END) AS active FROM products');
  return { orders, items, inventory, movements, customers, totals, financial, abandonedCarts: Number(abandonedCarts?.count || 0), productRows, inventoryTotals };
}

module.exports = { getReportData, validSaleStatuses, periodClause };
