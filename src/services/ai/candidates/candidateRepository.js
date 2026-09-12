const CANDIDATE_PRODUCT_SELECT = `
  SELECT id, name, price, status, stock,
         catalogRole AS "catalogRole",
         routineStep AS "routineStep",
         sizeLabel AS "sizeLabel",
         suitableSkinTypes AS "suitableSkinTypes",
         suitableConditions AS "suitableConditions",
         targets AS "targets"
  FROM products
  WHERE catalogRole = 'CATALOG'
    AND status = 'active'
    AND stock > 0`;

const createCandidateRepository = ({ query } = {}) => ({
  async findEligibleProducts({ excludeProductIds = [] } = {}) {
    const execute = query || ((sql, params) => require('../../../db/init').all(sql, params));
    const ids = [...new Set(excludeProductIds.map((id) => String(id)))];
    if (!ids.length) return execute(CANDIDATE_PRODUCT_SELECT);
    return execute(`${CANDIDATE_PRODUCT_SELECT}\n    AND id NOT IN (${ids.map(() => '?').join(',')})`, ids);
  },
});

module.exports = { CANDIDATE_PRODUCT_SELECT, createCandidateRepository };
