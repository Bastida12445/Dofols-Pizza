let currentCart = [];
function renderCart() {
  const target = document.getElementById('cart-items');
  if (!currentCart.length) {
    target.innerHTML = '<div class="empty-state"><h3>Your cart is empty</h3><p>Choose something freshly baked from our menu.</p><a class="button" href="/menu.html">Browse menu</a></div>';
    document.getElementById('cart-subtotal').textContent = money(0);
    document.getElementById('cart-total').textContent = money(0);
    document.getElementById('checkout-button').classList.add('hidden');
    return;
  }
  document.getElementById('checkout-button').classList.remove('hidden');
  const subtotal = currentCart.reduce((sum, item) => sum + item.unit_price * item.quantity, 0);
  target.innerHTML = currentCart.map((item, index) => `<div class="cart-row"><div><h3>${escapeHtml(item.product_name)} <span class="muted">· ${escapeHtml(item.size_name)}</span></h3><small>${money(item.unit_price)} each</small><div class="quantity-control" style="margin-top:8px"><button type="button" data-action="minus" data-index="${index}" aria-label="Decrease quantity">−</button><strong>${item.quantity}</strong><button type="button" data-action="plus" data-index="${index}" aria-label="Increase quantity">+</button></div></div><div class="cart-actions"><strong>${money(item.unit_price * item.quantity)}</strong><button class="button small secondary" type="button" data-action="remove" data-index="${index}">Remove</button></div></div>`).join('');
  document.getElementById('cart-subtotal').textContent = money(subtotal);
  document.getElementById('cart-total').textContent = money(subtotal);
}
document.addEventListener('DOMContentLoaded', async () => {
  document.querySelectorAll('[data-year]').forEach((node) => { node.textContent = new Date().getFullYear(); });
  currentCart = getCart();
  try {
    await window.appReady;
    const { products } = await window.api('/api/menu');
    const byProduct = new Map(products.map((p) => [p.id, p]));
    currentCart = currentCart.flatMap((item) => {
      const p = byProduct.get(item.product_id);
      const s = p?.product_sizes.find((size) => size.id === item.size_id);
      return p && s ? [{ ...item, product_name: p.name, size_name: s.size_name, unit_price: Number(s.price), image_url: p.image_url || '' }] : [{ ...item, unavailable: true }];
    });
    saveCart(currentCart.filter((i) => !i.unavailable));
  } catch { /* Saved cart remains visible; checkout will validate availability. */ }
  renderCart();
  document.getElementById('cart-items').addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const index = Number(button.dataset.index);
    const item = currentCart[index];
    if (!item) return;
    if (button.dataset.action === 'remove') currentCart.splice(index, 1);
    if (button.dataset.action === 'plus') item.quantity = Math.min(50, item.quantity + 1);
    if (button.dataset.action === 'minus') item.quantity = Math.max(1, item.quantity - 1);
    saveCart(currentCart); renderCart();
  });
});
