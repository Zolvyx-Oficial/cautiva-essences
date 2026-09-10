// server/utils/invoice.js
// Genera la factura en PDF de un pedido usando PDFKit.

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { formatCOP } = require('./whatsapp');

const LOGO_PATH = path.join(__dirname, '..', '..', 'public', 'img', 'logo.jpg');
const GOLD = '#D4AF37';
const CARBON = '#0D0F12';

function generateInvoicePDF({ order, items }, res) {
  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=factura-${order.reference}.pdf`);
  doc.pipe(res);

  // --- Encabezado con logo ---
  if (fs.existsSync(LOGO_PATH)) {
    doc.image(LOGO_PATH, 50, 45, { width: 70 });
    doc.fontSize(20).fillColor(CARBON).text('ESSENZA STUDIO', 130, 50);
  } else {
    doc.fontSize(20).fillColor(CARBON).text('ESSENZA STUDIO', 50, 50);
  }
  doc.fontSize(9).fillColor('#555').text('Tu firma invisible', 130, 75);
  doc.fontSize(9).fillColor('#555').text('Rionegro, Antioquia, Colombia · WhatsApp: +57 319 681 2111', 130, 88);

  doc.moveDown(3);
  doc.fillColor(GOLD).fontSize(14).text(`Factura de venta — ${order.reference}`, { align: 'right' });
  doc.fillColor('#333').fontSize(10).text(`Fecha: ${new Date(order.created_at || Date.now()).toLocaleDateString('es-CO')}`, { align: 'right' });

  doc.moveDown(1.5);
  doc.strokeColor(GOLD).lineWidth(1).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
  doc.moveDown(1);

  // --- Datos del cliente ---
  doc.fillColor(CARBON).fontSize(11).text('Datos del cliente', { underline: false });
  doc.fillColor('#333').fontSize(10);
  doc.text(`Nombre: ${order.customer_name}`);
  doc.text(`Teléfono: ${order.customer_phone}`);
  if (order.customer_email) doc.text(`Correo: ${order.customer_email}`);
  if (order.customer_address) doc.text(`Dirección: ${order.customer_address}, ${order.customer_city || ''}`);
  doc.moveDown(1);

  // --- Tabla de productos ---
  const tableTop = doc.y;
  doc.fontSize(10).fillColor('#fff');
  doc.rect(50, tableTop, 495, 20).fill(CARBON);
  doc.fillColor('#fff').text('Producto', 58, tableTop + 5);
  doc.text('Cant.', 330, tableTop + 5);
  doc.text('Precio unit.', 390, tableTop + 5);
  doc.text('Total', 480, tableTop + 5);

  let y = tableTop + 25;
  doc.fillColor('#333');
  for (const it of items) {
    doc.text(it.product_name, 58, y, { width: 260 });
    doc.text(String(it.qty), 330, y);
    doc.text(formatCOP(it.unit_price), 390, y);
    doc.text(formatCOP(it.line_total), 480, y);
    y += 22;
  }

  y += 10;
  doc.strokeColor('#ddd').moveTo(50, y).lineTo(545, y).stroke();
  y += 10;

  doc.fontSize(10);
  doc.text('Subtotal:', 390, y); doc.text(formatCOP(order.subtotal), 480, y); y += 18;
  doc.text('Envío:', 390, y); doc.text(formatCOP(order.shipping_cost), 480, y); y += 18;
  doc.fontSize(12).fillColor(GOLD).text('Total:', 390, y);
  doc.text(formatCOP(order.total), 480, y);

  doc.moveDown(4);
  doc.fontSize(8).fillColor('#888').text(
    'Essenza Studio · Perfumería fina · Rionegro, Antioquia, Colombia · Esta factura es un comprobante de venta electrónico.',
    50, doc.page.height - 80, { align: 'center', width: 495 }
  );

  doc.end();
}

module.exports = { generateInvoicePDF };
