// Asteroid field + scene environment for Orbital Retro.
// All per-object animation runs in the vertex shader; the CPU touches
// positions only on pointer events (picking) and for the lock brackets.

import * as THREE from 'three';

// Deterministic per-index hash — must stay in sync with nothing else;
// JS-side placement arrays are the single source of truth for picking.
const hash = (i, salt) => {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

export const FIELD_INNER_R = 28;
export const FIELD_SPAN_R = 88;
export const FIELD_OUTER_R = FIELD_INNER_R + FIELD_SPAN_R;

const VERTEX = /* glsl */ `
uniform float uTime;
uniform float uPixelRatio;
attribute float aRadius;
attribute float aAngle;
attribute float aHeight;
attribute float aSpeed;
attribute float aSize;
attribute float aHazard;
attribute float aSeed;
varying float vHazard;
varying float vSeed;

void main() {
  float a = aAngle + uTime * aSpeed;
  vec3 orbital = vec3(cos(a) * aRadius, aHeight, sin(a) * aRadius);
  vec4 mv = modelViewMatrix * vec4(orbital, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = (5.0 + aSize * 13.0) * uPixelRatio * (150.0 / -mv.z);
  vHazard = aHazard;
  vSeed = aSeed;
}`;

const FRAGMENT = /* glsl */ `
uniform float uFxTime;
varying float vHazard;
varying float vSeed;

void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  float core = smoothstep(0.16, 0.04, d);
  float halo = smoothstep(0.5, 0.0, d) * 0.35;
  // hazardous contacts carry a targeting ring
  float ring = smoothstep(0.03, 0.0, abs(d - 0.36)) * vHazard * 0.9;
  float flicker = 0.85 + 0.15 * sin(uFxTime * 22.0 + vSeed * 40.0);
  vec3 col = mix(vec3(0.2, 1.0, 0.2), vec3(1.0, 0.25, 0.18), vHazard);
  float alpha = (core + halo + ring) * flicker;
  if (alpha < 0.02) discard;
  gl_FragColor = vec4(col, alpha);
}`;

export function createAsteroidField(data) {
  const n = data.count;
  const buf = data.buffers;

  // Orbital parameters, kept CPU-side too for picking/bracket math.
  const radius = new Float32Array(n);
  const angle0 = new Float32Array(n);
  const height = new Float32Array(n);
  const speed = new Float32Array(n);
  const seed = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    radius[i] = FIELD_INNER_R + buf.miss_distance_norm[i] * FIELD_SPAN_R;
    angle0[i] = hash(i, 1) * Math.PI * 2;
    height[i] = (hash(i, 2) - 0.5) * 20;
    speed[i] = 0.05 + (buf.velocity_kps[i] / 35) * 0.12;
    seed[i] = hash(i, 7);
  }

  const geometry = new THREE.BufferGeometry();
  // Real positions come from the vertex shader; this only sets draw count.
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  geometry.setAttribute('aRadius', new THREE.BufferAttribute(radius, 1));
  geometry.setAttribute('aAngle', new THREE.BufferAttribute(angle0, 1));
  geometry.setAttribute('aHeight', new THREE.BufferAttribute(height, 1));
  geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(Float32Array.from(buf.diameter_norm), 1));
  geometry.setAttribute('aHazard', new THREE.BufferAttribute(Float32Array.from(buf.hazard_flag), 1));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));

  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uTime: { value: 0 },
      uFxTime: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geometry, material);
  // Shader-driven positions defeat the static bounding sphere.
  points.frustumCulled = false;

  return {
    points,
    objects: data.objects,
    count: n,

    // Orbit positions follow mission (sim) time so the scrubber and HOLD
    // work; the phosphor flicker stays on wall time so a held frame still
    // looks alive.
    update(simTime, fxTime) {
      material.uniforms.uTime.value = simTime;
      material.uniforms.uFxTime.value = fxTime !== undefined ? fxTime : simTime;
    },

    setPixelRatio(pr) {
      material.uniforms.uPixelRatio.value = pr;
    },

    // Mirrors the vertex-shader orbit math for picking and bracket tracking.
    getPosition(i, time, out) {
      const a = angle0[i] + time * speed[i];
      return out.set(Math.cos(a) * radius[i], height[i], Math.sin(a) * radius[i]);
    },

    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

export function createEnvironment(scene) {
  // Earth + rings are NEO-mode furniture; stars stay visible in every mode.
  const neoGroup = new THREE.Group();
  const starGroup = new THREE.Group();
  const disposables = [];

  // Central body: pure wireframe, no textures (doc directive A2).
  const earthGeo = new THREE.SphereGeometry(12, 16, 10);
  const earthWire = new THREE.WireframeGeometry(earthGeo);
  const earthMat = new THREE.LineBasicMaterial({
    color: 0x00ffff,
    transparent: true,
    opacity: 0.28,
  });
  const earth = new THREE.LineSegments(earthWire, earthMat);
  neoGroup.add(earth);
  disposables.push(earthGeo, earthWire, earthMat);

  // Concentric targeting rings in the orbital plane.
  const ringMat = new THREE.LineBasicMaterial({
    color: 0x33ff33,
    transparent: true,
    opacity: 0.16,
  });
  disposables.push(ringMat);
  for (const r of [45, 80, 116]) {
    const pts = [];
    for (let s = 0; s <= 96; s++) {
      const a = (s / 96) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
    }
    const ringGeo = new THREE.BufferGeometry().setFromPoints(pts);
    neoGroup.add(new THREE.LineLoop(ringGeo, ringMat));
    disposables.push(ringGeo);
  }

  // Distant phosphor starfield shell.
  const starCount = 500;
  const starPos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const r = 500 + hash(i, 11) * 400;
    const theta = hash(i, 12) * Math.PI * 2;
    const phi = Math.acos(2 * hash(i, 13) - 1);
    starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    starPos[i * 3 + 1] = r * Math.cos(phi);
    starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({
    color: 0x99ffbb,
    size: 1.6,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0.45,
  });
  starGroup.add(new THREE.Points(starGeo, starMat));
  disposables.push(starGeo, starMat);

  scene.add(neoGroup);
  scene.add(starGroup);

  return {
    neoGroup,
    update(dt) {
      earth.rotation.y += dt * 0.08;
    },
    dispose() {
      scene.remove(neoGroup);
      scene.remove(starGroup);
      for (const d of disposables) d.dispose();
    },
  };
}
