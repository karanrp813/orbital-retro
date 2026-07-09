// Solar-system map (heliocentric wireframes on log-compressed radii) plus
// the Moon for the Earth-centric NEO view. Data: pipeline/fetch_ephemeris.py.

import * as THREE from 'three';
import { FIELD_INNER_R, FIELD_SPAN_R } from './asteroidField.js';

const AU_KM = 149597870.7;

// Real solar-system radii span ~2 orders of magnitude — unrenderable linearly.
// Compression is applied per point (not per object) so orbit ellipses deform
// smoothly instead of collapsing.
const compressRadius = (rAu) =>
  18 + 82 * (Math.log10(1 + rAu * 3) / Math.log10(1 + 31 * 3));

// Ecliptic (x, y, z) -> scene (x, z, -y): Y-up, north ecliptic pole up.
function compressPoint(x, y, z, out) {
  const r = Math.hypot(x, y, z);
  if (r < 1e-9) return out.set(0, 0, 0);
  const s = compressRadius(r) / r;
  return out.set(x * s, z * s, -y * s);
}

const planetSize = (radiusKm) => 1.1 + 2.3 * Math.log10(radiusKm / 2400);

function wireSphere(radius, color, opacity, disposables) {
  const geo = new THREE.SphereGeometry(radius, 12, 8);
  const wire = new THREE.WireframeGeometry(geo);
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
  disposables.push(geo, wire, mat);
  return new THREE.LineSegments(wire, mat);
}

export function createSystemMap(scene, eph) {
  const group = new THREE.Group();
  group.visible = false;
  const disposables = [];
  const tmp = new THREE.Vector3();
  const bodies = [];

  for (const b of eph.bodies) {
    if (b.name === 'moon') continue; // geocentric — lives in the NEO view

    const color =
      b.name === 'sun' ? 0xff3333 : b.name === 'earth' ? 0x00ffff : 0x33ff33;
    const size = b.name === 'sun' ? 6 : planetSize(b.radius_km);
    const mesh = wireSphere(size, color, b.name === 'sun' ? 0.8 : 0.55, disposables);
    compressPoint(b.pos[0], b.pos[1], b.pos[2], tmp);
    mesh.position.copy(tmp);
    group.add(mesh);
    bodies.push({ name: b.name, label: b.label, pos: mesh.position, mesh, info: b });

    if (b.name === 'saturn') {
      const pts = [];
      for (let s = 0; s <= 48; s++) {
        const a = (s / 48) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a) * size * 1.9, 0, Math.sin(a) * size * 1.9));
      }
      const ringGeo = new THREE.BufferGeometry().setFromPoints(pts);
      const ringMat = new THREE.LineBasicMaterial({
        color: 0x33ff33,
        transparent: true,
        opacity: 0.4,
      });
      const ring = new THREE.LineLoop(ringGeo, ringMat);
      ring.position.copy(mesh.position);
      group.add(ring);
      disposables.push(ringGeo, ringMat);
    }

    const flat = eph.orbits[b.name];
    if (flat) {
      const arr = new Float32Array(flat.length);
      for (let i = 0; i < flat.length; i += 3) {
        compressPoint(flat[i], flat[i + 1], flat[i + 2], tmp);
        arr[i] = tmp.x;
        arr[i + 1] = tmp.y;
        arr[i + 2] = tmp.z;
      }
      const orbitGeo = new THREE.BufferGeometry();
      orbitGeo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      const orbitMat = new THREE.LineBasicMaterial({
        color: 0x33ff33,
        transparent: true,
        opacity: 0.22,
      });
      group.add(new THREE.LineLoop(orbitGeo, orbitMat));
      disposables.push(orbitGeo, orbitMat);
    }
  }

  scene.add(group);

  return {
    group,
    bodies,
    update(dt) {
      for (const b of bodies) b.mesh.rotation.y += dt * 0.1;
    },
    dispose() {
      scene.remove(group);
      for (const d of disposables) d.dispose();
    },
  };
}

export function createNeoMoon(parent, eph, neoData) {
  const moon = eph.bodies.find((b) => b.name === 'moon');
  const kms = neoData.objects.map((o) => o.miss_distance_km);
  if (!moon || kms.length < 2) return null;

  const [mx, my, mz] = moon.pos;
  const rAu = Math.hypot(mx, my, mz);
  const km = rAu * AU_KM;
  const lo = Math.log10(Math.min(...kms));
  const hi = Math.log10(Math.max(...kms));
  if (hi - lo < 1e-9) return null;

  // Same log mapping the pipeline applies to asteroid radii, so the Moon
  // sits at its honest place among the week's miss distances.
  const norm = Math.min(Math.max((Math.log10(km) - lo) / (hi - lo), 0), 1.15);
  const worldR = FIELD_INNER_R + norm * FIELD_SPAN_R;

  const disposables = [];
  const mesh = wireSphere(2.4, 0x00ffff, 0.6, disposables);
  const inv = 1 / rAu;
  // True bearing preserved, only range is remapped (ecliptic -> scene axes).
  mesh.position.set(mx * inv * worldR, mz * inv * worldR, -my * inv * worldR);
  parent.add(mesh);

  return {
    mesh,
    pos: mesh.position,
    label: '[ LUNA ]',
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
