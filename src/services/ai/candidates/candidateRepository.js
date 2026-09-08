const CANDIDATE_PRODUCT_SELECT = `
  SELECT id, name, status, stock,
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
  async findEligibleProducts() {
    const execute = query || ((sql, params) => require('../../../db/init').all(sql, params));
    return execute(CANDIDATE_PRODUCT_SELECT);
  },
});

module.exports = { CANDIDATE_PRODUCT_SELECT, createCandidateRepository };
