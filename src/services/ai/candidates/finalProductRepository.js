const FINAL_PRODUCT_SELECT = `
  SELECT id, name, slug, price, images,
         catalogRole AS "catalogRole",
         status, stock
  FROM products
  WHERE id IN (__IDS__)
    AND catalogRole = 'CATALOG'
    AND status = 'active'
    AND stock > 0`;

const createFinalProductRepository = ({ query } = {}) => ({
  async findCurrentEligibleProducts(ids) {
    const execute = query || ((sql, params) => require('../../../db/init').all(sql, params));
    const placeholders = ids.map(() => '?').join(',');
    const sql = FINAL_PRODUCT_SELECT.replace('__IDS__', placeholders);
    return execute(sql, ids);
  },
});

module.exports = { FINAL_PRODUCT_SELECT, createFinalProductRepository };
