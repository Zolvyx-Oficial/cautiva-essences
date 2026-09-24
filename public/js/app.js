// public/js/app.js
// Núcleo compartido: header/footer, i18n, utilidades de carrito, favoritos y formato de moneda.

const Essenza = (() => {
  const CART_KEY = 'essenza_cart_v1';
  const LANG_KEY = 'essenza_lang';
  const WISHLIST_KEY = 'essenza_wishlist_v1';

  function formatCOP(value) {
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value);
  }

  // ---------------- i18n ----------------
  let dict = {};
  function getLang() { return localStorage.getItem(LANG_KEY) || 'es'; }
  function setLang(lang) { localStorage.setItem(LANG_KEY, lang); }

  async function loadLocale(lang) {
    const res = await fetch(`/locales/${lang}.json`);
    dict = await res.json();
  }

  function t(key) { return dict[key] || key; }

  function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      el.textContent = t(key);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
    });
    document.querySelectorAll('.lang-switch button').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.lang === getLang());
    });
    document.documentElement.lang = getLang();
  }

  async function initI18n() {
    await loadLocale(getLang());
    applyI18n();
    document.querySelectorAll('.lang-switch button').forEach(btn => {
      btn.addEventListener('click', async () => {
        setLang(btn.dataset.lang);
        await loadLocale(btn.dataset.lang);
        applyI18n();
        document.dispatchEvent(new CustomEvent('essenza:langchange'));
      });
    });
  }

  // ---------------- Carrito ----------------
  function getCart() {
    try { return JSON.parse(localStorage.getItem(CART_KEY)) || []; }
    catch { return []; }
  }
  function saveCart(cart) {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    updateCartBadge();
  }
  function addToCart(product, qty = 1) {
    const cart = getCart();
    const existing = cart.find(i => i.productId === product.id);
    if (existing) existing.qty += qty;
    else cart.push({
      productId: product.id, name: product.name, brand: product.brand_name,
      price: product.display_price ?? product.price_detal, image: (product.images && product.images[0]) || null, qty
    });
    saveCart(cart);
  }
  function removeFromCart(productId) {
    saveCart(getCart().filter(i => i.productId !== productId));
  }
  function updateQty(productId, qty) {
    const cart = getCart();
    const item = cart.find(i => i.productId === productId);
    if (item) { item.qty = Math.max(1, qty); saveCart(cart); }
  }
  function clearCart() { saveCart([]); }
  function cartCount() { return getCart().reduce((sum, i) => sum + i.qty, 0); }
  function cartSubtotal() { return getCart().reduce((sum, i) => sum + i.price * i.qty, 0); }
  function updateCartBadge() {
    document.querySelectorAll('.cart-count').forEach(el => el.textContent = cartCount());
  }

  // ---------------- Favoritos (wishlist) ----------------
  function getWishlist() {
    try { return JSON.parse(localStorage.getItem(WISHLIST_KEY)) || []; }
    catch { return []; }
  }
  function saveWishlist(list) {
    localStorage.setItem(WISHLIST_KEY, JSON.stringify(list));
    updateWishlistBadge();
  }
  function isInWishlist(productId) {
    return getWishlist().some(i => i.productId === productId);
  }
  function toggleWishlist(product) {
    const list = getWishlist();
    const idx = list.findIndex(i => i.productId === product.id);
    if (idx >= 0) {
      list.splice(idx, 1);
      saveWishlist(list);
      return false; // ya no está en favoritos
    }
    list.push({
      productId: product.id,
      name: product.name,
      brand: product.brand_name,
      price: product.display_price ?? product.price_detal,
      image: (product.images && product.images[0]) || null,
      presentation: `${product.presentation_value}${product.presentation_unit}`
    });
    saveWishlist(list);
    return true; // agregado a favoritos
  }
  function removeFromWishlist(productId) {
    saveWishlist(getWishlist().filter(i => i.productId !== productId));
  }
  function wishlistCount() { return getWishlist().length; }
  function updateWishlistBadge() {
    document.querySelectorAll('.wishlist-count').forEach(el => {
      el.textContent = wishlistCount();
      el.style.display = wishlistCount() > 0 ? 'inline-flex' : 'none';
    });
  }

  // ---------------- Layout compartido ----------------
  function renderHeader(activePage = '') {
    const el = document.getElementById('site-header');
    if (!el) return;
    el.innerHTML = `
      <div class="header-row">
        <a href="/index.html" class="brand">
          <img src="/img/logo.jpg" alt="Cautiva Essences" onerror="this.style.display='none'">
          <span>
            <span class="brand-name">Cautiva Essences</span>
            <span class="brand-tagline">Tu firma invisible</span>
          </span>
        </a>
        <nav class="main-nav">
          <a href="/index.html" data-i18n="nav.home" class="${activePage === 'home' ? 'active' : ''}"></a>
          <a href="/index.html#catalogo" data-i18n="nav.catalog" class="${activePage === 'catalog' ? 'active' : ''}"></a>
          <a href="/index.html?mayorista=1#catalogo" data-i18n="nav.wholesale"></a>
        </nav>
        <div class="header-actions">
          <div class="lang-switch">
            <button data-lang="es">ES</button>
            <button data-lang="en">EN</button>
          </div>
          <a href="/wishlist.html" class="cart-btn" aria-label="Favoritos" title="Favoritos">
            <span>♥</span>
            <span class="wishlist-count cart-count-badge">0</span>
          </a>
          <a href="/cart.html" class="cart-btn">
            <span data-i18n="nav.cart"></span>
            <span class="cart-count">0</span>
          </a>
        </div>
      </div>`;
    updateCartBadge();
    updateWishlistBadge();
  }

  function renderFooter() {
    const el = document.getElementById('site-footer');
    if (!el) return;
    el.innerHTML = `
      <div class="container">
        <div class="footer-grid">
          <div>
            <span class="brand-name" style="font-size:1.3rem">Cautiva Essences</span>
            <p data-i18n="footer.brand_desc" style="margin-top:10px"></p>
          </div>
          <div>
            <h4 data-i18n="footer.explore"></h4>
            <ul>
              <li><a href="/index.html" data-i18n="nav.home"></a></li>
              <li><a href="/index.html#catalogo" data-i18n="nav.catalog"></a></li>
              <li><a href="/wishlist.html">Favoritos</a></li>
              <li><a href="/cart.html" data-i18n="nav.cart"></a></li>
            </ul>
          </div>
          <div>
            <h4 data-i18n="footer.contact"></h4>
            <ul>
              <li>Rionegro, Antioquia, Colombia</li>
              <li><a href="https://wa.me/573196812111" target="_blank" rel="noopener">WhatsApp: +57 319 681 2111</a></li>
            </ul>
          </div>
        </div>
        <div class="footer-bottom">
          <span>© ${new Date().getFullYear()} Cautiva Essences. <span data-i18n="footer.rights"></span></span>
          <span style="display:flex;align-items:center;gap:16px">
            <span style="opacity:.5">Sitio hecho con ⚡ por Zolvyx</span>
            <a href="/admin/login.html" style="opacity:.5">Admin</a>
          </span>
        </div>
      </div>`;
  }

  return {
    formatCOP, t, getLang, initI18n, applyI18n,
    getCart, addToCart, removeFromCart, updateQty, clearCart, cartCount, cartSubtotal, updateCartBadge,
    getWishlist, toggleWishlist, isInWishlist, removeFromWishlist, wishlistCount, updateWishlistBadge,
    renderHeader, renderFooter
  };
})();
