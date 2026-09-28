// public/admin/admin.js

function formatCOP(v) { return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v); }
function showError(msg) {
  const box = document.getElementById('admin-error');
  box.textContent = msg;
  box.style.display = 'block';
  setTimeout(() => box.style.display = 'none', 5000);
}

// Evita que un nombre o comentario con < > rompa la tabla
function escapeHTML(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

let currentImages = [];
let brands = [], categories = [];
let orderItemsByOrder = {};

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
  brandSelect.innerHTML = brands.map(b => `<option value="${b.id}">${escapeHTML(b.name)}</option>`).join('');
  catSelect.innerHTML = categories.map(c => `<option value="${c.id}">${escapeHTML(c.name_es)}</option>`).join('');
}

async function loadProducts() {
  const products = await (await fetch('/admin/products')).json();
  const tbody = document.getElementById('products-tbody');
  tbody.innerHTML = products.map(p => `
    <tr data-id="${p.id}">
      <td>${escapeHTML(p.name)}<br><span style="color:var(--smoke);font-size:.78rem">${escapeHTML(p.sku)}</span></td>
      <td>${escapeHTML(p.brand_name) || '—'}</td>
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

// ---------- PEDIDOS ----------

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

// Trae de una sola vez los productos de todos los pedidos y los agrupa por pedido
async function loadOrderItems() {
  orderItemsByOrder = {};
  try {
    const res = await fetch('/admin/order-items');
    if (!res.ok) return;
    const rows = await res.json();
    if (!Array.isArray(rows)) return;
    for (const r of rows) {
      if (!orderItemsByOrder[r.order_id]) orderItemsByOrder[r.order_id] = [];
      orderItemsByOrder[r.order_id].push(r);
    }
  } catch (e) {
    console.warn('No se pudieron cargar los productos de los pedidos:', e.message);
  }
}

// Arma el HTML de la columna PRODUCTOS de un pedido
function itemsHTML(orderId) {
  const items = orderItemsByOrder[orderId];
  if (!items || !items.length) {
    return '<span style="color:var(--smoke);font-size:.78rem">sin detalle</span>';
  }

  return items.map(it => {
    const qty = it.qty ?? it.quantity ?? it.cantidad ?? 1;
    const nombre = it.product_name || it.name || 'Producto';
    const pres = it.presentation_value ? ` ${it.presentation_value}${it.presentation_unit || ''}` : '';
    const marca = it.brand_name ? ` · ${escapeHTML(it.brand_name)}` : '';
    return `<div style="margin-bottom:5px;line-height:1.35;font-size:.82rem">
      <strong style="color:var(--gold)">${qty} ×</strong> ${escapeHTML(nombre)}${escapeHTML(pres)}
      <span style="color:var(--smoke);font-size:.74rem">${marca}</span>
    </div>`;
  }).join('');
}

// Agrega la columna PRODUCTOS al encabezado de la tabla (no hay que tocar el HTML)
function ensureProductsHeader() {
  const tbody = document.getElementById('orders-tbody');
  const table = tbody && tbody.closest('table');
  if (!table) return;
  const headRow = table.querySelector('thead tr');
  if (!headRow || headRow.querySelector('.th-productos')) return;

  const th = document.createElement('th');
  th.className = 'th-productos';
  th.textContent = 'Productos';
  if (headRow.children.length >= 3) headRow.insertBefore(th, headRow.children[2]);
  else headRow.appendChild(th);
}

async function loadOrders() {
  ensureProductsHeader();

  const [orders] = await Promise.all([
    (await fetch('/admin/orders')).json(),
    loadOrderItems()
  ]);

  const tbody = document.getElementById('orders-tbody');

  if (!orders || orders.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--smoke);padding:32px">Todavía no hay pedidos.</td></tr>`;
    return;
  }

  tbody.innerHTML = orders.map(o => `
    <tr data-id="${o.id}" data-ref="${escapeHTML(o.reference)}">
      <td style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.72rem;word-break:break-all;max-width:120px">${escapeHTML(o.reference)}</td>
      <td>${escapeHTML(o.customer_name)}<br><span style="color:var(--smoke);font-size:.78rem">${escapeHTML(o.customer_phone)}</span></td>
      <td style="min-width:190px">${itemsHTML(o.id)}</td>
      <td>${escapeHTML(o.customer_city) || '—'}</td>
      <td>${escapeHTML(o.shipping_type)}${o.shipping_carrier ? ' · ' + escapeHTML(o.shipping_carrier) : ''}</td>
      <td>${formatCOP(o.total)}</td>
      <td>
        <span class="status-pill ${pillClass(o.payment_status)}">${o.payment_status}</span>
        <select class="status-select" style="margin-top:6px;width:100%;background:var(--carbon);border:1px solid var(--carbon-line);border-radius:3px;padding:4px 6px;color:var(--white);font-size:.78rem">
          ${ESTADOS.map(e => `<option value="${e.value}" ${o.payment_status === e.value ? 'selected' : ''}>${e.label}</option>`).join('')}
        </select>
      </td>
      <td>${new Date(o.created_at).toLocaleString('es-CO')}</td>
      <td style="white-space:nowrap">
        <a class="icon-btn" href="/checkout/invoice/${encodeURIComponent(o.reference)}" target="_blank" rel="noopener">Factura</a>
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

// ---------- RESEÑAS ----------

async function loadReviews() {
  const reviews = await (await fetch('/admin/reviews')).json();
  const tbody = document.getElementById('reviews-tbody');

  if (reviews.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--smoke);padding:32px">Todavía no hay reseñas.</td></tr>`;
    return;
  }

  tbody.innerHTML = reviews.map(r => `
    <tr data-id="${r.id}">
      <td>${escapeHTML(r.product_name) || '—'}</td>
      <td>${escapeHTML(r.customer_name)}</td>
      <td style="color:var(--gold);white-space:nowrap">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</td>
      <td style="max-width:320px">${r.comment ? escapeHTML(r.comment) : '<span style="color:var(--smoke)">(sin comentario)</span>'}</td>
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
      <td>${escapeHTML(c.name_es)}</td>
      <td>${escapeHTML(c.name_en)}</td>
      <td><span style="color:var(--smoke);font-size:.78rem">${escapeHTML(c.slug)}</span></td>
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
        <td>${escapeHTML(b.name)}</td>
        <td>${cat ? escapeHTML(cat.name_es) : '<span style="color:var(--magenta-bright)">sin categoría</span>'}</td>
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
  form.category_id.innerHTML = categories.map(c => `<option value="${c.id}">${escapeHTML(c.name_es)}</option>`).join('');
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

// ---------- ALTA RÁPIDA DE MARCA Y CATEGORÍA ----------
// Agrega un botón "+ Nueva" debajo de cada menú del formulario de producto,
// para crear marcas y categorías sin salir de la ventana ni perder lo escrito.

function montarAltaRapida() {
  const brandSelect = document.querySelector('select[name="brand_id"]');
  const catSelect = document.querySelector('select[name="category_id"]');
  if (catSelect) montarBotonRapido(catSelect, 'categoria');
  if (brandSelect) montarBotonRapido(brandSelect, 'marca');
}

function montarBotonRapido(select, tipo) {
  if (select.dataset.altaRapida) return; // evita duplicar el botón
  select.dataset.altaRapida = '1';

  const esMarca = tipo === 'marca';
  const etiqueta = esMarca ? 'marca' : 'categoría';

  const wrap = document.createElement('div');
  wrap.style.marginTop = '6px';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = esMarca ? '+ Nueva marca' : '+ Nueva categoría';
  btn.style.cssText = 'background:transparent;border:1px dashed var(--carbon-line);color:var(--gold);border-radius:4px;padding:4px 10px;font-size:.76rem;cursor:pointer';

  const panel = document.createElement('div');
  panel.className = 'alta-panel';
  panel.style.cssText = 'display:none;margin-top:8px;padding:10px;border:1px solid var(--carbon-line);border-radius:6px;background:rgba(0,0,0,.35)';
  panel.innerHTML = `
    <label style="display:block;font-size:.74rem;color:var(--smoke);margin-bottom:4px">Nombre de la nueva ${etiqueta}</label>
    <input type="text" class="alta-input" placeholder="${esMarca ? 'Ej: Yara' : 'Ej: Perfumería Árabe'}"
      style="width:100%;background:#14141a;border:1px solid var(--carbon-line);border-radius:4px;padding:7px 9px;color:#fff;font-size:.85rem">
    <div class="alta-msg" style="font-size:.72rem;color:var(--smoke);margin-top:6px"></div>
    <div style="margin-top:8px;display:flex;gap:6px">
      <button type="button" class="alta-save icon-btn">Guardar</button>
      <button type="button" class="alta-cancel icon-btn">Cancelar</button>
    </div>`;

  select.parentNode.insertBefore(wrap, select.nextSibling);
  wrap.appendChild(btn);
  wrap.appendChild(panel);

  const input = panel.querySelector('.alta-input');
  const msg = panel.querySelector('.alta-msg');

  function avisoCategoria() {
    const catSelect = document.querySelector('select[name="category_id"]');
    const opt = catSelect && catSelect.selectedOptions[0];
    return opt ? `Se va a crear dentro de la categoría: ${opt.textContent}` : 'Primero elige una categoría.';
  }

  btn.addEventListener('click', () => {
    const abierto = panel.style.display === 'block';
    panel.style.display = abierto ? 'none' : 'block';
    if (!abierto) {
      input.value = '';
      msg.style.color = 'var(--smoke)';
      msg.textContent = esMarca ? avisoCategoria() : '';
      input.focus();
    }
  });

  panel.querySelector('.alta-cancel').addEventListener('click', () => { panel.style.display = 'none'; });
  panel.querySelector('.alta-save').addEventListener('click', guardar);

  // Enter guarda la marca/categoría, sin enviar el formulario del producto
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); guardar(); }
  });

  async function guardar() {
    const nombre = input.value.trim();
    msg.style.color = 'var(--magenta-bright)';

    if (!nombre) { msg.textContent = `Escribe el nombre de la ${etiqueta}.`; return; }

    let url, payload;
    if (esMarca) {
      const catSelect = document.querySelector('select[name="category_id"]');
      const catId = catSelect ? +catSelect.value : 0;
      if (!catId) { msg.textContent = 'Primero elige una categoría.'; return; }
      url = '/admin/brands';
      payload = { name: nombre, category_id: catId };
    } else {
      url = '/admin/categories';
      payload = { name_es: nombre, name_en: nombre };
    }

    msg.style.color = 'var(--smoke)';
    msg.textContent = 'Guardando...';

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) {
        msg.style.color = 'var(--magenta-bright)';
        msg.textContent = data.error || 'No se pudo guardar.';
        return;
      }
      await refrescarSelects(tipo, data.id);
      panel.style.display = 'none';
    } catch (err) {
      msg.style.color = 'var(--magenta-bright)';
      msg.textContent = 'Error de conexión: ' + err.message;
    }
  }
}

// Recarga los dos menús y deja seleccionado lo recién creado,
// sin perder lo que ya estaba elegido en el otro.
async function refrescarSelects(tipo, nuevoId) {
  const brandSelect = document.querySelector('select[name="brand_id"]');
  const catSelect = document.querySelector('select[name="category_id"]');
  const brandPrev = brandSelect ? brandSelect.value : '';
  const catPrev = catSelect ? catSelect.value : '';

  brands = await (await fetch('/admin/brands')).json();
  categories = await (await fetch('/admin/categories')).json();

  if (brandSelect) brandSelect.innerHTML = brands.map(b => `<option value="${b.id}">${escapeHTML(b.name)}</option>`).join('');
  if (catSelect) catSelect.innerHTML = categories.map(c => `<option value="${c.id}">${escapeHTML(c.name_es)}</option>`).join('');

  if (brandSelect) brandSelect.value = tipo === 'marca' ? nuevoId : brandPrev;
  if (catSelect) catSelect.value = tipo === 'categoria' ? nuevoId : catPrev;
}

// ---------- PRODUCTO: MODAL E IMÁGENES ----------

function openModal(product) {
  const form = document.getElementById('product-form');
  form.reset();
  document.querySelectorAll('.alta-panel').forEach(p => { p.style.display = 'none'; });
  currentImages = [];
  document.getElementById('modal-title').textContent = product ? 'Editar producto' : 'Nuevo producto';

  if (product) {
    for (const key of Object.keys(product)) {
      if (form.elements[key]) form.elements[key].value = product[key] ?? '';
    }
    // copia, para que quitar o reordenar no toque la lista original
    currentImages = Array.isArray(product.images) ? product.images.slice() : [];
  }

  renderImagePreview();
  document.getElementById('product-modal').classList.add('open');
}

function closeModal() { document.getElementById('product-modal').classList.remove('open'); }

function renderImagePreview() {
  const box = document.getElementById('image-preview');
  if (!box) return;

  if (!currentImages.length) {
    box.innerHTML = '<span style="color:var(--smoke);font-size:.82rem">Sin imágenes todavía. Súbelas con el botón de arriba.</span>';
    return;
  }

  box.innerHTML = currentImages.map((src, i) => `
    <div style="position:relative;display:inline-block;margin:0 10px 10px 0;text-align:center;vertical-align:top">
      <img src="${src}" style="width:74px;height:74px;object-fit:cover;border-radius:6px;display:block;border:2px solid ${i === 0 ? '#e0218a' : 'var(--carbon-line)'}">
      <button type="button" class="img-del" data-i="${i}" title="Quitar esta imagen"
        style="position:absolute;top:-7px;right:-7px;width:22px;height:22px;border-radius:50%;border:none;background:#c0392b;color:#fff;font-size:12px;line-height:22px;cursor:pointer;padding:0">✕</button>
      <div style="margin-top:4px;display:flex;gap:3px;justify-content:center">
        <button type="button" class="img-left" data-i="${i}" ${i === 0 ? 'disabled' : ''} title="Mover antes"
          style="width:28px;border:1px solid var(--carbon-line);background:transparent;color:inherit;border-radius:4px;cursor:pointer;font-size:11px">◀</button>
        <button type="button" class="img-right" data-i="${i}" ${i === currentImages.length - 1 ? 'disabled' : ''} title="Mover después"
          style="width:28px;border:1px solid var(--carbon-line);background:transparent;color:inherit;border-radius:4px;cursor:pointer;font-size:11px">▶</button>
      </div>
      <div style="font-size:.66rem;margin-top:3px;color:${i === 0 ? '#e0218a' : 'var(--smoke)'}">${i === 0 ? 'Principal' : i + 1}</div>
    </div>`).join('');

  box.querySelectorAll('.img-del').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm('¿Quitar esta imagen del producto?')) return;
      currentImages.splice(+btn.dataset.i, 1);
      renderImagePreview();
    });
  });

  box.querySelectorAll('.img-left').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = +btn.dataset.i;
      [currentImages[i - 1], currentImages[i]] = [currentImages[i], currentImages[i - 1]];
      renderImagePreview();
    });
  });

  box.querySelectorAll('.img-right').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = +btn.dataset.i;
      [currentImages[i], currentImages[i + 1]] = [currentImages[i + 1], currentImages[i]];
      renderImagePreview();
    });
  });
}

async function handleImageUpload(files) {
  if (!files.length) return;
  const formData = new FormData();
  for (const f of files) formData.append('images', f);
  const res = await fetch('/admin/upload', { method: 'POST', body: formData });
  const data = await res.json();
  const input = document.getElementById('image-input');
  if (input) input.value = ''; // permite volver a subir el mismo archivo
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
  montarAltaRapida();
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
