const touch = window.matchMedia?.('(pointer: coarse)').matches;

const MOUSE = (lit) => `
  <rect class="m-body" x="11" y="4" width="18" height="32" rx="9"/>
  <path class="m-lit ${lit === 'left' ? 'on' : ''}" d="M11 16.5V13a9 9 0 0 1 8.5-9v12.5Z"/>
  <path class="m-lit ${lit === 'right' ? 'on' : ''}" d="M29 16.5V13a9 9 0 0 0-8.5-9v12.5Z"/>
  <line class="m-line" x1="11" y1="16.5" x2="29" y2="16.5"/>
  <rect class="m-wheel ${lit === 'wheel' ? 'on' : ''}" x="18.4" y="8" width="3.2" height="7" rx="1.6"/>`;
const PAD = (dots) => `<rect class="p-body" x="6" y="10" width="28" height="20" rx="5"/>${dots}`;
const dot = (cls, x, y) => `<circle class="p-dot ${cls}" cx="${x}" cy="${y}" r="2.6"/>`;

const arrows = {
  lr: '<path class="arr" d="M6 35 2 31.5 6 28"/><path class="arr" d="M34 35 38 31.5 34 28"/>',
  ud: '<path class="arr" d="M16.5 3.5 20 .5 23.5 3.5"/><path class="arr" d="M16.5 37 20 40 23.5 37"/>',
};

const ITEMS = [
  {
    key: 'rotate', title: 'Rotate',
    mouse: `<g class="mouse">${MOUSE('left')}</g>${arrows.lr}`,
    pad: `${PAD(dot('d-drag', 20, 20))}${arrows.lr}`,
    mouseLabel: 'Click and drag', padLabel: 'Press and drag',
    touchLabel: 'Drag with one finger',
  },
  {
    key: 'slide', title: 'Slide up / down',
    mouse: `<g class="mouse">${MOUSE('right')}</g>${arrows.ud}`,
    pad: `${PAD(dot('d-slide', 16, 20) + dot('d-slide', 24, 20))}${arrows.ud}`,
    mouseLabel: 'Right-click drag', padLabel: 'Two-finger click and drag',
    touchLabel: 'Drag with two fingers',
  },
  {
    key: 'zoom', title: 'Zoom',
    mouse: `<g class="mouse">${MOUSE('wheel')}</g>${arrows.ud}`,
    pad: `${PAD(dot('d-pinch-a', 16, 20) + dot('d-pinch-b', 24, 20))}`,
    mouseLabel: 'Scroll the wheel', padLabel: 'Pinch in and out',
    touchLabel: 'Pinch',
  },
  {
    key: 'pan', title: 'Pan',
    mouse: `<g class="mouse">${MOUSE('wheel')}</g>${arrows.lr}`,
    pad: `${PAD(dot('d-pan', 16, 20) + dot('d-pan', 24, 20))}${arrows.lr}`,
    mouseLabel: 'Middle-click drag', padLabel: 'Two-finger scroll',
    touchLabel: 'Drag with two fingers',
  },
];

const svg = (inner) => `<svg viewBox="0 0 40 40" aria-hidden="true">${inner}</svg>`;

const box = document.createElement('div');
box.className = 'cs-hints';
box.setAttribute('aria-label', 'How to move the model');
box.innerHTML = ITEMS.map((it) => {
  const label = touch
    ? `<b>${it.title}</b> ${it.touchLabel}`
    : `<b>${it.title}</b> ${it.mouseLabel} <i>|</i> ${it.padLabel}`;
  const icons = touch
    ? svg(it.pad)
    : `${svg(it.mouse)}<i class="cs-hint__sep">|</i>${svg(it.pad)}`;
  return `<div class="cs-hint cs-hint--${it.key}">
    <span class="cs-hint__label">${label}</span>
    <span class="cs-hint__icon">${icons}</span>
  </div>`;
}).join('');
document.body.appendChild(box);

const info = document.createElement('button');
info.type = 'button';
info.className = 'cs-hints__info';
info.setAttribute('aria-label', 'Navigation help');
info.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="7" r="1.6"/><rect x="10.6" y="10.5" width="2.8" height="8" rx="1.4"/></svg>';
box.appendChild(info);

let foldTimer = null;
box.addEventListener('mouseenter', () => { clearTimeout(foldTimer); box.classList.add('is-open'); });
box.addEventListener('mouseleave', () => {
  clearTimeout(foldTimer);
  foldTimer = setTimeout(() => box.classList.remove('is-open'), 3000);
});