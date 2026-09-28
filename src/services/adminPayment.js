const SAFE_PAYMENT_SELECT = `
  id,
  status,
  provider,
  providerstatus AS "providerStatus",
  paymentmethodtype AS "paymentMethodType",
  providertransactionid AS "providerTransactionId",
  providerreference AS "providerReference",
  amount,
  currency,
  (SELECT r.status FROM stock_reservations r WHERE r.orderid = payments.orderid LIMIT 1) AS "reservationStatus",
  createdat AS "createdAt",
  updatedat AS "updatedAt",
  approvedat AS "approvedAt",
  failedat AS "failedAt"
`;

const latestPaymentForOrder = (repository, orderId) => repository.get(`SELECT ${SAFE_PAYMENT_SELECT} FROM payments WHERE orderid = ? ORDER BY createdat DESC, id DESC LIMIT 1`, [orderId]);
const paymentAttemptsForOrder = (repository, orderId) => repository.all(`SELECT ${SAFE_PAYMENT_SELECT} FROM payments WHERE orderid = ? ORDER BY createdat ASC, id ASC`, [orderId]);

module.exports = { SAFE_PAYMENT_SELECT, latestPaymentForOrder, paymentAttemptsForOrder };
