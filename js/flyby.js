// Flyby trajectory overlay for the locked contact: projected path (tangent
// to its orbit), a ghost marker sweeping it at a rate scaled by the real
// approach velocity, and a range line to Earth. Geometry is two 2-vertex
// dashed lines updated in place each frame — no allocations in the loop.

import * as THREE from 'three';

const TRAJ_HALF = 45;

function twoPointLine(material) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const line = new THREE.Line(geo, material);
  line.frustumCulled = false; // endpoints move every frame
  return line;
}

export function createFlyby(scene) {
  const group = new THREE.Group();
  group.visible = false;

  const trajMat = new THREE.LineDashedMaterial({
    color: 0x33ff33,
    dashSize: 2.2,
    gapSize: 1.6,
    transparent: true,
    opacity: 0.75,
  });
  const traj = twoPointLine(trajMat);
  group.add(traj);

  const rangeMat = new THREE.LineDashedMaterial({
    color: 0x00ffff,
    dashSize: 1.1,
    gapSize: 1.1,
    transparent: true,
    opacity: 0.4,
  });
  const range = twoPointLine(rangeMat);
  group.add(range);

  const markerGeo = new THREE.SphereGeometry(0.6, 8, 6);
  const markerMat = new THREE.MeshBasicMaterial({ color: 0x33ff33 });
  const marker = new THREE.Mesh(markerGeo, markerMat);
  group.add(marker);

  scene.add(group);

  let target = null;
  const pos = new THREE.Vector3();
  const dir = new THREE.Vector3();

  return {
    group,

    setTarget(index, field) {
      if (index == null || index < 0 || !field) {
        target = null;
        group.visible = false;
        return;
      }
      target = { index, field, obj: field.objects[index] };
      const col = target.obj.is_hazardous ? 0xff3333 : 0x33ff33;
      trajMat.color.setHex(col);
      markerMat.color.setHex(col);
      group.visible = true;
    },

    // Returns the contact's current world position (for the CPA label),
    // or null when inactive.
    update(t) {
      if (!target || !group.visible) return null;
      target.field.getPosition(target.index, t, pos);

      // Tangent of the circular orbit: d/da of (cos a, y, sin a).
      const a = Math.atan2(pos.z, pos.x);
      dir.set(-Math.sin(a), 0, Math.cos(a));

      const tp = traj.geometry.attributes.position.array;
      tp[0] = pos.x - dir.x * TRAJ_HALF;
      tp[1] = pos.y;
      tp[2] = pos.z - dir.z * TRAJ_HALF;
      tp[3] = pos.x + dir.x * TRAJ_HALF;
      tp[4] = pos.y;
      tp[5] = pos.z + dir.z * TRAJ_HALF;
      traj.geometry.attributes.position.needsUpdate = true;
      traj.computeLineDistances();

      const rp = range.geometry.attributes.position.array;
      rp[0] = rp[1] = rp[2] = 0;
      rp[3] = pos.x;
      rp[4] = pos.y;
      rp[5] = pos.z;
      range.geometry.attributes.position.needsUpdate = true;
      range.computeLineDistances();

      const speed = 6 + target.obj.velocity_kps * 0.6;
      const s = ((t * speed) % (TRAJ_HALF * 2)) - TRAJ_HALF;
      marker.position.set(pos.x + dir.x * s, pos.y, pos.z + dir.z * s);

      return pos;
    },

    cpaText() {
      return target ? `CPA ${target.obj.miss_distance_lunar} LD` : '';
    },

    dispose() {
      scene.remove(group);
      traj.geometry.dispose();
      trajMat.dispose();
      range.geometry.dispose();
      rangeMat.dispose();
      markerGeo.dispose();
      markerMat.dispose();
    },
  };
}
