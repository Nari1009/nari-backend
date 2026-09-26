const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '../scripts/validateAtomicCheckoutDev.js'), 'utf8');

test('validator transaction adapter preserves nested transaction passthrough', () => {
  assert.match(source, /const createTransactionAdapter = \(client\) =>/);
  assert.match(source, /withTransaction: async \(callback\) => callback\(tx\)/);
  assert.match(source, /const result = await callback\(createTransactionAdapter\(client\)\)/);
  assert.match(source, /await client\.query\('COMMIT'\)/);
  assert.match(source, /await client\.query\('ROLLBACK'\)/);
});

test('Scenario D retains genuine two-client concurrency and strict persisted invariants', () => {
  const start = source.indexOf("setScenario('D concurrent same-key replay')");
  const end = source.indexOf("setScenario('E final-unit competition')");
  const scenario = source.slice(start, end);
  assert.match(scenario, /const c1 = await connectClient\(\);/);
  assert.match(scenario, /const c2 = await connectClient\(\);/);
  assert.match(scenario, /Promise\.all\(\[r1, r2\]\)/);
  assert.match(scenario, /persistedOrders\.length !== 1/);
  assert.match(scenario, /persistedReservations\.length !== 1/);
  assert.match(scenario, /persistedPayments\.length !== 1/);
  assert.match(scenario, /diagnostics\.reservationMovements !== 1/);
  assert.match(scenario, /diagnostics\.saleMovements !== 0/);
  assert.match(scenario, /diagnostics\.outboxCount !== 1/);
  assert.match(scenario, /concurrentA\.paymentId === concurrentB\.paymentId/);
  assert.doesNotMatch(scenario, /R12 D DIAG/);
});

test('Scenario F uses a dedicated operation client and one fresh post-rollback observation', () => {
  const start = source.indexOf("const scenarioPaymentFailure");
  const end = source.indexOf("const scenarioReservationFailure");
  const scenario = source.slice(start, end);
  assert.match(scenario, /const operationClient = await connectClient\(\);/);
  assert.match(scenario, /const operationRepository = createRepository\(operationClient\)/);
  assert.match(scenario, /repository: operationRepository/);
  assert.match(scenario, /await expectError\(createOrder\(/);
  assert.match(scenario, /await closeClient\(operationClient\);/);
  assert.match(scenario, /const observation = await connectClient\(\);/);
  assert.match(scenario, /const residue = await readCheckoutResidue\(observation, orderId\);/);
  assert.match(scenario, /residueFields\.length === 0/);
  assert.match(scenario, /observationState\.stock === observationState\.stockBefore/);
  assert.match(scenario, /observationState\.soldCount === observationState\.soldCountBefore/);
  assert.doesNotMatch(scenario, /assertNoCheckoutResidue\(/);
  assert.doesNotMatch(source, /createStandardTransactionBoundaryDiagnosticRepository|createScenarioDRepository|R12 F TX|R12 F OBS|R12 D DIAG/);
});

console.log('atomicCheckoutValidator tests: PASS');
