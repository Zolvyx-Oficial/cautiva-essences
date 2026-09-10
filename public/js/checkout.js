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
      wholesale: false
    };

    try {
      const res = await fetch('/checkout/create-order', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      Essenza.clearCart();
      renderPaymentStep(data);
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.style.display = 'block';
    }
  });
}

function renderPaymentStep(data) {
  const { order, wompi, whatsappLink } = data;
  document.getElementById('checkout-form-section').innerHTML = `
    <div class="alert alert-success">
      ${Essenza.t('checkout.order_created')}: <strong>${order.reference}</strong>
    </div>
    <div id="wompi-widget-container"></div>
    <div style="display:flex;flex-direction:column;gap:12px;margin-top:16px">
      <a href="${whatsappLink}" target="_blank" rel="noopener" class="btn btn-outline btn-block">${Essenza.t('checkout.confirm_whatsapp')}</a>
      <a href="/checkout/invoice/${order.reference}" class="btn btn-outline btn-block">${Essenza.t('checkout.download_invoice')}</a>
    </div>`;

  // Widget de pago WOMPI (Web Checkout) — https://docs.wompi.co/docs/colombia/widget-checkout-web/
  const form = document.createElement('form');
  form.innerHTML = `
    <script src="https://checkout.wompi.co/widget.js"
      data-render="button"
      data-public-key="${wompi.publicKey}"
      data-currency="${wompi.currency}"
      data-amount-in-cents="${wompi.amountInCents}"
      data-reference="${wompi.reference}"
      data-signature:integrity="${wompi.signature}"
      data-redirect-url="${wompi.redirectUrl}">
    </script>`;
  document.getElementById('wompi-widget-container').appendChild(form);
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

    const statusLabel = { aprobada: '✅ Pago aprobado', rechazada: '❌ Pago rechazado', pendiente: '⏳ Pago pendiente de confirmación' }[order.payment_status] || order.payment_status;

    section.innerHTML = `
      <h2>${Essenza.t('checkout.order_created')}: ${order.reference}</h2>
      <p>${statusLabel}</p>
      <div class="summary-card" style="position:static">
        ${items.map(i => `<div class="summary-row"><span>${i.qty} × ${i.product_name}</span><span>${Essenza.formatCOP(i.line_total)}</span></div>`).join('')}
        <div class="summary-row"><span data-i18n="checkout.shipping_cost"></span><span>${Essenza.formatCOP(order.shipping_cost)}</span></div>
        <div class="summary-row total"><span data-i18n="checkout.total"></span><span>${Essenza.formatCOP(order.total)}</span></div>
      </div>
      <div style="display:flex;flex-direction:column;gap:12px;margin-top:16px">
        <a href="/checkout/invoice/${order.reference}" class="btn btn-primary btn-block">${Essenza.t('checkout.download_invoice')}</a>
        <a href="/index.html" class="btn btn-outline btn-block">${Essenza.t('cart.continue')}</a>
      </div>`;
    Essenza.applyI18n();
  } catch (err) {
    section.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
  }
}
