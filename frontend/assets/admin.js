const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = {
  products: [], categories: [], users: [], usersLoaded: false, orders: [], ordersLoaded: false, orderSummary: null,
  media: [], mediaCover: null, editingId: null, deactivateId: null, editingUserId: null,
  mediaProductId: null, activeOrderId: null, orderAction: null,
  editingCategoryId: null, deactivateCategoryId: null,
};
const productDialog = $('.product-dialog');
const confirmDialog = $('.confirm-dialog');
const form = $('.product-form');
let userDialog;
let userForm;
let mediaDialog;
let orderDialog;
let orderActionDialog;
let categoryDialog;
let categoryForm;
let categoryDeactivateDialog;
let categorySlugEdited = false;

const money = (cents, currency = 'USD') => new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency,
}).format(Number(cents || 0) / 100);
const inputMoney = (cents) => cents == null ? '' : (cents / 100).toFixed(2);
const formatDateTime = (value) => value ? new Intl.DateTimeFormat('es-CO', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Bogota',
}).format(new Date(value)) : '—';
const orderStatusLabels = {
  draft: 'Borrador', pending: 'Pendiente', completed: 'Pagado', cancelled: 'Cancelado', refunded: 'Reembolsado',
};

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

function initializeCategoriesInterface() {
  const categoriesLink = createElement('a');
  categoriesLink.href = '#categorias';
  categoriesLink.dataset.view = 'categories';
  categoriesLink.append(createElement('span', { text: '⌘' }), document.createTextNode('Categorías'));
  const storeLink = [...$$('.side-nav a')].find((link) => !link.dataset.view);
  $('.side-nav').insertBefore(categoriesLink, storeLink ?? null);

  const categoriesModule = [...$$('.module')].find((module) => $('h3', module)?.textContent.trim() === 'Categorías');
  if (categoriesModule) {
    categoriesModule.classList.add('enabled');
    categoriesModule.tabIndex = 0;
    categoriesModule.setAttribute('role', 'button');
    const badge = $('.soon', categoriesModule);
    if (badge) { badge.className = 'ready'; badge.textContent = 'Activo'; }
    categoriesModule.addEventListener('click', () => show('categories'));
    categoriesModule.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); show('categories'); }
    });
  }

  const view = createElement('section', { className: 'view categories-view' });
  view.dataset.panel = 'categories'; view.hidden = true;
  const head = createElement('div', { className: 'workspace-head' });
  const heading = createElement('div');
  heading.append(
    createElement('h2', { text: 'Categorías' }),
    createElement('p', { text: 'Organiza las colecciones, su orden y visibilidad en la tienda.' }),
  );
  const createButton = createElement('button', { className: 'primary new-category', text: '+ Nueva categoría', type: 'button' });
  head.append(heading, createButton);
  const toolbar = createElement('div', { className: 'toolbar' });
  const searchLabel = createElement('label', { className: 'search' });
  const search = createElement('input');
  search.className = 'category-search'; search.type = 'search';
  search.placeholder = 'Buscar por nombre o slug…'; searchLabel.append(search); toolbar.append(searchLabel);
  const card = createElement('div', { className: 'table-card' });
  const scroll = createElement('div', { className: 'table-scroll' });
  const table = createElement('table', { className: 'data-table categories-table' });
  const header = createElement('thead'); const headerRow = createElement('tr');
  for (const label of ['Categoría', 'Productos', 'Publicados', 'Orden', 'Estado', 'Actualizada', 'Acciones']) {
    headerRow.append(createElement('th', { text: label }));
  }
  header.append(headerRow);
  const body = createElement('tbody', { className: 'categories-body' });
  body.append(emptyRow(7, 'Cargando categorías…'));
  table.append(header, body); scroll.append(table); card.append(scroll); view.append(head, toolbar, card);
  $('main').append(view);

  categoryDialog = createElement('dialog', { className: 'category-dialog' });
  categoryForm = createElement('form', { className: 'category-form' });
  const modalHead = createElement('div', { className: 'modal-head' });
  modalHead.append(
    createElement('h2', { className: 'category-form-title', text: 'Nueva categoría' }),
    createElement('button', { className: 'close close-category', text: '×', type: 'button' }),
  );
  const modalBody = createElement('div', { className: 'modal-body' });
  const grid = createElement('div', { className: 'form-grid' });
  const nameField = createElement('div', { className: 'field full' });
  nameField.append(createElement('label', { text: 'Nombre' }));
  const nameInput = createElement('input');
  nameInput.name = 'name'; nameInput.maxLength = 100; nameInput.required = true; nameField.append(nameInput);
  const slugField = createElement('div', { className: 'field full' });
  slugField.append(createElement('label', { text: 'Slug de la URL' }));
  const slugInput = createElement('input');
  slugInput.name = 'slug'; slugInput.maxLength = 80; slugInput.required = true;
  slugInput.pattern = '[a-z0-9]+(?:-[a-z0-9]+)*';
  slugField.append(slugInput, createElement('small', { text: 'Solo minúsculas, números y guiones.' }));
  const orderField = createElement('div', { className: 'field' });
  orderField.append(createElement('label', { text: 'Orden de aparición' }));
  const orderInput = createElement('input');
  orderInput.name = 'sortOrder'; orderInput.type = 'number'; orderInput.min = '0';
  orderInput.max = '100000'; orderInput.required = true; orderField.append(orderInput);
  const visibilityField = createElement('div', { className: 'field' });
  visibilityField.append(createElement('label', { text: 'Visibilidad' }));
  const switchLabel = createElement('label', { className: 'switch-line' });
  const activeInput = createElement('input'); activeInput.name = 'isActive'; activeInput.type = 'checkbox';
  switchLabel.append(activeInput, document.createTextNode(' Visible en la tienda'));
  visibilityField.append(switchLabel);
  grid.append(nameField, slugField, orderField, visibilityField);
  modalBody.append(grid, createElement('p', { className: 'form-error category-error' }));
  const modalFoot = createElement('div', { className: 'modal-foot' });
  modalFoot.append(
    createElement('button', { className: 'secondary cancel-category', text: 'Cancelar', type: 'button' }),
    createElement('button', { className: 'primary save-category', text: 'Crear categoría', type: 'submit' }),
  );
  categoryForm.append(modalHead, modalBody, modalFoot); categoryDialog.append(categoryForm); document.body.append(categoryDialog);

  categoryDeactivateDialog = createElement('dialog', { className: 'confirm-dialog category-deactivate-dialog' });
  const deactivateShell = createElement('div');
  const deactivateHead = createElement('div', { className: 'modal-head' });
  deactivateHead.append(
    createElement('h2', { text: 'Desactivar categoría' }),
    createElement('button', { className: 'close cancel-category-deactivate', text: '×', type: 'button' }),
  );
  const deactivateBody = createElement('div', { className: 'modal-body' });
  const deactivateCopy = createElement('p');
  deactivateCopy.append(
    createElement('strong', { className: 'category-deactivate-name' }),
    document.createTextNode(' dejará de mostrarse en la tienda junto con sus productos. Los productos y pedidos se conservarán.'),
  );
  deactivateBody.append(deactivateCopy);
  const deactivateFoot = createElement('div', { className: 'modal-foot' });
  deactivateFoot.append(
    createElement('button', { className: 'secondary cancel-category-deactivate', text: 'Volver', type: 'button' }),
    createElement('button', { className: 'danger confirm-category-deactivate', text: 'Sí, desactivar', type: 'button' }),
  );
  deactivateShell.append(deactivateHead, deactivateBody, deactivateFoot);
  categoryDeactivateDialog.append(deactivateShell); document.body.append(categoryDeactivateDialog);

  search.addEventListener('input', renderCategories);
  createButton.addEventListener('click', () => openCategory());
  $('.close-category').addEventListener('click', () => categoryDialog.close());
  $('.cancel-category').addEventListener('click', () => categoryDialog.close());
  nameInput.addEventListener('input', () => {
    if (!state.editingCategoryId && !categorySlugEdited) slugInput.value = slug(nameInput.value);
  });
  slugInput.addEventListener('input', () => { categorySlugEdited = true; });
  categoryForm.addEventListener('submit', saveCategory);
  body.addEventListener('click', handleCategoryAction);
  $$('.cancel-category-deactivate', categoryDeactivateDialog)
    .forEach((button) => button.addEventListener('click', () => categoryDeactivateDialog.close()));
  $('.confirm-category-deactivate', categoryDeactivateDialog).addEventListener('click', deactivateCategory);
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

function initializeOrdersInterface() {
  const ordersLink = createElement('a');
  ordersLink.href = '#pedidos';
  ordersLink.dataset.view = 'orders';
  ordersLink.append(createElement('span', { text: '▤' }), document.createTextNode('Pedidos'));
  const storeLink = [...$$('.side-nav a')].find((link) => !link.dataset.view);
  $('.side-nav').insertBefore(ordersLink, storeLink ?? null);

  const ordersModule = [...$$('.module')].find((module) => $('h3', module)?.textContent.trim() === 'Pedidos y compras');
  if (ordersModule) {
    ordersModule.classList.add('enabled');
    ordersModule.tabIndex = 0;
    ordersModule.setAttribute('role', 'button');
    const badge = $('.soon', ordersModule);
    if (badge) { badge.className = 'ready'; badge.textContent = 'Activo'; }
    ordersModule.addEventListener('click', () => show('orders'));
    ordersModule.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); show('orders'); }
    });
  }

  const view = createElement('section', { className: 'view orders-view' });
  view.dataset.panel = 'orders';
  view.hidden = true;
  const head = createElement('div', { className: 'workspace-head' });
  const heading = createElement('div');
  heading.append(
    createElement('h2', { text: 'Pedidos y compras' }),
    createElement('p', { text: 'Historial de checkout, pagos confirmados por webhook y compradores.' }),
  );
  const refresh = createElement('button', { className: 'secondary refresh-orders', text: 'Actualizar', type: 'button' });
  head.append(heading, refresh);

  const stats = createElement('section', { className: 'order-stats' });
  for (const [key, label] of [
    ['completed', 'Ventas confirmadas'], ['total', 'Total registrado'],
    ['pending', 'Pendientes'], ['testMode', 'Pedidos de prueba'],
  ]) {
    const card = createElement('article', { className: 'order-stat' });
    const value = createElement('strong', { text: '—' }); value.dataset.orderStat = key;
    card.append(createElement('span', { text: label }), value);
    stats.append(card);
  }

  const toolbar = createElement('div', { className: 'toolbar order-toolbar' });
  const searchLabel = createElement('label', { className: 'search' });
  const search = createElement('input');
  search.className = 'order-search'; search.type = 'search';
  search.placeholder = 'Buscar pedido, correo o producto…';
  searchLabel.append(search);
  const status = createElement('select', { className: 'order-status-filter' });
  for (const [value, text] of [['', 'Todos los estados'], ...Object.entries(orderStatusLabels)]) {
    const option = createElement('option', { text }); option.value = value; status.append(option);
  }
  toolbar.append(searchLabel, status);

  const card = createElement('div', { className: 'table-card' });
  const scroll = createElement('div', { className: 'table-scroll' });
  const table = createElement('table', { className: 'data-table orders-table' });
  const header = createElement('thead');
  const headerRow = createElement('tr');
  for (const label of ['Pedido', 'Cliente', 'Productos', 'Total', 'Estado', 'Fecha', 'Acciones']) {
    headerRow.append(createElement('th', { text: label }));
  }
  header.append(headerRow);
  const body = createElement('tbody', { className: 'orders-body' });
  body.append(emptyRow(7, 'Abre la sección para cargar los pedidos.'));
  table.append(header, body); scroll.append(table); card.append(scroll);
  const limitNote = createElement('p', { className: 'orders-limit-note', text: 'Se muestran hasta los 500 pedidos más recientes.' });
  view.append(head, stats, toolbar, card, limitNote); $('main').append(view);

  orderDialog = createElement('dialog', { className: 'order-dialog' });
  const shell = createElement('div');
  const modalHead = createElement('div', { className: 'modal-head' });
  modalHead.append(
    createElement('div', { className: 'order-detail-heading' }),
    createElement('button', { className: 'close close-order', text: '×', type: 'button' }),
  );
  const modalBody = createElement('div', { className: 'modal-body order-detail' });
  const modalFoot = createElement('div', { className: 'modal-foot' });
  modalFoot.append(createElement('button', { className: 'secondary close-order', text: 'Cerrar', type: 'button' }));
  shell.append(modalHead, modalBody, modalFoot); orderDialog.append(shell); document.body.append(orderDialog);

  orderActionDialog = createElement('dialog', { className: 'confirm-dialog order-action-dialog' });
  const actionShell = createElement('div');
  const actionHead = createElement('div', { className: 'modal-head' });
  actionHead.append(
    createElement('h2', { className: 'order-action-title', text: 'Gestionar pedido' }),
    createElement('button', { className: 'close close-order-action', text: '×', type: 'button' }),
  );
  const actionBody = createElement('div', { className: 'modal-body' });
  actionBody.append(
    createElement('p', { className: 'order-action-copy' }),
    createElement('p', { className: 'form-error order-action-error' }),
  );
  const actionFoot = createElement('div', { className: 'modal-foot' });
  actionFoot.append(
    createElement('button', { className: 'secondary close-order-action', text: 'Volver', type: 'button' }),
    createElement('button', { className: 'danger confirm-order-action', text: 'Confirmar', type: 'button' }),
  );
  actionShell.append(actionHead, actionBody, actionFoot);
  orderActionDialog.append(actionShell); document.body.append(orderActionDialog);

  search.addEventListener('input', renderOrders);
  status.addEventListener('change', renderOrders);
  refresh.addEventListener('click', () => loadOrders(true));
  body.addEventListener('click', (event) => {
    const detail = event.target.closest('[data-order-detail]');
    const cancel = event.target.closest('[data-order-cancel]');
    const remove = event.target.closest('[data-order-delete]');
    if (detail) openOrder(state.orders.find((order) => order.id === detail.dataset.orderDetail));
    if (cancel) openOrderAction(state.orders.find((order) => order.id === cancel.dataset.orderCancel), 'cancel');
    if (remove) openOrderAction(state.orders.find((order) => order.id === remove.dataset.orderDelete), 'delete');
  });
  $$('.close-order', orderDialog).forEach((button) => button.addEventListener('click', () => orderDialog.close()));
  orderDialog.addEventListener('close', () => { state.activeOrderId = null; });
  $$('.close-order-action', orderActionDialog).forEach((button) => button.addEventListener('click', () => orderActionDialog.close()));
  $('.confirm-order-action', orderActionDialog).addEventListener('click', executeOrderAction);
  orderActionDialog.addEventListener('close', () => { state.orderAction = null; });
}

function initializeMediaInterface() {
  mediaDialog = createElement('dialog', { className: 'media-dialog' });
  const shell = createElement('div');
  const head = createElement('div', { className: 'modal-head' });
  head.append(
    createElement('div', { className: 'media-heading' }),
    createElement('button', { className: 'close close-media', text: '×', type: 'button' }),
  );
  const body = createElement('div', { className: 'modal-body' });
  const upload = createElement('div', { className: 'media-upload' });
  const fileInput = createElement('input', { className: 'media-files' });
  fileInput.type = 'file'; fileInput.multiple = true;
  fileInput.accept = 'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime';
  upload.append(
    fileInput,
    createElement('button', { className: 'primary upload-media', text: 'Subir contenido', type: 'button' }),
  );
  body.append(
    upload,
    createElement('p', { className: 'media-upload-status', text: 'Imágenes o videos de máximo 100 MB por archivo.' }),
    createElement('div', { className: 'media-grid' }),
  );
  const foot = createElement('div', { className: 'modal-foot' });
  foot.append(createElement('button', { className: 'secondary close-media', text: 'Cerrar', type: 'button' }));
  shell.append(head, body, foot); mediaDialog.append(shell); document.body.append(mediaDialog);

  $$('.close-media').forEach((button) => button.addEventListener('click', () => mediaDialog.close()));
  $('.upload-media').addEventListener('click', uploadSelectedMedia);
  $('.media-grid').addEventListener('click', async (event) => {
    const save = event.target.closest('[data-save-media]');
    const remove = event.target.closest('[data-remove-media]');
    const move = event.target.closest('[data-move-media]');
    const editCover = event.target.closest('[data-edit-cover]');
    if (editCover) {
      const product = state.products.find((entry) => entry.id === state.mediaProductId);
      mediaDialog.close();
      openProduct(product);
      return;
    }
    if (save) await saveMedia(save.dataset.saveMedia);
    if (move) await moveMedia(move.dataset.moveMedia, Number(move.dataset.direction));
    if (remove && window.confirm('¿Quitar este contenido de la galería pública?')) {
      await removeMedia(remove.dataset.removeMedia);
    }
  });
  mediaDialog.addEventListener('close', () => {
    $('.media-grid').replaceChildren();
    state.media = [];
    state.mediaCover = null;
    state.mediaProductId = null;
  });
}

function show(view) {
  $$('.view').forEach((panel) => { panel.hidden = panel.dataset.panel !== view; });
  $$('[data-view]').forEach((link) => link.classList.toggle('active', link.dataset.view === view));
  $('.page-title').textContent = {
    products: 'Productos', prices: 'Precios', categories: 'Categorías',
    users: 'Usuarios', orders: 'Pedidos y compras',
  }[view] ?? 'Administración';
  history.replaceState(null, '', `#${view === 'dashboard' ? 'resumen' : view}`);
  if (view === 'users' && !state.usersLoaded) loadUsers().catch((error) => toast(error.message, 'error'));
  if (view === 'orders' && !state.ordersLoaded) loadOrders().catch((error) => toast(error.message, 'error'));
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
    const content = createElement('button', { className: 'small-button', text: 'Contenido', type: 'button' });
    content.dataset.media = product.id;
    const edit = createElement('button', { className: 'small-button', text: 'Editar', type: 'button' });
    edit.dataset.edit = product.id;
    actions.append(content, edit);
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

function mediaPreview(item) {
  const preview = item.type === 'video' ? createElement('video') : createElement('img');
  preview.src = item.url;
  preview.crossOrigin = 'anonymous';
  if (item.type === 'video') {
    preview.muted = true; preview.playsInline = true; preview.preload = 'metadata'; preview.controls = true;
  } else preview.alt = item.altText || '';
  return preview;
}

function renderMedia() {
  const grid = $('.media-grid');
  grid.replaceChildren();
  const entries = state.mediaCover ? [state.mediaCover, ...state.media] : [...state.media];
  if (!entries.length) {
    grid.append(createElement('div', {
      className: 'media-empty',
      text: 'Este producto todavía no tiene vistas adicionales. Su portada seguirá apareciendo en la tienda.',
    }));
    return;
  }
  entries.forEach((item, index) => {
    const card = createElement('article', { className: 'media-card' });
    const frame = createElement('div', { className: 'media-frame' });
    frame.append(mediaPreview(item), createElement('span', {
      className: 'media-kind', text: item.isCover || item.isPublicCover ? 'Imagen · portada pública' : item.type === 'video' ? 'Video' : 'Imagen',
    }));
    if (item.isCover) {
      const copy = createElement('div', { className: 'media-cover-details' });
      copy.append(
        createElement('strong', { text: item.altText }),
        createElement('small', { text: 'Portada base. Se utiliza cuando la galería no contiene otra imagen.' }),
      );
      const actions = createElement('div', { className: 'media-actions' });
      const edit = createElement('button', { className: 'small-button', text: 'Cambiar portada', type: 'button' });
      edit.dataset.editCover = 'true';
      actions.append(edit);
      card.append(frame, copy, actions); grid.append(card);
      return;
    }
    const field = createElement('label', { className: 'media-alt-field' });
    field.append(createElement('span', { text: 'Texto descriptivo' }));
    const alt = createElement('input');
    alt.value = item.altText || ''; alt.maxLength = 180; alt.dataset.mediaAlt = item.id;
    field.append(alt);
    const actions = createElement('div', { className: 'media-actions' });
    const up = createElement('button', { className: 'small-button', text: '↑', type: 'button' });
    const mediaIndex = state.media.findIndex((entry) => entry.id === item.id);
    up.dataset.moveMedia = item.id; up.dataset.direction = '-1'; up.disabled = mediaIndex === 0;
    const down = createElement('button', { className: 'small-button', text: '↓', type: 'button' });
    down.dataset.moveMedia = item.id; down.dataset.direction = '1'; down.disabled = mediaIndex === state.media.length - 1;
    const save = createElement('button', { className: 'small-button', text: 'Guardar', type: 'button' });
    save.dataset.saveMedia = item.id;
    const remove = createElement('button', { className: 'small-button remove', text: 'Quitar', type: 'button' });
    remove.dataset.removeMedia = item.id;
    actions.append(up, down, save, remove);
    card.append(frame, field, actions); grid.append(card);
  });
}

async function loadProductMedia() {
  const data = await api(`/api/admin/products/${state.mediaProductId}/media`);
  state.media = data.media.map((item) => ({ ...item, isPublicCover: item.id === data.product.coverMediaId }));
  state.mediaCover = data.product.coverMediaId ? null : {
    id: `cover-${data.product.id}`,
    type: 'image',
    url: data.product.coverUrl,
    altText: `Portada de ${data.product.name}`,
    isCover: true,
  };
  $('.media-heading').replaceChildren(
    createElement('h2', { text: `Contenido · ${data.product.name}` }),
    createElement('p', { text: 'La primera imagen será la portada pública. Los videos e imágenes se actualizan automáticamente en toda la tienda.' }),
  );
  renderMedia();
}

async function openMedia(product) {
  if (!product) return;
  state.mediaProductId = product.id;
  $('.media-heading').replaceChildren(createElement('h2', { text: `Contenido · ${product.name}` }));
  $('.media-grid').replaceChildren(createElement('div', { className: 'media-empty', text: 'Cargando contenido…' }));
  $('.media-files').value = '';
  $('.media-upload-status').textContent = 'Imágenes o videos de máximo 100 MB. La primera imagen será la portada; los videos se optimizan automáticamente.';
  mediaDialog.showModal();
  try { await loadProductMedia(); }
  catch (error) { $('.media-upload-status').textContent = error.message; }
}

async function uploadSelectedMedia() {
  const input = $('.media-files');
  const files = [...input.files];
  const button = $('.upload-media');
  const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime']);
  if (!files.length) return toast('Selecciona al menos una imagen o video.', 'error');
  if (files.some((file) => !allowed.has(file.type) || file.size <= 0 || file.size > 100 * 1024 * 1024)) {
    return toast('Cada archivo debe ser una imagen o video válido de máximo 100 MB.', 'error');
  }
  try {
    button.disabled = true; input.disabled = true;
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      $('.media-upload-status').textContent = file.type.startsWith('video/')
        ? `Subiendo y optimizando ${index + 1} de ${files.length}: ${file.name}. Puede tardar unos minutos.`
        : `Subiendo ${index + 1} de ${files.length}: ${file.name}`;
      const alt = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
      const response = await fetch(`/api/admin/products/${state.mediaProductId}/media`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': file.type, 'X-Media-Alt': encodeURIComponent(alt) },
        credentials: 'same-origin',
        body: file,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `No fue posible subir ${file.name}.`);
    }
    input.value = '';
    await loadProductMedia();
    $('.media-upload-status').textContent = 'Contenido optimizado y publicado. La tienda se actualizará automáticamente.';
    toast('Contenido actualizado en el panel y en la tienda pública.');
  } catch (error) {
    $('.media-upload-status').textContent = error.message;
    toast(error.message, 'error');
  } finally {
    button.disabled = false; input.disabled = false;
  }
}

async function saveMedia(mediaId) {
  const input = $(`[data-media-alt="${mediaId}"]`);
  try {
    await api(`/api/admin/products/${state.mediaProductId}/media/${mediaId}`, {
      method: 'PATCH', body: JSON.stringify({ altText: input.value.trim() }),
    });
    await loadProductMedia();
    toast('Descripción del contenido guardada.');
  } catch (error) { toast(error.message, 'error'); }
}

async function moveMedia(mediaId, direction) {
  const currentIndex = state.media.findIndex((item) => item.id === mediaId);
  const targetIndex = currentIndex + direction;
  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= state.media.length) return;
  const reordered = [...state.media];
  [reordered[currentIndex], reordered[targetIndex]] = [reordered[targetIndex], reordered[currentIndex]];
  try {
    await Promise.all(reordered.map((item, index) => api(
      `/api/admin/products/${state.mediaProductId}/media/${item.id}`,
      { method: 'PATCH', body: JSON.stringify({ sortOrder: index * 10 }) },
    )));
    await loadProductMedia();
    toast('Orden de la galería actualizado.');
  } catch (error) { toast(error.message, 'error'); }
}

async function removeMedia(mediaId) {
  try {
    await api(`/api/admin/products/${state.mediaProductId}/media/${mediaId}`, { method: 'DELETE' });
    await loadProductMedia();
    toast('Contenido retirado de la galería.');
  } catch (error) { toast(error.message, 'error'); }
}

function orderStatusBadge(order) {
  return createElement('span', {
    className: `status order-${order.status}`,
    text: orderStatusLabels[order.status] ?? order.status,
  });
}

function renderOrderStats() {
  const summary = state.orderSummary;
  if (!summary) return;
  const values = {
    completed: String(summary.completed ?? 0),
    total: money(summary.registeredTotalCents, summary.currency),
    pending: String(summary.pending ?? 0),
    testMode: String(summary.testMode ?? 0),
  };
  for (const [key, value] of Object.entries(values)) {
    const element = $(`[data-order-stat="${key}"]`);
    if (element) element.textContent = value;
  }
}

function renderOrders() {
  const body = $('.orders-body');
  if (!body) return;
  const query = $('.order-search').value.trim().toLowerCase();
  const selectedStatus = $('.order-status-filter').value;
  const orders = state.orders.filter((order) => {
    const searchable = [
      order.id, order.customer?.displayName, order.customer?.email,
      order.payment?.externalOrderId, ...order.items.map((item) => item.productName),
    ].join(' ').toLowerCase();
    return (!selectedStatus || order.status === selectedStatus) && searchable.includes(query);
  });
  body.replaceChildren();
  if (!orders.length) return body.append(emptyRow(7, state.ordersLoaded
    ? 'No hay pedidos que coincidan.' : 'Cargando pedidos…'));

  for (const order of orders) {
    const row = createElement('tr');
    const orderIdentity = createElement('div', { className: 'order-identity' });
    orderIdentity.append(
      createElement('strong', { text: `#${order.id.slice(0, 8).toUpperCase()}` }),
      createElement('small', { text: order.payment
        ? `${order.payment.provider === 'lemon_squeezy' ? 'Lemon Squeezy' : order.payment.provider} · ${order.payment.testMode ? 'Prueba' : 'Producción'}`
        : 'Sin intento de pago' }),
    );
    appendCell(row, orderIdentity);

    const customer = createElement('div', { className: 'order-customer' });
    customer.append(
      createElement('strong', { text: order.customer?.displayName || (order.customer?.isAnonymous ? 'Compra invitada' : 'Cliente') }),
      createElement('small', { text: order.customer?.email || 'Correo pendiente' }),
    );
    appendCell(row, customer);

    const product = createElement('div', { className: 'order-products' });
    const names = order.items.map((item) => item.productName);
    product.append(
      createElement('strong', { text: names[0] || 'Sin productos' }),
      createElement('small', { text: names.length > 1 ? `+ ${names.length - 1} producto(s)` : `${order.items.length} artículo(s)` }),
    );
    appendCell(row, product);
    appendCell(row, money(order.totalCents, order.currency), 'order-total');
    appendCell(row, orderStatusBadge(order));
    appendCell(row, formatDateTime(order.createdAt), 'order-date');
    const actions = createElement('div', { className: 'actions order-actions' });
    const detail = createElement('button', { className: 'small-button', text: 'Ver detalle', type: 'button' });
    detail.dataset.orderDetail = order.id;
    actions.append(detail);
    if (order.controls?.canCancel) {
      const cancel = createElement('button', { className: 'small-button remove', text: 'Cancelar', type: 'button' });
      cancel.dataset.orderCancel = order.id; actions.append(cancel);
    }
    if (order.controls?.canDelete) {
      const remove = createElement('button', { className: 'small-button remove', text: 'Eliminar', type: 'button' });
      remove.dataset.orderDelete = order.id; actions.append(remove);
    }
    if (order.controls?.checkoutActive) {
      const active = createElement('small', { className: 'checkout-active-note', text: 'Checkout activo' });
      active.title = 'La cancelación estará disponible cuando expire el checkout.';
      actions.append(active);
    }
    appendCell(row, actions);
    body.append(row);
  }
}

function openOrderAction(order, action) {
  if (!order || !['cancel', 'delete'].includes(action)) return;
  state.orderAction = { orderId: order.id, action };
  const shortId = `#${order.id.slice(0, 8).toUpperCase()}`;
  const deleting = action === 'delete';
  $('.order-action-title').textContent = deleting ? `Eliminar ${shortId}` : `Cancelar ${shortId}`;
  $('.order-action-copy').textContent = deleting
    ? 'Este pedido de prueba cancelado se eliminará definitivamente de Supabase. Esta acción no afecta ninguna compra pagada.'
    : 'El pedido quedará cancelado y su checkout vencido no podrá confirmar una compra. No se realizará ningún cobro ni reembolso.';
  $('.order-action-error').textContent = '';
  const button = $('.confirm-order-action');
  button.textContent = deleting ? 'Sí, eliminar' : 'Sí, cancelar';
  orderActionDialog.showModal();
}

async function executeOrderAction() {
  if (!state.orderAction) return;
  const { orderId, action } = state.orderAction;
  const button = $('.confirm-order-action');
  button.disabled = true; $('.order-action-error').textContent = '';
  try {
    await api(`/api/admin/orders/${orderId}${action === 'cancel' ? '/cancel' : ''}`, {
      method: action === 'cancel' ? 'POST' : 'DELETE',
    });
    orderActionDialog.close();
    if (orderDialog.open) orderDialog.close();
    state.ordersLoaded = false;
    await loadOrders(true);
    toast(action === 'cancel' ? 'Pedido cancelado correctamente.' : 'Pedido de prueba eliminado.');
  } catch (error) {
    $('.order-action-error').textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

function orderDetailLine(label, value) {
  const line = createElement('div', { className: 'order-detail-line' });
  line.append(createElement('span', { text: label }), createElement('strong', { text: value || '—' }));
  return line;
}

function openOrder(order) {
  if (!order) return;
  state.activeOrderId = order.id;
  const heading = $('.order-detail-heading');
  heading.replaceChildren(
    createElement('h2', { text: `Pedido #${order.id.slice(0, 8).toUpperCase()}` }),
    createElement('p', { text: `Creado ${formatDateTime(order.createdAt)}` }),
  );
  const detail = $('.order-detail');
  detail.replaceChildren();

  const overview = createElement('section', { className: 'order-detail-grid' });
  const statusCard = createElement('article', { className: 'order-detail-card' });
  statusCard.append(createElement('span', { text: 'Estado del pedido' }), orderStatusBadge(order));
  const totalCard = createElement('article', { className: 'order-detail-card' });
  totalCard.append(createElement('span', { text: 'Total registrado' }), createElement('strong', { text: money(order.totalCents, order.currency) }));
  const customerCard = createElement('article', { className: 'order-detail-card' });
  customerCard.append(
    createElement('span', { text: 'Comprador' }),
    createElement('strong', { text: order.customer?.displayName || (order.customer?.isAnonymous ? 'Compra invitada' : 'Cliente') }),
    createElement('small', { text: order.customer?.email || 'Correo pendiente' }),
  );
  const modeCard = createElement('article', { className: 'order-detail-card' });
  modeCard.append(
    createElement('span', { text: 'Entorno de pago' }),
    createElement('strong', { text: order.payment ? (order.payment.testMode ? 'Modo prueba' : 'Producción') : 'No iniciado' }),
  );
  overview.append(statusCard, totalCard, customerCard, modeCard); detail.append(overview);

  const itemsSection = createElement('section', { className: 'order-detail-section' });
  itemsSection.append(createElement('h3', { text: 'Productos comprados' }));
  const items = createElement('div', { className: 'order-item-list' });
  for (const item of order.items) {
    const entry = createElement('article', { className: 'order-item' });
    const image = createElement('img'); image.src = `/${item.product?.imagePath || 'assets/favicon.png'}`; image.alt = '';
    const copy = createElement('div');
    copy.append(
      createElement('strong', { text: item.productName }),
      createElement('small', { text: `${item.quantity} × ${money(item.unitPriceCents, item.currency)}` }),
    );
    entry.append(image, copy, createElement('strong', { text: money(item.subtotalCents, item.currency) }));
    items.append(entry);
  }
  if (!order.items.length) items.append(createElement('p', { className: 'order-empty-detail', text: 'No hay artículos asociados.' }));
  itemsSection.append(items); detail.append(itemsSection);

  const paymentSection = createElement('section', { className: 'order-detail-section' });
  paymentSection.append(createElement('h3', { text: 'Pago y validación' }));
  const paymentData = createElement('div', { className: 'order-detail-lines' });
  paymentData.append(
    orderDetailLine('Proveedor', order.payment?.provider === 'lemon_squeezy' ? 'Lemon Squeezy' : order.payment?.provider),
    orderDetailLine('Estado del intento', order.payment?.status || 'Sin intento'),
    orderDetailLine('ID externo', order.payment?.externalOrderId || order.payment?.externalCheckoutId),
    orderDetailLine('Pago confirmado', formatDateTime(order.payment?.paidAt)),
    orderDetailLine('Webhook validado', order.events.length ? `Sí · ${order.events.length} evento(s)` : 'Todavía no'),
    orderDetailLine('Último evento', order.events[0]?.type || '—'),
  );
  paymentSection.append(paymentData); detail.append(paymentSection);
  orderDialog.showModal();
}

async function loadOrders(force = false) {
  if (state.ordersLoaded && !force) return;
  const body = $('.orders-body');
  if (body) { body.replaceChildren(); body.append(emptyRow(7, 'Cargando pedidos…')); }
  try {
    const data = await api('/api/admin/orders');
    state.orders = data.orders;
    state.orderSummary = data.summary;
    state.ordersLoaded = true;
    renderOrderStats();
    renderOrders();
  } catch (error) {
    if (body) { body.replaceChildren(); body.append(emptyRow(7, error.message)); }
    throw error;
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
    appendCell(row, actions);
    body.append(row);
  }
}

function renderCategories() {
  const body = $('.categories-body');
  if (!body) return;
  const query = $('.category-search')?.value.trim().toLowerCase() ?? '';
  const categories = state.categories.filter((category) => (
    `${category.name} ${category.slug}`.toLowerCase().includes(query)
  ));
  body.replaceChildren();
  if (!categories.length) {
    body.append(emptyRow(7, 'No hay categorías que coincidan.'));
    return;
  }

  for (const category of categories) {
    const row = createElement('tr');
    const identity = createElement('div', { className: 'category-identity' });
    identity.append(
      createElement('strong', { text: category.name }),
      createElement('small', { text: category.slug }),
    );
    appendCell(row, identity);

    const total = createElement('div', { className: 'category-count' });
    total.append(
      createElement('strong', { text: String(category.productCount ?? 0) }),
      createElement('small', { text: 'en total' }),
    );
    appendCell(row, total);

    const published = createElement('div', { className: 'category-count' });
    published.append(
      createElement('strong', { text: String(category.activeProductCount ?? 0) }),
      createElement('small', { text: 'productos activos' }),
    );
    appendCell(row, published);
    appendCell(row, String(category.sortOrder ?? 0), 'category-order');
    appendCell(row, createElement('span', {
      className: `status ${category.isActive ? 'active' : 'draft'}`,
      text: category.isActive ? 'Visible' : 'Oculta',
    }));
    appendCell(row, formatDateTime(category.updatedAt), 'category-date');

    const actions = createElement('div', { className: 'actions category-actions' });
    const products = createElement('button', { className: 'small-button', text: 'Ver productos', type: 'button' });
    products.dataset.categoryProducts = category.id;
    const edit = createElement('button', { className: 'small-button', text: 'Editar', type: 'button' });
    edit.dataset.categoryEdit = category.id;
    const visibility = createElement('button', {
      className: `small-button${category.isActive ? ' remove' : ''}`,
      text: category.isActive ? 'Desactivar' : 'Activar',
      type: 'button',
    });
    if (category.isActive) visibility.dataset.categoryDeactivate = category.id;
    else visibility.dataset.categoryActivate = category.id;
    actions.append(products, edit, visibility);
    appendCell(row, actions);
    body.append(row);
  }
}

function openCategory(category = null) {
  state.editingCategoryId = category?.id ?? null;
  categorySlugEdited = Boolean(category);
  categoryForm.reset();
  $('.category-form-title').textContent = category ? 'Editar categoría' : 'Nueva categoría';
  $('.save-category').textContent = category ? 'Guardar cambios' : 'Crear categoría';
  categoryForm.elements.name.value = category?.name ?? '';
  categoryForm.elements.slug.value = category?.slug ?? '';
  categoryForm.elements.sortOrder.value = category?.sortOrder ?? 0;
  categoryForm.elements.isActive.checked = category?.isActive ?? true;
  $('.category-error').textContent = '';
  categoryDialog.showModal();
}

async function saveCategory(event) {
  event.preventDefault();
  const button = $('.save-category');
  const name = categoryForm.elements.name.value.trim();
  const categorySlug = categoryForm.elements.slug.value.trim();
  const sortOrder = Number(categoryForm.elements.sortOrder.value);
  try {
    if (!name) throw new Error('Escribe el nombre de la categoría.');
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(categorySlug)) {
      throw new Error('El slug solo puede contener minúsculas, números y guiones.');
    }
    if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 100000) {
      throw new Error('El orden debe ser un número entero entre 0 y 100000.');
    }
    button.disabled = true;
    const editingId = state.editingCategoryId;
    await api(editingId ? `/api/admin/categories/${editingId}` : '/api/admin/categories', {
      method: editingId ? 'PATCH' : 'POST',
      body: JSON.stringify({
        name, slug: categorySlug, sortOrder,
        isActive: categoryForm.elements.isActive.checked,
      }),
    });
    categoryDialog.close();
    await loadCatalog();
    toast(editingId ? 'Categoría actualizada.' : 'Categoría creada y disponible para asignar productos.');
  } catch (error) {
    $('.category-error').textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

async function handleCategoryAction(event) {
  const productsButton = event.target.closest('[data-category-products]');
  const editButton = event.target.closest('[data-category-edit]');
  const deactivateButton = event.target.closest('[data-category-deactivate]');
  const activateButton = event.target.closest('[data-category-activate]');

  if (productsButton) {
    const category = state.categories.find((item) => item.id === productsButton.dataset.categoryProducts);
    if (!category) return;
    $('.product-search').value = category.name;
    renderProducts();
    show('products');
    toast(`Mostrando los productos de ${category.name}.`);
    return;
  }
  if (editButton) {
    openCategory(state.categories.find((item) => item.id === editButton.dataset.categoryEdit));
    return;
  }
  if (deactivateButton) {
    const category = state.categories.find((item) => item.id === deactivateButton.dataset.categoryDeactivate);
    if (!category) return;
    state.deactivateCategoryId = category.id;
    $('.category-deactivate-name').textContent = category.name;
    categoryDeactivateDialog.showModal();
    return;
  }
  if (activateButton) {
    const category = state.categories.find((item) => item.id === activateButton.dataset.categoryActivate);
    if (!category) return;
    activateButton.disabled = true;
    try {
      await api(`/api/admin/categories/${category.id}`, {
        method: 'PATCH', body: JSON.stringify({ isActive: true }),
      });
      await loadCatalog();
      toast(`${category.name} vuelve a estar visible en la tienda.`);
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      activateButton.disabled = false;
    }
  }
}

async function deactivateCategory() {
  const button = $('.confirm-category-deactivate');
  const category = state.categories.find((item) => item.id === state.deactivateCategoryId);
  if (!category) return;
  try {
    button.disabled = true;
    await api(`/api/admin/categories/${category.id}`, { method: 'DELETE' });
    categoryDeactivateDialog.close();
    await loadCatalog();
    toast(`${category.name} se ocultó; sus productos y pedidos se conservaron.`);
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    button.disabled = false;
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

function render() { renderProducts(); renderPrices(); renderCategories(); }

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
        : location.hash === '#categorias' ? 'categories'
          : location.hash === '#usuarios' ? 'users'
            : location.hash === '#pedidos' ? 'orders' : 'dashboard');
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
  const media = event.target.closest('[data-media]');
  const edit = event.target.closest('[data-edit]');
  const deactivate = event.target.closest('[data-deactivate]');
  if (media) openMedia(state.products.find((product) => product.id === media.dataset.media));
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

initializeMediaInterface();
initializeCategoriesInterface();
initializeOrdersInterface();
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
