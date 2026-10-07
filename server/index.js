// server/index.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');

const db = require('./db'); // inicializa y siembra la base de datos

const apiRoutes = require('./routes/api');
const adminRoutes = require('./routes/admin');
const checkoutRoutes = require('./routes/checkout');
const wompiRoutes = require('./routes/wompi');
const seo = require('./seo');

const app = express();
const PORT = process.env.PORT || 3000;

// La tienda y la API viven en el mismo dominio, así que no hace falta abrir CORS
// a todo internet. En local se deja abierto para poder probar cómodo.
app.use(cors(
  process.env.APP_URL && process.env.NODE_ENV === 'production'
    ? { origin: process.env.APP_URL, credentials: true }
    : undefined
));
app.set('trust proxy', 1); // Railway va detrás de un proxy: necesario para ver la IP real
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ---------------------------------------------------------------------------
// SEO: estas rutas van ANTES de express.static.
// Si se ponen después, express.static entrega el archivo tal cual y las
// etiquetas nunca se reescriben.
// ---------------------------------------------------------------------------
app.get('/product.html', seo.paginaProducto(db));
app.get(['/', '/index.html'], seo.paginaEstatica('index.html', '/'));
app.get('/checkout.html', seo.paginaEstatica('checkout.html', '/checkout.html'));

// Archivos estáticos (frontend)
app.use('/img/products', express.static(path.join(__dirname, '..', 'data', 'products')));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Rutas API
app.use('/api', apiRoutes);
app.use('/admin', adminRoutes);
app.use('/checkout', checkoutRoutes);
app.use('/wompi', wompiRoutes);

// ---------------------------------------------------------------------------
// sitemap.xml — el índice que le entregamos a Google
// ---------------------------------------------------------------------------
app.get('/sitemap.xml', (req, res) => {
  const base = seo.baseUrl(req);

  const entrada = (ruta, cambio, prioridad, fecha) =>
    `<url><loc>${seo.esc(base + ruta)}</loc>` +
    (fecha ? `<lastmod>${fecha}</lastmod>` : '') +
    `<changefreq>${cambio}</changefreq><priority>${prioridad}</priority></url>`;

  const urls = [entrada('/', 'daily', '1.0')];

  try {
    const productos = db.prepare(
      'SELECT id, updated_at FROM products WHERE active = 1 ORDER BY id'
    ).all();
    for (const p of productos) {
      const fecha = (p.updated_at || '').split(' ')[0] || undefined;
      urls.push(entrada(`/product.html?id=${p.id}`, 'weekly', '0.8', fecha));
    }
  } catch (err) {
    console.error('sitemap: no se pudieron leer los productos -', err.message);
  }

  // checkout.html queda fuera a propósito: es una página de proceso de compra,
  // no tiene nada que Google deba mostrar en los resultados.

  res.header('Content-Type', 'application/xml');
  res.send(
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`
  );
});

app.get('/robots.txt', (req, res) => {
  const base = seo.baseUrl(req);
  res.type('text/plain').send(
    [
      'User-agent: *',
      'Allow: /',
      'Disallow: /admin',
      'Disallow: /checkout.html',
      'Disallow: /api/',
      '',
      `Sitemap: ${base}/sitemap.xml`
    ].join('\n')
  );
});

// Página no encontrada
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, '..', 'public', '404.html'));
});

app.listen(PORT, () => {
  console.log(`\n✨ Cautiva Essences corriendo en http://localhost:${PORT}`);
  console.log(`   Panel admin: http://localhost:${PORT}/admin/login.html\n`);
});
