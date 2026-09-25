// public/admin/admin.js

function formatCOP(v) { return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v); }
function showError(msg) {
  const box = document.getElementById('admin-error');
  box.textContent = msg;
  box.style.display = 'block';
  setTimeout(() => box.style.display = 'none', 5000);
}

let currentImages = [];
let brands = [], categories = [];

async function checkAuth() {
  const res = await fetch('/admin/me');
  if (!res.ok) { location.href = '/admin/login.html'; return false; }
  return true;
}

async function loadLookups() {
  brands = await (await fetch('/admin/brands')).json();
  categories = await (await fetch('/admin/categories')).json();
  const brandSelect = document.querySelector('select[name="brand_id"]');
  const catSelect = document.querySelector('select[name="category_id"]');
  brandSelect.innerHTML = brands.map(b => `<option value="${b.id}">${b.name}</option>`).join('');
  catSelect.innerHTML = categories.map(c => `<option value="${c.id}">${c.name_es}</option>`).join('');
}

async function loadProducts() {
  const products = await (await fetch('/admin/products')).json();
  const tbody = document.getElementById('products-tbody');
  tbody.innerHTML = products.map(p => `
    <tr data-id="${p.id}">
      <td>${p.name}<br><span style="color:var(--smoke);font-size:.78rem">${p.sku}</span></td>
      <td>${p.brand_name || '—'}</td>
      <td>${formatCOP(p.price_detal)}</td>
      <td>${p.price_mayor ? formatCOP(p.price_mayor) : '—'}</td>
      <td>${p.stock_qty}</td>
      <td><span class="status-pill status-${p.stock_status}">${p.stock_status}</span> ${p.active ? '' : '<br><small style="color:var(--magenta-bright)">Pausado</small>'}</td>
      <td style="white-space:nowrap">
        <button class="icon-btn edit-btn">Editar</button>
        <button class="icon-btn pause-btn">${p.active ? 'Pausar' : 'Activar'}</button>
        <button class="icon-btn delete-btn">Eliminar</button>
      </td>
    </tr>`).join('');

  tbody.querySelectorAll('tr').forEach(row => {
    const id = row.dataset.id;
    const product = products.find(p => p.id == id);
    row.querySelector('.edit-btn').addEventListener('click', () => openModal(product));
    row.querySelector('.pause-btn').addEventListener('click', async () => {
      const res = await fetch(`/admin/products/${id}/pause`, { method: 'PATCH' });
      if (!res.ok) return showError((await res.json()).error);
      loadProducts();
    });
    row.querySelector('.delete-btn').addEventListener('click', async () => {
      if (!confirm(`¿Eliminar "${product.name}"? Esta acción no se puede deshacer.`)) return;
      const res = await fetch(`/admin/products/${id}`, { method: 'DELETE' });
      if (!res.ok) return showError((await res.json()).error);
      loadProducts();
    });
  });
}

const ESTADOS = [
  { value: 'pendiente', label: 'Pendiente' },
  { value: 'aprobada', label: 'Pagada' },
  { value: 'entregada', label: 'Entregada' },
  { value: 'rechazada', label: 'Cancelada' }
];

function pillClass(estado) {
  if (estado === 'aprobada' || estado === 'entregada') return 'status-disponible';
  if (estado === 'rechazada') return 'status-agotado';
  return 'status-pre-orden';
}

async function loadOrders() {
  const orders = await (await fetch('/admin/orders')).json();
  const tbody = document.getElementById('orders-tbody');

  if (orders.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--smoke);padding:32px">Todavía no hay pedidos.</td></tr>`;
    return;
  }

  tbody.innerHTML = orders.map(o => `
    <tr data-id="${o.id}" data-ref="${o.reference}">
      <td>${o.reference}</td>
      <td>${o.customer_name}<br><span style="color:var(--smoke);font-size:.78rem">${o.customer_phone}</span></td>
      <td>${o.customer_city || '—'}</td>
      <td>${o.shipping_type}${o.shipping_carrier ? ' · ' + o.shipping_carrier : ''}</td>
      <td>${formatCOP(o.total)}</td>
      <td>
        <span class="status-pill ${pillClass(o.payment_status)}">${o.payment_status}</span>
        <select class="status-select" style="margin-top:6px;width:100%;background:var(--carbon);border:1px solid var(--carbon-line);border-radius:3px;padding:4px 6px;color:var(--white);font-size:.78rem">
          ${ESTADOS.map(e => `<option value="${e.value}" ${o.payment_status === e.value ? 'selected' : ''}>${e.label}</option>`).join('')}
        </select>
      </td>
      <td>${new Date(o.created_at).toLocaleString('es-CO')}</td>
      <td style="white-space:nowrap">
        <a class="icon-btn" href="/checkout/invoice/${o.reference}" target="_blank" rel="noopener">Factura</a>
        <a class="icon-btn" href="https://wa.me/${(o.customer_phone || '').replace(/\D/g, '')}" target="_blank" rel="noopener">WhatsApp</a>
        <button class="icon-btn delete-order-btn" style="color:var(--magenta-bright);border-color:var(--magenta-bright)">Eliminar</button>
      </td>
    </tr>`).join('');

  tbody.querySelectorAll('tr[data-id]').forEach(row => {
    const id = row.dataset.id;

    const select = row.querySelector('.status-select');
    if (select) {
      select.addEventListener('change', async () => {
        const res = await fetch(`/admin/orders/${id}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ payment_status: select.value })
        });
        if (!res.ok) showError((await res.json()).error || 'No se pudo actualizar el pedido.');
        loadOrders();
      });
    }

    const delBtn = row.querySelector('.delete-order-btn');
    if (delBtn) {
      delBtn.addEventListener('click', async () => {
        if (!confirm(`¿Eliminar el pedido ${row.dataset.ref}? Esta acción no se puede deshacer.`)) return;
        const res = await fetch(`/admin/orders/${id}`, { method: 'DELETE' });
        if (!res.ok) return showError((await res.json()).error || 'No se pudo eliminar el pedido.');
        loadOrders();
      });
    }
  });
}

async function loadReviews() {
  const reviews = await (await fetch('/admin/reviews')).json();
  const tbody = document.getElementById('reviews-tbody');

  if (reviews.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--smoke);padding:32px">Todavía no hay reseñas.</td></tr>`;
    return;
  }

  tbody.innerHTML = reviews.map(r => `
    <tr data-id="${r.id}">
      <td>${r.product_name || '—'}</td>
      <td>${r.customer_name}</td>
      <td style="color:var(--gold);white-space:nowrap">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</td>
      <td style="max-width:320px">${r.comment ? r.comment : '<span style="color:var(--smoke)">(sin comentario)</span>'}</td>
      <td><span class="status-pill ${r.approved ? 'status-disponible' : 'status-pre-orden'}">${r.approved ? 'publicada' : 'pendiente'}</span></td>
      <td style="white-space:nowrap">
        <button class="icon-btn approve-review-btn">${r.approved ? 'Ocultar' : 'Publicar'}</button>
        <button class="icon-btn delete-review-btn" style="color:var(--magenta-bright);border-color:var(--magenta-bright)">Eliminar</button>
      </td>
    </tr>`).join('');

  tbody.querySelectorAll('tr[data-id]').forEach(row => {
    const id = row.dataset.id;
    row.querySelector('.approve-review-btn').addEventListener('click', async () => {
      const res = await fetch(`/admin/reviews/${id}/approve`, { method: 'PATCH' });
      if (!res.ok) return showError((await res.json()).error);
      loadReviews();
    });
    row.querySelector('.delete-review-btn').addEventListener('click', async () => {
      if (!confirm('¿Eliminar esta reseña? Esta acción no se puede deshacer.')) return;
      const res = await fetch(`/admin/reviews/${id}`, { method: 'DELETE' });
      if (!res.ok) return showError((await res.json()).error);
      loadReviews();
    });
  });
}

// ---------- CATEGORÍAS Y MARCAS ----------

async function loadTaxonomy() {
  await loadLookups(); // refresca los selects del formulario de productos

  // --- Categorías ---
  const catBody = document.getElementById('categories-tbody');
  catBody.innerHTML = categories.map(c => `
    <tr data-id="${c.id}">
      <td>${c.name_es}</td>
      <td>${c.name_en}</td>
      <td><span style="color:var(--smoke);font-size:.78rem">${c.slug}</span></td>
      <td style="white-space:nowrap">
        <button class="icon-btn edit-cat-btn">Editar</button>
        <button class="icon-btn delete-cat-btn" style="color:var(--magenta-bright);border-color:var(--magenta-bright)">Eliminar</button>
      </td>
    </tr>`).join('');

  catBody.querySelectorAll('tr[data-id]').forEach(row => {
    const id = row.dataset.id;
    const cat = categories.find(c => c.id == id);
    row.querySelector('.edit-cat-btn').addEventListener('click', () => openCategoryModal(cat));
    row.querySelector('.delete-cat-btn').addEventListener('click', async () => {
      if (!confirm(`¿Eliminar la categoría "${cat.name_es}"?`)) return;
      const res = await fetch(`/admin/categories/${id}`, { method: 'DELETE' });
      if (!res.ok) return showError((await res.json()).error);
      loadTaxonomy();
    });
  });

  // --- Marcas ---
  const brandBody = document.getElementById('brands-tbody');
  brandBody.innerHTML = brands.map(b => {
    const cat = categories.find(c => c.id === b.category_id);
    return `
      <tr data-id="${b.id}">
        <td>${b.name}</td>
        <td>${cat ? cat.name_es : '<span style="color:var(--magenta-bright)">sin categoría</span>'}</td>
        <td style="white-space:nowrap">
          <button class="icon-btn edit-brand-btn">Editar</button>
          <button class="icon-btn delete-brand-btn" style="color:var(--magenta-bright);border-color:var(--magenta-bright)">Eliminar</button>
        </td>
      </tr>`;
  }).join('');

  brandBody.querySelectorAll('tr[data-id]').forEach(row => {
    const id = row.dataset.id;
    const brand = brands.find(b => b.id == id);
    row.querySelector('.edit-brand-btn').addEventListener('click', () => openBrandModal(brand));
    row.querySelector('.delete-brand-btn').addEventListener('click', async () => {
      if (!confirm(`¿Eliminar la marca "${brand.name}"?`)) return;
      const res = await fetch(`/admin/brands/${id}`, { method: 'DELETE' });
      if (!res.ok) return showError((await res.json()).error);
      loadTaxonomy();
    });
  });
}

function openCategoryModal(cat) {
  const form = document.getElementById('category-form');
  form.reset();
  form.elements['id'].value = cat ? cat.id : '';
  document.getElementById('category-modal-title').textContent = cat ? 'Editar categoría' : 'Nueva categoría';
  if (cat) {
    form.name_es.value = cat.name_es || '';
    form.name_en.value = cat.name_en || '';
    form.slug.value = cat.slug || '';
    form.description_es.value = cat.description_es || '';
    form.description_en.value = cat.description_en || '';
  }
  document.getElementById('category-modal').classList.add('open');
}

function openBrandModal(brand) {
  const form = document.getElementById('brand-form');
  form.reset();
  form.elements['id'].value = brand ? brand.id : '';
  document.getElementById('brand-modal-title').textContent = brand ? 'Editar marca' : 'Nueva marca';
  form.category_id.innerHTML = categories.map(c => `<option value="${c.id}">${c.name_es}</option>`).join('');
  if (brand) {
    form.name.value = brand.name || '';
    form.category_id.value = brand.category_id || '';
  }
  document.getElementById('brand-modal').classList.add('open');
}

async function saveCategory(e) {
  e.preventDefault();
  const form = e.target;
  const id = form.elements['id'].value;
  const payload = {
    name_es: form.name_es.value, name_en: form.name_en.value, slug: form.slug.value,
    description_es: form.description_es.value, description_en: form.description_en.value
  };
  const res = await fetch(id ? `/admin/categories/${id}` : '/admin/categories', {
    method: id ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) return showError((await res.json()).error);
  document.getElementById('category-modal').classList.remove('open');
  loadTaxonomy();
}

async function saveBrand(e) {
  e.preventDefault();
  const form = e.target;
  const id = form.elements['id'].value;
  const payload = { name: form.name.value, category_id: +form.category_id.value };
  const res = await fetch(id ? `/admin/brands/${id}` : '/admin/brands', {
    method: id ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) return showError((await res.json()).error);
  document.getElementById('brand-modal').classList.remove('open');
  loadTaxonomy();
}

function openModal(product) {
  const form = document.getElementById('product-form');
  form.reset();
  currentImages = [];
  document.getElementById('image-preview').innerHTML = '';
  document.getElementById('modal-title').textContent = product ? 'Editar producto' : 'Nuevo producto';

  if (product) {
    for (const key of Object.keys(product)) {
      if (form.elements[key]) form.elements[key].value = product[key] ?? '';
    }
    currentImages = product.images || [];
    renderImagePreview();
  }
  document.getElementById('product-modal').classList.add('open');
}

function closeModal() { document.getElementById('product-modal').classList.remove('open'); }

function renderImagePreview() {
  document.getElementById('image-preview').innerHTML = currentImages.map(src => `<img src="${src}" style="width:56px;height:56px;object-fit:cover;border-radius:4px;border:1px solid var(--carbon-line)">`).join('');
}

async function handleImageUpload(files) {
  if (!files.length) return;
  const formData = new FormData();
  for (const f of files) formData.append('images', f);
  const res = await fetch('/admin/upload', { method: 'POST', body: formData });
  const data = await res.json();
  if (!res.ok) return showError(data.error);
  currentImages = currentImages.concat(data.paths);
  renderImagePreview();
}

async function saveProduct(e) {
  e.preventDefault();
  const form = e.target;
  const id = form.elements['id'].value;
  const payload = {
    name: form.name.value, sku: form.sku.value, brand_id: +form.brand_id.value, category_id: +form.category_id.value,
    price_detal: +form.price_detal.value,
    compare_at_price: form.compare_at_price && form.compare_at_price.value ? +form.compare_at_price.value : null,
    price_mayor: form.price_mayor.value ? +form.price_mayor.value : null,
    mayor_min_qty: +form.mayor_min_qty.value || 6,
    presentation_value: +form.presentation_value.value, presentation_unit: form.presentation_unit.value,
    weight_grams: +form.weight_grams.value, stock_status: form.stock_status.value, stock_qty: +form.stock_qty.value,
    notes_salida: form.notes_salida.value, notes_corazon: form.notes_corazon.value, notes_fondo: form.notes_fondo.value,
    description_es: form.description_es.value, description_en: form.description_en.value,
    images: currentImages, active: true
  };

  const url = id ? `/admin/products/${id}` : '/admin/products';
  const method = id ? 'PUT' : 'POST';
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await res.json();
  if (!res.ok) return showError(data.error);
  closeModal();
  loadProducts();
}

document.addEventListener('DOMContentLoaded', async () => {
  if (!(await checkAuth())) return;
  await loadLookups();
  await loadProducts();

  document.getElementById('new-product-btn').addEventListener('click', () => openModal(null));
  document.getElementById('cancel-modal-btn').addEventListener('click', closeModal);
  document.getElementById('product-form').addEventListener('submit', saveProduct);
  document.getElementById('image-input').addEventListener('change', (e) => handleImageUpload(e.target.files));

  document.getElementById('new-category-btn').addEventListener('click', () => openCategoryModal(null));
  document.getElementById('new-brand-btn').addEventListener('click', () => openBrandModal(null));
  document.getElementById('category-form').addEventListener('submit', saveCategory);
  document.getElementById('brand-form').addEventListener('submit', saveBrand);
  document.getElementById('cancel-category-btn').addEventListener('click', () => document.getElementById('category-modal').classList.remove('open'));
  document.getElementById('cancel-brand-btn').addEventListener('click', () => document.getElementById('brand-modal').classList.remove('open'));

  document.getElementById('logout-link').addEventListener('click', async (e) => {
    e.preventDefault();
    await fetch('/admin/logout', { method: 'POST' });
    location.href = '/admin/login.html';
  });

  document.querySelectorAll('.nav-link[data-view]').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      document.querySelectorAll('.nav-link[data-view]').forEach(l => l.classList.remove('active'));
      link.classList.add('active');
      const view = link.dataset.view;
      const titulos = { products: 'Productos', orders: 'Pedidos', reviews: 'Reseñas', taxonomy: 'Categorías y marcas' };
      ['products', 'orders', 'reviews', 'taxonomy'].forEach(v => {
        const el = document.getElementById(`view-${v}`);
        if (el) el.style.display = view === v ? 'block' : 'none';
      });
      document.getElementById('view-title').textContent = titulos[view] || '';
      document.getElementById('new-product-btn').style.display = view === 'products' ? 'inline-flex' : 'none';
      if (view === 'orders') loadOrders();
      if (view === 'reviews') loadReviews();
      if (view === 'taxonomy') loadTaxonomy();
    });
  });
});
