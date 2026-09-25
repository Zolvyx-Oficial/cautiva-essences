// server/routes/api.js
// Rutas públicas: catálogo, categorías, marcas, productos relacionados y reseñas.

const express = require('express');
const router = express.Router();
const db = require('../db');

function parseProduct(p) {
  return { ...p, images: JSON.parse(p.images || '[]') };
}

// Subconsultas para el promedio y la cantidad de reseñas aprobadas
const RATING_COLS = `
  (SELECT ROUND(AVG(r.rating), 1) FROM reviews r WHERE r.product_id = p.id AND r.approved = 1) AS rating_avg,
  (SELECT COUNT(*) FROM reviews r WHERE r.product_id = p.id AND r.approved = 1) AS rating_count
`;

const PRODUCT_SELECT = `
  SELECT p.*, b.name AS brand_name, c.slug AS category_slug,
         c.name_es AS category_name_es, c.name_en AS category_name_en,
         ${RATING_COLS}
  FROM products p
  LEFT JOIN brands b ON b.id = p.brand_id
  LEFT JOIN categories c ON c.id = p.category_id
`;

// GET /api/categories
router.get('/categories', (req, res) => {
  const rows = db.prepare('SELECT * FROM categories').all();
  res.json(rows);
});

// GET /api/brands?category=slug
router.get('/brands', (req, res) => {
  const { category } = req.query;
  let rows;
  if (category) {
    rows = db.prepare(`
      SELECT b.* FROM brands b
      JOIN categories c ON c.id = b.category_id
      WHERE c.slug = ?
      ORDER BY b.name
    `).all(category);
  } else {
    rows = db.prepare('SELECT * FROM brands ORDER BY name').all();
  }
  res.json(rows);
});

// GET /api/products?category=&brand=&q=&mayorista=1&minPrice=&maxPrice=&limit=&offset=
router.get('/products', (req, res) => {
  const { category, brand, q, mayorista, minPrice, maxPrice, limit, offset } = req.query;

  // Armamos el FROM + WHERE una sola vez, para reusarlo en el conteo
  let fromWhere = `
    FROM products p
    LEFT JOIN brands b ON b.id = p.brand_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.active = 1
  `;
  const params = [];
  if (category) { fromWhere += ' AND c.slug = ?'; params.push(category); }
  if (brand) { fromWhere += ' AND p.brand_id = ?'; params.push(brand); }
  if (q) { fromWhere += ' AND (p.name LIKE ? OR b.name LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
  if (minPrice) { fromWhere += ' AND p.price_detal >= ?'; params.push(Number(minPrice)); }
  if (maxPrice) { fromWhere += ' AND p.price_detal <= ?'; params.push(Number(maxPrice)); }

  const total = db.prepare(`SELECT COUNT(*) AS total ${fromWhere}`).get(...params).total;

  const lim = Math.min(Number(limit) || 12, 48);
  const off = Number(offset) || 0;

  const rows = db.prepare(`
    SELECT p.*, b.name AS brand_name, c.slug AS category_slug,
           c.name_es AS category_name_es, c.name_en AS category_name_en,
           ${RATING_COLS}
    ${fromWhere}
    ORDER BY b.name, p.name
    LIMIT ? OFFSET ?
  `).all(...params, lim, off).map(parseProduct);

  if (mayorista === '1') {
    rows.forEach(r => { r.display_price = r.price_mayor || r.price_detal; r.is_wholesale = true; });
  } else {
    rows.forEach(r => { r.display_price = r.price_detal; r.is_wholesale = false; });
  }

  res.json({ items: rows, total, hasMore: off + rows.length < total });
});

// GET /api/products/:id
router.get('/products/:id', (req, res) => {
  const row = db.prepare(`${PRODUCT_SELECT} WHERE p.id = ? AND p.active = 1`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Producto no encontrado.' });
  res.json(parseProduct(row));
});

// GET /api/products/:id/related — misma marca o categoría
router.get('/products/:id/related', (req, res) => {
  const current = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!current) return res.json([]);
  const rows = db.prepare(`
    ${PRODUCT_SELECT}
    WHERE p.active = 1 AND p.id != ? AND (p.brand_id = ? OR p.category_id = ?)
    ORDER BY (p.brand_id = ?) DESC, p.name
    LIMIT 4
  `).all(req.params.id, current.brand_id, current.category_id, current.brand_id).map(parseProduct);
  res.json(rows);
});

// GET /api/products/:id/reviews — solo las aprobadas
router.get('/products/:id/reviews', (req, res) => {
  const rows = db.prepare(`
    SELECT id, customer_name, rating, comment, created_at
    FROM reviews
    WHERE product_id = ? AND approved = 1
    ORDER BY created_at DESC
  `).all(req.params.id);
  res.json(rows);
});

// POST /api/products/:id/reviews — queda pendiente de aprobación
router.post('/products/:id/reviews', (req, res) => {
  const { customer_name, rating, comment } = req.body;

  const producto = db.prepare('SELECT id FROM products WHERE id = ? AND active = 1').get(req.params.id);
  if (!producto) return res.status(404).json({ error: 'Producto no encontrado.' });

  const nombre = (customer_name || '').trim();
  if (nombre.length < 2 || nombre.length > 60) {
    return res.status(400).json({ error: 'Escribe tu nombre (entre 2 y 60 caracteres).' });
  }
  const estrellas = Number(rating);
  if (!Number.isInteger(estrellas) || estrellas < 1 || estrellas > 5) {
    return res.status(400).json({ error: 'La calificación debe ser de 1 a 5 estrellas.' });
  }
  const texto = (comment || '').trim();
  if (texto.length > 600) {
    return res.status(400).json({ error: 'El comentario es demasiado largo (máx. 600 caracteres).' });
  }

  db.prepare(`
    INSERT INTO reviews (product_id, customer_name, rating, comment, approved)
    VALUES (?, ?, ?, ?, 0)
  `).run(req.params.id, nombre, estrellas, texto || null);

  res.status(201).json({ ok: true, message: '¡Gracias! Tu reseña será publicada una vez la revisemos.' });
});

module.exports = router;
