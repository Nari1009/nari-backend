const express = require('express');
const { getShippingQuote, ShippingPolicyError } = require('../services/shippingPolicy');

const router = express.Router();

router.post('/quote', async (req, res, next) => {
  try {
    const quote = await getShippingQuote({
      country: req.body?.country,
      department: req.body?.department,
      city: req.body?.city,
      items: req.body?.items,
    });
    res.json(quote);
  } catch (error) {
    if (error instanceof ShippingPolicyError) return res.status(error.status).json({ code: error.code, error: error.message });
    next(error);
  }
});

module.exports = router;
