// LCARS launch directory: countdown table + APOD block.

const grid = document.getElementById('launch-grid');
const countdowns = []; // { el, epochMs }

function fmtCountdown(epochMs) {
  if (!epochMs) return '——';
  let delta = epochMs - Date.now();
  const sign = delta < 0 ? 'T+' : 'T-';
  delta = Math.abs(delta);
  const days = Math.floor(delta / 86400000);
  const hh = String(Math.floor(delta / 3600000) % 24).padStart(2, '0');
  const mm = String(Math.floor(delta / 60000) % 60).padStart(2, '0');
  const ss = String(Math.floor(delta / 1000) % 60).padStart(2, '0');
  return `${sign} ${days}D ${hh}:${mm}:${ss}`;
}

function cell(className, text) {
  const el = document.createElement('span');
  el.className = className;
  el.textContent = text;
  return el;
}

function renderLaunches(data) {
  if (data.generated_at_utc) {
    document.getElementById('launch-sync').textContent =
      `DATA SYNC ${data.generated_at_utc.slice(0, 16).replace('T', ' ')} UTC`;
  }
  for (const l of data.launches) {
    const tminus = cell('cell tminus', fmtCountdown(l.net_epoch_ms));
    countdowns.push({ el: tminus, epochMs: l.net_epoch_ms });
    grid.appendChild(tminus);

    // LL2 names read "Vehicle | Mission" — show just the mission half here.
    const mission = l.name.includes('|') ? l.name.split('|')[1].trim() : l.name;
    grid.appendChild(cell('cell mission', mission));

    const vehicle = cell('cell', l.vehicle);
    const provider = document.createElement('div');
    provider.className = 'cell dim';
    provider.style.fontSize = '12px';
    provider.textContent = l.provider;
    vehicle.appendChild(provider);
    grid.appendChild(vehicle);

    const pad = cell('cell pad', l.location);
    grid.appendChild(pad);

    grid.appendChild(cell(`cell st st-${(l.status || '').toLowerCase()}`, l.status_full || l.status));
  }
}

function renderApod(apod) {
  const wrap = document.getElementById('apod-wrap');
  const imgSrc = apod.media_type === 'image' ? apod.url : apod.thumbnail_url;
  wrap.innerHTML = '';

  if (imgSrc) {
    const link = document.createElement('a');
    link.href = apod.hdurl || apod.url;
    link.target = '_blank';
    link.rel = 'noopener';
    const img = document.createElement('img');
    img.src = imgSrc;
    img.alt = apod.title;
    link.appendChild(img);
    wrap.appendChild(link);
  }

  const info = document.createElement('div');
  const title = document.createElement('div');
  title.className = 'apod-title';
  title.textContent = apod.title;
  const date = document.createElement('div');
  date.className = 'apod-date';
  date.textContent = `NASA APOD // ${apod.date}`;
  const text = document.createElement('p');
  text.className = 'apod-text';
  text.textContent = apod.explanation;
  info.append(title, date, text);
  if (apod.copyright) {
    const credit = document.createElement('div');
    credit.className = 'apod-credit';
    credit.textContent = `IMAGE CREDIT: ${apod.copyright}`;
    info.appendChild(credit);
  }
  wrap.appendChild(info);
}

function tick() {
  for (const c of countdowns) c.el.textContent = fmtCountdown(c.epochMs);
}

Promise.all([
  fetch('./data/launches.json').then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }),
  fetch('./data/apod.json').then((r) => (r.ok ? r.json() : null)).catch(() => null),
])
  .then(([launches, apod]) => {
    renderLaunches(launches);
    setInterval(tick, 1000);
    if (apod) renderApod(apod);

    document.getElementById('raw-pre').textContent = JSON.stringify(launches, null, 2);
    const rawSection = document.getElementById('raw-section');
    document.getElementById('raw-toggle').addEventListener('click', () => {
      rawSection.hidden = !rawSection.hidden;
      if (!rawSection.hidden) rawSection.scrollIntoView({ behavior: 'smooth' });
    });
    if (location.hash === '#raw') rawSection.hidden = false;
  })
  .catch(() => {
    grid.insertAdjacentHTML('afterend', '<div class="err">LAUNCH FEED OFFLINE</div>');
  });
