// server/routes/admin.js
// Autenticación admin + CRUD completo de productos y pedidos (protegido).

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const crypto = require('crypto');
const { sendPasswordResetEmail } = require('../utils/email');
const { requireAdmin } = require('../middleware/auth');

// --- Subida de imágenes de producto ---
const uploadDir = path.join(__dirname, '..', '..', 'data', 'products');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9.]/g, '_')}`)
  }),
  limits: { fileSize: 5 * 1024 * 1024 }
});

// POST /admin/login
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM admin_users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.status(401).json({ error: 'Credenciales inválidas.' });
  }
  const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '8h' });
  res.cookie('essenza_admin_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 8 * 60 * 60 * 1000
  });
  res.json({ ok: true, email: user.email });
});

// POST /admin/logout
router.post('/logout', (req, res) => {
  res.clearCookie('essenza_admin_token');
  res.json({ ok: true });
});

// GET /admin/me
router.get('/me', requireAdmin, (req, res) => res.json({ email: req.admin.email }));

// POST /admin/forgot-password
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  const user = db.prepare('SELECT * FROM admin_users WHERE email = ?').get(email);
  // Respondemos igual exista o no el correo, para no revelar qué correos están registrados
  if (user) {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    db.prepare('UPDATE admin_users SET reset_token_hash = ?, reset_token_expires = ? WHERE id = ?').run(tokenHash, expires, user.id);
    const resetUrl = `${process.env.APP_URL}/admin/reset-password.html?token=${rawToken}&email=${encodeURIComponent(email)}`;
    await sendPasswordResetEmail({ email, resetUrl });
  }
  res.json({ ok: true, message: 'Si el correo existe, se envió un enlace de recuperación.' });
});

// POST /admin/reset-password
router.post('/reset-password', (req, res) => {
  const { email, token, newPassword } = req.body;
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });
  }
  const user = db.prepare('SELECT * FROM admin_users WHERE email = ?').get(email);
  if (!user || !user.reset_token_hash || !user.reset_token_expires) {
    return res.status(400).json({ error: 'Enlace inválido o expirado.' });
  }
  if (new Date(user.reset_token_expires) < new Date()) {
    return res.status(400).json({ error: 'El enlace expiró. Solicita uno nuevo.' });
  }
  const tokenHash = crypto.createHash('sha256').update(token || '').digest('hex');
  if (tokenHash !== user.reset_token_hash) {
    return res.status(400).json({ error: 'Enlace inválido.' });
  }
  const newHash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE admin_users SET password_hash = ?, reset_token_hash = NULL, reset_token_expires = NULL WHERE id = ?').run(newHash, user.id);
  res.json({ ok: true });
});

// --- A partir de aquí, todas las rutas requieren sesión de admin ---
router.use(requireAdmin);

// GET /admin/products  (incluye inactivos, para gestión completa)
router.get('/products', (req, res) => {
  const rows = db.prepare(`
    SELECT p.*, b.name AS brand_name, c.name_es AS category_name_es
    FROM products p
    LEFT JOIN brands b ON b.id = p.brand_id
    LEFT JOIN categories c ON c.id = p.category_id
    ORDER BY p.updated_at DESC
  `).all().map(p => ({ ...p, images: JSON.parse(p.images || '[]') }));
  res.json(rows);
});

// GET /admin/categories, /admin/brands (para selects del formulario)
router.get('/categories', (req, res) => res.json(db.prepare('SELECT * FROM categories').all()));
router.get('/brands', (req, res) => res.json(db.prepare('SELECT * FROM brands ORDER BY name').all()));

// POST /admin/products  — Crear producto
router.post('/products', (req, res) => {
  const b = req.body;
  const required = ['sku', 'name', 'brand_id', 'category_id', 'price_detal', 'presentation_value', 'presentation_unit', 'weight_grams'];
  for (const field of required) {
    if (b[field] === undefined || b[field] === '') return res.status(400).json({ error: `El campo "${field}" es obligatorio.` });
  }
  try {
    const stmt = db.prepare(`
      INSERT INTO products
        (sku, name, brand_id, category_id, notes_salida, notes_corazon, notes_fondo,
         description_es, description_en, price_detal, compare_at_price, price_mayor, mayor_min_qty,
         presentation_value, presentation_unit, weight_grams, stock_status, stock_qty, images, active)
      VALUES (@sku,@name,@brand_id,@category_id,@notes_salida,@notes_corazon,@notes_fondo,
              @description_es,@description_en,@price_detal,@compare_at_price,@price_mayor,@mayor_min_qty,
              @presentation_value,@presentation_unit,@weight_grams,@stock_status,@stock_qty,@images,@active)
    `);
    const info = stmt.run({
      sku: b.sku, name: b.name, brand_id: b.brand_id, category_id: b.category_id,
      notes_salida: b.notes_salida || '', notes_corazon: b.notes_corazon || '', notes_fondo: b.notes_fondo || '',
      description_es: b.description_es || '', description_en: b.description_en || '',
      price_detal: b.price_detal, compare_at_price: b.compare_at_price || null,
      price_mayor: b.price_mayor || null, mayor_min_qty: b.mayor_min_qty || 6,
      presentation_value: b.presentation_value, presentation_unit: b.presentation_unit,
      weight_grams: b.weight_grams, stock_status: b.stock_status || 'disponible', stock_qty: b.stock_qty || 0,
      images: JSON.stringify(b.images || []), active: b.active === false ? 0 : 1
    });
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (err) {
    res.status(400).json({ error: 'No se pudo crear el producto: ' + err.message });
  }
});

// PUT /admin/products/:id — Editar producto
router.put('/products/:id', (req, res) => {
  const b = req.body;
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Producto no encontrado.' });

  const merged = { ...existing, ...b, images: JSON.stringify(b.images !== undefined ? b.images : JSON.parse(existing.images || '[]')) };
  try {
    db.prepare(`
      UPDATE products SET
        sku=@sku, name=@name, brand_id=@brand_id, category_id=@category_id,
        notes_salida=@notes_salida, notes_corazon=@notes_corazon, notes_fondo=@notes_fondo,
        description_es=@description_es, description_en=@description_en,
        price_detal=@price_detal, compare_at_price=@compare_at_price, price_mayor=@price_mayor, mayor_min_qty=@mayor_min_qty,
        presentation_value=@presentation_value, presentation_unit=@presentation_unit,
        weight_grams=@weight_grams, stock_status=@stock_status, stock_qty=@stock_qty,
        images=@images, active=@active, updated_at=datetime('now')
      WHERE id=@id
    `).run({ ...merged, id: req.params.id, active: merged.active ? 1 : 0 });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: 'No se pudo actualizar el producto: ' + err.message });
  }
});

// PATCH /admin/products/:id/pause — Pausar / reactivar
router.patch('/products/:id/pause', (req, res) => {
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Producto no encontrado.' });
  const newActive = existing.active ? 0 : 1;
  db.prepare(`UPDATE products SET active=?, updated_at=datetime('now') WHERE id=?`).run(newActive, req.params.id);
  res.json({ ok: true, active: !!newActive });
});

// DELETE /admin/products/:id
router.delete('/products/:id', (req, res) => {
  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// POST /admin/upload — Subida de imágenes (galería de producto)
router.post('/upload', upload.array('images', 6), (req, res) => {
  const paths = (req.files || []).map(f => `/img/products/${f.filename}`);
  res.json({ paths });
});

// ---------- PEDIDOS ----------

// GET /admin/orders — Ver pedidos
router.get('/orders', (req, res) => {
  const rows = db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all();
  res.json(rows);
});

// GET /admin/order-items — Productos de todos los pedidos, para la columna PRODUCTOS
// Se declara antes de /orders/:id para que Express no la confunda con un id.
router.get('/order-items', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT oi.*,
             COALESCE(p.name, 'Producto eliminado') AS product_name,
             p.sku,
             p.presentation_value,
             p.presentation_unit,
             b.name AS brand_name
      FROM order_items oi
      LEFT JOIN products p ON p.id = oi.product_id
      LEFT JOIN brands   b ON b.id = p.brand_id
      ORDER BY oi.order_id DESC, oi.id ASC
    `).all();
    res.json(rows);
  } catch (err) {
    console.error('Error cargando order-items:', err.message);
    res.status(500).json({ error: 'No se pudieron cargar los productos de los pedidos.' });
  }
});

// GET /admin/orders/:id/items — Detalle de un pedido puntual
router.get('/orders/:id/items', (req, res) => {
  const pedido = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado.' });
  try {
    const items = db.prepare(`
      SELECT oi.*,
             COALESCE(p.name, 'Producto eliminado') AS product_name,
             p.sku,
             p.presentation_value,
             p.presentation_unit,
             b.name AS brand_name
      FROM order_items oi
      LEFT JOIN products p ON p.id = oi.product_id
      LEFT JOIN brands   b ON b.id = p.brand_id
      WHERE oi.order_id = ?
      ORDER BY oi.id ASC
    `).all(req.params.id);
    res.json({ order: pedido, items });
  } catch (err) {
    console.error('Error cargando el detalle del pedido:', err.message);
    res.status(500).json({ error: 'No se pudo cargar el detalle del pedido.' });
  }
});

// PATCH /admin/orders/:id/status — Cambiar estado del pedido manualmente
router.patch('/orders/:id/status', (req, res) => {
  const { payment_status } = req.body;
  const permitidos = ['pendiente', 'aprobada', 'entregada', 'rechazada'];
  if (!permitidos.includes(payment_status)) {
    return res.status(400).json({ error: 'Estado no válido.' });
  }
  const existing = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Pedido no encontrado.' });
  db.prepare('UPDATE orders SET payment_status = ? WHERE id = ?').run(payment_status, req.params.id);
  res.json({ ok: true, payment_status });
});

// DELETE /admin/orders/:id — Eliminar un pedido y sus items
router.delete('/orders/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Pedido no encontrado.' });
  // Los items se borran primero por la llave foránea
  const borrarPedido = db.transaction((id) => {
    db.prepare('DELETE FROM order_items WHERE order_id = ?').run(id);
    db.prepare('DELETE FROM orders WHERE id = ?').run(id);
  });
  borrarPedido(req.params.id);
  res.json({ ok: true });
});

// ---------- RESEÑAS ----------

// GET /admin/reviews — todas (aprobadas y pendientes)
router.get('/reviews', (req, res) => {
  const rows = db.prepare(`
    SELECT r.*, p.name AS product_name
    FROM reviews r
    LEFT JOIN products p ON p.id = r.product_id
    ORDER BY r.approved ASC, r.created_at DESC
  `).all();
  res.json(rows);
});

// PATCH /admin/reviews/:id/approve — aprobar / ocultar
router.patch('/reviews/:id/approve', (req, res) => {
  const existing = db.prepare('SELECT * FROM reviews WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Reseña no encontrada.' });
  const nuevoEstado = existing.approved ? 0 : 1;
  db.prepare('UPDATE reviews SET approved = ? WHERE id = ?').run(nuevoEstado, req.params.id);
  res.json({ ok: true, approved: !!nuevoEstado });
});

// DELETE /admin/reviews/:id
router.delete('/reviews/:id', (req, res) => {
  db.prepare('DELETE FROM reviews WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- CATEGORÍAS ----------

function generarSlug(texto) {
  return String(texto).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// POST /admin/categories — Crear categoría
router.post('/categories', (req, res) => {
  const { slug, name_es, name_en, description_es, description_en } = req.body;
  if (!name_es || !name_en) return res.status(400).json({ error: 'El nombre en español y en inglés son obligatorios.' });
  const slugFinal = generarSlug(slug || name_es);
  try {
    const info = db.prepare(`
      INSERT INTO categories (slug, name_es, name_en, description_es, description_en)
      VALUES (?, ?, ?, ?, ?)
    `).run(slugFinal, name_es.trim(), name_en.trim(), description_es || '', description_en || '');
    res.status(201).json({ id: info.lastInsertRowid, slug: slugFinal });
  } catch (err) {
    res.status(400).json({ error: 'No se pudo crear la categoría (¿el identificador ya existe?): ' + err.message });
  }
});

// PUT /admin/categories/:id — Editar categoría
router.put('/categories/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Categoría no encontrada.' });
  const b = { ...existing, ...req.body };
  try {
    db.prepare(`
      UPDATE categories SET slug=?, name_es=?, name_en=?, description_es=?, description_en=?
      WHERE id=?
    `).run(generarSlug(b.slug || b.name_es), b.name_es, b.name_en, b.description_es || '', b.description_en || '', req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: 'No se pudo actualizar la categoría: ' + err.message });
  }
});

// DELETE /admin/categories/:id — solo si no tiene productos ni marcas
router.delete('/categories/:id', (req, res) => {
  const productos = db.prepare('SELECT COUNT(*) c FROM products WHERE category_id = ?').get(req.params.id).c;
  if (productos > 0) {
    return res.status(400).json({ error: `No se puede eliminar: hay ${productos} producto(s) en esta categoría. Muévelos primero.` });
  }
  const marcas = db.prepare('SELECT COUNT(*) c FROM brands WHERE category_id = ?').get(req.params.id).c;
  if (marcas > 0) {
    return res.status(400).json({ error: `No se puede eliminar: hay ${marcas} marca(s) en esta categoría. Muévelas primero.` });
  }
  db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- MARCAS ----------

// POST /admin/brands — Crear marca
router.post('/brands', (req, res) => {
  const { name, category_id } = req.body;
  if (!name || !category_id) return res.status(400).json({ error: 'El nombre y la categoría son obligatorios.' });
  try {
    const info = db.prepare('INSERT INTO brands (name, category_id) VALUES (?, ?)').run(name.trim(), category_id);
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (err) {
    res.status(400).json({ error: 'No se pudo crear la marca (¿ya existe una con ese nombre?): ' + err.message });
  }
});

// PUT /admin/brands/:id — Editar marca
router.put('/brands/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM brands WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Marca no encontrada.' });
  const b = { ...existing, ...req.body };
  try {
    db.prepare('UPDATE brands SET name=?, category_id=? WHERE id=?').run(b.name, b.category_id, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: 'No se pudo actualizar la marca: ' + err.message });
  }
});

// DELETE /admin/brands/:id — solo si no tiene productos
router.delete('/brands/:id', (req, res) => {
  const productos = db.prepare('SELECT COUNT(*) c FROM products WHERE brand_id = ?').get(req.params.id).c;
  if (productos > 0) {
    return res.status(400).json({ error: `No se puede eliminar: hay ${productos} producto(s) de esta marca. Muévelos o elimínalos primero.` });
  }
  db.prepare('DELETE FROM brands WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
