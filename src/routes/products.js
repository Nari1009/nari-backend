const express = require('express');
const { all, get } = require('../db/init');
const router = express.Router();

router.get('/', async (req, res) => {
  const { search, category } = req.query;

  let sql = 'SELECT * FROM products WHERE status = ?';
  let params = ['active'];

  if (search) {
    sql += ' AND (name LIKE ? OR brand LIKE ? OR description LIKE ?)';
    const searchTerm = `%${search}%`;
    params.push(searchTerm, searchTerm, searchTerm);
  }

  if (category) {
    sql += ' AND category = ?';
    params.push(category);
  }

  sql += ' ORDER BY isBestSeller DESC, name ASC';

  const products = await all(sql, params);
  res.json(products);
});

router.get('/:id', async (req, res) => {
  const product = await get(
    'SELECT * FROM products WHERE id = ? AND status = ?',
    [req.params.id, 'active']
  );

  if (!product) {
    return res.status(404).json({ error: 'Product not found' });
  }

  res.json(product);
});

module.exports = router;
