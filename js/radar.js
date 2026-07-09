// Tactical PPI scope: top-down projection of the live 3D field.
// Phosphor persistence is real, not simulated per-blip: the canvas is never
// cleared, only faded each frame, so the sweep paints contacts and they decay
// exactly like a storage-tube radar. Contacts drift while their echo stays put.

import * as THREE from 'three';
import { FIELD_INNER_R, FIELD_SPAN_R, FIELD_OUTER_R } from './asteroidField.js';

const SWEEP_PERIOD_S = 4;
const SWEEP_PAINT_RAD = 0.25; // wedge behind the sweep that re-paints echoes
const RING_WORLD_RADII = [45, 80, FIELD_OUTER_R]; // matches the 3D scene rings
const LUNAR_KM = 384400;

export function createRadar({ canvas, field, data, onSelect }) {
  const ctx = canvas.getContext('2d');
  const tmp = new THREE.Vector3();
  let selected = -1;
  let size = 0;
  let radarR = 0;

  // Invert the pipeline's log normalization so range rings carry real
  // lunar-distance labels instead of decorative fractions.
  const kms = data.objects.map((o) => o.miss_distance_km);
  let ringLabels = null;
  if (kms.length > 1) {
    const lo = Math.log10(Math.min(...kms));
    const hi = Math.log10(Math.max(...kms));
    if (hi - lo > 1e-9) {
      ringLabels = RING_WORLD_RADII.map((r) => {
        const norm = (r - FIELD_INNER_R) / FIELD_SPAN_R;
        const ld = Math.pow(10, lo + norm * (hi - lo)) / LUNAR_KM;
        return `${ld < 10 ? ld.toFixed(1) : Math.round(ld)} LD`;
      });
    }
  }

  function resize() {
    const w = canvas.clientWidth;
    if (!w) return;
    const dpr = Math.min(window.devicePixelRatio, 2);
    canvas.width = w * dpr;
    canvas.height = w * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    size = w;
    radarR = w / 2 - 16;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, size, size);
  }

  const worldScale = () => radarR / FIELD_OUTER_R;

  function drawStatic() {
    const c = size / 2;
    ctx.strokeStyle = 'rgba(51, 255, 51, 0.28)';
    ctx.lineWidth = 1;
    for (const r of RING_WORLD_RADII) {
      ctx.beginPath();
      ctx.arc(c, c, r * worldScale(), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(51, 255, 51, 0.12)';
    ctx.beginPath();
    ctx.moveTo(c - radarR, c);
    ctx.lineTo(c + radarR, c);
    ctx.moveTo(c, c - radarR);
    ctx.lineTo(c, c + radarR);
    ctx.stroke();

    if (ringLabels) {
      ctx.fillStyle = 'rgba(51, 255, 51, 0.55)';
      ctx.font = '9px "Share Tech Mono", monospace';
      ctx.textAlign = 'left';
      RING_WORLD_RADII.forEach((r, k) => {
        ctx.fillText(ringLabels[k], c + 3, c - r * worldScale() + 10);
      });
    }

    // Central body.
    ctx.fillStyle = 'rgba(0, 255, 255, 0.9)';
    ctx.beginPath();
    ctx.arc(c, c, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  function sweepAngle(t) {
    return ((t % SWEEP_PERIOD_S) / SWEEP_PERIOD_S) * Math.PI * 2;
  }

  function drawSweep(t) {
    const c = size / 2;
    const s = sweepAngle(t);
    ctx.strokeStyle = 'rgba(51, 255, 51, 0.8)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.lineTo(c + Math.cos(s) * radarR, c + Math.sin(s) * radarR);
    ctx.stroke();
  }

  function contactScreenPos(i, t) {
    field.getPosition(i, t, tmp);
    const c = size / 2;
    return [c + tmp.x * worldScale(), c + tmp.z * worldScale()];
  }

  function drawContacts(t) {
    const s = sweepAngle(t);
    for (let i = 0; i < field.count; i++) {
      field.getPosition(i, t, tmp);
      const a = Math.atan2(tmp.z, tmp.x);
      const behind = (((s - a) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      if (behind > SWEEP_PAINT_RAD) continue; // echo decays until next pass

      const [px, py] = contactScreenPos(i, t);
      if (field.objects[i].is_hazardous) {
        ctx.fillStyle = 'rgba(255, 51, 51, 1)';
        ctx.fillRect(px - 2.5, py - 2.5, 5, 5);
        ctx.strokeStyle = 'rgba(255, 51, 51, 0.7)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(px, py, 6, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = 'rgba(51, 255, 51, 1)';
        ctx.beginPath();
        ctx.arc(px, py, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawSelection(t) {
    if (selected < 0) return;
    const [px, py] = contactScreenPos(selected, t);
    const col = field.objects[selected].is_hazardous
      ? 'rgba(255, 51, 51, 0.95)'
      : 'rgba(51, 255, 51, 0.95)';
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.5;
    const h = 9;
    const l = 5;
    ctx.beginPath();
    // four corner brackets
    ctx.moveTo(px - h, py - h + l); ctx.lineTo(px - h, py - h); ctx.lineTo(px - h + l, py - h);
    ctx.moveTo(px + h - l, py - h); ctx.lineTo(px + h, py - h); ctx.lineTo(px + h, py - h + l);
    ctx.moveTo(px + h, py + h - l); ctx.lineTo(px + h, py + h); ctx.lineTo(px + h - l, py + h);
    ctx.moveTo(px - h + l, py + h); ctx.lineTo(px - h, py + h); ctx.lineTo(px - h, py + h - l);
    ctx.stroke();
  }

  canvas.addEventListener('pointerdown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const t = performance.now() / 1000 - epochOffset;
    let best = -1;
    let bestDist = 12;
    for (let i = 0; i < field.count; i++) {
      const [px, py] = contactScreenPos(i, t);
      const d = Math.hypot(px - mx, py - my);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    if (best >= 0) onSelect(best);
  });

  // The click handler needs the same clock as update(); main.js drives
  // update(t) from THREE.Clock, so track the offset between the two.
  let epochOffset = performance.now() / 1000;

  resize();

  return {
    update(t) {
      if (!size) resize();
      if (!size) return;
      epochOffset = performance.now() / 1000 - t;
      // Phosphor decay: fade instead of clear.
      ctx.fillStyle = 'rgba(0, 8, 0, 0.10)';
      ctx.fillRect(0, 0, size, size);
      drawStatic();
      drawSweep(t);
      drawContacts(t);
      drawSelection(t);
    },
    setSelected(i) {
      selected = i;
    },
    resize,
    dispose() {},
  };
}
