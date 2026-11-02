// Gibson pick cursor. The system cursor is hidden (fine pointers only) and a
// pick image follows the mouse, with its rounded tip exactly on the pointer.
//   default -> /pick.png   hover (buttons etc.) -> /pick-hover.png
//   pressed -> /pick-click.png, plus a flick on every click
// Images are 150x150 (2x); they are shown at 75x75 with the tip at (17, 17).
const SIZE = 75;
const TIP = 17;
const SRC = { idle: '/pick.png', hover: '/pick-hover.png', down: '/pick-click.png' };

const fine = !window.matchMedia?.('(pointer: coarse)').matches && !('ontouchstart' in window && navigator.maxTouchPoints > 0 && !window.matchMedia?.('(hover: hover)').matches);
if (fine) {
  document.documentElement.classList.add('has-pick');

  const wrap = document.createElement('div');
  wrap.id = 'cs-pick';
  const img = document.createElement('img');
  img.alt = '';
  img.draggable = false;
  img.src = SRC.idle;
  wrap.appendChild(img);
  document.body.appendChild(wrap);
  Object.values(SRC).forEach((s) => { const i = new Image(); i.src = s; }); // preload

  const INTERACTIVE = 'button, a, input, select, textarea, label, [role="button"], .cs-option, .cs-knobcolor__seg, .cs-nav__dot';
  let down = false;
  let hovering = false;

  const setImg = () => {
    const key = down ? 'down' : hovering ? 'hover' : 'idle';
    const want = SRC[key];
    if (!img.src.endsWith(want)) img.src = want;
    wrap.dataset.state = key;
  };

  window.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    wrap.style.transform = `translate3d(${e.clientX - TIP}px, ${e.clientY - TIP}px, 0)`;
    wrap.classList.add('is-visible');
    const h = !!(e.target.closest && e.target.closest(INTERACTIVE));
    if (h !== hovering) { hovering = h; setImg(); }
  }, { passive: true });

  window.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') return;
    down = true;
    setImg();
  }, true);

  window.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'touch') return;
    down = false;
    setImg();
    // select animation: a quick flick of the pick
    wrap.classList.remove('is-flick');
    void wrap.offsetWidth; // restart the animation
    wrap.classList.add('is-flick');
  }, true);

  document.documentElement.addEventListener('mouseleave', () => wrap.classList.remove('is-visible'));
  document.documentElement.addEventListener('mouseenter', () => wrap.classList.add('is-visible'));
  window.addEventListener('blur', () => { down = false; setImg(); });
}