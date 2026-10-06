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

  // Comparación en tiempo constante, para no filtrar información por el tiempo de respuesta
  const a = Buffer.from(hash, 'utf8');
  const b = Buffer.from(String(event.signature.checksum || ''), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const ESTADOS = { APPROVED: 'aprobada', DECLINED: 'rechazada', VOIDED: 'rechazada', ERROR: 'rechazada' };

/**
 * Decide si el estado que llega debe reemplazar al que ya tiene el pedido.
 * WOMPI reenvía el mismo evento varias veces y no siempre en orden, así que sin
 * esto un evento tardío podía devolver un pedido "entregada" a "pendiente".
 */
function sePuedeActualizar(actual, nuevo) {
  if (actual === nuevo) return false;
  // Un pedido ya entregado no lo mueve ningún webhook: eso lo maneja Diana a mano.
  if (actual === 'entregada') return false;
  // Nunca se retrocede a pendiente.
  if (nuevo === 'pendiente') return false;
  return true;
}

// POST /wompi/webhook
router.post('/webhook', express.json({ type: '*/*' }), (req, res) => {
  const event = req.body;
  try {
    if (!event?.signature || !verifyChecksum(event, process.env.WOMPI_EVENTS_SECRET)) {
      return res.status(401).json({ error: 'Firma de evento inválida.' });
    }

    const tx = event?.data?.transaction;
    if (!tx?.reference) {
      return res.status(400).json({ error: 'Evento sin referencia de pedido.' });
    }

    const order = db.prepare('SELECT * FROM orders WHERE reference = ?').get(tx.reference);
    if (!order) {
      // Respondemos 200 para que WOMPI no reintente eternamente un pedido que no es nuestro.
      console.warn('Webhook WOMPI para una referencia desconocida:', tx.reference);
      return res.status(200).json({ received: true, ignored: 'referencia desconocida' });
    }

    const nuevoEstado = ESTADOS[tx.status];
    if (!nuevoEstado) {
      console.warn('Webhook WOMPI con estado no reconocido:', tx.status, 'ref:', tx.reference);
      return res.status(200).json({ received: true, ignored: 'estado no reconocido' });
    }

    // Si dice que fue aprobado, el monto cobrado tiene que coincidir con el del pedido.
    if (nuevoEstado === 'aprobada') {
      const esperado = order.total * 100;
      const cobrado = Number(tx.amount_in_cents);
      const moneda = tx.currency || 'COP';

      if (cobrado !== esperado || moneda !== 'COP') {
        console.error(
          `ALERTA: el monto del pago no coincide con el pedido ${tx.reference}.`,
          `Esperado: ${esperado} COP centavos. Recibido: ${cobrado} ${moneda}.`,
          'El pedido NO se marcó como pagado.'
        );
        return res.status(200).json({ received: true, ignored: 'el monto no coincide' });
      }
    }

    if (!sePuedeActualizar(order.payment_status, nuevoEstado)) {
      return res.status(200).json({ received: true, ignored: 'el estado actual no se modifica' });
    }

    // Actualizar estado y, si corresponde, descontar el inventario UNA sola vez.
    const aplicar = db.transaction(() => {
      db.prepare(`
        UPDATE orders SET payment_status = ?, payment_method = ?, wompi_transaction_id = ?
        WHERE reference = ?
      `).run(nuevoEstado, tx.payment_method_type || null, tx.id || null, tx.reference);

      if (nuevoEstado === 'aprobada' && !order.stock_descontado) {
        const lineas = db.prepare('SELECT product_id, qty FROM order_items WHERE order_id = ?').all(order.id);
        const descontar = db.prepare(`
          UPDATE products SET stock_qty = MAX(0, stock_qty - ?), updated_at = datetime('now')
          WHERE id = ?
        `);
        for (const l of lineas) descontar.run(l.qty, l.product_id);

        // Lo que llegue a cero queda marcado como agotado automáticamente
        db.prepare(`
          UPDATE products SET stock_status = 'agotado'
          WHERE stock_qty <= 0 AND stock_status = 'disponible'
        `).run();

        db.prepare('UPDATE orders SET stock_descontado = 1 WHERE id = ?').run(order.id);
      }
    });

    aplicar();
    res.status(200).json({ received: true });
  } catch (err) {
    console.error('Error procesando webhook WOMPI:', err.message);
    res.status(500).json({ error: 'Error interno procesando el evento.' });
  }
});

module.exports = router;
