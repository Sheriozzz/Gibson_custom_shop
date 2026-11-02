import * as THREE from 'three';
const asset = (p) => import.meta.env.BASE_URL + p.replace(/^\//, '');

const DARK_SRC = asset('/sign-dark.jpg');
const LIT_SRC = asset('/sign-lit.jpg');

const SIGN_SCALE = 1.12;

const MIN_DURATION = 5.0;
const HOLD = 0.5;
const FADE_OUT = 0.9;
const MAX_WAIT = 25;
const LETTER_STEP = 0.4;
const MAX_LIT = 0.8;
const BLOOM = 0.35;
const MASK_MAX_W = 2000;

const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const style = document.createElement('style');
style.textContent = `
#cs-loader{position:fixed;inset:0;z-index:1000;background:#050505;display:flex;align-items:center;justify-content:center;transition:opacity ${FADE_OUT}s ease;overflow:hidden;}
#cs-loader.is-replay{animation:none;opacity:1;}
@keyframes cs-loader-in{from{opacity:0}to{opacity:1}}
#cs-loader.is-done{opacity:0;pointer-events:none;}
#cs-loader .cs-sign{position:relative;width:100vw;aspect-ratio:2/1;transform:scale(${SIGN_SCALE});}
#cs-loader .cs-sign > *{position:absolute;inset:0;width:100%;height:100%;display:block;}
#cs-loader .cs-sign__lit{opacity:0;}
#cs-loader .cs-bar{position:absolute;left:50%;bottom:9vh;width:min(46vw,320px);height:2px;transform:translateX(-50%);background:rgba(255,255,255,.08);overflow:hidden;border-radius:2px;}
#cs-loader .cs-bar i{display:block;height:100%;width:100%;transform-origin:left;transform:scaleX(0);background:#c9a84c;}
`;
document.head.appendChild(style);

let root, signBox, glCv, barFill;
function mount() {
  root = document.createElement('div');
  root.id = 'cs-loader';
  root.setAttribute('aria-hidden', 'true');
  root.innerHTML = `
    <div class="cs-sign"><canvas class="cs-sign__gl"></canvas></div>
    <div class="cs-bar"><i></i></div>
  `;
  document.body.appendChild(root);
  document.getElementById('cs-loader-boot')?.remove();
  signBox = root.querySelector('.cs-sign');
  glCv = root.querySelector('.cs-sign__gl');
  barFill = root.querySelector('.cs-bar i');
}
mount();

let loadProgress = 0;
let sawItems = false;
let loadDone = false;
let doneTimer = null;
const manager = THREE.DefaultLoadingManager;
const prevStart = manager.onStart;
const prevProgress = manager.onProgress;
const prevLoad = manager.onLoad;
manager.onStart = (...a) => {
  sawItems = true;
  loadDone = false;
  clearTimeout(doneTimer);
  prevStart?.(...a);
};
manager.onProgress = (url, loaded, total) => {
  if (total > 0) loadProgress = Math.max(loadProgress, loaded / total);
  prevProgress?.(url, loaded, total);
};
manager.onLoad = (...a) => {
  clearTimeout(doneTimer);
  doneTimer = setTimeout(() => { loadDone = true; loadProgress = 1; }, 350);
  prevLoad?.(...a);
};

function clamp01(v) { return Math.min(1, Math.max(0, v)); }
function smooth(a, b, v) { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); }

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(src));
    img.src = src;
  });
}

function blurField(src, w, h, r) {
  let a = Float32Array.from(src);
  let b = new Float32Array(a.length);
  const size = r * 2 + 1;
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let sum = 0;
      for (let x = -r; x <= r; x++) sum += a[row + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        b[row + x] = sum / size;
        sum += a[row + Math.min(w - 1, x + r + 1)] - a[row + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let y = -r; y <= r; y++) sum += b[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        a[y * w + x] = sum / size;
        sum += b[Math.min(h - 1, y + r + 1) * w + x] - b[Math.max(0, y - r) * w + x];
      }
    }
  }
  return a;
}

function buildLetterMask(litImg) {
  const scale = Math.min(1, MASK_MAX_W / litImg.naturalWidth);
  const w = Math.round(litImg.naturalWidth * scale);
  const h = Math.round(litImg.naturalHeight * scale);
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(litImg, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;

  const white = new Float32Array(w * h);
  for (let i = 0, p = 0; i < px.length; i += 4, p++) {
    const lo = Math.min(px[i], px[i + 1], px[i + 2]);
    const hi = Math.max(px[i], px[i + 1], px[i + 2]);
    white[p] = clamp01((lo - 190) / 32) * clamp01((52 - (hi - lo)) / 14);
  }

  const density = blurField(white, w, h, Math.max(3, Math.round(w * 0.006)));
  const mask = new Float32Array(w * h);
  for (let p = 0; p < mask.length; p++) mask[p] = white[p] * smooth(0.2, 0.42, density[p]);

  const maskBytes = new Uint8Array(w * h * 4);
  for (let p = 0; p < mask.length; p++) {
    const v = Math.round(mask[p] * 255);
    maskBytes[p * 4] = v;
    maskBytes[p * 4 + 3] = 255;
  }

  const fw = Math.max(64, Math.round(w / 4));
  const fh = Math.max(32, Math.round(h / 4));
  const small = new Float32Array(fw * fh);
  const sx = w / fw;
  const sy = h / fh;
  for (let y = 0; y < fh; y++) {
    for (let x = 0; x < fw; x++) {
      let sum = 0;
      let n = 0;
      for (let yy = Math.floor(y * sy); yy < Math.min(h, Math.floor((y + 1) * sy)); yy++) {
        for (let xx = Math.floor(x * sx); xx < Math.min(w, Math.floor((x + 1) * sx)); xx++) { sum += mask[yy * w + xx]; n++; }
      }
      small[y * fw + x] = n ? sum / n : 0;
    }
  }
  const halo = blurField(small, fw, fh, Math.max(2, Math.round(fw * 0.012)));
  const spill = blurField(small, fw, fh, Math.max(4, Math.round(fw * 0.07)));
  const wide = blurField(small, fw, fh, Math.max(8, Math.round(fw * 0.18)));
  const fieldBytes = new Uint8Array(fw * fh * 4);
  for (let p = 0; p < fw * fh; p++) {
    fieldBytes[p * 4] = Math.round(clamp01(halo[p] * 2.2) * 255);
    fieldBytes[p * 4 + 1] = Math.round(clamp01(spill[p] * 3.2) * 255);
    fieldBytes[p * 4 + 2] = Math.round(clamp01(wide[p] * 5.0) * 255);
    fieldBytes[p * 4 + 3] = 255;
  }
  return { w, h, maskBytes, fw, fh, fieldBytes };
}

const VERT = `
attribute vec2 a;
varying vec2 v;
void main(){ v = vec2(a.x*0.5+0.5, 0.5-a.y*0.5); gl_Position = vec4(a,0.0,1.0); }`;

const FRAG = `
precision highp float;
varying vec2 v;
uniform sampler2D uDark, uLit, uMask, uField;
uniform float uLetters;  // neon tube brightness (0..1, includes flicker)
uniform float uPanel;    // how far the light has spilled (0..1)
uniform float uBloom;
void main(){
  // blend in linear light, the way real light adds up
  vec3 dark = pow(texture2D(uDark, v).rgb, vec3(2.2));
  vec3 lit  = pow(texture2D(uLit,  v).rgb, vec3(2.2));
  float m   = texture2D(uMask, v).r;
  vec3 f    = texture2D(uField, v).rgb;

  // how much light reaches this spot: a smooth falloff from the tubes
  // (tight halo + medium spill + very wide ambient), with no hard edge anywhere
  float L = clamp(f.r * 0.5 + f.g * 0.9 + f.b * 0.7, 0.0, 1.0);
  float expo = 1.0 - exp(-uPanel * uPanel * 5.5 * (0.05 + L));
  float reveal = mix(expo, 1.0, smoothstep(0.7, 1.0, uPanel)); // everything ends fully lit

  vec3 col = mix(dark, lit, reveal);                  // light reaching the panel and frame
  col = mix(col, lit, m * uLetters);                  // the neon tubes themselves

  // soft bloom, tinted by whatever it falls on so it blends into the panel
  float glow = (f.r * 0.8 + f.g * 0.35) * uLetters * uBloom * (1.0 - 0.7 * uPanel);
  col += (vec3(0.5, 0.55, 0.62) + lit * 1.1) * glow * (1.0 - m * 0.6);

  col = pow(col, vec3(1.0 / 2.2));
  float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  col += (n - 0.5) / 255.0;                           // dither: no banding in the dark gradients
  gl_FragColor = vec4(col, 1.0);
}`;

function createRenderer(images, data) {
  const gl = glCv.getContext('webgl', { antialias: false, alpha: false, premultipliedAlpha: false });
  if (!gl) return null;

  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'a');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const tex = (unit, upload) => {
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    upload();
  };
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  tex(0, () => gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, images.dark));
  tex(1, () => gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, images.lit));
  tex(2, () => gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, data.w, data.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data.maskBytes));
  tex(3, () => gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, data.fw, data.fh, 0, gl.RGBA, gl.UNSIGNED_BYTE, data.fieldBytes));
  ['uDark', 'uLit', 'uMask', 'uField'].forEach((n, i) => gl.uniform1i(gl.getUniformLocation(prog, n), i));

  const uLetters = gl.getUniformLocation(prog, 'uLetters');
  const uPanel = gl.getUniformLocation(prog, 'uPanel');
  const uBloom = gl.getUniformLocation(prog, 'uBloom');
  gl.uniform1f(uBloom, BLOOM);

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = signBox.clientWidth * SIGN_SCALE;
    const w = Math.min(images.lit.naturalWidth, Math.round(cssW * dpr));
    const h = Math.round(w * images.lit.naturalHeight / images.lit.naturalWidth);
    if (glCv.width !== w || glCv.height !== h) {
      glCv.width = w;
      glCv.height = h;
      gl.viewport(0, 0, w, h);
    }
  };
  resize();
  window.addEventListener('resize', resize);

  return {
    draw(letters, panel) {
      gl.uniform1f(uLetters, letters);
      gl.uniform1f(uPanel, panel);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
  };
}

function createFallback(images) {
  const dark = images.dark;
  const lit = images.lit;
  dark.className = 'cs-sign__dark';
  lit.className = 'cs-sign__lit';
  [dark, lit].forEach((i) => { i.style.objectFit = 'contain'; });
  glCv.replaceWith(dark, lit);
  return {
    draw(letters, panel) {
      lit.style.opacity = String(Math.max(panel, letters * 0.35));
    },
  };
}

let renderer = null;
let start = 0;
let b = 0;
let doneAt = 0;
let finished = false;
let minDuration = MIN_DURATION;
let cache = null;

const flickerTimes = [0.25, 0.4, 0.55, 0.8, 0.95];
function flicker(t) {
  if (reduceMotion || t > 1.3) return 1;
  for (let i = 0; i < flickerTimes.length; i++) {
    if (t > flickerTimes[i] && t < flickerTimes[i] + 0.06) return 0.25;
  }
  return 1;
}

function frame(now) {
  if (!start) start = now;
  const t = (now - start) / 1000;

  const timeline = clamp01(t / minDuration);
  const target = Math.min(timeline, sawItems || t > MAX_WAIT ? Math.max(loadProgress, loadDone ? 1 : 0) : 0.35);
  b += (target - b) * 0.08;
  if (target >= 1 && b > 0.995) b = 1;

  const letters = (0.1 + 0.9 * smooth(0, LETTER_STEP, b)) * flicker(t) * MAX_LIT;
  const panel = clamp01((b - 0.08) / 0.92) * MAX_LIT;
  renderer.draw(letters, panel);
  barFill.style.transform = `scaleX(${b})`;

  if (b >= 1 && !doneAt) doneAt = now;
  if (t > MAX_WAIT && !doneAt) { b = 1; doneAt = now; }

  if (doneAt && (now - doneAt) / 1000 >= HOLD && !finished) {
    finished = true;
    root.classList.add('is-done');
    window.__csLoaderDone = true;
    window.dispatchEvent(new Event('cs-loader-done'));
    setTimeout(() => root.remove(), FADE_OUT * 1000 + 100);
    return;
  }
  requestAnimationFrame(frame);
}

function abort() { root.remove(); window.__csLoaderDone = true; window.dispatchEvent(new Event('cs-loader-done')); }

function begin(images, data) {
  try {
    renderer = createRenderer(images, data);
  } catch (e) {
    console.warn('Loader WebGL failed, using plain fade:', e);
    renderer = null;
  }
  if (!renderer) renderer = createFallback(images);
  requestAnimationFrame(frame);
}

Promise.all([loadImage(DARK_SRC), loadImage(LIT_SRC)])
  .then(([dark, lit]) => {
    cache = { dark, lit, data: buildLetterMask(lit) };
    begin({ dark, lit }, cache.data);
  })
  .catch((e) => {
    console.warn('Loader sign images not found, skipping loading screen:', e.message);
    abort();
  });

window.csReplayLoader = () => {
  if (!cache || (root && root.isConnected)) return;
  window.__csLoaderDone = false;
  loadProgress = 0; sawItems = false; loadDone = false; clearTimeout(doneTimer);
  start = 0; b = 0; doneAt = 0; finished = false; minDuration = 3.2;
  mount();
  root.classList.add('is-replay');
  begin({ dark: cache.dark, lit: cache.lit }, cache.data);
};