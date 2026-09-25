// public/js/catalog.js
// Catálogo: filtros por categoría/precio, búsqueda, mayorista, paginación, favoritos,
// aviso de pocas unidades y precio de oferta.

document.addEventListener('DOMContentLoaded', async () => {
  Essenza.renderHeader('catalog');
  Essenza.renderFooter();
  await Essenza.initI18n();

  const grid = document.getElementById('product-grid');
  const chipsWrap = document.getElementById('category-chips');
  const searchInput = document.getElementById('search-input');
  const wholesaleToggle = document.getElementById('wholesale-toggle');
  const minPriceInput = document.getElementById('min-price-input');
  const maxPriceInput = document.getElementById('max-price-input');
  const loadMoreBtn = document.getElementById('load-more-btn');

  const PAGE_SIZE = 12;
  const UMBRAL_POCAS = 5; // a partir de cuántas unidades se muestra el aviso

  const urlParams = new URLSearchParams(location.search);
  let state = {
    category: urlParams.get('category') || '',
    q: '',
    wholesale: urlParams.get('mayorista') === '1',
    minPrice: '',
    maxPrice: '',
    offset: 0
  };
  wholesaleToggle.checked = state.wholesale;

  let allLoadedProducts = [];

  const categories = await (await fetch('/api/categories')).json();

  function renderChips() {
    const allChip = `<button class="chip ${state.category === '' ? 'active' : ''}" data-slug="">${Essenza.t('catalog.all')}</button>`;
    const catChips = categories.map(c => `<button class="chip ${state.category === c.slug ? 'active' : ''}" data-slug="${c.slug}">${Essenza.getLang() === 'en' ? c.name_en : c.name_es}</button>`).join('');
    chipsWrap.innerHTML = allChip + catChips;
    chipsWrap.querySelectorAll('.chip').forEach(chip => {
      chip.addEventListener('click', () => {
        state.category = chip.dataset.slug;
        renderChips();
        loadProducts(false);
      });
    });
  }

  function productCard(p) {
    const img = p.images && p.images[0] ? `<img src="${p.images[0]}" alt="${p.name}">` : `<span class="initials">${p.name.slice(0,2).toUpperCase()}</span>`;

    let badge = '';
    if (p.stock_status === 'agotado') badge = `<span class="badge badge-sold">${Essenza.t('catalog.sold_out')}</span>`;
    else if (p.stock_status === 'pre-orden') badge = `<span class="badge badge-preorder">${Essenza.t('catalog.pre_order')}</span>`;

    // Oferta: compare_at_price es el precio "antes"
    const enOferta = !state.wholesale && p.compare_at_price && p.compare_at_price > p.price_detal;
    const descuento = enOferta ? Math.round((1 - p.price_detal / p.compare_at_price) * 100) : 0;
    const badgeOferta = enOferta ? `<span class="badge badge-sale">-${descuento}%</span>` : '';

    // Aviso de pocas unidades (solo si está disponible y quedan pocas)
    const pocas = p.stock_status === 'disponible' && p.stock_qty > 0 && p.stock_qty <= UMBRAL_POCAS;
    const avisoStock = pocas ? `<div class="low-stock">¡Solo quedan ${p.stock_qty}!</div>` : '';

    let priceLabel;
    if (state.wholesale && p.price_mayor) {
      priceLabel = `${Essenza.formatCOP(p.price_mayor)} <small>x${p.mayor_min_qty}+ ${Essenza.t('product.units')}</small>`;
    } else if (enOferta) {
      priceLabel = `<span class="price-old">${Essenza.formatCOP(p.compare_at_price)}</span> ${Essenza.formatCOP(p.price_detal)}`;
    } else {
      priceLabel = Essenza.formatCOP(p.price_detal);
    }

    const estrellas = p.rating_count
      ? `<div class="rating-line"><span class="stars">${'★★★★★'.slice(0, Math.round(p.rating_avg))}${'☆☆☆☆☆'.slice(0, 5 - Math.round(p.rating_avg))}</span> <span>(${p.rating_count})</span></div>`
      : '';

    const fav = Essenza.isInWishlist(p.id);

    return `
      <article class="product-card">
        <a href="/product.html?id=${p.id}" class="thumb">${img}${badge}${badgeOferta}</a>
        <button class="fav-btn ${fav ? 'is-fav' : ''}" data-fav-id="${p.id}" aria-label="Agregar a favoritos" title="Agregar a favoritos">${fav ? '♥' : '♡'}</button>
        <div class="info">
          <span class="brand-label">${p.brand_name || ''}</span>
          <a href="/product.html?id=${p.id}"><h3>${p.name}</h3></a>
          <span class="ml">${p.presentation_value}${p.presentation_unit}</span>
          ${estrellas}
          ${avisoStock}
          <div class="price-row">
            <span class="price">${priceLabel}</span>
            <button class="add-btn" data-id="${p.id}" ${p.stock_status === 'agotado' ? 'disabled' : ''} aria-label="${Essenza.t('catalog.add')}">+</button>
          </div>
        </div>
      </article>`;
  }

  function bindCardButtons() {
    grid.querySelectorAll('.add-btn').forEach(btn => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => {
        const product = allLoadedProducts.find(p => p.id == btn.dataset.id);
        Essenza.addToCart(product, 1);
        btn.textContent = '✓';
        setTimeout(() => btn.textContent = '+', 900);
      });
    });

    grid.querySelectorAll('.fav-btn').forEach(btn => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => {
        const product = allLoadedProducts.find(p => p.id == btn.dataset.favId);
        const added = Essenza.toggleWishlist(product);
        btn.classList.toggle('is-fav', added);
        btn.textContent = added ? '♥' : '♡';
      });
    });
  }

  async function loadProducts(append) {
    if (!append) { state.offset = 0; allLoadedProducts = []; }

    const params = new URLSearchParams();
    if (state.category) params.set('category', state.category);
    if (state.q) params.set('q', state.q);
    if (state.wholesale) params.set('mayorista', '1');
    if (state.minPrice) params.set('minPrice', state.minPrice);
    if (state.maxPrice) params.set('maxPrice', state.maxPrice);
    params.set('limit', PAGE_SIZE);
    params.set('offset', state.offset);

    const data = await (await fetch(`/api/products?${params}`)).json();

    if (!append && data.items.length === 0) {
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">${Essenza.t('catalog.empty')}</div>`;
      loadMoreBtn.style.display = 'none';
      return;
    }

    allLoadedProducts = append ? allLoadedProducts.concat(data.items) : data.items;
    const html = data.items.map(productCard).join('');
    grid.innerHTML = append ? grid.innerHTML + html : html;
    bindCardButtons();

    state.offset += data.items.length;
    loadMoreBtn.style.display = data.hasMore ? 'inline-flex' : 'none';
  }

  let searchTimer;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.q = searchInput.value.trim(); loadProducts(false); }, 300);
  });
  wholesaleToggle.addEventListener('change', () => { state.wholesale = wholesaleToggle.checked; loadProducts(false); });

  let priceTimer;
  function bindPriceInput(input, key) {
    if (!input) return;
    input.addEventListener('input', () => {
      clearTimeout(priceTimer);
      priceTimer = setTimeout(() => { state[key] = input.value; loadProducts(false); }, 400);
    });
  }
  bindPriceInput(minPriceInput, 'minPrice');
  bindPriceInput(maxPriceInput, 'maxPrice');

  if (loadMoreBtn) loadMoreBtn.addEventListener('click', () => loadProducts(true));

  document.addEventListener('essenza:langchange', () => { renderChips(); loadProducts(false); });

  renderChips();
  loadProducts(false);
});
