const RESERVATION_STATUSES = Object.freeze({
  ACTIVE: 'ACTIVE',
  COMMITTED: 'COMMITTED',
  RELEASED: 'RELEASED',
  EXPIRED: 'EXPIRED',
});

const RESERVATION_STATUS_VALUES = Object.freeze(Object.values(RESERVATION_STATUSES));

const RESERVATION_TRANSITIONS = Object.freeze({
  ACTIVE: Object.freeze(['COMMITTED', 'RELEASED', 'EXPIRED']),
  COMMITTED: Object.freeze([]),
  RELEASED: Object.freeze([]),
  EXPIRED: Object.freeze([]),
});

const canTransitionReservation = (from, to) => (
  from === to || RESERVATION_TRANSITIONS[from]?.includes(to) === true
);

module.exports = {
  RESERVATION_STATUSES,
  RESERVATION_STATUS_VALUES,
  RESERVATION_TRANSITIONS,
  canTransitionReservation,
};
