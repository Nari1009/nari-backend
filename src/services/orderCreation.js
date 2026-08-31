const crypto = require('crypto');
const { all, get, run } = require('../db/init');
const { normalizeEmail } = require('./auth');

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
  const matchingCustomers = await all('SELECT id, authUserId, email FROM customers WHERE email = ? OR phoneNormalized = ?', [email, phoneNormalized]);
  const emailCustomer = matchingCustomers.find((item) => item.email === email);
  const phoneCustomer = matchingCustomers.find((item) => item.phoneNormalized === phoneNormalized);
  // El correo tiene prioridad: si ya existe, el pedido se vincula a ese cliente
  // y el celular se actualiza con el dato más reciente del checkout.
  // El celular solo identifica al cliente cuando el correo aún no existe.
  let customerRow = emailCustomer || phoneCustomer;
  const customerId = customerRow?.id || `customer-${randomId()}`;

  await run('BEGIN TRANSACTION');
  try {
    if (customerRow) {
      await run(`UPDATE customers SET firstName = ?, lastName = ?, phone = ?, phoneNormalized = ?, latestAddress = ?, city = ?, department = ?, country = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`, [
        String(customer.firstName || '').trim(), String(customer.lastName || '').trim(), phone, phoneNormalized,
        address.addressLine1 || '', address.city || '', address.department || '', address.country || 'Colombia', customerId,
      ]);
    } else {
      await run(`INSERT INTO customers (id, authUserId, email, firstName, lastName, phone, phoneNormalized, latestAddress, city, department, country) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
        customerId, userId, email, String(customer.firstName || '').trim(), String(customer.lastName || '').trim(), phone, phoneNormalized,
        address.addressLine1 || '', address.city || '', address.department || '', address.country || 'Colombia',
      ]);
    }
    await run('INSERT INTO orders (id, userId, customerId, status, total, subtotal, shippingTotal, discountTotal, shippingAddress, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
      id, userId, customerId, payload.paymentStatus === 'paid' ? 'Pagado' : 'Pendiente', total, subtotal, shipping, discount, JSON.stringify(address), now,
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
    await run('UPDATE abandoned_carts SET convertedAt = ?, updatedAt = CURRENT_TIMESTAMP WHERE email = ? AND convertedAt IS NULL', [now, email]);
    await run('COMMIT');
  } catch (error) {
    await run('ROLLBACK').catch(() => undefined);
    throw error;
  }
  return { id, date: now, status: payload.paymentStatus === 'paid' ? 'Pagado' : 'Pendiente', total, products: products.map((product) => product.name) };
}

module.exports = { createOrder };
