const crypto = require('crypto');
const { all, get, run } = require('../db/init');
const { normalizeEmail } = require('./auth');
const { sendOrderReceivedEmail } = require('./email');

const randomId = () => crypto.randomBytes(12).toString('hex');
const normalizePhone = (value) => String(value || '').replace(/\D/g, '');

async function createOrder({ payload, userId = null }) {
  const customer = payload?.customer || {};
  const email = normalizeEmail(customer.email);
  const phone = String(customer.phone || '').trim();
  const phoneNormalized = normalizePhone(phone);
  const items = Array.isArray(payload?.items)
    ? payload.items.filter((item) => item && Number.isInteger(item.quantity) && item.quantity > 0)
    : [];
  if (!email || phoneNormalized.length < 7 || !items.length || !payload.shippingAddress) {
    const error = new Error('El pedido no tiene productos, correo o dirección.');
    error.status = 400;
    throw error;
  }
  const products = await Promise.all(items.map((item) => get('SELECT id, name, price, cost, stock, status FROM products WHERE id = ?', [item.productId])));
  if (products.some((product, index) => !product || product.status !== 'active' || product.stock < items[index].quantity)) {
    const error = new Error('Uno de los productos ya no está disponible.');
    error.status = 409;
    throw error;
  }
  const subtotal = products.reduce((sum, product, index) => sum + Number(product.price) * items[index].quantity, 0);
  const shipping = Math.max(0, Number(payload.shippingTotal || 0));
  const discount = Math.max(0, Number(payload.discount || 0));
  const total = Math.max(0, subtotal + shipping - discount);
  const id = String(payload.reference || `NARI-${Date.now()}`).replace(/[^A-Za-z0-9-]/g, '').slice(0, 50);
  if (await get('SELECT id FROM orders WHERE id = ?', [id])) {
    const error = new Error('Este pedido ya fue registrado.');
    error.status = 409;
    throw error;
  }
  const now = new Date().toISOString();
  const address = payload.shippingAddress;
  const authenticatedCustomer = userId
    ? await get('SELECT id, authuserid AS "authUserId", email FROM customers WHERE authuserid = ?', [userId])
    : null;
  const emailCustomer = await get('SELECT id, authuserid AS "authUserId", email FROM customers WHERE lower(trim(email)) = ?', [email]);
  if (authenticatedCustomer && emailCustomer && authenticatedCustomer.id !== emailCustomer.id) {
    const error = new Error('La cuenta autenticada y el correo del checkout pertenecen a clientes distintos.');
    error.status = 409;
    throw error;
  }
  if (userId && emailCustomer?.authUserId && emailCustomer.authUserId !== userId) {
    const error = new Error('El correo del checkout ya está vinculado a otra cuenta.');
    error.status = 409;
    throw error;
  }
  // La identidad comercial se resuelve únicamente por correo normalizado.
  // El teléfono se conserva como contacto, pero nunca selecciona un Customer.
  const customerRow = authenticatedCustomer || emailCustomer;
  const customerId = customerRow?.id || `customer-${randomId()}`;

  await run('BEGIN TRANSACTION');
  try {
    if (customerRow) {
      await run(`UPDATE customers SET authUserId = COALESCE(authUserId, ?), firstName = COALESCE(NULLIF(?, ''), firstName), lastName = COALESCE(NULLIF(?, ''), lastName), phone = COALESCE(NULLIF(?, ''), phone), phoneNormalized = COALESCE(NULLIF(?, ''), phoneNormalized), latestAddress = COALESCE(NULLIF(?, ''), latestAddress), city = COALESCE(NULLIF(?, ''), city), department = COALESCE(NULLIF(?, ''), department), country = COALESCE(NULLIF(?, ''), country), updatedAt = CURRENT_TIMESTAMP WHERE id = ?`, [
        userId, String(customer.firstName || '').trim(), String(customer.lastName || '').trim(), phone, phoneNormalized,
        address.addressLine1 || '', address.city || '', address.department || '', address.country || 'Colombia', customerId,
      ]);
    } else {
      await run(`INSERT INTO customers (id, authUserId, email, firstName, lastName, phone, phoneNormalized, latestAddress, city, department, country) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
        customerId, userId, email, String(customer.firstName || '').trim(), String(customer.lastName || '').trim(), phone, phoneNormalized,
        address.addressLine1 || '', address.city || '', address.department || '', address.country || 'Colombia',
      ]);
    }
    const snapshotCustomer = await get('SELECT email, firstname AS "firstName", lastname AS "lastName", phone FROM customers WHERE id = ?', [customerId]);
    const emailSnapshot = normalizeEmail(snapshotCustomer?.email || email) || null;
    const firstNameSnapshot = String(snapshotCustomer?.firstName || '').trim() || null;
    const lastNameSnapshot = String(snapshotCustomer?.lastName || '').trim() || null;
    const phoneSnapshot = String(snapshotCustomer?.phone || '').trim() || null;
    await run('INSERT INTO orders (id, userId, customerId, status, total, subtotal, shippingTotal, discountTotal, shippingAddress, customerEmailSnapshot, customerFirstNameSnapshot, customerLastNameSnapshot, customerPhoneSnapshot, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
      id, userId, customerId, payload.paymentStatus === 'paid' ? 'Pagado' : 'Pendiente', total, subtotal, shipping, discount, JSON.stringify(address), emailSnapshot, firstNameSnapshot, lastNameSnapshot, phoneSnapshot, now,
    ]);
    for (const [index, product] of products.entries()) {
      const quantity = items[index].quantity;
      const stockAfter = product.stock - quantity;
      await run('INSERT INTO order_items (id, orderId, productId, productName, quantity, unitPrice, unitCost) VALUES (?, ?, ?, ?, ?, ?, ?)', [
        `item-${randomId()}`, id, product.id, product.name, quantity, product.price, product.cost ?? 0,
      ]);
      await run('UPDATE products SET stock = stock - ?, soldCount = soldCount + ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?', [quantity, quantity, product.id]);
      await run('INSERT INTO inventory_movements (id, productId, quantity, type, description, stockBefore, stockAfter, reason, orderId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [
        `m-${Date.now()}-${randomId()}`, product.id, -quantity, 'sale', 'Salida por venta', product.stock, stockAfter, 'Pedido creado', id,
      ]);
    }
    await run('UPDATE customers SET firstPurchaseAt = COALESCE(firstPurchaseAt, ?), lastPurchaseAt = ?, orderCount = orderCount + 1, totalPurchased = totalPurchased + ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?', [now, now, total, customerId]);
    await run("UPDATE abandoned_carts SET convertedAt = ?, updatedAt = CURRENT_TIMESTAMP WHERE email = ? AND (convertedAt IS NULL OR trim(CAST(convertedAt AS TEXT)) = '')", [now, email]);
    await run('COMMIT');
  } catch (error) {
    await run('ROLLBACK').catch(() => undefined);
    throw error;
  }
  try {
    const persistedOrder = await get('SELECT id, customeremailsnapshot AS "customerEmailSnapshot", customerfirstnamesnapshot AS "customerFirstNameSnapshot", customerlastnamesnapshot AS "customerLastNameSnapshot", shippingaddress AS "shippingAddress", subtotal, discounttotal AS "discountTotal", shippingtotal AS "shippingTotal", total, userid AS "userId" FROM orders WHERE id = ?', [id]);
    const persistedItems = await all('SELECT productname AS "productName", quantity, unitprice AS "unitPrice" FROM order_items WHERE orderid = ? ORDER BY id', [id]);
    if (!persistedOrder) throw new Error('Created order could not be reloaded for notification.');
    await sendOrderReceivedEmail({
      order: persistedOrder,
      items: persistedItems,
      accountUrl: persistedOrder.userId ? `${String(process.env.APP_URL || '').replace(/\/$/, '')}/account/orders` : null,
    });
  } catch (emailError) {
    console.error('Order received email could not be sent:', emailError.message);
  }
  return { id, date: now, status: payload.paymentStatus === 'paid' ? 'Pagado' : 'Pendiente', total, products: products.map((product) => product.name) };
}

module.exports = { createOrder };
