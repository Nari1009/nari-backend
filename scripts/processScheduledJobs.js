#!/usr/bin/env node
require('dotenv').config();

const { pool } = require('../src/db/init');
const { processEmailOutbox } = require('./processEmailOutbox');
const { runReviewRequestWorker } = require('./processReviewRequests');

const summarize = (results) => results.reduce((counts, item) => {
  counts[item.result] = (counts[item.result] || 0) + 1;
  return counts;
}, {});

const runScheduledJobs = async ({
  emailWorker = processEmailOutbox,
  reviewWorker = runReviewRequestWorker,
  closePool = () => pool.end(),
  limit = 20,
} = {}) => {
  const outcome = {
    email: { ok: false, results: [] },
    reviews: { ok: false, results: [] },
  };

  try {
    outcome.email.results = await emailWorker({ limit });
    outcome.email.ok = true;
  } catch (error) {
    outcome.email.error = error;
    console.error('Scheduled email outbox failed:', error.message);
  }

  try {
    outcome.reviews.results = await reviewWorker({ limit });
    outcome.reviews.ok = true;
  } catch (error) {
    outcome.reviews.error = error;
    console.error('Scheduled review worker failed:', error.message);
  }

  await closePool();
  return outcome;
};

if (require.main === module) {
  runScheduledJobs()
    .then((outcome) => {
      console.log('Scheduled workers finished.', {
        email: outcome.email.ok ? summarize(outcome.email.results) : 'failed',
        reviews: outcome.reviews.ok ? summarize(outcome.reviews.results) : 'failed',
      });
      if (!outcome.email.ok || !outcome.reviews.ok) process.exitCode = 1;
    })
    .catch((error) => {
      console.error('Scheduled workers failed:', error.message);
      process.exitCode = 1;
    });
}

module.exports = { runScheduledJobs };
