// server/utils/email.js
// Envío de notificaciones por correo (nuevo pedido / pago aprobado / recuperar contraseña) usando Resend.

const { Resend } = require('resend');
const { formatCOP } = require('./whatsapp');

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

function emailDisponible() {
  if (!resend) {
    console.warn('RESEND_API_KEY no configurada: se omite el envio de correo.');
    return false;
  }
  return true;
}

function buildOrderHtml({ order, items, title }) {
  const rows = items.map(it =>
    `<tr><td>${it.qty} x ${it.product_name}</td><td style="text-align:right">${formatCOP(it.line_total)}</td></tr>`
  ).join('');

  return `
    <div style="font-family:sans-serif;max-width:480px">
      <h2>${title}</h2>
      <p><strong>Referencia:</strong> ${order.reference}</p>
      <p><strong>Cliente:</strong> ${order.customer_name} — ${order.customer_phone}</p>
      ${order.customer_address ? `<p><strong>Dirección:</strong> ${order.customer_address}, ${order.customer_city || ''}</p>` : ''}
      <table style="width:100%;border-collapse:collapse;margin-top:12px">
        ${rows}
      </table>
      <hr>
      <p>Subtotal: ${formatCOP(order.subtotal)}</p>
      <p>Envío: ${formatCOP(order.shipping_cost)}</p>
      <p><strong>Total: ${formatCOP(order.total)}</strong></p>
      <p>Estado de pago: <strong>${order.payment_status}</strong></p>
    </div>`;
}

async function notifyNewOrder({ order, items }) {
  try {
    if (!emailDisponible()) return;
    await resend.emails.send({
      from: 'Cautiva Essences <onboarding@resend.dev>',
      to: process.env.ADMIN_NOTIFICATION_EMAIL,
      subject: `🛍️ Nuevo pedido: ${order.reference}`,
      html: buildOrderHtml({ order, items, title: 'Nuevo pedido recibido' })
    });
  } catch (err) {
    console.error('Error enviando correo de nuevo pedido:', err.message);
  }
}

async function notifyPaymentApproved({ order, items }) {
  try {
    if (!emailDisponible()) return;
    await resend.emails.send({
      from: 'Cautiva Essences <onboarding@resend.dev>',
      to: process.env.ADMIN_NOTIFICATION_EMAIL,
      subject: `✅ Pago aprobado: ${order.reference}`,
      html: buildOrderHtml({ order, items, title: 'Pago aprobado' })
    });
  } catch (err) {
    console.error('Error enviando correo de pago aprobado:', err.message);
  }
}

async function sendPasswordResetEmail({ email, resetUrl }) {
  try {
    if (!emailDisponible()) return;
    await resend.emails.send({
      from: 'Cautiva Essences <onboarding@resend.dev>',
      to: email,
      subject: '🔑 Recuperar contraseña — Cautiva Essences Admin',
      html: `
        <div style="font-family:sans-serif;max-width:480px">
          <h2>Recuperar contraseña</h2>
          <p>Recibimos una solicitud para restablecer la contraseña de tu panel admin.</p>
          <p><a href="${resetUrl}" style="background:#D4AF37;color:#0D0F12;padding:12px 24px;text-decoration:none;border-radius:4px;display:inline-block;font-weight:bold">Crear nueva contraseña</a></p>
          <p style="color:#888;font-size:13px">Este enlace expira en 30 minutos. Si no solicitaste esto, ignora este correo.</p>
        </div>`
    });
  } catch (err) {
    console.error('Error enviando correo de recuperación:', err.message);
  }
}

module.exports = { notifyNewOrder, notifyPaymentApproved, sendPasswordResetEmail };