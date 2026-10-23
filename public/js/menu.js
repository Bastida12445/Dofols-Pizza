let allProducts = [];
function productCard(p) {
  const sizeOptions = p.product_sizes.map((s) => `<option value="${escapeHtml(s.id)}" data-price="${escapeHtml(s.price)}" data-name="${escapeHtml(s.size_name)}">${escapeHtml(s.size_name)} — ${money(s.price)}</option>`).join('');
  return `<article class="product-card"><div class="product-image">${p.image_url ? `<img src="${escapeHtml(p.image_url)}" alt="${escapeHtml(p.name)}">` : '<span class="product-placeholder" aria-hidden="true">🍕</span>'}</div><div class="product-body"><div class="product-meta"><span class="tag">${escapeHtml(p.category)}</span><span class="availability">Available</span></div><h3>${escapeHtml(p.name)}</h3><p>${escapeHtml(p.description || 'Freshly baked and ready to share.')}</p><form class="product-form" data-product-id="${escapeHtml(p.id)}"><div class="field"><label>Size</label><select name="size_id" aria-label="Pizza size">${sizeOptions}</select></div><div class="field"><label>Qty</label><input type="number" name="quantity" min="1" max="50" value="1" aria-label="Quantity"></div><button class="button small" type="submit">Add to cart</button></form></div></article>`;
}
function renderMenu() {
  const query = document.getElementById('menu-search').value.trim().toLowerCase();
  const category = document.getElementById('menu-category').value;
  const filtered = allProducts.filter((p) => (!category || p.category === category) && (!query || `${p.name} ${p.description} ${p.category}`.toLowerCase().includes(query)));
  const target = document.getElementById('menu-products');
  target.innerHTML = filtered.length ? filtered.map(productCard).join('') : '<div class="empty-state"><h3>No pizzas found</h3><p>Try another search or category.</p></div>';
}
document.addEventListener('DOMContentLoaded', async () => {
  document.querySelectorAll('[data-year]').forEach((node) => { node.textContent = new Date().getFullYear(); });
  const target = document.getElementById('menu-products');
  try {
    await window.appReady;
    const result = await window.api('/api/menu');
    allProducts = result.products;
    const categories = [...new Set(allProducts.map((p) => p.category).filter(Boolean))].sort();
    document.getElementById('menu-category').innerHTML += categories.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    renderMenu();
  } catch {
    target.innerHTML = '<div class="empty-state"><h3>The menu is unavailable</h3><p>Check the Supabase connection or try again later.</p></div>';
  }
  document.getElementById('menu-search').addEventListener('input', renderMenu);
  document.getElementById('menu-category').addEventListener('change', renderMenu);
  target.addEventListener('submit', (event) => {
    const form = event.target.closest('form[data-product-id]');
    if (!form) return;
    event.preventDefault();
    const product = allProducts.find((p) => p.id === form.dataset.productId);
    const option = form.elements.size_id.selectedOptions[0];
    const quantity = Number(form.elements.quantity.value);
    if (!product || !option || !Number.isInteger(quantity) || quantity < 1 || quantity > 50) return showToast('Choose a valid size and quantity.', true);
    addToCart({ product_id: product.id, size_id: option.value, product_name: product.name, size_name: option.dataset.name, unit_price: Number(option.dataset.price), image_url: product.image_url || '', quantity });
    showToast(`${product.name} added to your cart.`);
  });
});
