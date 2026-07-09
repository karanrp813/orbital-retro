// HUD readouts with the Theme A "type-out" data effect. The target panel is
// generic rows so it can present NEO contacts and system-map bodies alike.

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
let countdownEl = null;
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

// rows: array of { l, v, cls?, live? } — `live` marks the countdown value.
function renderPanel(title, rows) {
  $('target-panel').classList.remove('hidden');
  $('panel-title').textContent = title;
  const wrap = $('panel-rows');
  wrap.innerHTML = '';
  countdownEl = null;
  for (const row of rows) {
    const div = document.createElement('div');
    div.className = 'row';
    const lbl = document.createElement('span');
    lbl.className = 'lbl';
    lbl.textContent = row.l;
    const val = document.createElement('span');
    val.className = row.cls ? `val ${row.cls}` : 'val';
    div.append(lbl, val);
    wrap.appendChild(div);
    if (row.live) countdownEl = val;
    else typeInto(val, row.v, 60);
  }
}

export const hud = {
  init(data) {
    typeInto(
      $('status-line'),
      `TRACKING ${data.count} OBJECTS > ${data.min_diameter_m}M // WINDOW ${data.window_start} - ${data.window_end}`,
      45
    );
    if (data.generated_at_utc) {
      // Staleness must be self-evident: if the daily refresh dies, this shows it.
      typeInto($('sync-line'), `LAST SYNC ${data.generated_at_utc.slice(0, 16).replace('T', ' ')} UTC`, 60);
    }
    typeInto($('footer-line'), 'L-DRAG: ORBIT // WHEEL: ZOOM // CLICK CONTACT: TARGET LOCK', 55);
  },

  loading() {
    typeInto($('status-line'), 'ACQUIRING DATA LINK...', 30);
  },

  // Header stat strip: items are { k, v, cls? }.
  stats(items) {
    const bar = $('stat-bar');
    bar.innerHTML = '';
    for (const it of items) {
      const stat = document.createElement('span');
      stat.className = it.cls ? `stat ${it.cls}` : 'stat';
      const k = document.createElement('span');
      k.className = 'stat-k';
      k.textContent = it.k;
      const v = document.createElement('span');
      v.className = 'stat-v';
      stat.append(k, v);
      bar.appendChild(stat);
      typeInto(v, it.v, 30);
    }
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
    renderPanel('// TARGET LOCK', [
      { l: 'DESIG', v: o.designation_label },
      { l: 'DIAMETER', v: `${o.diameter_min_m} - ${o.diameter_max_m} M` },
      { l: 'VELOCITY', v: `${o.velocity_kps} KM/S` },
      {
        l: 'MISS DIST',
        v: `${Math.round(o.miss_distance_km).toLocaleString('en-US')} KM (${o.miss_distance_lunar} LD)`,
      },
      { l: 'APPROACH', v: o.approach_date },
      { l: 'T-MINUS', v: '', live: true },
      {
        l: 'HAZARD',
        v: o.is_hazardous ? 'POTENTIALLY HAZARDOUS' : 'NEGATIVE',
        cls: o.is_hazardous ? 'alert blink' : '',
      },
      { l: 'SRC', v: 'NASA NEOWS' },
    ]);
    countdownEpoch = o.approach_epoch_ms;
    countdownLast = '';
  },

  showBody(info, distAu) {
    const rows = [
      { l: 'DESIG', v: info.label },
      { l: 'RADIUS', v: `${info.radius_km.toLocaleString('en-US')} KM` },
    ];
    if (info.a_au != null) rows.push({ l: 'SEMI-MAJ', v: `${info.a_au.toFixed(4)} AU` });
    if (info.e != null) rows.push({ l: 'ECCENTR', v: `${info.e}` });
    if (info.inc_deg != null) rows.push({ l: 'INCLIN', v: `${info.inc_deg} DEG` });
    if (info.period_days != null) rows.push({ l: 'PERIOD', v: `${info.period_days.toLocaleString('en-US')} D` });
    rows.push(
      { l: 'RANGE', v: `${distAu.toFixed(4)} AU (HELIO)` },
      { l: 'SRC', v: 'JPL HORIZONS' }
    );
    renderPanel('// BODY SCAN', rows);
    countdownEpoch = null;
  },

  clearTarget() {
    $('target-panel').classList.add('hidden');
    countdownEpoch = null;
  },

  // Called every frame; writes only when the displayed second changes.
  tickCountdown() {
    if (!countdownEpoch || !countdownEl) return;
    const text = fmtTMinus(countdownEpoch);
    if (text !== countdownLast) {
      countdownLast = text;
      countdownEl.textContent = text;
    }
  },
};
