// server/utils/invoice.js
// Genera la factura en PDF de un pedido usando PDFKit.
//
// El PDF se arma COMPLETO en memoria antes de enviarlo. Así, si algo falla
// mientras se dibuja, se responde con un error limpio en vez de dejar la
// petición colgada (que es lo que producía el "Application failed to respond").

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { formatCOP } = require('./whatsapp');

const LOGO_PATH = path.join(__dirname, '..', '..', 'public', 'img', 'logo.jpg');
const GOLD = '#D4AF37';
const CARBON = '#0D0F12';
const STORE = 'CAUTIVA ESSENCES';

// Nunca devuelve undefined: PDFKit lanza excepción si le pasas algo que no sea texto.
function txt(valor, porDefecto = '') {
  if (valor === null || valor === undefined) return porDefecto;
  return String(valor);
}

// Nunca lanza, aunque el valor venga nulo, vacío o no numérico.
function money(valor) {
  const n = Number(valor);
  try {
    return formatCOP(Number.isFinite(n) ? n : 0);
  } catch (_) {
    return '$0';
  }
}

function generateInvoicePDF({ order, items }, res) {
  const pedido = order || {};
  const lineas = Array.isArray(items) ? items : [];
  const referencia = txt(pedido.reference, 'SIN-REFERENCIA');

  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  const chunks = [];
  let terminado = false;

  function fallar(err, donde) {
    if (terminado) return;
    terminado = true;
    console.error(`Error generando la factura ${referencia} (${donde}):`, err && err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'No se pudo generar la factura de este pedido.' });
    } else {
      try { res.end(); } catch (_) { }
    }
  }

  doc.on('data', (c) => chunks.push(c));

  doc.on('end', () => {
    if (terminado) return;
    terminado = true;
    const pdf = Buffer.concat(chunks);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=factura-${referencia}.pdf`);
    res.setHeader('Content-Length', pdf.length);
    res.end(pdf);
  });

  doc.on('error', (err) => fallar(err, 'stream'));

  try {
    // --- Encabezado con logo ---
    // PDFKit solo acepta JPEG baseline y PNG. Si el logo tiene otro formato
    // (JPEG progresivo, WebP renombrado), seguimos sin logo en vez de romper.
    let logoOk = false;
    if (fs.existsSync(LOGO_PATH)) {
      try {
        doc.image(LOGO_PATH, 50, 45, { width: 70 });
        logoOk = true;
      } catch (err) {
        console.warn('No se pudo incluir el logo en la factura (formato no soportado por PDFKit):', err.message);
      }
    }

    const headerX = logoOk ? 130 : 50;
    doc.fontSize(20).fillColor(CARBON).text(STORE, headerX, 50);
    doc.fontSize(9).fillColor('#555').text('Tu firma invisible', headerX, 75);
    doc.fontSize(9).fillColor('#555').text('Rionegro, Antioquia, Colombia · WhatsApp: +57 319 681 2111', headerX, 88);

    doc.moveDown(3);
    doc.fillColor(GOLD).fontSize(14).text(`Factura de venta — ${referencia}`, { align: 'right' });

    const fecha = pedido.created_at ? new Date(pedido.created_at) : new Date();
    const fechaTexto = isNaN(fecha.getTime()) ? '—' : fecha.toLocaleDateString('es-CO');
    doc.fillColor('#333').fontSize(10).text(`Fecha: ${fechaTexto}`, { align: 'right' });

    doc.moveDown(1.5);
    doc.strokeColor(GOLD).lineWidth(1).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(1);

    // --- Datos del cliente ---
    doc.fillColor(CARBON).fontSize(11).text('Datos del cliente');
    doc.fillColor('#333').fontSize(10);
    doc.text(`Nombre: ${txt(pedido.customer_name, '—')}`);
    doc.text(`Teléfono: ${txt(pedido.customer_phone, '—')}`);
    if (pedido.customer_email) doc.text(`Correo: ${txt(pedido.customer_email)}`);
    if (pedido.customer_address) {
      doc.text(`Dirección: ${txt(pedido.customer_address)}, ${txt(pedido.customer_city)}`);
    }
    doc.moveDown(1);

    // --- Tabla de productos ---
    const tableTop = doc.y;
    doc.fontSize(10);
    doc.rect(50, tableTop, 495, 20).fill(CARBON);
    doc.fillColor('#fff').text('Producto', 58, tableTop + 5);
    doc.text('Cant.', 330, tableTop + 5);
    doc.text('Precio unit.', 390, tableTop + 5);
    doc.text('Total', 480, tableTop + 5);

    let y = tableTop + 25;
    doc.fillColor('#333');

    if (lineas.length === 0) {
      doc.text('Este pedido no tiene productos registrados.', 58, y, { width: 480 });
      y += 22;
    }

    for (const it of lineas) {
      // Salto de página si nos quedamos sin espacio
      if (y > doc.page.height - 160) {
        doc.addPage();
        y = 60;
      }

      const cantidad = Number(it.qty ?? it.quantity ?? 1) || 1;
      const unitario = it.unit_price ?? it.price ?? 0;
      const total = it.line_total ?? (Number(unitario) || 0) * cantidad;

      doc.text(txt(it.product_name || it.name, 'Producto'), 58, y, { width: 260 });
      doc.text(String(cantidad), 330, y);
      doc.text(money(unitario), 390, y);
      doc.text(money(total), 480, y);
      y += 22;
    }

    y += 10;
    doc.strokeColor('#ddd').moveTo(50, y).lineTo(545, y).stroke();
    y += 10;

    doc.fontSize(10).fillColor('#333');
    doc.text('Subtotal:', 390, y); doc.text(money(pedido.subtotal), 480, y); y += 18;
    doc.text('Envío:', 390, y); doc.text(money(pedido.shipping_cost), 480, y); y += 18;
    doc.fontSize(12).fillColor(GOLD).text('Total:', 390, y);
    doc.text(money(pedido.total), 480, y);

    doc.fontSize(8).fillColor('#888').text(
      'Cautiva Essences · Perfumería fina · Rionegro, Antioquia, Colombia · Esta factura es un comprobante de venta electrónico.',
      50, doc.page.height - 80, { align: 'center', width: 495 }
    );

    doc.end();
  } catch (err) {
    fallar(err, 'dibujado');
  }
}

module.exports = { generateInvoicePDF };
