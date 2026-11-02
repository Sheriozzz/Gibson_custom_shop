import './custom-shop-loader.js';
import './custom-shop-pick.js';
import './custom-shop-hints.js'; // sign loading screen -- keep this first
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { gsap } from 'gsap';

/* ============================================================
   GIBSON CUSTOM SHOP -- configurator (v4: hardware expansion)
   Category structure researched from live Gibson Custom Shop
   product pages -- see chat notes for the source breakdown.
   8 steps: Guitar, Body, Neck, Finish, Aging Level, Hardware
   (Plating + Knob Style + Vibrato), Notes, Review.
   Configuration and Top Figuring steps removed per request.
============================================================ */

const state = {
  guitar: null,
  woodGrade: 'plain',
  neck: 'medium',
  finish: 'black', // default finish
  treatment: 'gloss',
  hardware: 'gold',
  knobColor: 'gold', // metal of the Top Hat / Witch Hat knobs: 'gold' or 'silver'
  knobStyle: 'gold-th', // default: Gold Top Hat (same piece as step 6)
  vibrato: null, // null, 'Gold' or 'Chrome' (Bigsby)
  notes: '',
  simulationAck: false, // Your Build: "I understand this is a simulation" must be ticked to continue
};

let hasSelectedGuitar = false;
let vibratoApplied = null; // what the loaded vibrato currently is (null / 'Gold' / 'Chrome')
let currentStep = 0; // sentinel -- forces the first showStep(1) call to actually trigger enterStandMode()

// What the BODY should look like depends on the step, so scrolling back and
// forth can never leak a later choice into an earlier step:
//   step 1 (guitar pick): always the default Black gloss finish
//   steps 2-3 (body / neck): the raw wood (picked grade), no finish, no aging
//   step 4+ : the visitor's chosen finish and aging level
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

// declared here (not down in the DEV TOOL section further below)
// because animate() reads debugMode on every single frame, starting
// immediately -- a variable declared later in the file doesn't exist
// yet the first time animate() runs
let debugMode = false;
let orbitControls = null;

// same reasoning as debugMode above -- Transform Mode (press T) also
// needs to exist before animate()/pointer handlers first run
let transformMode = false;
let transformControls = null;
let transformTargetKey = null;

// stand mode starts idle (all guitars at rest) -- this flips true on
// the first click inside the step 1 panel, which is what actually
// presents the first guitar. See the click listener near the panel
// wiring below.
let hasPresentedInStandSession = false;
let floorTick = 0;
let s1Zoom = 1; // step 1 view: zoom / pan of the presented guitar only
const s1Pan = new THREE.Vector3();
let zoomAnchor = null; // fixed world point the wheel zooms about (cleared whenever the camera is re-framed)
const panVec = new THREE.Vector3(); // accumulated pan (world units), reset with every step move
let baseDist = 8; // camera-to-target distance of the current step's own framing; zoom limits are measured against it
let userZoom = 1; // wheel zoom; reset to 1 whenever a step's camera moves
let bgScaleCur = 1.4;
const bgEl = document.querySelector('.cs-bg');

// ---------- three.js scene ----------
const canvasRoot = document.getElementById('cs-canvas-root');

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0);
// Tone mapping: "Neutral" (Khronos PBR Neutral) keeps the model's colors
// close to what you see in Photoshop/Blender. The old ACES setting
// desaturated and brightened everything, which is what made the finishes
// look pale. Falls back to ACES on a three.js version without it.
renderer.toneMapping = THREE.NeutralToneMapping ?? THREE.ACESFilmicToneMapping;
const STANDARD_EXPOSURE = 1.0; // steps 2-8
const STUDIO_EXPOSURE = 1.3;   // step 1's studio spotlights (unchanged from before)
renderer.toneMappingExposure = STANDARD_EXPOSURE;
canvasRoot.appendChild(renderer.domElement);
renderer.domElement.classList.add('cursor-grab');
// if the browser drops the GL context while the tab is in the background, let
// it restore itself instead of forcing a page reload
renderer.domElement.addEventListener('webglcontextlost', (e) => e.preventDefault());
renderer.domElement.addEventListener('webglcontextrestored', () => { renderer.setSize(window.innerWidth, window.innerHeight); });

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);

// procedural environment lighting -- this is what was missing
// compared to Blender's viewport (the reflective sphere preview there
// IS an HDRI environment). Without this, materials only respond to
// the handful of specific lights below, which were tuned for a
// close-up guitar shot, not a whole room -- hence the flat, blown-out
// look on large surfaces like walls.
const pmremGenerator = new THREE.PMREMGenerator(renderer);
scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;

// Scales the two lights that face the guitar from the front (the main
// key light and the front point light) on every build step after step 1.
// Step 1 doesn't use this rig -- it has its own studio spotlights.
// 1 = the original brightness; lower = dimmer.
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

// ---------- group hierarchy ----------
// positionGroup: on-screen offset (translation only).
// orientationGroup: vertical/horizontal toggle -- its OWN rotation
// axis, separate from drag, so the two never fight each other.
// guitarGroup: drag rotation only (X/Y, clamped per step in animate()).
// gltf.scene: sits at local (0,0,0) inside guitarGroup.
// vertical "swipe" offset (steps 2+). Sits above positionGroup so it
// slides everything straight up/down on screen, regardless of the
// guitar's own offset or the Vertical/Horizontal orientation.
const slideGroup = new THREE.Group();
scene.add(slideGroup);

const positionGroup = new THREE.Group();
slideGroup.add(positionGroup);

const orientationGroup = new THREE.Group();
positionGroup.add(orientationGroup);

const guitarGroup = new THREE.Group();
orientationGroup.add(guitarGroup);

// modular pieces (steps 2-3, Body + Neck): loaded and swapped
// independently, both children of guitarGroup at the same time.
// Step 1 and steps 4+ use the single-mesh full guitar instead (see
// enterBodyOnlyMode/addNeckPiece/enterFullMode below) -- those steps need hardware/
// string materials the separate body/neck pieces don't have.
const bodyPieceGroup = new THREE.Group();
const neckPieceGroup = new THREE.Group();

// Hardware step (6): a base model (Knobless or CordlessKnobless
// depending on whether Vibrato is added) + a swappable knob piece +
// an optional vibrato piece. Same modular pattern as Body/Neck.
const hardwareBaseGroup = new THREE.Group();
const knobPieceGroup = new THREE.Group();
const vibratoPieceGroup = new THREE.Group();

// Step 1: the display stand (static) + whichever guitar is currently
// browsed, posed sitting on it. Completely separate group set from
// everything else -- entering/leaving any other mode does a full
// guitarGroup.clear(), so this never leaks into Body/Neck/Hardware/
// Full mode or vice versa. That IS the "step 2 disconnected from
// step 1" requirement -- it's structural, not just a label.
const standGroup = new THREE.Group();

// one group per guitar -- ALL load simultaneously and stay visible at
// once (sitting in the rack), rather than swapping which one shows.
// Selecting one in the switcher animates it forward (see
// presentGuitar()); the previous selection animates back to rest.
const standGuitarGroups = {
  'les-paul': new THREE.Group(),
  sg: new THREE.Group(),
  explorer: new THREE.Group(),
  sj: new THREE.Group(),
};
let standPresentedKey = null; // which guitar (if any) is currently pulled out

// spin-pivot groups: one per guitar, nested INSIDE standGuitarGroups.
// standGuitarGroups handles the rest<->presented position/rotation
// tween (GSAP, see presentGuitar). These spin groups handle the live
// 360° drag rotation instead -- kept as a SEPARATE object so the two
// never fight over the same .rotation property. The mesh gets
// recentered inside each one on load (see loadAllStandGuitars) so
// rotating it spins around the guitar's own center, not wherever it
// happens to sit in the rack.
const standSpinGroups = {};
Object.keys(standGuitarGroups).forEach((key) => {
  standSpinGroups[key] = new THREE.Group();
  standGuitarGroups[key].add(standSpinGroups[key]);
});

// studio room: child of positionGroup, so it gets the SAME position
// offset as the stand (GUITAR_OFFSETS) and stays aligned with it the
// way you set it up in Blender. It is deliberately NOT inside
// orientationGroup/guitarGroup, so the Vertical/Horizontal toggle and
// drag rotation never spin the room.
// Where the studio sits relative to the stand. Only the room uses this --
// the stand and the spotlights are untouched. Find the numbers with
// Transform Mode: press T on step 1, press [ or ] until the target says
// "room", drag it, press C, and paste the result here.
const SHOWROOM_TRANSFORM = { position: [0, 0, 0], rotation: [0, 0, 0] };

const showroomGroup = new THREE.Group();
showroomGroup.position.set(...SHOWROOM_TRANSFORM.position);
showroomGroup.rotation.set(...SHOWROOM_TRANSFORM.rotation);
positionGroup.add(showroomGroup);
let showroomMaterials = [];
let showroomLoaded = false;
let showroomOpacityTarget = 1; // what the room should currently be at, even if it hasn't finished loading yet
let showroomFadeTween = null;

/* ============================================================
   LIGHTING MODES
   'standard' = the guitar-tuned rig used on every step except 1.
   'studio'   = step 1 only: the global rig and the environment map
   are switched off, and three spotlights aimed at the stand light
   it while the rest of the room falls dark. (Three.js can't exclude
   the room from a light, so this swaps the whole setup per step.)
   Light counts stay constant -- only intensities change -- so
   switching modes never forces a shader recompile.
   Tune the constants below; I couldn't see the render when picking
   these starting values.
============================================================ */
const STUDIO_SPOT_LUX = 3.2;            // brightness each spot delivers at the stand
const STUDIO_SPOT_ANGLE = Math.PI / 6;  // cone half-angle (wider also lights the pulled-out guitar)
const STUDIO_SPOT_PENUMBRA = 0.8;       // 0 = hard edge, 1 = very soft falloff
const STUDIO_SPOT_COLOR = 0xfff1dc;
const STUDIO_AMBIENT = 6;               // faint fill so the room is dim, not pitch black (0 = black)

// spot positions as [x, y, z] multiples of the stand's size, relative to
// its center. The first two are the side pair (on the left in the step 1
// views); they were shifted +1.0 along X, the red axis, which points
// toward the camera. The third is the high overhead light in the middle.
const STUDIO_SPOT_OFFSETS = [
  [0.1, 1.5, 1.7],   // side light (was -0.9 on X)
  [1.9, 1.5, 1.7],   // side light (was  0.9 on X)
  [0.0, 2.0, -0.4],  // overhead, unchanged
];

const rigLights = [keyLight, fillLight, rimLight, frontLight, topSpot, sideFill, hemiLight, ambientLight];

// ---- overall light level (steps 2-8) ----
// One dial for "how bright is the lighting rig". Lower = truer, deeper
// colors; higher = brighter and paler. 0.62 / 0.7 keeps the form and
// highlights readable without washing the finish out.
const LIGHT_LEVEL = 0.62;  // scales every rig light
const ENV_LEVEL = 0.7;     // scales the room reflections/ambient
rigLights.forEach((l) => { l.intensity *= LIGHT_LEVEL; });
const rigBaseIntensity = new Map(rigLights.map((l) => [l, l.intensity]));
const defaultEnvironment = scene.environment;

// children of positionGroup (not scene), so they move with the stand's offset
const studioSpots = [0, 1, 2].map(() => {
  const spot = new THREE.SpotLight(STUDIO_SPOT_COLOR, 0, 0, STUDIO_SPOT_ANGLE, STUDIO_SPOT_PENUMBRA, 2);
  spot.userData.studioIntensity = 0;
  positionGroup.add(spot);
  positionGroup.add(spot.target);
  return spot;
});
let studioLightingOn = false;
// the stand's measured center and size, stored when the spots are placed;
// Transform Mode needs them to express a dragged light as an offset
const studioStandCenter = new THREE.Vector3();
let studioStandD = 3;
let lightingInitialized = false;
let lightingTween = null;

// environment strength is tweened through scene.environmentIntensity
// when this three.js version has it (r163+); older versions fall back
// to a plain swap of scene.environment
const hasEnvIntensity = 'environmentIntensity' in scene;
function setEnvironmentLevel(level) {
  if (hasEnvIntensity) {
    scene.environment = defaultEnvironment;
    scene.environmentIntensity = level * ENV_LEVEL;
  } else {
    scene.environment = level > 0.5 ? defaultEnvironment : null;
  }
}

// duration > 0 cross-fades the lights so the room never pops bright
// when it stays visible behind later steps. The very first call (page
// load) is always instant so the standard rig never flashes first.
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

// called once the stand has loaded, so spots are placed relative to
// its real measured size rather than guessed coordinates
function positionStudioSpots(center, size) {
  const d = Math.max(size.x, size.y, size.z) || 3;
  studioStandCenter.copy(center);
  studioStandD = d;
  const aim = center.clone();
  aim.y += size.y * 0.15; // guitars stand a bit taller than the rack itself

  studioSpots.forEach((spot, i) => {
    const [ox, oy, oz] = STUDIO_SPOT_OFFSETS[i];
    spot.position.set(center.x + ox * d, center.y + oy * d, center.z + oz * d);
    spot.target.position.copy(aim);
    const dist = spot.position.distanceTo(aim);
    // physical units: illuminance = intensity / distance^2
    spot.userData.studioIntensity = STUDIO_SPOT_LUX * dist * dist;
    if (studioLightingOn && !(lightingTween && lightingTween.isActive())) {
      spot.intensity = spot.userData.studioIntensity;
    }
  });
  console.log('Studio spots placed around stand -- center:', center.toArray().map((n) => +n.toFixed(2)), 'size:', size.toArray().map((n) => +n.toFixed(2)));
}

// DEV TOOL: colored axis gizmo (red=X, green=Y, blue=Z)
const axesHelper = new THREE.AxesHelper(3);
axesHelper.visible = false;
guitarGroup.add(axesHelper);

// which axis the vertical/horizontal toggle rotates on
const ORIENTATION_AXIS = 'z';

let bodyMaterials = [];
let originalColors = []; // captured on load so solid colors can revert cleanly
let originalMaps = [];   // same, for texture maps (sunburst/fade generate new maps)
let propMaterials = [];  // hardware (Prop material) -- gold/nickel/chrome target

// screen-position offset -- lives on positionGroup, immune to rotation
const GUITAR_OFFSETS = {
  vertical: { x: 1.5, y: -1.7 },
  horizontal: { x: 3.75, y: -0.10 },
};

function currentOffset() {
  return GUITAR_OFFSETS[orientation];
}

positionGroup.position.set(GUITAR_OFFSETS.vertical.x, GUITAR_OFFSETS.vertical.y, 0);

let orientation = 'vertical';

const STRING_GOLD = new THREE.Color('#d4af37');
const ENABLE_MATERIAL_OVERRIDES = true;

// The Base material carries a baked ambient-occlusion map (the red channel
// of the model's metallic/roughness texture) painted for the ORIGINAL BLACK
// guitar, with dark patches where the output jack and strap button recesses
// sit. Blender ignores that channel; Three.js applies it. On a black body
// the patches are invisible, but on a lighter finish they show as dark
// spots on the sides. 0 = AO off (spots gone), 1 = the baked AO at full
// strength. Raising it brings back soft shadows around pickups and knobs,
// and the spots return in proportion.
const BODY_AO_INTENSITY = 0;

// ---- finish shine ----
// The body's baked roughness map is only ~0.12 on the lacquered areas, and
// Three.js MULTIPLIES it by the roughness we set -- so a "0.3" finish was
// really ~0.036 and Gloss ~0.014: a near-perfect mirror, with VOS and the
// aged levels barely different from Gloss. softenBodyRoughness() lifts the
// map so the numbers below mean what they say: each is the roughness you
// actually SEE on the lacquered body (0 = mirror, 1 = fully matte).
const LACQUER_MAP_ROUGHNESS = 0.12;    // measured: the baked map's roughness on lacquered areas
const ROUGHNESS_MAP_GAIN = 4;          // lifts lacquer to ~0.48 in the map; fretboard/headstock stay rougher
const BODY_ROUGHNESS_SCALE = 1;        // MASTER DIAL: below 1 = shinier, above 1 = duller (affects every value below)
const FINISH_DEFAULT_ROUGHNESS = 0.12; // a finish is picked but no aging level yet
const WOOD_GRADE_ROUGHNESS = 0.7;      // raw unfinished wood (step 2)

// Lifts the baked roughness map (its green channel). Only the roughness map
// is replaced -- the AO and metalness data in the same texture are untouched.
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
    px[i + 1] = Math.min(255, px[i + 1] * ROUGHNESS_MAP_GAIN); // green = roughness
  }
  ctx.putImageData(frame, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = false; // same convention as every other texture in this file
  tex.channel = src.channel;
  tex.wrapS = src.wrapS;
  tex.wrapT = src.wrapT;

  mat.roughnessMap = tex;
  mat.userData.roughSoftened = true;
  mat.userData.roughBaseline = Math.min(1, LACQUER_MAP_ROUGHNESS * ROUGHNESS_MAP_GAIN);
}

// the roughness we WANT to see -> the value to put on the material
// (the shader multiplies it by the map's value at each spot)
function roughnessFactor(mat, wanted) {
  return (wanted * BODY_ROUGHNESS_SCALE) / (mat.userData.roughBaseline || 1);
}
const FORCE_STRING_GOLD = false; // off -- string color now comes from Blender

// ---------- model loading ----------
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/v1/decoders/');
const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(dracoLoader);
gltfLoader.setMeshoptDecoder(MeshoptDecoder); // the optimised .min.glb models are meshopt-compressed

const SHOWCASE_MODEL = '/models/gibson_lespaul3.min.glb';

// Step 1 now shows just the raw body (unpainted) so wood grade
// figuring is actually visible -- the full guitar model loads back
// in once the visitor moves past step 1, since it has the hardware/
// strings/etc. materials the rest of the flow needs.
const BODY_MODEL = '/models/gibson_lespaul_body.min.glb';

// CUSTOM_MODEL (Body/Side/Neck split) is parked for now -- the
// texture mismatch turned out to likely be a UV layout issue from
// that Blender split session, not a code bug. Sticking to the main
// model, which has the original UVs the textures were painted
// against. Revisit CUSTOM_MODEL once the UVs are confirmed intact.
// const CUSTOM_MODEL = '/models/gibson_lespaul_Custom.glb';

// NECK_MODELS (old whole-guitar swap) is deprecated -- Neck is now a
// separate piece, loaded alongside Body rather than replacing the
// whole guitar. See NECK_PIECE_MODELS below.
// const NECK_MODELS = {
//   default: SHOWCASE_MODEL,
//   thin: '/models/gibson_lespaul_neck-thin.glb',
//   medium: '/models/gibson_lespaul_neck-medium.glb',
//   thick: '/models/gibson_lespaul_neck-thick.glb',
// };

const NECK_PIECE_MODELS = {
  default: '/models/gibson_lespaul_NeckM.min.glb',
  thin: '/models/gibson_lespaul_NeckS.min.glb',
  medium: '/models/gibson_lespaul_NeckM.min.glb',
  thick: '/models/gibson_lespaul_NeckL.min.glb',
};

// Step 1: display stand + one guitar-on-stand model per option in
// MODELS above. Files are already posed sitting in the rack, sharing
// the stand's world coordinates -- loaded at identity transform, no
// scale/rotate override (see IDENTITY_TRANSFORM below).
const STAND_MODEL = '/models/gibson_stand.min.glb';

// background environment for step 1 -- parented under positionGroup so
// it shares the stand's position offset (it was aligned to the stand
// in Blender), but NOT under orientationGroup/guitarGroup, so rotation
// and the Vertical/Horizontal toggle never spin the room.
const SHOWROOM_MODEL = '/models/studio.min.glb';

// glTF light units convert badly from Blender, so lights embedded in
// the showroom file can come through far too bright. Flip to true to
// strip them and rely only on the JS light rig + environment map.
const STRIP_SHOWROOM_LIGHTS = false;
const STAND_GUITAR_MODELS = {
  'les-paul': '/models/gibson_lespaul_stand.min.glb',
  sg: '/models/gibson_sg_stand.min.glb',
  explorer: '/models/gibson_explorer_stand.min.glb',
  sj: '/models/gibson_sj_stand.min.glb',
};

// Hardware step: base model swaps depending on Vibrato on/off, knob
// is always a separate swappable piece, vibrato is added/removed on
// top of whichever base is active.
const KNOBLESS_BASE = '/models/gibson_lespaul_Knobless.min.glb';
const CORDLESS_KNOBLESS_BASE = '/models/gibson_lespaul_CordlessKnobless.min.glb';
const VIBRATO_MODEL = '/models/gibson_lespaul_Vibrato.min.glb';

const KNOB_MODELS = {
  default: '/models/gibson_lespaul_GoldTH.min.glb',
  'gold-th': '/models/gibson_lespaul_GoldTH.min.glb',
  'black-wh': '/models/gibson_lespaul_BlackWH.min.glb',
  speed: '/models/gibson_lespaul_SpeedKnob.min.glb',
};

function loadGuitarModel(path) {
  // cache-bust: re-exported .glb files keep the same filename, so the
  // browser has no signal the content changed and may serve a stale
  // cached copy. Harmless in dev.
  // in development always refetch; in production use a fixed version so visitors can cache the models (bump it when a model changes)
  const bustedPath = `${path}${path.includes('?') ? '&' : '?'}t=${import.meta.env.DEV ? Date.now() : 'v2'}`;

  gltfLoader.load(
    bustedPath,
    (gltf) => {
      guitarGroup.clear();
      guitarGroup.add(axesHelper); // re-add, guitarGroup.clear() removes everything
      bodyMaterials = [];
      originalColors = [];
      originalMaps = [];
      propMaterials = [];

      gltf.scene.scale.set(1.235, 1.235, 1.235);
      gltf.scene.position.set(0, 0, 0);
      gltf.scene.rotation.set(0, -Math.PI / 2 + THREE.MathUtils.degToRad(22), 0);

      guitarGroup.add(gltf.scene);

      gltf.scene.traverse((child) => {
        if (child.isMesh || child.isGroup) {
          console.log('Node found:', child.name || '(unnamed)', child.type);
        }

        if (child.isMesh && child.material) {
        upgradeBodyMaterials(child); // physical material so reflectivity can be dimmed
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach((m) => {
            console.log('  Material:', m.name || '(unnamed)');
            const nameLower = (m.name || '').toLowerCase();

            // startsWith, not === -- Blender appends .001/.002 etc. to
            // material names on collision (very common after
            // re-importing/duplicating work), which silently broke
            // this when it required an exact match
            if (nameLower.startsWith('body') || nameLower.startsWith('side') || nameLower.startsWith('base')) {
              bodyMaterials.push(m);
              softenBodyRoughness(m); // AO off + roughness lifted (see top of file)
              originalColors.push('color' in m ? m.color.clone() : null);
              originalMaps.push('map' in m ? m.map : null);
            }

            if (nameLower.startsWith('prop')) {
              propMaterials.push(m);
            }

            // FORCE_STRING_GOLD is off by default now -- you're setting
            // string color directly in Blender, so this no longer
            // overrides it. Flip the flag near the top of the file if
            // you ever want the old forced-gold behavior back.
            if (ENABLE_MATERIAL_OVERRIDES && FORCE_STRING_GOLD) {
              if (nameLower.includes('string') || nameLower.includes('wire')) {
                m.color.set(STRING_GOLD);
                m.metalness = 0.9;
                m.roughness = 0.25;
                console.log('    -> tinted as a string material');
              }
            }
          });
        }
      });

      if (ENABLE_MATERIAL_OVERRIDES) {
        if (effFinish()) applyFinish(effFinish());
        if (effTreatment()) applyTreatment(effTreatment());
        refreshHardware();
      }
    },
    undefined,
    (err) => {
      console.warn('Guitar model failed to load:', path, err);
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

// initial model load happens via showStep(1) at the bottom of this
// file, through the normal mode-switch system -- NOT here, since
// enterStandMode() needs MODELS (declared further down) and calling
// it this early would hit the same "used before declaration" issue
// we fixed once before for a different variable

/* ============================================================
   MODULAR PIECES -- Body (step 2) + Neck (step 3)
   Loaded independently into their own groups so either can be
   swapped without touching the other. Steps 4-8 use the Knobless
   hardware build (enterHardwareMode); SHOWCASE_MODEL is no longer used.
============================================================ */

function disposePiece(object3d) {
  object3d.traverse((child) => {
    if (child.isMesh) {
      child.geometry?.dispose();
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      // dispose the material itself, but NOT mat.map -- textures come
      // from the shared textureCache and are reused across loads
      mats.forEach((m) => {
        if (m?.userData?.roughSoftened) m.roughnessMap?.dispose?.(); // our canvas copy, not shared
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
      // onLoaded runs BEFORE group.add() -- this matters for stand
      // guitars, which need to measure gltf.scene's geometry in
      // isolation (no parent yet) to find its true center, uncontaminated
      // by the outer group chain's own position/rotation offsets
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
        upgradeBodyMaterials(child); // physical material so reflectivity can be dimmed
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach((m) => {
          console.log('  Body piece material:', m.name || '(unnamed)');
          const nameLower = (m.name || '').toLowerCase();
          if (nameLower.startsWith('body') || nameLower.startsWith('side') || nameLower.startsWith('base')) {
            bodyMaterials.push(m);
            softenBodyRoughness(m); // AO off + roughness lifted (see top of file)
            originalColors.push('color' in m ? m.color.clone() : null);
            originalMaps.push('map' in m ? m.map : null);
          }
        });
      }
    });

    // reapply whichever body appearance was already chosen -- Finish
    // takes priority if set (in case you navigated back from step 6+),
    // otherwise fall back to whatever Wood Grade was picked
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

// ---------- stand mode (step 1) ----------

// PLACEHOLDER -- same numbers applied to whichever guitar is selected,
// per this round's simplification. Tune via Transform Mode (press T),
// drag the gizmo on the presented guitar, press C to copy real values
// here once it looks right.
const PRESENTED_TRANSFORM = {
  position: [2.0, 0.8, 0], // slides out along X (orange axis) and lifts 0.8 on Y; rest is [0,0,0] so they return to the exact same spot
  rotation: [0, 0, 0],
};

function loadAllStandGuitars() {
  Object.entries(STAND_GUITAR_MODELS).forEach(([key, path]) => {
    loadPieceIntoGroup(standSpinGroups[key], path, (gltf) => {
      // recenter: gltf.scene has no parent yet at this point (see the
      // onLoaded-before-add reorder in loadPieceIntoGroup), so this
      // measures ONLY the mesh's own geometry, not contaminated by
      // any outer group's position/rotation.
      gltf.scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const center = box.getCenter(new THREE.Vector3());

      gltf.scene.position.sub(center); // shift mesh so its center sits at local origin
      standSpinGroups[key].position.copy(center); // compensate, so it visually stays in the same rack spot
      standSpinGroups[key].rotation.set(0, 0, 0); // fresh load always starts facing forward

      gltf.scene.traverse((child) => {
        if (child.isMesh || child.isGroup) {
          console.log(`Stand guitar node (${key}):`, child.name || '(unnamed)', child.type);
        }
      });

      if (key === 'les-paul') styleStandLesPaul(gltf.scene);
    }, IDENTITY_TRANSFORM);
  });
}

// The showcase guitars on the stand are their own models, separate from the
// build. The Les Paul gets the default look: Black finish + gold plating.
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

  // only the gold COLOR is swapped in; the model's own metalness/roughness
  // are kept so it reads under the studio lighting exactly like before
  // (forcing full metal there made the hardware go black)
  props.forEach((m) => styleHardwareMaterial(m, 'gold'));
}

// loads once and caches -- on later stand-mode entries, just resets
// visibility/opacity rather than re-fetching a static environment
function ensureShowroomLoaded() {
  if (showroomLoaded) {
    fadeShowroom(1, 0.8); // back up from the faint backdrop level
    return;
  }
  showroomLoaded = true;
  showroomOpacityTarget = 1;

  loadPieceIntoGroup(showroomGroup, SHOWROOM_MODEL, (gltf) => {
    showroomMaterials = [];

    // lights embedded in the .glb are imported as real scene lights
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
          m.transparent = true; // needed for the opacity fade to have any visible effect
          m.opacity = showroomOpacityTarget; // honors a fade requested before loading finished
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
  if (showroomMaterials.length === 0) return; // still loading -- the load callback applies the target
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
  // the room now STAYS while a guitar is picked (no fade here anymore)
  const wasPresented = !!standPresentedKey;

  // send every other guitar back to rest (not just the last one), and kill
  // any half-finished tween first, so quick switching can never leave one out
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

  // first pick of this visit: idle camera -> presented camera. Switching
  // between guitars afterwards keeps the camera where it is.
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
    // gltf.scene has no parent yet here, so this measures only the stand's own geometry
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
  hasPresentedInStandSession = false; // idle state -- nothing presents until the panel is actually clicked

  // Les Paul (index 0) pulls out by itself once the loading screen is gone
  runWhenLoaderDone(() => {
    if (currentStep !== 1 || standPresentedKey) return;
    hasPresentedInStandSession = true;
    presentGuitar(MODELS[modelIndex].key);
  });

  ensureShowroomLoaded(); // visible again on a fresh entry -- presentGuitar() fades it out once something's picked
}

function loadHardwareBase(path) {
  loadPieceIntoGroup(hardwareBaseGroup, path, (gltf) => {
    // Knobless/CordlessKnobless are full-guitar variants (minus
    // knobs), so re-collect body + prop materials fresh, same as the
    // main SHOWCASE_MODEL load -- otherwise Finish/Plating would have
    // nothing to target once this base is active.
    bodyMaterials = [];
    originalColors = [];
    originalMaps = [];
    propMaterials = [];

    gltf.scene.traverse((child) => {
      if (child.isMesh || child.isGroup) {
        console.log('Hardware base node:', child.name || '(unnamed)', child.type);
      }
      if (child.isMesh && child.material) {
        upgradeBodyMaterials(child); // physical material so reflectivity can be dimmed
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach((m) => {
          console.log('  Hardware base material:', m.name || '(unnamed)');
          const nameLower = (m.name || '').toLowerCase();
          if (nameLower.startsWith('body') || nameLower.startsWith('side') || nameLower.startsWith('base')) {
            bodyMaterials.push(m);
            softenBodyRoughness(m); // AO off + roughness lifted (see top of file)
            originalColors.push('color' in m ? m.color.clone() : null);
            originalMaps.push('map' in m ? m.map : null);
          }
          if (nameLower.startsWith('prop')) {
            propMaterials.push(m);
          }
        });
      }
    });

    // reapply everything already chosen, since this is a fresh model.
    // Done instantly and with the model hidden until the finish texture is
    // in, so swapping bases (e.g. toggling vibrato) can't flash the raw
    // texture or tween the sheen -- the body looks identical before/after.
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
    // Gold Top Hat and Black Witch Hat take the selected plating tone;
    // the Speed Knob keeps its own look (it only ages)
    knobFollowsPlating = path === KNOB_MODELS['gold-th'] || path === KNOB_MODELS['black-wh'];
    gltf.scene.traverse((child) => {
      if (child.isMesh || child.isGroup) {
        console.log('Knob piece node:', child.name || '(unnamed)', child.type);
      }
      // In the Gold Top Hat file, ONE knob (Prop.009) still carries a baked
      // ambient-occlusion map the other three don't have -- it renders that
      // knob visibly darker. Strip any AO map so all four knobs match.
      if (child.isMesh && child.material) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach((m) => {
          if (m.aoMap) {
            m.aoMap = null;
            m.needsUpdate = true;
          }
          // the knob metal = materials with a color texture; the translucent
          // inserts ('Alpha.*', 'Material.00x') have none and are left alone
          if (m.map) {
            m.userData.hwSelective = true; // only the gold-colored parts change tone
            m.userData.hwGain = path === KNOB_MODELS['gold-th'] ? KNOB_GAIN : 1; // Black Witch Hat is left exactly as before
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
    refreshHardware(); // Gold = native, Chrome = chrome tone, plus aging
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
  // finish: null (no vibrato), 'Gold' or 'Chrome'
  // swap the base model (Knobless <-> CordlessKnobless), keeping
  // whichever knob is already selected untouched
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
  // clear everything first -- if arriving from a "full mode" step
  // (1, or 4+), guitarGroup still has the whole-guitar model sitting
  // in it directly. Without this, pieces would get added ON TOP of
  // it instead of replacing it.
  guitarGroup.clear();
  guitarGroup.add(axesHelper); // clear() removes everything, re-add it
  guitarGroup.add(bodyPieceGroup);
  loadBodyPiece(BODY_MODEL);
  // neckPieceGroup is intentionally NOT attached here -- step 2 shows
  // body alone. It gets added in addNeckPiece() when reaching step 3.
}

function addNeckPiece() {
  if (!neckPieceGroup.parent) guitarGroup.add(neckPieceGroup);
  loadNeckPiece(NECK_PIECE_MODELS[state.neck] || NECK_PIECE_MODELS.default);
}

function removeNeckPiece() {
  if (neckPieceGroup.parent) guitarGroup.remove(neckPieceGroup);
}

function enterFullMode() {
  loadGuitarModel(SHOWCASE_MODEL);
}

// ---------- resize ----------
function resizeRenderer() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resizeRenderer);
resizeRenderer();

// ---------- drag controls ----------
// Standard 3D-viewer mapping (the same one OrbitControls uses): left mouse
// or one finger rotates, right mouse or Shift + left pans. Tuned here for a
// product turntable, like a doner on its rod -- it only TURNS around its
// vertical axis, never tilts, never sways, and is free to spin 360°+:
//   drag LEFT / RIGHT  -> spin the model
//   drag UP / DOWN     -> slide the model up/down (steps 2-8)
//   right-drag, or Shift + drag -> slide up/down in any direction
// A drag picks spin or slide from its first few pixels (direction lock),
// so a diagonal wobble never does both at once.
const SPIN_SPEED = 0.006;   // radians of spin per pixel dragged
const SLIDE_SPEED = 0.005;  // world units of slide per pixel dragged
const SLIDE_RANGE = 2.5;    // how far the model can slide up or down
const DRAG_LOCK_PX = 6;     // pixels of movement before a drag commits to spin or slide
const AUTO_SPIN_SPEED = 0;  // radians per frame; 0 = off. Try 0.004 for a slow constant turntable

let isDragging = false;
let dragMode = null; // 'rotate' | 'slide' | 'none' | null (still deciding)
let activePointerId = null;
let dragTravel = { x: 0, y: 0 };
let prevPointer = { x: 0, y: 0 };
let velocity = { x: 0, y: 0 }; // only .x is used now (spin momentum after letting go)

// wraps an angle into (-PI, PI] so a model spun through many turns
// returns to front-facing by the short way instead of unwinding every turn
function wrapAngle(a) {
  const twoPi = Math.PI * 2;
  return ((((a + Math.PI) % twoPi) + twoPi) % twoPi) - Math.PI;
}

// what a drag spins: the whole guitar on steps 2+; on step 1 only the
// pulled-out guitar (the stand and idle rack stay static); nothing at all
// if no guitar is pulled out yet
function getRotationTarget() {
  if (currentStep === 1) return standPresentedKey ? standSpinGroups[standPresentedKey] : null;
  return guitarGroup;
}

renderer.domElement.style.touchAction = 'none'; // stop the browser scrolling/zooming the page under a drag
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault()); // right-drag slides, no menu

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (debugMode || transformMode) return;
  if (e.button === 1) return; // middle button pans (see wheel section)
  if (isDragging) return; // ignore extra fingers/buttons while one drag is active
  isDragging = true;
  activePointerId = e.pointerId;
  prevPointer = { x: e.clientX, y: e.clientY };
  dragTravel = { x: 0, y: 0 };

  const canSlide = currentStep !== 1; // step 1 has nothing to slide
  const wantsSlide = e.button === 2 || e.shiftKey;
  if (wantsSlide) {
    dragMode = canSlide ? 'slide' : 'none';
  } else {
    dragMode = 'rotate'; // left-drag only rotates; sliding up/down is right-drag / Shift-drag
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
    dx = dragTravel.x; // the pixels spent deciding still count
    dy = dragTravel.y;
  }

  if (dragMode === 'rotate') {
    const target = getRotationTarget();
    if (!target) return;
    // upright guitar: a horizontal drag spins it. Lying on its side the
    // spin axis is horizontal, so a vertical drag rolls it instead.
    const spin = (orientation === 'horizontal' ? dy : dx) * SPIN_SPEED;
    target.rotation.y += spin; // the pointer moves the model directly, 1:1
    velocity.x = spin;         // remembered so it coasts after you let go
  } else if (dragMode === 'slide') {
    slideGroup.position.y = THREE.MathUtils.clamp(
      slideGroup.position.y - dy * SLIDE_SPEED,
      -SLIDE_RANGE,
      SLIDE_RANGE
    );
  }
});

// ---------- scripted camera per step ----------
// PLACEHOLDER COORDINATES -- guesses, not measured against the real
// model. Steps 1, 7, and 8 are "full guitar overview" moments -- FIXED
// camera, does not track GUITAR_OFFSET. Steps 2-7 zoom into specific
// physical parts and DO track it. Two full sets (vertical/horizontal)
// since a 90° turn moves where each part sits in space.
const OVERVIEW_CAM = { camPos: [0, 0.4, 7.8], lookAt: [0, -0.4, 0], fov: 34 };

// body-only model likely has different scale/bounds than the full
// guitar -- separate constant, starting from the same values as a
// reasonable guess, tune independently once you see it live
const BODY_OVERVIEW_CAM = { camPos: [0, 0.4, 7.8], lookAt: [0, -0.4, 0], fov: 34 };

const TRACKING_REGIONS_VERTICAL = {
  3: { camPos: [-0.9, 1.9, 3.2], lookAt: [-0.9, 1.9, 0], fov: 24 },   // neck
  4: { camPos: [0.1, 0.6, 2.0], lookAt: [0.1, 0.5, 0], fov: 22 },     // finish
  5: { camPos: [0.1, 0.5, 2.3], lookAt: [0.1, 0.4, 0], fov: 26 },     // aging level
  6: { camPos: [0.1, 0.1, 1.9], lookAt: [0.1, 0.05, 0], fov: 22 },    // hardware
};

const TRACKING_REGIONS_HORIZONTAL = {
  3: { camPos: [1.9, 0.3, 3.2], lookAt: [1.9, 0.3, 0], fov: 24 },
  4: { camPos: [0.6, -0.2, 2.0], lookAt: [0.6, -0.3, 0], fov: 22 },
  5: { camPos: [0.6, -0.3, 2.3], lookAt: [0.6, -0.4, 0], fov: 26 },
  6: { camPos: [0.1, -0.6, 1.9], lookAt: [0.1, -0.65, 0], fov: 22 },
};

// step 1 camera poses (captured with the debug tool): where the scene
// loads, and where the camera moves once a guitar is picked
const STAND_IDLE_CAM = { camPos: [13.99, 1.63, 3.89], lookAt: [0.94, -0.06, -0.21], fov: 34.0 };
const STAND_PRESENTED_CAM = { camPos: [7.69, 4.16, 9.37], lookAt: [1.08, -0.03, -0.30], fov: 34.0 };
// waypoint the camera swings through after Select, before zooming in to Body
const STAND_TO_BODY_VIA = { camPos: [12.01, 2.31, 5.30], lookAt: [0.86, -0.57, 0.59], fov: 34.0 };

// camera poses for steps 2-8 in the default (Vertical) orientation,
// captured with the debug tool. These are ABSOLUTE world-space poses, so
// unlike the older tracking regions below they get NO position offset
// added. (In Vertical orientation they replace the old step 2, 3-6 and
// 7-8 poses; Horizontal still uses those older ones.)
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

// absolute poses for steps 2-9 in Horizontal orientation (captured with the debug tool, no offset added)
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

// ---------- stage framing ----------
// The guitar always sits in the empty area to the right of the menu: the
// projection is shifted so the look-at point lands at the middle of that
// free area, which also makes the wheel zoom grow around that same point.
// The acoustic-tile backdrop is scaled from the live camera (distance and
// fov), around the same point, so it moves as one scene with the guitar.
const BG_REF = (() => {
  const d = new THREE.Vector3(...STAND_IDLE_CAM.camPos).distanceTo(new THREE.Vector3(...STAND_IDLE_CAM.lookAt));
  return d * Math.tan(THREE.MathUtils.degToRad(STAND_IDLE_CAM.fov / 2));
})();
let shiftCur = 0;
// phone held sideways (mobile only)
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
    // the camera poses were captured so the model sits at ~68% of the width (the middle of the free area next to the desktop menu);
    // the phone menu is narrower, so slide the picture to the middle of the area actually left free
    const target = (freeAreaCenterX() - w * 0.68) * 1; // px to move the picture right
    phoneShiftCur += (target - phoneShiftCur) * 0.18;
    camera.setViewOffset(w, window.innerHeight, -phoneShiftCur, 0, w, window.innerHeight);
  } else if (camera.view && camera.view.enabled) {
    camera.clearViewOffset();
  }

  if (bgEl) {
    const dist = camera.position.distanceTo(lookAtTarget);
    const cur = dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const apparent = (r) => new THREE.Vector3(...r.camPos).distanceTo(new THREE.Vector3(...r.lookAt)) * Math.tan(THREE.MathUtils.degToRad(r.fov / 2));
    let scale = 1.4 * Math.sqrt(BG_REF / cur); // steps 2-6 unchanged
    if (currentStep === 1) scale = 1.4; // the pick-a-guitar scene never zooms the backdrop
    if (currentStep >= 7) {
      // Notes / Review: tiles shrink in exact proportion to how much the
      // camera pulled back from step 6's framing
      const r6 = getRegionForStep(6);
      if (r6) scale = 1.4 * Math.sqrt(BG_REF / apparent(r6)) * (apparent(r6) / cur);
    }
    scale = THREE.MathUtils.clamp(scale, 0.35, 5);
    bgScaleCur += (scale - bgScaleCur) * 0.12;
    bgEl.style.setProperty('--bg-scale', bgScaleCur.toFixed(4));
    bgEl.style.setProperty('--bg-ox', (w / 2 + shiftCur).toFixed(1) + 'px');
  }
}

// ---------- render loop ----------
function animate() {
  requestAnimationFrame(animate);

  updateStageFraming();

  if (debugMode) {
    orbitControls.update();
    updateDebugHud();
    renderer.render(scene, camera);
    return;
  }

  // Pure turntable spin around the vertical axis -- like a doner on its
  // rod: it only turns. No tilt, no side-to-side sway, no limit on turns.
  const rotationTarget = getRotationTarget();
  if (rotationTarget) {
    if (isDragging && dragMode === 'rotate') {
      // the pointer is moving the model directly (see pointermove); just
      // bleed off stale momentum so pausing before letting go doesn't fling it
      velocity.x *= 0.8;
    } else {
      velocity.x *= 0.92; // coast to a stop after letting go
      rotationTarget.rotation.y += velocity.x + AUTO_SPIN_SPEED;
    }
    rotationTarget.rotation.x = 0; // never tilts
  } else {
    // nothing to spin on step 1 yet -- drop momentum so it can't carry
    // over onto a guitar pulled out later
    velocity.x = 0;
  }
  velocity.y = 0;

  camera.lookAt(lookAtTarget);
  enforceStage1Floor(); // every frame: nothing (zoom, pan, pull-out tween) can push the guitar through the floor
  renderer.render(scene, camera);
}
animate();

// ---------- step navigation (paged, not scroll-driven) ----------
const panels = document.querySelectorAll('.cs-panel');
const backBtn = document.getElementById('cs-back');

let pendingModeSwap = null;
let modeTL = null;
// fades a set of objects by scaling every material's opacity (materials keep their own base opacity)
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
let requestSent = false; // once the request is submitted, the thank-you screen is final
function showStep(stepNum) {
  if (currentStep === 9 && stepNum < 9 && requestSent) return; // after submitting there is no way back
  if (stepNum >= 9 && !state.simulationAck) {
    // the build must be acknowledged first
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
    guitarGroup.rotation.y = wrapAngle(guitarGroup.rotation.y); // short way home, not unwinding every turn
    gsap.to(guitarGroup.rotation, { x: 0, y: 0, duration: 0.8, ease: 'power2.out' });
    gsap.to(slideGroup.position, { y: 0, duration: 0.8, ease: 'power2.out' }); // each step's camera framing is tuned for an un-slid model
  }

  // model "modes": step 1 is the stand; step 2 shows the body piece
  // alone; step 3 adds the neck piece alongside it; steps 4-5 show the
  // full single-mesh guitar; steps 6, 7 and 8 all share the hardware
  // build, so the knob/vibrato/plating choices made on step 6 carry
  // through Notes and Review instead of reverting to the default
  // guitar. Handled here (not in individual button
  // handlers) so it's correct regardless of HOW the visitor
  // navigates -- dots and the scroll wheel can jump/skip steps
  // directly, bypassing any one button's own click handler.
  const modeForStep = (step) => {
    if (step === 1) return 'stand';
    if (step === 2) return 'body';
    if (step === 3) return 'body_neck';
    // steps 4-8 all share the Knobless build + knob piece, so the guitar
    // looks identical from Finish through Review
    return 'hardware';
  };
  const prevMode = modeForStep(previousStep);
  const nextMode = modeForStep(currentStep);

  // a swap still waiting from a fast previous click runs first, so mode
  // bookkeeping (which is derived from step numbers) can never go stale
  if (pendingModeSwap) { modeTL?.kill(); pendingModeSwap(); }

  const leavingStand = prevMode === 'stand' && nextMode !== 'stand' && previousStep !== 0;
  const doModeSwap = () => {
  if (prevMode !== nextMode) {
    if (prevMode === 'stand' && nextMode !== 'stand') {
      // the room fades fully out on leaving step 1 (fadeShowroom hides
      // it once it reaches 0). It lives outside guitarGroup, so
      // guitarGroup.clear() never touches it -- the fade is what removes it.
      if (transformMode) disableTransformMode();
      fadeShowroom(0, leavingStand ? 0.05 : 1.2);
      applyLightingMode('standard', 0.9); // cross-fade back to the guitar-tuned rig + environment map
    }

    if (nextMode === 'stand') {
      if (previousStep !== 0) window.csReplayLoader?.(); // the sign plays again while the pick-a-guitar scene reloads
      // always a fresh full clear+load, same as hardware -- this is
      // what makes step 1 fully disconnected from step 2 (Body) and
      // everything else
      enterStandMode();
    } else if (nextMode === 'body') {
      // if coming from body_neck (step 3 -> 2), body is already
      // loaded correctly -- just drop the neck. Otherwise (coming
      // from stand/full, e.g. step 1 or a direct dot-jump) load fresh.
      if (prevMode === 'body_neck') removeNeckPiece();
      else enterBodyOnlyMode();
    } else if (nextMode === 'body_neck') {
      // if coming from body (step 2 -> 3), body is already correct --
      // just add the neck. Otherwise (jumped in from stand/full mode
      // directly) need a fresh body load first, then the neck.
      if (prevMode === 'body') addNeckPiece();
      else {
        enterBodyOnlyMode();
        addNeckPiece();
      }
    } else if (nextMode === 'hardware') {
      // always a fresh full clear+load, regardless of where we came
      // from -- no partial-reuse shortcut here like body -> body_neck
      enterHardwareMode();
    }
  }
  };

  if (leavingStand) {
    // 1) the room, the stand and the other guitars fade away, leaving the chosen
    //    guitar as the last thing on screen; 2) it fades out too; 3) while hidden the
    //    body model is swapped in and the camera is set a little farther back;
    //    4) the body fades in as the camera eases in. Everything is opacity-only,
    //    so there is no frame where two scenes fight each other.
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
        const startPos = look.clone().add(end.clone().sub(look).multiplyScalar(1.18)); // start 18% farther back
        camera.position.copy(startPos);
        lookAtTarget.copy(look);
        camera.fov = r.fov;
        camera.updateProjectionMatrix();
        gsap.to(camera.position, { x: end.x, y: end.y, z: end.z, duration: 1.7, ease: 'power2.out' });
      }
      // the body is revealed from the top down: a soft-edged mask sweeps over the canvas
      const el = renderer.domElement;
      const rv = { p: 0 };
      const setMask = () => {
        const edge = 14; // % of softness
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
    // animate the menu's height from the previous panel to this one
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

// ---------- orientation toggle ----------
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

// ---------- step dots + up/down arrows ----------
const dots = document.querySelectorAll('.cs-dot');
const dotsUp = document.getElementById('cs-dots-up');
const dotsDown = document.getElementById('cs-dots-down');

// bottom nav inside each panel (steps 2-8): prev / 5 dots / next + "n/total".
// Step 1 has none -- you pick a guitar first, then the nav appears.
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
  document.querySelector('.cs-orient')?.classList.toggle('is-hidden', currentStep === 1); // only offered after a guitar is picked
  dots.forEach((d) => d.classList.toggle('is-active', Number(d.dataset.dot) === currentStep));
  document.body.dataset.step = String(currentStep); // CSS shows the right-hand rail on step 1 only

  // window of up to 5 dots around the current step
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

// ---------- wheel: zoom in/out on the guitar (no more step paging) ----------
const ZOOM_MIN_FACTOR = 0.6;  // closest (1 = the step's own framing)
const ZOOM_MAX_FACTOR = 1.25; // farthest

const PAN_LIMIT = 0.4; // how far the view can pan, as a fraction of the camera distance (a little extra past the edges)
function panCamera(dxPx, dyPx) {
  if (currentStep === 1) { stage1Pan(dxPx, dyPx); return; }
  const dist = camera.position.distanceTo(lookAtTarget);
  const perPx = (2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / window.innerHeight;
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
  const delta = right.multiplyScalar(-dxPx * perPx).addScaledVector(up, dyPx * perPx);
  // slight pan only, limited separately sideways and up/down
  const next = panVec.clone().add(delta);
  const visH = 2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const maxX = dist * PAN_LIMIT;
  // Finish / Aging / Hardware are close-ups of the body: keep most of it on screen
  const closeUp = currentStep >= 4 && currentStep <= 6;
  const maxY = closeUp ? visH * 0.26 : dist * PAN_LIMIT;
  // vertical guitar close-ups: the model may slide DOWN a long way (to bring the whole neck into view),
  // but only a little UP so the body can't leave the screen
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

// Step 1: the wheel / pinch / pan act on the presented guitar only; the room and the
// camera stay put (just like the later steps, where only the guitar is ever shown).
const S1_ZOOM_MIN = 0.75;
const S1_ZOOM_MAX = 1.3;
const S1_PAN_X = 0.8;  // world units, deliberately small
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

// Hard floor stop: the presented guitar can never sink below the real floor of the room.
let standFloorY = null;
const floorBox = new THREE.Box3();
const floorRay = new THREE.Raycaster();
const FLOOR_DOWN = new THREE.Vector3(0, -1, 0);
function findFloorY(spin) {
  // cast straight down onto the studio model, from just above the guitar's lowest point
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
      const bx = new THREE.Box3().setFromObject(standGroup); // fallback: the stand's feet
      if (bx.isEmpty()) return;
      standFloorY = bx.min.y;
      setTimeout(() => { standFloorY = null; }, 2000); // try the real floor again once the room has loaded
    }
  }
  const gap = standFloorY - floorBox.min.y;
  if (gap > 0) { holder.position.y += gap; holder.updateWorldMatrix(true, true); }
}

function zoomBy(step) {
  if (currentStep === 1) { stage1Zoom(step); enforceStage1Floor(); return; }
  // limits are absolute (relative to the step's framing), so they can't drift after orientation changes or re-framing
  const curDist = camera.position.distanceTo(lookAtTarget);
  const wanted = THREE.MathUtils.clamp(curDist * Math.exp(step), baseDist * ZOOM_MIN_FACTOR, baseDist * ZOOM_MAX_FACTOR);
  const ratio = wanted / curDist;
  if (Math.abs(ratio - 1) < 1e-6) return;
  // zoom about one fixed world point (the one at the middle of the empty
  // area right of the menu when zooming starts), so in/out is exactly
  // reversible and never drifts
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
    if (e.target.closest && e.target.closest('textarea, .cs-panel__scroll, .cs-panel')) return; // wheel over the menu only scrolls the menu, never the model
    // trackpad pinch arrives as ctrl+wheel: zoom the MODEL only, never the page
    if (e.ctrlKey) {
      e.preventDefault();
      zoomBy(e.deltaY * 0.01);
      return;
    }
    // mouse wheel zooms; a trackpad's two-finger scroll pans
    const isMouseWheel = e.deltaMode === 1 || (e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 50);
    if (!isMouseWheel) {
      panCamera(-e.deltaX, -e.deltaY); // same direction as the fingers
      return;
    }
    zoomBy(e.deltaY * 0.0012);
  },
  { passive: false }
);

// Safari reports a trackpad pinch as gesture events instead of ctrl+wheel
let gestureLast = 1;
window.addEventListener('gesturestart', (e) => { e.preventDefault(); gestureLast = 1; });
window.addEventListener('gesturechange', (e) => {
  e.preventDefault();
  if (e.target.closest && e.target.closest('.cs-panel')) return;
  zoomBy(-Math.log(e.scale / gestureLast));
  gestureLast = e.scale;
});
window.addEventListener('gestureend', (e) => e.preventDefault());

// middle mouse button drag pans too
let midPan = null;
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button !== 1 || debugMode) return;
  e.preventDefault();
  midPan = { id: e.pointerId, x: e.clientX, y: e.clientY };
  renderer.domElement.setPointerCapture?.(e.pointerId);
});
window.addEventListener('pointermove', (e) => {
  if (!midPan || e.pointerId !== midPan.id) return;
  panCamera(e.clientX - midPan.x, e.clientY - midPan.y); // the model follows the mouse
  midPan.x = e.clientX;
  midPan.y = e.clientY;
});
window.addEventListener('pointerup', (e) => { if (midPan && e.pointerId === midPan.id) midPan = null; });


// ---------- step 1: model switcher ----------
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

// idle-state entry: the first click anywhere inside the step 1 panel
// presents whichever guitar is currently selected (index 0, Les Paul,
// on a fresh stand-mode entry). Prev/next/search already call
// presentGuitar() explicitly themselves regardless of this flag, so
// this only matters for a FIRST click that isn't one of those.
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
  window.dispatchEvent(new Event('cs-guitar-selected')); // the navigation hint labels tuck away for good
  state.guitar = MODELS[modelIndex].key;
  hasSelectedGuitar = true;
  // model loading is handled by showStep() now (it detects entering
  // piece mode) -- no explicit load call needed here
  updateSummary();
  showStep(2);
});

const bodyContinueBtn = document.getElementById('cs-body-continue');
if (bodyContinueBtn) {
  bodyContinueBtn.addEventListener('click', () => {
    // steps 2->3 stay in piece mode (both Body and Neck use it), so
    // showStep(3) here does NOT trigger a reload -- correct, avoids
    // reloading the body piece unnecessarily
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

// description sits under its own button group: the hovered option, else the selected one
function showSectionDesc(options, hovered) {
  let el = options?.nextElementSibling;
  while (el && !el.classList.contains('cs-hover-desc')) el = el.nextElementSibling;
  if (!el) return;
  clearTimeout(el._t);
  const multi = !!options.closest('.cs-panel[data-step="6"]');

  // leaving a button waits a beat before reacting, so sliding the mouse
  // between buttons (or in and out of the section edge) never flickers
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

// slow cross-fade between two texts (never restarts mid-fade from a jump)
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

// the Gold / Silver tab hangs off whichever knob button is selected
function positionKnobTab() {
  const tab = document.querySelector('.cs-knobcolor');
  const sel = document.querySelector('[data-group="knobStyle"].is-selected');
  if (!tab || !sel || !sel.offsetWidth) return;
  const opts = sel.closest('.cs-options');
  if (isPhone()) {
    // phone: the selected knob button itself grows downward; the Gold | Silver options are attached under it
    // (the row reserves room for them, so nothing underneath is covered)
    if (tab.parentElement !== opts) opts.appendChild(tab);
    opts.style.position = 'relative';
    tab.classList.add('is-phone');
    const open = tab.classList.contains('is-open');
    opts.querySelectorAll('.cs-option').forEach((b) => { b.style.marginBottom = ''; b.classList.remove('has-tab'); });
    tab.style.marginLeft = '';
    if (open) {
      sel.classList.add('has-tab');
      tab.style.left = sel.offsetLeft + 'px';
      tab.style.top = (sel.offsetTop + sel.offsetHeight - 8) + 'px'; // tucks under the pill
      tab.style.width = sel.offsetWidth + 'px';
      sel.style.marginBottom = '30px';
    }
    return;
  }
  if (tab.classList.contains('is-phone')) { // back on a big screen: restore the desktop placement
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

// ---------- option buttons (all data-group pills/swatches) ----------
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
        if (prev && state.vibrato) loadVibratoPiece(VIBRATO_MODEL); // gold <-> chrome: same base, new piece
        else setVibrato(state.vibrato);                                            // on <-> off: swap base too
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

// ---------- step 7: notes ----------
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

/* ============================================================
   FINISH RENDERING
   Real baked textures now (from your Blender exports), replacing
   the procedural gradients -- each Image_2_X file IS the finish,
   loaded and applied directly as the material's map.
============================================================ */

const TEXTURE_FINISHES = {
  black: '/models/textures/Image_2_Black.png',
  'alpine-white': '/models/textures/Image_2_AlpineWhite.png',
  smokehouse: '/models/textures/Image_2_Smokehouse.png',
  olive: '/models/textures/Image_2_Olive.png',
  iguana: '/models/textures/Image_2_Iguana.png',
  goldtop: '/models/textures/Image_2_GoldTop.png', // metallic gold top (generated); see applyBodyMetal
  cobalt: '/models/textures/Image_2_Cobalt.png',
  'cardinal-red': '/models/textures/Image_2_CardinalRed.png',
  bourbon: '/models/textures/Image_2_Burbon.png',
};

// wood grade textures -- applied on step 1, to the body-only model
const WOOD_GRADE_TEXTURES = {
  plain: '/models/textures/Image_2_Plain.png',
  aa: '/models/textures/Image_2_AA.png',
  aaa: '/models/textures/Image_2_AAA.png',
  '5a': '/models/textures/Image_2_5A.png',
};

const textureLoader = new THREE.TextureLoader();
const textureCache = {};

function setTextureColorSpace(tex) {
  // guards against three.js version differences in the color-space API
  if ('colorSpace' in tex && THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  else if ('encoding' in tex && THREE.sRGBEncoding) tex.encoding = THREE.sRGBEncoding;
}

function loadFinishTexture(path) {
  if (textureCache[path]) return Promise.resolve(textureCache[path]);
  return new Promise((resolve, reject) => {
    textureLoader.load(
      path,
      (tex) => {
        // CRITICAL: glTF UVs use the opposite vertical convention from
        // the default image/canvas convention. GLTFLoader sets this
        // correctly on the model's own baked-in texture automatically,
        // but TextureLoader (used here, for externally loaded images)
        // defaults to true -- that mismatch is what caused the
        // fragmented/scrambled appearance, not a bad texture file.
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

// shared low-level applier: sets a plain texture with no overlay.
// Used directly by Wood Grade (raw wood never gets an aging overlay --
// aging is a lacquer/Finish concept, not a wood-grade preview thing)
// and as the "no overlay" fallback path for Finish.
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
      applyBodyMetal(); // metallic gold for Goldtop, normal lacquer otherwise
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

// ---------- aging wear overlay ----------
// A transparent-background PNG (wear patches painted with partial
// alpha, everywhere else alpha=0) composited ON TOP of whichever
// Finish texture is currently active -- drawn onto a canvas the same

const WEAR_MASKS = {
  'light-aged': '/models/textures/Murphy_Light.png',
  'heavy-aged': '/models/textures/Murphy_Heavy.png',
  'ultra-aged': '/models/textures/Murphy_Ultra.png',
};

function compositeWearOverlay(baseTex, maskTex, maskOpacity = 1) {
  // use the base texture's own dimensions -- forcing a fixed square
  // size would stretch/distort it if the real texture isn't square
  const width = baseTex.image?.width || 1024;
  const height = baseTex.image?.height || 1024;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(baseTex.image, 0, 0, width, height);
  ctx.globalAlpha = maskOpacity;
  ctx.drawImage(maskTex.image, 0, 0, width, height); // mask's own alpha channel does the blending
  ctx.globalAlpha = 1;

  // the black back plates are plastic covers, not lacquered wood -- they
  // don't wear. Put the original (unworn) texture back inside them.
  ctx.save();
  ctx.beginPath();
  tracePlates(ctx, width / BACK_PLATES.size);
  ctx.lineWidth = BACK_PLATES.grow * 2 * (width / BACK_PLATES.size);
  ctx.clip();
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(baseTex.image, 0, 0, width, height);
  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  // THIS was the scrambled-texture bug: a freshly created CanvasTexture
  // defaults to flipY=true, but glTF UVs use the opposite convention.
  // The individual loaded PNGs already had this fix; this newly
  // composited texture is a different object and needed it too.
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
        // a Finish is chosen -- composite the mask onto that texture,
        // same result applied to every body material
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
        // no Finish chosen yet -- composite the mask onto each
        // material's OWN original baked-in texture individually,
        // so Aging still shows something on the guitar's default look
        bodyMaterials.forEach((mat, i) => {
          const baseTex = originalMaps[i];
          if (!baseTex || !baseTex.image) return; // nothing to composite onto

          const composited = compositeWearOverlay(baseTex, maskTex);
          if ('channel' in baseTex) composited.channel = baseTex.channel;
          mat.map = composited;
          // preserve the material's own original color multiplier
          // (rather than forcing white) since we're layering onto its
          // native look, not a flat Finish swatch
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

// ---------- Goldtop: real metallic gold on the front ----------
// The body is normally non-metal lacquer (its baked metalness map is zero).
// Goldtop is a metallic-flake gold, so for that finish only, a mask
// (GoldTop_Mask.png, white = top face) is used as the metalness map. That
// makes just the front metallic -- the binding, back and sides stay as they are.
const GOLDTOP_MASK = '/models/textures/GoldTop_Mask.png';
const GOLDTOP_EXTRA_ROUGHNESS = 0.2; // metallic flake needs a softer sheen than clear lacquer
// how metallic the gold stays at each aging level (aging dulls it)
const GOLDTOP_METAL = { gloss: 1, vos: 0.92, 'light-aged': 0.8, 'heavy-aged': 0.65, 'ultra-aged': 0.5 };

let goldtopMaskImage = null;
function loadGoldtopMask() {
  if (goldtopMaskImage) return Promise.resolve(goldtopMaskImage);
  return new Promise((resolve, reject) => {
    textureLoader.load(GOLDTOP_MASK, (tex) => { goldtopMaskImage = tex.image; resolve(goldtopMaskImage); }, undefined, reject);
  });
}

// builds the metalness map: the mask, minus any worn-through patches
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
    // worn-through finish shows bare wood, not gold metal: paint the wear
    // mask's shape black on the metalness map
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
  return tex; // data texture: no color-space conversion
}

// switches the body between normal lacquer and metallic gold
function applyBodyMetal() {
  if (bodyMaterials.length === 0) return;
  const goldtop = effFinish() === 'goldtop';
  bodyMaterials.forEach((mat) => {
    if (mat.userData.origMetalMap === undefined) mat.userData.origMetalMap = mat.metalnessMap || null;
  });

  if (!goldtop) {
    bodyMaterials.forEach((mat) => {
      mat.metalnessMap = mat.userData.origMetalMap; // metalness value itself was just set by the caller
      mat.needsUpdate = true;
    });
    return;
  }

  const request = effFinish() + '|' + effTreatment();
  const wearPath = WEAR_MASKS[effTreatment()];
  Promise.all([loadGoldtopMask(), wearPath ? loadFinishTexture(wearPath) : Promise.resolve(null)])
    .then(([, wearTex]) => {
      if (effFinish() !== 'goldtop' || request !== effFinish() + '|' + effTreatment()) return; // outdated
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

// single source of truth for "what should the body look like right
// now" -- called by BOTH applyFinish and applyTreatment, so changing
// either one always produces the correct combined result (base color
// + wear overlay if the current Aging Level has one)
function refreshBodyAppearance() {
  if (bodyMaterials.length === 0) return;
  const treatment = effTreatment();
  const roughness = (TREATMENT_ROUGHNESS[treatment] ?? FINISH_DEFAULT_ROUGHNESS) + (effFinish() === 'goldtop' ? GOLDTOP_EXTRA_ROUGHNESS : 0);
  applyBodySpecular(TREATMENT_SPECULAR[treatment] ?? 1);

  if (treatment && WEAR_MASKS[treatment]) {
    // works with or without a chosen Finish -- applyAgingOverlay
    // handles both cases internally
    applyAgingOverlay(roughness);
    return;
  }

  if (effFinish()) {
    applyBodyTexture(TEXTURE_FINISHES[effFinish()], { metalness: 0.15, roughness });
  } else if (treatment) {
    // no Finish chosen, and this treatment has no wear overlay either --
    // just adjust roughness on whatever's currently on the model
    // (restores the original pre-overlay behavior for Gloss/VOS/etc.)
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
  applyBodyTexture(path, { metalness: 0.02, roughness: WOOD_GRADE_ROUGHNESS }); // raw unfinished wood, no lacquer sheen, no aging overlay
}

// ---------- aging level -> roughness (+ wear overlay for Heavy Aged) ----------
// the roughness you SEE on the lacquered body for each aging level
// (0 = mirror, 1 = fully matte); BODY_ROUGHNESS_SCALE scales them all
const TREATMENT_ROUGHNESS = { gloss: 0.12, vos: 0.16, 'light-aged': 0.2, 'heavy-aged': 0.26, 'ultra-aged': 0.26 }; // ultra = heavy

// How REFLECTIVE each level is (1 = full reflections, lower = dimmer).
// Gloss is the reference look (same as a finish with no aging level picked).
// Every step down is dimmer: the heavier the aging, the less lacquer shine.
// This is the material's specularIntensity, so it dims both the room
// reflections and the light highlights without changing the color.
const TREATMENT_SPECULAR = { gloss: 1, vos: 0.55, 'light-aged': 0.38, 'heavy-aged': 0.25, 'ultra-aged': 0.25 }; // ultra = heavy

// The body materials load as plain MeshStandardMaterial, which has a fixed
// reflectivity. Swapping them for the physical version (same maps, same
// settings) is what makes the dial above possible.
// The two black plastic back plates (control cavity cover and the round
// cover) are painted into the body texture, so they would reflect like
// lacquer. This mask, in texture pixels (1024 atlas), marks where they are;
// reflections are switched OFF there with a specular-intensity map.
// Coordinates were measured from the finish textures; if the texture layout
// ever changes, these are the numbers to update.
const BACK_PLATES = {
  size: 1024,
  circle: { cx: 594, cy: 112, r: 34 },
  rect: [[671, 493], [672, 467], [681, 388], [687, 381], [693, 377], [704, 374], [762, 361],
    [773, 363], [778, 379], [771, 463], [769, 471], [765, 477], [754, 485], [696, 498], [679, 500]],
  grow: 3, // px of extra margin so the plate edge and screws are fully covered
};
// adds both plate outlines to the current canvas path, scaled to the canvas size
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
  ctx.fillStyle = '#fff'; // alpha 1 = normal reflections
  ctx.fillRect(0, 0, S, S);
  ctx.globalCompositeOperation = 'destination-out'; // alpha 0 = no reflections
  ctx.fillStyle = '#000';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = BACK_PLATES.grow * 2;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  tracePlates(ctx, 1);
  ctx.fill();
  ctx.stroke();
  plateSpecularTexture = new THREE.CanvasTexture(canvas);
  plateSpecularTexture.flipY = false; // same convention as every other texture here
  return plateSpecularTexture;
}

function upgradeBodyMaterials(mesh) {
  const isBody = (m) => {
    const n = (m.name || '').toLowerCase();
    return n.startsWith('body') || n.startsWith('side') || n.startsWith('base');
  };
  const upgrade = (m) => {
    // the plain guitar's strings were unset white metal; match the darker
    // strings the vibrato build already has
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
    phys.specularIntensityMap = getPlateSpecularMap(); // no reflections on the back plates
    return phys;
  };
  mesh.material = Array.isArray(mesh.material) ? mesh.material.map(upgrade) : upgrade(mesh.material);
}

let instantBodyApply = false; // true while a freshly loaded model is being dressed -- no 0.5s tweens, so nothing visibly "shifts"
let lastBodyApply = Promise.resolve();
function applyBodySpecular(level) {
  bodyMaterials.forEach((mat) => {
    if (!('specularIntensity' in mat)) return;
    if (instantBodyApply) mat.specularIntensity = level;
    else gsap.to(mat, { specularIntensity: level, duration: 0.5 });
  });
}

function applyTreatment(treatment) {
  refreshHardware(); // hardware ages with the guitar
  if (!(treatment in TREATMENT_ROUGHNESS) || bodyMaterials.length === 0) return;
  refreshBodyAppearance();
  // Light Aged, Heavy Aged, and Ultra Aged all have real Murphy Lab
  // wear-mask textures now (WEAR_MASKS above). Gloss and VOS stay
  // roughness-only, matching reality -- neither has visible relic wear.
}

// ---------- hardware: plating tone + aging ----------
// Tones are sRGB. GOLD is measured from the Vibrato model's own gold, so
// plated hardware and the vibrato match. CHROME is that same tone with the
// color removed and a very slight blue added. NICKEL sits between the two
// (a faded gold leaning toward silver) -- raise NICKEL_MIX for more silver.
const HW_GOLD_OLD = [0.729, 0.656, 0.37]; // nickel keeps blending from this
const HW_GOLD = [0.96, 0.79, 0.47];          // lighter, warmer/orange plating gold
const HW_CHROME = [0.70, 0.72, 0.765];
const HW_NICKEL_MIX = 0.6;
const HW_TONES = {
  gold: HW_GOLD,
  chrome: HW_CHROME,
  nickel: HW_GOLD_OLD.map((g, i) => g * (1 - HW_NICKEL_MIX) + HW_CHROME[i] * HW_NICKEL_MIX),
};

// metalness/roughness the plating sets on the guitar's own hardware
const HARDWARE_SPECS = {
  gold: { metalness: 1, roughness: 0.25 },
  nickel: { metalness: 1, roughness: 0.3 },
  chrome: { metalness: 1, roughness: 0.08 },
};

// How the hardware wears per aging level. dim = color multiplier (1 = new),
// scratches = fine marks per 1024x1024 of texture, tarnish = soft dull
// patches, rough = extra roughness (0.2 = 20% rougher). Gloss and VOS are new.
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

// Builds a hardware texture: optionally re-toned (the original texture's
// light/dark detail is kept, its color replaced by the tone), dimmed, and
// marked with scratches and tarnish for the given aging level.
// the knob textures are darker than the bridge/tailpiece atlas, so their gold
// is lifted by this much to read as the same plating
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
    // selective mode (knobs): only the GOLD-colored pixels are re-toned --
    // black and grey parts keep their own color. weight 1 = clearly gold,
    // 0 = black/grey, in between = soft edge.
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
        const counts = selective ? goldWeight(px[i], px[i + 1], px[i + 2]) > 0.5 : lum > 64; // skip dark/unused atlas areas
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
    // soft dull/tarnished patches
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
    // fine scratches: most catch the light, some are dark
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
  tex.flipY = false; // same convention as every other texture in this file
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

// Re-tones and ages one hardware material. toneName = 'gold' | 'nickel' |
// 'chrome', or null to keep the model's own color (black knobs, the gold
// vibrato) and only age it. The original map is kept so this is reversible.
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

// the pieces that make up the "hardware" and how each is toned
let knobMaterials = [];
let knobFollowsPlating = true; // Gold Top Hat / Black Witch Hat match the plating; Speed Knob keeps its own color
let vibratoMaterials = [];

function refreshHardware() {
  const plating = state.hardware || 'gold';
  const spec = HARDWARE_SPECS[plating];

  // the guitar's own hardware: bridge, tailpiece, pickup covers, tuners...
  propMaterials.forEach((mat) => {
    mat.userData.hwPlating = spec;
    styleHardwareMaterial(mat, plating);
    mat.metalness = spec.metalness;
  });

  // knobs: Gold Top Hat and Black Witch Hat match the plating (same tone
  // and metal finish as the bridge and tailpiece); Speed Knob keeps its own
  knobMaterials.forEach((mat) => {
    if (knobFollowsPlating) {
      // knob metal has its own Gold / Silver choice, separate from the plating
      const knobPlating = state.knobColor === 'silver' ? 'chrome' : 'gold';
      const knobSpec = HARDWARE_SPECS[knobPlating];
      mat.userData.hwPlating = knobSpec;
      styleHardwareMaterial(mat, knobPlating);
      mat.metalness = knobSpec.metalness;
    } else {
      styleHardwareMaterial(mat, null);
    }
  });

  // vibrato: Gold is the model's own gold, Chrome is the chrome tone
  vibratoMaterials.forEach((mat) => {
    styleHardwareMaterial(mat, state.vibrato === 'Chrome' ? 'chrome' : null);
  });
}

function applyHardware() {
  refreshHardware();
}

// ---------- summary ----------
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
    // show the button's own wording (e.g. "Top Hat") instead of the raw value
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

/* ============================================================
   DEV TOOL -- debug mode for finding real camera coordinates.
   Press D to toggle, C to copy the current camera as a
   FOCUS_REGIONS-shaped snippet to your clipboard.
============================================================ */

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
  if (transformMode) disableTransformMode(); // mutually exclusive with Transform Mode

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

/* ============================================================
   TRANSFORM MODE (step 1 only) -- press T to toggle. Attaches a
   drag gizmo to one of the stand guitars, the studio room, or one
   of the three studio spotlights, so you can position it live in
   the real scene (real camera, real lighting, real stand) instead
   of guessing coordinates. Press C to copy the numbers.

   Controls while active:
     G = move (translate) mode
     R = rotate mode (guitars and room only -- a spotlight has no
         useful rotation, it always aims at the stand)
     [ / ] = cycle the gizmo through guitars, room, and lights
     L = jump to the lights (press again for the next light)
     C = copy to clipboard. For a light this copies the WHOLE
         STUDIO_SPOT_OFFSETS array, ready to paste over the old one
     T = exit Transform Mode

   While it's on, each light shows a small glowing marker and a line
   to the point it aims at, so you can see where it is and which way
   it points. A light's brightness is held constant while you drag.
============================================================ */

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

// targets: the four stand guitars, the studio room, the three lights
function getTransformObject(key) {
  if (key === 'room') return showroomGroup;
  if (isSpotKey(key)) return studioSpots[SPOT_KEYS.indexOf(key)];
  return standGuitarGroups[key];
}
function getTransformKeys() {
  return [...Object.keys(standGuitarGroups), 'room', ...SPOT_KEYS];
}

// a light's position written the way STUDIO_SPOT_OFFSETS stores it:
// multiples of the stand's size, relative to the stand's center
function spotOffset(spot) {
  return [
    (spot.position.x - studioStandCenter.x) / studioStandD,
    (spot.position.y - studioStandCenter.y) / studioStandD,
    (spot.position.z - studioStandCenter.z) / studioStandD,
  ];
}

// keep a light's brightness constant as it moves: physical spotlights
// get dimmer with distance, so intensity is rescaled to hold the same
// illuminance at the stand -- you judge placement, not a side effect
function refreshSpotIntensity(spot) {
  const dist = spot.position.distanceTo(spot.target.position);
  spot.userData.studioIntensity = STUDIO_SPOT_LUX * dist * dist;
  if (studioLightingOn && !(lightingTween && lightingTween.isActive())) {
    spot.intensity = spot.userData.studioIntensity;
  }
}

// ---- visible markers for the (otherwise invisible) lights ----
let spotMarkers = [];

function buildSpotMarkers() {
  const radius = Math.max(studioStandD * 0.04, 0.05);
  const markerMaterial = (extra = {}) => ({
    color: 0xffe9a8,
    toneMapped: false,
    depthTest: false, // always visible, even inside walls
    transparent: true,
    ...extra,
  });

  studioSpots.forEach((spot) => {
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 16, 12),
      new THREE.MeshBasicMaterial(markerMaterial())
    );
    sphere.renderOrder = 999;
    spot.add(sphere); // follows the light as the gizmo moves it

    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial(markerMaterial({ opacity: 0.6 }))
    );
    line.renderOrder = 999;
    line.frustumCulled = false;
    positionGroup.add(line); // same space the lights live in

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
    // lights have no useful rotation (they always aim at the stand)
    if (isSpotKey(key)) transformControls.setMode('translate');
  }
  updateTransformHud();
}

function enableTransformMode() {
  if (currentStep !== 1) return; // stand guitars, room and lights only exist in step 1
  if (debugMode) disableDebugMode(); // mutually exclusive with camera debug mode

  transformMode = true;
  transformHud.style.display = 'block';

  transformControls = new TransformControls(camera, renderer.domElement);
  transformControls.setMode('translate');
  transformControls.addEventListener('change', onTransformChange);

  // three.js version differences: newer versions want the gizmo added
  // via getHelper(), older versions add the controls object directly
  const helper = transformControls.getHelper ? transformControls.getHelper() : transformControls;
  scene.add(helper);
  transformControls.__helper = helper; // stash for cleanup on disable

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
    // all three lights at once, formatted to paste over STUDIO_SPOT_OFFSETS
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
    if (isSpotKey(transformTargetKey)) return; // lights only move
    transformControls.setMode('rotate');
    updateTransformHud();
  }
  if (e.key === 'c' || e.key === 'C') {
    copyTransformToClipboard();
  }
  if (e.key === 'l' || e.key === 'L') {
    // from any non-light target this lands on spot1, then steps through them
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


// ---------- step 9: contact details + submit ----------
// Set this to your form service (Formspree, Netlify Forms, your own API...). It receives
// a JSON POST with the contact details and the full build. Left empty, the request is only
// logged in the console and the thank-you message still shows.
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
    const ok = inputs.map(check).every(Boolean); // run every check so all errors show
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


// ---------- Your Build: simulation acknowledgement ----------
const ackBox = document.getElementById('cs-ack');
if (ackBox) {
  ackBox.addEventListener('change', () => {
    state.simulationAck = ackBox.checked;
    updateDots(); // enables / disables the arrow to the next step
  });
}

// "More / Less" on the disclaimer (does not tick the box)
const ackMore = document.getElementById('cs-ack-more');
if (ackMore) {
  ackMore.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    const t = ackMore.closest('.cs-ack').querySelector('.cs-ack__text');
    const open = t.classList.toggle('is-open');
    ackMore.textContent = open ? 'Less' : 'More';
  });
}


// ---------- mobile: ask for landscape (the rotate screen in the HTML is the fallback) ----------
if (window.matchMedia('(pointer: coarse)').matches) {
  const tryLock = () => { try { screen.orientation?.lock?.('landscape').catch(() => {}); } catch (e) { /* not supported */ } };
  tryLock();
  window.addEventListener('pointerdown', tryLock, { once: true });
}


// ---------- phones: scroll cue for a menu taller than the screen ----------
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
    const inset = 14; // keep clear of the rounded corners
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