// compress-images.js
// Optimiza las fotos de producto que ya están subidas.
//
// La mayoría son PNG (capturas de pantalla). PNG es un formato para gráficos,
// no para fotos: una foto de perfume en PNG pesa ~2 MB y esa misma en JPEG pesa
// ~180 KB viéndose igual. Por eso el script, además de redimensionar, CONVIERTE
// a JPEG — y actualiza las rutas en la base de datos para que nada se pierda.
//
// Uso:
//   node compress-images.js                      -> simulacro, no toca nada
//   node compress-images.js --apply --limit 3    -> procesa solo 3 (prueba)
//   node compress-images.js --apply              -> procesa todas
//   node compress-images.js --apply --sin-convertir   -> comprime pero NO cambia PNG a JPEG
//
// Seguridad:
//   - Por defecto NO escribe nada. Hay que pasar --apply a propósito.
//   - El archivo nuevo se escribe, se RELEE desde disco y se verifica que abra
//     bien ANTES de tocar la base de datos o borrar el original.
//   - Orden al convertir: escribir nuevo -> verificar -> actualizar base de datos
//     -> borrar viejo. Si algo falla antes del último paso, se deshace y el
//     original queda intacto y referenciado.
//   - Si el resultado no ahorra al menos un 10%, se descarta.
//   - Las imágenes con transparencia se aplanan sobre blanco (y se avisa).

const fs = require('fs');
const path = require('path');

let sharp, db;
try {
  sharp = require('sharp');
} catch (e) {
  console.error('\nFalta la librería "sharp". Instálala con:\n  npm install sharp\n');
  process.exit(1);
}
try {
  const Database = require('better-sqlite3');
  db = new Database(path.join(__dirname, 'data', 'essenza.db'));
} catch (e) {
  console.error('\nNo se pudo abrir la base de datos:', e.message, '\n');
  process.exit(1);
}

// ---------- Configuración ----------
const DIR = path.join(__dirname, 'data', 'products');
const MAX_DIM = 1400;
const CALIDAD_JPEG = 82;
const CALIDAD_WEBP = 82;
const MIN_BYTES = 120 * 1024;
const AHORRO_MINIMO = 0.10;

const EXTENSIONES = new Set(['.jpg', '.jpeg', '.png', '.webp']);

// ---------- Argumentos ----------
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const SIN_CONVERTIR = args.includes('--sin-convertir');
const idxLimit = args.indexOf('--limit');
const LIMIT = idxLimit !== -1 ? parseInt(args[idxLimit + 1], 10) : Infinity;

function mb(bytes) { return (bytes / 1024 / 1024).toFixed(2) + ' MB'; }

// ---------- Base de datos ----------
// Cambia la ruta vieja por la nueva en la galería de todos los productos.
// Devuelve cuántos productos se actualizaron.
function actualizarRutaEnBase(rutaVieja, rutaNueva) {
  const filas = db.prepare('SELECT id, images FROM products').all();
  const actualizar = db.prepare('UPDATE products SET images = ? WHERE id = ?');
  let tocados = 0;

  const tx = db.transaction(() => {
    for (const f of filas) {
      let lista;
      try { lista = JSON.parse(f.images || '[]'); } catch (_) { continue; }
      if (!Array.isArray(lista) || lista.indexOf(rutaVieja) === -1) continue;
      const nueva = lista.map(r => (r === rutaVieja ? rutaNueva : r));
      actualizar.run(JSON.stringify(nueva), f.id);
      tocados++;
    }
  });
  tx();
  return tocados;
}

function estaReferenciada(ruta) {
  const filas = db.prepare('SELECT images FROM products').all();
  for (const f of filas) {
    try {
      const lista = JSON.parse(f.images || '[]');
      if (Array.isArray(lista) && lista.indexOf(ruta) !== -1) return true;
    } catch (_) { }
  }
  return false;
}

// ---------- Procesamiento de una imagen ----------
async function procesarUno(archivo) {
  const ruta = path.join(DIR, archivo);
  const ext = path.extname(archivo).toLowerCase();
  const tamOriginal = fs.statSync(ruta).size;

  if (tamOriginal < MIN_BYTES) {
    return { archivo, estado: 'omitido', motivo: 'ya es pequeño', tamOriginal, tamNuevo: tamOriginal };
  }

  const meta = await sharp(ruta).metadata();
  const tieneAlfa = !!meta.hasAlpha;

  // ¿A qué formato sale?
  let extDestino;
  if (ext === '.webp') extDestino = '.webp';
  else if (ext === '.png') extDestino = SIN_CONVERTIR ? '.png' : '.jpeg';
  else extDestino = '.jpeg';

  let pipeline = sharp(ruta, { failOn: 'error' })
    .rotate()
    .resize({ width: MAX_DIM, height: MAX_DIM, fit: 'inside', withoutEnlargement: true });

  if (extDestino === '.jpeg' && tieneAlfa) {
    // JPEG no tiene transparencia: se aplana sobre blanco
    pipeline = pipeline.flatten({ background: '#ffffff' });
  }

  if (extDestino === '.png') pipeline = pipeline.png({ compressionLevel: 9 });
  else if (extDestino === '.webp') pipeline = pipeline.webp({ quality: CALIDAD_WEBP });
  else pipeline = pipeline.jpeg({ quality: CALIDAD_JPEG, mozjpeg: true });

  const buffer = await pipeline.toBuffer();
  const tamNuevo = buffer.length;

  if (tamNuevo > tamOriginal * (1 - AHORRO_MINIMO)) {
    return { archivo, estado: 'omitido', motivo: 'no ahorra lo suficiente', tamOriginal, tamNuevo };
  }

  const verif = await sharp(buffer).metadata();
  if (!verif.width || !verif.height) {
    return { archivo, estado: 'error', motivo: 'el resultado no es una imagen válida', tamOriginal, tamNuevo };
  }

  const convierte = extDestino !== ext;
  const archivoNuevo = convierte ? path.parse(archivo).name + extDestino : archivo;

  if (!APPLY) {
    return { archivo, estado: 'simulado', convierte, tieneAlfa, archivoNuevo, tamOriginal, tamNuevo };
  }

  // ----- Caso 1: mismo nombre (no cambia la extensión) -> reemplazo atómico -----
  if (!convierte) {
    const tmp = ruta + '.tmp-compress';
    try {
      const fd = fs.openSync(tmp, 'w');
      fs.writeSync(fd, buffer); fs.fsyncSync(fd); fs.closeSync(fd);
      const v = await sharp(tmp).metadata();
      if (!v.width) throw new Error('el temporal no se pudo leer');
      fs.renameSync(tmp, ruta);
      return { archivo, estado: 'comprimido', convierte: false, tieneAlfa, archivoNuevo, tamOriginal, tamNuevo };
    } catch (err) {
      try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) { }
      return { archivo, estado: 'error', motivo: err.message, tamOriginal, tamNuevo };
    }
  }

  // ----- Caso 2: cambia la extensión -> escribir, verificar, base de datos, borrar -----
  const rutaNuevaDisco = path.join(DIR, archivoNuevo);
  const rutaVieja = `/img/products/${archivo}`;
  const rutaNueva = `/img/products/${archivoNuevo}`;

  if (fs.existsSync(rutaNuevaDisco)) {
    return { archivo, estado: 'omitido', motivo: 'ya existe un archivo con ese nombre', tamOriginal, tamNuevo };
  }

  let escrito = false;
  try {
    const fd = fs.openSync(rutaNuevaDisco, 'w');
    fs.writeSync(fd, buffer); fs.fsyncSync(fd); fs.closeSync(fd);
    escrito = true;

    // Releer desde disco: si esto pasa, el archivo nuevo sirve
    const v = await sharp(rutaNuevaDisco).metadata();
    if (!v.width || !v.height) throw new Error('el archivo nuevo no se pudo leer desde disco');

    const referenciada = estaReferenciada(rutaVieja);
    const tocados = referenciada ? actualizarRutaEnBase(rutaVieja, rutaNueva) : 0;

    if (referenciada && tocados === 0) {
      throw new Error('no se pudo actualizar la base de datos');
    }

    // Solo ahora se borra el original
    fs.unlinkSync(ruta);

    return {
      archivo, estado: 'convertido', convierte: true, tieneAlfa, archivoNuevo,
      tamOriginal, tamNuevo, productos: tocados, huerfana: !referenciada
    };
  } catch (err) {
    // Deshacer: borrar el archivo nuevo. El original y la base quedan como estaban.
    try { if (escrito && fs.existsSync(rutaNuevaDisco)) fs.unlinkSync(rutaNuevaDisco); } catch (_) { }
    return { archivo, estado: 'error', motivo: err.message, tamOriginal, tamNuevo };
  }
}

async function main() {
  if (!fs.existsSync(DIR)) {
    console.error('No existe la carpeta de fotos:', DIR);
    process.exit(1);
  }

  const todos = fs.readdirSync(DIR)
    .filter(f => EXTENSIONES.has(path.extname(f).toLowerCase()))
    .filter(f => !f.endsWith('.tmp-compress'));

  const archivos = LIMIT === Infinity ? todos : todos.slice(0, LIMIT);

  console.log('');
  console.log('Carpeta:', DIR);
  console.log('Imágenes encontradas:', todos.length, LIMIT !== Infinity ? `(procesando solo ${archivos.length})` : '');
  console.log('Convertir PNG a JPEG:', SIN_CONVERTIR ? 'NO' : 'SÍ');
  console.log('Modo:', APPLY ? '*** APLICANDO CAMBIOS ***' : 'SIMULACRO (no se toca nada)');
  console.log('');

  let totalAntes = 0, totalDespues = 0;
  let hechas = 0, omitidas = 0, errores = 0, convertidas = 0, aplanadas = 0, huerfanas = 0;

  for (const archivo of archivos) {
    let r;
    try {
      r = await procesarUno(archivo);
    } catch (err) {
      r = { archivo, estado: 'error', motivo: err.message, tamOriginal: 0, tamNuevo: 0 };
    }

    totalAntes += r.tamOriginal;
    const cambio = ['comprimido', 'convertido', 'simulado'].includes(r.estado);
    totalDespues += cambio ? r.tamNuevo : r.tamOriginal;

    if (cambio) {
      hechas++;
      if (r.convierte) convertidas++;
      if (r.tieneAlfa && r.convierte) aplanadas++;
      if (r.huerfana) huerfanas++;
      const pct = Math.round((1 - r.tamNuevo / r.tamOriginal) * 100);
      const etiqueta = r.estado === 'simulado' ? '[sim]' : '[ok ]';
      const flecha = r.convierte ? ` -> ${r.archivoNuevo}` : '';
      const nota = r.tieneAlfa && r.convierte ? ' (tenía transparencia, se aplanó sobre blanco)' : '';
      console.log(`  ${etiqueta} ${r.archivo}${flecha}  ${mb(r.tamOriginal)} -> ${mb(r.tamNuevo)}  (-${pct}%)${nota}`);
    } else if (r.estado === 'omitido') {
      omitidas++;
      console.log(`  [--- ] ${r.archivo}  (${r.motivo})`);
    } else {
      errores++;
      console.log(`  [ERR] ${r.archivo}  ${r.motivo}  <- el original NO se tocó`);
    }
  }

  console.log('');
  console.log('-----------------------------------------');
  console.log('Procesadas:', hechas, '| Convertidas a JPEG:', convertidas, '| Omitidas:', omitidas, '| Errores:', errores);
  if (aplanadas) console.log('Con transparencia aplanada sobre blanco:', aplanadas, '<- revísalas en la tienda');
  if (huerfanas) console.log('Archivos que no estaban en ningún producto:', huerfanas);
  console.log('Antes:  ', mb(totalAntes));
  console.log('Después:', mb(totalDespues));
  const ahorro = totalAntes - totalDespues;
  console.log('Ahorro: ', mb(ahorro), totalAntes > 0 ? `(${Math.round(ahorro / totalAntes * 100)}%)` : '');
  console.log('-----------------------------------------');

  if (!APPLY) {
    console.log('');
    console.log('Esto fue un SIMULACRO. No se modificó ningún archivo ni la base de datos.');
    console.log('Para aplicarlo de verdad:  node compress-images.js --apply');
  }
  console.log('');
}

main()
  .catch(err => { console.error('Error general:', err.message); process.exit(1); })
  .finally(() => { try { db.close(); } catch (_) { } });
