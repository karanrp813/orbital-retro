// Orbital Retro — bootstrap, mode state, render loop, picking, target lock.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createAsteroidField, createEnvironment } from './asteroidField.js';
import { createSystemMap, createNeoMoon } from './systemMap.js';
import { createSatellites, GROUP_COLORS } from './satellites.js';
import { createFlyby } from './flyby.js';
import { createRadar } from './radar.js';
import { createLabelLayer } from './labels.js';
import { createStore } from './state.js';
import { sfx } from './sfx.js';
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
const flyby = createFlyby(scene);
labels.add('cpa', '', 'var(--c-cyan)');

let field = null;
let radar = null;
let systemMap = null;
let moon = null;
let sats = null;
let selected = -1; // NEO contact index
let selectedBody = -1; // system-map body index
let mode = 'neo';
let neoStatusLine = '';
let flybyPos = null;
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
  // Enhancement layers — degrade gracefully when missing.
  fetch('./data/ephemeris.json').then((r) => (r.ok ? r.json() : null)).catch(() => null),
  fetch('./data/satellites.json').then((r) => (r.ok ? r.json() : null)).catch(() => null),
])
  .then(([neoData, eph, satData]) => {
    field = createAsteroidField(neoData);
    scene.add(field.points);
    radar = createRadar({
      canvas: document.getElementById('radar-canvas'),
      field,
      data: neoData,
      onSelect: (i) => userSelectNeo(i),
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

    if (satData && satData.count) {
      sats = createSatellites(env.neoGroup, satData);
      timeScale = satData.time_scale || timeScale;
      buildLegend(sats);
    }

    // Mission clock anchors to the satellite epoch (their mean anomalies
    // are valid there); boot snapped to live NOW rather than the epoch.
    const epochIso = (satData && satData.generated_at_utc) || neoData.generated_at_utc;
    if (epochIso) missionEpochMs = Date.parse(epochIso);
    setMissionOffset(0);
    timeControls.classList.remove('hidden');

    neoStatusLine =
      `TRACKING ${neoData.count} OBJECTS > ${neoData.min_diameter_m}M // WINDOW ${neoData.window_start} - ${neoData.window_end}` +
      (sats ? ` // ${sats.count} SATS` : '');
    hud.init(neoData);
    hud.status(neoStatusLine);

    const hazardCount = neoData.buffers.hazard_flag.filter((f) => f > 0).length;
    hud.stats([
      { k: 'TRACKED', v: `${neoData.count} NEO` },
      { k: 'HAZARD', v: String(hazardCount), cls: hazardCount ? 'alert' : '' },
      ...(sats
        ? [
            { k: 'ACTIVE SATS', v: sats.catalogTotal.toLocaleString('en-US'), cls: 'cyan' },
            { k: 'PLOTTED', v: sats.count.toLocaleString('en-US'), cls: 'cyan' },
          ]
        : []),
      { k: 'SRC', v: sats ? 'NEOWS / HORIZONS / CELESTRAK' : 'NEOWS / HORIZONS' },
    ]);

    // Debug/deep-links: ?lock=N pre-selects a contact, ?mode=system opens
    // the map, ?body=mars pre-selects a system body, ?scrub=S offsets the
    // mission clock by S real seconds, ?hold=1 freezes it.
    const params = new URLSearchParams(location.search);
    const lock = params.get('lock');
    if (lock !== null) selectNeo(Math.min(parseInt(lock, 10) || 0, field.count - 1));
    if ((params.get('mode') === 'system' || params.get('body')) && systemMap) {
      store.set({ mode: 'system' });
      const bodyName = params.get('body');
      if (bodyName) {
        selectBody(systemMap.bodies.findIndex((b) => b.name === bodyName.toLowerCase()));
      }
    }
    const scrub = params.get('scrub');
    if (scrub !== null) setMissionOffset(parseFloat(scrub) || 0);
    if (params.get('hold') === '1') setHold(true);
  })
  .catch((err) => hud.fatal(`DATA LINK FAILURE // ${err.message}`));

// ---- Mode tabs + sound toggle ----

document.getElementById('tab-neo').addEventListener('click', () => {
  sfx.mode();
  store.set({ mode: 'neo' });
});
document.getElementById('tab-system').addEventListener('click', () => {
  sfx.mode();
  store.set({ mode: 'system' });
});
document.getElementById('tab-launches').addEventListener('click', () => {
  sfx.mode();
  location.href = './launches.html';
});
document.getElementById('tab-archive').addEventListener('click', () => {
  sfx.mode();
  location.href = './history.html';
});

const soundTab = document.getElementById('tab-sound');
function renderSoundTab() {
  soundTab.textContent = sfx.enabled ? 'SND ON' : 'SND OFF';
  soundTab.classList.toggle('active', sfx.enabled);
}
renderSoundTab();
soundTab.addEventListener('click', () => {
  sfx.setEnabled(!sfx.enabled);
  sfx.toggle(sfx.enabled);
  renderSoundTab();
});

// ---- Mission clock: sim time drives all orbital motion; wall time keeps
// the radar sweep and CRT flicker alive while mission time is held. The
// scrubber value is a real-second offset from wall-clock NOW. ----

let timeScale = 90; // overwritten by satellites.json time_scale
let missionEpochMs = Date.now();
let simTime = 0;
let simRate = 1;
let scrubbing = false;
let readoutLast = '';

const timeControls = document.getElementById('time-controls');
const holdBtn = document.getElementById('time-hold');
const scrubInput = document.getElementById('time-scrub');
const readoutEl = document.getElementById('time-readout');

const missionNowMs = () => missionEpochMs + simTime * timeScale * 1000;

function setMissionOffset(offsetS) {
  simTime = (Date.now() + offsetS * 1000 - missionEpochMs) / (1000 * timeScale);
}

function setHold(hold) {
  simRate = hold ? 0 : 1;
  holdBtn.textContent = hold ? 'RUN' : 'HOLD';
  holdBtn.classList.toggle('active', hold);
}

holdBtn.addEventListener('click', () => {
  sfx.mode();
  setHold(simRate !== 0);
});

document.getElementById('time-now').addEventListener('click', () => {
  sfx.mode();
  setMissionOffset(0);
  setHold(false);
});

scrubInput.addEventListener('pointerdown', () => {
  scrubbing = true;
});
window.addEventListener('pointerup', () => {
  scrubbing = false;
});
scrubInput.addEventListener('input', () => {
  setMissionOffset(parseFloat(scrubInput.value) || 0);
});

function fmtOffset(s) {
  const sign = s < 0 ? '-' : '+';
  s = Math.abs(s);
  const d = Math.floor(s / 86400);
  const h = Math.floor(s / 3600) % 24;
  const m = Math.floor(s / 60) % 60;
  if (d) return `${sign}${d}D${String(h).padStart(2, '0')}H`;
  if (h) return `${sign}${h}H${String(m).padStart(2, '0')}M`;
  return `${sign}${m}M`;
}

// Per-frame; writes the DOM only when the displayed text changes.
function updateTimeUI() {
  const nowMs = missionNowMs();
  const offsetS = (nowMs - Date.now()) / 1000;
  if (!scrubbing) {
    scrubInput.value = String(Math.round(Math.max(-86400, Math.min(604800, offsetS))));
  }
  const stamp = new Date(nowMs).toISOString().slice(0, 16).replace('T', ' ');
  const drift = Math.abs(offsetS) >= 60 ? ` // ${fmtOffset(offsetS)}` : '';
  const text = `${stamp}Z${drift} // ${simRate ? `RATE ${timeScale}X` : 'HOLD'}`;
  if (text !== readoutLast) {
    readoutLast = text;
    readoutEl.textContent = text;
  }
}

function buildLegend(s) {
  const wrap = document.getElementById('legend-rows');
  s.groups.forEach((g, i) => {
    if (!g.catalog && !g.plotted) return; // group fetch failed this refresh
    const row = document.createElement('div');
    row.className = 'legend-row';
    const dot = document.createElement('span');
    dot.className = 'legend-dot';
    dot.style.color = (GROUP_COLORS[i] || GROUP_COLORS[0]).hex;
    const name = document.createElement('span');
    name.textContent = g.label;
    const count = document.createElement('span');
    count.className = 'legend-count';
    count.textContent = g.catalog.toLocaleString('en-US');
    row.append(dot, name, count);
    wrap.appendChild(row);
  });
  document.getElementById('legend-note').textContent =
    `PLOT ${s.count.toLocaleString('en-US')} OF ${s.catalogTotal.toLocaleString('en-US')} // CELESTRAK GP`;
  document.getElementById('legend-panel').classList.remove('hidden');
}

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
  if (sats) document.getElementById('legend-panel').classList.toggle('hidden', !neo);
  if (field) timeControls.classList.toggle('hidden', !neo);
  document.getElementById('tab-neo').classList.toggle('active', neo);
  document.getElementById('tab-system').classList.toggle('active', !neo);
  labels.hideAll();

  if (neo) {
    flyby.setTarget(selected, field);
    if (selected >= 0 && field) {
      hud.showTarget(field.objects[selected]);
      showBrackets(field.objects[selected].is_hazardous ? 'var(--c-red)' : 'var(--c-green)');
    } else {
      hud.clearTarget();
      brackets.classList.add('hidden');
    }
    if (neoStatusLine) hud.status(neoStatusLine);
  } else {
    flyby.setTarget(-1, null);
    if (selectedBody >= 0 && systemMap) {
      applyBodySelection();
    } else {
      hud.clearTarget();
      brackets.classList.add('hidden');
    }
    if (systemMap) {
      hud.status(`HELIOCENTRIC PLOT // ${systemMap.bodies.length} BODIES // LOG-COMPRESSED RADII`);
    }
  }

  camera.position.copy(camState[mode].pos);
  controls.target.copy(camState[mode].target);
  controls.maxDistance = neo ? 600 : 900;
});

// ---- Selection ----

function showBrackets(color) {
  brackets.style.color = color;
  brackets.classList.remove('hidden');
}

function selectNeo(i) {
  selected = i;
  if (radar) radar.setSelected(i);
  flyby.setTarget(i, field);
  labels.setText('cpa', flyby.cpaText());
  if (i >= 0 && field) {
    const obj = field.objects[i];
    hud.showTarget(obj);
    showBrackets(obj.is_hazardous ? 'var(--c-red)' : 'var(--c-green)');
  } else {
    hud.clearTarget();
    brackets.classList.add('hidden');
  }
}

function userSelectNeo(i) {
  selectNeo(i);
  if (i >= 0) sfx.lock(field.objects[i].is_hazardous);
  else sfx.unlock();
}

function applyBodySelection() {
  const b = systemMap.bodies[selectedBody];
  const p = b.info.pos;
  hud.showBody(b.info, Math.hypot(p[0], p[1], p[2]));
  showBrackets('var(--c-cyan)');
}

function selectBody(i) {
  selectedBody = i;
  if (i >= 0 && systemMap) applyBodySelection();
  else {
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

// ---- Picking: NEO contacts use CPU mirrors of the shader orbit math;
// system bodies are static meshes, projected the same way. ----

const PICK_RADIUS_PX = 18;
let downX = 0;
let downY = 0;

renderer.domElement.addEventListener('pointerdown', (e) => {
  downX = e.clientX;
  downY = e.clientY;
});

renderer.domElement.addEventListener('pointerup', (e) => {
  if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) return; // orbit drag

  if (mode === 'neo' && field) {
    const t = simTime;
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
    userSelectNeo(best);
  } else if (mode === 'system' && systemMap) {
    let best = -1;
    let bestDist = PICK_RADIUS_PX + 6;
    systemMap.bodies.forEach((b, i) => {
      const screen = worldToScreen(b.pos);
      if (!screen) return;
      const d = Math.hypot(screen[0] - e.clientX, screen[1] - e.clientY);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    selectBody(best);
    if (best >= 0) sfx.lock(false);
    else sfx.unlock();
  }
});

function updateBrackets(t) {
  let screen = null;
  if (mode === 'neo' && selected >= 0 && field) {
    screen = worldToScreen(field.getPosition(selected, t, tmpVec));
  } else if (mode === 'system' && selectedBody >= 0 && systemMap) {
    screen = worldToScreen(systemMap.bodies[selectedBody].pos);
  } else {
    return;
  }
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
    let cpaScreen = flybyPos ? worldToScreen(flybyPos) : null;
    if (cpaScreen) cpaScreen = [cpaScreen[0], cpaScreen[1] + 46];
    labels.place('cpa', cpaScreen);
  } else if (systemMap) {
    for (const b of systemMap.bodies) labels.place(b.name, worldToScreen(b.pos));
  }
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  const pr = Math.min(window.devicePixelRatio, 2);
  if (field) field.setPixelRatio(pr);
  if (sats) sats.setPixelRatio(pr);
  if (radar) radar.resize();
});

window.addEventListener('beforeunload', () => {
  if (field) field.dispose();
  if (systemMap) systemMap.dispose();
  if (moon) moon.dispose();
  if (sats) sats.dispose();
  flyby.dispose();
  env.dispose();
  renderer.dispose();
});

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  const wallT = clock.elapsedTime;
  simTime += dt * simRate;
  controls.update();
  env.update(dt * simRate);
  if (mode === 'neo') {
    if (field) {
      field.update(simTime, wallT);
      updateTimeUI();
    }
    if (sats) sats.update(simTime);
    if (radar) radar.update(simTime, wallT);
    flybyPos = flyby.update(simTime);
    hud.tickCountdown();
  } else if (systemMap) {
    systemMap.update(dt);
    flybyPos = null;
  }
  updateBrackets(simTime);
  updateLabels();
  composer.render();
}
animate();
