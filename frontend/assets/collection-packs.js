const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = { products: [], filter: 'all', query: '', sort: 'featured', cart: null };
const grid = $('.product-grid');
const toast = $('.toast');
const cartDrawer = $('.cart-drawer');
const drawerBackdrop = $('.drawer-backdrop');
let toastTimer;
let featuredPlaylist;
let showcaseRotation;
let showcaseObserver;
let showcaseActiveVideo;

function element(tag, { className, text, type } = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  if (type) node.type = type;
  return node;
}

function money(cents, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(cents || 0) / 100);
}

function safeImage(value) {
  return /^assets\/[a-z0-9-]+\.(?:webp|png|jpe?g)$/i.test(value || '')
    ? `/${value}` : '/assets/favicon.png';
}

function safeVideo(value) {
  const local = /^\/?assets\/[a-z0-9/_-]+\.(?:mp4|webm)(?:\?v=[a-z0-9-]+)?$/i.test(value || '');
  const storage = /^https:\/\/[a-z0-9-]+\.supabase\.co\/storage\/v1\/object\/public\/product-media\/[a-z0-9/_-]+\.(?:mp4|webm|mov)(?:\?.*)?$/i.test(value || '');
  return local || storage ? value : '/assets/hero.mp4?v=20261005-stream-1';
}

function productVideoSources(product) {
  const sources = [];
  const seen = new Set();
  const add = (url, label) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    sources.push({ url, label: label || `Animación ${sources.length + 1}` });
  };
  for (const media of Array.isArray(product?.media) ? product.media : []) {
    if (media?.type === 'video') add(media.url, media.altText);
  }
  add(product?.previewPath, `Vista previa de ${product?.name || 'este pack'}`);
  return sources;
}

function createSequentialPlayer(video, product, { onIndex, onProgress } = {}) {
  const sources = productVideoSources(product);
  let index = 0;
  let visible = false;
  let destroyed = false;
  let failedSources = 0;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const updateIndex = () => onIndex?.(index, sources.length, sources[index]);
  const play = () => {
    if (destroyed || reducedMotion || !visible || !sources.length) return;
    video.play().catch(() => {});
  };
  const load = (nextIndex) => {
    if (!sources.length || destroyed) return;
    index = (nextIndex + sources.length) % sources.length;
    video.classList.remove('is-playing');
    video.loop = sources.length === 1;
    video.src = safeVideo(sources[index].url);
    video.load();
    updateIndex();
    onProgress?.(0);
    play();
  };
  const handlePlaying = () => video.classList.add('is-playing');
  const handleEnded = () => {
    failedSources = 0;
    if (sources.length > 1) load(index + 1);
  };
  const handleError = () => {
    video.classList.remove('is-playing');
    failedSources += 1;
    if (sources.length > 1 && failedSources < sources.length) load(index + 1);
  };
  const handleTime = () => {
    const ratio = Number.isFinite(video.duration) && video.duration > 0 ? video.currentTime / video.duration : 0;
    onProgress?.(Math.min(1, Math.max(0, ratio)));
  };
  video.addEventListener('playing', handlePlaying);
  video.addEventListener('ended', handleEnded);
  video.addEventListener('error', handleError);
  video.addEventListener('timeupdate', handleTime);
  const observer = new IntersectionObserver((entries) => {
    visible = entries[0]?.isIntersecting === true;
    if (visible) play();
    else video.pause();
  }, { threshold: 0.18 });
  observer.observe(video);
  if (sources.length) load(0);

  return {
    sources,
    destroy() {
      destroyed = true;
      observer.disconnect();
      video.pause();
      video.removeEventListener('playing', handlePlaying);
      video.removeEventListener('ended', handleEnded);
      video.removeEventListener('error', handleError);
      video.removeEventListener('timeupdate', handleTime);
      video.removeAttribute('src');
      video.load();
    },
  };
}

function productKind(product) {
  return product.name.toLocaleLowerCase('es').includes('batallero') ? 'battle' : 'mega';
}

function productKindLabel(product) {
  return productKind(product) === 'battle' ? 'Pack Batallero · 4 animaciones' : 'Mega Pack · 7 animaciones';
}

function showToast(message, ok = true) {
  clearTimeout(toastTimer);
  toast.classList.toggle('error', !ok);
  $('b', toast).textContent = ok ? '✓' : '!';
  $('span', toast).textContent = message;
  toast.classList.add('show');
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
}

function attachPreview(card, video, source) {
  if (!matchMedia('(hover: hover)').matches || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const play = () => {
    if (!video.src) video.src = source;
    video.play().then(() => video.classList.add('is-playing')).catch(() => {});
  };
  const stop = () => {
    video.classList.remove('is-playing');
    video.pause();
    try { video.currentTime = 0; } catch {}
  };
  card.addEventListener('pointerenter', play);
  card.addEventListener('pointerleave', stop);
  card.addEventListener('focusin', play);
  card.addEventListener('focusout', stop);
}

function priceContent(product) {
  const line = element('div', { className: 'price-line' });
  line.append(element('strong', { text: `${money(product.priceCents, product.currency)} ${product.currency}` }));
  if (product.compareAtPriceCents !== null) {
    line.append(element('del', { text: `${money(product.compareAtPriceCents, product.currency)} ${product.currency}` }));
  }
  return line;
}

function productCard(product) {
  const card = element('article', { className: 'product-card' });
  const href = `/products/${encodeURIComponent(product.slug)}`;
  const poster = element('a', { className: 'product-poster' });
  poster.href = href;
  poster.setAttribute('aria-label', `Ver ${product.name}`);
  const image = element('img');
  image.src = safeImage(product.imagePath);
  image.alt = product.name;
  image.loading = 'lazy';
  const preview = element('video');
  preview.muted = true;
  preview.loop = true;
  preview.playsInline = true;
  preview.preload = 'none';
  preview.poster = image.src;
  preview.disablePictureInPicture = true;
  preview.setAttribute('aria-hidden', 'true');
  poster.append(image, preview, element('span', { className: 'pack-kind', text: productKind(product) === 'battle' ? 'Batallero' : 'Mega Pack' }));
  if (product.compareAtPriceCents !== null) poster.append(element('span', { className: 'sale-badge', text: 'Oferta' }));
  attachPreview(card, preview, safeVideo(product.previewPath));

  const info = element('div', { className: 'product-info' });
  const titleLink = element('a', { className: 'product-title' });
  titleLink.href = href;
  titleLink.append(element('h3', { text: product.name }));
  const add = element('button', { className: 'add-button', text: 'Agregar al carrito', type: 'button' });
  add.dataset.productId = product.id;
  add.dataset.productName = product.name;
  info.append(titleLink, element('p', { className: 'product-meta', text: productKindLabel(product) }), priceContent(product), add);
  card.append(poster, info);
  card.addEventListener('click', (event) => {
    if (event.target.closest('a,button')) return;
    location.assign(href);
  });
  return card;
}

function sortedProducts(products) {
  const list = [...products];
  if (state.sort === 'title-asc') return list.sort((a, b) => a.name.localeCompare(b.name, 'es'));
  if (state.sort === 'title-desc') return list.sort((a, b) => b.name.localeCompare(a.name, 'es'));
  if (state.sort === 'price-asc') return list.sort((a, b) => a.priceCents - b.priceCents || a.sortOrder - b.sortOrder);
  if (state.sort === 'price-desc') return list.sort((a, b) => b.priceCents - a.priceCents || a.sortOrder - b.sortOrder);
  return list.sort((a, b) => a.sortOrder - b.sortOrder);
}

function applyFilters() {
  const normalizedQuery = state.query.trim().toLocaleLowerCase('es');
  const products = sortedProducts(state.products.filter((product) => {
    const filterMatches = state.filter === 'all' || productKind(product) === state.filter;
    const queryMatches = !normalizedQuery || `${product.name} ${product.description || ''}`.toLocaleLowerCase('es').includes(normalizedQuery);
    return filterMatches && queryMatches;
  }));
  grid.replaceChildren();
  for (const product of products) grid.append(productCard(product));
  $('[data-result-count]').textContent = String(products.length);
  $('.active-query').textContent = normalizedQuery ? `Búsqueda: “${state.query.trim()}”` : '';
  $('.empty-results').hidden = products.length > 0;
  grid.hidden = products.length === 0;
}

function renderShowcase(products) {
  const showcase = $('.showcase-grid');
  clearInterval(showcaseRotation);
  showcaseObserver?.disconnect();
  showcaseActiveVideo?.pause();
  showcaseActiveVideo = null;
  showcase.replaceChildren();
  const featuredProducts = products.slice(0, 4);
  for (const product of featuredProducts) {
    const link = element('a', { className: 'showcase-item' });
    link.href = `/products/${encodeURIComponent(product.slug)}`;
    link.setAttribute('aria-label', `Ver ${product.name}`);
    const image = element('img');
    image.src = safeImage(product.imagePath);
    image.alt = product.name;
    const video = element('video');
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = 'none';
    video.disablePictureInPicture = true;
    video.setAttribute('aria-hidden', 'true');
    const source = productVideoSources(product)[0];
    if (source) video.dataset.source = safeVideo(source.url);
    link.append(image, video, element('span', { className: 'showcase-live', text: 'En vivo' }), element('span', { className: 'showcase-name', text: product.name }));
    showcase.append(link);
  }

  const items = $$('.showcase-item', showcase);
  if (!items.length || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let activeIndex = -1;
  let visible = false;
  const activate = (nextIndex) => {
    if (!visible) return;
    const item = items[nextIndex % items.length];
    const video = $('video', item);
    showcaseActiveVideo?.pause();
    items.forEach((entry) => entry.classList.remove('is-live'));
    $$('video', showcase).forEach((entry) => entry.classList.remove('is-playing'));
    activeIndex = nextIndex % items.length;
    item.classList.add('is-live');
    showcaseActiveVideo = video;
    if (!video?.dataset.source) return;
    if (!video.src) {
      video.src = video.dataset.source;
      video.load();
    }
    try { video.currentTime = 0; } catch {}
    video.play().then(() => video.classList.add('is-playing')).catch(() => {});
  };
  showcaseObserver = new IntersectionObserver((entries) => {
    visible = entries[0]?.isIntersecting === true;
    if (!visible) {
      showcaseActiveVideo?.pause();
      return;
    }
    activate(activeIndex < 0 ? 0 : activeIndex);
  }, { threshold: 0.18 });
  showcaseObserver.observe(showcase);
  showcaseRotation = setInterval(() => activate(activeIndex + 1), 6500);
}

function renderNewest(product) {
  if (!product) return;
  const href = `/products/${encodeURIComponent(product.slug)}`;
  const media = $('.newest-media');
  media.href = href;
  media.setAttribute('aria-label', `Ver ${product.name}`);
  const image = $('img', media);
  image.src = safeImage(product.imagePath);
  image.alt = product.name;
  const video = $('.newest-video', media);
  video.poster = image.src;
  featuredPlaylist?.destroy();
  featuredPlaylist = createSequentialPlayer(video, product, {
    onIndex(index, total, source) {
      $('[data-newest-current]').textContent = String(index + 1);
      $('[data-newest-total]').textContent = String(total);
      $('[data-newest-video-name]').textContent = source?.label || product.name;
    },
    onProgress(ratio) {
      $('.newest-progress>i').style.width = `${ratio * 100}%`;
    },
  });
  media.classList.toggle('no-video', featuredPlaylist.sources.length === 0);
  $('#newestTitle').textContent = product.name;
  $('.newest-description').textContent = product.description || 'Una colección coordinada para darle más energía a regalos, batallas y momentos especiales de tu LIVE.';
  const price = $('.newest-price');
  price.replaceChildren(element('strong', { text: `${money(product.priceCents, product.currency)} ${product.currency}` }));
  if (product.compareAtPriceCents !== null) {
    price.append(element('del', { text: `${money(product.compareAtPriceCents, product.currency)} ${product.currency}` }), element('span', { text: 'Oferta' }));
  }
  $('.newest-link').href = href;
}

async function loadProducts() {
  try {
    const response = await fetch('/api/products', { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
    if (!response.ok) throw new Error('No fue posible cargar los packs.');
    const data = await response.json();
    state.products = (Array.isArray(data.products) ? data.products : [])
      .filter((product) => product.category?.slug === 'packs-completos');
    const mega = state.products.filter((product) => productKind(product) === 'mega');
    const battle = state.products.filter((product) => productKind(product) === 'battle');
    $('[data-pack-count]').textContent = String(state.products.length);
    $('[data-mega-count]').textContent = String(mega.length);
    $('[data-battle-count]').textContent = String(battle.length);
    const ordered = [...state.products].sort((a, b) => a.sortOrder - b.sortOrder);
    renderShowcase(ordered);
    renderNewest(ordered.find((product) => product.slug === 'mega-pack-dioses-nordicos') || ordered[0]);
    applyFilters();
  } catch (error) {
    grid.replaceChildren(element('div', { className: 'loading-card', text: error.message }));
    showToast(error.message, false);
  }
}

function setCartCount(count) {
  const badge = $('.cart-count');
  badge.textContent = String(count);
  badge.classList.toggle('on', count > 0);
}

function renderCart(cart) {
  state.cart = cart;
  setCartCount(cart.itemCount || 0);
  $('.cart-total').textContent = `${money(cart.totalCents, cart.currency)} ${cart.currency}`;
  const container = $('.cart-items');
  container.replaceChildren();
  if (!cart.items?.length) {
    container.append(element('p', { className: 'cart-empty', text: 'Tu carrito está vacío.' }));
    return;
  }
  for (const item of cart.items) {
    const row = element('article', { className: 'cart-item' });
    const image = element('img'); image.src = safeImage(item.imagePath); image.alt = '';
    const copy = element('div', { className: 'cart-item-copy' });
    const link = element('a', { text: item.name }); link.href = `/products/${encodeURIComponent(item.slug)}`;
    const details = element('small', { text: `${item.quantity} × ${money(item.unitPriceCents, item.currency)} ${item.currency}` });
    const actions = element('div', { className: 'cart-item-actions' });
    const buy = element('button', { className: 'cart-buy', text: 'Comprar ahora', type: 'button' }); buy.dataset.cartBuy = item.productId;
    const remove = element('button', { className: 'cart-remove', text: 'Quitar', type: 'button' }); remove.dataset.cartRemove = item.productId;
    actions.append(buy, remove); copy.append(link, details, actions); row.append(image, copy); container.append(row);
  }
}

async function loadCart() {
  try {
    const response = await fetch('/api/cart', { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
    if (!response.ok) throw new Error('No fue posible consultar el carrito.');
    const data = await response.json();
    renderCart(data.cart);
  } catch (error) {
    showToast(error.message, false);
  }
}

async function addToCart(button) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'Agregando…';
  try {
    const response = await fetch('/api/cart/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ productId: button.dataset.productId, quantity: 1 }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'No fue posible agregar el producto.');
    renderCart(data.cart);
    button.textContent = 'Agregado ✓';
    button.classList.add('added');
    showToast(`${button.dataset.productName} agregado al carrito.`);
  } catch (error) {
    button.textContent = original;
    showToast(error.message, false);
  } finally {
    button.disabled = false;
  }
}

async function removeCartItem(productId, button) {
  button.disabled = true;
  try {
    const response = await fetch(`/api/cart/items/${encodeURIComponent(productId)}`, {
      method: 'DELETE', headers: { Accept: 'application/json' }, credentials: 'same-origin',
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'No fue posible quitar el producto.');
    renderCart(data.cart);
    showToast('Producto retirado del carrito.');
  } catch (error) {
    button.disabled = false;
    showToast(error.message, false);
  }
}

async function startCheckout(productId, button) {
  button.disabled = true;
  const original = button.textContent;
  button.textContent = 'Abriendo…';
  try {
    const response = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ productId }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'No fue posible iniciar el pago.');
    location.assign(data.checkoutUrl);
  } catch (error) {
    button.disabled = false;
    button.textContent = original;
    showToast(error.message, false);
  }
}

function openCart() {
  drawerBackdrop.hidden = false;
  cartDrawer.classList.add('open');
  cartDrawer.setAttribute('aria-hidden', 'false');
  $('.cart-toggle').setAttribute('aria-expanded', 'true');
  document.body.classList.add('modal-open');
  $('.cart-close').focus();
  loadCart();
}

function closeCart() {
  cartDrawer.classList.remove('open');
  cartDrawer.setAttribute('aria-hidden', 'true');
  $('.cart-toggle').setAttribute('aria-expanded', 'false');
  drawerBackdrop.hidden = true;
  document.body.classList.remove('modal-open');
  $('.cart-toggle').focus();
}

function setFilter(filter) {
  state.filter = filter;
  $$('.filter').forEach((button) => {
    const active = button.dataset.filter === filter;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  applyFilters();
}

$$('.filter').forEach((button) => button.addEventListener('click', () => setFilter(button.dataset.filter)));
$('#collectionSort').addEventListener('change', (event) => { state.sort = event.target.value; applyFilters(); });
$$('.compare-filter').forEach((button) => button.addEventListener('click', () => {
  setFilter(button.dataset.compareFilter);
  $('#productos').scrollIntoView({ behavior: 'smooth' });
}));
$('.reset-filters').addEventListener('click', () => {
  state.query = '';
  $('#collectionSearchInput').value = '';
  setFilter('all');
});

const searchToggle = $('.search-toggle');
const searchPanel = $('.search-panel');
const searchInput = $('#collectionSearchInput');
function closeSearch() {
  searchPanel.hidden = true;
  searchToggle.setAttribute('aria-expanded', 'false');
}
searchToggle.addEventListener('click', () => {
  const opening = searchPanel.hidden;
  searchPanel.hidden = !opening;
  searchToggle.setAttribute('aria-expanded', String(opening));
  if (opening) searchInput.focus();
});
$('.search-close').addEventListener('click', closeSearch);
searchInput.addEventListener('input', () => { state.query = searchInput.value; applyFilters(); });

const menuButton = $('.menu-button');
const navLinks = $('.nav-links');
menuButton.addEventListener('click', () => {
  const opening = menuButton.getAttribute('aria-expanded') !== 'true';
  menuButton.setAttribute('aria-expanded', String(opening));
  navLinks.classList.toggle('open', opening);
});
$$('a', navLinks).forEach((link) => link.addEventListener('click', () => {
  menuButton.setAttribute('aria-expanded', 'false');
  navLinks.classList.remove('open');
}));

$('.cart-toggle').addEventListener('click', openCart);
$('.cart-close').addEventListener('click', closeCart);
drawerBackdrop.addEventListener('click', closeCart);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && cartDrawer.classList.contains('open')) closeCart();
  else if (event.key === 'Escape' && !searchPanel.hidden) closeSearch();
});

document.addEventListener('click', (event) => {
  if (!(event.target instanceof Element)) return;
  const add = event.target.closest('[data-product-id]');
  const remove = event.target.closest('[data-cart-remove]');
  const buy = event.target.closest('[data-cart-buy]');
  if (add && !add.disabled) addToCart(add);
  if (remove && !remove.disabled) removeCartItem(remove.dataset.cartRemove, remove);
  if (buy && !buy.disabled) startCheckout(buy.dataset.cartBuy, buy);
});

$('.newsletter-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const input = $('input', form);
  const button = $('button', form);
  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'Enviando…';
  try {
    const response = await fetch('/api/newsletter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ email: input.value }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'No fue posible guardar el correo.');
    input.value = '';
    button.textContent = '¡Suscrito!';
    showToast('Tu correo quedó registrado.');
  } catch (error) {
    button.textContent = original;
    showToast(error.message, false);
  } finally {
    button.disabled = false;
  }
});

loadProducts();
loadCart();
