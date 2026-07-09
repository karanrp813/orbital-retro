// Terminal audio cues: Web Audio square-wave blips, no assets.
// Only ever triggered from user gestures, so autoplay policy is satisfied;
// the AudioContext is created lazily on first use.

let ctx = null;
let enabled = (localStorage.getItem('orbital-retro-sfx') ?? 'on') === 'on';

function audio() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(f0, f1, dur, { type = 'square', vol = 0.04, delay = 0 } = {}) {
  if (!enabled) return;
  const c = audio();
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t0);
  if (f1) osc.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

export const sfx = {
  lock(hazard) {
    tone(880, 1245, 0.07);
    tone(hazard ? 622 : 1175, null, 0.06, { delay: 0.09 });
  },
  unlock() {
    tone(440, 330, 0.08);
  },
  mode() {
    tone(520, 780, 0.12, { type: 'sawtooth', vol: 0.03 });
  },
  toggle(on) {
    tone(on ? 700 : 400, null, 0.06);
  },
  get enabled() {
    return enabled;
  },
  setEnabled(v) {
    enabled = v;
    localStorage.setItem('orbital-retro-sfx', v ? 'on' : 'off');
  },
};
