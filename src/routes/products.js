const express = require('express');
const { all, get } = require('../db/init');
const { getContent } = require('../db/content');
const router = express.Router();

const withRatingDistribution = async (products) => {
  const ids = products.map((product) => product.id);
  if (!ids.length) return products;
  const placeholders = ids.map(() => '?').join(',');
  const reviewScope = `FROM reviews r WHERE r.productId IN (${placeholders}) AND r.rating BETWEEN 1 AND 5 AND EXISTS (
    SELECT 1 FROM order_items oi JOIN orders o ON o.id = oi.orderId
    WHERE oi.orderId = r.orderId AND oi.productId = r.productId AND o.status = 'Entregado'
  )`;
  const rows = await all(`SELECT r.productId, r.rating, COUNT(*) AS count ${reviewScope} GROUP BY r.productId, r.rating`, ids);
  const totals = await all(`SELECT r.productId, ROUND(AVG(r.rating), 1) AS rating, COUNT(*) AS reviewCount ${reviewScope} GROUP BY r.productId`, ids);
  const distributions = Object.fromEntries(ids.map((id) => [String(id), { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }]));
  const summary = Object.fromEntries(ids.map((id) => [String(id), { rating: 0, reviewCount: 0 }]));
  rows.forEach((row) => {
    const productId = String(row.productId);
    const rating = Number(row.rating);
    if (distributions[productId] && rating >= 1 && rating <= 5) distributions[productId][rating] = row.count;
  });
  totals.forEach((row) => {
    const productId = String(row.productId);
    if (summary[productId]) summary[productId] = { rating: row.rating, reviewCount: row.reviewCount };
  });
  return products.map((product) => ({ ...product, ...summary[String(product.id)], ratingDistribution: distributions[String(product.id)] }));
};

router.get('/content/:page', async (req, res) => {
  const content = await getContent(req.params.page);
  if (!content) return res.status(404).json({ error: 'Content not found' });
  res.json(content);
});

router.get('/catalog-options', async (req, res) => {
  const rows = await all('SELECT type, name FROM catalog_options ORDER BY type, name');
  const options = { skinTypes: [], concerns: [], ingredients: [] };
  for (const row of rows) {
    if (row.type === 'skinType') options.skinTypes.push(row.name);
    if (row.type === 'concern') options.concerns.push(row.name);
    if (row.type === 'ingredient') options.ingredients.push(row.name);
  }
  res.json(options);
});

router.get('/:id/reviews', async (req, res, next) => {
  try {
    const product = await get('SELECT id, status FROM products WHERE id = ?', [req.params.id]);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    if (product.status !== 'active') return res.status(410).json({ error: 'Este producto ya no está disponible.' });

    const reviewScope = `
      FROM reviews r
      WHERE r.productId = ?
        AND r.rating BETWEEN 1 AND 5
        AND EXISTS (
          SELECT 1
          FROM order_items oi
          JOIN orders o ON o.id = oi.orderId
          WHERE oi.orderId = r.orderId
            AND oi.productId = r.productId
            AND o.status = 'Entregado'
        )`;
    const [reviews, summary] = await Promise.all([
      all(`SELECT r.rating, r.comment, r.createdAt AS "createdAt" ${reviewScope} ORDER BY r.createdAt DESC LIMIT 50`, [req.params.id]),
      get(`SELECT ROUND(AVG(r.rating), 1) AS "averageRating", COUNT(*) AS "reviewCount" ${reviewScope}`, [req.params.id]),
    ]);
    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    reviews.forEach((review) => { distribution[Number(review.rating)] += 1; });
    res.json({
      averageRating: Number(summary?.averageRating || 0),
      reviewCount: Number(summary?.reviewCount || 0),
      distribution,
      reviews: reviews.map((review) => ({
        rating: Number(review.rating),
        comment: typeof review.comment === 'string' ? review.comment : '',
        createdAt: review.createdAt,
        verifiedPurchase: true,
        author: 'Cliente NARI',
      })),
    });
  } catch (error) { next(error); }
});

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
  res.json(await withRatingDistribution(products));
});

router.get('/:id', async (req, res) => {
  const product = await get(
    'SELECT * FROM products WHERE id = ?',
    [req.params.id]
  );

  if (!product) {
    return res.status(404).json({ error: 'Product not found', code: 'PRODUCT_NOT_FOUND' });
  }

  if (product.status !== 'active') return res.status(410).json({ error: 'Este producto ya no está disponible.', code: 'PRODUCT_INACTIVE', status: product.status });

  res.json((await withRatingDistribution([product]))[0]);
});

module.exports = router;
