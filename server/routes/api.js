// server/routes/api.js
// Rutas públicas: catálogo, categorías, marcas.

const express = require('express');
const router = express.Router();
const db = require('../db');

function parseProduct(p) {
  return { ...p, images: JSON.parse(p.images || '[]') };
}

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

// GET /api/products?category=slug&brand=id&q=texto&mayorista=1&minPrice=&maxPrice=&limit=&offset=
router.get('/products', (req, res) => {
  const { category, brand, q, mayorista, minPrice, maxPrice, limit, offset } = req.query;
  let sql = `
    SELECT p.*, b.name AS brand_name, c.slug AS category_slug, c.name_es AS category_name_es, c.name_en AS category_name_en
    FROM products p
    LEFT JOIN brands b ON b.id = p.brand_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.active = 1
  `;
  const params = [];
  if (category) { sql += ' AND c.slug = ?'; params.push(category); }
  if (brand) { sql += ' AND p.brand_id = ?'; params.push(brand); }
  if (q) { sql += ' AND (p.name LIKE ? OR b.name LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
  if (minPrice) { sql += ' AND p.price_detal >= ?'; params.push(Number(minPrice)); }
  if (maxPrice) { sql += ' AND p.price_detal <= ?'; params.push(Number(maxPrice)); }

  // Contamos el total ANTES de aplicar paginación, para saber si hay más productos
  const countSql = sql.replace(/SELECT p\.\*.*?FROM/s, 'SELECT COUNT(*) as total FROM');
  const total = db.prepare(countSql).get(...params).total;

  sql += ' ORDER BY b.name, p.name';
  const lim = Math.min(Number(limit) || 12, 48);
  const off = Number(offset) || 0;
  sql += ' LIMIT ? OFFSET ?';
  params.push(lim, off);

  const rows = db.prepare(sql).all(...params).map(parseProduct);
  if (mayorista === '1') {
    rows.forEach(r => { r.display_price = r.price_mayor || r.price_detal; r.is_wholesale = true; });
  } else {
    rows.forEach(r => { r.display_price = r.price_detal; r.is_wholesale = false; });
  }
  res.json({ items: rows, total, hasMore: off + rows.length < total });
});

// GET /api/products/:id/related — productos de la misma marca o categoría
router.get('/products/:id/related', (req, res) => {
  const current = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!current) return res.json([]);
  const rows = db.prepare(`
    SELECT p.*, b.name AS brand_name, c.slug AS category_slug, c.name_es AS category_name_es, c.name_en AS category_name_en
    FROM products p
    LEFT JOIN brands b ON b.id = p.brand_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.active = 1 AND p.id != ? AND (p.brand_id = ? OR p.category_id = ?)
    ORDER BY (p.brand_id = ?) DESC, p.name
    LIMIT 4
  `).all(req.params.id, current.brand_id, current.category_id, current.brand_id).map(parseProduct);
  res.json(rows);
});

// GET /api/products/:id
router.get('/products/:id', (req, res) => {
  const row = db.prepare(`
    SELECT p.*, b.name AS brand_name, c.slug AS category_slug, c.name_es AS category_name_es, c.name_en AS category_name_en
    FROM products p
    LEFT JOIN brands b ON b.id = p.brand_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.id = ? AND p.active = 1
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Producto no encontrado.' });
  res.json(parseProduct(row));
});

module.exports = router;
