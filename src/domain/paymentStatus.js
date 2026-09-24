const PAYMENT_STATUSES = Object.freeze({
  CREATED: 'CREATED',
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  DECLINED: 'DECLINED',
  VOIDED: 'VOIDED',
  ERROR: 'ERROR',
  REFUNDED: 'REFUNDED',
});

const PAYMENT_STATUS_VALUES = Object.freeze(Object.values(PAYMENT_STATUSES));

const PAYMENT_TRANSITIONS = Object.freeze({
  CREATED: Object.freeze(['PENDING', 'DECLINED', 'ERROR']),
  PENDING: Object.freeze(['APPROVED', 'DECLINED', 'VOIDED', 'ERROR']),
  APPROVED: Object.freeze(['REFUNDED']),
  DECLINED: Object.freeze([]),
  VOIDED: Object.freeze([]),
  ERROR: Object.freeze([]),
  REFUNDED: Object.freeze([]),
});

const canTransitionPayment = (from, to) => from === to || PAYMENT_TRANSITIONS[from]?.includes(to) === true;

module.exports = {
  PAYMENT_STATUSES,
  PAYMENT_STATUS_VALUES,
  PAYMENT_TRANSITIONS,
  canTransitionPayment,
};
