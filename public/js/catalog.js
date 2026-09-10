// public/js/catalog.js
// Lógica del catálogo: filtros por categoría/marca, búsqueda, alternancia mayorista.

document.addEventListener('DOMContentLoaded', async () => {
  Essenza.renderHeader('catalog');
  Essenza.renderFooter();
  await Essenza.initI18n();

  const grid = document.getElementById('product-grid');
  const chipsWrap = document.getElementById('category-chips');
  const searchInput = document.getElementById('search-input');
  const wholesaleToggle = document.getElementById('wholesale-toggle');

  const urlParams = new URLSearchParams(location.search);
  let state = {
    category: urlParams.get('category') || '',
    q: '',
    wholesale: urlParams.get('mayorista') === '1'
  };
  wholesaleToggle.checked = state.wholesale;

  const categories = await (await fetch('/api/categories')).json();

  function renderChips() {
    const allChip = `<button class="chip ${state.category === '' ? 'active' : ''}" data-slug="">${Essenza.t('catalog.all')}</button>`;
    const catChips = categories.map(c => `<button class="chip ${state.category === c.slug ? 'active' : ''}" data-slug="${c.slug}">${Essenza.getLang() === 'en' ? c.name_en : c.name_es}</button>`).join('');
    chipsWrap.innerHTML = allChip + catChips;
    chipsWrap.querySelectorAll('.chip').forEach(chip => {
      chip.addEventListener('click', () => {
        state.category = chip.dataset.slug;
        renderChips();
        loadProducts();
      });
    });
  }

  function productCard(p) {
    const img = p.images && p.images[0] ? `<img src="${p.images[0]}" alt="${p.name}">` : `<span class="initials">${p.name.slice(0,2).toUpperCase()}</span>`;
    let badge = '';
    if (p.stock_status === 'agotado') badge = `<span class="badge badge-sold">${Essenza.t('catalog.sold_out')}</span>`;
    else if (p.stock_status === 'pre-orden') badge = `<span class="badge badge-preorder">${Essenza.t('catalog.pre_order')}</span>`;

    const priceLabel = state.wholesale && p.price_mayor
      ? `${Essenza.formatCOP(p.price_mayor)} <small>x${p.mayor_min_qty}+ ${Essenza.t('product.units')}</small>`
      : Essenza.formatCOP(p.price_detal);

    return `
      <article class="product-card">
        <a href="/product.html?id=${p.id}" class="thumb">${img}${badge}</a>
        <div class="info">
          <span class="brand-label">${p.brand_name || ''}</span>
          <a href="/product.html?id=${p.id}"><h3>${p.name}</h3></a>
          <span class="ml">${p.presentation_value}${p.presentation_unit}</span>
          <div class="price-row">
            <span class="price">${priceLabel}</span>
            <button class="add-btn" data-id="${p.id}" ${p.stock_status === 'agotado' ? 'disabled' : ''} aria-label="${Essenza.t('catalog.add')}">+</button>
          </div>
        </div>
      </article>`;
  }

  async function loadProducts() {
    const params = new URLSearchParams();
    if (state.category) params.set('category', state.category);
    if (state.q) params.set('q', state.q);
    if (state.wholesale) params.set('mayorista', '1');
    const products = await (await fetch(`/api/products?${params}`)).json();

    if (products.length === 0) {
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">${Essenza.t('catalog.empty')}</div>`;
      return;
    }
    grid.innerHTML = products.map(productCard).join('');
    grid.querySelectorAll('.add-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const product = products.find(p => p.id == btn.dataset.id);
        Essenza.addToCart(product, 1);
        btn.textContent = '✓';
        setTimeout(() => btn.textContent = '+', 900);
      });
    });
  }

  let searchTimer;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.q = searchInput.value.trim(); loadProducts(); }, 300);
  });
  wholesaleToggle.addEventListener('change', () => { state.wholesale = wholesaleToggle.checked; loadProducts(); });

  document.addEventListener('essenza:langchange', () => { renderChips(); loadProducts(); });

  renderChips();
  loadProducts();
});
