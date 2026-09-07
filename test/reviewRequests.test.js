const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://test:test@localhost:5432/test';
const { BACKOFF_MINUTES, MAX_ATTEMPTS, retryAt, retryState } = require('../src/services/reviewRequests');

const fixedNow = Date.parse('2026-09-07T12:00:00.000Z');

test('review retry backoff uses 5, 15, 60 and 360 minutes', () => {
  for (const [attempt, minutes] of BACKOFF_MINUTES.entries()) {
    const retry = retryAt(attempt + 1, fixedNow);
    assert.equal(Date.parse(retry) - fixedNow, minutes * 60 * 1000);
  }
  assert.equal(Date.parse(retryAt(8, fixedNow)) - fixedNow, 360 * 60 * 1000);
});

test('review retry state is pending until attempt eight, then blocked', () => {
  for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt += 1) {
    const state = retryState(attempt, fixedNow);
    assert.equal(state.status, 'pending');
    assert.ok(state.nextAttemptAt);
  }
  assert.deepEqual(retryState(MAX_ATTEMPTS, fixedNow), { status: 'blocked', nextAttemptAt: null });
});

test('review worker persists retry scheduling and excludes blocked or early retries', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/services/reviewRequests.js'), 'utf8');
  assert.match(source, /nextattemptat AS "nextAttemptAt"/);
  assert.match(source, /nextattemptat IS NULL OR nextattemptat <= CURRENT_TIMESTAMP/);
  assert.match(source, /expiresat > CURRENT_TIMESTAMP/);
  assert.match(source, /status: next\.status, processingat: null, nextattemptat: next\.nextAttemptAt/);
  assert.match(source, /status: 'sent'.*nextattemptat: null/);
  assert.match(source, /request\.attemptCount >= MAX_ATTEMPTS \? 'blocked' : 'retry'/);
});

test('review retry migration is additive and rerunnable', () => {
  const migration = fs.readFileSync(path.join(__dirname, '../migrations/20260911_review_request_retry.sql'), 'utf8');
  assert.match(migration, /ADD COLUMN IF NOT EXISTS nextattemptat TIMESTAMPTZ NULL/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS/);
  assert.doesNotMatch(migration, /UPDATE\s+public\.order_review_requests/i);
  assert.doesNotMatch(migration, /DROP\s+/i);
});

console.log('reviewRequests tests: PASS');
