const { all, run } = require('../db/init');
const { sendAbandonedCartEmail } = require('./email');
const { getAppUrl } = require('./appUrl');

const processAbandonedCarts = async () => {
  const carts = await all(`SELECT * FROM abandoned_carts WHERE (convertedAt IS NULL OR trim(CAST(convertedAt AS TEXT)) = '') AND ((reminder1SentAt IS NULL AND datetime(lastActivityAt) <= datetime('now', '-1 day')) OR (reminder1SentAt IS NOT NULL AND reminder2SentAt IS NULL AND datetime(lastActivityAt) <= datetime('now', '-3 days'))) ORDER BY lastActivityAt ASC LIMIT 100`);
  for (const cart of carts) {
    let items;
    try { items = JSON.parse(cart.items); } catch { continue; }
    if (!Array.isArray(items) || !items.length) continue;
    const reminderNumber = cart.reminder1SentAt ? 2 : 1;
    try {
      const cartUrl = `${getAppUrl()}/carrito?cart=${encodeURIComponent(cart.id)}`;
      await sendAbandonedCartEmail({ to: cart.email, cartUrl, items, reminderNumber });
      await run(`UPDATE abandoned_carts SET reminder${reminderNumber}SentAt = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`, [new Date().toISOString(), cart.id]);
    } catch (error) { console.error(`Abandoned cart email failed for ${cart.id}:`, error.message); }
  }
};

module.exports = { processAbandonedCarts };
