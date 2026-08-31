const adminAuth = (req, res, next) => {
  // Development keeps the local admin usable without a production secret.
  // Any production deployment must still provide the configured secret.
  const isDevelopment = process.env.NODE_ENV !== 'production';
  if (!isDevelopment) {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = auth.substring(7);
    if (token !== process.env.ADMIN_SECRET) {
      return res.status(403).json({ error: 'Forbidden' });
    }
  }
  next();
};

module.exports = { adminAuth };
