// server/db.js
// Configuración de base de datos SQLite (better-sqlite3) + seed de catálogo inicial.

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, '..', 'data', 'essenza.db');
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ---------- ESQUEMA ----------
db.exec(`
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  name_es TEXT NOT NULL,
  name_en TEXT NOT NULL,
  description_es TEXT,
  description_en TEXT
);

CREATE TABLE IF NOT EXISTS brands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  category_id INTEGER REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  brand_id INTEGER REFERENCES brands(id),
  category_id INTEGER REFERENCES categories(id),
  notes_salida TEXT,
  notes_corazon TEXT,
  notes_fondo TEXT,
  description_es TEXT,
  description_en TEXT,
  price_detal INTEGER NOT NULL,       -- COP, sin decimales
  price_mayor INTEGER,                -- COP, precio por mayor (opcional)
  mayor_min_qty INTEGER DEFAULT 6,    -- unidades mínimas para precio mayorista
  presentation_value REAL NOT NULL,   -- p.ej 100
  presentation_unit TEXT NOT NULL DEFAULT 'ml', -- 'ml' | 'oz'
  weight_grams INTEGER NOT NULL DEFAULT 500,
  stock_status TEXT NOT NULL DEFAULT 'disponible', -- disponible | agotado | pre-orden
  stock_qty INTEGER NOT NULL DEFAULT 0,
  images TEXT DEFAULT '[]', -- JSON array de rutas
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT UNIQUE NOT NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_email TEXT,
  customer_address TEXT,
  customer_city TEXT,
  shipping_type TEXT NOT NULL,     -- local_express | local_pickup | nacional
  shipping_carrier TEXT,           -- interrapidisimo | envia | null
  shipping_cost INTEGER NOT NULL DEFAULT 0,
  subtotal INTEGER NOT NULL,
  total_weight_grams INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL,
  payment_status TEXT NOT NULL DEFAULT 'pendiente', -- pendiente | aprobada | rechazada
  payment_method TEXT,
  wompi_transaction_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,
  unit_price INTEGER NOT NULL,
  qty INTEGER NOT NULL,
  line_total INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  customer_name TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  comment TEXT,
  approved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
`);

// ---------- MIGRACIONES (para bases de datos que ya existen en producción) ----------
try { db.exec(`ALTER TABLE products ADD COLUMN compare_at_price INTEGER`); } catch (e) { /* ya existe, ignorar */ }
try { db.exec(`ALTER TABLE admin_users ADD COLUMN reset_token_hash TEXT`); } catch (e) { /* ya existe, ignorar */ }
try { db.exec(`ALTER TABLE admin_users ADD COLUMN reset_token_expires TEXT`); } catch (e) { /* ya existe, ignorar */ }
// Marca si a un pedido ya se le descontó el inventario, para no descontarlo dos veces
// cuando WOMPI reenvía el mismo evento (lo hace varias veces si no respondemos rápido).
try { db.exec(`ALTER TABLE orders ADD COLUMN stock_descontado INTEGER NOT NULL DEFAULT 0`); } catch (e) { /* ya existe, ignorar */ }

// ---------- SEED ----------
function seed() {
  const catCount = db.prepare('SELECT COUNT(*) c FROM categories').get().c;
  if (catCount === 0) {
    const insertCat = db.prepare(`INSERT INTO categories (slug, name_es, name_en, description_es, description_en) VALUES (?,?,?,?,?)`);
    const categories = [
      ['arabe-oriental', 'Perfumería Árabe / Oriental', 'Arabic / Oriental Perfumery', 'Ámbar, oud y especias envueltos en una estela cálida y duradera.', 'Amber, oud and spice wrapped in a warm, long-lasting trail.'],
      ['nicho-exclusiva', 'Perfumería Nicho & Exclusiva', 'Niche & Exclusive Perfumery', 'Composiciones fuera de serie para quienes buscan distinción.', 'Out-of-the-ordinary compositions for those seeking distinction.'],
      ['diseñador-comercial', 'Perfumería de Diseñador / Comercial', 'Designer / Commercial Perfumery', 'Los clásicos internacionales que nunca pasan de moda.', 'International classics that never go out of style.']
    ];
    const catIds = {};
    for (const c of categories) {
      const info = insertCat.run(...c);
      catIds[c[0]] = info.lastInsertRowid;
    }

    const insertBrand = db.prepare(`INSERT INTO brands (name, category_id) VALUES (?,?)`);
    const brandIds = {};
    const brandsByCategory = {
      'arabe-oriental': ['Lattafa', 'Al Haramain', 'Orientica'],
      'nicho-exclusiva': ['Bharara', 'Bond No. 9'],
      'diseñador-comercial': ['Carolina Herrera', 'Chanel', 'Ariana Grande']
    };
    for (const [catSlug, brands] of Object.entries(brandsByCategory)) {
      for (const b of brands) {
        const info = insertBrand.run(b, catIds[catSlug]);
        brandIds[b] = info.lastInsertRowid;
      }
    }

    const insertProduct = db.prepare(`
      INSERT INTO products
        (sku, name, brand_id, category_id, notes_salida, notes_corazon, notes_fondo,
         description_es, description_en, price_detal, price_mayor, mayor_min_qty,
         presentation_value, presentation_unit, weight_grams, stock_status, stock_qty, images)
      VALUES (@sku,@name,@brand_id,@category_id,@notes_salida,@notes_corazon,@notes_fondo,
              @description_es,@description_en,@price_detal,@price_mayor,@mayor_min_qty,
              @presentation_value,@presentation_unit,@weight_grams,@stock_status,@stock_qty,@images)
    `);

    // Utilidad para generar SKU
    const skuFrom = (brand, name) => (brand + '-' + name).toUpperCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    const seedProducts = [
      // Lattafa - Árabe/Oriental
      ['Lattafa', 'Yara Rosada', catIds['arabe-oriental'], 'Vainilla, frutas rojas', 'Flor de azahar', 'Sándalo, almizcle', 89000, 72000, 100, 'ml'],
      ['Lattafa', 'Ajwad', catIds['arabe-oriental'], 'Azafrán, canela', 'Rosa, oud', 'Ámbar, vainilla', 95000, 78000, 100, 'ml'],
      ['Lattafa', 'Emeer', catIds['arabe-oriental'], 'Bergamota', 'Especias árabes', 'Oud, ámbar', 92000, 75000, 100, 'ml'],
      ['Lattafa', 'Amatista', catIds['arabe-oriental'], 'Frutas moradas', 'Flores blancas', 'Almizcle, vainilla', 89000, 72000, 100, 'ml'],
      // Al Haramain
      ['Al Haramain', 'Amber Oud 1.1', catIds['arabe-oriental'], 'Cítricos', 'Ámbar, oud', 'Maderas cálidas', 165000, 140000, 60, 'ml'],
      ['Al Haramain', 'Amber Oud', catIds['arabe-oriental'], 'Manzana, canela', 'Oud, ámbar', 'Vainilla, maderas', 155000, 132000, 60, 'ml'],
      // Orientica
      ['Orientica', 'Royal Bleu', catIds['arabe-oriental'], 'Bergamota, manzana', 'Lavanda, geranio', 'Ámbar, cuero', 175000, 148000, 80, 'ml'],
      ['Orientica', 'Oud Saffron', catIds['arabe-oriental'], 'Azafrán', 'Rosa, oud', 'Ámbar, sándalo', 180000, 152000, 80, 'ml'],
      ['Orientica', 'Amber Rouge', catIds['arabe-oriental'], 'Frutas rojas', 'Ámbar, especias', 'Maderas, almizcle', 178000, 150000, 80, 'ml'],
      // Bharara - Nicho
      ['Bharara', 'Bharara Rose', catIds['nicho-exclusiva'], 'Bergamota', 'Rosa búlgara', 'Almizcle, ámbar', 210000, 178000, 100, 'ml'],
      ['Bharara', 'Bharara Double Bleu', catIds['nicho-exclusiva'], 'Menta, cítricos', 'Lavanda', 'Maderas, almizcle', 215000, 182000, 100, 'ml'],
      ['Bharara', 'Bharara Niche 1.1', catIds['nicho-exclusiva'], 'Especias', 'Oud, cuero', 'Ámbar, vainilla', 230000, 195000, 100, 'ml'],
      // Bond No. 9
      ['Bond No. 9', 'NYC (I Love NY)', catIds['nicho-exclusiva'], 'Mandarina, bergamota', 'Jazmín, rosa', 'Almizcle, sándalo', 480000, null, 50, 'ml'],
      ['Bond No. 9', 'Bleecker', catIds['nicho-exclusiva'], 'Cítricos, higuera', 'Iris, violeta', 'Almizcle blanco', 470000, null, 50, 'ml'],
      ['Bond No. 9', 'The Scent of Peace', catIds['nicho-exclusiva'], 'Pera, magnolia', 'Rosa, lirio', 'Sándalo, almizcle', 490000, null, 100, 'ml'],
      // Carolina Herrera
      ['Carolina Herrera', 'CH', catIds['diseñador-comercial'], 'Cítricos', 'Flores blancas', 'Maderas, almizcle', 260000, null, 100, 'ml'],
      ['Carolina Herrera', '212 Heroes', catIds['diseñador-comercial'], 'Manzana verde', 'Especias', 'Vainilla, maderas', 270000, null, 90, 'ml'],
      ['Carolina Herrera', '212 VIP Rosé', catIds['diseñador-comercial'], 'Champagne rosé', 'Frambuesa', 'Almizcle, ámbar', 275000, null, 80, 'ml'],
      ['Carolina Herrera', '212 VIP', catIds['diseñador-comercial'], 'Champagne, granada', 'Ámbar dorado', 'Almizcle, madera', 275000, null, 100, 'ml'],
      // Chanel
      ['Chanel', 'Chanel N°5', catIds['diseñador-comercial'], 'Aldehídos, ylang-ylang', 'Rosa, jazmín', 'Sándalo, vainilla', 650000, null, 100, 'ml'],
      ['Chanel', 'Chance Chanel', catIds['diseñador-comercial'], 'Cítricos, pimienta rosa', 'Jazmín, ámbar', 'Pachulí, almizcle blanco', 620000, null, 100, 'ml'],
      // Ariana Grande
      ['Ariana Grande', 'Cloud', catIds['diseñador-comercial'], 'Coco, praliné', 'Orquídea, algodón de azúcar', 'Almizcle, madera', 195000, null, 100, 'ml'],
      ['Ariana Grande', 'Thank U Next', catIds['diseñador-comercial'], 'Fresa, pera', 'Coco, macarrón', 'Almendra, almizcle', 195000, null, 100, 'ml']
    ];

    for (const p of seedProducts) {
      const [brand, name, category_id, notes_salida, notes_corazon, notes_fondo, price_detal, price_mayor, weight_grams, unit] = p;
      insertProduct.run({
        sku: skuFrom(brand, name),
        name,
        brand_id: brandIds[brand],
        category_id,
        notes_salida, notes_corazon, notes_fondo,
        description_es: `${name} de ${brand}: una composición que combina ${notes_salida.toLowerCase()} de salida con un corazón de ${notes_corazon.toLowerCase()} y un fondo envolvente de ${notes_fondo.toLowerCase()}.`,
        description_en: `${name} by ${brand}: a composition opening with ${notes_salida.toLowerCase()}, a heart of ${notes_corazon.toLowerCase()}, and a lingering base of ${notes_fondo.toLowerCase()}.`,
        price_detal,
        price_mayor,
        mayor_min_qty: 6,
        presentation_value: 100,
        presentation_unit: unit,
        weight_grams,
        stock_status: 'disponible',
        stock_qty: 25,
        images: JSON.stringify([])
      });
    }
    console.log(`Seed: ${seedProducts.length} productos, ${Object.keys(brandIds).length} marcas, ${categories.length} categorías.`);
  }

  const adminCount = db.prepare('SELECT COUNT(*) c FROM admin_users').get().c;
  if (adminCount === 0) {
    require('dotenv').config();
    const email = process.env.ADMIN_EMAIL || 'admin@essenzastudio.co';
    const pass = process.env.ADMIN_PASSWORD || 'CambiaEstaClave123!';
    const hash = bcrypt.hashSync(pass, 10);
    db.prepare('INSERT INTO admin_users (email, password_hash) VALUES (?,?)').run(email, hash);
    console.log(`Seed: usuario admin creado (${email}).`);
  }
}

seed();

if (require.main === module) {
  console.log('Base de datos inicializada en', DB_PATH);
}

// ---------- CONSOLIDACIÓN DEL WAL ----------
// Sin esto, todo lo que se escribe vive solo en essenza.db-wal y el archivo
// principal nunca se actualiza. Si el WAL se pierde, se pierde el catálogo.

db.pragma('wal_autocheckpoint = 200');

// Volcado periódico mientras el servidor corre
setInterval(() => {
  try { db.pragma('wal_checkpoint(PASSIVE)'); } catch (e) { }
}, 120000).unref();

// Volcado completo y cierre ordenado cuando Railway reinicia el servicio
function cerrarLimpio() {
  try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch (e) { }
  try { db.close(); } catch (e) { }
  process.exit(0);
}
process.on('SIGTERM', cerrarLimpio);
process.on('SIGINT', cerrarLimpio);

module.exports = db;
