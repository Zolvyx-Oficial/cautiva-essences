// server/routes/wompi.js
// Webhook de eventos de WOMPI: actualiza el estado de pago del pedido.
// Documentación: https://docs.wompi.co/docs/colombia/eventos/

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../db');

function verifyChecksum(event, secret) {
  const props = event.signature.properties; // ej: ["transaction.id","transaction.status","transaction.amount_in_cents"]
  let concat = '';
  for (const propPath of props) {
    const value = propPath.split('.').reduce((acc, key) => acc?.[key], event.data);
    concat += value;
  }
  concat += event.timestamp + secret;
  const hash = crypto.createHash('sha256').update(concat).digest('hex');
  return hash === event.signature.checksum;
}

// POST /wompi/webhook
router.post('/webhook', express.json({ type: '*/*' }), (req, res) => {
  const event = req.body;
  try {
    if (!event?.signature || !verifyChecksum(event, process.env.WOMPI_EVENTS_SECRET)) {
      return res.status(401).json({ error: 'Firma de evento inválida.' });
    }
    const tx = event.data.transaction;
    const statusMap = { APPROVED: 'aprobada', DECLINED: 'rechazada', VOIDED: 'rechazada', ERROR: 'rechazada' };
    const paymentStatus = statusMap[tx.status] || 'pendiente';

    db.prepare(`
      UPDATE orders SET payment_status = ?, payment_method = ?, wompi_transaction_id = ?
      WHERE reference = ?
    `).run(paymentStatus, tx.payment_method_type || null, tx.id, tx.reference);

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('Error procesando webhook WOMPI:', err.message);
    res.status(500).json({ error: 'Error interno procesando el evento.' });
  }
});

module.exports = router;
