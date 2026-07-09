// HUD readouts with the Theme A "type-out" data effect.

const $ = (id) => document.getElementById(id);

// Types text into an element; a newer call on the same element cancels
// the previous one via a monotonic token.
function typeInto(el, text, cps = 60) {
  const token = (el._typeToken = (el._typeToken || 0) + 1);
  el.textContent = '';
  let i = 0;
  const step = () => {
    if (el._typeToken !== token) return;
    el.textContent = text.slice(0, ++i);
    if (i < text.length) setTimeout(step, 1000 / cps);
  };
  step();
}

let countdownEpoch = null;
let countdownLast = '';

function fmtTMinus(epochMs) {
  let delta = epochMs - Date.now();
  const sign = delta < 0 ? 'T+' : 'T-';
  delta = Math.abs(delta);
  const days = Math.floor(delta / 86400000);
  const hh = String(Math.floor(delta / 3600000) % 24).padStart(2, '0');
  const mm = String(Math.floor(delta / 60000) % 60).padStart(2, '0');
  const ss = String(Math.floor(delta / 1000) % 60).padStart(2, '0');
  return `${sign} ${days}D ${hh}:${mm}:${ss}`;
}

export const hud = {
  init(data) {
    typeInto(
      $('status-line'),
      `TRACKING ${data.count} OBJECTS > ${data.min_diameter_m}M // WINDOW ${data.window_start} - ${data.window_end}`,
      45
    );
    typeInto($('footer-line'), 'L-DRAG: ORBIT // WHEEL: ZOOM // CLICK CONTACT: TARGET LOCK', 55);
  },

  loading() {
    typeInto($('status-line'), 'ACQUIRING DATA LINK...', 30);
  },

  status(text) {
    typeInto($('status-line'), text, 45);
  },

  fatal(msg) {
    const el = $('status-line');
    el.classList.add('alert', 'blink');
    typeInto(el, msg, 40);
  },

  showTarget(o) {
    $('target-panel').classList.remove('hidden');
    typeInto($('t-name'), o.designation_label, 35);
    typeInto($('t-diam'), `${o.diameter_min_m} - ${o.diameter_max_m} M`, 70);
    typeInto($('t-vel'), `${o.velocity_kps} KM/S`, 70);
    typeInto(
      $('t-miss'),
      `${Math.round(o.miss_distance_km).toLocaleString('en-US')} KM (${o.miss_distance_lunar} LD)`,
      70
    );
    typeInto($('t-date'), o.approach_date, 70);
    const hz = $('t-hazard');
    hz.classList.toggle('alert', o.is_hazardous);
    hz.classList.toggle('blink', o.is_hazardous);
    typeInto(hz, o.is_hazardous ? 'POTENTIALLY HAZARDOUS' : 'NEGATIVE', 45);
    countdownEpoch = o.approach_epoch_ms;
    countdownLast = '';
  },

  clearTarget() {
    $('target-panel').classList.add('hidden');
    countdownEpoch = null;
  },

  // Called every frame; writes only when the displayed second changes.
  tickCountdown() {
    if (!countdownEpoch) return;
    const text = fmtTMinus(countdownEpoch);
    if (text !== countdownLast) {
      countdownLast = text;
      $('t-tminus').textContent = text;
    }
  },
};
