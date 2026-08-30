const express = require('express');
const { all, get, run } = require('../db/init');
const { adminAuth } = require('../middleware/auth');
const router = express.Router();

router.use(adminAuth);

router.get('/products', async (req, res) => {
  const products = await all('SELECT * FROM products ORDER BY isBestSeller DESC, name ASC');
  res.json(products);
});

router.get('/products/:id', async (req, res) => {
  const product = await get('SELECT * FROM products WHERE id = ?', [req.params.id]);

  if (!product) {
    return res.status(404).json({ error: 'Product not found' });
  }

  res.json(product);
});

router.patch('/products/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, brand, price, cost, stock, category, status, description } = req.body;

    const product = await get('SELECT * FROM products WHERE id = ?', [id]);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const updates = [];
    const values = [];

    if (name !== undefined) { updates.push('name = ?'); values.push(name); }
    if (brand !== undefined) { updates.push('brand = ?'); values.push(brand); }
    if (price !== undefined) { updates.push('price = ?'); values.push(price); }
    if (cost !== undefined) { updates.push('cost = ?'); values.push(cost); }
    if (stock !== undefined) { updates.push('stock = ?'); values.push(Math.max(0, stock)); }
    if (category !== undefined) { updates.push('category = ?'); values.push(category); }
    if (status !== undefined) { updates.push('status = ?'); values.push(status); }
    if (description !== undefined) { updates.push('description = ?'); values.push(description); }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push('updatedAt = CURRENT_TIMESTAMP');
    values.push(id);

    const sql = `UPDATE products SET ${updates.join(', ')} WHERE id = ?`;
    await run(sql, values);

    const updated = await get('SELECT * FROM products WHERE id = ?', [id]);
    res.json(updated);
  } catch (error) {
    console.error('Failed to update product:', error);
    res.status(500).json({ error: 'No se pudo actualizar el producto.' });
  }
});

router.patch('/products/:id/stock', async (req, res) => {
  const { id } = req.params;
  const { stock } = req.body;

  if (stock === undefined || typeof stock !== 'number') {
    return res.status(400).json({ error: 'Invalid stock value' });
  }

  const product = await get('SELECT * FROM products WHERE id = ?', [id]);
  if (!product) {
    return res.status(404).json({ error: 'Product not found' });
  }

  const newStock = Math.max(0, stock);
  await run('UPDATE products SET stock = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?', [newStock, id]);

  const updated = await get('SELECT * FROM products WHERE id = ?', [id]);
  res.json(updated);
});

router.post('/products', async (req, res) => {
  const { id, brand, name, price, cost, stock, category, status = 'active', description } = req.body;

  if (!id || !brand || !name || price === undefined || !category) {
    return res.status(400).json({ error: 'Missing required fields: id, brand, name, price, category' });
  }

  const slug = `${brand}-${name}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

  const existing = await get('SELECT id FROM products WHERE id = ?', [id]);
  if (existing) {
    return res.status(409).json({ error: 'Product with this ID already exists' });
  }

  await run(
    `INSERT INTO products (id, brand, name, slug, price, cost, stock, category, status, description, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [id, brand, name, slug, price, cost || 0, stock || 0, category, status, description || '']
  );

  const created = await get('SELECT * FROM products WHERE id = ?', [id]);
  res.status(201).json(created);
});

router.delete('/products/:id', async (req, res) => {
  const { id } = req.params;
  const product = await get('SELECT * FROM products WHERE id = ?', [id]);

  if (!product) {
    return res.status(404).json({ error: 'Product not found' });
  }

  await run('DELETE FROM products WHERE id = ?', [id]);
  res.json({ message: 'Product deleted' });
});

module.exports = router;
