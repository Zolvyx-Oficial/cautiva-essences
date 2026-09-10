// public/js/cart.js
document.addEventListener('DOMContentLoaded', async () => {
  Essenza.renderHeader('');
  Essenza.renderFooter();
  await Essenza.initI18n();
  render();
  document.addEventListener('essenza:langchange', render);
});

function render() {
  const wrap = document.getElementById('cart-items');
  const summarySubtotal = document.getElementById('summary-subtotal');
  const cart = Essenza.getCart();

  if (cart.length === 0) {
    wrap.innerHTML = `<div class="empty-state">${Essenza.t('cart.empty')}<br><br><a href="/index.html" class="btn btn-outline">${Essenza.t('cart.continue')}</a></div>`;
    summarySubtotal.textContent = Essenza.formatCOP(0);
    document.getElementById('checkout-link').classList.add('btn-disabled');
    document.getElementById('checkout-link').setAttribute('aria-disabled', 'true');
    return;
  }

  wrap.innerHTML = cart.map(item => `
    <div class="cart-item" data-id="${item.productId}">
      <div class="thumb-sm">${item.image ? `<img src="${item.image}" alt="${item.name}">` : ''}</div>
      <div>
        <div class="name">${item.name}</div>
        <div class="ml" style="color:var(--smoke)">${item.brand || ''}</div>
        <div class="qty-selector" style="margin-top:8px">
          <button class="qty-minus">−</button>
          <input type="number" min="1" value="${item.qty}" class="qty-input">
          <button class="qty-plus">+</button>
        </div>
      </div>
      <div style="text-align:right">
        <div class="price">${Essenza.formatCOP(item.price * item.qty)}</div>
        <a href="#" class="remove-link" data-i18n="cart.remove">${Essenza.t('cart.remove')}</a>
      </div>
    </div>
  `).join('');

  wrap.querySelectorAll('.cart-item').forEach(row => {
    const id = Number(row.dataset.id);
    row.querySelector('.qty-minus').addEventListener('click', () => {
      const input = row.querySelector('.qty-input');
      Essenza.updateQty(id, Math.max(1, +input.value - 1));
      render();
    });
    row.querySelector('.qty-plus').addEventListener('click', () => {
      const input = row.querySelector('.qty-input');
      Essenza.updateQty(id, +input.value + 1);
      render();
    });
    row.querySelector('.qty-input').addEventListener('change', (e) => {
      Essenza.updateQty(id, Math.max(1, +e.target.value));
      render();
    });
    row.querySelector('.remove-link').addEventListener('click', (e) => {
      e.preventDefault();
      Essenza.removeFromCart(id);
      render();
    });
  });

  summarySubtotal.textContent = Essenza.formatCOP(Essenza.cartSubtotal());
}
