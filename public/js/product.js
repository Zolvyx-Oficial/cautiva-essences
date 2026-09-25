// public/js/product.js
document.addEventListener('DOMContentLoaded', async () => {
  Essenza.renderHeader('');
  Essenza.renderFooter();
  await Essenza.initI18n();

  const UMBRAL_POCAS = 5;
  const id = new URLSearchParams(location.search).get('id');
  const wrap = document.getElementById('product-detail-content');
  if (!id) { wrap.innerHTML = '<p>Producto no especificado.</p>'; return; }

  const res = await fetch(`/api/products/${id}`);
  if (!res.ok) { wrap.innerHTML = '<p>Producto no encontrado.</p>'; return; }
  const p = await res.json();

  document.title = `${p.name} — ${p.brand_name} | Cautiva Essences`;
  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc) metaDesc.setAttribute('content', (Essenza.getLang() === 'en' ? p.description_en : p.description_es) || '');

  const mainImg = (p.images && p.images[0]) || '/img/placeholder-bottle.svg';
  const thumbs = (p.images || []).map((img, i) => `<img src="${img}" data-src="${img}" alt="${p.name} ${i+1}">`).join('');

  const enOferta = p.compare_at_price && p.compare_at_price > p.price_detal;
  const descuento = enOferta ? Math.round((1 - p.price_detal / p.compare_at_price) * 100) : 0;

  const bloquePrecio = enOferta
    ? `<span class="price-old" style="font-size:1.25rem">${Essenza.formatCOP(p.compare_at_price)}</span>
       <span class="price" style="font-size:2rem">${Essenza.formatCOP(p.price_detal)}</span>
       <span class="badge badge-sale" style="position:static">-${descuento}%</span>`
    : `<span class="price" style="font-size:2rem">${Essenza.formatCOP(p.price_detal)}</span>`;

  const pocas = p.stock_status === 'disponible' && p.stock_qty > 0 && p.stock_qty <= UMBRAL_POCAS;
  const avisoStock = pocas
    ? `<div class="low-stock" style="margin:12px 0">¡Solo quedan ${p.stock_qty} unidades!</div>`
    : '';

  wrap.innerHTML = `
    <div>
      <div class="gallery-main"><img id="gallery-main-img" src="${mainImg}" alt="${p.name}" onerror="this.style.display='none'"></div>
      <div class="gallery-thumbs">${thumbs}</div>
    </div>
    <div>
      <div class="eyebrow-line">${p.brand_name} · ${p.category_name_es}</div>
      <h1>${p.name}</h1>
      ${p.rating_count ? `<div class="rating-line"><span class="stars">${estrellasHTML(Math.round(p.rating_avg))}</span> <span>${p.rating_avg} · ${p.rating_count} ${p.rating_count === 1 ? 'reseña' : 'reseñas'}</span></div>` : ''}
      <p>${(Essenza.getLang() === 'en' ? p.description_en : p.description_es) || ''}</p>

      <div class="notes-grid">
        <div class="note-block"><div class="label" data-i18n="product.notes_top"></div><div class="value">${p.notes_salida || '—'}</div></div>
        <div class="note-block"><div class="label" data-i18n="product.notes_heart"></div><div class="value">${p.notes_corazon || '—'}</div></div>
        <div class="note-block"><div class="label" data-i18n="product.notes_base"></div><div class="value">${p.notes_fondo || '—'}</div></div>
      </div>

      <div style="display:flex;align-items:center;gap:14px;margin:20px 0;flex-wrap:wrap">
        ${bloquePrecio}
        <span class="ml">${p.presentation_value}${p.presentation_unit}</span>
      </div>
      ${avisoStock}
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

  // ---- Reseñas ----
  loadReviews(id);

  // ---- Productos relacionados ----
  loadRelatedProducts(id);
});

// Devuelve 5 estrellas, llenas segun la calificacion
function estrellasHTML(n) {
  return '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n);
}

async function loadReviews(id) {
  const reviews = await (await fetch(`/api/products/${id}/reviews`)).json();

  const listaHTML = reviews.length
    ? reviews.map(r => `
        <article class="review-card">
          <div class="review-head">
            <strong>${escapeHTML(r.customer_name)}</strong>
            <span class="stars">${estrellasHTML(r.rating)}</span>
          </div>
          ${r.comment ? `<p class="review-text">${escapeHTML(r.comment)}</p>` : ''}
          <span class="review-date">${new Date(r.created_at).toLocaleDateString('es-CO')}</span>
        </article>`).join('')
    : `<p style="color:var(--smoke)">Todavía no hay reseñas de este perfume. ¡Sé la primera persona en dejar una!</p>`;

  const section = document.createElement('section');
  section.className = 'container';
  section.style.cssText = 'padding:56px 0 0;border-top:1px solid var(--carbon-line);margin-top:32px';
  section.innerHTML = `
    <h2 style="margin-bottom:24px">Reseñas</h2>
    <div class="reviews-layout">
      <div id="reviews-list">${listaHTML}</div>
      <div class="summary-card" style="position:static">
        <h3 style="margin-top:0">Deja tu reseña</h3>
        <div id="review-msg" class="alert" style="display:none"></div>
        <form id="review-form">
          <div class="form-field">
            <label>Tu nombre</label>
            <input type="text" name="customer_name" required maxlength="60">
          </div>
          <div class="form-field">
            <label>Calificación</label>
            <div class="star-picker" id="star-picker">
              ${[1,2,3,4,5].map(n => `<button type="button" class="star-btn" data-value="${n}" aria-label="${n} estrellas">☆</button>`).join('')}
            </div>
            <input type="hidden" name="rating" id="rating-input" value="">
          </div>
          <div class="form-field">
            <label>Comentario (opcional)</label>
            <textarea name="comment" rows="3" maxlength="600"></textarea>
          </div>
          <button type="submit" class="btn btn-primary btn-block">Enviar reseña</button>
        </form>
      </div>
    </div>`;

  document.querySelector('.product-detail').insertAdjacentElement('afterend', section);

  // Selector de estrellas
  const ratingInput = section.querySelector('#rating-input');
  const starBtns = section.querySelectorAll('.star-btn');
  function pintarEstrellas(valor) {
    starBtns.forEach(b => {
      const activa = Number(b.dataset.value) <= valor;
      b.textContent = activa ? '★' : '☆';
      b.classList.toggle('is-active', activa);
    });
  }
  starBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      ratingInput.value = btn.dataset.value;
      pintarEstrellas(Number(btn.dataset.value));
    });
    btn.addEventListener('mouseenter', () => pintarEstrellas(Number(btn.dataset.value)));
  });
  section.querySelector('#star-picker').addEventListener('mouseleave', () => pintarEstrellas(Number(ratingInput.value) || 0));

  // Envío
  const form = section.querySelector('#review-form');
  const msg = section.querySelector('#review-msg');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!ratingInput.value) {
      msg.className = 'alert alert-error';
      msg.textContent = 'Elige cuántas estrellas le das.';
      msg.style.display = 'block';
      return;
    }
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const res = await fetch(`/api/products/${id}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_name: form.customer_name.value,
          rating: Number(ratingInput.value),
          comment: form.comment.value
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      msg.className = 'alert alert-success';
      msg.textContent = data.message;
      form.reset();
      ratingInput.value = '';
      pintarEstrellas(0);
    } catch (err) {
      msg.className = 'alert alert-error';
      msg.textContent = err.message || 'No se pudo enviar la reseña.';
    }
    msg.style.display = 'block';
    btn.disabled = false;
  });
}

// Evita que un comentario pueda inyectar HTML en la página
function escapeHTML(str) {
  return String(str).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
}

async function loadRelatedProducts(id) {
  try {
    const related = await (await fetch(`/api/products/${id}/related`)).json();
    if (!related.length) return;

    const section = document.createElement('section');
    section.className = 'container';
    section.style.cssText = 'padding:56px 0 96px;border-top:1px solid var(--carbon-line);margin-top:32px';
    section.innerHTML = `
      <h2 style="margin-bottom:28px">También te puede gustar</h2>
      <div class="product-grid">
        ${related.map(r => {
          const img = r.images && r.images[0]
            ? `<img src="${r.images[0]}" alt="${r.name}">`
            : `<span class="initials">${r.name.slice(0,2).toUpperCase()}</span>`;
          return `
            <article class="product-card">
              <a href="/product.html?id=${r.id}" class="thumb">${img}</a>
              <div class="info">
                <span class="brand-label">${r.brand_name || ''}</span>
                <a href="/product.html?id=${r.id}"><h3>${r.name}</h3></a>
                <span class="ml">${r.presentation_value}${r.presentation_unit}</span>
                <div class="price-row"><span class="price">${Essenza.formatCOP(r.price_detal)}</span></div>
              </div>
            </article>`;
        }).join('')}
      </div>`;
    document.querySelector('.product-detail').insertAdjacentElement('afterend', section);
  } catch (err) {
    console.error('No se pudieron cargar productos relacionados:', err);
  }
}
