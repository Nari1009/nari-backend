const express = require('express');
const { processWompiEvent } = require('../services/wompiWebhook');
const { dispatchEmailOutboxAfterCommit } = require('../services/emailDispatcher');

const router = express.Router();

router.post('/wompi/webhook', async (req, res, next) => {
  try {
    const result = await processWompiEvent({
      body: req.body,
      checksumHeader: req.get('x-event-checksum'),
    });
    dispatchEmailOutboxAfterCommit(result.emailIdempotencyKey);
    return res.status(200).json({ received: true, duplicate: result.duplicate === true });
  } catch (error) {
    if (error?.status) return res.status(error.status).json({ error: error.code || 'WOMPI_EVENT_REJECTED' });
    return next(error);
  }
});

module.exports = router;
