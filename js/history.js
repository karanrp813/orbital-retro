// NEO close-approach archive: D3 scatter timeline in the Targeting Computer
// aesthetic. X = date, Y = miss distance (LD, log), point size = estimated
// diameter, red = 140m-class objects. Hover picking via a Delaunay mesh so
// the nearest point is always hit without pixel-hunting.

import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7/+esm';

const $ = (id) => document.getElementById(id);

function typeInto(el, text, cps = 50) {
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

const BIG_M = 140; // PHA-scale size threshold

function pointRadius(d) {
  if (!d.est_diameter_m) return 1.6;
  return Math.max(1.6, Math.min(7, 1.2 + Math.log10(d.est_diameter_m) * 1.7));
}

function render(data) {
  const rs = data.records;
  const inside = rs.filter((r) => r.dist_ld < 1).length;
  const closest = rs.reduce((a, b) => (a.dist_ld < b.dist_ld ? a : b));

  typeInto(
    $('status-line'),
    `${data.count} CLOSE APPROACHES // LAST ${data.days} DAYS // ${inside} INSIDE LUNAR ORBIT // CLOSEST: ${closest.des.toUpperCase()} @ ${closest.dist_ld} LD`,
    55
  );
  if (data.generated_at_utc) {
    typeInto($('sync-line'), `LAST SYNC ${data.generated_at_utc.slice(0, 16).replace('T', ' ')} UTC`, 60);
  }
  typeInto(
    $('chart-caption'),
    `POINT SIZE: EST DIAMETER (ALBEDO 0.14) // RED: ${BIG_M} M CLASS AND UP // CYAN LINE: LUNAR ORBIT (1 LD) // SRC: JPL SSD CAD`,
    70
  );

  const container = $('chart');
  const tooltip = $('tooltip');

  function draw() {
    container.innerHTML = '';
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width < 50 || height < 50) return;
    const m = { t: 16, r: 24, b: 36, l: 58 };

    const x = d3
      .scaleUtc()
      .domain(d3.extent(rs, (d) => d.epoch_ms))
      .range([m.l, width - m.r]);
    const y = d3
      .scaleLog()
      .domain([Math.max(0.04, d3.min(rs, (d) => d.dist_ld) * 0.8), data.dist_max_ld])
      .range([height - m.b, m.t]);

    const svg = d3
      .select(container)
      .append('svg')
      .attr('width', width)
      .attr('height', height);

    // gridlines + axes
    svg
      .append('g')
      .selectAll('line')
      .data([0.1, 1, 10])
      .join('line')
      .attr('class', 'gridline')
      .attr('x1', m.l)
      .attr('x2', width - m.r)
      .attr('y1', (v) => y(v))
      .attr('y2', (v) => y(v));

    svg
      .append('g')
      .attr('class', 'axis')
      .attr('transform', `translate(0,${height - m.b})`)
      .call(d3.axisBottom(x).ticks(width / 110).tickFormat(d3.utcFormat('%b %d')).tickSizeOuter(0));

    svg
      .append('g')
      .attr('class', 'axis')
      .attr('transform', `translate(${m.l},0)`)
      .call(d3.axisLeft(y).tickValues([0.1, 0.3, 1, 3, 10, 20]).tickFormat((v) => `${v} LD`));

    svg
      .append('text')
      .attr('class', 'axis-label')
      .attr('transform', `rotate(-90)`)
      .attr('x', -height / 2)
      .attr('y', 14)
      .attr('text-anchor', 'middle')
      .text('MISS DISTANCE (LOG)');

    // lunar orbit reference
    svg
      .append('line')
      .attr('class', 'moon-line')
      .attr('x1', m.l)
      .attr('x2', width - m.r)
      .attr('y1', y(1))
      .attr('y2', y(1));
    svg
      .append('text')
      .attr('class', 'moon-label')
      .attr('x', width - m.r - 4)
      .attr('y', y(1) - 5)
      .attr('text-anchor', 'end')
      .text('[ LUNAR ORBIT ]');

    // contacts
    svg
      .append('g')
      .selectAll('circle')
      .data(rs)
      .join('circle')
      .attr('cx', (d) => x(d.epoch_ms))
      .attr('cy', (d) => y(d.dist_ld))
      .attr('r', pointRadius)
      .attr('fill', (d) => (d.est_diameter_m >= BIG_M ? '#ff3333' : '#33ff33'))
      .attr('fill-opacity', 0.8);

    // hover: crosshair + highlight ring + tooltip, nearest via Delaunay
    const delaunay = d3.Delaunay.from(rs, (d) => x(d.epoch_ms), (d) => y(d.dist_ld));
    const chX = svg.append('line').attr('class', 'crosshair').style('display', 'none');
    const chY = svg.append('line').attr('class', 'crosshair').style('display', 'none');
    const ring = svg
      .append('circle')
      .attr('fill', 'none')
      .attr('stroke', '#00ffff')
      .attr('stroke-width', 1.4)
      .style('display', 'none');

    svg.on('pointermove', (event) => {
      const [px, py] = d3.pointer(event);
      const d = rs[delaunay.find(px, py)];
      const dx = x(d.epoch_ms);
      const dy = y(d.dist_ld);
      chX.attr('x1', dx).attr('x2', dx).attr('y1', m.t).attr('y2', height - m.b).style('display', null);
      chY.attr('x1', m.l).attr('x2', width - m.r).attr('y1', dy).attr('y2', dy).style('display', null);
      ring.attr('cx', dx).attr('cy', dy).attr('r', pointRadius(d) + 4).style('display', null);

      tooltip.classList.remove('hidden');
      tooltip.innerHTML =
        `<div class="tt-name">[ ${d.des.toUpperCase()} ]</div>` +
        `<div>${d.date} // ${d.dist_ld} LD</div>` +
        `<div>${d.v_kps} KM/S` +
        (d.est_diameter_m ? ` // EST ${Math.round(d.est_diameter_m)} M` : '') +
        `</div>`;
      const tw = tooltip.offsetWidth;
      const left = Math.min(event.clientX + 18, window.innerWidth - tw - 12);
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${event.clientY + 16}px`;
    });

    svg.on('pointerleave', () => {
      chX.style('display', 'none');
      chY.style('display', 'none');
      ring.style('display', 'none');
      tooltip.classList.add('hidden');
    });
  }

  // ResizeObserver instead of window resize: also catches late layout
  // settling (fonts, typed-out header) that changes the panel height.
  let lastW = 0;
  let lastH = 0;
  let resizeTimer;
  const ro = new ResizeObserver(() => {
    const { clientWidth: w, clientHeight: h } = container;
    if (w === lastW && h === lastH) return;
    lastW = w;
    lastH = h;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(draw, 120);
  });
  ro.observe(container);
  draw();
}

fetch('./data/neo_history.json')
  .then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  })
  .then(render)
  .catch((err) => {
    const el = $('status-line');
    el.classList.add('alert', 'blink');
    typeInto(el, `ARCHIVE OFFLINE // ${err.message}`, 40);
  });
