// compress-images.js
// Comprime las fotos de producto que ya están subidas, SIN cambiarles el nombre
// ni la extensión, para que las rutas guardadas en la base de datos sigan sirviendo.
//
// Uso:
//   node compress-images.js                      -> simulacro, no toca nada
//   node compress-images.js --apply --limit 3    -> comprime solo 3 (prueba)
//   node compress-images.js --apply              -> comprime todas
//
// Seguridad:
//   - Por defecto NO escribe nada. Hay que pasar --apply a propósito.
//   - Cada archivo se comprime a un temporal, se VERIFICA que abra bien,
//     y solo entonces reemplaza al original con un rename atómico.
//   - Si algo falla en un archivo, se salta y el original queda intacto.
//   - Si el resultado no ahorra al menos un 10%, se descarta y no se toca.
//   - Nunca cambia el nombre del archivo, así que la base de datos no se entera.

const fs = require('fs');
const path = require('path');

let sharp;
try {
  sharp = require('sharp');
} catch (e) {
  console.error('\nFalta la librería "sharp". Instálala con:\n  npm install sharp\n');
  process.exit(1);
}

// ---------- Configuración ----------
const DIR = path.join(__dirname, 'data', 'products');
const MAX_DIM = 1400;        // lado máximo en píxeles (de sobra para la tienda)
const CALIDAD_JPEG = 82;
const CALIDAD_WEBP = 82;
const MIN_BYTES = 250 * 1024; // archivos de menos de 250 KB ni se tocan
const AHORRO_MINIMO = 0.10;   // si no ahorra al menos 10%, se descarta

const EXTENSIONES = new Set(['.jpg', '.jpeg', '.png', '.webp']);

// ---------- Argumentos ----------
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const idxLimit = args.indexOf('--limit');
const LIMIT = idxLimit !== -1 ? parseInt(args[idxLimit + 1], 10) : Infinity;

function mb(bytes) { return (bytes / 1024 / 1024).toFixed(2) + ' MB'; }

async function comprimirUno(archivo) {
  const ruta = path.join(DIR, archivo);
  const ext = path.extname(archivo).toLowerCase();
  const statOriginal = fs.statSync(ruta);
  const tamOriginal = statOriginal.size;

  if (tamOriginal < MIN_BYTES) {
    return { archivo, estado: 'omitido', motivo: 'ya es pequeño', tamOriginal, tamNuevo: tamOriginal };
  }

  // 1. Comprimir en memoria
  let pipeline = sharp(ruta, { failOn: 'error' })
    .rotate() // respeta la orientación de la foto del celular
    .resize({ width: MAX_DIM, height: MAX_DIM, fit: 'inside', withoutEnlargement: true });

  if (ext === '.png') {
    pipeline = pipeline.png({ compressionLevel: 9 });
  } else if (ext === '.webp') {
    pipeline = pipeline.webp({ quality: CALIDAD_WEBP });
  } else {
    pipeline = pipeline.jpeg({ quality: CALIDAD_JPEG, mozjpeg: true });
  }

  const buffer = await pipeline.toBuffer();
  const tamNuevo = buffer.length;

  // 2. ¿Vale la pena?
  if (tamNuevo > tamOriginal * (1 - AHORRO_MINIMO)) {
    return { archivo, estado: 'omitido', motivo: 'no ahorra lo suficiente', tamOriginal, tamNuevo };
  }

  // 3. Verificar que el resultado es una imagen válida ANTES de tocar el original
  const meta = await sharp(buffer).metadata();
  if (!meta.width || !meta.height || meta.width < 10 || meta.height < 10) {
    return { archivo, estado: 'error', motivo: 'el resultado no es una imagen válida', tamOriginal, tamNuevo };
  }

  if (!APPLY) {
    return { archivo, estado: 'simulado', tamOriginal, tamNuevo };
  }

  // 4. Escribir temporal, forzar a disco, y reemplazar de forma atómica
  const tmp = ruta + '.tmp-compress';
  try {
    const fd = fs.openSync(tmp, 'w');
    fs.writeSync(fd, buffer);
    fs.fsyncSync(fd);   // garantiza que quedó escrito en disco
    fs.closeSync(fd);

    // Releer el temporal desde disco y confirmar que abre bien
    const verif = await sharp(tmp).metadata();
    if (!verif.width || !verif.height) throw new Error('el temporal no se pudo leer');

    fs.renameSync(tmp, ruta); // atómico: o está el viejo, o está el nuevo. Nunca a medias.
    return { archivo, estado: 'comprimido', tamOriginal, tamNuevo };
  } catch (err) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) { }
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

  const archivos = todos.slice(0, LIMIT === Infinity ? todos.length : LIMIT);

  console.log('');
  console.log('Carpeta:', DIR);
  console.log('Imágenes encontradas:', todos.length, LIMIT !== Infinity ? `(procesando solo ${archivos.length})` : '');
  console.log('Modo:', APPLY ? '*** APLICANDO CAMBIOS ***' : 'SIMULACRO (no se toca nada)');
  console.log('');

  let totalAntes = 0, totalDespues = 0;
  let comprimidas = 0, omitidas = 0, errores = 0;

  for (const archivo of archivos) {
    let r;
    try {
      r = await comprimirUno(archivo);
    } catch (err) {
      r = { archivo, estado: 'error', motivo: err.message, tamOriginal: 0, tamNuevo: 0 };
    }

    totalAntes += r.tamOriginal;
    totalDespues += (r.estado === 'comprimido' || r.estado === 'simulado') ? r.tamNuevo : r.tamOriginal;

    if (r.estado === 'comprimido' || r.estado === 'simulado') {
      comprimidas++;
      const pct = Math.round((1 - r.tamNuevo / r.tamOriginal) * 100);
      console.log(`  ${r.estado === 'simulado' ? '[sim]' : '[ok ]'} ${r.archivo}  ${mb(r.tamOriginal)} -> ${mb(r.tamNuevo)}  (-${pct}%)`);
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
  console.log('Comprimidas:', comprimidas, '| Omitidas:', omitidas, '| Errores:', errores);
  console.log('Antes:  ', mb(totalAntes));
  console.log('Después:', mb(totalDespues));
  const ahorro = totalAntes - totalDespues;
  console.log('Ahorro: ', mb(ahorro), totalAntes > 0 ? `(${Math.round(ahorro / totalAntes * 100)}%)` : '');
  console.log('-----------------------------------------');

  if (!APPLY) {
    console.log('');
    console.log('Esto fue un SIMULACRO. No se modificó ningún archivo.');
    console.log('Para aplicarlo de verdad:  node compress-images.js --apply');
  }
  console.log('');
}

main().catch(err => {
  console.error('Error general:', err.message);
  process.exit(1);
});
