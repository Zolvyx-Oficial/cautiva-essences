// server/routes/checkout.js
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../db');
const { calculateShipping } = require('../utils/shipping');
const { buildOrderWhatsAppLink } = require('../utils/whatsapp');
const { generateInvoicePDF } = require('../utils/invoice');

function generateReference() {
  return 'ESZ-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(2).toString('hex').toUpperCase();
}

// POST /checkout/quote-shipping
// body: { shippingType, carrier, city, items: [{productId, qty}] }
router.post('/quote-shipping', (req, res) => {
  try {
    const { shippingType, carrier, city, items } = req.body;
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'El carrito está vacío.' });

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
    const { customer, shippingType, carrier, items, wholesale } = req.body;
    if (!customer?.name || !customer?.phone) return res.status(400).json({ error: 'Nombre y teléfono son obligatorios.' });
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'El carrito está vacío.' });

    let subtotal = 0, totalWeightGrams = 0, totalQty = 0;
    const lineItems = [];
    for (const it of items) {
      const p = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(it.productId);
      if (!p) return res.status(400).json({ error: `Producto ${it.productId} no disponible.` });
      const unitPrice = (wholesale && p.price_mayor && it.qty >= (p.mayor_min_qty || 6)) ? p.price_mayor : p.price_detal;
      const lineTotal = unitPrice * it.qty;
      subtotal += lineTotal;
      totalWeightGrams += p.weight_grams * it.qty;
      totalQty += it.qty;
      lineItems.push({ product_id: p.id, product_name: p.name, unit_price: unitPrice, qty: it.qty, line_total: lineTotal });
    }

    const shipping = calculateShipping({ shippingType, carrier, city: customer.city, totalWeightGrams, totalQty });
    const total = subtotal + shipping.cost;
    const reference = generateReference();

    const insertOrder = db.prepare(`
      INSERT INTO orders
        (reference, customer_name, customer_phone, customer_email, customer_address, customer_city,
         shipping_type, shipping_carrier, shipping_cost, subtotal, total_weight_grams, total, payment_status)
      VALUES (@reference,@customer_name,@customer_phone,@customer_email,@customer_address,@customer_city,
              @shipping_type,@shipping_carrier,@shipping_cost,@subtotal,@total_weight_grams,@total,'pendiente')
    `);
    const info = insertOrder.run({
      reference, customer_name: customer.name, customer_phone: customer.phone,
      customer_email: customer.email || null, customer_address: customer.address || null, customer_city: customer.city || null,
      shipping_type: shippingType, shipping_carrier: carrier || null, shipping_cost: shipping.cost,
      subtotal, total_weight_grams: totalWeightGrams, total
    });
    const orderId = info.lastInsertRowid;

    const insertItem = db.prepare(`INSERT INTO order_items (order_id, product_id, product_name, unit_price, qty, line_total) VALUES (?,?,?,?,?,?)`);
    for (const li of lineItems) insertItem.run(orderId, li.product_id, li.product_name, li.unit_price, li.qty, li.line_total);

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
