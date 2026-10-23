(function () {
  const CART_KEY = 'dofols_cart_v1';
  const ORDERS_KEY = 'dofols_orders_v1';
  const settingsCache = { value: null };
  let client = null;

  window.appReady = fetch('/api/public-config').then((response) => response.json()).then((config) => {
    if (window.supabase?.createClient && config.supabaseUrl && config.supabasePublishableKey) {
      client = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey);
      window.supabaseClient = client;
    }
    return config;
  });
  window.getSupabaseClient = () => client;
  window.api = async (url, options = {}) => {
    const isFormData = options.body instanceof FormData;
    const headers = { ...(isFormData ? {} : { 'Content-Type': 'application/json' }), ...(options.headers || {}) };
    if (isFormData) {
      for (const key of Object.keys(headers)) if (key.toLowerCase() === 'content-type') delete headers[key];
    }
    if (client) {
      const { data } = await client.auth.getSession();
      if (data.session?.access_token) headers.Authorization = `Bearer ${data.session.access_token}`;
    }
    const response = await fetch(url, { ...options, headers });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Request failed. Please try again.');
    return result;
  };
  window.escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  window.money = (amount) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(amount || 0));
  window.getCart = () => { try { return JSON.parse(localStorage.getItem(CART_KEY) || '[]'); } catch { return []; } };
  window.saveCart = (items) => { localStorage.setItem(CART_KEY, JSON.stringify(items)); window.updateCartBadge(); };
  window.clearCart = () => { localStorage.removeItem(CART_KEY); window.updateCartBadge(); };
  window.addToCart = (item) => {
    const cart = window.getCart();
    const existing = cart.find((row) => row.product_id === item.product_id && row.size_id === item.size_id);
    if (existing) existing.quantity = Math.min(50, existing.quantity + item.quantity);
    else cart.push(item);
    window.saveCart(cart);
  };
  window.updateCartBadge = () => {
    const count = window.getCart().reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    document.querySelectorAll('[data-cart-count]').forEach((node) => { node.textContent = count; node.classList.toggle('hidden', count === 0); });
  };
  window.showToast = (message, error = false) => {
    let node = document.querySelector('.toast');
    if (!node) { node = document.createElement('div'); node.className = 'toast'; node.setAttribute('role', 'status'); document.body.append(node); }
    node.textContent = message; node.classList.toggle('error', error); node.classList.add('show');
    clearTimeout(window.toastTimer); window.toastTimer = setTimeout(() => node.classList.remove('show'), 3500);
  };
  window.getPublicSettings = async () => {
    if (!settingsCache.value) settingsCache.value = window.api('/api/settings').then((data) => data.settings);
    return settingsCache.value;
  };
  window.rememberOrder = (orderNumber, trackingToken, details = {}) => {
    const orders = JSON.parse(localStorage.getItem(ORDERS_KEY) || '[]').filter((o) => o.order_number !== orderNumber);
    orders.unshift({ order_number: orderNumber, tracking_token: trackingToken, ...details });
    localStorage.setItem(ORDERS_KEY, JSON.stringify(orders.slice(0, 20)));
  };
  window.getRememberedOrders = () => { try { return JSON.parse(localStorage.getItem(ORDERS_KEY) || '[]'); } catch { return []; } };
  window.lookupOrder = (orderNumber, token) => window.api(`/api/orders/${encodeURIComponent(orderNumber)}`, { headers: { 'X-Order-Token': token } });

  function renderBusinessInfo(settings) {
    document.querySelectorAll('[data-business-name]').forEach((n) => { n.textContent = settings.business_name; });
    document.querySelectorAll('[data-business-address]').forEach((n) => { n.textContent = settings.business_address; });
    document.querySelectorAll('[data-business-phone]').forEach((n) => { n.textContent = settings.business_phone || 'Contact details will be added by the owner.'; });
    document.querySelectorAll('[data-business-hours]').forEach((n) => { n.textContent = settings.business_hours || 'Hours will be announced soon.'; });
  }
  document.addEventListener('DOMContentLoaded', async () => {
    window.updateCartBadge();
    const toggle = document.querySelector('.menu-toggle');
    toggle?.addEventListener('click', () => document.querySelector('.nav-links')?.classList.toggle('open'));
    try { await window.appReady; renderBusinessInfo(await window.getPublicSettings()); } catch { /* UI remains usable while Supabase is being configured. */ }
  });
})();
