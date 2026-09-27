const COMMERCIAL_ORDER_STATUSES = Object.freeze(['Pagado', 'Preparando', 'Enviado', 'Entregado']);
const COMMERCIAL_STATUS_PLACEHOLDERS = COMMERCIAL_ORDER_STATUSES.map(() => '?').join(',');

const commercialOrderClause = (alias = 'o') => `(
  ${alias}.isTest = FALSE
  AND (
    EXISTS (SELECT 1 FROM payments approved_payment WHERE approved_payment.orderid = ${alias}.id AND approved_payment.status = 'APPROVED')
    OR (
      NOT EXISTS (SELECT 1 FROM payments any_payment WHERE any_payment.orderid = ${alias}.id)
      AND ${alias}.status IN (${COMMERCIAL_STATUS_PLACEHOLDERS})
    )
  )
)`;

const commercialOrderParams = () => [...COMMERCIAL_ORDER_STATUSES];

const isCommercialOrder = (order) => {
  if (!order || order.isTest === true) return false;
  const hasPaymentData = order.hasPayments !== undefined || order.hasApprovedPayment !== undefined;
  if (!hasPaymentData) return COMMERCIAL_ORDER_STATUSES.includes(order.status);
  return Boolean(order.hasApprovedPayment) || (!Boolean(order.hasPayments) && COMMERCIAL_ORDER_STATUSES.includes(order.status));
};

module.exports = { COMMERCIAL_ORDER_STATUSES, commercialOrderClause, commercialOrderParams, isCommercialOrder };
