document.addEventListener('DOMContentLoaded', async () => {
  document.querySelectorAll('[data-year]').forEach((node) => { node.textContent = new Date().getFullYear(); });
  const target = document.getElementById('featured-products');
  try {
    await window.appReady;
    const { products } = await window.api('/api/menu');
    if (!products.length) {
      target.innerHTML = '<div class="empty-state grid-full"><h3>Our menu is being prepared</h3><p>Check back soon, or contact the restaurant for today\'s available pizzas.</p></div>';
      return;
    }
    target.innerHTML = products.slice(0, 3).map((p) => {
      const sizes = p.product_sizes;
      return `<article class="product-card"><div class="product-image">${p.image_url ? `<img src="${escapeHtml(p.image_url)}" alt="${escapeHtml(p.name)}">` : '<span class="product-placeholder" aria-hidden="true">🍕</span>'}</div><div class="product-body"><div class="product-meta"><span class="tag">${escapeHtml(p.category)}</span><span class="price">From ${money(sizes[0].price)}</span></div><h3>${escapeHtml(p.name)}</h3><p>${escapeHtml(p.description || 'Freshly baked and ready to share.')}</p><a class="button small" href="/menu.html">Choose a size</a></div></article>`;
    }).join('');
  } catch {
    target.innerHTML = '<div class="empty-state grid-full"><h3>Menu is not connected yet</h3><p>The owner needs to finish the Supabase setup and add the current menu.</p></div>';
  }
});
