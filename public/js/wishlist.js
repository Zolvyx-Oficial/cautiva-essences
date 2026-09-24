// public/js/wishlist.js
document.addEventListener('DOMContentLoaded', async () => {
  Essenza.renderHeader('');
  Essenza.renderFooter();
  await Essenza.initI18n();
  render();
  document.addEventListener('essenza:langchange', render);
});

function render() {
  const wrap = document.getElementById('wishlist-items');
  const list = Essenza.getWishlist();

  if (list.length === 0) {
    wrap.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        Todavía no tienes fragancias guardadas.<br><br>
        <a href="/index.html#catalogo" class="btn btn-outline">Explorar catálogo</a>
      </div>`;
    return;
  }

  wrap.innerHTML = list.map(item => {
    const img = item.image
      ? `<img src="${item.image}" alt="${item.name}">`
      : `<span class="initials">${item.name.slice(0,2).toUpperCase()}</span>`;
    return `
      <article class="product-card" data-id="${item.productId}">
        <a href="/product.html?id=${item.productId}" class="thumb">${img}</a>
        <button class="fav-btn is-fav" data-remove-id="${item.productId}" aria-label="Quitar de favoritos" title="Quitar de favoritos">♥</button>
        <div class="info">
          <span class="brand-label">${item.brand || ''}</span>
          <a href="/product.html?id=${item.productId}"><h3>${item.name}</h3></a>
          <span class="ml">${item.presentation || ''}</span>
          <div class="price-row">
            <span class="price">${Essenza.formatCOP(item.price)}</span>
            <button class="add-btn" data-add-id="${item.productId}" aria-label="Agregar al carrito">+</button>
          </div>
        </div>
      </article>`;
  }).join('');

  wrap.querySelectorAll('[data-remove-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      Essenza.removeFromWishlist(Number(btn.dataset.removeId));
      render();
    });
  });

  wrap.querySelectorAll('[data-add-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const res = await fetch(`/api/products/${btn.dataset.addId}`);
      if (!res.ok) return;
      const product = await res.json();
      Essenza.addToCart(product, 1);
      btn.textContent = '✓';
      setTimeout(() => btn.textContent = '+', 900);
    });
  });
}