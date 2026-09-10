// server/index.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');

require('./db'); // inicializa y siembra la base de datos

const apiRoutes = require('./routes/api');
const adminRoutes = require('./routes/admin');
const checkoutRoutes = require('./routes/checkout');
const wompiRoutes = require('./routes/wompi');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Archivos estáticos (frontend)
app.use('/img/products', express.static(path.join(__dirname, '..', 'data', 'products')));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Rutas API
app.use('/api', apiRoutes);
app.use('/admin', adminRoutes);
app.use('/checkout', checkoutRoutes);
app.use('/wompi', wompiRoutes);

// sitemap.xml dinámico simple (SEO)
app.get('/sitemap.xml', (req, res) => {
  const db = require('./db');
  const products = db.prepare('SELECT id, updated_at FROM products WHERE active = 1').all();
  const base = process.env.APP_URL || `http://localhost:${PORT}`;
  const urls = [
    `<url><loc>${base}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>`,
    `<url><loc>${base}/checkout.html</loc><changefreq>weekly</changefreq></url>`,
    ...products.map(p => `<url><loc>${base}/product.html?id=${p.id}</loc><lastmod>${p.updated_at?.split(' ')[0]}</lastmod></url>`)
  ];
  res.header('Content-Type', 'application/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`);
});

app.get('/robots.txt', (req, res) => {
  const base = process.env.APP_URL || `http://localhost:${PORT}`;
  res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /admin\nSitemap: ${base}/sitemap.xml`);
});

// Página no encontrada -> servir 404 simple (SPA-friendly fallback opcional)
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, '..', 'public', '404.html'));
});

app.listen(PORT, () => {
  console.log(`\n✨ Essenza Studio corriendo en http://localhost:${PORT}`);
  console.log(`   Panel admin: http://localhost:${PORT}/admin/login.html\n`);
});
