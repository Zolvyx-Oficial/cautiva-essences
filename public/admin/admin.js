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
    price_detal: +form.price_detal.value, price_mayor: form.price_mayor.value ? +form.price_mayor.value : null,
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
      document.getElementById('view-products').style.display = view === 'products' ? 'block' : 'none';
      document.getElementById('view-orders').style.display = view === 'orders' ? 'block' : 'none';
      document.getElementById('view-title').textContent = view === 'products' ? 'Productos' : 'Pedidos';
      document.getElementById('new-product-btn').style.display = view === 'products' ? 'inline-flex' : 'none';
      if (view === 'orders') loadOrders();
    });
  });
});
