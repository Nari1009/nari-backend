const getAppUrl = () => {
  const value = String(process.env.APP_URL || '').trim().replace(/\/$/, '');
  if (!value) throw new Error('APP_URL is not configured.');
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error('APP_URL is invalid.'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('APP_URL is invalid.');
  return value;
};

module.exports = { getAppUrl };
