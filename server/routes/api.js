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

// GET /api/products?category=slug&brand=id&q=texto&mayorista=1
router.get('/products', (req, res) => {
  const { category, brand, q, mayorista } = req.query;
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
  sql += ' ORDER BY b.name, p.name';
  const rows = db.prepare(sql).all(...params).map(parseProduct);
  if (mayorista === '1') {
    // Para vista mayorista, exponer explícitamente el precio y mínimo por mayor
    rows.forEach(r => { r.display_price = r.price_mayor || r.price_detal; r.is_wholesale = true; });
  } else {
    rows.forEach(r => { r.display_price = r.price_detal; r.is_wholesale = false; });
  }
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
