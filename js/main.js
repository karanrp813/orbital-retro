// Orbital Retro — bootstrap, mode state, render loop, picking, target lock.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createAsteroidField, createEnvironment } from './asteroidField.js';
import { createSystemMap, createNeoMoon } from './systemMap.js';
import { createRadar } from './radar.js';
import { createLabelLayer } from './labels.js';
import { createStore } from './state.js';
import { hud } from './hud.js';

const container = document.getElementById('scene-container');
const brackets = document.getElementById('lock-brackets');

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
} catch (err) {
  hud.fatal('WEBGL UNAVAILABLE // TERMINAL INCOMPATIBLE');
  throw err;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

const camera = new THREE.PerspectiveCamera(
  55,
  window.innerWidth / window.innerHeight,
  0.1,
  2000
);
camera.position.set(0, 70, 160);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 40;
controls.maxDistance = 600;

// Bloom at threshold 0 blooms every lit pixel — the phosphor look.
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.85,
  0.5,
  0.0
);
composer.addPass(bloom);
composer.addPass(new OutputPass());

const store = createStore({ mode: 'neo' });
const labels = createLabelLayer();
const env = createEnvironment(scene);

let field = null;
let radar = null;
let systemMap = null;
let moon = null;
let selected = -1;
let mode = 'neo';
let neoStatusLine = '';
const tmpVec = new THREE.Vector3();

// Each mode keeps its own camera framing; switching restores it.
const camState = {
  neo: { pos: new THREE.Vector3(0, 70, 160), target: new THREE.Vector3() },
  system: { pos: new THREE.Vector3(0, 150, 260), target: new THREE.Vector3() },
};

hud.loading();
Promise.all([
  fetch('./data/neo_feed.json').then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }),
  // Ephemeris is an enhancement — degrade to NEO-only if it's missing.
  fetch('./data/ephemeris.json').then((r) => (r.ok ? r.json() : null)).catch(() => null),
])
  .then(([neoData, eph]) => {
    field = createAsteroidField(neoData);
    scene.add(field.points);
    radar = createRadar({
      canvas: document.getElementById('radar-canvas'),
      field,
      data: neoData,
      onSelect: selectIndex,
    });

    if (eph) {
      systemMap = createSystemMap(scene, eph);
      for (const b of systemMap.bodies) {
        const color =
          b.name === 'sun' ? 'var(--c-red)' : b.name === 'earth' ? 'var(--c-cyan)' : 'var(--c-green)';
        labels.add(b.name, b.label, color);
      }
      moon = createNeoMoon(env.neoGroup, eph, neoData);
      if (moon) labels.add('luna', moon.label, 'var(--c-cyan)');
      document.getElementById('tab-system').disabled = false;
    }

    neoStatusLine = `TRACKING ${neoData.count} OBJECTS > ${neoData.min_diameter_m}M // WINDOW ${neoData.window_start} - ${neoData.window_end}`;
    hud.init(neoData);

    // Debug/deep-links: ?lock=N pre-selects a contact, ?mode=system opens the map.
    const params = new URLSearchParams(location.search);
    const lock = params.get('lock');
    if (lock !== null) selectIndex(Math.min(parseInt(lock, 10) || 0, field.count - 1));
    if (params.get('mode') === 'system' && systemMap) store.set({ mode: 'system' });
  })
  .catch((err) => hud.fatal(`DATA LINK FAILURE // ${err.message}`));

document.getElementById('tab-neo').addEventListener('click', () => store.set({ mode: 'neo' }));
document.getElementById('tab-system').addEventListener('click', () => store.set({ mode: 'system' }));
document.getElementById('tab-launches').addEventListener('click', () => {
  location.href = './launches.html';
});

store.subscribe((s) => {
  if (s.mode === mode) return;
  camState[mode].pos.copy(camera.position);
  camState[mode].target.copy(controls.target);
  mode = s.mode;
  const neo = mode === 'neo';

  if (field) field.points.visible = neo;
  env.neoGroup.visible = neo;
  if (systemMap) systemMap.group.visible = !neo;
  document.getElementById('radar-panel').classList.toggle('hidden', !neo);
  document.getElementById('tab-neo').classList.toggle('active', neo);
  document.getElementById('tab-system').classList.toggle('active', !neo);
  labels.hideAll();

  if (neo) {
    if (selected >= 0 && field) {
      hud.showTarget(field.objects[selected]);
      brackets.classList.remove('hidden');
    }
    if (neoStatusLine) hud.status(neoStatusLine);
  } else {
    hud.clearTarget();
    brackets.classList.add('hidden');
    if (systemMap) {
      hud.status(`HELIOCENTRIC PLOT // ${systemMap.bodies.length} BODIES // LOG-COMPRESSED RADII`);
    }
  }

  camera.position.copy(camState[mode].pos);
  controls.target.copy(camState[mode].target);
  controls.maxDistance = neo ? 600 : 900;
});

function selectIndex(i) {
  selected = i;
  if (radar) radar.setSelected(i);
  if (i >= 0 && field) {
    const obj = field.objects[i];
    hud.showTarget(obj);
    brackets.style.color = obj.is_hazardous ? 'var(--c-red)' : 'var(--c-green)';
    brackets.classList.remove('hidden');
  } else {
    hud.clearTarget();
    brackets.classList.add('hidden');
  }
}

function worldToScreen(v) {
  tmpVec.copy(v).project(camera);
  if (tmpVec.z > 1) return null;
  return [
    (tmpVec.x * 0.5 + 0.5) * window.innerWidth,
    (-tmpVec.y * 0.5 + 0.5) * window.innerHeight,
  ];
}

// ---- Picking: shader-driven positions, so we project CPU-side copies
// of the orbit math instead of raycasting against stale geometry. ----

const PICK_RADIUS_PX = 18;
let downX = 0;
let downY = 0;

renderer.domElement.addEventListener('pointerdown', (e) => {
  downX = e.clientX;
  downY = e.clientY;
});

renderer.domElement.addEventListener('pointerup', (e) => {
  // Ignore orbit drags; picking is NEO-mode only.
  if (mode !== 'neo' || !field) return;
  if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) return;

  const t = clock.elapsedTime;
  let best = -1;
  let bestDist = PICK_RADIUS_PX;
  for (let i = 0; i < field.count; i++) {
    const screen = worldToScreen(field.getPosition(i, t, tmpVec));
    if (!screen) continue;
    const d = Math.hypot(screen[0] - e.clientX, screen[1] - e.clientY);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  selectIndex(best);
});

function updateBrackets(t) {
  if (selected < 0 || !field) return;
  const screen = worldToScreen(field.getPosition(selected, t, tmpVec));
  if (!screen) {
    brackets.style.opacity = '0';
    return;
  }
  brackets.style.opacity = '1';
  brackets.style.transform = `translate(${screen[0]}px, ${screen[1]}px) translate(-50%, -50%)`;
}

function updateLabels() {
  if (mode === 'neo') {
    if (moon) labels.place('luna', worldToScreen(moon.pos));
  } else if (systemMap) {
    for (const b of systemMap.bodies) labels.place(b.name, worldToScreen(b.pos));
  }
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  if (field) field.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  if (radar) radar.resize();
});

window.addEventListener('beforeunload', () => {
  if (field) field.dispose();
  if (systemMap) systemMap.dispose();
  if (moon) moon.dispose();
  env.dispose();
  renderer.dispose();
});

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  const t = clock.elapsedTime;
  controls.update();
  env.update(dt);
  if (mode === 'neo') {
    if (field) {
      field.update(t);
      updateBrackets(t);
    }
    if (radar) radar.update(t);
  } else if (systemMap) {
    systemMap.update(dt);
  }
  updateLabels();
  composer.render();
}
animate();
