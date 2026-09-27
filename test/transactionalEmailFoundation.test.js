const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('post-commit dispatch is outside checkout and webhook transactions', () => {
  const dispatcher = read('src/services/emailDispatcher.js');
  const checkout = read('src/routes/auth.js');
  const webhook = read('src/routes/wompiWebhook.js');
  assert.match(dispatcher, /processEmailOutbox\(\{ limit: 1, idempotencyKey \}\)/);
  assert.match(dispatcher, /catch\(\(error\) => console\.error/);
  assert.match(checkout, /await createOrder[\s\S]*?dispatchEmailOutboxAfterCommit\(`order_received\/\$\{result\.id\}`\)/);
  assert.match(webhook, /await processWompiEvent[\s\S]*?dispatchEmailOutboxAfterCommit\(result\.emailIdempotencyKey\)/);
});

test('outbox targeting preserves the normal worker contract and idempotency constraints', () => {
  const worker = read('scripts/processEmailOutbox.js');
  assert.match(worker, /idempotencykey = \?/i);
  assert.match(worker, /FOR UPDATE SKIP LOCKED/);
  assert.match(worker, /processingat < CURRENT_TIMESTAMP - INTERVAL/);
  assert.match(worker, /processEmailOutbox = async \(\{ limit = LIMIT, idempotencyKey = null \}/);
});

test('Resend request has a bounded timeout shorter than the processing lease', () => {
  const email = read('src/services/email.js');
  const worker = read('scripts/processEmailOutbox.js');
  assert.match(email, /setTimeout\(\(\) => controller\.abort\(\), 15000\)/);
  assert.match(email, /signal: controller\.signal/);
  assert.match(worker, /LEASE_MINUTES = 10/);
});
