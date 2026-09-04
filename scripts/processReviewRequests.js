#!/usr/bin/env node
require('dotenv').config();
const { processReviewRequests } = require('../src/services/reviewRequests');

processReviewRequests({ limit: 20 })
  .then((results) => {
    const summary = results.reduce((counts, item) => { counts[item.result] = (counts[item.result] || 0) + 1; return counts; }, {});
    console.log(`Review request worker finished: ${results.length} processed.`, summary);
    process.exitCode = 0;
  })
  .catch((error) => {
    console.error('Review request worker failed:', error.message);
    process.exitCode = 1;
  });
