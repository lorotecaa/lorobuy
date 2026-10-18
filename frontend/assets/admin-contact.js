const list = document.querySelector('#messageList');
const detail = document.querySelector('#messageDetail');
const pageStatus = document.querySelector('.page-status');
const refresh = document.querySelector('#refresh');
const reasonLabels = { download: 'Problema con mi descarga', 'before-buying': 'Duda antes de comprar', other: 'Otro' };
let selectedId = null;

async function getJson(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'No fue posible cargar los mensajes.');
  return result;
}

function line(label, value) {
  const term = document.createElement('dt');
  const description = document.createElement('dd');
  term.textContent = label;
  description.textContent = value || '—';
  return [term, description];
}

async function openMessage(id) {
  selectedId = id;
  list.querySelectorAll('.message-item').forEach(button => button.classList.toggle('active', button.dataset.id === id));
  detail.replaceChildren();
  const loading = document.createElement('p');
  loading.className = 'empty';
  loading.textContent = 'Cargando mensaje…';
  detail.append(loading);
  try {
    const { message } = await getJson(`/api/admin/contact-messages/${encodeURIComponent(id)}`);
    if (selectedId !== id) return;
    const title = document.createElement('h2');
    title.textContent = reasonLabels[message.reason] || 'Consulta';
    const date = document.createElement('small');
    date.textContent = message.createdAt ? new Date(message.createdAt).toLocaleString('es-CO') : '';
    const meta = document.createElement('dl');
    meta.className = 'meta';
    meta.append(...line('Nombre', message.name), ...line('Correo', message.email), ...line('Pedido', message.orderNumber));
    const body = document.createElement('p');
    body.className = 'message-body';
    body.textContent = message.message;
    const reply = document.createElement('a');
    reply.className = 'reply';
    reply.href = `mailto:${encodeURIComponent(message.email)}?subject=${encodeURIComponent(`Respuesta LoroBuy${message.orderNumber ? ` · ${message.orderNumber}` : ''}`)}`;
    reply.textContent = 'Responder por correo ↗';
    detail.replaceChildren(title, date, meta, body, reply);
  } catch (error) {
    pageStatus.textContent = error.message;
  }
}

async function loadMessages() {
  refresh.disabled = true;
  pageStatus.textContent = '';
  try {
    const { messages } = await getJson('/api/admin/contact-messages');
    list.replaceChildren();
    if (!messages.length) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = 'Todavía no hay mensajes.';
      list.append(empty);
    }
    for (const message of messages) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'message-item';
      button.dataset.id = message.id;
      const title = document.createElement('strong');
      title.textContent = message.name || reasonLabels[message.reason] || 'Consulta recibida';
      const id = document.createElement('small');
      id.textContent = message.email || message.id;
      const date = document.createElement('span');
      date.textContent = message.createdAt ? new Date(message.createdAt).toLocaleString('es-CO') : '';
      button.append(title, id, date);
      button.addEventListener('click', () => openMessage(message.id));
      list.append(button);
    }
    if (messages.length) await openMessage(messages.some(item => item.id === selectedId) ? selectedId : messages[0].id);
  } catch (error) {
    list.replaceChildren();
    pageStatus.textContent = error.message;
  } finally {
    refresh.disabled = false;
  }
}

refresh.addEventListener('click', loadMessages);
loadMessages();
