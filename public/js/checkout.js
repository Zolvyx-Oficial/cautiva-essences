// public/js/checkout.js
document.addEventListener('DOMContentLoaded', async () => {
  Essenza.renderHeader('');
  Essenza.renderFooter();
  await Essenza.initI18n();

  const existingOrderRef = new URLSearchParams(location.search).get('order');
  if (existingOrderRef) {
    await showOrderConfirmation(existingOrderRef);
    return;
  }

  const cart = Essenza.getCart();
  if (cart.length === 0) {
    document.getElementById('checkout-form-section').innerHTML = `<div class="empty-state">${Essenza.t('cart.empty')}</div>`;
    return;
  }

  renderSummary(cart);
  bindShippingOptions();
  bindForm(cart);
});

function renderSummary(cart) {
  const list = document.getElementById('summary-items');
  list.innerHTML = cart.map(i => `<div class="summary-row"><span>${i.qty} × ${i.name}</span><span>${Essenza.formatCOP(i.price * i.qty)}</span></div>`).join('');
  document.getElementById('summary-subtotal').textContent = Essenza.formatCOP(Essenza.cartSubtotal());
  updateTotal(0);
}

function updateTotal(shippingCost) {
  document.getElementById('summary-shipping').textContent = Essenza.formatCOP(shippingCost);
  document.getElementById('summary-total').textContent = Essenza.formatCOP(Essenza.cartSubtotal() + shippingCost);
}

function bindShippingOptions() {
  const options = document.querySelectorAll('.shipping-option');
  const carrierWrap = document.getElementById('carrier-select-wrap');
  options.forEach(opt => {
    opt.addEventListener('click', async () => {
      options.forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      document.getElementById('shipping-type-input').value = opt.dataset.type;
      carrierWrap.style.display = opt.dataset.type === 'nacional' ? 'block' : 'none';
      await refreshShippingQuote();
    });
  });
  document.getElementById('carrier-input').addEventListener('change', refreshShippingQuote);
  document.getElementById('city-input').addEventListener('change', refreshShippingQuote);
}

async function refreshShippingQuote() {
  const shippingType = document.getElementById('shipping-type-input').value;
  if (!shippingType) return;
  const carrier = document.getElementById('carrier-input').value;
  const city = document.getElementById('city-input').value;
  const items = Essenza.getCart().map(i => ({ productId: i.productId, qty: i.qty }));

  const errorBox = document.getElementById('checkout-error');
  errorBox.style.display = 'none';

  try {
    const res = await fetch('/checkout/quote-shipping', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shippingType, carrier, city, items })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    updateTotal(data.cost);
    document.getElementById('pay-button').disabled = false;
  } catch (err) {
    errorBox.textContent = err.message;
    errorBox.style.display = 'block';
    document.getElementById('pay-button').disabled = true;
  }
}

function bindForm(cart) {
  const form = document.getElementById('checkout-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorBox = document.getElementById('checkout-error');
    errorBox.style.display = 'none';

    const payload = {
      customer: {
        name: form.name.value.trim(),
        phone: form.phone.value.trim(),
        email: form.email.value.trim(),
        address: form.address.value.trim(),
        city: form.city.value.trim()
      },
      shippingType: document.getElementById('shipping-type-input').value,
      carrier: document.getElementById('carrier-input').value,
      items: cart.map(i => ({ productId: i.productId, qty: i.qty })),
      // El servidor decide el precio: aplica el mayorista solo si la cantidad
      // llega al mínimo de ese producto. Así el total cobrado coincide con el mostrado.
      wholesale: true
    };

    const payBtn = document.getElementById('pay-button');
    payBtn.disabled = true;
    payBtn.innerHTML = '<span>Redirigiendo al pago...</span>';

    try {
      const res = await fetch('/checkout/create-order', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      // NO limpiamos el carrito todavía: si el pago falla, el cliente
      // no pierde lo que había elegido y puede volver a intentar.
      irAPagar(data);
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.style.display = 'block';
      payBtn.disabled = false;
      payBtn.innerHTML = `<span>${Essenza.t('checkout.pay_wompi')}</span>`;
    }
  });
}

// Manda al cliente directo al checkout de WOMPI, sin pasos intermedios
function irAPagar(data) {
  const { wompi } = data;
  const url = buildWompiCheckoutUrl(wompi);

  document.getElementById('checkout-form-section').innerHTML = `
    <div class="alert alert-success">Te estamos llevando a la pasarela de pago segura de WOMPI...</div>
    <p style="margin-bottom:16px">Si no se abre automáticamente en unos segundos, usa este botón:</p>
    <a href="${url}" class="btn btn-magenta btn-block">Continuar al pago</a>`;

  // Pequeña pausa para que el mensaje se alcance a ver
  setTimeout(() => { location.href = url; }, 600);
}

// Web Checkout por URL de WOMPI
function buildWompiCheckoutUrl(wompi) {
  const params = new URLSearchParams({
    'public-key': wompi.publicKey,
    currency: wompi.currency,
    'amount-in-cents': String(wompi.amountInCents),
    reference: wompi.reference,
    'signature:integrity': wompi.signature,
    'redirect-url': wompi.redirectUrl
  });
  return `https://checkout.wompi.co/p/?${params}`;
}

async function showOrderConfirmation(reference) {
  const section = document.getElementById('checkout-form-section');
  const summarySection = document.getElementById('checkout-summary-section');
  if (summarySection) summarySection.style.display = 'none';

  try {
    const res = await fetch(`/checkout/order/${reference}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    const { order, items } = data;

    const aprobado = order.payment_status === 'aprobada';
    const rechazado = order.payment_status === 'rechazada';

    // El pago salió bien: ya podemos vaciar el carrito
    if (aprobado) Essenza.clearCart();

    let encabezado, acciones;

    if (aprobado) {
      encabezado = `
        <div class="alert alert-success" style="font-size:1rem">
          ✅ <strong>¡Pago aprobado!</strong> Tu pedido <strong>${order.reference}</strong> quedó confirmado.
        </div>
        <p>Nos pondremos en contacto contigo para coordinar la entrega.</p>`;
      acciones = `
        <a href="/checkout/invoice/${order.reference}" class="btn btn-primary btn-block">${Essenza.t('checkout.download_invoice')}</a>
        <a href="https://wa.me/573196812111?text=${encodeURIComponent('Hola, acabo de hacer el pedido ' + order.reference)}" target="_blank" rel="noopener" class="btn btn-outline btn-block">Escribirnos por WhatsApp</a>
        <a href="/index.html" class="btn btn-outline btn-block">${Essenza.t('cart.continue')}</a>`;
    } else if (rechazado) {
      encabezado = `
        <div class="alert alert-error" style="font-size:1rem">
          ❌ <strong>El pago fue rechazado.</strong> No se hizo ningún cobro.
        </div>
        <p>Tu carrito sigue guardado, puedes intentar con otro medio de pago.</p>`;
      acciones = `
        <a href="/checkout.html" class="btn btn-primary btn-block">Intentar el pago de nuevo</a>
        <a href="https://wa.me/573196812111?text=${encodeURIComponent('Hola, tuve un problema pagando el pedido ' + order.reference)}" target="_blank" rel="noopener" class="btn btn-outline btn-block">Necesito ayuda por WhatsApp</a>`;
    } else {
      encabezado = `
        <div class="alert" style="background:rgba(255,255,255,.06);border:1px solid var(--carbon-line);font-size:1rem">
          ⏳ <strong>Pago en verificación.</strong> Pedido <strong>${order.reference}</strong>.
        </div>
        <p>Algunos medios de pago (como PSE) tardan unos minutos en confirmarse. Puedes recargar esta página en un rato.</p>`;
      acciones = `
        <a href="/checkout.html?order=${order.reference}" class="btn btn-primary btn-block">Actualizar estado</a>
        <a href="https://wa.me/573196812111?text=${encodeURIComponent('Hola, quiero confirmar el estado del pedido ' + order.reference)}" target="_blank" rel="noopener" class="btn btn-outline btn-block">Consultar por WhatsApp</a>`;
    }

    section.innerHTML = `
      ${encabezado}
      <div class="summary-card" style="position:static;margin-top:20px">
        ${items.map(i => `<div class="summary-row"><span>${i.qty} × ${i.product_name}</span><span>${Essenza.formatCOP(i.line_total)}</span></div>`).join('')}
        <div class="summary-row"><span data-i18n="checkout.shipping_cost"></span><span>${Essenza.formatCOP(order.shipping_cost)}</span></div>
        <div class="summary-row total"><span data-i18n="checkout.total"></span><span>${Essenza.formatCOP(order.total)}</span></div>
      </div>
      <div style="display:flex;flex-direction:column;gap:12px;margin-top:20px">${acciones}</div>`;

    Essenza.applyI18n();
  } catch (err) {
    section.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
  }
}
