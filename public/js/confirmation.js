function safePaymongoUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'checkout.paymongo.com' ? url.toString() : '';
  } catch { return ''; }
}

function renderConfirmation(order, paymentMessage = '') {
  const target = document.getElementById('confirmation');
  const isGcash = order.payment_method === 'gcash';
  const paid = order.payment_status === 'Paid';
  const paymentLabels = { cash_on_pickup: 'Cash on Pickup', cash_on_delivery: 'Cash on Delivery', gcash: 'GCash via PayMongo', maya: 'Maya · manual verification' };
  const payUrl = safePaymongoUrl(order.checkout_url);
  const paymentStatus = order.payment_status || 'Pending';
  const payAction = isGcash && paymentStatus === 'Pending'
    ? `${paymentMessage ? `<div class="notice">${escapeHtml(paymentMessage)}</div>` : ''}${payUrl ? `<p><a class="button" href="${escapeHtml(payUrl)}">Continue to GCash payment</a></p>` : '<p><button id="resume-payment" class="button" type="button">Open GCash checkout</button></p>'}<p class="help">The order stays Pending until PayMongo confirms your payment.</p>`
    : isGcash && paymentStatus !== 'Paid' ? `<div class="notice">This GCash payment is ${escapeHtml(paymentStatus.toLowerCase())}. Contact the restaurant if you need help.</div>`
    : paymentMessage ? `<div class="notice">${escapeHtml(paymentMessage)}</div>` : '';
  const distance = order.delivery_distance_km ? `<div class="summary-line"><span>Driving distance</span><strong>${Number(order.delivery_distance_km).toFixed(2)} km</strong></div>` : '';
  const items = (order.items || []).map((item) => {
    const name = item.product_name || item.product_name_snapshot || '';
    const size = item.size_name || item.size_name_snapshot || '';
    const price = item.unit_price ?? item.unit_price_snapshot ?? 0;
    return `<div class="summary-line"><span>${Number(item.quantity)} &times; ${escapeHtml(name)} (${escapeHtml(size)})</span><strong>${money(Number(price) * Number(item.quantity))}</strong></div>`;
  }).join('');
  target.innerHTML = `<div class="confirmation-mark">&#10003;</div><span class="eyebrow" style="color:var(--green)">Order received</span><h1>Thank you, ${escapeHtml(order.customer_name || 'there')}!</h1><p>Your order number is below. Save the private tracking code so you can check the status later.</p>${payAction}<div class="panel"><div class="summary-line"><span>Order number</span><strong>${escapeHtml(order.order_number)}</strong></div><div class="summary-line"><span>Order status</span><span class="status pending">${escapeHtml(order.order_status || 'Pending')}</span></div><div class="summary-line"><span>Payment</span><strong>${escapeHtml(paymentLabels[order.payment_method] || order.payment_method)}</strong></div><div class="summary-line"><span>Payment status</span><span class="status ${paid ? 'paid' : 'pending'}">${escapeHtml(order.payment_status || 'Pending')}</span></div>${items}${distance}<div class="summary-line"><span>Subtotal</span><strong>${money(order.subtotal)}</strong></div><div class="summary-line"><span>Delivery fee</span><strong>${money(order.delivery_fee)}</strong></div><div class="summary-line total"><span>Order total</span><strong>${money(order.total_amount)}</strong></div><h3>Your private tracking code</h3><div class="tracking-code" id="tracking-code">${escapeHtml(order.tracking_token || '')}</div><p class="help">Keep this code private; anyone with it and your order number can view order status.</p><button id="copy-code" class="button secondary" type="button">Copy tracking code</button></div><p style="margin-top:22px"><a class="button" href="/my-orders.html">Track this order</a> <a class="button secondary" href="/menu.html">Order again</a></p>`;

  document.getElementById('copy-code')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(order.tracking_token); showToast('Tracking code copied.'); }
    catch { showToast('Select and copy the tracking code above.'); }
  });
  document.getElementById('resume-payment')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = 'Opening checkout...';
    try {
      const result = await window.api(`/api/orders/${encodeURIComponent(order.order_number)}/gcash-checkout`, {
        method: 'POST',
        headers: { 'X-Order-Token': order.tracking_token },
        body: JSON.stringify({})
      });
      const checkoutUrl = safePaymongoUrl(result.checkout_url);
      if (!checkoutUrl) throw new Error('The payment provider returned an invalid checkout link.');
      order.checkout_url = checkoutUrl;
      location.href = checkoutUrl;
    } catch (error) {
      showToast(error.message, true);
      button.disabled = false;
      button.textContent = 'Open GCash checkout';
    }
  });
  if (paid || !isGcash) sessionStorage.removeItem('dofols_last_order');
}

document.addEventListener('DOMContentLoaded', async () => {
  document.querySelectorAll('[data-year]').forEach((node) => { node.textContent = new Date().getFullYear(); });
  const target = document.getElementById('confirmation');
  let order;
  try { order = JSON.parse(sessionStorage.getItem('dofols_last_order') || 'null'); } catch { order = null; }
  const requestedNumber = new URLSearchParams(location.search).get('order');
  if (!order && requestedNumber) {
    const remembered = getRememberedOrders().find((item) => item.order_number === requestedNumber);
    if (remembered) order = { ...remembered, payment_method: remembered.payment_method || 'gcash' };
  }
  if (!order?.order_number || !order?.tracking_token) {
    target.innerHTML = '<div class="confirmation-mark">&#10003;</div><h1>Thank you!</h1><p>Your order was received. Use the order number and private tracking code from your confirmation to check its status.</p><a class="button" href="/my-orders.html">Track an order</a>';
    return;
  }

  let paymentMessage = order.checkout_error || '';
  try {
    const { order: current } = await window.lookupOrder(order.order_number, order.tracking_token);
    order = { ...order, ...current, tracking_token: order.tracking_token, checkout_url: order.checkout_url || '', payment_status: current.payment?.payment_status || order.payment_status || 'Pending' };
  } catch (error) {
    paymentMessage = paymentMessage || `Could not refresh payment status: ${error.message}`;
  }
  const wasCancelled = new URLSearchParams(location.search).get('payment') === 'cancelled';
  if (wasCancelled && order.payment_status !== 'Paid') paymentMessage = 'The GCash payment was not completed. You can return to PayMongo and try again.';
  renderConfirmation(order, paymentMessage);
});
