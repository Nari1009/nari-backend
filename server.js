require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { initDb, seedProducts } = require('./src/db/seed');

const app = express();
const port = process.env.PORT || 3001;

const corsOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000,http://localhost:3002').split(',');
app.use(cors({
  origin: corsOrigins,
  credentials: true,
}));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const productsRouter = require('./src/routes/products');
const adminRouter = require('./src/routes/admin');

app.use('/api/products', productsRouter);
app.use('/api/admin', adminRouter);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const startServer = async () => {
  try {
    await seedProducts();
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
