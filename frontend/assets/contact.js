const menuButton = document.querySelector('.menu-button');
const navigation = document.querySelector('.nav-links');
menuButton.addEventListener('click', () => {
  const open = menuButton.getAttribute('aria-expanded') !== 'true';
  menuButton.setAttribute('aria-expanded', String(open));
  navigation.classList.toggle('open', open);
});
navigation.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
  menuButton.setAttribute('aria-expanded', 'false');
  navigation.classList.remove('open');
}));

const form = document.querySelector('#contactForm');
const status = document.querySelector('#contactStatus');
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  const button = form.querySelector('[type=submit]');
  const fields = new FormData(form);
  const payload = Object.fromEntries(['name', 'email', 'reason', 'orderNumber', 'message', 'website'].map(key => [key, String(fields.get(key) ?? '').trim()]));
  button.disabled = true;
  status.className = 'form-status';
  status.textContent = 'Enviando tu mensaje…';
  try {
    const response = await fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'No fue posible enviar tu mensaje. Inténtalo nuevamente.');
    form.reset();
    status.className = 'form-status success';
    status.textContent = '¡Mensaje recibido! Te responderemos al correo que nos dejaste.';
  } catch (error) {
    status.className = 'form-status error';
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

const newsletter = document.querySelector('#newsletterForm');
const newsletterStatus = document.querySelector('.newsletter-status');
newsletter.addEventListener('submit', async event => {
  event.preventDefault();
  if (!newsletter.reportValidity()) return;
  const button = newsletter.querySelector('button');
  const email = newsletter.elements.email.value.trim();
  button.disabled = true;
  newsletterStatus.className = 'newsletter-status';
  newsletterStatus.textContent = 'Preparando tu código…';
  try {
    const response = await fetch('/api/newsletter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ email }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.discount?.code) throw new Error(result.error || 'No fue posible registrarte.');
    newsletter.reset();
    newsletterStatus.className = 'newsletter-status success';
    newsletterStatus.textContent = `¡Listo! Tu código de bienvenida es ${result.discount.code}.`;
  } catch (error) {
    newsletterStatus.className = 'newsletter-status error';
    newsletterStatus.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
