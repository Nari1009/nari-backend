const { processEmailOutbox } = require('../../scripts/processEmailOutbox');

const dispatchEmailOutboxAfterCommit = (idempotencyKey) => {
  if (!idempotencyKey) return;
  Promise.resolve()
    .then(() => processEmailOutbox({ limit: 1, idempotencyKey }))
    .catch((error) => console.error('Post-commit email dispatch failed:', error.message));
};

module.exports = { dispatchEmailOutboxAfterCommit };
