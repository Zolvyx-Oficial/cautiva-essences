// public/js/product.js
document.addEventListener('DOMContentLoaded', async () => {
  Essenza.renderHeader('');
  Essenza.renderFooter();
  await Essenza.initI18n();

  const id = new URLSearchParams(location.search).get('id');
  const wrap = document.getElementById('product-detail-content');
  if (!id) { wrap.innerHTML = '<p>Producto no especificado.</p>'; return; }

  const res = await fetch(`/api/products/${id}`);
  if (!res.ok) { wrap.innerHTML = '<p>Producto no encontrado.</p>'; return; }
  const p = await res.json();

  document.title = `${p.name} — ${p.brand_name} | Essenza Studio`;
  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc) metaDesc.setAttribute('content', (Essenza.getLang() === 'en' ? p.description_en : p.description_es) || '');

  const mainImg = (p.images && p.images[0]) || '/img/placeholder-bottle.svg';
  const thumbs = (p.images || []).map((img, i) => `<img src="${img}" data-src="${img}" alt="${p.name} ${i+1}">`).join('');

  wrap.innerHTML = `
    <div>
      <div class="gallery-main"><img id="gallery-main-img" src="${mainImg}" alt="${p.name}" onerror="this.style.display='none'"></div>
      <div class="gallery-thumbs">${thumbs}</div>
    </div>
    <div>
      <div class="eyebrow-line">${p.brand_name} · ${p.category_name_es}</div>
      <h1>${p.name}</h1>
      <p>${(Essenza.getLang() === 'en' ? p.description_en : p.description_es) || ''}</p>

      <div class="notes-grid">
        <div class="note-block"><div class="label" data-i18n="product.notes_top"></div><div class="value">${p.notes_salida || '—'}</div></div>
        <div class="note-block"><div class="label" data-i18n="product.notes_heart"></div><div class="value">${p.notes_corazon || '—'}</div></div>
        <div class="note-block"><div class="label" data-i18n="product.notes_base"></div><div class="value">${p.notes_fondo || '—'}</div></div>
      </div>

      <div style="display:flex;align-items:center;gap:20px;margin:20px 0">
        <span class="price" style="font-size:2rem">${Essenza.formatCOP(p.price_detal)}</span>
        <span class="ml">${p.presentation_value}${p.presentation_unit}</span>
      </div>
      ${p.price_mayor ? `<p style="color:var(--gold);font-size:.85rem" data-i18n-note>${Essenza.t('product.wholesale_note')} ${p.mayor_min_qty} ${Essenza.t('product.units')}: <strong>${Essenza.formatCOP(p.price_mayor)}</strong></p>` : ''}

      <div style="display:flex;gap:16px;align-items:center;margin:24px 0">
        <div class="qty-selector">
          <button id="qty-minus">−</button>
          <input id="qty-input" type="number" min="1" value="1">
          <button id="qty-plus">+</button>
        </div>
        <button id="add-to-cart" class="btn btn-primary" ${p.stock_status === 'agotado' ? 'disabled' : ''}>
          <span data-i18n="product.add_to_cart"></span>
        </button>
      </div>
    </div>`;

  Essenza.applyI18n();

  // Miniaturas
  wrap.querySelectorAll('.gallery-thumbs img').forEach(img => {
    img.addEventListener('click', () => { document.getElementById('gallery-main-img').src = img.dataset.src; });
  });

  const qtyInput = document.getElementById('qty-input');
  document.getElementById('qty-minus').addEventListener('click', () => { qtyInput.value = Math.max(1, +qtyInput.value - 1); });
  document.getElementById('qty-plus').addEventListener('click', () => { qtyInput.value = +qtyInput.value + 1; });
  document.getElementById('add-to-cart').addEventListener('click', () => {
    Essenza.addToCart(p, Math.max(1, +qtyInput.value));
    location.href = '/cart.html';
  });

  // ---- SEO: Datos estructurados Schema.org ----
  const ld = document.createElement('script');
  ld.type = 'application/ld+json';
  ld.textContent = JSON.stringify({
    '@context': 'https://schema.org/',
    '@type': 'Product',
    name: p.name,
    brand: { '@type': 'Brand', name: p.brand_name },
    description: p.description_es,
    offers: {
      '@type': 'Offer',
      priceCurrency: 'COP',
      price: p.price_detal,
      availability: p.stock_status === 'disponible' ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      url: location.href
    }
  });
  document.head.appendChild(ld);
});
