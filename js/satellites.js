// LEO satellite shell: one Points draw call, all orbital motion in the
// vertex shader from CelesTrak mean elements (circular approximation).
// Scale contract: Earth wireframe radius 12 <-> 6371 km (see pipeline).

import * as THREE from 'three';

const VERTEX = /* glsl */ `
uniform float uTime;
uniform float uPixelRatio;
attribute float aRadius;
attribute float aInc;
attribute float aRaan;
attribute float aM0;
attribute float aSpeed;

void main() {
  float M = aM0 + uTime * aSpeed;
  vec3 p = vec3(cos(M) * aRadius, 0.0, sin(M) * aRadius);
  // tilt orbital plane by inclination (about X), then swing by RAAN (about Y)
  float ci = cos(aInc); float si = sin(aInc);
  p = vec3(p.x, -p.z * si, p.z * ci);
  float co = cos(aRaan); float so = sin(aRaan);
  p = vec3(p.x * co + p.z * so, p.y, -p.x * so + p.z * co);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(2.4 * uPixelRatio * (140.0 / -mv.z), 1.0, 4.0);
}`;

const FRAGMENT = /* glsl */ `
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.15, d) * 0.85;
  if (a < 0.03) discard;
  gl_FragColor = vec4(0.45, 0.9, 1.0, a);
}`;

export function createSatellites(parent, data) {
  const n = data.count;
  const buf = data.buffers;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  geometry.setAttribute('aRadius', new THREE.BufferAttribute(Float32Array.from(buf.radius), 1));
  geometry.setAttribute('aInc', new THREE.BufferAttribute(Float32Array.from(buf.inc), 1));
  geometry.setAttribute('aRaan', new THREE.BufferAttribute(Float32Array.from(buf.raan), 1));
  geometry.setAttribute('aM0', new THREE.BufferAttribute(Float32Array.from(buf.m0), 1));
  geometry.setAttribute('aSpeed', new THREE.BufferAttribute(Float32Array.from(buf.speed), 1));

  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false; // shader-driven positions
  parent.add(points);

  return {
    points,
    count: n,
    update(time) {
      material.uniforms.uTime.value = time;
    },
    setPixelRatio(pr) {
      material.uniforms.uPixelRatio.value = pr;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
