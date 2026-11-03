const asset = (p) => import.meta.env.BASE_URL + p.replace(/^\//, '');

const fine = !window.matchMedia?.('(pointer: coarse)').matches && !('ontouchstart' in window && navigator.maxTouchPoints > 0 && !window.matchMedia?.('(hover: hover)').matches);
if (fine) {
  document.documentElement.classList.add('has-pick');
  ['pick', 'pick-hover', 'pick-click'].forEach((n) => {
    [`${n}-1x.png`, `${n}.png`].forEach((f) => { new Image().src = asset('/' + f); });
  });
}
