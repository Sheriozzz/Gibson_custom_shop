import './custom-shop-loader.js';
import './custom-shop-pick.js';
import './custom-shop-hints.js';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { gsap } from 'gsap';

const state = {
  guitar: null,
  woodGrade: 'plain',
  neck: 'medium',
  finish: 'black',
  treatment: 'gloss',
  hardware: 'gold',
  knobColor: 'gold',
  knobStyle: 'gold-th',
  vibrato: null,
  notes: '',
  simulationAck: false,
};

let hasSelectedGuitar = false;
let vibratoApplied = null;
let currentStep = 0;

const DEFAULT_FINISH = 'black';
function effFinish() {
  if (currentStep === 1) return DEFAULT_FINISH;
  if (currentStep === 2 || currentStep === 3) return null;
  return state.finish;
}
function effTreatment() {
  return currentStep >= 4 ? state.treatment : null;
}
const TOTAL_STEPS = 9;

let debugMode = false;
let orbitControls = null;

let transformMode = false;
let transformControls = null;
let transformTargetKey = null;

let hasPresentedInStandSession = false;
let s1Zoom = 1;
const s1Pan = new THREE.Vector3();
let zoomAnchor = null;
const panVec = new THREE.Vector3();
let baseDist = 8;
let userZoom = 1;
let bgScaleCur = 1.4;
const bgEl = document.querySelector('.cs-bg');

const canvasRoot = document.getElementById('cs-canvas-root');

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0);
renderer.toneMapping = THREE.NeutralToneMapping ?? THREE.ACESFilmicToneMapping;
const STANDARD_EXPOSURE = 1.0;
const STUDIO_EXPOSURE = 1.3;
renderer.toneMappingExposure = STANDARD_EXPOSURE;
canvasRoot.appendChild(renderer.domElement);
renderer.domElement.classList.add('cursor-grab');
renderer.domElement.addEventListener('webglcontextlost', (e) => e.preventDefault());
renderer.domElement.addEventListener('webglcontextrestored', () => { renderer.setSize(window.innerWidth, window.innerHeight); });

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);

const pmremGenerator = new THREE.PMREMGenerator(renderer);
scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;

const FRONT_LIGHT_SCALE = 0.7;

const keyLight = new THREE.DirectionalLight(0xfff2e0, 4.4 * FRONT_LIGHT_SCALE);
keyLight.position.set(3.8, 4.6, 5.8);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0x8fb8ff, 2.0);
fillLight.position.set(-3.8, 2.4, 3.6);
scene.add(fillLight);

const rimLight = new THREE.DirectionalLight(0xc9a24b, 2.2);
rimLight.position.set(-4.2, 2.2, -3.4);
scene.add(rimLight);

const frontLight = new THREE.PointLight(0xffffff, 6 * FRONT_LIGHT_SCALE, 16, 2);
frontLight.position.set(0.5, 1.5, 5);
scene.add(frontLight);

const topSpot = new THREE.SpotLight(0xffffff, 5, 22, Math.PI / 6, 0.5);
topSpot.position.set(0, 6.5, 3);
topSpot.target.position.set(0, 0, 0);
scene.add(topSpot);
scene.add(topSpot.target);

const sideFill = new THREE.DirectionalLight(0xffffff, 1.4);
sideFill.position.set(5.5, 0.5, 2);
scene.add(sideFill);

const hemiLight = new THREE.HemisphereLight(0xffffff, 0x1a1a1a, 1.1);
scene.add(hemiLight);

const ambientLight = new THREE.AmbientLight(0x404040, 1.3);
scene.add(ambientLight);

const slideGroup = new THREE.Group();
scene.add(slideGroup);

const positionGroup = new THREE.Group();
slideGroup.add(positionGroup);

const orientationGroup = new THREE.Group();
positionGroup.add(orientationGroup);

const guitarGroup = new THREE.Group();
orientationGroup.add(guitarGroup);

const bodyPieceGroup = new THREE.Group();
const neckPieceGroup = new THREE.Group();

const hardwareBaseGroup = new THREE.Group();
const knobPieceGroup = new THREE.Group();
const vibratoPieceGroup = new THREE.Group();

const standGroup = new THREE.Group();

const standGuitarGroups = {
  'les-paul': new THREE.Group(),
  sg: new THREE.Group(),
  explorer: new THREE.Group(),
  sj: new THREE.Group(),
};
let standPresentedKey = null;

const standSpinGroups = {};
Object.keys(standGuitarGroups).forEach((key) => {
  standSpinGroups[key] = new THREE.Group();
  standGuitarGroups[key].add(standSpinGroups[key]);
});

const SHOWROOM_TRANSFORM = { position: [0, 0, 0], rotation: [0, 0, 0] };

const showroomGroup = new THREE.Group();
showroomGroup.position.set(...SHOWROOM_TRANSFORM.position);
showroomGroup.rotation.set(...SHOWROOM_TRANSFORM.rotation);
positionGroup.add(showroomGroup);
let showroomMaterials = [];
let showroomLoaded = false;
let showroomOpacityTarget = 1;
let showroomFadeTween = null;

const STUDIO_SPOT_LUX = 3.2;
const STUDIO_SPOT_ANGLE = Math.PI / 6;
const STUDIO_SPOT_PENUMBRA = 0.8;
const STUDIO_SPOT_COLOR = 0xfff1dc;
const STUDIO_AMBIENT = 6;

const STUDIO_SPOT_OFFSETS = [
  [0.1, 1.5, 1.7],
  [1.9, 1.5, 1.7],
  [0.0, 2.0, -0.4],
];

const rigLights = [keyLight, fillLight, rimLight, frontLight, topSpot, sideFill, hemiLight, ambientLight];

const LIGHT_LEVEL = 0.62;
const ENV_LEVEL = 0.7;
rigLights.forEach((l) => { l.intensity *= LIGHT_LEVEL; });
const rigBaseIntensity = new Map(rigLights.map((l) => [l, l.intensity]));
const defaultEnvironment = scene.environment;

const studioSpots = [0, 1, 2].map(() => {
  const spot = new THREE.SpotLight(STUDIO_SPOT_COLOR, 0, 0, STUDIO_SPOT_ANGLE, STUDIO_SPOT_PENUMBRA, 2);
  spot.userData.studioIntensity = 0;
  positionGroup.add(spot);
  positionGroup.add(spot.target);
  return spot;
});
let studioLightingOn = false;
const studioStandCenter = new THREE.Vector3();
let studioStandD = 3;
let lightingInitialized = false;
let lightingTween = null;

const hasEnvIntensity = 'environmentIntensity' in scene;
function setEnvironmentLevel(level) {
  if (hasEnvIntensity) {
    scene.environment = defaultEnvironment;
    scene.environmentIntensity = level * ENV_LEVEL;
  } else {
    scene.environment = level > 0.5 ? defaultEnvironment : null;
  }
}

function applyLightingMode(mode, duration = 0) {
  studioLightingOn = mode === 'studio';

  const targets = new Map();
  rigLights.forEach((l) => {
    targets.set(l, studioLightingOn ? (l === ambientLight ? STUDIO_AMBIENT : 0) : rigBaseIntensity.get(l));
  });
  studioSpots.forEach((spot) => {
    targets.set(spot, studioLightingOn ? spot.userData.studioIntensity : 0);
  });
  const envTarget = studioLightingOn ? 0 : 1;

  lightingTween?.kill();
  lightingTween = null;

  const exposureTarget = studioLightingOn ? STUDIO_EXPOSURE : STANDARD_EXPOSURE;
  if (duration <= 0 || !lightingInitialized) {
    lightingInitialized = true;
    targets.forEach((value, light) => { light.intensity = value; });
    setEnvironmentLevel(envTarget);
    renderer.toneMappingExposure = exposureTarget;
    return;
  }
  const exposureFrom = renderer.toneMappingExposure;

  const from = new Map();
  targets.forEach((_, light) => from.set(light, light.intensity));
  const envFrom = hasEnvIntensity ? scene.environmentIntensity / ENV_LEVEL : (scene.environment ? 1 : 0);
  const progress = { t: 0 };
  lightingTween = gsap.to(progress, {
    t: 1,
    duration,
    ease: 'power1.inOut',
    onUpdate: () => {
      targets.forEach((to, light) => {
        light.intensity = from.get(light) + (to - from.get(light)) * progress.t;
      });
      setEnvironmentLevel(envFrom + (envTarget - envFrom) * progress.t);
      renderer.toneMappingExposure = exposureFrom + (exposureTarget - exposureFrom) * progress.t;
    },
  });
}

function positionStudioSpots(center, size) {
  const d = Math.max(size.x, size.y, size.z) || 3;
  studioStandCenter.copy(center);
  studioStandD = d;
  const aim = center.clone();
  aim.y += size.y * 0.15;

  studioSpots.forEach((spot, i) => {
    const [ox, oy, oz] = STUDIO_SPOT_OFFSETS[i];
    spot.position.set(center.x + ox * d, center.y + oy * d, center.z + oz * d);
    spot.target.position.copy(aim);
    const dist = spot.position.distanceTo(aim);
    spot.userData.studioIntensity = STUDIO_SPOT_LUX * dist * dist;
    if (studioLightingOn && !(lightingTween && lightingTween.isActive())) {
      spot.intensity = spot.userData.studioIntensity;
    }
  });
  console.log('Studio spots placed around stand -- center:', center.toArray().map((n) => +n.toFixed(2)), 'size:', size.toArray().map((n) => +n.toFixed(2)));
}

const axesHelper = new THREE.AxesHelper(3);
axesHelper.visible = false;
guitarGroup.add(axesHelper);

const ORIENTATION_AXIS = 'z';

let bodyMaterials = [];
let originalColors = [];
let originalMaps = [];
let propMaterials = [];

const GUITAR_OFFSETS = {
  vertical: { x: 1.5, y: -1.7 },
  horizontal: { x: 3.75, y: -0.10 },
};

function currentOffset() {
  return GUITAR_OFFSETS[orientation];
}

positionGroup.position.set(GUITAR_OFFSETS.vertical.x, GUITAR_OFFSETS.vertical.y, 0);

let orientation = 'vertical';

const ENABLE_MATERIAL_OVERRIDES = true;

const BODY_AO_INTENSITY = 0;

const LACQUER_MAP_ROUGHNESS = 0.12;
const ROUGHNESS_MAP_GAIN = 4;
const BODY_ROUGHNESS_SCALE = 1;
const FINISH_DEFAULT_ROUGHNESS = 0.12;
const WOOD_GRADE_ROUGHNESS = 0.7;

function softenBodyRoughness(mat) {
  mat.aoMapIntensity = BODY_AO_INTENSITY;
  const src = mat.roughnessMap;
  if (!src || !src.image || mat.userData.roughSoftened) return;

  const width = src.image.width;
  const height = src.image.height;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src.image, 0, 0);
  const frame = ctx.getImageData(0, 0, width, height);
  const px = frame.data;
  for (let i = 0; i < px.length; i += 4) {
    px[i + 1] = Math.min(255, px[i + 1] * ROUGHNESS_MAP_GAIN);
  }
  ctx.putImageData(frame, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = false;
  tex.channel = src.channel;
  tex.wrapS = src.wrapS;
  tex.wrapT = src.wrapT;

  mat.roughnessMap = tex;
  mat.userData.roughSoftened = true;
  mat.userData.roughBaseline = Math.min(1, LACQUER_MAP_ROUGHNESS * ROUGHNESS_MAP_GAIN);
}

function roughnessFactor(mat, wanted) {
  return (wanted * BODY_ROUGHNESS_SCALE) / (mat.userData.roughBaseline || 1);
}

const asset = (p) => import.meta.env.BASE_URL + p.replace(/^\//, '');
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/v1/decoders/');
const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(dracoLoader);
gltfLoader.setMeshoptDecoder(MeshoptDecoder);

const BODY_MODEL = asset('/models/gibson_lespaul_body.min.glb');

const NECK_PIECE_MODELS = {
  default: asset('/models/gibson_lespaul_NeckM.min.glb'),
  thin: asset('/models/gibson_lespaul_NeckS.min.glb'),
  medium: asset('/models/gibson_lespaul_NeckM.min.glb'),
  thick: asset('/models/gibson_lespaul_NeckL.min.glb'),
};

const STAND_MODEL = asset('/models/gibson_stand.min.glb');

const SHOWROOM_MODEL = asset('/models/studio.min.glb');

const STRIP_SHOWROOM_LIGHTS = false;
const STAND_GUITAR_MODELS = {
  'les-paul': asset('/models/gibson_lespaul_stand.min.glb'),
  sg: asset('/models/gibson_sg_stand.min.glb'),
  explorer: asset('/models/gibson_explorer_stand.min.glb'),
  sj: asset('/models/gibson_sj_stand.min.glb'),
};

const KNOBLESS_BASE = asset('/models/gibson_lespaul_Knobless.min.glb');
const CORDLESS_KNOBLESS_BASE = asset('/models/gibson_lespaul_CordlessKnobless.min.glb');
const VIBRATO_MODEL = asset('/models/gibson_lespaul_Vibrato.min.glb');

const KNOB_MODELS = {
  default: asset('/models/gibson_lespaul_GoldTH.min.glb'),
  'gold-th': asset('/models/gibson_lespaul_GoldTH.min.glb'),
  'black-wh': asset('/models/gibson_lespaul_BlackWH.min.glb'),
  speed: asset('/models/gibson_lespaul_SpeedKnob.min.glb'),
};

function disposePiece(object3d) {
  object3d.traverse((child) => {
    if (child.isMesh) {
      child.geometry?.dispose();
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach((m) => {
        if (m?.userData?.roughSoftened) m.roughnessMap?.dispose?.();
        m?.dispose?.();
      });
    }
  });
}

function clearGroup(group) {
  while (group.children.length > 0) {
    const child = group.children[0];
    group.remove(child);
    disposePiece(child);
  }
}

const DEFAULT_PIECE_TRANSFORM = {
  scale: [1.235, 1.235, 1.235],
  position: [0, 0, 0],
  rotation: [0, -Math.PI / 2 + THREE.MathUtils.degToRad(22), 0],
};
const IDENTITY_TRANSFORM = { scale: [1, 1, 1], position: [0, 0, 0], rotation: [0, 0, 0] };

function loadPieceIntoGroup(group, path, onLoaded, transform = DEFAULT_PIECE_TRANSFORM) {
  const bustedPath = `${path}${path.includes('?') ? '&' : '?'}t=${import.meta.env.DEV ? Date.now() : 'v2'}`;
  gltfLoader.load(
    bustedPath,
    (gltf) => {
      clearGroup(group);
      gltf.scene.scale.set(...transform.scale);
      gltf.scene.position.set(...transform.position);
      gltf.scene.rotation.set(...transform.rotation);
      onLoaded?.(gltf);
      group.add(gltf.scene);
    },
    undefined,
    (err) => {
      console.warn('Piece failed to load:', path, err);
      let warn = document.getElementById('cs-load-warning');
      if (!warn) {
        warn = document.createElement('div');
        warn.id = 'cs-load-warning';
        warn.style.cssText = `
          position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
          z-index: 999; background: #b03a2e; color: #fff; font-family: monospace;
          font-size: 13px; padding: 10px 18px; border-radius: 6px;
        `;
        document.body.appendChild(warn);
      }
      warn.textContent = `Model failed to load: ${path} (check the filename is in public/models/)`;
    }
  );
}

function loadBodyPiece(path) {
  loadPieceIntoGroup(bodyPieceGroup, path, (gltf) => {
    bodyMaterials = [];
    originalColors = [];
    originalMaps = [];

    gltf.scene.traverse((child) => {
      if (child.isMesh || child.isGroup) {
        console.log('Body piece node:', child.name || '(unnamed)', child.type);
      }
      if (child.isMesh && child.material) {
        upgradeBodyMaterials(child);
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach((m) => {
          console.log('  Body piece material:', m.name || '(unnamed)');
          const nameLower = (m.name || '').toLowerCase();
          if (nameLower.startsWith('body') || nameLower.startsWith('side') || nameLower.startsWith('base')) {
            bodyMaterials.push(m);
            softenBodyRoughness(m);
            originalColors.push('color' in m ? m.color.clone() : null);
            originalMaps.push('map' in m ? m.map : null);
          }
        });
      }
    });

    if (ENABLE_MATERIAL_OVERRIDES) {
      if (effFinish()) applyFinish(effFinish());
      else if (state.woodGrade) applyWoodGrade(state.woodGrade);
    }
  });
}

function loadNeckPiece(path) {
  loadPieceIntoGroup(neckPieceGroup, path, (gltf) => {
    gltf.scene.traverse((child) => {
      if (child.isMesh || child.isGroup) {
        console.log('Neck piece node:', child.name || '(unnamed)', child.type);
      }
      if (child.isMesh && child.material) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach((m) => console.log('  Neck piece material:', m.name || '(unnamed)'));
      }
    });
  });
}

const PRESENTED_TRANSFORM = {
  position: [2.0, 0.8, 0],
  rotation: [0, 0, 0],
};

function loadAllStandGuitars() {
  Object.entries(STAND_GUITAR_MODELS).forEach(([key, path]) => {
    loadPieceIntoGroup(standSpinGroups[key], path, (gltf) => {
      gltf.scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const center = box.getCenter(new THREE.Vector3());

      gltf.scene.position.sub(center);
      standSpinGroups[key].position.copy(center);
      standSpinGroups[key].rotation.set(0, 0, 0);

      gltf.scene.traverse((child) => {
        if (child.isMesh || child.isGroup) {
          console.log(`Stand guitar node (${key}):`, child.name || '(unnamed)', child.type);
        }
      });

      if (key === 'les-paul') styleStandLesPaul(gltf.scene);
    }, IDENTITY_TRANSFORM);
  });
}

function styleStandLesPaul(scene) {
  const bodies = [];
  const props = [];
  scene.traverse((child) => {
    if (!child.isMesh || !child.material) return;
    upgradeBodyMaterials(child);
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    mats.forEach((m) => {
      const n = (m.name || '').toLowerCase();
      if (n.startsWith('body') || n.startsWith('side') || n.startsWith('base')) bodies.push(m);
      else if (n.startsWith('prop')) props.push(m);
    });
  });

  bodies.forEach((m) => softenBodyRoughness(m));
  loadFinishTexture(TEXTURE_FINISHES[DEFAULT_FINISH]).then((tex) => {
    bodies.forEach((m) => {
      if (m.map && 'channel' in m.map) tex.channel = m.map.channel;
      m.map = tex;
      m.color.set('#ffffff');
      m.metalness = 0.15;
      m.roughness = roughnessFactor(m, FINISH_DEFAULT_ROUGHNESS);
      m.needsUpdate = true;
    });
  });

  props.forEach((m) => styleHardwareMaterial(m, 'gold'));
}

function ensureShowroomLoaded() {
  if (showroomLoaded) {
    fadeShowroom(1, 0.8);
    return;
  }
  showroomLoaded = true;
  showroomOpacityTarget = 1;

  loadPieceIntoGroup(showroomGroup, SHOWROOM_MODEL, (gltf) => {
    showroomMaterials = [];

    const embeddedLights = [];
    gltf.scene.traverse((child) => {
      if (child.isLight) embeddedLights.push(child);
    });
    console.log(
      `Showroom embedded lights: ${embeddedLights.length}`,
      embeddedLights.map((l) => `${l.type} intensity=${l.intensity}`)
    );
    if (STRIP_SHOWROOM_LIGHTS) embeddedLights.forEach((l) => l.parent?.remove(l));

    gltf.scene.traverse((child) => {
      if (child.isMesh && child.material) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach((m) => {
          m.transparent = true;
          m.opacity = showroomOpacityTarget;
          showroomMaterials.push(m);
          console.log(
            `Showroom material "${m.name || '(unnamed)'}" -- map: ${!!m.map}, roughnessMap: ${!!m.roughnessMap}, normalMap: ${!!m.normalMap}`
          );
        });
      }
    });
    showroomGroup.visible = showroomOpacityTarget > 0;
  }, IDENTITY_TRANSFORM);
}

function fadeShowroom(targetOpacity, duration = 1.0) {
  showroomOpacityTarget = targetOpacity;
  if (showroomMaterials.length === 0) return;
  if (targetOpacity > 0) showroomGroup.visible = true;

  showroomFadeTween?.kill();
  const proxy = { opacity: showroomMaterials[0].opacity };
  showroomFadeTween = gsap.to(proxy, {
    opacity: targetOpacity,
    duration,
    onUpdate: () => {
      showroomMaterials.forEach((m) => {
        m.opacity = proxy.opacity;
        m.needsUpdate = true;
      });
    },
    onComplete: () => {
      if (targetOpacity === 0) showroomGroup.visible = false;
    },
  });
}

function presentGuitar(key) {
  resetStage1View();
  const wasPresented = !!standPresentedKey;

  Object.keys(standGuitarGroups).forEach((k) => {
    if (k === key) return;
    const g = standGuitarGroups[k];
    gsap.killTweensOf(g.position);
    gsap.killTweensOf(g.rotation);
    gsap.to(g.position, { x: 0, y: 0, z: 0, duration: 0.8, ease: 'power2.inOut' });
    gsap.to(g.rotation, { x: 0, y: 0, z: 0, duration: 0.8, ease: 'power2.inOut' });
    const spin = standSpinGroups[k];
    if (spin && (k === standPresentedKey || Math.abs(spin.rotation.y) > 0.001)) {
      gsap.killTweensOf(spin.rotation);
      spin.rotation.y = wrapAngle(spin.rotation.y);
      gsap.to(spin.rotation, { x: 0, y: 0, z: 0, duration: 0.8, ease: 'power2.inOut' });
    }
  });

  const group = standGuitarGroups[key];
  if (group) {
    gsap.killTweensOf(group.position);
    gsap.killTweensOf(group.rotation);
    gsap.to(group.position, {
      x: PRESENTED_TRANSFORM.position[0],
      y: PRESENTED_TRANSFORM.position[1],
      z: PRESENTED_TRANSFORM.position[2],
      duration: 0.9,
      ease: 'power2.out',
    });
    gsap.to(group.rotation, {
      x: PRESENTED_TRANSFORM.rotation[0],
      y: PRESENTED_TRANSFORM.rotation[1],
      z: PRESENTED_TRANSFORM.rotation[2],
      duration: 0.9,
      ease: 'power2.out',
    });
  }

  standPresentedKey = key;

  if (!wasPresented) focusStep(1);
}

function runWhenLoaderDone(fn) {
  if (window.__csLoaderDone) setTimeout(fn, 150);
  else window.addEventListener('cs-loader-done', () => setTimeout(fn, 150), { once: true });
}

function enterStandMode() {
  guitarGroup.clear();
  guitarGroup.add(axesHelper);
  guitarGroup.add(standGroup);
  Object.values(standGuitarGroups).forEach((g) => guitarGroup.add(g));

  applyLightingMode('studio', 0.9);

  loadPieceIntoGroup(standGroup, STAND_MODEL, (gltf) => {
    gltf.scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(gltf.scene);
    if (!box.isEmpty()) {
      positionStudioSpots(box.getCenter(new THREE.Vector3()), box.getSize(new THREE.Vector3()));
    }

    gltf.scene.traverse((child) => {
      if (child.isMesh || child.isGroup) {
        console.log('Stand node:', child.name || '(unnamed)', child.type);
      }
    });
  }, IDENTITY_TRANSFORM);

  loadAllStandGuitars();
  standPresentedKey = null;
  resetStage1View();
  hasPresentedInStandSession = false;

  runWhenLoaderDone(() => {
    if (currentStep !== 1 || standPresentedKey) return;
    hasPresentedInStandSession = true;
    presentGuitar(MODELS[modelIndex].key);
  });

  ensureShowroomLoaded();
}

function loadHardwareBase(path) {
  loadPieceIntoGroup(hardwareBaseGroup, path, (gltf) => {
    bodyMaterials = [];
    originalColors = [];
    originalMaps = [];
    propMaterials = [];

    gltf.scene.traverse((child) => {
      if (child.isMesh || child.isGroup) {
        console.log('Hardware base node:', child.name || '(unnamed)', child.type);
      }
      if (child.isMesh && child.material) {
        upgradeBodyMaterials(child);
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach((m) => {
          console.log('  Hardware base material:', m.name || '(unnamed)');
          const nameLower = (m.name || '').toLowerCase();
          if (nameLower.startsWith('body') || nameLower.startsWith('side') || nameLower.startsWith('base')) {
            bodyMaterials.push(m);
            softenBodyRoughness(m);
            originalColors.push('color' in m ? m.color.clone() : null);
            originalMaps.push('map' in m ? m.map : null);
          }
          if (nameLower.startsWith('prop')) {
            propMaterials.push(m);
          }
        });
      }
    });

    if (ENABLE_MATERIAL_OVERRIDES) {
      gltf.scene.visible = false;
      instantBodyApply = true;
      lastBodyApply = Promise.resolve();
      if (effFinish()) applyFinish(effFinish());
      else if (state.woodGrade) applyWoodGrade(state.woodGrade);
      if (effTreatment()) applyTreatment(effTreatment());
      refreshHardware();
      const reveal = () => { instantBodyApply = false; gltf.scene.visible = true; };
      Promise.race([lastBodyApply, new Promise((r) => setTimeout(r, 1500))]).then(reveal, reveal);
    }
  });
}

function loadKnobPiece(path) {
  loadPieceIntoGroup(knobPieceGroup, path, (gltf) => {
    knobMaterials = [];
    knobFollowsPlating = path === KNOB_MODELS['gold-th'] || path === KNOB_MODELS['black-wh'];
    gltf.scene.traverse((child) => {
      if (child.isMesh || child.isGroup) {
        console.log('Knob piece node:', child.name || '(unnamed)', child.type);
      }
      if (child.isMesh && child.material) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach((m) => {
          if (m.aoMap) {
            m.aoMap = null;
            m.needsUpdate = true;
          }
          if (m.map) {
            m.userData.hwSelective = true;
            m.userData.hwGain = path === KNOB_MODELS['gold-th'] ? KNOB_GAIN : 1;
            knobMaterials.push(m);
          }
        });
      }
    });
    refreshHardware();
  });
}

function loadVibratoPiece(path) {
  loadPieceIntoGroup(vibratoPieceGroup, path, (gltf) => {
    vibratoMaterials = [];
    gltf.scene.traverse((child) => {
      if (child.isMesh || child.isGroup) {
        console.log('Vibrato piece node:', child.name || '(unnamed)', child.type);
      }
      if (child.isMesh && child.material) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach((m) => vibratoMaterials.push(m));
      }
    });
    refreshHardware();
  });
}

function enterHardwareMode() {
  guitarGroup.clear();
  guitarGroup.add(axesHelper);
  guitarGroup.add(hardwareBaseGroup);
  guitarGroup.add(knobPieceGroup);
  loadHardwareBase(state.vibrato ? CORDLESS_KNOBLESS_BASE : KNOBLESS_BASE);
  loadKnobPiece(KNOB_MODELS[state.knobStyle] || KNOB_MODELS.default);
  vibratoApplied = state.vibrato;
  if (state.vibrato) {
    guitarGroup.add(vibratoPieceGroup);
    loadVibratoPiece(VIBRATO_MODEL);
  }
}

function setKnobStyle(value) {
  loadKnobPiece(KNOB_MODELS[value] || KNOB_MODELS.default);
}

function setVibrato(finish) {
  const on = !!finish;
  loadHardwareBase(on ? CORDLESS_KNOBLESS_BASE : KNOBLESS_BASE);
  if (on) {
    if (!vibratoPieceGroup.parent) guitarGroup.add(vibratoPieceGroup);
    loadVibratoPiece(VIBRATO_MODEL);
  } else if (vibratoPieceGroup.parent) {
    guitarGroup.remove(vibratoPieceGroup);
  }
}

function enterBodyOnlyMode() {
  guitarGroup.clear();
  guitarGroup.add(axesHelper);
  guitarGroup.add(bodyPieceGroup);
  loadBodyPiece(BODY_MODEL);
}

function addNeckPiece() {
  if (!neckPieceGroup.parent) guitarGroup.add(neckPieceGroup);
  loadNeckPiece(NECK_PIECE_MODELS[state.neck] || NECK_PIECE_MODELS.default);
}

function removeNeckPiece() {
  if (neckPieceGroup.parent) guitarGroup.remove(neckPieceGroup);
}


function resizeRenderer() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resizeRenderer);
resizeRenderer();

const SPIN_SPEED = 0.006;
const SLIDE_SPEED = 0.005;
const SLIDE_RANGE = 2.5;
const DRAG_LOCK_PX = 6;
const AUTO_SPIN_SPEED = 0;

let isDragging = false;
let dragMode = null;
let activePointerId = null;
let dragTravel = { x: 0, y: 0 };
let prevPointer = { x: 0, y: 0 };
let velocity = { x: 0, y: 0 };

function wrapAngle(a) {
  const twoPi = Math.PI * 2;
  return ((((a + Math.PI) % twoPi) + twoPi) % twoPi) - Math.PI;
}

function getRotationTarget() {
  if (currentStep === 1) return standPresentedKey ? standSpinGroups[standPresentedKey] : null;
  return guitarGroup;
}

renderer.domElement.style.touchAction = 'none';
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (debugMode || transformMode) return;
  if (e.button === 1) return;
  if (isDragging) return;
  isDragging = true;
  activePointerId = e.pointerId;
  prevPointer = { x: e.clientX, y: e.clientY };
  dragTravel = { x: 0, y: 0 };

  const canSlide = currentStep !== 1;
  const wantsSlide = e.button === 2 || e.shiftKey;
  if (wantsSlide) {
    dragMode = canSlide ? 'slide' : 'none';
  } else {
    dragMode = 'rotate';
  }
  renderer.domElement.classList.replace('cursor-grab', 'cursor-grabbing');
});

function endDrag(e) {
  if (!isDragging || e.pointerId !== activePointerId) return;
  isDragging = false;
  dragMode = null;
  activePointerId = null;
  renderer.domElement.classList.replace('cursor-grabbing', 'cursor-grab');
}
window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);

window.addEventListener('pointermove', (e) => {
  if (debugMode || transformMode || !isDragging || e.pointerId !== activePointerId) return;
  let dx = e.clientX - prevPointer.x;
  let dy = e.clientY - prevPointer.y;
  prevPointer = { x: e.clientX, y: e.clientY };

  if (dragMode === null) {
    dragTravel.x += dx;
    dragTravel.y += dy;
    if (Math.max(Math.abs(dragTravel.x), Math.abs(dragTravel.y)) < DRAG_LOCK_PX) return;
    dragMode = Math.abs(dragTravel.y) > Math.abs(dragTravel.x) ? 'slide' : 'rotate';
    dx = dragTravel.x;
    dy = dragTravel.y;
  }

  if (dragMode === 'rotate') {
    const target = getRotationTarget();
    if (!target) return;
    const spin = (orientation === 'horizontal' ? dy : dx) * SPIN_SPEED;
    target.rotation.y += spin;
    velocity.x = spin;
  } else if (dragMode === 'slide') {
    slideGroup.position.y = THREE.MathUtils.clamp(
      slideGroup.position.y - dy * SLIDE_SPEED,
      -SLIDE_RANGE,
      SLIDE_RANGE
    );
  }
});

const OVERVIEW_CAM = { camPos: [0, 0.4, 7.8], lookAt: [0, -0.4, 0], fov: 34 };

const BODY_OVERVIEW_CAM = { camPos: [0, 0.4, 7.8], lookAt: [0, -0.4, 0], fov: 34 };

const TRACKING_REGIONS_VERTICAL = {
  3: { camPos: [-0.9, 1.9, 3.2], lookAt: [-0.9, 1.9, 0], fov: 24 },
  4: { camPos: [0.1, 0.6, 2.0], lookAt: [0.1, 0.5, 0], fov: 22 },
  5: { camPos: [0.1, 0.5, 2.3], lookAt: [0.1, 0.4, 0], fov: 26 },
  6: { camPos: [0.1, 0.1, 1.9], lookAt: [0.1, 0.05, 0], fov: 22 },
};

const TRACKING_REGIONS_HORIZONTAL = {
  3: { camPos: [1.9, 0.3, 3.2], lookAt: [1.9, 0.3, 0], fov: 24 },
  4: { camPos: [0.6, -0.2, 2.0], lookAt: [0.6, -0.3, 0], fov: 22 },
  5: { camPos: [0.6, -0.3, 2.3], lookAt: [0.6, -0.4, 0], fov: 26 },
  6: { camPos: [0.1, -0.6, 1.9], lookAt: [0.1, -0.65, 0], fov: 22 },
};

const STAND_IDLE_CAM = { camPos: [13.99, 1.63, 3.89], lookAt: [0.94, -0.06, -0.21], fov: 34.0 };
const STAND_PRESENTED_CAM = { camPos: [7.69, 4.16, 9.37], lookAt: [1.08, -0.03, -0.30], fov: 34.0 };

const STEP_CAMS_VERTICAL = {
  2: { camPos: [-0.39, 0.05, 7.82], lookAt: [0.20, -0.70, 0.04], fov: 34.0 },
  3: { camPos: [-6.10, 2.48, -1.28], lookAt: [1.09, 1.74, -0.54], fov: 24.0 },
  4: { camPos: [0.43, 0.33, 8.94], lookAt: [0.75, -0.63, -0.12], fov: 22.0 },
  5: { camPos: [0.19, -0.13, 8.44], lookAt: [0.55, -0.65, -0.21], fov: 26.0 },
  6: { camPos: [7.74, -1.55, 3.72], lookAt: [0.81, -0.70, 0.15], fov: 22.0 },
  7: { camPos: [7.21, -0.30, 5.48], lookAt: [0.76, -0.46, 0.45], fov: 34.0 },
  8: { camPos: [7.75, 0.14, 4.34], lookAt: [0.80, -0.49, 0.88], fov: 34.0 },
  9: { camPos: [7.64, 0.02, 4.06], lookAt: [0.90, -0.59, 0.70], fov: 34.0 },
};

const STEP_CAMS_HORIZONTAL = {
  2: { camPos: [1.49, -0.25, 7.87], lookAt: [1.32, -0.29, -0.03], fov: 34.0 },
  3: { camPos: [-0.43, -6.67, 2.31], lookAt: [-0.28, -0.25, -0.24], fov: 24.0 },
  4: { camPos: [1.52, 3.33, 8.02], lookAt: [1.42, -0.34, 0.08], fov: 22.0 },
  5: { camPos: [1.88, 2.63, 6.05], lookAt: [1.68, -0.20, 0.01], fov: 26.0 },
  6: { camPos: [5.18, 1.14, 5.83], lookAt: [2.36, -0.10, 0.72], fov: 22.0 },
  7: { camPos: [4.02, 4.20, 5.34], lookAt: [0.99, -0.96, -0.01], fov: 34.0 },
  8: { camPos: [0.24, 2.52, 7.38], lookAt: [-0.01, -0.40, -0.00], fov: 34.0 },
  9: { camPos: [2.54, 0.29, 5.99], lookAt: [1.41, -0.14, -0.44], fov: 34.0 },
};

function getRegionForStep(stepNum) {
  if (stepNum === 1) return { ...(standPresentedKey ? STAND_PRESENTED_CAM : STAND_IDLE_CAM) };
  if (orientation === 'horizontal' && STEP_CAMS_HORIZONTAL[stepNum]) return { ...STEP_CAMS_HORIZONTAL[stepNum] };
  if (orientation === 'vertical' && STEP_CAMS_VERTICAL[stepNum]) return { ...STEP_CAMS_VERTICAL[stepNum] };
  if (stepNum === 2) return { ...BODY_OVERVIEW_CAM };
  if (stepNum >= 7) return { ...OVERVIEW_CAM };

  const source = orientation === 'horizontal' ? TRACKING_REGIONS_HORIZONTAL : TRACKING_REGIONS_VERTICAL;
  const region = source[stepNum];
  if (!region) return null;

  const offset = currentOffset();
  return {
    camPos: [region.camPos[0] + offset.x, region.camPos[1] + offset.y, region.camPos[2]],
    lookAt: [region.lookAt[0] + offset.x, region.lookAt[1] + offset.y, region.lookAt[2]],
    fov: region.fov,
  };
}

const initialRegion = getRegionForStep(1);
const lookAtTarget = new THREE.Vector3(...initialRegion.lookAt);
camera.position.set(...initialRegion.camPos);
camera.fov = initialRegion.fov;
camera.updateProjectionMatrix();
camera.lookAt(lookAtTarget);

function focusStep(stepNum) {
  const region = getRegionForStep(stepNum);
  if (!region) return;
  userZoom = 1;
  zoomAnchor = null;
  panVec.set(0, 0, 0);
  baseDist = new THREE.Vector3(...region.camPos).distanceTo(new THREE.Vector3(...region.lookAt));

  gsap.to(camera.position, {
    x: region.camPos[0], y: region.camPos[1], z: region.camPos[2],
    duration: 1.1, ease: 'power3.inOut',
  });
  gsap.to(lookAtTarget, {
    x: region.lookAt[0], y: region.lookAt[1], z: region.lookAt[2],
    duration: 1.1, ease: 'power3.inOut',
  });
  gsap.to(camera, {
    fov: region.fov, duration: 1.1, ease: 'power3.inOut',
    onUpdate: () => camera.updateProjectionMatrix(),
  });
}

const BG_REF = (() => {
  const d = new THREE.Vector3(...STAND_IDLE_CAM.camPos).distanceTo(new THREE.Vector3(...STAND_IDLE_CAM.lookAt));
  return d * Math.tan(THREE.MathUtils.degToRad(STAND_IDLE_CAM.fov / 2));
})();
let shiftCur = 0;
const isPhone = () => window.matchMedia('(pointer: coarse)').matches && Math.min(window.innerWidth, window.innerHeight) <= 500;
let phoneShiftCur = 0;
function freeAreaCenterX() {
  const w = window.innerWidth;
  if (w < 900 && !isPhone()) return w / 2;
  const p = document.querySelector('.cs-panel.is-active');
  return ((p ? p.getBoundingClientRect().right : w * 0.35) + w) / 2;
}
function updateStageFraming() {
  const w = window.innerWidth;
  shiftCur += (freeAreaCenterX() - w / 2 - shiftCur) * 0.18;

  if (isPhone()) {
    const target = (freeAreaCenterX() - w * 0.68) * 1;
    phoneShiftCur += (target - phoneShiftCur) * 0.18;
    camera.setViewOffset(w, window.innerHeight, -phoneShiftCur, 0, w, window.innerHeight);
  } else if (camera.view && camera.view.enabled) {
    camera.clearViewOffset();
  }

  if (bgEl) {
    const dist = camera.position.distanceTo(lookAtTarget);
    const cur = dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const apparent = (r) => new THREE.Vector3(...r.camPos).distanceTo(new THREE.Vector3(...r.lookAt)) * Math.tan(THREE.MathUtils.degToRad(r.fov / 2));
    let scale = 1.4 * Math.sqrt(BG_REF / cur);
    if (currentStep === 1) scale = 1.4;
    if (currentStep >= 7) {
      const r6 = getRegionForStep(6);
      if (r6) scale = 1.4 * Math.sqrt(BG_REF / apparent(r6)) * (apparent(r6) / cur);
    }
    scale = THREE.MathUtils.clamp(scale, 0.35, 5);
    bgScaleCur += (scale - bgScaleCur) * 0.12;
    bgEl.style.setProperty('--bg-scale', bgScaleCur.toFixed(4));
    bgEl.style.setProperty('--bg-ox', (w / 2 + shiftCur).toFixed(1) + 'px');
  }
}

function animate() {
  requestAnimationFrame(animate);

  updateStageFraming();

  if (debugMode) {
    orbitControls.update();
    updateDebugHud();
    renderer.render(scene, camera);
    return;
  }

  const rotationTarget = getRotationTarget();
  if (rotationTarget) {
    if (isDragging && dragMode === 'rotate') {
      velocity.x *= 0.8;
    } else {
      velocity.x *= 0.92;
      rotationTarget.rotation.y += velocity.x + AUTO_SPIN_SPEED;
    }
    rotationTarget.rotation.x = 0;
  } else {
    velocity.x = 0;
  }
  velocity.y = 0;

  camera.lookAt(lookAtTarget);
  enforceStage1Floor();
  renderer.render(scene, camera);
}
animate();

const panels = document.querySelectorAll('.cs-panel');
const backBtn = document.getElementById('cs-back');

let pendingModeSwap = null;
let modeTL = null;
function fadeObjects(objs, to, duration) {
  const mats = new Set();
  objs.forEach((o) => o?.traverse((c) => {
    if (c.isMesh && c.material) (Array.isArray(c.material) ? c.material : [c.material]).forEach((m) => mats.add(m));
  }));
  mats.forEach((m) => {
    if (m.userData.__baseOpacity === undefined) m.userData.__baseOpacity = m.opacity;
    m.transparent = true;
  });
  const p = { f: 1 };
  return gsap.to(p, {
    f: to, duration, ease: 'power1.inOut',
    onUpdate: () => mats.forEach((m) => { m.opacity = m.userData.__baseOpacity * p.f; }),
  });
}
let requestSent = false;
function showStep(stepNum) {
  if (currentStep === 9 && stepNum < 9 && requestSent) return;
  if (stepNum >= 9 && !state.simulationAck) {
    stepNum = 8;
    if (currentStep === 8) {
      const ack = document.querySelector('.cs-ack');
      ack?.classList.remove('is-nudge');
      void ack?.offsetWidth;
      ack?.classList.add('is-nudge');
    }
  }
  const previousStep = currentStep;
  currentStep = Math.max(1, Math.min(TOTAL_STEPS, stepNum));

  if (previousStep !== currentStep) {
    velocity.x = 0;
    velocity.y = 0;
    guitarGroup.rotation.y = wrapAngle(guitarGroup.rotation.y);
    gsap.to(guitarGroup.rotation, { x: 0, y: 0, duration: 0.8, ease: 'power2.out' });
    gsap.to(slideGroup.position, { y: 0, duration: 0.8, ease: 'power2.out' });
  }

  const modeForStep = (step) => {
    if (step === 1) return 'stand';
    if (step === 2) return 'body';
    if (step === 3) return 'body_neck';
    return 'hardware';
  };
  const prevMode = modeForStep(previousStep);
  const nextMode = modeForStep(currentStep);

  if (pendingModeSwap) { modeTL?.kill(); pendingModeSwap(); }

  const leavingStand = prevMode === 'stand' && nextMode !== 'stand' && previousStep !== 0;
  const doModeSwap = () => {
  if (prevMode !== nextMode) {
    if (prevMode === 'stand' && nextMode !== 'stand') {
      if (transformMode) disableTransformMode();
      fadeShowroom(0, leavingStand ? 0.05 : 1.2);
      applyLightingMode('standard', 0.9);
    }

    if (nextMode === 'stand') {
      if (previousStep !== 0) window.csReplayLoader?.();
      enterStandMode();
    } else if (nextMode === 'body') {
      if (prevMode === 'body_neck') removeNeckPiece();
      else enterBodyOnlyMode();
    } else if (nextMode === 'body_neck') {
      if (prevMode === 'body') addNeckPiece();
      else {
        enterBodyOnlyMode();
        addNeckPiece();
      }
    } else if (nextMode === 'hardware') {
      enterHardwareMode();
    }
  }
  };

  if (leavingStand) {
    gsap.killTweensOf(camera.position);
    gsap.killTweensOf(lookAtTarget);
    gsap.killTweensOf(camera);
    const others = [standGroup, ...Object.entries(standGuitarGroups).filter(([k]) => k !== standPresentedKey).map(([, g]) => g)];
    const swap = () => {
      if (pendingModeSwap !== swap) return;
      pendingModeSwap = null;
      modeTL = null;
      doModeSwap();
      const r = getRegionForStep(currentStep);
      userZoom = 1;
      zoomAnchor = null;
      panVec.set(0, 0, 0);
      if (r) {
        baseDist = new THREE.Vector3(...r.camPos).distanceTo(new THREE.Vector3(...r.lookAt));
        const look = new THREE.Vector3(...r.lookAt);
        const end = new THREE.Vector3(...r.camPos);
        const startPos = look.clone().add(end.clone().sub(look).multiplyScalar(1.18));
        camera.position.copy(startPos);
        lookAtTarget.copy(look);
        camera.fov = r.fov;
        camera.updateProjectionMatrix();
        gsap.to(camera.position, { x: end.x, y: end.y, z: end.z, duration: 1.7, ease: 'power2.out' });
      }
      const el = renderer.domElement;
      const rv = { p: 0 };
      const setMask = () => {
        const edge = 14;
        const at = rv.p * (100 + edge) - edge;
        const m = `linear-gradient(to bottom, #000 ${at}%, transparent ${at + edge}%)`;
        el.style.webkitMaskImage = m; el.style.maskImage = m;
      };
      setMask();
      el.style.opacity = 1;
      gsap.to(rv, {
        p: 1, duration: 1.8, ease: 'power2.inOut', onUpdate: setMask,
        onComplete: () => { el.style.webkitMaskImage = ''; el.style.maskImage = ''; },
      });
    };
    pendingModeSwap = swap;
    modeTL = gsap.timeline();
    modeTL.add(() => fadeShowroom(0, 0.6), 0);
    modeTL.add(fadeObjects(others, 0, 0.6), 0);
    modeTL.to(renderer.domElement, { opacity: 0, duration: 0.5, ease: 'power1.inOut' }, 0.65);
    modeTL.add(swap, '>+0.05');
  } else {
    gsap.killTweensOf(renderer.domElement);
    renderer.domElement.style.opacity = '';
    doModeSwap();
  }

  const oldPanel = document.querySelector('.cs-panel.is-active');
  const oldH = oldPanel ? oldPanel.offsetHeight : 0;
  panels.forEach((p) => {
    p.classList.toggle('is-active', Number(p.dataset.step) === currentStep);
  });
  const newPanel = document.querySelector('.cs-panel.is-active');
  if (oldPanel && newPanel && oldPanel !== newPanel && oldH) {
    gsap.killTweensOf(newPanel);
    gsap.set(newPanel, { clearProps: 'height' });
    const newH = newPanel.offsetHeight;
    gsap.fromTo(newPanel, { height: oldH, overflow: 'hidden' }, { height: newH, duration: 0.55, ease: 'power2.inOut', clearProps: 'height,overflow' });
    gsap.fromTo(newPanel.children, { opacity: 0 }, { opacity: 1, duration: 0.4, delay: 0.12, clearProps: 'opacity' });
  }
  backBtn.hidden = currentStep === 1 || (currentStep === 9 && requestSent);
  if (!leavingStand) focusStep(currentStep);
  updateDots();
  requestAnimationFrame(positionKnobTab);
}

backBtn.addEventListener('click', () => showStep(currentStep - 1));

const orientBtnVertical = document.getElementById('cs-orient-vertical');
const orientBtnHorizontal = document.getElementById('cs-orient-horizontal');

function setOrientation(mode) {
  orientation = mode;
  const target = mode === 'horizontal' ? Math.PI / 2 : 0;
  const offset = GUITAR_OFFSETS[mode];

  gsap.to(orientationGroup.rotation, { [ORIENTATION_AXIS]: target, duration: 0.9, ease: 'power2.inOut' });
  gsap.to(positionGroup.position, { x: offset.x, y: offset.y, duration: 0.9, ease: 'power2.inOut' });

  orientBtnVertical?.classList.toggle('is-active', mode === 'vertical');
  orientBtnHorizontal?.classList.toggle('is-active', mode === 'horizontal');

  focusStep(currentStep);
}

orientBtnVertical?.addEventListener('click', () => setOrientation('vertical'));
orientBtnHorizontal?.addEventListener('click', () => setOrientation('horizontal'));

const dots = document.querySelectorAll('.cs-dot');
const dotsUp = document.getElementById('cs-dots-up');
const dotsDown = document.getElementById('cs-dots-down');

const NAV_FIRST = 2;
const NAV_WINDOW = 5;
const navEls = [];
document.querySelectorAll('.cs-panel').forEach((panel) => {
  if (Number(panel.dataset.step) < NAV_FIRST) return;
  const nav = document.createElement('div');
  nav.className = 'cs-nav';
  nav.innerHTML = `
    <div class="cs-nav__row">
      <button class="cs-nav__arrow" data-dir="-1" aria-label="Previous step">&lsaquo;</button>
      <div class="cs-nav__dots"></div>
      <button class="cs-nav__arrow" data-dir="1" aria-label="Next step">&rsaquo;</button>
    </div>
    <div class="cs-nav__count"></div>`;
  panel.appendChild(nav);
  nav.querySelectorAll('.cs-nav__arrow').forEach((btn) => {
    btn.addEventListener('click', () => showStep(currentStep + Number(btn.dataset.dir)));
  });
  navEls.push(nav);
});

function updateDots() {
  document.querySelector('.cs-orient')?.classList.toggle('is-hidden', currentStep === 1);
  dots.forEach((d) => d.classList.toggle('is-active', Number(d.dataset.dot) === currentStep));
  document.body.dataset.step = String(currentStep);

  const steps = [];
  for (let n = 1; n <= TOTAL_STEPS; n++) steps.push(n);
  const idx = Math.max(0, steps.indexOf(currentStep));
  const start = Math.min(Math.max(0, idx - Math.floor(NAV_WINDOW / 2)), Math.max(0, steps.length - NAV_WINDOW));
  const visible = steps.slice(start, start + NAV_WINDOW);
  navEls.forEach((nav) => {
    nav.querySelector('.cs-nav__dots').innerHTML = visible
      .map((n) => `<button class="cs-nav__dot${n === currentStep ? ' is-active' : ''}" data-step="${n}" aria-label="Step ${n}"></button>`)
      .join('');
    nav.querySelectorAll('.cs-nav__dot').forEach((d) => d.addEventListener('click', () => showStep(Number(d.dataset.step))));
    nav.querySelector('.cs-nav__count').textContent = `${currentStep}/${TOTAL_STEPS}`;
    const [prev, next] = nav.querySelectorAll('.cs-nav__arrow');
    prev.disabled = currentStep <= 1;
    next.disabled = currentStep >= TOTAL_STEPS || (currentStep === 8 && !state.simulationAck);
  });
}

dots.forEach((dot) => {
  dot.addEventListener('click', () => showStep(Number(dot.dataset.dot)));
});
if (dotsUp) dotsUp.addEventListener('click', () => showStep(currentStep - 1));
if (dotsDown) dotsDown.addEventListener('click', () => showStep(currentStep + 1));

const ZOOM_MIN_FACTOR = 0.6;
const ZOOM_MAX_FACTOR = 1.25;

const PAN_LIMIT = 0.4;
function panCamera(dxPx, dyPx) {
  if (currentStep === 1) { stage1Pan(dxPx, dyPx); return; }
  const dist = camera.position.distanceTo(lookAtTarget);
  const perPx = (2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / window.innerHeight;
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
  const delta = right.multiplyScalar(-dxPx * perPx).addScaledVector(up, dyPx * perPx);
  const next = panVec.clone().add(delta);
  const visH = 2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const maxX = dist * PAN_LIMIT;
  const closeUp = currentStep >= 4 && currentStep <= 6;
  const maxY = closeUp ? visH * 0.26 : dist * PAN_LIMIT;
  const minPu = closeUp && orientation === 'vertical' ? -visH * 0.26 : -maxY;
  const maxPu = closeUp && orientation === 'vertical' ? visH * 1.1 : maxY;
  let pr = THREE.MathUtils.clamp(next.dot(right.setFromMatrixColumn(camera.matrixWorld, 0)), -maxX, maxX);
  let pu = THREE.MathUtils.clamp(next.dot(up), minPu, maxPu);
  next.copy(right).multiplyScalar(pr).addScaledVector(up, pu);
  delta.copy(next).sub(panVec);
  panVec.copy(next);
  camera.position.add(delta);
  lookAtTarget.add(delta);
  if (zoomAnchor) zoomAnchor.add(delta);
}

const S1_ZOOM_MIN = 0.75;
const S1_ZOOM_MAX = 1.3;
const S1_PAN_X = 0.8;
const S1_PAN_Y = 0.5;
function resetStage1View() {
  s1Zoom = 1;
  s1Pan.set(0, 0, 0);
  Object.values(standSpinGroups).forEach((g) => g.scale.setScalar(1));
}
function stage1Zoom(step) {
  if (!standPresentedKey) return;
  s1Zoom = THREE.MathUtils.clamp(s1Zoom * Math.exp(step), S1_ZOOM_MIN, S1_ZOOM_MAX);
  standSpinGroups[standPresentedKey].scale.setScalar(s1Zoom);
}
function stage1Pan(dxPx, dyPx) {
  if (!standPresentedKey) return;
  const dist = camera.position.distanceTo(lookAtTarget);
  const perPx = (2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / window.innerHeight;
  camera.updateMatrixWorld();
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
  const next = s1Pan.clone().addScaledVector(right, dxPx * perPx).addScaledVector(up, -dyPx * perPx);
  const pr = THREE.MathUtils.clamp(next.dot(right), -S1_PAN_X, S1_PAN_X);
  const pu = THREE.MathUtils.clamp(next.dot(up), -S1_PAN_Y, S1_PAN_Y);
  s1Pan.copy(right).multiplyScalar(pr).addScaledVector(up, pu);
  const g = standGuitarGroups[standPresentedKey];
  gsap.killTweensOf(g.position);
  g.position.set(PRESENTED_TRANSFORM.position[0] + s1Pan.x, PRESENTED_TRANSFORM.position[1] + s1Pan.y, PRESENTED_TRANSFORM.position[2] + s1Pan.z);
  enforceStage1Floor();
}

let standFloorY = null;
const floorBox = new THREE.Box3();
const floorRay = new THREE.Raycaster();
const FLOOR_DOWN = new THREE.Vector3(0, -1, 0);
function findFloorY(spin) {
  floorRay.set(new THREE.Vector3(floorBox.getCenter(new THREE.Vector3()).x, floorBox.min.y + 0.8, floorBox.getCenter(new THREE.Vector3()).z), FLOOR_DOWN);
  const hit = floorRay.intersectObject(showroomGroup, true).find((h) => h.object.isMesh);
  if (hit) return hit.point.y;
  return null;
}
function enforceStage1Floor() {
  if (currentStep !== 1 || !standPresentedKey) return;
  const spin = standSpinGroups[standPresentedKey];
  const holder = standGuitarGroups[standPresentedKey];
  spin.updateWorldMatrix(true, true);
  floorBox.setFromObject(spin);
  if (floorBox.isEmpty()) return;
  if (standFloorY === null) {
    showroomGroup.updateWorldMatrix(true, true);
    standFloorY = findFloorY(spin);
    if (standFloorY === null) {
      const bx = new THREE.Box3().setFromObject(standGroup);
      if (bx.isEmpty()) return;
      standFloorY = bx.min.y;
      setTimeout(() => { standFloorY = null; }, 2000);
    }
  }
  const gap = standFloorY - floorBox.min.y;
  if (gap > 0) { holder.position.y += gap; holder.updateWorldMatrix(true, true); }
}

function zoomBy(step) {
  if (currentStep === 1) { stage1Zoom(step); enforceStage1Floor(); return; }
  const curDist = camera.position.distanceTo(lookAtTarget);
  const wanted = THREE.MathUtils.clamp(curDist * Math.exp(step), baseDist * ZOOM_MIN_FACTOR, baseDist * ZOOM_MAX_FACTOR);
  const ratio = wanted / curDist;
  if (Math.abs(ratio - 1) < 1e-6) return;
  if (!zoomAnchor) {
    const ndcX = (freeAreaCenterX() / window.innerWidth) * 2 - 1;
    camera.updateMatrixWorld();
    const camDir = camera.getWorldDirection(new THREE.Vector3());
    const dir = new THREE.Vector3(ndcX, 0, 0.5).unproject(camera).sub(camera.position).normalize();
    const depth = lookAtTarget.clone().sub(camera.position).dot(camDir);
    zoomAnchor = camera.position.clone().addScaledVector(dir, depth / Math.max(0.05, dir.dot(camDir)));
  }
  const q = zoomAnchor;
  camera.position.sub(q).multiplyScalar(ratio).add(q);
  lookAtTarget.sub(q).multiplyScalar(ratio).add(q);
}

window.addEventListener(
  'wheel',
  (e) => {
    if (debugMode) return;
    if (e.target.closest && e.target.closest('textarea, .cs-panel__scroll, .cs-panel')) return;
    if (e.ctrlKey) {
      e.preventDefault();
      zoomBy(e.deltaY * 0.01);
      return;
    }
    const isMouseWheel = e.deltaMode === 1 || (e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 50);
    if (!isMouseWheel) {
      panCamera(-e.deltaX, -e.deltaY);
      return;
    }
    zoomBy(e.deltaY * 0.0012);
  },
  { passive: false }
);

let gestureLast = 1;
window.addEventListener('gesturestart', (e) => { e.preventDefault(); gestureLast = 1; });
window.addEventListener('gesturechange', (e) => {
  e.preventDefault();
  if (e.target.closest && e.target.closest('.cs-panel')) return;
  zoomBy(-Math.log(e.scale / gestureLast));
  gestureLast = e.scale;
});
window.addEventListener('gestureend', (e) => e.preventDefault());

let midPan = null;
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button !== 1 || debugMode) return;
  e.preventDefault();
  midPan = { id: e.pointerId, x: e.clientX, y: e.clientY };
  renderer.domElement.setPointerCapture?.(e.pointerId);
});
window.addEventListener('pointermove', (e) => {
  if (!midPan || e.pointerId !== midPan.id) return;
  panCamera(e.clientX - midPan.x, e.clientY - midPan.y);
  midPan.x = e.clientX;
  midPan.y = e.clientY;
});
window.addEventListener('pointerup', (e) => { if (midPan && e.pointerId === midPan.id) midPan = null; });

const MODELS = [
  { key: 'les-paul', name: 'Les Paul', available: true },
  { key: 'sg', name: 'SG', available: false },
  { key: 'explorer', name: 'Explorer', available: false },
  { key: 'sj', name: 'SJ', available: false },
];
let modelIndex = 0;

const modelNameEl = document.getElementById('cs-model-name');
const modelStatusEl = document.getElementById('cs-model-status');
const selectBtn = document.getElementById('cs-picker-select');

function renderModelSwitch() {
  const model = MODELS[modelIndex];
  modelNameEl.textContent = model.name;
  modelStatusEl.textContent = model.available ? 'Available' : 'Unavailable';
  modelStatusEl.classList.toggle('is-unavailable', !model.available);
  modelNameEl.classList.toggle('is-unavailable', !model.available);
  selectBtn.disabled = !model.available;
}
renderModelSwitch();

document.getElementById('cs-model-prev').addEventListener('click', () => {
  modelIndex = (modelIndex - 1 + MODELS.length) % MODELS.length;
  renderModelSwitch();
  hasPresentedInStandSession = true;
  velocity.x = 0;
  velocity.y = 0;
  presentGuitar(MODELS[modelIndex].key);
});
document.getElementById('cs-model-next').addEventListener('click', () => {
  modelIndex = (modelIndex + 1) % MODELS.length;
  renderModelSwitch();
  hasPresentedInStandSession = true;
  velocity.x = 0;
  velocity.y = 0;
  presentGuitar(MODELS[modelIndex].key);
});

const step1Panel = document.querySelector('.cs-panel[data-step="1"]');
if (step1Panel) {
  step1Panel.addEventListener('click', () => {
    if (currentStep !== 1 || hasPresentedInStandSession) return;
    hasPresentedInStandSession = true;
    presentGuitar(MODELS[modelIndex].key);
  });
}

selectBtn.addEventListener('click', () => {
  if (!MODELS[modelIndex].available) return;
  window.dispatchEvent(new Event('cs-guitar-selected'));
  state.guitar = MODELS[modelIndex].key;
  hasSelectedGuitar = true;
  updateSummary();
  showStep(2);
});

const bodyContinueBtn = document.getElementById('cs-body-continue');
if (bodyContinueBtn) {
  bodyContinueBtn.addEventListener('click', () => {
    showStep(3);
  });
}

const searchInput = document.getElementById('cs-search-input');
if (searchInput) {
  searchInput.addEventListener('input', () => {
    const query = searchInput.value.trim().toLowerCase();
    const match = MODELS.findIndex((m) => m.name.toLowerCase().includes(query));
    if (match !== -1) {
      modelIndex = match;
      renderModelSwitch();
      hasPresentedInStandSession = true;
      velocity.x = 0;
      velocity.y = 0;
      presentGuitar(MODELS[modelIndex].key);
    }
  });
}

function showSectionDesc(options, hovered) {
  let el = options?.nextElementSibling;
  while (el && !el.classList.contains('cs-hover-desc')) el = el.nextElementSibling;
  if (!el) return;
  clearTimeout(el._t);
  const multi = !!options.closest('.cs-panel[data-step="6"]');

  if (!hovered) {
    el._t = setTimeout(() => {
      if (multi) el.classList.remove('is-open');
      else setDescText(el, options.querySelector('.is-selected')?.dataset.desc || '\u00a0');
    }, 350);
    return;
  }
  if (multi) {
    if (el.textContent !== hovered.dataset.desc) {
      if (el.classList.contains('is-open')) setDescText(el, hovered.dataset.desc || '', true);
      else el.textContent = hovered.dataset.desc || '';
    }
    el.classList.add('is-open');
  } else {
    el._t = setTimeout(() => setDescText(el, hovered.dataset.desc || '\u00a0'), 120);
  }
}

function setDescText(el, text, keepOpacityClass) {
  if (el.dataset.target === text) return;
  el.dataset.target = text;
  gsap.killTweensOf(el);
  gsap.to(el, {
    opacity: 0, duration: 0.4, ease: 'power1.inOut',
    onComplete: () => {
      el.textContent = text;
      gsap.to(el, { opacity: 1, duration: 0.8, ease: 'power1.inOut', clearProps: keepOpacityClass ? 'opacity' : '' });
    },
  });
}
document.querySelectorAll('.cs-options').forEach((o) => showSectionDesc(o, null));

function positionKnobTab() {
  const tab = document.querySelector('.cs-knobcolor');
  const sel = document.querySelector('[data-group="knobStyle"].is-selected');
  if (!tab || !sel || !sel.offsetWidth) return;
  const opts = sel.closest('.cs-options');
  if (isPhone()) {
    if (tab.parentElement !== opts) opts.appendChild(tab);
    opts.style.position = 'relative';
    tab.classList.add('is-phone');
    const open = tab.classList.contains('is-open');
    opts.querySelectorAll('.cs-option').forEach((b) => { b.style.marginBottom = ''; b.classList.remove('has-tab'); });
    tab.style.marginLeft = '';
    if (open) {
      sel.classList.add('has-tab');
      tab.style.left = sel.offsetLeft + 'px';
      tab.style.top = (sel.offsetTop + sel.offsetHeight - 8) + 'px';
      tab.style.width = sel.offsetWidth + 'px';
      sel.style.marginBottom = '30px';
    }
    return;
  }
  if (tab.classList.contains('is-phone')) {
    tab.classList.remove('is-phone');
    tab.style.left = tab.style.top = '';
    opts.querySelectorAll('.cs-option').forEach((b) => { b.style.marginBottom = ''; b.classList.remove('has-tab'); });
    opts.after(tab);
  }
  const base = tab.parentElement.getBoundingClientRect().left;
  tab.style.marginLeft = (sel.getBoundingClientRect().left - base) + 'px';
  tab.style.width = sel.offsetWidth + 'px';
}
window.addEventListener('resize', positionKnobTab);
document.querySelectorAll('.cs-knobcolor__seg').forEach((seg) => {
  seg.addEventListener('click', () => {
    document.querySelectorAll('.cs-knobcolor__seg').forEach((b) => b.classList.toggle('is-selected', b === seg));
    state.knobColor = seg.dataset.value;
    refreshHardware();
    updateSummary();
  });
});

document.querySelectorAll('.cs-option[data-group]').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.disabled) return;
    const group = btn.dataset.group;
    const value = btn.dataset.value;

    document.querySelectorAll(`.cs-option[data-group="${group}"]`).forEach((b) => {
      b.classList.remove('is-selected');
    });
    btn.classList.add('is-selected');
    showSectionDesc(btn.closest('.cs-options'), btn);

    state[group] = value;

    if (group === 'vibrato') {
      const prev = vibratoApplied;
      state.vibrato = value === 'none' ? null : value === 'chrome' ? 'Chrome' : 'Gold';
      vibratoApplied = state.vibrato;
      if (prev !== state.vibrato) {
        if (prev && state.vibrato) loadVibratoPiece(VIBRATO_MODEL);
        else setVibrato(state.vibrato);
      }
    }

    if (ENABLE_MATERIAL_OVERRIDES) {
      if (group === 'finish') applyFinish(value);
      if (group === 'woodGrade') applyWoodGrade(value);
      if (group === 'treatment') applyTreatment(value);
      if (group === 'hardware') applyHardware(value);
    }
    if (group === 'neck') {
      const path = NECK_PIECE_MODELS[value] || NECK_PIECE_MODELS.default;
      loadNeckPiece(path);
    }
    if (group === 'knobStyle') {
      setKnobStyle(value);
      document.querySelector('.cs-knobcolor')?.classList.toggle('is-open', value !== 'speed');
      requestAnimationFrame(positionKnobTab);
    }
    if (group === 'knobColor') {
      state.knobColor = value;
      refreshHardware();
    }
    updateSummary();
  });

  btn.addEventListener('mouseenter', () => showSectionDesc(btn.closest('.cs-options'), btn));
  btn.addEventListener('mouseleave', () => showSectionDesc(btn.closest('.cs-options'), null));

});

const notesField = document.querySelector('.cs-notes');
if (notesField) {
  notesField.addEventListener('input', (e) => {
    state.notes = e.target.value;
    updateSummary();
  });
}
const notesContinue = document.getElementById('cs-notes-continue');
if (notesContinue) {
  notesContinue.addEventListener('click', () => showStep(8));
}

const TEXTURE_FINISHES = {
  black: asset('/models/textures/Image_2_Black.png'),
  'alpine-white': asset('/models/textures/Image_2_AlpineWhite.png'),
  smokehouse: asset('/models/textures/Image_2_Smokehouse.png'),
  olive: asset('/models/textures/Image_2_Olive.png'),
  iguana: asset('/models/textures/Image_2_Iguana.png'),
  goldtop: asset('/models/textures/Image_2_GoldTop.png'),
  cobalt: asset('/models/textures/Image_2_Cobalt.png'),
  'cardinal-red': asset('/models/textures/Image_2_CardinalRed.png'),
  bourbon: asset('/models/textures/Image_2_Burbon.png'),
};

const WOOD_GRADE_TEXTURES = {
  plain: asset('/models/textures/Image_2_Plain.png'),
  aa: asset('/models/textures/Image_2_AA.png'),
  aaa: asset('/models/textures/Image_2_AAA.png'),
  '5a': asset('/models/textures/Image_2_5A.png'),
};

const textureLoader = new THREE.TextureLoader();
const textureCache = {};

function setTextureColorSpace(tex) {
  if ('colorSpace' in tex && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  else if ('encoding' in tex && THREE.sRGBEncoding) tex.encoding = THREE.sRGBEncoding;
}

function loadFinishTexture(path) {
  if (textureCache[path]) return Promise.resolve(textureCache[path]);
  return new Promise((resolve, reject) => {
    textureLoader.load(
      path,
      (tex) => {
        tex.flipY = false;
        setTextureColorSpace(tex);
        textureCache[path] = tex;
        resolve(tex);
      },
      undefined,
      (err) => reject(err)
    );
  });
}

function applyBodyTexture(path, matProps = { metalness: 0.15, roughness: FINISH_DEFAULT_ROUGHNESS }) {
  if (!path || bodyMaterials.length === 0) return;

  lastBodyApply = loadFinishTexture(path)
    .then((tex) => {
      bodyMaterials.forEach((mat, i) => {
        if (originalMaps[i] && 'channel' in originalMaps[i]) {
          tex.channel = originalMaps[i].channel;
        }
        mat.map = tex;
        mat.color.set('#ffffff');
        mat.metalness = matProps.metalness;
        mat.roughness = roughnessFactor(mat, matProps.roughness);
        mat.transparent = false;
        mat.opacity = 1;
        mat.needsUpdate = true;
      });
      applyBodyMetal();
    })
    .catch((err) => {
      console.warn('Body texture failed to load:', path, err);
      let warn = document.getElementById('cs-load-warning');
      if (!warn) {
        warn = document.createElement('div');
        warn.id = 'cs-load-warning';
        warn.style.cssText = `
          position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
          z-index: 999; background: #b03a2e; color: #fff; font-family: monospace;
          font-size: 13px; padding: 10px 18px; border-radius: 6px;
        `;
        document.body.appendChild(warn);
      }
      warn.textContent = `Texture failed to load: ${path} (check the filename is in public/models/textures/)`;
    });
}

const WEAR_MASKS = {
  'light-aged': asset('/models/textures/Murphy_Light.png'),
  'heavy-aged': asset('/models/textures/Murphy_Heavy.png'),
  'ultra-aged': asset('/models/textures/Murphy_Ultra.png'),
};

function compositeWearOverlay(baseTex, maskTex, maskOpacity = 1) {
  const width = baseTex.image?.width || 1024;
  const height = baseTex.image?.height || 1024;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(baseTex.image, 0, 0, width, height);
  ctx.globalAlpha = maskOpacity;
  ctx.drawImage(maskTex.image, 0, 0, width, height);
  ctx.globalAlpha = 1;

  ctx.save();
  ctx.beginPath();
  tracePlates(ctx, width / BACK_PLATES.size);
  ctx.lineWidth = BACK_PLATES.grow * 2 * (width / BACK_PLATES.size);
  ctx.clip();
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(baseTex.image, 0, 0, width, height);
  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = false;
  setTextureColorSpace(tex);
  return tex;
}

function applyAgingOverlay(roughness) {
  const maskPath = WEAR_MASKS[effTreatment()];
  if (!maskPath || bodyMaterials.length === 0) return;

  loadFinishTexture(maskPath)
    .then((maskTex) => {
      if (effFinish()) {
        const finishPath = TEXTURE_FINISHES[effFinish()];
        if (!finishPath) return;
        loadFinishTexture(finishPath).then((baseTex) => {
          const composited = compositeWearOverlay(baseTex, maskTex);
          bodyMaterials.forEach((mat, i) => {
            if (originalMaps[i] && 'channel' in originalMaps[i]) {
              composited.channel = originalMaps[i].channel;
            }
            mat.map = composited;
            mat.color.set('#ffffff');
            mat.metalness = 0.15;
            mat.roughness = roughnessFactor(mat, roughness);
            mat.transparent = false;
            mat.opacity = 1;
            mat.needsUpdate = true;
          });
          applyBodyMetal();
        });
      } else {
        bodyMaterials.forEach((mat, i) => {
          const baseTex = originalMaps[i];
          if (!baseTex || !baseTex.image) return;

          const composited = compositeWearOverlay(baseTex, maskTex);
          if ('channel' in baseTex) composited.channel = baseTex.channel;
          mat.map = composited;
          if (originalColors[i]) mat.color.copy(originalColors[i]);
          mat.metalness = 0.15;
          mat.roughness = roughnessFactor(mat, roughness);
          mat.transparent = false;
          mat.opacity = 1;
          mat.needsUpdate = true;
        });
      }
    })
    .catch((err) => console.warn('Aging overlay failed to composite:', err));
}

const GOLDTOP_MASK = asset('/models/textures/GoldTop_Mask.png');
const GOLDTOP_EXTRA_ROUGHNESS = 0.2;
const GOLDTOP_METAL = { gloss: 1, vos: 0.92, 'light-aged': 0.8, 'heavy-aged': 0.65, 'ultra-aged': 0.5 };

let goldtopMaskImage = null;
function loadGoldtopMask() {
  if (goldtopMaskImage) return Promise.resolve(goldtopMaskImage);
  return new Promise((resolve, reject) => {
    textureLoader.load(GOLDTOP_MASK, (tex) => { goldtopMaskImage = tex.image; resolve(goldtopMaskImage); }, undefined, reject);
  });
}

function buildGoldtopMetalMap(wearImage) {
  const w = goldtopMaskImage.width;
  const h = goldtopMaskImage.height;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(goldtopMaskImage, 0, 0, w, h);
  if (wearImage) {
    const wear = document.createElement('canvas');
    wear.width = w;
    wear.height = h;
    const wctx = wear.getContext('2d');
    wctx.drawImage(wearImage, 0, 0, w, h);
    wctx.globalCompositeOperation = 'source-in';
    wctx.fillStyle = '#000';
    wctx.fillRect(0, 0, w, h);
    ctx.drawImage(wear, 0, 0);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = false;
  return tex;
}

function applyBodyMetal() {
  if (bodyMaterials.length === 0) return;
  const goldtop = effFinish() === 'goldtop';
  bodyMaterials.forEach((mat) => {
    if (mat.userData.origMetalMap === undefined) mat.userData.origMetalMap = mat.metalnessMap || null;
  });

  if (!goldtop) {
    bodyMaterials.forEach((mat) => {
      mat.metalnessMap = mat.userData.origMetalMap;
      mat.needsUpdate = true;
    });
    return;
  }

  const request = effFinish() + '|' + effTreatment();
  const wearPath = WEAR_MASKS[effTreatment()];
  Promise.all([loadGoldtopMask(), wearPath ? loadFinishTexture(wearPath) : Promise.resolve(null)])
    .then(([, wearTex]) => {
      if (effFinish() !== 'goldtop' || request !== effFinish() + '|' + effTreatment()) return;
      const metalMap = buildGoldtopMetalMap(wearTex ? wearTex.image : null);
      const strength = GOLDTOP_METAL[effTreatment()] ?? 1;
      bodyMaterials.forEach((mat) => {
        if (mat.userData.origMetalMap && 'channel' in mat.userData.origMetalMap) metalMap.channel = mat.userData.origMetalMap.channel;
        mat.metalnessMap = metalMap;
        mat.metalness = strength;
        mat.needsUpdate = true;
      });
    })
    .catch((err) => console.warn('Goldtop metal map failed:', err));
}

function refreshBodyAppearance() {
  if (bodyMaterials.length === 0) return;
  const treatment = effTreatment();
  const roughness = (TREATMENT_ROUGHNESS[treatment] ?? FINISH_DEFAULT_ROUGHNESS) + (effFinish() === 'goldtop' ? GOLDTOP_EXTRA_ROUGHNESS : 0);
  applyBodySpecular(TREATMENT_SPECULAR[treatment] ?? 1);

  if (treatment && WEAR_MASKS[treatment]) {
    applyAgingOverlay(roughness);
    return;
  }

  if (effFinish()) {
    applyBodyTexture(TEXTURE_FINISHES[effFinish()], { metalness: 0.15, roughness });
  } else if (treatment) {
    bodyMaterials.forEach((mat) => {
      if (!('roughness' in mat)) return;
      if (instantBodyApply) mat.roughness = roughnessFactor(mat, roughness);
      else gsap.to(mat, { roughness: roughnessFactor(mat, roughness), duration: 0.5 });
    });
  }
}

function applyFinish(finish) {
  if (!TEXTURE_FINISHES[finish]) {
    console.warn('No texture mapped for finish:', finish);
    return;
  }
  refreshBodyAppearance();
}

function applyWoodGrade(grade) {
  const path = WOOD_GRADE_TEXTURES[grade];
  if (!path) {
    console.warn('No texture mapped for wood grade:', grade);
    return;
  }
  applyBodyTexture(path, { metalness: 0.02, roughness: WOOD_GRADE_ROUGHNESS });
}

const TREATMENT_ROUGHNESS = { gloss: 0.12, vos: 0.16, 'light-aged': 0.2, 'heavy-aged': 0.26, 'ultra-aged': 0.26 };

const TREATMENT_SPECULAR = { gloss: 1, vos: 0.55, 'light-aged': 0.38, 'heavy-aged': 0.25, 'ultra-aged': 0.25 };

const BACK_PLATES = {
  size: 1024,
  circle: { cx: 594, cy: 112, r: 34 },
  rect: [[671, 493], [672, 467], [681, 388], [687, 381], [693, 377], [704, 374], [762, 361],
    [773, 363], [778, 379], [771, 463], [769, 471], [765, 477], [754, 485], [696, 498], [679, 500]],
  grow: 3,
};
function tracePlates(ctx, scale = 1) {
  const c = BACK_PLATES.circle;
  ctx.moveTo((c.cx + c.r) * scale, c.cy * scale);
  ctx.arc(c.cx * scale, c.cy * scale, c.r * scale, 0, Math.PI * 2);
  BACK_PLATES.rect.forEach(([x, y], i) => {
    if (i === 0) ctx.moveTo(x * scale, y * scale);
    else ctx.lineTo(x * scale, y * scale);
  });
  ctx.closePath();
}
let plateSpecularTexture = null;
function getPlateSpecularMap() {
  if (plateSpecularTexture) return plateSpecularTexture;
  const S = BACK_PLATES.size;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, S, S);
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = '#000';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = BACK_PLATES.grow * 2;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  tracePlates(ctx, 1);
  ctx.fill();
  ctx.stroke();
  plateSpecularTexture = new THREE.CanvasTexture(canvas);
  plateSpecularTexture.flipY = false;
  return plateSpecularTexture;
}

function upgradeBodyMaterials(mesh) {
  const isBody = (m) => {
    const n = (m.name || '').toLowerCase();
    return n.startsWith('body') || n.startsWith('side') || n.startsWith('base');
  };
  const upgrade = (m) => {
    if ((m.name || '').toLowerCase().startsWith('string')) {
      m.color.setRGB(0.763, 0.8, 0.509, THREE.LinearSRGBColorSpace);
      m.metalness = 0.7176;
      m.roughness = 0.234;
      m.needsUpdate = true;
      return m;
    }
    if (!isBody(m) || m.isMeshPhysicalMaterial) return m;
    const phys = new THREE.MeshPhysicalMaterial();
    THREE.MeshStandardMaterial.prototype.copy.call(phys, m);
    phys.name = m.name;
    phys.specularIntensityMap = getPlateSpecularMap();
    return phys;
  };
  mesh.material = Array.isArray(mesh.material) ? mesh.material.map(upgrade) : upgrade(mesh.material);
}

let instantBodyApply = false;
let lastBodyApply = Promise.resolve();
function applyBodySpecular(level) {
  bodyMaterials.forEach((mat) => {
    if (!('specularIntensity' in mat)) return;
    if (instantBodyApply) mat.specularIntensity = level;
    else gsap.to(mat, { specularIntensity: level, duration: 0.5 });
  });
}

function applyTreatment(treatment) {
  refreshHardware();
  if (!(treatment in TREATMENT_ROUGHNESS) || bodyMaterials.length === 0) return;
  refreshBodyAppearance();
}

const HW_GOLD_OLD = [0.729, 0.656, 0.37];
const HW_GOLD = [0.96, 0.79, 0.47];
const HW_CHROME = [0.70, 0.72, 0.765];
const HW_NICKEL_MIX = 0.6;
const HW_TONES = {
  gold: HW_GOLD,
  chrome: HW_CHROME,
  nickel: HW_GOLD_OLD.map((g, i) => g * (1 - HW_NICKEL_MIX) + HW_CHROME[i] * HW_NICKEL_MIX),
};

const HARDWARE_SPECS = {
  gold: { metalness: 1, roughness: 0.25 },
  nickel: { metalness: 1, roughness: 0.3 },
  chrome: { metalness: 1, roughness: 0.08 },
};

const HW_AGING = {
  none: { dim: 1, scratches: 0, tarnish: 0, rough: 0 },
  'light-aged': { dim: 0.94, scratches: 140, tarnish: 3, rough: 0.12 },
  'heavy-aged': { dim: 0.86, scratches: 420, tarnish: 7, rough: 0.28 },
  'ultra-aged': { dim: 0.78, scratches: 900, tarnish: 12, rough: 0.5 },
};

function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KNOB_GAIN = 1.45;

function buildHardwareMap(srcMap, tone, age, selective = false, gain = 1) {
  const img = srcMap.image;
  const scale = Math.min(1, 2048 / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);

  if (tone || age.dim < 1) {
    const frame = ctx.getImageData(0, 0, w, h);
    const px = frame.data;
    const goldWeight = (r, g, b) => {
      const mx = Math.max(r, g, b);
      const sat = (mx - Math.min(r, g, b)) / Math.max(mx, 1);
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      return Math.min(1, Math.max(0, (sat - 0.12) / 0.15)) * Math.min(1, Math.max(0, (lum - 6) / 16));
    };
    let meanLum = 0;
    if (tone) {
      let sum = 0;
      let count = 0;
      for (let i = 0; i < px.length; i += 4) {
        const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
        const counts = selective ? goldWeight(px[i], px[i + 1], px[i + 2]) > 0.5 : lum > 64;
        if (counts) { sum += lum; count++; }
      }
      meanLum = count ? sum / count : 128;
    }
    for (let i = 0; i < px.length; i += 4) {
      if (tone) {
        const r = px[i];
        const g = px[i + 1];
        const b = px[i + 2];
        const k = ((0.299 * r + 0.587 * g + 0.114 * b) / meanLum) * gain;
        const w = selective ? goldWeight(r, g, b) : 1;
        px[i] = Math.min(255, (k * tone[0] * 255 * w + r * (1 - w)) * age.dim);
        px[i + 1] = Math.min(255, (k * tone[1] * 255 * w + g * (1 - w)) * age.dim);
        px[i + 2] = Math.min(255, (k * tone[2] * 255 * w + b * (1 - w)) * age.dim);
      } else {
        px[i] *= age.dim;
        px[i + 1] *= age.dim;
        px[i + 2] *= age.dim;
      }
    }
    ctx.putImageData(frame, 0, 0);
  }

  const area = (w * h) / (1024 * 1024);
  if (age.scratches > 0) {
    const rand = seededRandom(1234 + Math.round(age.scratches));
    for (let n = 0; n < age.tarnish * area; n++) {
      const x = rand() * w;
      const y = rand() * h;
      const r = (40 + rand() * 120) * Math.sqrt(area);
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
      const a = 0.08 + rand() * 0.1;
      grad.addColorStop(0, `rgba(45,32,14,${a})`);
      grad.addColorStop(1, 'rgba(45,32,14,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.lineCap = 'round';
    for (let n = 0; n < age.scratches * area; n++) {
      const x = rand() * w;
      const y = rand() * h;
      const ang = rand() * Math.PI;
      const len = (6 + rand() * 60) * Math.sqrt(area);
      ctx.lineWidth = 0.6 + rand() * 0.9;
      ctx.strokeStyle = rand() < 0.7
        ? `rgba(255,248,230,${0.15 + rand() * 0.2})`
        : `rgba(30,22,10,${0.25 + rand() * 0.25})`;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
      ctx.stroke();
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = false;
  tex.colorSpace = srcMap.colorSpace || THREE.SRGBColorSpace;
  tex.channel = srcMap.channel;
  tex.wrapS = srcMap.wrapS;
  tex.wrapT = srcMap.wrapT;
  tex.anisotropy = srcMap.anisotropy;
  return tex;
}

function currentHardwareAge() {
  return HW_AGING[state.treatment] || HW_AGING.none;
}

function styleHardwareMaterial(mat, toneName) {
  const hw = mat.userData.hw || (mat.userData.hw = {
    map: mat.map || null,
    color: mat.color ? mat.color.clone() : null,
    roughness: mat.roughness,
    cache: {},
  });
  const age = currentHardwareAge();
  const aged = age.scratches > 0 || age.dim < 1;
  const tone = toneName ? HW_TONES[toneName] : null;

  if (hw.map && hw.map.image && (tone || aged)) {
    const key = `${toneName || 'native'}|${aged ? state.treatment : 'new'}`;
    if (!hw.cache[key]) hw.cache[key] = buildHardwareMap(hw.map, tone, age, !!mat.userData.hwSelective, mat.userData.hwGain || 1);
    mat.map = hw.cache[key];
    mat.color.set('#ffffff');
  } else {
    mat.map = hw.map;
    if (hw.color) mat.color.copy(hw.color);
    if (tone && !hw.map) mat.color.setRGB(tone[0] * age.dim, tone[1] * age.dim, tone[2] * age.dim, THREE.SRGBColorSpace);
    else if (aged && hw.color) mat.color.multiplyScalar(age.dim);
  }
  mat.roughness = (toneName && mat.userData.hwPlating ? mat.userData.hwPlating.roughness : hw.roughness ?? 1) * (1 + age.rough);
  mat.needsUpdate = true;
}

let knobMaterials = [];
let knobFollowsPlating = true;
let vibratoMaterials = [];

function refreshHardware() {
  const plating = state.hardware || 'gold';
  const spec = HARDWARE_SPECS[plating];

  propMaterials.forEach((mat) => {
    mat.userData.hwPlating = spec;
    styleHardwareMaterial(mat, plating);
    mat.metalness = spec.metalness;
  });

  knobMaterials.forEach((mat) => {
    if (knobFollowsPlating) {
      const knobPlating = state.knobColor === 'silver' ? 'chrome' : 'gold';
      const knobSpec = HARDWARE_SPECS[knobPlating];
      mat.userData.hwPlating = knobSpec;
      styleHardwareMaterial(mat, knobPlating);
      mat.metalness = knobSpec.metalness;
    } else {
      styleHardwareMaterial(mat, null);
    }
  });

  vibratoMaterials.forEach((mat) => {
    styleHardwareMaterial(mat, state.vibrato === 'Chrome' ? 'chrome' : null);
  });
}

function applyHardware() {
  refreshHardware();
}

const LABELS = {
  guitar: 'Guitar',
  woodGrade: 'Top Wood Grade',
  neck: 'Neck Thickness',
  finish: 'Finish',
  treatment: 'Aging Level',
  hardware: 'Hardware Plating',
  knobStyle: 'Knob Style',
  knobColor: 'Knob Metal',
  vibrato: 'Vibrato',
  notes: 'Notes',
};

function updateSummary() {
  const summaryEl = document.getElementById('cs-summary');
  if (!summaryEl) return;
  summaryEl.innerHTML = '';
  Object.keys(LABELS).forEach((key) => {
    const value = state[key];
    if (!value) return;
    const row = document.createElement('div');
    const btn = document.querySelector(`[data-group="${key}"][data-value="${value}"]`);
    const shown = btn ? btn.textContent.trim() : key === 'guitar' ? (MODELS.find((m) => m.key === value)?.name || value) : value;
    row.innerHTML = `<dt>${LABELS[key]}</dt><dd>${shown}</dd>`;
    summaryEl.appendChild(row);
  });

  const submitBtn = document.querySelector('.cs-submit');
  const requiredComplete = ['guitar', 'neck', 'finish', 'treatment', 'hardware', 'knobStyle']
    .every((key) => state[key]);
  if (submitBtn) {
    submitBtn.disabled = !requiredComplete;
    submitBtn.style.opacity = requiredComplete ? '1' : '0.6';
    submitBtn.style.cursor = requiredComplete ? 'pointer' : 'not-allowed';
  }
}

showStep(1);
updateSummary();

const debugHud = document.createElement('div');
debugHud.style.cssText = `
  display: none;
  position: fixed;
  bottom: 20px;
  left: 20px;
  z-index: 999;
  background: rgba(0,0,0,0.85);
  color: #7CFC7C;
  font-family: 'Courier New', monospace;
  font-size: 12px;
  line-height: 1.6;
  padding: 14px 18px;
  border-radius: 8px;
  white-space: pre;
  pointer-events: none;
  border: 1px solid #333;
`;
document.body.appendChild(debugHud);

function updateDebugHud() {
  const p = camera.position;
  const t = orbitControls.target;
  debugHud.textContent =
    `DEBUG MODE -- step ${currentStep} -- orientation: ${orientation}\n` +
    `camPos:  [${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}]\n` +
    `lookAt:  [${t.x.toFixed(2)}, ${t.y.toFixed(2)}, ${t.z.toFixed(2)}]\n` +
    `fov:     ${camera.fov.toFixed(1)}\n\n` +
    `[D] exit debug mode   [C] copy region to clipboard`;
}

function enableDebugMode() {
  if (transformMode) disableTransformMode();

  debugMode = true;
  axesHelper.visible = true;
  debugHud.style.display = 'block';

  orbitControls = new OrbitControls(camera, renderer.domElement);
  orbitControls.target.copy(lookAtTarget);
  orbitControls.enableDamping = true;
  orbitControls.update();
}

function disableDebugMode() {
  debugMode = false;
  axesHelper.visible = false;
  debugHud.style.display = 'none';
  orbitControls?.dispose();
  orbitControls = null;
}

function copyRegionToClipboard() {
  if (!debugMode) return;
  const p = camera.position;
  const t = orbitControls.target;
  const snippet =
    `${currentStep}: { camPos: [${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}], ` +
    `lookAt: [${t.x.toFixed(2)}, ${t.y.toFixed(2)}, ${t.z.toFixed(2)}], fov: ${camera.fov.toFixed(1)} },`;

  navigator.clipboard?.writeText(snippet).then(() => {
    console.log('Copied to clipboard:', snippet);
  }).catch(() => {
    console.log('Clipboard copy failed -- here it is manually:', snippet);
  });
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'd' || e.key === 'D') {
    debugMode ? disableDebugMode() : enableDebugMode();
  }
  if ((e.key === 'c' || e.key === 'C') && debugMode) {
    copyRegionToClipboard();
  }
});

const transformHud = document.createElement('div');
transformHud.style.cssText = `
  display: none;
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 999;
  background: rgba(0,0,0,0.85);
  color: #7CD8FF;
  font-family: 'Courier New', monospace;
  font-size: 12px;
  line-height: 1.6;
  padding: 14px 18px;
  border-radius: 8px;
  white-space: pre;
  pointer-events: none;
  border: 1px solid #333;
`;
document.body.appendChild(transformHud);

const SPOT_KEYS = ['spot1', 'spot2', 'spot3'];
const isSpotKey = (key) => SPOT_KEYS.includes(key);
const fmt3 = (arr) => `[${arr.map((n) => n.toFixed(2)).join(', ')}]`;

function getTransformObject(key) {
  if (key === 'room') return showroomGroup;
  if (isSpotKey(key)) return studioSpots[SPOT_KEYS.indexOf(key)];
  return standGuitarGroups[key];
}
function getTransformKeys() {
  return [...Object.keys(standGuitarGroups), 'room', ...SPOT_KEYS];
}

function spotOffset(spot) {
  return [
    (spot.position.x - studioStandCenter.x) / studioStandD,
    (spot.position.y - studioStandCenter.y) / studioStandD,
    (spot.position.z - studioStandCenter.z) / studioStandD,
  ];
}

function refreshSpotIntensity(spot) {
  const dist = spot.position.distanceTo(spot.target.position);
  spot.userData.studioIntensity = STUDIO_SPOT_LUX * dist * dist;
  if (studioLightingOn && !(lightingTween && lightingTween.isActive())) {
    spot.intensity = spot.userData.studioIntensity;
  }
}

let spotMarkers = [];

function buildSpotMarkers() {
  const radius = Math.max(studioStandD * 0.04, 0.05);
  const markerMaterial = (extra = {}) => ({
    color: 0xffe9a8,
    toneMapped: false,
    depthTest: false,
    transparent: true,
    ...extra,
  });

  studioSpots.forEach((spot) => {
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 16, 12),
      new THREE.MeshBasicMaterial(markerMaterial())
    );
    sphere.renderOrder = 999;
    spot.add(sphere);

    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial(markerMaterial({ opacity: 0.6 }))
    );
    line.renderOrder = 999;
    line.frustumCulled = false;
    positionGroup.add(line);

    spotMarkers.push({ spot, sphere, line });
  });
  updateSpotMarkers();
}

function updateSpotMarkers() {
  spotMarkers.forEach(({ spot, line }) => {
    const pos = line.geometry.attributes.position;
    pos.setXYZ(0, spot.position.x, spot.position.y, spot.position.z);
    pos.setXYZ(1, spot.target.position.x, spot.target.position.y, spot.target.position.z);
    pos.needsUpdate = true;
  });
}

function removeSpotMarkers() {
  spotMarkers.forEach(({ spot, sphere, line }) => {
    spot.remove(sphere);
    sphere.geometry.dispose();
    sphere.material.dispose();
    positionGroup.remove(line);
    line.geometry.dispose();
    line.material.dispose();
  });
  spotMarkers = [];
}

function updateTransformHud() {
  const g = getTransformObject(transformTargetKey);
  if (!g) return;

  if (isSpotKey(transformTargetKey)) {
    transformHud.textContent =
      `TRANSFORM MODE -- target: ${transformTargetKey} (light)\n` +
      `mode: translate (lights only move)\n` +
      `offset:   ${fmt3(spotOffset(g))}  (x stand size, from stand center)\n` +
      `position: ${fmt3(g.position.toArray())}\n\n` +
      `[G] move   [L] next light   [[ ]] switch target\n` +
      `[C] copy all light offsets   [T] exit`;
    return;
  }

  transformHud.textContent =
    `TRANSFORM MODE -- target: ${transformTargetKey}\n` +
    `mode: ${transformControls.getMode()}\n` +
    `position: ${fmt3(g.position.toArray())}\n` +
    `rotation: ${fmt3([g.rotation.x, g.rotation.y, g.rotation.z])}\n\n` +
    `[G] move   [R] rotate   [L] lights   [[ ]] switch target\n` +
    `[C] copy   [T] exit`;
}

function onTransformChange() {
  if (isSpotKey(transformTargetKey)) {
    refreshSpotIntensity(getTransformObject(transformTargetKey));
    updateSpotMarkers();
  }
  updateTransformHud();
}

function attachTransformTarget(key) {
  transformTargetKey = key;
  const obj = getTransformObject(key);
  if (obj && transformControls) {
    transformControls.attach(obj);
    if (isSpotKey(key)) transformControls.setMode('translate');
  }
  updateTransformHud();
}

function enableTransformMode() {
  if (currentStep !== 1) return;
  if (debugMode) disableDebugMode();

  transformMode = true;
  transformHud.style.display = 'block';

  transformControls = new TransformControls(camera, renderer.domElement);
  transformControls.setMode('translate');
  transformControls.addEventListener('change', onTransformChange);

  const helper = transformControls.getHelper ? transformControls.getHelper() : transformControls;
  scene.add(helper);
  transformControls.__helper = helper;

  buildSpotMarkers();
  attachTransformTarget(MODELS[modelIndex]?.key || Object.keys(standGuitarGroups)[0]);
}

function disableTransformMode() {
  transformMode = false;
  transformHud.style.display = 'none';
  removeSpotMarkers();
  if (transformControls) {
    transformControls.detach();
    scene.remove(transformControls.__helper);
    transformControls.dispose();
    transformControls = null;
  }
}

function copyTransformToClipboard() {
  if (!transformMode) return;

  let snippet;
  if (isSpotKey(transformTargetKey)) {
    snippet =
      'const STUDIO_SPOT_OFFSETS = [\n' +
      studioSpots.map((spot) => `  ${fmt3(spotOffset(spot))},`).join('\n') +
      '\n];';
  } else {
    const g = getTransformObject(transformTargetKey);
    if (!g) return;
    snippet =
      `position: ${fmt3(g.position.toArray())}, ` +
      `rotation: ${fmt3([g.rotation.x, g.rotation.y, g.rotation.z])}`;
  }

  navigator.clipboard?.writeText(snippet).then(() => {
    console.log('Copied to clipboard:\n' + snippet);
  }).catch(() => {
    console.log('Clipboard copy failed -- here it is manually:\n' + snippet);
  });
}

window.addEventListener('keydown', (e) => {
  if (e.key === 't' || e.key === 'T') {
    transformMode ? disableTransformMode() : enableTransformMode();
    return;
  }
  if (!transformMode) return;

  if (e.key === 'g' || e.key === 'G') {
    transformControls.setMode('translate');
    updateTransformHud();
  }
  if (e.key === 'r' || e.key === 'R') {
    if (isSpotKey(transformTargetKey)) return;
    transformControls.setMode('rotate');
    updateTransformHud();
  }
  if (e.key === 'c' || e.key === 'C') {
    copyTransformToClipboard();
  }
  if (e.key === 'l' || e.key === 'L') {
    const i = SPOT_KEYS.indexOf(transformTargetKey);
    attachTransformTarget(SPOT_KEYS[(i + 1) % SPOT_KEYS.length]);
  }
  if (e.key === '[' || e.key === ']') {
    const keys = getTransformKeys();
    const idx = keys.indexOf(transformTargetKey);
    const nextIdx = e.key === '['
      ? (idx - 1 + keys.length) % keys.length
      : (idx + 1) % keys.length;
    attachTransformTarget(keys[nextIdx]);
  }
});

const SUBMIT_ENDPOINT = '';

const contactForm = document.getElementById('cs-contact-form');
if (contactForm) {
  const thanks = document.getElementById('cs-thanks');
  const submitBtn = contactForm.querySelector('.cs-form__submit');
  const rules = {
    name: (v) => v.trim().split(/\s+/).length >= 2 || 'Please enter your first and last name',
    email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) || 'Please enter a valid email address',
    phone: (v) => (v.replace(/\D/g, '').length >= 7 && /^[+\d\s().-]+$/.test(v.trim())) || 'Please enter a valid phone number',
    country: (v) => v.trim().length >= 2 || 'Please enter your country',
    city: (v) => v.trim().length >= 2 || 'Please enter your city',
  };
  const check = (input) => {
    const res = rules[input.name](input.value);
    const msg = res === true ? '' : res;
    const err = input.closest('.cs-field').querySelector('.cs-field__err');
    err.textContent = msg;
    input.closest('.cs-field').classList.toggle('has-error', !!msg);
    return !msg;
  };
  contactForm.querySelectorAll('input').forEach((input) => {
    input.addEventListener('blur', () => { if (input.value) check(input); });
    input.addEventListener('input', () => { if (input.closest('.cs-field').classList.contains('has-error')) check(input); });
  });

  contactForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const inputs = [...contactForm.querySelectorAll('input')];
    const ok = inputs.map(check).every(Boolean);
    if (!ok) { inputs.find((i) => i.closest('.cs-field').classList.contains('has-error'))?.focus(); return; }

    const data = Object.fromEntries(inputs.map((i) => [i.name, i.value.trim()]));
    const payload = { contact: data, build: { ...state }, submittedAt: new Date().toISOString() };
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';
    try {
      if (SUBMIT_ENDPOINT) {
        const res = await fetch(SUBMIT_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error('Request failed: ' + res.status);
      } else {
        console.info('Custom Shop request (no SUBMIT_ENDPOINT set, nothing sent):', payload);
      }
      thanks.querySelector('.cs-thanks__name').textContent = data.name.split(/\s+/)[0];
      thanks.querySelector('.cs-thanks__email').textContent = data.email;
      contactForm.hidden = true;
      requestSent = true;
      document.querySelector('.cs-panel[data-step="9"]').classList.add('is-sent');
      document.getElementById('cs-back').hidden = true;
      document.querySelector('.cs-panel[data-step="9"] .cs-panel__desc').hidden = true;
      thanks.hidden = false;
    } catch (err) {
      console.warn(err);
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit Request';
      const msg = contactForm.querySelector('.cs-form__fail');
      msg.hidden = false;
    }
  });
}

const ackBox = document.getElementById('cs-ack');
if (ackBox) {
  ackBox.addEventListener('change', () => {
    state.simulationAck = ackBox.checked;
    updateDots();
  });
}

const ackMore = document.getElementById('cs-ack-more');
if (ackMore) {
  ackMore.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    const t = ackMore.closest('.cs-ack').querySelector('.cs-ack__text');
    const open = t.classList.toggle('is-open');
    ackMore.textContent = open ? 'Less' : 'More';
  });
}

if (window.matchMedia('(pointer: coarse)').matches) {
  const tryLock = () => { try { screen.orientation?.lock?.('landscape').catch(() => {}); } catch (e) {  } };
  tryLock();
  window.addEventListener('pointerdown', tryLock, { once: true });
}

if (window.matchMedia('(pointer: coarse)').matches) {
  const sbar = document.createElement('div');
  sbar.id = 'cs-sbar';
  sbar.innerHTML = '<i></i>';
  document.body.appendChild(sbar);
  const thumb = sbar.firstChild;
  const updateSbar = () => {
    const p = document.querySelector('.cs-panel.is-active');
    if (!p || !isPhone() || p.scrollHeight <= p.clientHeight + 2) { sbar.classList.remove('is-on'); return; }
    const r = p.getBoundingClientRect();
    const inset = 14;
    const trackH = r.height - inset * 2;
    sbar.style.left = (r.right - 9) + 'px';
    sbar.style.top = (r.top + inset) + 'px';
    sbar.style.height = trackH + 'px';
    const th = Math.max(28, trackH * (p.clientHeight / p.scrollHeight));
    thumb.style.height = th + 'px';
    thumb.style.top = ((trackH - th) * (p.scrollTop / (p.scrollHeight - p.clientHeight))) + 'px';
    sbar.classList.add('is-on');
  };
  (function loop() { updateSbar(); requestAnimationFrame(loop); })();
}