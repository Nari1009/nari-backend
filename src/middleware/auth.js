const adminAuth = (req, res, next) => {
  if (process.env.NODE_ENV !== 'development') {
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
