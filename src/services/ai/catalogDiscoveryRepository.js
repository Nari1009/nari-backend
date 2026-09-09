const CATALOG_DISCOVERY_SELECT = `
  SELECT id, name, slug, price, images,
         "routineStep" AS "routineStep",
         "sizeLabel" AS "sizeLabel",
         status, stock
  FROM products
  WHERE "catalogRole" = 'CATALOG'
    AND status = 'active'`;

const createCatalogDiscoveryRepository = ({ query } = {}) => ({
  async findPublicCatalogProducts({ routineStep = null, limit = 12 } = {}) {
    const execute = query || ((sql, params) => require('../../db/init').all(sql, params));
    const params = [];
    let sql = CATALOG_DISCOVERY_SELECT;
    if (routineStep) {
      sql += ' AND "routineStep" = ?';
      params.push(routineStep);
    }
    sql += ' ORDER BY name ASC LIMIT ?';
    params.push(limit);
    return execute(sql, params);
  },
});

module.exports = { CATALOG_DISCOVERY_SELECT, createCatalogDiscoveryRepository };
