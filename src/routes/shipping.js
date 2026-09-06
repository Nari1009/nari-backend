const express = require('express');
const { getShippingQuote, ShippingPolicyError } = require('../services/shippingPolicy');

const router = express.Router();

router.post('/quote', async (req, res, next) => {
  try {
    const quote = await getShippingQuote({ department: req.body?.department, city: req.body?.city });
    res.json(quote);
  } catch (error) {
    if (error instanceof ShippingPolicyError) return res.status(error.status).json({ code: error.code, error: error.message });
    next(error);
  }
});

module.exports = router;
