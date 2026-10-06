const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = {
  products: [], categories: [], users: [], usersLoaded: false,
  editingId: null, deactivateId: null, editingUserId: null,
};
const productDialog = $('.product-dialog');
const confirmDialog = $('.confirm-dialog');
const form = $('.product-form');
let userDialog;
let userForm;

const money = (cents, currency = 'USD') => new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency,
}).format(Number(cents || 0) / 100);
const inputMoney = (cents) => cents == null ? '' : (cents / 100).toFixed(2);

function createElement(tag, { className, text, type } = {}) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  if (type) element.type = type;
  return element;
}

function appendCell(row, content, className) {
  const cell = createElement('td', { className });
  if (content instanceof Node) cell.append(content);
  else cell.textContent = content;
  row.append(cell);
  return cell;
}

function cents(value, optional = false) {
  const text = String(value ?? '').trim().replace(',', '.');
  if (optional && !text) return null;
  if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(text)) {
    throw new Error('Escribe un precio válido con máximo dos decimales.');
  }
  const result = Math.round(Number(text) * 100);
  if (result < 50 || result > 100000000) {
    throw new Error('El precio debe estar entre US$0.50 y US$1,000,000.00.');
  }
  return result;
}

function slug(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 120);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
    credentials: 'same-origin',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'No fue posible completar la operación.');
  return data;
}

let toastTimer;
function toast(message, type = 'success') {
  const element = $('.toast');
  element.textContent = message;
  element.className = `toast ${type === 'error' ? 'error ' : ''}show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { element.className = 'toast'; }, 3600);
}

function initializeUsersInterface() {
  const usersLink = createElement('a');
  usersLink.href = '#usuarios';
  usersLink.dataset.view = 'users';
  usersLink.append(createElement('span', { text: '♙' }), document.createTextNode('Usuarios'));
  const storeLink = [...$$('.side-nav a')].find((link) => !link.dataset.view);
  $('.side-nav').insertBefore(usersLink, storeLink ?? null);

  const usersModule = [...$$('.module')].find((module) => $('h3', module)?.textContent.trim() === 'Usuarios');
  if (usersModule) {
    usersModule.classList.add('enabled');
    usersModule.tabIndex = 0;
    usersModule.setAttribute('role', 'button');
    const badge = $('.soon', usersModule);
    if (badge) { badge.className = 'ready'; badge.textContent = 'Activo'; }
    usersModule.addEventListener('click', () => show('users'));
    usersModule.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); show('users'); }
    });
  }

  const view = createElement('section', { className: 'view' });
  view.dataset.panel = 'users';
  view.hidden = true;
  const head = createElement('div', { className: 'workspace-head' });
  const heading = createElement('div');
  heading.append(
    createElement('h2', { text: 'Usuarios' }),
    createElement('p', { text: 'Perfiles, verificación de correo y roles autorizados.' }),
  );
  const refresh = createElement('button', { className: 'secondary refresh-users', text: 'Actualizar', type: 'button' });
  head.append(heading, refresh);
  const toolbar = createElement('div', { className: 'toolbar' });
  const searchLabel = createElement('label', { className: 'search' });
  const search = createElement('input');
  search.className = 'user-search';
  search.type = 'search';
  search.placeholder = 'Buscar por nombre o correo…';
  searchLabel.append(search);
  toolbar.append(searchLabel);
  const card = createElement('div', { className: 'table-card' });
  const scroll = createElement('div', { className: 'table-scroll' });
  const table = createElement('table', { className: 'data-table' });
  const header = createElement('thead');
  const headerRow = createElement('tr');
  for (const label of ['Usuario', 'Rol', 'Correo', 'Registro', 'Último acceso', 'Acciones']) {
    headerRow.append(createElement('th', { text: label }));
  }
  header.append(headerRow);
  const body = createElement('tbody', { className: 'users-body' });
  body.append(emptyRow(6, 'Abre la sección para cargar los usuarios.'));
  table.append(header, body); scroll.append(table); card.append(scroll); view.append(head, toolbar, card);
  $('main').append(view);

  userDialog = createElement('dialog', { className: 'user-dialog' });
  userForm = createElement('form', { className: 'user-form' });
  const modalHead = createElement('div', { className: 'modal-head' });
  modalHead.append(
    createElement('h2', { text: 'Editar usuario' }),
    createElement('button', { className: 'close close-user', text: '×', type: 'button' }),
  );
  const modalBody = createElement('div', { className: 'modal-body' });
  const grid = createElement('div', { className: 'form-grid' });
  const nameField = createElement('div', { className: 'field full' });
  const nameLabel = createElement('label', { text: 'Nombre visible' });
  nameLabel.htmlFor = 'user-display-name';
  const nameInput = createElement('input');
  nameInput.id = 'user-display-name'; nameInput.name = 'displayName'; nameInput.maxLength = 100;
  nameField.append(nameLabel, nameInput);
  const emailField = createElement('div', { className: 'field full' });
  emailField.append(createElement('label', { text: 'Correo electrónico' }));
  const emailValue = createElement('input');
  emailValue.name = 'email'; emailValue.disabled = true;
  emailField.append(emailValue);
  const roleField = createElement('div', { className: 'field full' });
  roleField.append(createElement('label', { text: 'Rol' }));
  const roleSelect = createElement('select');
  roleSelect.name = 'role';
  for (const [value, text] of [['customer', 'Cliente'], ['admin', 'Administrador']]) {
    const option = createElement('option', { text }); option.value = value; roleSelect.append(option);
  }
  roleField.append(roleSelect, createElement('small', { className: 'role-help', text: 'Solo cuentas con correo confirmado pueden ser administradoras.' }));
  grid.append(nameField, emailField, roleField);
  modalBody.append(grid, createElement('p', { className: 'form-error user-error' }));
  const modalFoot = createElement('div', { className: 'modal-foot' });
  modalFoot.append(
    createElement('button', { className: 'secondary cancel-user', text: 'Cancelar', type: 'button' }),
    createElement('button', { className: 'primary save-user', text: 'Guardar usuario', type: 'submit' }),
  );
  userForm.append(modalHead, modalBody, modalFoot); userDialog.append(userForm); document.body.append(userDialog);

  search.addEventListener('input', renderUsers);
  refresh.addEventListener('click', () => loadUsers(true));
  $('.close-user').addEventListener('click', () => userDialog.close());
  $('.cancel-user').addEventListener('click', () => userDialog.close());
  body.addEventListener('click', (event) => {
    const edit = event.target.closest('[data-edit-user]');
    if (edit) openUser(state.users.find((user) => user.id === edit.dataset.editUser));
  });
  userForm.addEventListener('submit', saveUser);
}

function show(view) {
  $$('.view').forEach((panel) => { panel.hidden = panel.dataset.panel !== view; });
  $$('[data-view]').forEach((link) => link.classList.toggle('active', link.dataset.view === view));
  $('.page-title').textContent = view === 'products' ? 'Productos' : view === 'prices' ? 'Precios' : view === 'users' ? 'Usuarios' : 'Administración';
  history.replaceState(null, '', `#${view === 'dashboard' ? 'resumen' : view}`);
  if (view === 'users' && !state.usersLoaded) loadUsers().catch((error) => toast(error.message, 'error'));
}

function matches(product, query) {
  return [product.name, product.slug, product.category?.name].join(' ')
    .toLowerCase().includes(query.trim().toLowerCase());
}

function productCell(product) {
  const wrapper = createElement('div', { className: 'product-cell' });
  const image = createElement('img');
  image.src = `/${product.imagePath}`;
  image.alt = '';
  const details = createElement('div');
  details.append(
    createElement('strong', { text: product.name }),
    createElement('small', { text: product.slug }),
  );
  wrapper.append(image, details);
  return wrapper;
}

function statusBadge(product) {
  return createElement('span', {
    className: `status ${product.isActive ? 'active' : 'draft'}`,
    text: product.isActive ? 'Publicado' : 'Desactivado',
  });
}

function emptyRow(columns, message) {
  const row = createElement('tr');
  const cell = appendCell(row, message, 'empty');
  cell.colSpan = columns;
  return row;
}

function renderProducts() {
  const body = $('.products-body');
  const products = state.products.filter((product) => matches(product, $('.product-search').value));
  body.replaceChildren();
  if (!products.length) return body.append(emptyRow(6, 'No hay productos que coincidan.'));

  for (const product of products) {
    const row = createElement('tr');
    appendCell(row, productCell(product));
    appendCell(row, product.category?.name || 'Sin categoría');
    appendCell(row, money(product.priceCents, product.currency)).firstChild?.parentElement?.classList.add('price-cell');
    appendCell(row, statusBadge(product));
    appendCell(row, product.updatedAt ? new Date(product.updatedAt).toLocaleDateString('es-CO') : '—');
    const actions = createElement('div', { className: 'actions' });
    const edit = createElement('button', { className: 'small-button', text: 'Editar', type: 'button' });
    edit.dataset.edit = product.id;
    actions.append(edit);
    if (product.isActive) {
      const deactivate = createElement('button', { className: 'small-button remove', text: 'Desactivar', type: 'button' });
      deactivate.dataset.deactivate = product.id;
      actions.append(deactivate);
    }
    appendCell(row, actions);
    body.append(row);
  }
}

function priceInput(product, kind) {
  const input = createElement('input', { className: 'price-input' });
  input.inputMode = 'decimal';
  input.value = inputMoney(kind === 'price' ? product.priceCents : product.compareAtPriceCents);
  if (kind === 'price') input.dataset.price = product.id;
  else {
    input.dataset.compare = product.id;
    input.placeholder = 'Sin oferta';
  }
  return input;
}

function renderPrices() {
  const body = $('.prices-body');
  const products = state.products.filter((product) => matches(product, $('.price-search').value));
  body.replaceChildren();
  if (!products.length) return body.append(emptyRow(5, 'No hay productos que coincidan.'));

  for (const product of products) {
    const row = createElement('tr');
    appendCell(row, productCell(product));
    const currentPrice = createElement('div', { className: 'price-wrap' });
    currentPrice.append(createElement('span', { className: 'currency', text: 'USD' }), priceInput(product, 'price'));
    appendCell(row, currentPrice);
    appendCell(row, priceInput(product, 'compare'));
    appendCell(row, statusBadge(product));
    const save = createElement('button', { className: 'primary save-price', text: 'Guardar', type: 'button' });
    save.dataset.savePrice = product.id;
    appendCell(row, save);
    body.append(row);
  }
}

function renderUsers() {
  const body = $('.users-body');
  if (!body) return;
  const query = $('.user-search').value.trim().toLowerCase();
  const users = state.users.filter((user) => [user.displayName, user.email, user.role]
    .join(' ').toLowerCase().includes(query));
  body.replaceChildren();
  if (!users.length) return body.append(emptyRow(6, 'No hay usuarios que coincidan.'));

  for (const user of users) {
    const row = createElement('tr');
    const identity = createElement('div', { className: 'product-cell' });
    const avatar = createElement('img');
    avatar.src = '/assets/favicon.png'; avatar.alt = '';
    const details = createElement('div');
    details.append(
      createElement('strong', { text: user.displayName || 'Sin nombre' }),
      createElement('small', { text: user.email || (user.isAnonymous ? 'Usuario invitado' : 'Sin correo') }),
    );
    identity.append(avatar, details);
    appendCell(row, identity);
    appendCell(row, createElement('span', {
      className: `status ${user.role === 'admin' ? 'active' : 'draft'}`,
      text: user.role === 'admin' ? 'Administrador' : 'Cliente',
    }));
    appendCell(row, createElement('span', {
      className: `status ${user.emailConfirmed ? 'active' : 'draft'}`,
      text: user.emailConfirmed ? 'Confirmado' : 'Pendiente',
    }));
    appendCell(row, user.createdAt ? new Date(user.createdAt).toLocaleDateString('es-CO') : '—');
    appendCell(row, user.lastSignInAt ? new Date(user.lastSignInAt).toLocaleDateString('es-CO') : 'Nunca');
    const edit = createElement('button', { className: 'small-button', text: 'Editar', type: 'button' });
    edit.dataset.editUser = user.id;
    appendCell(row, edit);
    body.append(row);
  }
}

async function loadUsers(force = false) {
  if (state.usersLoaded && !force) return;
  const body = $('.users-body');
  if (body) { body.replaceChildren(); body.append(emptyRow(6, 'Cargando usuarios…')); }
  const data = await api('/api/admin/users');
  state.users = data.users;
  state.usersLoaded = true;
  renderUsers();
}

function openUser(user) {
  if (!user) return;
  state.editingUserId = user.id;
  userForm.reset();
  userForm.elements.displayName.value = user.displayName || '';
  userForm.elements.email.value = user.email || 'Sin correo';
  userForm.elements.role.value = user.role;
  userForm.elements.role.disabled = user.isPrimaryAdmin;
  $('.role-help').textContent = user.isPrimaryAdmin
    ? 'La cuenta administradora principal está protegida.'
    : user.emailConfirmed
      ? 'Este usuario puede recibir un rol administrativo.'
      : 'Debe confirmar su correo antes de poder ser administrador.';
  $('.user-error').textContent = '';
  userDialog.showModal();
}

async function saveUser(event) {
  event.preventDefault();
  const button = $('.save-user');
  const user = state.users.find((item) => item.id === state.editingUserId);
  try {
    const role = user.isPrimaryAdmin ? 'admin' : userForm.elements.role.value;
    button.disabled = true;
    await api(`/api/admin/users/${user.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ displayName: userForm.elements.displayName.value.trim(), role }),
    });
    userDialog.close();
    state.usersLoaded = false;
    await loadUsers(true);
    toast('Usuario actualizado correctamente.');
  } catch (error) {
    $('.user-error').textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

function render() { renderProducts(); renderPrices(); }

async function loadCatalog() {
  const data = await api('/api/admin/catalog');
  state.products = data.products;
  state.categories = data.categories;
  const select = $('#pc');
  select.replaceChildren();
  for (const category of state.categories) {
    const option = createElement('option', { text: `${category.name}${category.isActive ? '' : ' (inactiva)'}` });
    option.value = category.id;
    option.disabled = !category.isActive;
    select.append(option);
  }
  render();
}

async function load() {
  try {
    const session = await api('/api/auth/session');
    if (!session.authenticated || !session.user?.isAdmin) {
      location.replace('/?auth=signin&next=%2Fadmin');
      return;
    }
    $('.admin-name').textContent = session.user.displayName || 'Administrador';
    $('.admin-email').textContent = session.user.email || '';
    await loadCatalog();
    show(location.hash === '#productos' ? 'products'
      : location.hash === '#precios' ? 'prices'
        : location.hash === '#usuarios' ? 'users' : 'dashboard');
  } catch (error) {
    toast(error.message, 'error');
  }
}

function openProduct(product = null) {
  state.editingId = product?.id || null;
  form.reset();
  $('.form-title').textContent = product ? 'Editar producto' : 'Nuevo producto';
  $('.save-product').textContent = product ? 'Guardar cambios' : 'Crear producto';
  const values = {
    name: product?.name || '', slug: product?.slug || '', description: product?.description || '',
    categoryId: product?.categoryId || state.categories.find((category) => category.isActive)?.id || '',
    imagePath: product?.imagePath || 'assets/favicon.png', price: inputMoney(product?.priceCents),
    comparePrice: inputMoney(product?.compareAtPriceCents), sortOrder: product?.sortOrder ?? 0,
  };
  for (const [name, value] of Object.entries(values)) form.elements[name].value = value;
  form.elements.isActive.checked = product?.isActive ?? true;
  $('.form-error').textContent = '';
  productDialog.showModal();
}

let slugEdited = false;
$('.new-product').addEventListener('click', () => { slugEdited = false; openProduct(); });
$('.close-product').addEventListener('click', () => productDialog.close());
$('.cancel-product').addEventListener('click', () => productDialog.close());
form.elements.slug.addEventListener('input', () => { slugEdited = true; });
form.elements.name.addEventListener('input', () => {
  if (!state.editingId && !slugEdited) form.elements.slug.value = slug(form.elements.name.value);
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('.save-product');
  try {
    const priceCents = cents(form.elements.price.value);
    const compareAtPriceCents = cents(form.elements.comparePrice.value, true);
    if (compareAtPriceCents !== null && compareAtPriceCents < priceCents) {
      throw new Error('El precio anterior no puede ser menor que el actual.');
    }
    const payload = {
      name: form.elements.name.value.trim(), slug: form.elements.slug.value.trim(),
      description: form.elements.description.value.trim(), categoryId: form.elements.categoryId.value,
      imagePath: form.elements.imagePath.value.trim(), priceCents, compareAtPriceCents,
      currency: 'USD', sortOrder: Number(form.elements.sortOrder.value),
      isActive: form.elements.isActive.checked,
    };
    button.disabled = true;
    const editingId = state.editingId;
    await api(editingId ? `/api/admin/products/${editingId}` : '/api/admin/products', {
      method: editingId ? 'PATCH' : 'POST', body: JSON.stringify(payload),
    });
    productDialog.close();
    await loadCatalog();
    toast(editingId ? 'Producto actualizado.' : 'Producto creado y conectado al checkout.');
  } catch (error) {
    $('.form-error').textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

$('.products-body').addEventListener('click', (event) => {
  const edit = event.target.closest('[data-edit]');
  const deactivate = event.target.closest('[data-deactivate]');
  if (edit) openProduct(state.products.find((product) => product.id === edit.dataset.edit));
  if (deactivate) {
    const product = state.products.find((item) => item.id === deactivate.dataset.deactivate);
    state.deactivateId = product.id;
    $('.confirm-name').textContent = product.name;
    confirmDialog.showModal();
  }
});

$$('.cancel-deactivate').forEach((button) => button.addEventListener('click', () => confirmDialog.close()));
$('.confirm-deactivate').addEventListener('click', async () => {
  const button = $('.confirm-deactivate');
  try {
    button.disabled = true;
    await api(`/api/admin/products/${state.deactivateId}`, { method: 'DELETE' });
    confirmDialog.close();
    await loadCatalog();
    toast('Producto desactivado; el historial se conserva.');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    button.disabled = false;
  }
});

$('.prices-body').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-save-price]');
  if (!button) return;
  const id = button.dataset.savePrice;
  const product = state.products.find((item) => item.id === id);
  try {
    const priceCents = cents($(`[data-price="${id}"]`).value);
    const compareAtPriceCents = cents($(`[data-compare="${id}"]`).value, true);
    if (compareAtPriceCents !== null && compareAtPriceCents < priceCents) {
      throw new Error('El precio anterior no puede ser menor que el actual.');
    }
    button.disabled = true;
    await api(`/api/admin/products/${id}`, {
      method: 'PATCH', body: JSON.stringify({ priceCents, compareAtPriceCents }),
    });
    await loadCatalog();
    toast(`Precio de ${product.name} actualizado. La tienda ya usa el nuevo valor.`);
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    button.disabled = false;
  }
});

initializeUsersInterface();
$('.product-search').addEventListener('input', renderProducts);
$('.price-search').addEventListener('input', renderPrices);
$$('[data-view]').forEach((link) => link.addEventListener('click', (event) => {
  event.preventDefault(); show(link.dataset.view);
}));
$$('[data-open-view]').forEach((button) => button.addEventListener('click', () => show(button.dataset.openView)));
$('.signout').addEventListener('click', async () => {
  try { await api('/api/auth/signout', { method: 'POST' }); }
  finally { location.replace('/'); }
});

load();
