const createRateLimiter = ({ windowMs, maxRequests, now = () => Date.now() }) => {
  const entries = new Map();
  return (key) => {
    const current = now();
    const previous = entries.get(key);
    if (!previous || current - previous.startedAt >= windowMs) {
      entries.set(key, { startedAt: current, count: 1 });
      return true;
    }
    previous.count += 1;
    return previous.count <= maxRequests;
  };
};

module.exports = { createRateLimiter };
