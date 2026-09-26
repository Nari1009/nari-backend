const crypto = require('crypto');
const defaultDb = () => require('../db/init');
const { normalizeEmail } = require('./auth');
const { enqueueOrderEmail } = require('./emailOutbox');
const { getShippingQuote } = require('./shippingPolicy');
const { nextOrderNumber } = require('./orderNumber');
const { createReservation } = require('./inventoryReservation');
const { createPaymentAttempt, orderTotalInCents } = require('./paymentService');

const randomId = () => crypto.randomBytes(12).toString('hex');
const normalizePhone = (value) => String(value || '').replace(/\D/g, '');
const validDocumentTypes = new Set(['CC', 'NIT', 'CE']);
const CHECKOUT_RESERVATION_TTL_MINUTES = 30;
const CHECKOUT_RESERVATION_TTL_MS = CHECKOUT_RESERVATION_TTL_MINUTES * 60 * 1000;
const normalizeDocument = (type, number) => ({ type: String(type || '').trim().toUpperCase(), number: String(number || '').trim() });

const validationError = (message, status = 400) => Object.assign(new Error(message), { status });
const conflictError = (message) => validationError(message, 409);

const normalizeCheckoutIdempotencyKey = (value) => {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw validationError('La clave de idempotencia del checkout no es válida.');
  const key = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(key)) throw validationError('La clave de idempotencia del checkout no es válida.');
  return key;
};

const checkoutResult = async (tx, orderId) => {
  const order = await tx.get(`SELECT id, ordernumber AS "orderNumber", createdat AS date, status, total FROM orders WHERE id = ?`, [orderId]);
  if (!order) throw conflictError('No fue posible recuperar el checkout idempotente.');
  const products = await tx.all('SELECT productname AS "productName" FROM order_items WHERE orderid = ? ORDER BY id', [orderId]);
  const reservation = await tx.get('SELECT id, status FROM stock_reservations WHERE orderid = ?', [orderId]);
  const payment = await tx.get(`SELECT id, status, provider, amount, currency, idempotencykey AS "idempotencyKey" FROM payments WHERE orderid = ? ORDER BY createdat ASC`, [orderId]);
  return {
    id: order.id, orderNumber: order.orderNumber, date: order.date, status: order.status, total: Number(order.total),
    products: products.map((product) => product.productName), reservationId: reservation?.id || null,
    reservationStatus: reservation?.status || null, paymentId: payment?.id || null, paymentStatus: payment?.status || null,
    paymentProvider: payment?.provider || null, paymentAmount: payment?.amount || null, paymentCurrency: payment?.currency || null,
    paymentIdempotencyKey: payment?.idempotencyKey || null,
  };
};

const findExistingCheckout = async (tx, checkoutIdempotencyKey) => {
  if (!checkoutIdempotencyKey) return null;
  return tx.get('SELECT id FROM orders WHERE checkoutidempotencykey = ? FOR UPDATE', [checkoutIdempotencyKey]);
};

const insertOrderStrict = async (tx, values) => {
  const result = await tx.query(`INSERT INTO orders
    (id, ordernumber, checkoutidempotencykey, userId, customerId, status, total, subtotal, shippingTotal, discountTotal,
     shippingAddress, shippingzone, deliverytype, samedayeligible, shippingpolicyversion,
     customerEmailSnapshot, customerFirstNameSnapshot, customerLastNameSnapshot, customerPhoneSnapshot,
     documenttypesnapshot, documentnumbersnapshot, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (checkoutidempotencykey) WHERE checkoutidempotencykey IS NOT NULL DO NOTHING
    RETURNING id, ordernumber AS "orderNumber"`, values);
  return { inserted: result.rowCount === 1, row: result.rows[0] || null };
};

const createOrder = async ({ payload, userId = null, repository = null }) => {
  const customer = payload?.customer || {};
  const email = normalizeEmail(customer.email);
  const phone = String(customer.phone || '').trim();
  const phoneNormalized = normalizePhone(phone);
  const document = normalizeDocument(customer.documentType, customer.documentNumber);
  const checkoutIdempotencyKey = normalizeCheckoutIdempotencyKey(payload?.checkoutIdempotencyKey);
  const items = Array.isArray(payload?.items)
    ? payload.items.filter((item) => item && Number.isInteger(item.quantity) && item.quantity > 0)
    : [];
  const hasDocumentType = Boolean(document.type);
  const hasDocumentNumber = Boolean(document.number);
  if (hasDocumentType !== hasDocumentNumber) throw validationError('El tipo y número de documento deben enviarse juntos.');
  if ((hasDocumentType && !validDocumentTypes.has(document.type)) || (hasDocumentNumber && (document.number.length < 3 || document.number.length > 40))) throw validationError('Los datos del documento no son válidos.');
  if (!email || phoneNormalized.length < 7 || !items.length || !payload.shippingAddress) throw validationError('El pedido no tiene productos, correo o dirección.');

  const id = String(payload.reference || `NARI-${Date.now()}-${randomId()}`).replace(/[^A-Za-z0-9-]/g, '').slice(0, 50);
  const now = new Date().toISOString();
  const address = payload.shippingAddress;
  const db = repository || defaultDb();
  let result;

  await db.withTransaction(async (tx) => {
    // Serialize only the same logical checkout key before locking Products.
    // This makes a concurrent replay resolve as an idempotent read instead of
    // being misclassified as an insufficient-stock attempt.
    if (checkoutIdempotencyKey) await tx.query('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', [checkoutIdempotencyKey]);
    const existingCheckout = await findExistingCheckout(tx, checkoutIdempotencyKey);
    if (existingCheckout) {
      result = await checkoutResult(tx, existingCheckout.id);
      return;
    }

    const productIds = [...new Set(items.map((item) => item.productId))];
    const productRows = await tx.all(`SELECT id, name, price, cost, stock, status FROM products WHERE id IN (${productIds.map(() => '?').join(', ')}) ORDER BY id FOR UPDATE`, productIds);
    const productById = new Map(productRows.map((product) => [product.id, product]));
    if (productRows.length !== productIds.length || productRows.some((product) => product.status !== 'active')) throw conflictError('Uno de los productos ya no está disponible.');
    const products = items.map((item) => productById.get(item.productId));
    const subtotal = products.reduce((sum, product, index) => sum + Number(product.price) * items[index].quantity, 0);
    const shippingQuote = await getShippingQuote({ department: address.department, city: address.city }, tx);
    const shipping = shippingQuote.shippingTotal;
    // R4 has no active discount system. Never trust client-supplied discounts.
    const discount = 0;
    const total = Math.max(0, subtotal + shipping - discount);
    const authenticatedCustomer = userId ? await tx.get('SELECT id, authuserid AS "authUserId", email FROM customers WHERE authuserid = ?', [userId]) : null;
    const emailCustomer = await tx.get('SELECT id, authuserid AS "authUserId", email FROM customers WHERE lower(trim(email)) = ?', [email]);
    if (authenticatedCustomer && emailCustomer && authenticatedCustomer.id !== emailCustomer.id) throw conflictError('La cuenta autenticada y el correo del checkout pertenecen a clientes distintos.');
    if (userId && emailCustomer?.authUserId && emailCustomer.authUserId !== userId) throw conflictError('El correo del checkout ya está vinculado a otra cuenta.');

    if (checkoutIdempotencyKey) await tx.query('SAVEPOINT checkout_idempotency');
    let customerRow = authenticatedCustomer || emailCustomer;
    let customerId = customerRow?.id || `customer-${randomId()}`;
    if (customerRow) {
      await tx.run(`UPDATE customers SET authUserId = COALESCE(authUserId, ?), firstName = COALESCE(NULLIF(?, ''), firstName), lastName = COALESCE(NULLIF(?, ''), lastName), phone = COALESCE(NULLIF(?, ''), phone), phoneNormalized = COALESCE(NULLIF(?, ''), phoneNormalized), documenttype = ?, documentnumber = ?, latestAddress = COALESCE(NULLIF(?, ''), latestAddress), city = COALESCE(NULLIF(?, ''), city), department = COALESCE(NULLIF(?, ''), department), country = COALESCE(NULLIF(?, ''), country), updatedAt = CURRENT_TIMESTAMP WHERE id = ?`, [userId, String(customer.firstName || '').trim(), String(customer.lastName || '').trim(), phone, phoneNormalized, document.type || null, document.number || null, address.addressLine1 || '', address.city || '', address.department || '', address.country || 'Colombia', customerId]);
    } else {
      const customerInsert = await tx.query(`INSERT INTO customers
        (id, authUserId, email, firstName, lastName, phone, phoneNormalized, documenttype, documentnumber, latestAddress, city, department, country)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (email) DO NOTHING RETURNING id`, [customerId, userId, email, String(customer.firstName || '').trim(), String(customer.lastName || '').trim(), phone, phoneNormalized, document.type || null, document.number || null, address.addressLine1 || '', address.city || '', address.department || '', address.country || 'Colombia']);
      if (!customerInsert.rowCount) {
        customerRow = await tx.get('SELECT id FROM customers WHERE lower(trim(email)) = ?', [email]);
        if (!customerRow) throw new Error('No fue posible resolver el cliente del checkout.');
        customerId = customerRow.id;
      }
    }
    const snapshotCustomer = await tx.get('SELECT email, firstname AS "firstName", lastname AS "lastName", phone, documenttype AS "documentType", documentnumber AS "documentNumber" FROM customers WHERE id = ?', [customerId]);
    const emailSnapshot = normalizeEmail(snapshotCustomer?.email || email) || null;
    const firstNameSnapshot = String(snapshotCustomer?.firstName || '').trim() || null;
    const lastNameSnapshot = String(snapshotCustomer?.lastName || '').trim() || null;
    const phoneSnapshot = String(snapshotCustomer?.phone || '').trim() || null;
    const documentTypeSnapshot = String(snapshotCustomer?.documentType || document.type).trim() || null;
    const documentNumberSnapshot = String(snapshotCustomer?.documentNumber || document.number).trim() || null;
    const orderNumber = await nextOrderNumber(tx);
    const orderInsert = await insertOrderStrict(tx, [id, orderNumber, checkoutIdempotencyKey, userId, customerId, 'Pendiente', total, subtotal, shipping, discount, JSON.stringify(address), shippingQuote.shippingZone, shippingQuote.deliveryType, shippingQuote.sameDayEligible, shippingQuote.policyVersion, emailSnapshot, firstNameSnapshot, lastNameSnapshot, phoneSnapshot, documentTypeSnapshot, documentNumberSnapshot, now]);
    if (!orderInsert.inserted) {
      if (!checkoutIdempotencyKey) throw conflictError('Este pedido ya fue registrado.');
      await tx.query('ROLLBACK TO SAVEPOINT checkout_idempotency');
      const existing = await findExistingCheckout(tx, checkoutIdempotencyKey);
      if (!existing) throw new Error('No fue posible resolver el checkout idempotente concurrente.');
      result = await checkoutResult(tx, existing.id);
      return;
    }

    for (const [index, product] of products.entries()) {
      const quantity = items[index].quantity;
      await tx.run('INSERT INTO order_items (id, orderId, productId, productName, quantity, unitPrice, unitCost) VALUES (?, ?, ?, ?, ?, ?, ?)', [`item-${randomId()}`, id, product.id, product.name, quantity, product.price, product.cost ?? 0]);
    }
    const expiresAt = new Date(Date.now() + CHECKOUT_RESERVATION_TTL_MS).toISOString();
    const reservation = await createReservation({ orderId: id, idempotencyKey: `checkout-reservation/${checkoutIdempotencyKey || id}`, expiresAt }, tx);
    const payment = await createPaymentAttempt({ orderId: id, provider: 'INTERNAL_CHECKOUT', amount: orderTotalInCents(Number(total).toFixed(2)), currency: 'COP', idempotencyKey: `checkout-payment/${checkoutIdempotencyKey || id}`, expiresAt }, tx);
    await enqueueOrderEmail(tx, 'order_received', { id, orderNumber, userId, customerEmailSnapshot: emailSnapshot, customerFirstNameSnapshot: firstNameSnapshot, customerLastNameSnapshot: lastNameSnapshot, shippingAddress: address, subtotal, discountTotal: discount, shippingTotal: shipping, shippingZone: shippingQuote.shippingZone, deliveryType: shippingQuote.deliveryType, sameDayEligible: shippingQuote.sameDayEligible, shippingPolicyVersion: shippingQuote.policyVersion, total }, products.map((product, index) => ({ productName: product.name, quantity: items[index].quantity, unitPrice: product.price })));
    result = { id, orderNumber, date: now, status: 'Pendiente', total, products: products.map((product) => product.name), reservationId: reservation.id, reservationStatus: reservation.status, paymentId: payment.id, paymentStatus: payment.status, paymentProvider: payment.provider, paymentAmount: payment.amount, paymentCurrency: payment.currency, paymentIdempotencyKey: payment.idempotencyKey };
  });
  return result;
};

module.exports = { CHECKOUT_RESERVATION_TTL_MINUTES, normalizeCheckoutIdempotencyKey, createOrder };
