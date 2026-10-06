// server/routes/checkout.js
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../db');
const { calculateShipping } = require('../utils/shipping');
const { buildOrderWhatsAppLink } = require('../utils/whatsapp');
const { generateInvoicePDF } = require('../utils/invoice');

// La referencia es pública: aparece en la URL de la factura y en la de consulta
// del pedido. Con pocos caracteres al azar se podrían recorrer todas y sacar los
// datos de los clientes, así que lleva 16 bytes aleatorios.
function generateReference() {
  return 'ESZ-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(16).toString('hex').toUpperCase();
}

// Máximos de sentido común, para que nadie pueda mandar un pedido absurdo
const MAX_LINEAS = 50;
const MAX_UNIDADES_POR_LINEA = 200;

/**
 * Valida las líneas que llegan del navegador. NUNCA confiar en estos números:
 * una cantidad negativa o decimal haría que el total del pedido —y el monto que
 * se le firma a WOMPI— no corresponda con lo que realmente se está comprando.
 * Devuelve las líneas limpias o lanza un error con el motivo.
 */
function validarLineas(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('El carrito está vacío.');
  }
  if (items.length > MAX_LINEAS) {
    throw new Error('El carrito tiene demasiados productos distintos.');
  }

  const limpias = [];
  for (const it of items) {
    const productId = Number(it?.productId);
    const qty = Number(it?.qty);

    if (!Number.isInteger(productId) || productId < 1) {
      throw new Error('Hay un producto no válido en el carrito.');
    }
    if (!Number.isInteger(qty) || qty < 1) {
      throw new Error('Las cantidades deben ser números enteros mayores que cero.');
    }
    if (qty > MAX_UNIDADES_POR_LINEA) {
      throw new Error(`La cantidad máxima por producto es ${MAX_UNIDADES_POR_LINEA} unidades. Para pedidos mayores, escríbenos por WhatsApp.`);
    }
    limpias.push({ productId, qty });
  }
  return limpias;
}

// POST /checkout/quote-shipping
// body: { shippingType, carrier, city, items: [{productId, qty}] }
router.post('/quote-shipping', (req, res) => {
  try {
    const { shippingType, carrier, city } = req.body;
    const items = validarLineas(req.body.items);

    let totalWeightGrams = 0, totalQty = 0;
    for (const it of items) {
      const p = db.prepare('SELECT weight_grams FROM products WHERE id = ?').get(it.productId);
      if (!p) return res.status(400).json({ error: `Producto ${it.productId} no existe.` });
      totalWeightGrams += p.weight_grams * it.qty;
      totalQty += it.qty;
    }

    const quote = calculateShipping({ shippingType, carrier, city, totalWeightGrams, totalQty });
    res.json({ ...quote, totalWeightGrams, totalQty });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /checkout/create-order
// body: { customer: {name, phone, email, address, city}, shippingType, carrier, items: [{productId, qty}], wholesale }
router.post('/create-order', (req, res) => {
  try {
    const { customer, shippingType, carrier, wholesale } = req.body;
    if (!customer?.name || !customer?.phone) return res.status(400).json({ error: 'Nombre y teléfono son obligatorios.' });

    const items = validarLineas(req.body.items);

    let subtotal = 0, totalWeightGrams = 0, totalQty = 0;
    const lineItems = [];
    for (const it of items) {
      const p = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(it.productId);
      if (!p) return res.status(400).json({ error: `Producto ${it.productId} no disponible.` });

      // Disponibilidad: no dejar comprar lo que no hay
      if (p.stock_status === 'agotado') {
        return res.status(400).json({ error: `"${p.name}" está agotado. Quítalo del carrito para continuar.` });
      }
      if (p.stock_status === 'disponible' && it.qty > p.stock_qty) {
        return res.status(400).json({
          error: p.stock_qty > 0
            ? `De "${p.name}" solo quedan ${p.stock_qty} unidad(es). Ajusta la cantidad.`
            : `"${p.name}" se acaba de agotar. Quítalo del carrito para continuar.`
        });
      }

      const unitPrice = (wholesale && p.price_mayor && it.qty >= (p.mayor_min_qty || 6)) ? p.price_mayor : p.price_detal;
      if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
        return res.status(400).json({ error: `"${p.name}" no tiene un precio válido. Avísanos por WhatsApp.` });
      }

      const lineTotal = unitPrice * it.qty;
      subtotal += lineTotal;
      totalWeightGrams += p.weight_grams * it.qty;
      totalQty += it.qty;
      lineItems.push({ product_id: p.id, product_name: p.name, unit_price: unitPrice, qty: it.qty, line_total: lineTotal });
    }

    const shipping = calculateShipping({ shippingType, carrier, city: customer.city, totalWeightGrams, totalQty });
    const total = subtotal + shipping.cost;

    // Última red: si por lo que sea el total no es un entero positivo, no se crea nada.
    if (!Number.isInteger(total) || total <= 0) {
      return res.status(400).json({ error: 'No se pudo calcular el total del pedido. Revisa el carrito.' });
    }

    const reference = generateReference();

    const insertOrder = db.prepare(`
      INSERT INTO orders
        (reference, customer_name, customer_phone, customer_email, customer_address, customer_city,
         shipping_type, shipping_carrier, shipping_cost, subtotal, total_weight_grams, total, payment_status)
      VALUES (@reference,@customer_name,@customer_phone,@customer_email,@customer_address,@customer_city,
              @shipping_type,@shipping_carrier,@shipping_cost,@subtotal,@total_weight_grams,@total,'pendiente')
    `);
    const insertItem = db.prepare(`INSERT INTO order_items (order_id, product_id, product_name, unit_price, qty, line_total) VALUES (?,?,?,?,?,?)`);

    // El pedido y sus líneas se guardan juntos o no se guarda nada: así nunca
    // queda un pedido sin productos si el servidor se cae a mitad.
    const crearPedido = db.transaction((datosPedido, lineas) => {
      const info = insertOrder.run(datosPedido);
      const id = info.lastInsertRowid;
      for (const li of lineas) insertItem.run(id, li.product_id, li.product_name, li.unit_price, li.qty, li.line_total);
      return id;
    });

    const orderId = crearPedido({
      reference, customer_name: customer.name, customer_phone: customer.phone,
      customer_email: customer.email || null, customer_address: customer.address || null, customer_city: customer.city || null,
      shipping_type: shippingType, shipping_carrier: carrier || null, shipping_cost: shipping.cost,
      subtotal, total_weight_grams: totalWeightGrams, total
    }, lineItems);

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    const whatsappLink = buildOrderWhatsAppLink({ salesNumber: process.env.WHATSAPP_SALES_NUMBER, order, items: lineItems });

    // Firma de integridad para el widget WOMPI (SHA-256 de referencia+monto+moneda+secreto)
    const amountInCents = total * 100;
    const integritySignature = crypto
      .createHash('sha256')
      .update(`${reference}${amountInCents}COP${process.env.WOMPI_INTEGRITY_SECRET}`)
      .digest('hex');

    res.status(201).json({
      order,
      items: lineItems,
      whatsappLink,
      wompi: {
        publicKey: process.env.WOMPI_PUBLIC_KEY,
        amountInCents,
        currency: 'COP',
        reference,
        signature: integritySignature,
        redirectUrl: `${process.env.APP_URL}/checkout.html?order=${reference}`
      }
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /checkout/order/:reference
router.get('/order/:reference', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE reference = ?').get(req.params.reference);
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado.' });
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  res.json({ order, items });
});

// GET /checkout/invoice/:reference — Descarga de factura PDF
router.get('/invoice/:reference', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE reference = ?').get(req.params.reference);
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado.' });
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  generateInvoicePDF({ order, items }, res);
});

module.exports = router;
