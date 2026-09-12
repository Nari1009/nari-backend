const CATALOG_DISCOVERY_SELECT = `
  SELECT id, brand, name, slug, price, images,
         routinestep AS "routineStep",
         sizelabel AS "sizeLabel",
         suitableskintypes AS "suitableSkinTypes",
         suitableconditions AS "suitableConditions",
         targets,
         status, stock
  FROM products
  WHERE catalogrole = 'CATALOG'
    AND status = 'active'
    AND stock > 0`;

const createCatalogDiscoveryRepository = ({ query } = {}) => ({
  async findPublicCatalogProducts({ routineStep = null, brand = null, limit = 12 } = {}) {
    const execute = query || ((sql, params) => require('../../db/init').all(sql, params));
    const params = [];
    let sql = CATALOG_DISCOVERY_SELECT;
    if (routineStep) {
      sql += ' AND routinestep = ?';
      params.push(routineStep);
    }
    if (brand) {
      sql += ' AND LOWER(brand) LIKE LOWER(?)';
      params.push(`%${brand}%`);
    }
    sql += ' ORDER BY name ASC LIMIT ?';
    params.push(limit);
    return execute(sql, params);
  },
});

module.exports = { CATALOG_DISCOVERY_SELECT, createCatalogDiscoveryRepository };
