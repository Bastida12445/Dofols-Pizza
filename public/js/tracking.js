function orderCard(order) {
  const payment = order.payment || {};
  return `<div class="panel" style="margin-top:18px"><div class="section-head"><div><span class="eyebrow" style="color:var(--red)">Order ${escapeHtml(order.order_number)}</span><h2>${escapeHtml(order.order_status)}</h2></div><span class="status ${order.payment?.payment_status === 'Paid' ? 'paid' : 'pending'}">Payment ${escapeHtml(payment.payment_status || 'Pending')}</span></div><div class="summary-line"><span>Order type</span><strong>${order.order_type === 'delivery' ? 'Delivery' : 'Pickup'}</strong></div><div class="summary-line"><span>Payment method</span><strong>${escapeHtml(order.payment_method.replaceAll('_', ' '))}</strong></div>${(order.items || []).map((item) => `<div class="summary-line"><span>${item.quantity} × ${escapeHtml(item.product_name_snapshot)} (${escapeHtml(item.size_name_snapshot)})</span><strong>${money(item.line_total)}</strong></div>`).join('')}<div class="summary-line total"><span>Total</span><strong>${money(order.total_amount)}</strong></div><p class="help">For privacy, your full contact number and name are not displayed here.</p></div>`;
}
async function showOrder(orderNumber, token) {
  const target = document.getElementById('tracking-result');
  target.innerHTML = '<div class="loading">Looking up your order…</div>';
  try {
    const { order } = await lookupOrder(orderNumber, token);
    target.innerHTML = orderCard(order);
  } catch (error) {
    target.innerHTML = `<div class="notice">${escapeHtml(error.message)}</div>`;
  }
}
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-year]').forEach((node) => { node.textContent = new Date().getFullYear(); });
  const saved = getRememberedOrders();
  const savedTarget = document.getElementById('saved-orders');
  if (saved.length) savedTarget.innerHTML = saved.map((order) => `<button class="button secondary" type="button" data-order-number="${escapeHtml(order.order_number)}" data-order-token="${escapeHtml(order.tracking_token)}">${escapeHtml(order.order_number)} · Check status</button>`).join('');
  savedTarget.addEventListener('click', (event) => {
    const button = event.target.closest('[data-order-number]');
    if (button) showOrder(button.dataset.orderNumber, button.dataset.orderToken);
  });
  document.getElementById('track-form').addEventListener('submit', (event) => {
    event.preventDefault();
    showOrder(document.getElementById('track-number').value.trim(), document.getElementById('track-token').value.trim());
  });
});
