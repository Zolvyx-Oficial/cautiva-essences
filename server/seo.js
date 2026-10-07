// server/seo.js
// Inyecta las etiquetas SEO correctas en las páginas ANTES de servirlas.
//
// Por qué existe este archivo:
// product.html es una sola plantilla que el navegador rellena con JavaScript.
// Eso significa que, tal cual, TODOS los perfumes compartían el mismo <title>,
// la misma descripción y el mismo <link rel="canonical">. Un canonical repetido
// le dice a Google "todas estas direcciones son en realidad la misma página",
// así que Google indexaba un solo perfume y descartaba el resto.
// Aquí reescribimos esas etiquetas en el servidor, producto por producto.

const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/** Dirección base del sitio, sin barra final. */
function baseUrl(req) {
  const env = (process.env.APP_URL || '').trim().replace(/\/+$/, '');
  if (env) return env;
  // Respaldo: si APP_URL no está configurada, usamos el dominio de la petición.
  return `${req.protocol}://${req.get('host')}`;
}

/** Convierte "/img/x.jpg" en "https://dominio/img/x.jpg". */
function absoluta(base, ruta) {
  if (!ruta) return '';
  if (/^https?:\/\//i.test(ruta)) return ruta;
  return base + (ruta.startsWith('/') ? ruta : '/' + ruta);
}

/** Escapa texto para que quepa dentro de un atributo HTML sin romperlo. */
function esc(txt) {
  return String(txt == null ? '' : txt)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Recorta un texto a una longitud razonable para la descripción de Google. */
function recortar(txt, max = 155) {
  const limpio = String(txt || '').replace(/\s+/g, ' ').trim();
  if (limpio.length <= max) return limpio;
  const corte = limpio.slice(0, max);
  return corte.slice(0, corte.lastIndexOf(' ')).replace(/[.,;:]$/, '') + '…';
}

// ---------------------------------------------------------------------------
// Reescritura de etiquetas
// ---------------------------------------------------------------------------

function ponerTitulo(html, valor) {
  return html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${esc(valor)}</title>`);
}

function ponerMetaNombre(html, nombre, valor) {
  const re = new RegExp(`<meta\\s+name=["']${nombre}["'][^>]*>`, 'i');
  const etiqueta = `<meta name="${nombre}" content="${esc(valor)}">`;
  return re.test(html) ? html.replace(re, etiqueta) : html.replace(/<\/head>/i, `  ${etiqueta}\n</head>`);
}

function ponerMetaPropiedad(html, propiedad, valor) {
  const re = new RegExp(`<meta\\s+property=["']${propiedad}["'][^>]*>`, 'i');
  const etiqueta = `<meta property="${propiedad}" content="${esc(valor)}">`;
  return re.test(html) ? html.replace(re, etiqueta) : html.replace(/<\/head>/i, `  ${etiqueta}\n</head>`);
}

function ponerCanonical(html, url) {
  const re = /<link\s+rel=["']canonical["'][^>]*>/i;
  const etiqueta = `<link rel="canonical" href="${esc(url)}">`;
  return re.test(html) ? html.replace(re, etiqueta) : html.replace(/<\/head>/i, `  ${etiqueta}\n</head>`);
}

function agregarJsonLd(html, objeto) {
  const bloque = `<script type="application/ld+json">\n${JSON.stringify(objeto, null, 2)}\n</script>`;
  return html.replace(/<\/head>/i, `${bloque}\n</head>`);
}

/** Deja en absoluto cualquier og:image / JSON-LD "image" que haya quedado relativo. */
function absolutizarImagenes(html, base) {
  return html
    .replace(/(<meta\s+property=["']og:image["']\s+content=["'])(\/[^"']*)/gi, `$1${base}$2`)
    .replace(/("image"\s*:\s*")(\/[^"]*)/g, `$1${base}$2`);
}

// ---------------------------------------------------------------------------
// Páginas
// ---------------------------------------------------------------------------

const cache = new Map();
function leer(archivo) {
  // En producción el archivo no cambia, así que lo leemos una sola vez.
  if (process.env.NODE_ENV === 'production' && cache.has(archivo)) return cache.get(archivo);
  const html = fs.readFileSync(path.join(PUBLIC_DIR, archivo), 'utf8');
  cache.set(archivo, html);
  return html;
}

/**
 * Páginas estáticas: solo hay que volver absolutas las direcciones.
 * Google ignora un canonical relativo y WhatsApp no muestra la imagen
 * de vista previa si og:image no es una dirección completa.
 */
function paginaEstatica(archivo, rutaCanonica) {
  return (req, res, next) => {
    try {
      const base = baseUrl(req);
      let html = leer(archivo);
      html = ponerCanonical(html, base + rutaCanonica);
      html = ponerMetaPropiedad(html, 'og:url', base + rutaCanonica);
      // La ficha de negocio (schema.org Store) necesita su dirección web.
      html = html.replace(/("@type"\s*:\s*"Store"\s*,)/,
                          `$1\n  "url": "${esc(base)}",`);
      html = absolutizarImagenes(html, base);
      res.type('html').send(html);
    } catch (err) {
      console.error('SEO: no se pudo servir', archivo, '-', err.message);
      next(); // que lo sirva express.static como siempre
    }
  };
}

/**
 * Ficha de producto: title, descripción, canonical, redes y datos
 * estructurados propios de CADA perfume.
 */
function paginaProducto(db) {
  return (req, res, next) => {
    try {
      const base = baseUrl(req);
      let html = leer('product.html');

      const id = Number.parseInt(req.query.id, 10);
      if (!Number.isInteger(id) || id <= 0) {
        // Sin id válido no hay ficha: le decimos a Google que no la indexe
        // para que no guarde una página vacía con el nombre de la tienda.
        html = ponerMetaNombre(html, 'robots', 'noindex, follow');
        html = ponerCanonical(html, base + '/');
        return res.type('html').send(absolutizarImagenes(html, base));
      }

      const p = db.prepare(`
        SELECT p.*, b.name AS brand_name, c.name_es AS category_name_es,
               (SELECT ROUND(AVG(r.rating), 1) FROM reviews r
                  WHERE r.product_id = p.id AND r.approved = 1) AS rating_avg,
               (SELECT COUNT(*) FROM reviews r
                  WHERE r.product_id = p.id AND r.approved = 1) AS rating_count
        FROM products p
        LEFT JOIN brands b ON b.id = p.brand_id
        LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.id = ? AND p.active = 1
      `).get(id);

      if (!p) {
        html = ponerMetaNombre(html, 'robots', 'noindex, follow');
        html = ponerCanonical(html, base + '/');
        return res.status(404).type('html').send(absolutizarImagenes(html, base));
      }

      const url = `${base}/product.html?id=${p.id}`;
      const marca = p.brand_name || 'Cautiva Essences';
      const medida = `${Number(p.presentation_value)}${p.presentation_unit || 'ml'}`;
      const titulo = `${p.name} ${medida} — ${marca} | Cautiva Essences`;

      const descripcion = recortar(
        p.description_es
          ? p.description_es
          : `${p.name} de ${marca}, presentación ${medida}. Perfume original disponible en ` +
            `Cautiva Essences, Rionegro, Antioquia. Envíos a toda Colombia.`
      );

      let imagenes = [];
      try { imagenes = JSON.parse(p.images || '[]'); } catch (e) { imagenes = []; }
      const imagen = absoluta(base, imagenes[0] || '/img/logo.jpg');

      html = ponerTitulo(html, titulo);
      html = ponerMetaNombre(html, 'description', descripcion);
      html = ponerCanonical(html, url);
      html = ponerMetaPropiedad(html, 'og:type', 'product');
      html = ponerMetaPropiedad(html, 'og:title', `${p.name} ${medida} — ${marca}`);
      html = ponerMetaPropiedad(html, 'og:description', descripcion);
      html = ponerMetaPropiedad(html, 'og:image', imagen);
      html = ponerMetaPropiedad(html, 'og:url', url);
      html = ponerMetaPropiedad(html, 'og:locale', 'es_CO');
      html = ponerMetaNombre(html, 'twitter:card', 'summary_large_image');

      const disponible = p.stock_status === 'agotado'
        ? 'https://schema.org/OutOfStock'
        : p.stock_status === 'pre-orden'
          ? 'https://schema.org/PreOrder'
          : 'https://schema.org/InStock';

      const datos = {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: `${p.name} ${medida}`,
        sku: p.sku,
        description: descripcion,
        image: imagenes.length ? imagenes.map(i => absoluta(base, i)) : [imagen],
        brand: { '@type': 'Brand', name: marca },
        offers: {
          '@type': 'Offer',
          url,
          priceCurrency: 'COP',
          price: String(p.price_detal),
          availability: disponible,
          itemCondition: 'https://schema.org/NewCondition',
          seller: { '@type': 'Organization', name: 'Cautiva Essences' }
        }
      };
      if (p.category_name_es) datos.category = p.category_name_es;

      // Las estrellas solo se le muestran a Google si de verdad hay reseñas aprobadas.
      if (p.rating_count > 0 && p.rating_avg) {
        datos.aggregateRating = {
          '@type': 'AggregateRating',
          ratingValue: String(p.rating_avg),
          reviewCount: String(p.rating_count)
        };
      }

      html = agregarJsonLd(html, datos);
      res.type('html').send(absolutizarImagenes(html, base));
    } catch (err) {
      console.error('SEO: no se pudo armar la ficha de producto -', err.message);
      next(); // ante cualquier problema, la página se sirve normal
    }
  };
}

module.exports = { baseUrl, absoluta, esc, paginaEstatica, paginaProducto };
