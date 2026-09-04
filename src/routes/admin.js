const express = require('express');
const { all, get, run } = require('../db/init');
const { requireAdmin } = require('../middleware/adminAuth');
const { getContent, saveContent } = require('../db/content');
const crypto = require('crypto');
const { hashToken } = require('../services/auth');
const { sendReviewLinkEmail, sendOrderShippedEmail } = require('../services/email');
const { getReportData } = require('../services/reportData');
const { makeWorkbook } = require('../services/xlsxReports');
const { uploadProductImage } = require('../services/storage');
const router = express.Router();
const serializeList = (value) => {
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value !== 'string' || !value.trim()) return '[]';
  let parsed = value;
  for (let attempt = 0; attempt < 4 && typeof parsed === 'string'; attempt += 1) {
    try { parsed = JSON.parse(parsed); } catch { break; }
  }
  return JSON.stringify(Array.isArray(parsed) ? parsed : value.split('\n').map((item) => item.trim()).filter(Boolean));
};
const listColumns = new Set(['skinTypes', 'concerns', 'ingredients', 'featuredIngredients', 'benefits', 'howToUse', 'images']);
// DEV/mock: una orden no cancelada representa una venta registrada; el pago real queda pendiente de paymentStatus.
const validSaleStatuses = ['Pendiente', 'Preparando', 'Enviado', 'Entregado'];
const saleStatusSql = `(${validSaleStatuses.map(() => '?').join(',')})`;
const customerAccountState = (customer) => {
  const hasCustomerAuthUser = Boolean(String(customer.authUserId || '').trim());
  const hasAuthUserRecord = Boolean(String(customer.authUserRecordId || '').trim());
  const accountType = hasCustomerAuthUser ? 'registered' : 'guest';
  const verificationStatus = !hasCustomerAuthUser || !hasAuthUserRecord ? 'none' : customer.emailVerifiedAt ? 'verified' : 'pending';
  const accountStatus = !hasCustomerAuthUser || !hasAuthUserRecord ? 'none' : Number(customer.authIsActive) === 0 ? 'inactive' : 'active';
  return { accountType, verificationStatus, accountStatus };
};
const dashboardDate = (value, fallback) => {
  const parsed = value ? new Date(value) : fallback;
  return Number.isNaN(parsed.getTime()) ? fallback.toISOString() : parsed.toISOString();
};

router.use(requireAdmin);

router.get('/content/:page', async (req, res) => {
  const content = await getContent(req.params.page);
  if (!content) return res.status(404).json({ error: 'Content not found' });
  res.json({ page: req.params.page, content });
});

router.put('/content/:page', async (req, res) => {
  if (!req.body || typeof req.body.content !== 'object' || Array.isArray(req.body.content)) return res.status(400).json({ error: 'Content must be a JSON object' });
  res.json({ page: req.params.page, content: await saveContent(req.params.page, req.body.content) });
});

router.get('/products', async (req, res) => {
  const products = await all('SELECT * FROM products ORDER BY isBestSeller DESC, name ASC');
  res.json(products);
});

router.get('/products/:id', async (req, res) => {
  const product = await get('SELECT * FROM products WHERE id = ?', [req.params.id]);

  if (!product) {
    return res.status(404).json({ error: 'Product not found' });
  }

  res.json(product);
});

router.post('/products/:id/images', async (req, res, next) => {
  try {
    const product = await get('SELECT id, name, images FROM products WHERE id = ?', [req.params.id]);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    if (!req.body?.dataUrl) return res.status(400).json({ error: 'Selecciona una imagen.' });
    const image = await uploadProductImage({ productId: product.id, dataUrl: req.body.dataUrl, alt: req.body.alt || product.name });
    let images = product.images;
    if (typeof images === 'string') {
      try { images = JSON.parse(images); } catch { images = []; }
    }
    if (!Array.isArray(images)) images = [];
    const cleanImages = images.filter((item) => item && typeof item === 'object' && typeof item.url === 'string' && !item.url.startsWith('data:'));
    cleanImages.push({ url: image.url, alt: image.alt });
    await run('UPDATE products SET images = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?', [JSON.stringify(cleanImages), product.id]);
    res.status(201).json({ image, images: cleanImages });
  } catch (error) { next(error); }
});

router.post('/products/migrate-images', async (req, res, next) => {
  try {
    const products = await all('SELECT id, name, images FROM products ORDER BY name');
    const migrated = []; const skipped = []; const failed = [];
    for (const product of products) {
      let images = product.images;
      if (typeof images === 'string') {
        try { images = JSON.parse(images); } catch { images = []; }
      }
      if (!Array.isArray(images) || !images.some((item) => typeof item === 'string' && item.startsWith('data:') || item?.url?.startsWith('data:'))) {
        skipped.push(product.name);
        continue;
      }
      const nextImages = [];
      try {
        for (const item of images) {
          const dataUrl = typeof item === 'string' ? item : item?.url;
          if (!String(dataUrl || '').startsWith('data:')) {
            if (item && typeof item === 'object' && item.url) nextImages.push(item);
            continue;
          }
          nextImages.push(await uploadProductImage({ productId: product.id, dataUrl, alt: item?.alt || product.name }));
        }
        await run('UPDATE products SET images = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?', [JSON.stringify(nextImages), product.id]);
        migrated.push(product.name);
      } catch (error) {
        failed.push({ product: product.name, error: error.message });
      }
    }
    res.json({ migrated, skipped, failed });
  } catch (error) { next(error); }
});

router.get('/catalog-options', async (req, res, next) => {
  try {
    res.json(await all('SELECT id, type, name FROM catalog_options ORDER BY type, name COLLATE NOCASE'));
  } catch (error) { next(error); }
});

router.post('/catalog-options', async (req, res, next) => {
  try {
    const type = String(req.body?.type || '').trim();
    const name = String(req.body?.name || '').trim().replace(/\s+/g, ' ');
    if (!['brand', 'category', 'skinType', 'concern', 'ingredient'].includes(type) || !name || name.length > 120) return res.status(400).json({ error: 'Tipo o nombre de opción inválido.' });
    const id = `${type}-${crypto.randomBytes(12).toString('hex')}`;
    await run('INSERT OR IGNORE INTO catalog_options (id, type, name) VALUES (?, ?, ?)', [id, type, name]);
    res.status(201).json(await get('SELECT id, type, name FROM catalog_options WHERE type = ? AND name = ? COLLATE NOCASE', [type, name]));
  } catch (error) { next(error); }
});

router.delete('/catalog-options/:id', async (req, res, next) => {
  const option = await get('SELECT id, type, name FROM catalog_options WHERE id = ?', [req.params.id]);
  if (!option) return res.status(404).json({ error: 'Opción no encontrada.' });
  const listColumnsByType = { skinType: 'skinTypes', concern: 'concerns', ingredient: 'ingredients' };
  const column = listColumnsByType[option.type];
  try {
    await run('BEGIN TRANSACTION');
    if (column) {
      const products = await all(`SELECT id, ${column} AS value FROM products`);
      for (const product of products) {
        let values = product.value;
        if (typeof values === 'string') {
          try { values = JSON.parse(values); } catch { values = values.split(/\r?\n/); }
        }
        if (!Array.isArray(values)) values = values ? [values] : [];
        const normalized = values.flatMap((value) => String(value || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean));
        const remaining = normalized.filter((value) => value.toLowerCase() !== option.name.toLowerCase());
        if (remaining.length !== normalized.length) {
          await run(`UPDATE products SET ${column} = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`, [JSON.stringify(remaining), product.id]);
        }
      }
    }
    await run('DELETE FROM catalog_options WHERE id = ?', [option.id]);
    await run('COMMIT');
    res.status(204).end();
  } catch (error) {
    await run('ROLLBACK').catch(() => undefined);
    next(error);
  }
});

const rememberCatalogOption = async (type, value) => {
  let values = value;
  if (!Array.isArray(values) && typeof values === 'string') {
    try { values = JSON.parse(values); } catch { values = values.split(/\r?\n/); }
  }
  if (!Array.isArray(values)) values = [values];
  const seen = new Set();
  for (const item of values) {
    for (const line of String(item || '').split(/\r?\n/)) {
      const name = line.trim().replace(/\s+/g, ' ');
      const key = name.toLowerCase();
      if (!name || seen.has(key)) continue;
      seen.add(key);
      const existing = await get('SELECT id FROM catalog_options WHERE type = ? AND lower(name) = lower(?)', [type, name]);
      if (!existing) await run('INSERT INTO catalog_options (id, type, name) VALUES (?, ?, ?)', [`${type}-${crypto.randomBytes(12).toString('hex')}`, type, name]);
    }
  }
};

router.get('/reports.xlsx', async (req, res, next) => {
  try {
    const end = new Date(); const start = new Date(end); start.setDate(start.getDate() - 30);
    const from = dashboardDate(req.query.from, start); const to = dashboardDate(req.query.to, end); const visibleEndDate = new Date(to); visibleEndDate.setDate(visibleEndDate.getDate() - 1); const visibleTo = visibleEndDate.toISOString(); const lowStockThreshold = Math.max(0, Number(req.query.lowStockThreshold || 3));
    const report = String(req.query.report || 'complete'); const data = await getReportData({ from, to, lowStockThreshold }); const workbook = makeWorkbook(data, { from, to: visibleTo, lowStockThreshold });
    const included = { orders: ['Resumen', 'Pedidos'], products: ['Resumen', 'Productos vendidos'], profit: ['Resumen', 'Rentabilidad pedidos', 'Rentabilidad productos'], inventory: ['Resumen', 'Inventario', 'Movimientos inventario'], customers: ['Resumen', 'Clientes', 'Resumen clientes'], purchases: ['Resumen', 'Compras', 'Proveedores'], shipping: ['Resumen', 'Envíos'], discounts: ['Resumen', 'Descuentos'], referrals: ['Resumen', 'Referidos'] }[report];
    if (included) workbook.worksheets.filter((sheet) => !included.includes(sheet.name)).forEach((sheet) => workbook.removeWorksheet(sheet.id));
    const suffix = report === 'complete' ? 'Reporte_Completo' : ({ orders: 'Ventas', products: 'Productos', profit: 'Rentabilidad', inventory: 'Inventario', customers: 'Clientes', purchases: 'Compras', shipping: 'Envios', discounts: 'Descuentos', referrals: 'Referidos' }[report] || 'Reporte');
    const filename = `NARI_${suffix}_${from.slice(0, 10)}_a_${visibleTo.slice(0, 10)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.setHeader('Content-Disposition', `attachment; filename="${filename}"`); await workbook.xlsx.write(res); res.end();
  } catch (error) { next(error); }
});

router.get('/dashboard', async (req, res, next) => {
  try {
    const end = new Date(); const start = new Date(end); start.setDate(start.getDate() - 30);
    const from = dashboardDate(req.query.from, start); const to = dashboardDate(req.query.to, end);
    const previousFrom = dashboardDate(req.query.previousFrom, new Date(new Date(from).getTime() - (new Date(to).getTime() - new Date(from).getTime())));
    const previousTo = dashboardDate(req.query.previousTo, new Date(from));
    const lowStockThreshold = Math.max(0, Number.isFinite(Number(req.query.lowStockThreshold)) ? Number(req.query.lowStockThreshold) : 3);
    const period = [from, to]; const previousPeriod = [previousFrom, previousTo];
    const periodWhere = `o.status IN ${saleStatusSql} AND datetime(o.createdAt) >= datetime(?) AND datetime(o.createdAt) < datetime(?)`;
    const orderParams = [...validSaleStatuses, ...period]; const previousParams = [...validSaleStatuses, ...previousPeriod];
    const [current, previous, chart, inventory, top, recent, customers, financial, previousCosts] = await Promise.all([
      get(`SELECT COUNT(*) AS orders, COALESCE(SUM(o.total), 0) AS sales FROM orders o WHERE ${periodWhere}`, orderParams),
      get(`SELECT COUNT(*) AS orders, COALESCE(SUM(o.total), 0) AS sales FROM orders o WHERE ${periodWhere}`, previousParams),
      all(`SELECT date(o.createdAt) AS label, COALESCE(SUM(o.total), 0) AS sales, COUNT(*) AS orders FROM orders o WHERE ${periodWhere} GROUP BY date(o.createdAt) ORDER BY label`, orderParams),
      all(`SELECT id, name, brand, stock, minimumStock, status FROM products WHERE stock = 0 OR (stock > 0 AND stock <= COALESCE(minimumStock, ?)) ORDER BY stock ASC, name ASC`, [lowStockThreshold]),
      all(`SELECT oi.productId, oi.productName, SUM(oi.quantity) AS units, SUM(oi.quantity * oi.unitPrice) AS sales, SUM(oi.quantity * (oi.unitPrice - COALESCE(oi.unitCost, p.cost, 0))) AS profit FROM order_items oi JOIN orders o ON o.id = oi.orderId LEFT JOIN products p ON p.id = oi.productId WHERE ${periodWhere} GROUP BY oi.productId, oi.productName ORDER BY units DESC LIMIT 5`, orderParams),
      all(`SELECT o.id, o.createdAt AS date, o.status, o.total, COALESCE(o.customerFirstNameSnapshot, c.firstName) AS firstName, COALESCE(o.customerLastNameSnapshot, c.lastName) AS lastName, COALESCE(o.customerEmailSnapshot, c.email) AS email FROM orders o LEFT JOIN customers c ON c.id = o.customerId OR c.authUserId = o.userId ORDER BY o.createdAt DESC LIMIT 5`),
      get(`SELECT
        (SELECT COUNT(*) FROM customers) AS total,
        (SELECT COUNT(*) FROM customers WHERE NULLIF(trim(CAST(authUserId AS TEXT)), '') IS NULL) AS "guestCustomers",
        (SELECT COUNT(*) FROM abandoned_carts WHERE convertedAt IS NULL OR trim(CAST(convertedAt AS TEXT)) = '') AS "abandonedCarts",
        (SELECT COUNT(*) FROM (SELECT o.customerId FROM orders o WHERE o.customerId IS NOT NULL AND ${periodWhere} AND NOT EXISTS (SELECT 1 FROM orders older WHERE older.customerId = o.customerId AND older.status IN ${saleStatusSql} AND datetime(older.createdAt) < datetime(o.createdAt)) GROUP BY o.customerId) AS customer_new) AS "newCustomers",
        (SELECT COUNT(*) FROM (SELECT o.customerId FROM orders o WHERE o.customerId IS NOT NULL AND ${periodWhere} GROUP BY o.customerId HAVING COUNT(*) > 1) AS customer_recurrent) AS "recurrentCustomers",
        (SELECT COUNT(*) FROM (SELECT o.customerId FROM orders o WHERE o.customerId IS NOT NULL AND ${periodWhere} GROUP BY o.customerId) AS customer_with_orders) AS "customersWithOrders"
      `, [...orderParams, ...validSaleStatuses, ...orderParams, ...orderParams]),
      get(`SELECT
        (SELECT COALESCE(SUM(o.subtotal), 0) FROM orders o WHERE ${periodWhere}) AS grossSales,
        (SELECT COALESCE(SUM(o.discountTotal), 0) FROM orders o WHERE ${periodWhere}) AS discounts,
        (SELECT COALESCE(SUM(o.paymentFee), 0) FROM orders o WHERE ${periodWhere}) AS paymentFees,
        (SELECT COALESCE(SUM(o.shippingCost), 0) FROM orders o WHERE ${periodWhere}) AS shippingCosts,
        (SELECT COALESCE(SUM(o.refundedTotal), 0) FROM orders o WHERE ${periodWhere}) AS refunds,
        (SELECT COALESCE(SUM(oi.quantity * COALESCE(oi.unitCost, p.cost, 0)), 0) FROM orders o JOIN order_items oi ON oi.orderId = o.id LEFT JOIN products p ON p.id = oi.productId WHERE ${periodWhere}) AS productCost`, [...orderParams, ...orderParams, ...orderParams, ...orderParams, ...orderParams, ...orderParams]),
      get(`SELECT COALESCE(SUM(oi.quantity * COALESCE(oi.unitCost, p.cost, 0)), 0) AS productCost FROM orders o JOIN order_items oi ON oi.orderId = o.id LEFT JOIN products p ON p.id = oi.productId WHERE ${periodWhere}`, previousParams),
    ]);
    const attention = { outOfStock: inventory.filter((product) => product.stock === 0).length, lowStock: inventory.filter((product) => product.stock > 0).length, pendingPreparation: await get(`SELECT COUNT(*) AS count FROM orders o WHERE o.status = 'Pendiente' AND datetime(o.createdAt) >= datetime(?) AND datetime(o.createdAt) < datetime(?)`, period).then((row) => row.count), oldPendingPreparation: await get(`SELECT COUNT(*) AS count FROM orders o WHERE o.status = 'Pendiente' AND datetime(o.createdAt) < datetime('now', '-1 day')`, []).then((row) => row.count), paymentIssues: 0 };
    const totalWithOrders = { count: Number(customers.customersWithOrders || 0) };
    const margin = Number(current.sales || 0) - Number(financial.productCost || 0) - Number(financial.paymentFees || 0) - Number(financial.shippingCosts || 0) - Number(financial.refunds || 0);
    const previousMargin = Number(previous.sales || 0) - Number(previousCosts.productCost || 0);
    res.json({ period: { from, to, previousFrom, previousTo }, current: { sales: Number(current.sales || 0), orders: Number(current.orders || 0), averageOrder: current.orders ? Number(current.sales) / Number(current.orders) : 0, grossProfit: margin }, previous: { sales: Number(previous.sales || 0), orders: Number(previous.orders || 0), averageOrder: previous.orders ? Number(previous.sales) / Number(previous.orders) : 0, grossProfit: previousMargin }, chart, attention, recentOrders: recent.map((order) => ({ ...order, customerName: order.firstName && order.lastName ? `${order.firstName} ${order.lastName}` : 'Cliente no disponible' })), inventory: { totalUnits: (await get('SELECT COALESCE(SUM(stock), 0) AS total FROM products')).total, activeProducts: (await get("SELECT COUNT(*) AS total FROM products WHERE status = 'active'")).total, products: inventory }, topProducts: top, financial: { ...financial, margin, costsAvailable: Number(financial.productCost || 0) > 0 || Number(current.orders || 0) === 0 }, customers: { ...customers, customersWithOrders: Number(totalWithOrders.count || 0), repurchaseRate: totalWithOrders.count ? Number(customers.recurrentCustomers || 0) / Number(totalWithOrders.count) : 0 } });
  } catch (error) { next(error); }
});

router.get('/inventory/movements', async (req, res) => {
  const movements = await all(`
    SELECT inventory_movements.*, products.name AS productName
    FROM inventory_movements
    LEFT JOIN products ON products.id = inventory_movements.productId
    ORDER BY inventory_movements.createdAt DESC
  `);
  res.json(movements);
});

router.get('/customers', async (req, res) => {
  const customers = await all('SELECT customers.id, customers.authuserid AS "authUserId", customers.email, customers.firstname AS "firstName", customers.lastname AS "lastName", customers.phone, customers.firstpurchaseat AS "firstPurchaseAt", customers.lastpurchaseat AS "lastPurchaseAt", customers.ordercount AS "orderCount", customers.totalpurchased AS "totalPurchased", customers.latestaddress AS "latestAddress", customers.city, customers.department, customers.country, customers.status, customers.notes, customers.createdat AS "createdAt", customers.updatedat AS "updatedAt", auth_users.id AS "authUserRecordId", auth_users.isactive AS "authIsActive", auth_users.emailverifiedat AS "emailVerifiedAt" FROM customers LEFT JOIN auth_users ON auth_users.id = customers.authuserid ORDER BY customers.createdat DESC');
  res.json(customers.map((customer) => ({ ...customer, ...customerAccountState(customer), orders: [] })));
});

router.get('/abandoned-carts', async (req, res, next) => {
  try {
    const carts = await all(`SELECT a.id, a.email, a.items, a.lastactivityat AS "lastActivityAt", a.createdat AS "createdAt", a.updatedat AS "updatedAt", a.convertedat AS "convertedAt", c.firstname AS "firstName", c.lastname AS "lastName", c.phone FROM abandoned_carts a LEFT JOIN customers c ON lower(trim(c.email)) = lower(trim(a.email)) ORDER BY a.updatedat DESC LIMIT 100`);
    res.json(carts.map((cart) => { let items = []; try { items = JSON.parse(cart.items); } catch { /* registro corrupto: se muestra sin items */ } return { ...cart, status: cart.convertedAt ? 'converted' : 'active', items: Array.isArray(items) ? items : [] }; }));
  } catch (error) { next(error); }
});

router.get('/abandoned-carts/:id', async (req, res, next) => {
  try {
    const cart = await get(`SELECT a.id, a.email, a.items, a.lastactivityat AS "lastActivityAt", a.createdat AS "createdAt", a.updatedat AS "updatedAt", a.convertedat AS "convertedAt", c.firstname AS "firstName", c.lastname AS "lastName", c.phone FROM abandoned_carts a LEFT JOIN customers c ON lower(trim(c.email)) = lower(trim(a.email)) WHERE a.id = ?`, [req.params.id]);
    if (!cart) return res.status(404).json({ error: 'Carrito no encontrado.' });
    let items = []; try { items = JSON.parse(cart.items); } catch { /* registro corrupto: se muestra sin items */ }
    res.json({ ...cart, status: cart.convertedAt ? 'converted' : 'active', items: Array.isArray(items) ? items : [] });
  } catch (error) { next(error); }
});

router.get('/customers/:id', async (req, res) => {
  const customer = await get('SELECT customers.id, customers.authuserid AS "authUserId", customers.email, customers.firstname AS "firstName", customers.lastname AS "lastName", customers.phone, customers.firstpurchaseat AS "firstPurchaseAt", customers.lastpurchaseat AS "lastPurchaseAt", customers.ordercount AS "orderCount", customers.totalpurchased AS "totalPurchased", customers.latestaddress AS "latestAddress", customers.city, customers.department, customers.country, customers.status, customers.notes, customers.createdat AS "createdAt", customers.updatedat AS "updatedAt", auth_users.id AS "authUserRecordId", auth_users.isactive AS "authIsActive", auth_users.emailverifiedat AS "emailVerifiedAt" FROM customers LEFT JOIN auth_users ON auth_users.id = customers.authuserid WHERE customers.id = ?', [req.params.id]);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });
  const orders = await all(`SELECT id, createdat AS date, total, status, customeremailsnapshot AS "customerEmailSnapshot", customerfirstnamesnapshot AS "customerFirstNameSnapshot", customerlastnamesnapshot AS "customerLastNameSnapshot", customerphonesnapshot AS "customerPhoneSnapshot"
    FROM orders WHERE customerid = ? ORDER BY createdat DESC`, [customer.id]);
  const purchaseDates = orders.map((order) => order.date).filter(Boolean);
  res.json({ ...customer, ...customerAccountState(customer), firstPurchaseAt: purchaseDates[purchaseDates.length - 1] || null, lastPurchaseAt: purchaseDates[0] || null, orders });
});

router.get('/orders', async (req, res) => {
  const orders = await all(`SELECT orders.id, orders.createdat AS date, orders.status, orders.total, orders.subtotal, orders.shippingtotal AS "shippingTotal", orders.discounttotal AS "discountTotal", orders.shippingprovider AS "shippingProvider", orders.trackingnumber AS "trackingNumber", orders.customeremailsnapshot AS "customerEmailSnapshot", orders.customerfirstnamesnapshot AS "customerFirstNameSnapshot", orders.customerlastnamesnapshot AS "customerLastNameSnapshot", orders.customerphonesnapshot AS "customerPhoneSnapshot", customers.id AS "customerId", COALESCE(orders.customerfirstnamesnapshot, customers.firstname) AS "firstName", COALESCE(orders.customerlastnamesnapshot, customers.lastname) AS "lastName", COALESCE(orders.customeremailsnapshot, customers.email) AS email, COALESCE(orders.customerphonesnapshot, customers.phone) AS phone
    FROM orders LEFT JOIN customers ON customers.id = orders.customerid OR customers.authuserid = orders.userid ORDER BY orders.createdat DESC`);
  const result = await Promise.all(orders.map(async (order) => ({ ...order, customerName: order.firstName && order.lastName ? `${order.firstName} ${order.lastName}` : 'Cliente no disponible', products: await all('SELECT productid AS "productId", productname AS "productName", quantity, unitprice AS "unitPrice" FROM order_items WHERE orderid = ? ORDER BY id', [order.id]) })));
  res.json(result);
});

router.get('/orders/:id', async (req, res) => {
  const order = await get(`SELECT orders.id, orders.createdat AS date, orders.status, orders.subtotal, orders.shippingtotal AS "shippingTotal", orders.discounttotal AS "discountTotal", orders.total, orders.shippingaddress AS "shippingAddress", orders.shippingprovider AS "shippingProvider", orders.trackingnumber AS "trackingNumber", orders.customeremailsnapshot AS "customerEmailSnapshot", orders.customerfirstnamesnapshot AS "customerFirstNameSnapshot", orders.customerlastnamesnapshot AS "customerLastNameSnapshot", orders.customerphonesnapshot AS "customerPhoneSnapshot", customers.id AS "customerId", COALESCE(orders.customerfirstnamesnapshot, customers.firstname) AS "firstName", COALESCE(orders.customerlastnamesnapshot, customers.lastname) AS "lastName", COALESCE(orders.customeremailsnapshot, customers.email) AS email, COALESCE(orders.customerphonesnapshot, customers.phone) AS phone
    FROM orders LEFT JOIN customers ON customers.id = orders.customerid OR customers.authuserid = orders.userid WHERE orders.id = ?`, [req.params.id]);
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado.' });
  const products = await all('SELECT productid AS "productId", productname AS "productName", quantity, unitprice AS "unitPrice" FROM order_items WHERE orderid = ? ORDER BY id', [order.id]);
  let shippingAddress = {};
  try { shippingAddress = typeof order.shippingAddress === 'string' ? JSON.parse(order.shippingAddress) : order.shippingAddress || {}; } catch { /* mantiene dirección vacía si un registro antiguo está incompleto */ }
  delete order.shippingAddress;
  res.json({ ...order, customerName: order.firstName && order.lastName ? `${order.firstName} ${order.lastName}` : 'Cliente no disponible', shippingAddress, products });
});

router.patch('/orders/:id/shipping', async (req, res) => {
  const shippingProvider = String(req.body?.shippingProvider || '').trim();
  const trackingNumber = String(req.body?.trackingNumber || '').trim();
  if (!shippingProvider || !trackingNumber) return res.status(400).json({ error: 'Proveedor y número de guía son obligatorios.' });
  if (shippingProvider.length > 120 || trackingNumber.length > 160) return res.status(400).json({ error: 'Los datos de envío superan el límite permitido.' });
  const order = await get('SELECT id, status FROM orders WHERE id = ?', [req.params.id]);
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado.' });
  if (!['Preparando', 'Enviado'].includes(order.status)) return res.status(409).json({ error: order.status === 'Pendiente' ? 'Cambia primero el pedido a Preparando.' : 'El seguimiento es de solo lectura para este estado.' });
  const transitioningToShipped = order.status === 'Preparando';
  const result = transitioningToShipped
    ? await run("UPDATE orders SET shippingProvider = ?, trackingNumber = ?, status = 'Enviado' WHERE id = ? AND status = 'Preparando'", [shippingProvider, trackingNumber, req.params.id])
    : await run("UPDATE orders SET shippingProvider = ?, trackingNumber = ? WHERE id = ? AND status = 'Enviado'", [shippingProvider, trackingNumber, req.params.id]);
  if (!result.changes) return res.status(409).json({ error: 'El pedido cambió de estado. Recarga e inténtalo nuevamente.' });
  if (transitioningToShipped) {
    try {
      const persistedOrder = await get('SELECT id, userid AS "userId", customeremailsnapshot AS "customerEmailSnapshot", customerfirstnamesnapshot AS "customerFirstNameSnapshot", shippingprovider AS "shippingProvider", trackingnumber AS "trackingNumber" FROM orders WHERE id = ?', [req.params.id]);
      const items = await all('SELECT productname AS "productName", quantity FROM order_items WHERE orderid = ? ORDER BY id', [req.params.id]);
      await sendOrderShippedEmail({ order: persistedOrder, items, accountUrl: persistedOrder?.userId ? `${String(process.env.APP_URL || '').replace(/\/$/, '')}/account/orders/${encodeURIComponent(req.params.id)}` : null });
    } catch (emailError) {
      console.error('Order shipped email could not be sent:', emailError.message);
    }
  }
  res.json({ id: req.params.id, status: 'Enviado', shippingProvider, trackingNumber });
});

router.post('/orders/:id/review-link', async (req, res) => {
  const order = await get(`SELECT orders.id, orders.status, orders.userId, customers.firstName, customers.email
    FROM orders LEFT JOIN customers ON customers.authUserId = orders.userId WHERE orders.id = ?`, [req.params.id]);
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado.' });
  if (order.status !== 'Entregado') return res.status(400).json({ error: 'El enlace solo puede enviarse cuando el pedido esté entregado.' });
  if (!order.email) return res.status(400).json({ error: 'El pedido no tiene un correo de cliente.' });
  const products = await all('SELECT productName FROM order_items WHERE orderId = ? ORDER BY id', [order.id]);
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await run('DELETE FROM review_links WHERE orderId = ?', [order.id]);
  await run('INSERT INTO review_links (id, orderId, userId, tokenHash, expiresAt) VALUES (?, ?, ?, ?, ?)', [`review-link-${crypto.randomBytes(12).toString('hex')}`, order.id, order.userId, tokenHash, expiresAt]);
  const appUrl = String(process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
  try {
    await sendReviewLinkEmail({ to: order.email, firstName: order.firstName, reviewUrl: `${appUrl}/review?token=${encodeURIComponent(rawToken)}`, productNames: products.map((product) => product.productName) });
  } catch (error) {
    await run('DELETE FROM review_links WHERE tokenHash = ?', [tokenHash]);
    console.error('Review link email could not be sent:', error.message);
    return res.status(503).json({ error: 'No pudimos enviar el enlace de valoración.' });
  }
  res.json({ message: 'Enlace de valoración enviado correctamente.', expiresAt });
});

router.patch('/orders/:id/status', async (req, res) => {
  const status = String(req.body?.status || '');
  const allowed = ['Pendiente', 'Preparando', 'Enviado', 'Entregado', 'Cancelado'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Estado logístico inválido.' });
  const order = await get('SELECT id, status AS "currentStatus" FROM orders WHERE id = ?', [req.params.id]);
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado.' });
  const transitions = { Pendiente: ['Preparando', 'Cancelado'], Preparando: ['Pendiente', 'Cancelado'], Enviado: ['Entregado', 'Cancelado'], Entregado: [], Cancelado: [] };
  if (status === 'Enviado' || !transitions[order.currentStatus]?.includes(status)) return res.status(409).json({ error: 'Esta transición de estado no está permitida.' });
  const result = await run('UPDATE orders SET status = ? WHERE id = ? AND status = ?', [status, req.params.id, order.currentStatus]);
  if (!result.changes) return res.status(409).json({ error: 'El pedido cambió de estado. Recarga e inténtalo nuevamente.' });
  const updatedOrder = await get('SELECT id, createdAt AS date, status, total FROM orders WHERE id = ?', [req.params.id]);
  res.json(updatedOrder);
});

router.patch('/customers/:id/notes', async (req, res) => {
  if (typeof req.body?.notes !== 'string') return res.status(400).json({ error: 'Notes must be text.' });
  const result = await run('UPDATE customers SET notes = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?', [req.body.notes.slice(0, 5000), req.params.id]);
  if (!result.changes) return res.status(404).json({ error: 'Customer not found' });
  const customer = await get('SELECT id, authUserId, email, firstName, lastName, phone, firstPurchaseAt, lastPurchaseAt, orderCount, totalPurchased, latestAddress, city, department, country, status, notes, createdAt, updatedAt FROM customers WHERE id = ?', [req.params.id]);
  res.json({ ...customer, orders: [] });
});

router.patch('/customers/:id/phone', async (req, res) => {
  const phone = String(req.body?.phone || '').trim();
  if (!/^[0-9+()\s-]{7,24}$/.test(phone)) return res.status(400).json({ error: 'Ingresa un número de celular válido.' });
  const customer = await get('SELECT * FROM customers WHERE id = ?', [req.params.id]);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });
  await run('BEGIN TRANSACTION');
  try {
    await run('UPDATE customers SET phone = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?', [phone, req.params.id]);
    if (customer.authUserId) await run('UPDATE auth_users SET phone = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?', [phone, customer.authUserId]);
    await run('COMMIT');
  } catch (error) { await run('ROLLBACK').catch(() => undefined); throw error; }
  const updated = await get('SELECT id, authUserId, email, firstName, lastName, phone, firstPurchaseAt, lastPurchaseAt, orderCount, totalPurchased, latestAddress, city, department, country, status, notes, createdAt, updatedAt FROM customers WHERE id = ?', [req.params.id]);
  res.json({ ...updated, orders: [] });
});

router.patch('/customers/:id/status', async (req, res, next) => {
  const status = String(req.body?.status || '').trim().toLowerCase();
  if (status !== 'inactive') return res.status(400).json({ error: 'Solo se permite desactivar la cuenta.' });
  try {
    const customer = await get('SELECT id, authuserid AS "authUserId", status FROM customers WHERE id = ?', [req.params.id]);
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    await run('BEGIN TRANSACTION');
    try {
      await run('UPDATE customers SET status = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?', ['inactive', customer.id]);
      if (customer.authUserId) {
        await run('UPDATE auth_users SET isActive = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?', [0, customer.authUserId]);
        await run('DELETE FROM auth_sessions WHERE userId = ?', [customer.authUserId]);
      }
      await run('COMMIT');
    } catch (error) { await run('ROLLBACK').catch(() => undefined); throw error; }
    const updated = await get('SELECT id, authuserid AS "authUserId", email, firstname AS "firstName", lastname AS "lastName", phone, firstpurchaseat AS "firstPurchaseAt", lastpurchaseat AS "lastPurchaseAt", ordercount AS "orderCount", totalpurchased AS "totalPurchased", latestaddress AS "latestAddress", city, department, country, status, notes, createdat AS "createdAt", updatedat AS "updatedAt" FROM customers WHERE id = ?', [customer.id]);
    res.json({ ...updated, orders: [] });
  } catch (error) { next(error); }
});

router.delete('/customers/:id', async (req, res) => {
  return res.status(410).json({ error: 'La eliminación permanente de clientes está deshabilitada. Usa la desactivación de cuenta.' });
});

router.patch('/products/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, brand, price, cost, stock, minimumStock, category, status, description, sku, compareAtPrice, skinTypes, concerns, ingredients, audience, skinBenefits, featuredIngredients, fullIngredients, productInfo, shippingReturns, benefits, howToUse, precautions, images, supplier } = req.body;

    const product = await get('SELECT * FROM products WHERE id = ?', [id]);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    if (stock !== undefined && (!Number.isInteger(stock) || stock < 0)) {
      return res.status(400).json({ error: 'Stock must be a non-negative integer' });
    }
    if (minimumStock !== undefined && (!Number.isInteger(minimumStock) || minimumStock < 0)) return res.status(400).json({ error: 'El stock mínimo debe ser un entero no negativo.' });

    const updates = [];
    const values = [];

    if (name !== undefined) { updates.push('name = ?'); values.push(name); }
    if (brand !== undefined) { updates.push('brand = ?'); values.push(brand); }
    if (price !== undefined) { updates.push('price = ?'); values.push(price); }
    if (cost !== undefined) { updates.push('cost = ?'); values.push(cost); }
    if (stock !== undefined) { updates.push('stock = ?'); values.push(Math.max(0, stock)); }
    if (minimumStock !== undefined) { updates.push('minimumStock = ?'); values.push(minimumStock); }
    if (category !== undefined) { updates.push('category = ?'); values.push(category); }
    if (status !== undefined) { updates.push('status = ?'); values.push(status); }
    if (description !== undefined) { updates.push('description = ?'); values.push(description); }
    for (const [column, value] of Object.entries({ sku, compareAtPrice, skinTypes, concerns, ingredients, audience, skinBenefits, featuredIngredients, fullIngredients, productInfo, shippingReturns, benefits, howToUse, precautions, images, supplier })) {
      if (value !== undefined) { updates.push(`${column} = ?`); values.push(listColumns.has(column) ? serializeList(value) : value); }
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push('updatedAt = CURRENT_TIMESTAMP');
    values.push(id);

    const sql = `UPDATE products SET ${updates.join(', ')} WHERE id = ?`;
    const stockChanged = stock !== undefined && stock !== product.stock;
    await run('BEGIN TRANSACTION');
    try {
      await rememberCatalogOption('brand', brand);
      await rememberCatalogOption('category', category);
      await rememberCatalogOption('skinType', skinTypes);
      await rememberCatalogOption('concern', concerns);
      await rememberCatalogOption('ingredient', ingredients);
      await run(sql, values);
      if (stockChanged) {
        await run(
          'INSERT INTO inventory_movements (id, productId, quantity, type, description, stockBefore, stockAfter, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [`m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, id, stock - product.stock, 'adjustment', 'Ajuste desde edición de producto', product.stock, stock, 'Ajuste manual']
        );
      }
      await run('COMMIT');
    } catch (transactionError) {
      await run('ROLLBACK').catch(() => undefined);
      throw transactionError;
    }

    const updated = await get('SELECT * FROM products WHERE id = ?', [id]);
    res.json(updated);
  } catch (error) {
    console.error('Failed to update product:', error);
    res.status(500).json({ error: 'No se pudo actualizar el producto.' });
  }
});

router.patch('/products/:id/stock', async (req, res) => {
  const { id } = req.params;
  const { stock } = req.body;

  if (stock === undefined || typeof stock !== 'number') {
    return res.status(400).json({ error: 'Invalid stock value' });
  }

  const product = await get('SELECT * FROM products WHERE id = ?', [id]);
  if (!product) {
    return res.status(404).json({ error: 'Product not found' });
  }

  if (!Number.isInteger(stock) || stock < 0) {
    return res.status(400).json({ error: 'Stock must be a non-negative integer' });
  }

  const newStock = stock;
  const quantity = newStock - product.stock;
  try {
    await run('BEGIN TRANSACTION');
    await run('UPDATE products SET stock = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?', [newStock, id]);
    if (quantity !== 0) {
      await run(
        'INSERT INTO inventory_movements (id, productId, quantity, type, description, stockBefore, stockAfter, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [`m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, id, quantity, 'adjustment', 'Ajuste manual', product.stock, newStock, 'Ajuste manual']
      );
    }
    await run('COMMIT');
    const updated = await get('SELECT * FROM products WHERE id = ?', [id]);
    res.json(updated);
  } catch (error) {
    await run('ROLLBACK').catch(() => undefined);
    console.error('Failed to update stock:', error);
    res.status(500).json({ error: 'No se pudo actualizar el inventario.' });
  }
});

router.post('/products', async (req, res) => {
  const { id, brand, name, price, cost, stock, minimumStock = 3, category, status = 'active', description, sku, compareAtPrice, skinTypes, concerns, ingredients, audience, skinBenefits, featuredIngredients, fullIngredients, productInfo, shippingReturns, benefits, howToUse, precautions, images, supplier } = req.body;

  if (!id || !brand || !name || price === undefined || !category) {
    return res.status(400).json({ error: 'Missing required fields: id, brand, name, price, category' });
  }

  const slug = `${brand}-${name}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

  const existing = await get('SELECT id FROM products WHERE id = ?', [id]);
  if (existing) {
    return res.status(409).json({ error: 'Product with this ID already exists' });
  }

  await run(
    `INSERT INTO products (id, brand, name, slug, price, cost, stock, minimumStock, category, status, description, sku, compareAtPrice, skinTypes, concerns, ingredients, audience, skinBenefits, featuredIngredients, fullIngredients, productInfo, shippingReturns, benefits, howToUse, precautions, images, supplier, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [id, brand, name, slug, price, cost || 0, stock || 0, Number.isInteger(minimumStock) && minimumStock >= 0 ? minimumStock : 3, category, status, description || '', sku || '', compareAtPrice ?? null, serializeList(skinTypes), serializeList(concerns), serializeList(ingredients), audience || '', skinBenefits || '', serializeList(featuredIngredients), fullIngredients || '', productInfo || '', shippingReturns || '', serializeList(benefits), serializeList(howToUse), precautions || '', serializeList(images), supplier || null]
  );

  await rememberCatalogOption('brand', brand);
  await rememberCatalogOption('category', category);
  await rememberCatalogOption('skinType', skinTypes);
  await rememberCatalogOption('concern', concerns);
  await rememberCatalogOption('ingredient', ingredients);

  if (Number.isInteger(stock) && stock > 0) {
    await run(
      'INSERT INTO inventory_movements (id, productId, quantity, type, description, stockBefore, stockAfter, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [`m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, id, stock, 'initial', 'Inventario inicial', 0, stock, 'Entrada inicial']
    );
  }

  const created = await get('SELECT * FROM products WHERE id = ?', [id]);
  res.status(201).json(created);
});

router.delete('/products/:id', async (req, res) => {
  const { id } = req.params;
  const product = await get('SELECT * FROM products WHERE id = ?', [id]);

  if (!product) {
    return res.status(404).json({ error: 'Product not found' });
  }

  try {
    await run('BEGIN TRANSACTION');
    if (product.stock > 0) {
      await run(
        'INSERT INTO inventory_movements (id, productId, quantity, type, description, stockBefore, stockAfter, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [`m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, id, -product.stock, 'adjustment', `Salida por eliminación: ${product.name}`, product.stock, 0, 'Producto eliminado']
      );
    }
    await run('DELETE FROM products WHERE id = ?', [id]);
    await run('COMMIT');
    res.json({ message: 'Product deleted' });
  } catch (error) {
    await run('ROLLBACK').catch(() => undefined);
    console.error('Failed to delete product:', error);
    res.status(500).json({ error: 'No se pudo eliminar el producto.' });
  }
});

module.exports = router;
