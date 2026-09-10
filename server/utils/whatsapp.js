// server/utils/whatsapp.js
// Genera el enlace wa.me con el resumen del pedido formateado para el WhatsApp de ventas.

function formatCOP(value) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value);
}

function buildOrderWhatsAppLink({ salesNumber, order, items }) {
  const lines = [];
  lines.push(`*Nuevo pedido Essenza Studio*`);
  lines.push(`Referencia: ${order.reference}`);
  lines.push(`Cliente: ${order.customer_name}`);
  lines.push(`Teléfono: ${order.customer_phone}`);
  if (order.customer_address) lines.push(`Dirección: ${order.customer_address}, ${order.customer_city || ''}`);
  lines.push('');
  lines.push('*Productos:*');
  for (const it of items) {
    lines.push(`• ${it.qty} x ${it.product_name} — ${formatCOP(it.line_total)}`);
  }
  lines.push('');
  lines.push(`Subtotal: ${formatCOP(order.subtotal)}`);
  lines.push(`Envío: ${formatCOP(order.shipping_cost)}`);
  lines.push(`*Total: ${formatCOP(order.total)}*`);
  lines.push('');
  lines.push(`Estado de pago: ${order.payment_status}`);

  const text = encodeURIComponent(lines.join('\n'));
  return `https://wa.me/${salesNumber}?text=${text}`;
}

module.exports = { buildOrderWhatsAppLink, formatCOP };
