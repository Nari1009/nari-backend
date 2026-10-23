const MAX_BUDGET_COP = 10_000_000;

const parseBudget = (value) => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 && value <= MAX_BUDGET_COP ? { limit: Math.round(value), currency: 'COP', scope: 'PRODUCT', flexibility: 'FLEXIBLE' } : null;
  if (typeof value !== 'string') return null;
  const text = value.trim().toLowerCase();
  if (!text) return null;
  const scope = /\b(rutina|total|varios|varias|productos)\b/.test(text) ? 'ROUTINE' : 'PRODUCT';
  const flexibility = /\b(exacto|exactamente|fijo|fija)\b/.test(text) ? 'EXACT' : 'FLEXIBLE';
  const thousands = text.match(/(\d+(?:[.,]\d{3})+)(?:\s*(?:cop|pesos?))?/i);
  const compact = text.match(/(\d+(?:[.,]\d+)?)[ ]*(k|mil)\b/i);
  let limit = null;
  if (compact) limit = Math.round(Number(compact[1].replace(',', '.')) * 1000);
  else if (thousands) limit = Number(thousands[1].replace(/[.,]/g, ''));
  else {
    const digits = text.replace(/[^0-9]/g, '');
    if (digits) limit = Number(digits);
  }
  if (!Number.isFinite(limit) || limit <= 0 || limit > MAX_BUDGET_COP) return null;
  return { limit: Math.round(limit), currency: 'COP', scope, flexibility };
};

const budgetRank = (price, budget) => {
  if (!budget || !Number.isFinite(Number(price))) return 1;
  return Number(price) <= budget.limit ? 0 : 2;
};

const formatCop = (value) => Number.isFinite(Number(value)) ? `$${Math.round(Number(value)).toLocaleString('es-CO')} COP` : null;

module.exports = { MAX_BUDGET_COP, parseBudget, budgetRank, formatCop };
