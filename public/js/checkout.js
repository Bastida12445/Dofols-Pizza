let checkoutCart = [];
let checkoutSettings = null;
let orderType = 'pickup';
let paymentMethod = 'cash_on_pickup';
let unavailableItemCount = 0;
let deliveryQuote = null;
let deliveryQuoteAddress = '';

const choiceIcons = {
  pickup: '<svg viewBox="0 0 24 24" focusable="false"><path d="M4 10.5 12 4l8 6.5V20h-6v-5h-4v5H4z"/><path d="M8 10h.01M16 10h.01"/></svg>',
  delivery: '<svg viewBox="0 0 24 24" focusable="false"><path d="M3 6h11v11H3zM14 10h4l3 3v4h-7z"/><circle cx="7.5" cy="18" r="1.8"/><circle cx="17.5" cy="18" r="1.8"/></svg>',
  cash: '<svg viewBox="0 0 24 24" focusable="false"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M7 10h.01M17 15h.01M12 9a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z"/></svg>',
  maya: '<svg viewBox="0 0 24 24" focusable="false"><rect x="4" y="3" width="16" height="18" rx="3"/><path d="m8 15 2.5-6 2 4 1.5-3 2 5"/></svg>'
};

function choiceMark(value) {
  return value === 'gcash'
    ? '<img class="gcash-logo" src="/assets/gcash-logo.svg" alt="GCash" width="86" height="32">'
    : `<span class="choice-icon choice-icon--${value === 'cash_on_pickup' || value === 'cash_on_delivery' ? 'cash' : value}" aria-hidden="true">${choiceIcons[value] || choiceIcons.maya}</span>`;
}

function choiceMarkup(group, value, title, detail) {
  const selected = value === (group === 'order_type' ? orderType : paymentMethod);
  return `<label class="choice"><input type="radio" name="${group}" value="${value}" ${selected ? 'checked' : ''}><span class="choice-content">${choiceMark(value)}<span class="choice-copy"><strong>${title}</strong><small>${detail}</small></span></span></label>`;
}

function unavailableChoiceMarkup(value, title, detail) {
  return `<div class="choice choice-unavailable" aria-disabled="true"><span class="choice-content">${choiceMark(value)}<span class="choice-copy"><strong>${title}</strong><small>${detail}</small></span></span></div>`;
}

function currentSubtotal() {
  return checkoutCart.reduce((sum, item) => sum + item.unit_price * item.quantity, 0);
}

function renderSummary() {
  const subtotal = currentSubtotal();
  const needsQuote = orderType === 'delivery' && !deliveryQuote;
  const fee = orderType === 'delivery' ? Number(deliveryQuote?.delivery_fee || 0) : 0;
  const items = checkoutCart.map((item) => `
    <div class="summary-line">
      <span>${Number(item.quantity)} &times; ${escapeHtml(item.product_name)} (${escapeHtml(item.size_name)})</span>
      <strong>${money(item.unit_price * item.quantity)}</strong>
    </div>`).join('');
  document.getElementById('checkout-items').innerHTML = items || '<p><a href="/menu.html">Browse the current menu &rarr;</a></p>';
  document.getElementById('checkout-subtotal').textContent = money(subtotal);
  document.getElementById('checkout-delivery').textContent = needsQuote ? 'Calculate route first' : money(fee);
  document.getElementById('checkout-total').textContent = needsQuote ? '-' : money(subtotal + fee);

  let message = 'The server checks current menu prices and delivery charges when your order is submitted.';
  if (!checkoutCart.length) {
    message = unavailableItemCount
      ? `Your saved cart item${unavailableItemCount === 1 ? ' is' : 's are'} no longer available. Return to the menu and add current items.`
      : 'Your cart is empty. Return to the menu, choose a pizza and size, then add it to your cart.';
  } else if (unavailableItemCount) {
    message = `${unavailableItemCount} unavailable saved cart item${unavailableItemCount === 1 ? ' was' : 's were'} removed. The remaining items are ready to order.`;
  } else if (needsQuote) {
    message = 'For delivery, enter the address and calculate the driving route before placing your order.';
  } else if (deliveryQuote && orderType === 'delivery') {
    message = `Google Maps driving distance: ${deliveryQuote.distance_km.toFixed(2)} km (${deliveryQuote.chargeable_km} chargeable km).`;
  }
  document.getElementById('checkout-message').textContent = message;
}

function renderOrderOptions() {
  const target = document.getElementById('order-type-options');
  const options = [];
  if (checkoutSettings?.pickup_enabled) options.push(['pickup', 'Pickup', 'Collect your order at the restaurant.']);
  if (checkoutSettings?.delivery_enabled) options.push(['delivery', 'Delivery', 'Fee depends on Google Maps driving distance.']);
  const cards = options.map(([value, label, detail]) => choiceMarkup('order_type', value, label, detail));
  if (!checkoutSettings?.pickup_enabled) cards.push(unavailableChoiceMarkup('pickup', 'Pickup', 'Currently unavailable.'));
  if (!checkoutSettings?.delivery_enabled) cards.push(unavailableChoiceMarkup('delivery', 'Delivery', 'Not available yet. The restaurant needs to enable delivery and set its route fees.'));
  target.innerHTML = cards.join('') || '<div class="notice">Ordering is temporarily unavailable. Please contact the restaurant.</div>';
  if (!options.some(([value]) => value === orderType)) orderType = options[0]?.[0] || '';
  if (orderType) target.querySelector(`input[value="${orderType}"]`).checked = true;
}

function renderPaymentOptions() {
  if (!checkoutSettings) return;
  const options = [];
  if (orderType === 'pickup' && checkoutSettings.pickup_enabled) options.push(['cash_on_pickup', 'Cash on Pickup', 'Pay when you collect your order.']);
  if (orderType === 'delivery' && checkoutSettings.delivery_enabled) options.push(['cash_on_delivery', 'Cash on Delivery', 'Pay when your order arrives.']);
  if (checkoutSettings.gcash_enabled && checkoutSettings.gcash_gateway_ready) options.push(['gcash', 'GCash via PayMongo', 'Continue to secure PayMongo checkout to pay by GCash.']);
  if (checkoutSettings.maya_enabled && checkoutSettings.maya_instructions.trim()) options.push(['maya', 'Maya', 'Manual verification after you submit a payment reference.']);

  const target = document.getElementById('payment-options');
  const cards = options.map(([value, label, detail]) => choiceMarkup('payment_method', value, label, detail));
  if (!checkoutSettings.gcash_enabled || !checkoutSettings.gcash_gateway_ready) {
    const reason = !checkoutSettings.gcash_gateway_ready
      ? 'Available when live PayMongo and a public HTTPS website are configured.'
      : 'GCash is not enabled by the restaurant right now.';
    cards.push(unavailableChoiceMarkup('gcash', 'GCash', reason));
  }
  target.innerHTML = cards.join('') || '<div class="notice">No payment method is available for this order option. Please contact the restaurant.</div>';
  if (!options.some(([value]) => value === paymentMethod)) paymentMethod = options[0]?.[0] || '';
  if (paymentMethod) target.querySelector(`input[value="${paymentMethod}"]`).checked = true;

  const instructions = document.getElementById('payment-instructions');
  const text = paymentMethod === 'gcash'
    ? 'You will be redirected to PayMongo after placing the order. Your payment is confirmed automatically by PayMongo.'
    : paymentMethod === 'maya' ? checkoutSettings.maya_instructions : '';
  instructions.textContent = text;
  instructions.classList.toggle('hidden', !text);
  const needsReference = paymentMethod === 'maya';
  document.getElementById('reference-field').classList.toggle('hidden', !needsReference);
  document.getElementById('reference-number').required = needsReference;
}

function updatePlaceOrderButton() {
  const needsQuote = orderType === 'delivery' && !deliveryQuote;
  const button = document.getElementById('place-order');
  button.disabled = !checkoutCart.length || !orderType || !paymentMethod || needsQuote;
  button.textContent = paymentMethod === 'gcash' ? 'Continue to GCash payment' : 'Place order';
}

async function calculateCustomerDeliveryQuote() {
  const button = document.getElementById('delivery-location-button');
  const status = document.getElementById('delivery-location-status');
  const address = document.getElementById('delivery-address').value.trim();
  if (address.length < 8) {
    status.textContent = 'Enter a complete delivery address, including barangay and municipality, before calculating the route.';
    return;
  }
  button.disabled = true;
  status.textContent = 'Finding the address and calculating the driving route...';
  try {
    const { quote } = await window.api('/api/delivery/quote', {
      method: 'POST',
      body: JSON.stringify({ address })
    });
    if (document.getElementById('delivery-address').value.trim() !== address) {
      deliveryQuote = null;
      deliveryQuoteAddress = '';
      status.textContent = 'The address changed while calculating. Calculate the route again for the new address.';
      renderSummary();
      updatePlaceOrderButton();
      return;
    }
    deliveryQuote = quote;
    deliveryQuoteAddress = address;
    status.textContent = `Driving distance ${quote.distance_km.toFixed(2)} km. Delivery fee: ${money(quote.delivery_fee)}. `;
    const mapUrl = new URL('https://www.google.com/maps/search/');
    mapUrl.searchParams.set('api', '1');
    mapUrl.searchParams.set('query', `${quote.destination_latitude},${quote.destination_longitude}`);
    const mapLink = document.createElement('a');
    mapLink.href = mapUrl.toString();
    mapLink.target = '_blank';
    mapLink.rel = 'noopener noreferrer';
    mapLink.textContent = 'Review mapped drop-off';
    status.append(mapLink);
    renderSummary();
    updatePlaceOrderButton();
  } catch (error) {
    deliveryQuote = null;
    deliveryQuoteAddress = '';
    status.textContent = error.message;
    renderSummary();
    updatePlaceOrderButton();
  } finally {
    button.disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  document.querySelectorAll('[data-year]').forEach((node) => { node.textContent = new Date().getFullYear(); });
  const form = document.getElementById('checkout-form');
  const button = document.getElementById('place-order');
  const locationButton = document.getElementById('delivery-location-button');
  checkoutCart = getCart();

  locationButton.addEventListener('click', calculateCustomerDeliveryQuote);
  document.getElementById('delivery-address').addEventListener('input', () => {
    if (deliveryQuote && document.getElementById('delivery-address').value.trim() !== deliveryQuoteAddress) {
      deliveryQuote = null;
      deliveryQuoteAddress = '';
      document.getElementById('delivery-location-status').textContent = 'Address changed. Recalculate the driving route before placing the order.';
      renderSummary();
      updatePlaceOrderButton();
    }
  });

  form.addEventListener('change', (event) => {
    if (event.target.name === 'order_type') {
      orderType = event.target.value;
      document.getElementById('address-field').classList.toggle('hidden', orderType !== 'delivery');
      document.getElementById('delivery-address').required = orderType === 'delivery';
      renderPaymentOptions();
      renderSummary();
      updatePlaceOrderButton();
    }
    if (event.target.name === 'payment_method') {
      paymentMethod = event.target.value;
      renderPaymentOptions();
      updatePlaceOrderButton();
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!checkoutCart.length) return showToast('Your cart is empty. Add a pizza from the menu first.', true);
    if (!orderType || !paymentMethod) return showToast('There is no available order or payment method.', true);
    const data = new FormData(form);
    if (orderType === 'delivery' && (!deliveryQuote || String(data.get('delivery_address') || '').trim() !== deliveryQuoteAddress)) {
      return showToast('Calculate the route again for this delivery address before placing the order.', true);
    }
    button.disabled = true;
    button.textContent = paymentMethod === 'gcash' ? 'Opening GCash checkout...' : 'Placing your order...';
    try {
      const result = await window.api('/api/orders', { method: 'POST', body: JSON.stringify({
        customer_name: data.get('customer_name'), customer_phone: data.get('customer_phone'),
        order_type: orderType, delivery_address: data.get('delivery_address') || '', notes: data.get('notes') || '',
        payment_method: paymentMethod, reference_number: data.get('reference_number') || '',
        items: checkoutCart.map((item) => ({ product_id: item.product_id, size_id: item.size_id, quantity: Number(item.quantity) }))
      }) });
      const completedOrder = {
        ...result.order,
        customer_name: data.get('customer_name'),
        tracking_token: result.tracking_token,
        items: checkoutCart,
        checkout_url: result.checkout_url || '',
        checkout_error: result.checkout_error || ''
      };
      try { rememberOrder(result.order.order_number, result.tracking_token, { payment_method: paymentMethod, checkout_url: result.checkout_url || '' }); } catch { /* The receipt still contains the private tracking code. */ }
      try { sessionStorage.setItem('dofols_last_order', JSON.stringify(completedOrder)); }
      catch {
        try { clearCart(); } catch { /* The database order has already succeeded. */ }
        form.innerHTML = `<div class="confirmation-mark">&#10003;</div><h1>Order received</h1><p>Save your order number and private tracking code now.</p><div class="summary-line"><span>Order number</span><strong>${escapeHtml(completedOrder.order_number)}</strong></div><div class="tracking-code">${escapeHtml(completedOrder.tracking_token)}</div>${completedOrder.checkout_url ? `<p><a class="button" href="${escapeHtml(completedOrder.checkout_url)}">Continue to GCash payment</a></p>` : ''}<p class="help">Keep the tracking code private.</p><a class="button secondary" href="/my-orders.html">Track this order</a>`;
        return;
      }
      try { clearCart(); } catch { /* The database order has already succeeded. */ }
      if (result.checkout_url) {
        location.href = result.checkout_url;
        return;
      }
      location.href = '/order-confirmation.html';
    } catch (error) {
      showToast(error.message, true);
      button.disabled = false;
      updatePlaceOrderButton();
    }
  });

  try {
    await window.appReady;
    checkoutSettings = await getPublicSettings();
    const { products } = await window.api('/api/menu');
    const savedCart = checkoutCart;
    checkoutCart = savedCart.flatMap((item) => {
      const product = products.find((p) => p.id === item.product_id);
      const size = product?.product_sizes.find((s) => s.id === item.size_id);
      return product && size ? [{ ...item, product_name: product.name, size_name: size.size_name, unit_price: Number(size.price) }] : [];
    });
    unavailableItemCount = savedCart.length - checkoutCart.length;
    saveCart(checkoutCart);
    renderOrderOptions();
    document.getElementById('address-field').classList.toggle('hidden', orderType !== 'delivery');
    document.getElementById('delivery-address').required = orderType === 'delivery';
    renderPaymentOptions();
    renderSummary();
    updatePlaceOrderButton();
  } catch (error) {
    document.getElementById('order-type-options').innerHTML = `<div class="notice">Could not load order options: ${escapeHtml(error.message)}</div>`;
    document.getElementById('payment-options').innerHTML = '<div class="notice">Payment options are unavailable until the connection is restored.</div>';
    document.getElementById('checkout-items').innerHTML = `<div class="notice">${escapeHtml(error.message)}</div>`;
    button.disabled = true;
  }
});
