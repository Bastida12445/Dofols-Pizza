const STATUS_FLOW = {
  Pending: ['Confirmed', 'Cancelled'], Confirmed: ['Preparing', 'Cancelled'],
  Preparing: ['Ready for Pickup', 'Out for Delivery', 'Cancelled'],
  'Ready for Pickup': ['Completed', 'Cancelled'], 'Out for Delivery': ['Completed', 'Cancelled'],
  Completed: [], Cancelled: []
};
function dateLabel(value) { return value ? new Date(value).toLocaleString('en-PH', { timeZone: 'Asia/Manila' }) : '—'; }
function badge(status) { const cls = ['Paid', 'Completed'].includes(status) ? 'paid' : ['Failed', 'Cancelled'].includes(status) ? 'failed' : 'pending'; return `<span class="status ${cls}">${escapeHtml(status || '—')}</span>`; }
async function ensureAdmin() {
  await window.appReady;
  try {
    const { admin } = await window.api('/api/admin/me');
    document.querySelectorAll('[data-admin-name]').forEach((node) => { node.textContent = admin.name; });
    return admin;
  } catch {
    const client = window.getSupabaseClient();
    await client?.auth.signOut();
    await fetch('/api/admin/session', { method: 'DELETE' });
    location.replace('/admin/login.html');
    return null;
  }
}
function orderItems(order) {
  return (order.order_items || []).map((item) => `${item.quantity} × ${escapeHtml(item.product_name_snapshot)} (${escapeHtml(item.size_name_snapshot)})`).join('<br>') || '—';
}
async function loadDashboard() {
  const [reportData, orderData] = await Promise.all([window.api('/api/admin/reports'), window.api('/api/admin/orders')]);
  const report = reportData.report;
  document.getElementById('dashboard-metrics').innerHTML = [
    ['Total orders', report.total_orders], ['Pending orders', report.pending_orders],
    ['Confirmed payments', report.confirmed_payments], ['Net collected', money(report.net_collected)]
  ].map(([label, value]) => `<div class="metric"><small>${label}</small><strong>${value}</strong></div>`).join('');
  const recent = orderData.orders.slice(0, 8);
  document.getElementById('recent-orders').innerHTML = recent.length ? `<table class="data-table"><thead><tr><th>Order</th><th>Customer</th><th>Type</th><th>Total</th><th>Status</th><th>Placed</th></tr></thead><tbody>${recent.map((o) => `<tr><td>${escapeHtml(o.order_number)}</td><td>${escapeHtml(o.customer_name)}</td><td>${escapeHtml(o.order_type)}</td><td>${money(o.total_amount)}</td><td>${badge(o.order_status)}</td><td>${dateLabel(o.created_at)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty-state">No orders have been placed yet.</div>';
}
let productCache = [];
let productPreviewObjectUrl = null;
function renderProducts() {
  const products = productCache;
  document.getElementById('product-list').innerHTML = products.length ? `<table class="data-table"><thead><tr><th>Product</th><th>Sizes and prices</th><th>Availability</th><th>Actions</th></tr></thead><tbody>${products.map((p) => `<tr><td><strong>${escapeHtml(p.name)}</strong><br><small>${escapeHtml(p.category)}</small>${p.is_archived ? '<br><span class="status failed">Archived</span>' : ''}</td><td>${(p.product_sizes || []).map((s) => `${escapeHtml(s.size_name)} · ${money(s.price)} ${s.is_available ? '' : '(unavailable)'}`).join('<br>')}</td><td>${p.is_available && !p.is_archived ? 'Available' : 'Unavailable'}</td><td class="inline"><button type="button" class="button small secondary" data-edit-product="${escapeHtml(p.id)}">Edit</button>${!p.is_archived ? `<button type="button" class="button small danger" data-archive-product="${escapeHtml(p.id)}">Archive</button>` : ''}</td></tr>`).join('')}</tbody></table>` : '<div class="empty-state">No menu products yet. Add the restaurant’s real menu above.</div>';
}
async function loadProducts() {
  const result = await window.api('/api/admin/products'); productCache = result.products; renderProducts();
}
function setProductImagePreview(source) {
  const image = document.getElementById('product-image-preview-img');
  const empty = document.getElementById('product-image-empty');
  if (!image || !empty) return;
  if (productPreviewObjectUrl) URL.revokeObjectURL(productPreviewObjectUrl);
  productPreviewObjectUrl = source?.startsWith('blob:') ? source : null;
  if (source) {
    image.src = source;
    image.classList.remove('hidden');
    empty.classList.add('hidden');
  } else {
    image.removeAttribute('src');
    image.classList.add('hidden');
    empty.classList.remove('hidden');
  }
}
function resetProductForm() {
  const form = document.getElementById('product-form'); form.reset(); form.elements.id.value = ''; form.elements.category.value = 'Pizza'; form.elements.is_available.checked = true;
  form.elements.image_url.value = ''; setProductImagePreview('');
  document.getElementById('product-form-title').textContent = 'Add a product';
}
async function loadOrders() {
  const { orders } = await window.api('/api/admin/orders');
  const target = document.getElementById('orders-list');
  target.innerHTML = orders.length ? `<table class="data-table"><thead><tr><th>Order / time</th><th>Customer</th><th>Items</th><th>Payment</th><th>Total</th><th>Order status</th></tr></thead><tbody>${orders.map((o) => {
    const choices = STATUS_FLOW[o.order_status] || [];
    const payment = Array.isArray(o.payments) ? o.payments[0] : o.payments;
    const mapLink = o.delivery_latitude !== null && o.delivery_latitude !== undefined && o.delivery_longitude !== null && o.delivery_longitude !== undefined
      ? ` · <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${o.delivery_latitude},${o.delivery_longitude}`)}" target="_blank" rel="noopener">Map pin</a>` : '';
    const deliveryDetails = o.delivery_address ? ` · ${escapeHtml(o.delivery_address)}${o.delivery_distance_km ? ` · ${Number(o.delivery_distance_km).toFixed(2)} km driving` : ''}${mapLink}` : '';
    return `<tr><td><strong>${escapeHtml(o.order_number)}</strong><br><small>${dateLabel(o.created_at)}</small></td><td>${escapeHtml(o.customer_name)}<br>${escapeHtml(o.customer_phone)}<br><small>${escapeHtml(o.order_type)}${deliveryDetails}</small></td><td>${orderItems(o)}<br><small>${escapeHtml(o.notes || '')}</small></td><td>${escapeHtml(o.payment_method.replaceAll('_', ' '))}<br>${badge(payment?.payment_status)}</td><td>${money(o.total_amount)}<br><small>Subtotal ${money(o.subtotal)} · Fee ${money(o.delivery_fee)}</small></td><td>${badge(o.order_status)}${choices.length ? `<div style="margin-top:8px"><select aria-label="Set next status" data-order-status="${escapeHtml(o.id)}"><option value="">Change status…</option>${choices.filter((s) => (s !== 'Out for Delivery' || o.order_type === 'delivery') && (s !== 'Ready for Pickup' || o.order_type === 'pickup')).map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('')}</select></div>` : ''}</td></tr>`;
  }).join('')}</tbody></table>` : '<div class="empty-state">No orders have been placed yet.</div>';
}
async function loadPayments() {
  const { payments } = await window.api('/api/admin/payments');
  document.getElementById('payments-list').innerHTML = payments.length ? `<table class="data-table"><thead><tr><th>Order</th><th>Method / amount</th><th>Reference</th><th>Status history</th><th>Verify</th></tr></thead><tbody>${payments.map((p) => {
    const order = (Array.isArray(p.orders) ? p.orders[0] : p.orders) || {};
    const gatewayPending = p.payment_method === 'gcash' && p.gateway_session_id && p.payment_status === 'Pending';
    const actions = gatewayPending ? [] : p.payment_status === 'Pending' ? [['Paid', 'Confirm Paid'], ['Failed', 'Mark Failed']] : p.payment_status === 'Paid' ? [['Refunded', 'Mark Refunded']] : [];
    const reference = p.gateway_payment_id
      ? `<small>PayMongo payment</small><br><code>${escapeHtml(p.gateway_payment_id)}</code>`
      : p.gateway_session_id ? '<span class="muted">Waiting for PayMongo</span>'
        : p.reference_number ? `<code>${escapeHtml(p.reference_number)}</code>` : '<span class="muted">No reference</span>';
    return `<tr><td><strong>${escapeHtml(order.order_number || '—')}</strong><br>${escapeHtml(order.customer_name || '')}<br><small>${escapeHtml(order.customer_phone || '')} · ${escapeHtml(order.order_type || '')}</small></td><td>${escapeHtml(p.payment_method.replaceAll('_', ' '))}<br>${money(p.amount)}</td><td>${reference}</td><td>${badge(p.payment_status)}<br><small>${(p.payment_status_history || []).map((h) => `${escapeHtml(h.previous_status || '—')} → ${escapeHtml(h.new_status)} · ${dateLabel(h.created_at)}${h.notes ? ` · ${escapeHtml(h.notes)}` : ''}`).join('<br>')}</small></td><td>${actions.length ? `<div class="form-stack">${actions.map(([status, label]) => `<button class="button small ${status === 'Failed' || status === 'Refunded' ? 'secondary' : ''}" type="button" data-payment-id="${escapeHtml(p.id)}" data-payment-status="${status}">${label}</button>`).join('')}</div>` : '—'}</td></tr>`;
  }).join('')}</tbody></table>` : '<div class="empty-state">No payments recorded.</div>';
}
async function loadReport() {
  const { report: r } = await window.api('/api/admin/reports');
  const metrics = [
    ['Total orders', r.total_orders], ['Pending orders', r.pending_orders], ['Completed orders', r.completed_orders], ['Cancelled orders', r.cancelled_orders],
    ['Order totals · non-cancelled', money(r.order_totals)], ['Confirmed payments', r.confirmed_payments], ['Pending payments', r.pending_payments],
    ['Gross collected', money(r.gross_collected)], ['Refund totals', money(r.refund_totals)], ['Net collected', money(r.net_collected)]
  ];
  document.getElementById('report-metrics').innerHTML = metrics.map(([label, value]) => `<div class="metric"><small>${label}</small><strong>${value}</strong></div>`).join('');
  const methods = r.sales_by_method || [];
  document.getElementById('sales-methods').innerHTML = methods.length ? `<table class="data-table"><thead><tr><th>Method</th><th>Gross received</th><th>Refunded</th><th>Pending</th></tr></thead><tbody>${methods.map((m) => `<tr><td>${escapeHtml(m.payment_method.replaceAll('_', ' '))}</td><td>${money(m.gross_received)}</td><td>${money(m.refund_total)}</td><td>${money(m.pending_total)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No payment activity yet.</p>';
  const days = r.daily_sales || [];
  document.getElementById('daily-sales').innerHTML = days.length ? `<table class="data-table"><thead><tr><th>Date</th><th>Verified paid</th></tr></thead><tbody>${days.map((d) => `<tr><td>${escapeHtml(d.day)}</td><td>${money(d.paid_total)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No verified payments in the last 30 days.</p>';
}
async function loadSettings() {
  const { settings } = await window.api('/api/admin/settings');
  const form = document.getElementById('settings-form');
  for (const [key, value] of Object.entries(settings)) {
    const field = form.elements[key]; if (!field) continue;
    if (field.type === 'checkbox') field.checked = Boolean(value); else field.value = value ?? '';
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  if (!document.body.dataset.adminPage) return;
  const admin = await ensureAdmin();
  if (!admin) return;
  document.querySelectorAll('[data-logout]').forEach((button) => button.addEventListener('click', async () => {
    await window.getSupabaseClient()?.auth.signOut(); await fetch('/api/admin/session', { method: 'DELETE' }); location.href = '/admin/login.html';
  }));
  const page = document.body.dataset.adminPage;
  try {
    if (page === 'dashboard') await loadDashboard();
    if (page === 'products') {
      await loadProducts();
      const form = document.getElementById('product-form');
      form.elements.image_file.addEventListener('change', () => {
        const file = form.elements.image_file.files[0];
        if (!file) return setProductImagePreview(form.elements.image_url.value);
        if (file.size > 5 * 1024 * 1024) {
          form.elements.image_file.value = '';
          setProductImagePreview(form.elements.image_url.value);
          return showToast('The photo must be 5 MB or smaller.', true);
        }
        setProductImagePreview(URL.createObjectURL(file));
      });
      form.addEventListener('submit', async (event) => {
        event.preventDefault(); const fd = new FormData(form);
        const button = form.querySelector('button[type="submit"]'); button.disabled = true;
        try {
          const sizes = String(fd.get('sizes')).split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
            const index = line.lastIndexOf('='); if (index < 1) throw new Error(`Use “size name = price” for: ${line}`);
            return { size_name: line.slice(0, index).trim(), price: Number(line.slice(index + 1).trim()) };
          });
          let imageUrl = fd.get('image_url') || '';
          const imageFile = form.elements.image_file.files[0];
          if (imageFile) {
            button.textContent = 'Uploading photo…';
            const uploadForm = new FormData(); uploadForm.append('image', imageFile);
            const uploadResult = await window.api('/api/admin/uploads/product-image', { method: 'POST', body: uploadForm });
            imageUrl = uploadResult.image_url;
            form.elements.image_url.value = imageUrl;
            form.elements.image_file.value = '';
            setProductImagePreview(imageUrl);
          }
          button.textContent = 'Saving product…';
          await window.api('/api/admin/products', { method: 'POST', body: JSON.stringify({ id: fd.get('id') || null, name: fd.get('name'), description: fd.get('description'), category: fd.get('category'), image_url: imageUrl, is_available: form.elements.is_available.checked, sizes }) });
          showToast('Product saved.'); resetProductForm(); await loadProducts();
        } catch (error) { showToast(error.message, true); }
        button.disabled = false; button.textContent = 'Save product';
      });
      document.getElementById('product-reset').addEventListener('click', resetProductForm);
      document.getElementById('product-list').addEventListener('click', async (event) => {
        const edit = event.target.closest('[data-edit-product]'); const archive = event.target.closest('[data-archive-product]');
        if (edit) {
          const product = productCache.find((p) => p.id === edit.dataset.editProduct); if (!product) return;
          const form = document.getElementById('product-form'); form.elements.id.value = product.id; form.elements.name.value = product.name; form.elements.description.value = product.description || ''; form.elements.category.value = product.category || 'Pizza'; form.elements.image_url.value = product.image_url || ''; form.elements.image_file.value = ''; form.elements.is_available.checked = product.is_available; setProductImagePreview(product.image_url || '');
          form.elements.sizes.value = (product.product_sizes || []).map((s) => `${s.size_name} = ${Number(s.price).toFixed(2)}`).join('\n'); document.getElementById('product-form-title').textContent = 'Edit product'; form.scrollIntoView({ behavior: 'smooth' });
        }
        if (archive && confirm('Archive this menu item? Past orders will keep their saved item details.')) {
          try { await window.api(`/api/admin/products/${archive.dataset.archiveProduct}/archive`, { method: 'PATCH', body: '{}' }); showToast('Product archived.'); await loadProducts(); }
          catch (error) { showToast(error.message, true); }
        }
      });
    }
    if (page === 'orders') {
      await loadOrders();
      document.getElementById('refresh-orders').addEventListener('click', () => loadOrders().catch((e) => showToast(e.message, true)));
      document.getElementById('orders-list').addEventListener('change', async (event) => {
        const select = event.target.closest('[data-order-status]'); if (!select?.value) return;
        const status = select.value; select.disabled = true;
        try { await window.api(`/api/admin/orders/${select.dataset.orderStatus}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }); showToast('Order status updated.'); await loadOrders(); }
        catch (error) { showToast(error.message, true); select.disabled = false; select.value = ''; }
      });
    }
    if (page === 'payments') {
      await loadPayments();
      document.getElementById('refresh-payments').addEventListener('click', () => loadPayments().catch((e) => showToast(e.message, true)));
      document.getElementById('payments-list').addEventListener('click', async (event) => {
        const button = event.target.closest('[data-payment-id]'); if (!button) return;
        let notes = '';
        if (button.dataset.paymentStatus === 'Paid' || button.dataset.paymentStatus === 'Refunded') notes = prompt(`Add an audit note for ${button.dataset.paymentStatus} (optional):`) || '';
        else notes = prompt('Add a reason for marking this payment failed (optional):') || '';
        button.disabled = true;
        try { await window.api(`/api/admin/payments/${button.dataset.paymentId}/status`, { method: 'PATCH', body: JSON.stringify({ status: button.dataset.paymentStatus, notes }) }); showToast(`Payment marked ${button.dataset.paymentStatus}.`); await loadPayments(); }
        catch (error) { showToast(error.message, true); button.disabled = false; }
      });
    }
    if (page === 'reports') {
      await loadReport(); document.getElementById('refresh-report').addEventListener('click', () => loadReport().catch((e) => showToast(e.message, true)));
    }
    if (page === 'settings') {
      await loadSettings();
      document.getElementById('settings-form').addEventListener('submit', async (event) => {
        event.preventDefault(); const form = event.currentTarget; const fd = new FormData(form); const button = form.querySelector('button[type="submit"]'); button.disabled = true;
        const body = Object.fromEntries(['business_name', 'business_address', 'business_phone', 'business_hours', 'gcash_instructions', 'maya_instructions'].map((key) => [key, fd.get(key) || '']));
        Object.assign(body, Object.fromEntries(['pickup_enabled', 'delivery_enabled', 'gcash_enabled', 'maya_enabled'].map((key) => [key, form.elements[key].checked])));
        for (const key of ['business_latitude', 'business_longitude']) body[key] = fd.get(key) === '' ? null : Number(fd.get(key));
        for (const key of ['delivery_base_fee', 'delivery_fee_per_km', 'delivery_max_distance_km']) body[key] = Number(fd.get(key));
        try { await window.api('/api/admin/settings', { method: 'PUT', body: JSON.stringify(body) }); showToast('Business settings saved.'); }
        catch (error) { showToast(error.message, true); }
        button.disabled = false;
      });
    }
  } catch (error) { showToast(error.message, true); }
});
