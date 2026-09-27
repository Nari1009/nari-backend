const test = require('node:test');
const assert = require('node:assert/strict');
const { SAFE_PAYMENT_SELECT } = require('../src/services/adminPayment');

test('Admin payment projection contains only the approved safe allowlist', () => {
  assert.match(SAFE_PAYMENT_SELECT, /providertransactionid/);
  assert.match(SAFE_PAYMENT_SELECT, /paymentmethodtype/);
  assert.match(SAFE_PAYMENT_SELECT, /approvedat/);
  assert.match(SAFE_PAYMENT_SELECT, /failedat/);
  assert.doesNotMatch(SAFE_PAYMENT_SELECT, /token|signature|payload|failurecode|failuremessage|secret|private/i);
});
