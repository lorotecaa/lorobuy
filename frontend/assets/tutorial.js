const tutorials = {
  studio: [
    ['Abre «Añadir fuente»', 'Está abajo, en el panel de la izquierda.'],
    ['Elige «Vídeo»', 'Selecciona la opción Vídeo y presiona Añadir.'],
    ['Sube tu animación', 'Toca «Selecciona un archivo» y escoge el archivo WEBM que descargaste.'],
    ['Ajusta y agrégala', 'Deja «Repetir» apagado y «Reiniciar cuando el vídeo se active» encendido. Luego toca «Añadir fuente».'],
    ['Lánzala en tu LIVE', 'Toca el ojito de la fuente y la animación aparece sobre tu cámara.'],
  ],
  obs: [
    ['Agrega una fuente', 'En el panel «Fuentes», haz clic en el botón +.'],
    ['Elige «Fuente multimedia»', 'Ponle un nombre, por ejemplo el de la animación, y presiona Aceptar.'],
    ['Busca tu animación', 'Haz clic en «Examinar» y escoge el archivo WEBM que descargaste.'],
    ['Ajusta y acepta', 'Deja «Bucle» desactivado y activa «Reiniciar la reproducción cuando la fuente se active». Presiona Aceptar.'],
    ['Lánzala en tu LIVE', 'Selecciona la fuente y dale play en los controles que aparecen bajo la vista previa.'],
  ],
};

const demo = document.querySelector('#tutorialDemo');
const panel = document.querySelector('#tutorialPanel');
const list = document.querySelector('#stepList');
const guide = document.querySelector('.tutorial-guide');
const tabs = [...document.querySelectorAll('.program-tab')];
const video = document.querySelector('#tutorialVideo');
const soundButton = document.querySelector('#soundButton');
const pauseButton = document.querySelector('#pauseButton');
const menuButton = document.querySelector('.menu-button');
const navigation = document.querySelector('.nav-links');
const stepDuration = 5500;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let mode = 'studio';
let step = 0;
let paused = reducedMotion;
let remaining = stepDuration;
let startedAt = 0;
let stepTimer = null;
let fallbackVideo = false;

function safeVideoUrl(value) {
  if (typeof value !== 'string') return '';
  if (/^\/?assets\/[a-z0-9/_-]+\.mp4(?:\?v=[a-z0-9-]+)?$/i.test(value)) return value.startsWith('/') ? value : `/${value}`;
  if (/^https:\/\/[a-z0-9-]+\.supabase\.co\/storage\/v1\/object\/public\/product-media\/[a-z0-9/_-]+\.mp4(?:\?.*)?$/i.test(value)) return value;
  return '';
}

async function loadPreviewVideo() {
  let source = '/assets/hero.mp4';
  try {
    const response = await fetch('/api/categories/packs-completos/media', { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
    if (response.ok) {
      const data = await response.json();
      const current = Array.isArray(data.media) ? data.media.find(item => item.type === 'video' && safeVideoUrl(item.url)) : null;
      if (current) source = safeVideoUrl(current.url);
    }
  } catch {}
  video.src = source;
  video.load();
  if (step === 4 && !paused) video.play().catch(() => {});
}

video.addEventListener('error', () => {
  if (fallbackVideo || video.currentSrc.endsWith('/assets/hero.mp4')) return;
  fallbackVideo = true;
  video.src = '/assets/hero.mp4';
  video.load();
  if (step === 4 && !paused) video.play().catch(() => {});
});

function clearStepTimer() {
  if (stepTimer !== null) clearTimeout(stepTimer);
  stepTimer = null;
}

function scheduleNextStep() {
  clearStepTimer();
  if (paused || document.hidden) return;
  startedAt = performance.now();
  stepTimer = setTimeout(() => selectStep((step + 1) % tutorials[mode].length), remaining);
}

function syncVideo() {
  if (step !== 4 || paused || document.hidden) {
    video.pause();
    if (step !== 4 && video.readyState > 0) {
      try { video.currentTime = 0; } catch {}
    }
    return;
  }
  video.play().catch(() => {});
}

function selectStep(index) {
  step = index;
  remaining = stepDuration;
  clearStepTimer();
  demo.dataset.step = String(step);
  document.querySelector('[data-demo-step]').textContent = String(step + 1);
  const buttons = [...list.querySelectorAll('.step-button')];
  buttons.forEach((button, position) => {
    button.classList.remove('active');
    if (position === step) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
  });
  // Restart the progress strip even when the currently selected step is clicked again.
  void buttons[step].offsetWidth;
  buttons[step].classList.add('active');
  syncVideo();
  scheduleNextStep();
}

function renderSteps() {
  const fragment = document.createDocumentFragment();
  tutorials[mode].forEach(([title, description], index) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    const number = document.createElement('span');
    const text = document.createElement('span');
    const heading = document.createElement('b');
    const detail = document.createElement('small');
    const progress = document.createElement('span');
    button.type = 'button';
    button.className = 'step-button';
    number.className = 'step-number';
    number.textContent = String(index + 1);
    text.className = 'step-text';
    heading.textContent = title;
    detail.textContent = description;
    text.append(heading, detail);
    progress.className = 'step-progress';
    progress.setAttribute('aria-hidden', 'true');
    button.append(number, text, progress);
    button.addEventListener('click', () => selectStep(index));
    item.append(button);
    fragment.append(item);
  });
  list.replaceChildren(fragment);
  selectStep(0);
}

function setMode(nextMode, focusTab = false) {
  if (!tutorials[nextMode]) return;
  mode = nextMode;
  demo.dataset.mode = mode;
  demo.querySelector('[data-app-title]').textContent = mode === 'studio' ? 'TikTok LIVE Studio' : 'OBS Studio';
  demo.querySelector('[data-add-label]').textContent = mode === 'studio' ? 'Añadir fuente' : 'Agregar fuente';
  demo.querySelector('[data-source-label]').textContent = mode === 'studio' ? 'Vídeo: mi animación' : 'Fuente multimedia';
  demo.querySelector('[data-choice-label]').textContent = mode === 'studio' ? '▷ Vídeo' : '▷ Fuente multimedia';
  demo.querySelector('[data-accept-label]').textContent = mode === 'studio' ? 'Añadir fuente' : 'Aceptar';
  tabs.forEach(tab => {
    const selected = tab.dataset.mode === mode;
    tab.classList.toggle('active', selected);
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    if (selected) {
      panel.setAttribute('aria-labelledby', tab.id);
      if (focusTab) tab.focus();
    }
  });
  renderSteps();
}

tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => setMode(tab.dataset.mode));
  tab.addEventListener('keydown', event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    setMode(next.dataset.mode, true);
  });
});

soundButton.addEventListener('click', () => {
  video.muted = !video.muted;
  const enabled = !video.muted;
  soundButton.setAttribute('aria-pressed', String(enabled));
  soundButton.querySelector('[data-sound-label]').textContent = enabled ? 'Silenciar' : 'Activar sonido';
  if (enabled && step === 4) video.play().catch(() => {});
});

function setPaused(nextPaused) {
  if (paused === nextPaused) return;
  if (nextPaused && stepTimer !== null) remaining = Math.max(100, remaining - (performance.now() - startedAt));
  paused = nextPaused;
  guide.classList.toggle('paused', paused);
  pauseButton.setAttribute('aria-pressed', String(paused));
  pauseButton.textContent = paused ? 'Reanudar' : 'Pausar';
  if (paused) clearStepTimer();
  else scheduleNextStep();
  syncVideo();
}

pauseButton.addEventListener('click', () => setPaused(!paused));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (stepTimer !== null) remaining = Math.max(100, remaining - (performance.now() - startedAt));
    clearStepTimer();
    video.pause();
  } else {
    scheduleNextStep();
    syncVideo();
  }
});

menuButton.addEventListener('click', () => {
  const open = menuButton.getAttribute('aria-expanded') !== 'true';
  menuButton.setAttribute('aria-expanded', String(open));
  navigation.classList.toggle('open', open);
});
navigation.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
  menuButton.setAttribute('aria-expanded', 'false');
  navigation.classList.remove('open');
}));

setMode('studio');
if (reducedMotion) {
  guide.classList.add('paused');
  pauseButton.setAttribute('aria-pressed', 'true');
  pauseButton.textContent = 'Reanudar';
}
loadPreviewVideo();
