require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { initDb, seedProducts } = require('./src/db/seed');
const { ensureContent } = require('./src/db/content');

const app = express();
const port = process.env.PORT || 3001;

const corsOrigins = Array.from(new Set([
  ...(process.env.CORS_ORIGIN || '').split(',').map((origin) => origin.trim()).filter(Boolean),
  'http://localhost:3000',
  'http://localhost:3002',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]));
app.use(cors({
  origin: corsOrigins,
  credentials: true,
}));

app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

const productsRouter = require('./src/routes/products');
const adminRouter = require('./src/routes/admin');
const adminAuthRouter = require('./src/routes/adminAuth');
const authRouter = require('./src/routes/auth');
const settingsRouter = require('./src/routes/settings');
const paymentWebhookRouter = require('./src/routes/paymentWebhook');
const reviewsRouter = require('./src/routes/reviews');
const cartRouter = require('./src/routes/cart');
const { processAbandonedCarts } = require('./src/services/abandonedCarts');

app.use('/api/products', productsRouter);
app.use('/api/admin', adminRouter);
app.use('/api/admin-auth', adminAuthRouter);
app.use('/api/auth', authRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/payments', paymentWebhookRouter);
app.use('/api/reviews', reviewsRouter);
app.use('/api/cart', cartRouter);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const startServer = async () => {
  try {
    await seedProducts();
    await ensureContent();
    await processAbandonedCarts();
    setInterval(() => { processAbandonedCarts().catch((error) => console.error('Abandoned cart processor failed:', error.message)); }, 15 * 60 * 1000);
    app.listen(port, () => {
      console.log(`\n🎉 NARI Backend running on http://localhost:${port}`);
      console.log(`📊 API: http://localhost:${port}/api/products`);
      console.log(`🔑 Admin: http://localhost:${port}/api/admin/products (DEV ONLY - no auth needed in development)`);
      console.log(`💚 Health: http://localhost:${port}/health\n`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
