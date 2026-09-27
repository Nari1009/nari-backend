const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { runScheduledJobs } = require('../scripts/processScheduledJobs');

test('scheduled entrypoint runs email, review, then reservation workers', async () => {
  const calls = [];
  const outcome = await runScheduledJobs({
    emailWorker: async ({ limit }) => { calls.push(['email', limit]); return [{ result: 'sent' }]; },
    reviewWorker: async ({ limit }) => { calls.push(['reviews', limit]); return [{ result: 'sent' }]; },
    reservationWorker: async ({ limit }) => { calls.push(['reservations', limit]); return [{ result: 'expired' }]; },
    closePool: async () => calls.push(['close']),
    limit: 7,
  });
  assert.deepEqual(calls, [['email', 7], ['reviews', 7], ['reservations', 7], ['close']]);
  assert.equal(outcome.email.ok, true);
  assert.equal(outcome.reviews.ok, true);
  assert.equal(outcome.reservations.ok, true);
  assert.deepEqual(outcome.reservations.results, [{ result: 'expired' }]);
});

test('scheduled worker failures are isolated so later workers still run', async () => {
  const calls = [];
  const outcome = await runScheduledJobs({
    emailWorker: async () => { calls.push('email'); throw new Error('email_failed'); },
    reviewWorker: async () => { calls.push('reviews'); return []; },
    reservationWorker: async () => { calls.push('reservations'); return []; },
    closePool: async () => calls.push('close'),
  });
  assert.deepEqual(calls, ['email', 'reviews', 'reservations', 'close']);
  assert.equal(outcome.email.ok, false);
  assert.equal(outcome.reviews.ok, true);
  assert.equal(outcome.reservations.ok, true);
});

test('scheduled entrypoint and standalone worker command share the same worker contract', () => {
  const scheduled = fs.readFileSync(path.join(__dirname, '../scripts/processScheduledJobs.js'), 'utf8');
  const worker = fs.readFileSync(path.join(__dirname, '../scripts/processExpiredReservations.js'), 'utf8');
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
  assert.match(scheduled, /processExpiredReservations/);
  assert.match(scheduled, /reservationWorker/);
  assert.match(worker, /module\.exports = \{ candidateQuery, processCandidate, processExpiredReservations \}/);
  assert.equal(packageJson.scripts['jobs:expire-reservations'], 'node scripts/processExpiredReservations.js');
});
