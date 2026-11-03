// A run's day, two ways: the summary under (or beside) the calendar, and the full-screen page.
// The summary is the six numbers that matter, the difficulty notches and Kestrel AI's line; desktop adds the route.
// The full page adds the route in 2D or 3D, elevation and heart rate along the run, and the splits.
(function(){
  const esc = (s)=> String(s ?? '').replace(/[&<>"']/g, (c)=> ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const clock = (s)=>{ s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? `${h}:${String(m).padStart(2, '0')}` : m) + ':' + String(x).padStart(2, '0'); };
  const MI = 1609.344, FT = 3.281;
  const LEVEL = ['Not rated', 'Easy', 'Moderate', 'Hard', 'Very hard'];
  const levelOf = (d)=> !d ? 0 : d <= 3 ? 1 : d <= 5 ? 2 : d <= 7 ? 3 : 4;

  // The run the route, chart and splits belong to: the longest running session of the day.
  const mainSession = (x)=> (x?.sessions || []).filter((s)=> s.category !== 'crosstrain').sort((a, b)=> (b.miles || 0) - (a.miles || 0))[0] || null;

  // Day totals. Heart rate is the sessions' average weighted by time; climb adds up across them.
  function totals(x){
    const ss = x?.sessions || [];
    const hr = ss.filter((s)=> s.avg_hr && s.minutes);
    const el = ss.filter((s)=> s.elev_ft != null && !s.track);
    return {
      miles: x?.miles ?? null, minutes: x?.minutes ?? null,
      pace: x?.miles && x?.minutes ? clock(x.minutes * 60 / x.miles) : null,
      difficulty: x?.difficulty ?? null,
      hr: hr.length ? Math.round(hr.reduce((a, s)=> a + s.avg_hr * s.minutes, 0) / hr.reduce((a, s)=> a + s.minutes, 0)) : null,
      elev: el.length ? Math.round(el.reduce((a, s)=> a + s.elev_ft, 0)) : null,
    };
  }

  const stat = (label, val, unit)=> `<div class="kd-stat"><span>${label}</span><b>${val ?? '–'}${val != null && unit ? `<i>${unit}</i>` : ''}</b></div>`;
  function statsHtml(t, wide){
    const diff = t.difficulty ? `<em class="kd-pill l${levelOf(t.difficulty)}"><b>${t.difficulty}</b>${LEVEL[levelOf(t.difficulty)]}</em>` : null;
    return `<div class="kd-stats ${wide ? 'wide' : ''}">
      ${stat('Distance', t.miles != null ? (Math.round(t.miles * 100) / 100).toFixed(2) : null, ' mi')}
      ${stat('Time', t.minutes != null ? clock(t.minutes * 60) : null)}
      ${stat('Pace', t.pace, '/mi')}
      <div class="kd-stat"><span>Difficulty</span>${diff || '<b>–</b>'}</div>
      ${stat('Avg HR', t.hr, ' bpm')}
      ${stat('Elev gain', t.elev, ' ft')}</div>`;
  }

  // Ten notches, filled up to the day's difficulty in the easy-to-very-hard colours.
  function notchesHtml(diff){
    const n = Array.from({ length:10 }, (_, i)=> `<i class="${i < (diff || 0) ? 'on l' + levelOf(i + 1) : ''}"></i>`).join('');
    const lv = levelOf(diff);
    return `<div class="kd-diff"><div class="kd-notches" role="img" aria-label="${diff ? `Difficulty ${diff} of 10, ${LEVEL[lv].toLowerCase()}` : 'Difficulty not rated'}">${n}</div>
      <div class="kd-scale">${[1, 2, 3, 4].map((l)=> `<span class="${l === lv ? 'on l' + l : ''}">${LEVEL[l]}</span>`).join('')}</div></div>`;
  }

  const eye = '<svg viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="6" fill="var(--accent)"/><circle cx="7" cy="7" r="2.2" fill="var(--surface)"/></svg>';

  // ---------------------------------------------------------------- the summary beside the calendar
  // wide: desktop, which leads with the route. own: the day belongs to the signed-in runner (routes are theirs alone).
  function peekHtml(x, wide){
    const t = totals(x), line = x?.day_line || mainSession(x)?.report || '';
    return `${wide ? '<div class="kd-thumb" id="kdThumb" hidden></div>' : ''}
      ${statsHtml(t)}
      ${notchesHtml(t.difficulty)}
      ${line ? `<div class="kd-ai"><div class="kd-eb">${eye}Kestrel AI</div><p>${esc(line)}</p></div>` : ''}`;
  }

  async function mountPeek(x, own){
    const host = document.getElementById('kdThumb'), s = mainSession(x);
    if(!host || !own || !s?.main_id || s.track) return;
    const r = await loadTrack(s.main_id);
    if(!r || !host.isConnected) return;
    host.innerHTML = routeSvg(r, false);
    host.hidden = false;
  }

  // ---------------------------------------------------------------- the full-screen page
  function fullHtml(x){
    const t = totals(x), s = mainSession(x), many = (x?.sessions || []).filter((z)=> z.category !== 'crosstrain').length > 1;
    const reports = (x?.sessions || []).map((z)=> z.report).filter(Boolean);
    const head = x?.day_line || reports.shift() || '';
    const body = [x?.summary, ...reports].filter(Boolean);
    const ai = head || body.length || x?.coach_note
      ? `<div class="kd-eb">${eye}Kestrel AI analysis</div>${head ? `<p class="kd-ai-h">${esc(head)}</p>` : ''}${body.map((b)=> `<p>${esc(b)}</p>`).join('')}${x?.coach_note ? `<div class="kd-next"><b>Next:</b> ${esc(x.coach_note)}</div>` : ''}`
      : `<div class="kd-eb">${eye}Kestrel AI analysis</div><p class="kv-hint">Kestrel AI writes this once the run syncs and it reviews your day.</p>`;
    return `<div class="kd-full">
      <div class="kd-map card" id="kdMap"${s?.main_id && !s.track ? '' : ' hidden'}>
        <div class="kd-map-in" id="kdMap2d"><div class="kv-hint">Loading the route…</div></div>
        <div class="kd-map-in" id="kdMap3d" hidden></div>
        <div class="kd-seg" role="group" aria-label="Map view"><button type="button" class="on" aria-pressed="true" data-kdv="2d">Route</button><button type="button" aria-pressed="false" data-kdv="3d">3D</button></div>
        ${many ? `<div class="kd-maptag">${esc(s.title || 'Main run')} · ${esc(s.miles)} mi</div>` : ''}
      </div>
      <div class="card kv-card kd-sumcard">${statsHtml(t, true)}${notchesHtml(t.difficulty)}</div>
      <div class="kd-cols">
        <section class="card kv-card kd-aicard">${ai}</section>
        <section class="card kv-card kd-chartcard" id="kdChart" hidden></section>
        <section class="card kv-card kd-splitcard" id="kdSplits" hidden></section>
      </div>
    </div>`;
  }

  async function mountFull(x, own){
    const s = mainSession(x);
    const splitsEl = document.getElementById('kdSplits');
    let r = null;
    if(own && s?.main_id && !s.track) r = await loadTrack(s.main_id);
    if(!document.getElementById('kdMap')?.isConnected) return;
    if(r){
      document.getElementById('kdMap2d').innerHTML = routeSvg(r, true);
      wireMap(r);
      mapUnder(document.getElementById('kdMap2d'), r);
      const chart = document.getElementById('kdChart');
      chart.innerHTML = chartHtml(r); chart.hidden = false; wireChart(chart, r);
    } else document.getElementById('kdMap').hidden = true;
    const rows = r ? mileSplits(r.pts) : [];
    const html = rows.length ? splitsHtml(rows, 'Splits', 'Mile') : lapsHtml(s?.splits?.length ? s.splits : x?.split_reps || []);
    if(html && splitsEl){ splitsEl.innerHTML = html; splitsEl.hidden = false; }
  }

  // ---------------------------------------------------------------- data
  const trackCache = {};
  async function loadTrack(id){
    if(id in trackCache) return trackCache[id];
    try{
      const res = await fetch('/api/runs/track?id=' + encodeURIComponent(id), { credentials:'same-origin' });
      const r = res.ok ? await res.json() : null;
      return trackCache[id] = r && !r.error && r.pts?.length > 4 ? withDistance(r) : null;
    }catch(e){ return null; }
  }
  // Running distance (m) along the route, one value per point.
  function withDistance(r){
    const pts = r.pts, kx = Math.cos((r.stats.bounds.s + r.stats.bounds.n) / 2 * Math.PI / 180);
    const ds = [0];
    for(let i = 1; i < pts.length; i++){ const dy = (pts[i][0] - pts[i - 1][0]) * 111320, dx = (pts[i][1] - pts[i - 1][1]) * 111320 * kx; ds.push(ds[i - 1] + Math.hypot(dx, dy)); }
    return { ...r, ds, kx, hasAlt: pts.some((p)=> p[2] != null), hasHr: pts.filter((p)=> p[4]).length > pts.length / 3 };
  }

  // Per-mile splits from the route. Time spent stopped (slower than a walk) is left out, as a watch's moving time does.
  function mileSplits(pts){
    if(!pts.length || pts[0][3] == null) return [];
    const kx = Math.cos(pts[0][0] * Math.PI / 180);
    const out = []; let cur = { m:0, s:0, hrS:0, hrT:0, a0: pts[0][2] };
    for(let i = 1; i < pts.length; i++){
      const p = pts[i], q = pts[i - 1];
      const dm = Math.hypot((p[0] - q[0]) * 111320, (p[1] - q[1]) * 111320 * kx), dt = (p[3] ?? 0) - (q[3] ?? 0);
      if(dt <= 0) continue;
      const moving = dm / dt >= 0.8;
      let left = dm, frac = 1;
      while(cur.m + left >= MI){
        const need = MI - cur.m, f = need / dm;
        cur.m = MI; if(moving) cur.s += dt * f;
        if(p[4]){ cur.hrS += p[4] * dt * f; cur.hrT += dt * f; }
        const a1 = q[2] != null && p[2] != null ? q[2] + (p[2] - q[2]) * (1 - frac + f) : p[2];
        out.push({ ...cur, a1 });
        cur = { m:0, s:0, hrS:0, hrT:0, a0: a1 };
        left -= need; frac -= f;
      }
      cur.m += left; if(moving) cur.s += dt * frac;
      if(p[4]){ cur.hrS += p[4] * dt * frac; cur.hrT += dt * frac; }
      cur.a1 = p[2];
    }
    if(cur.m > 0.05 * MI) out.push(cur);
    return out.map((c, i)=> ({
      label: c.m >= MI - 1 ? String(i + 1) : (c.m / MI).toFixed(2),
      pace: c.s > 0 ? c.s / (c.m / MI) : null,
      hr: c.hrT ? Math.round(c.hrS / c.hrT) : null,
      elev: c.a0 != null && c.a1 != null ? Math.round((c.a1 - c.a0) * FT) : null,
    }));
  }

  // ---------------------------------------------------------------- drawing
  function routeSvg(r, markers){
    const W = 400, H = markers ? 260 : 170, pad = 18, b = r.stats.bounds;
    const w = (b.e - b.w) * r.kx || 1e-5, h = (b.n - b.s) || 1e-5;
    const sc = Math.min((W - 2 * pad) / w, (H - 2 * pad) / h), ox = (W - w * sc) / 2, oy = (H - h * sc) / 2;
    const xy = (p)=> [ox + (p[1] - b.w) * r.kx * sc, H - oy - (p[0] - b.s) * sc];
    const line = r.pts.map((p, i)=> { const [x, y] = xy(p); return (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1); }).join('');
    const a = xy(r.pts[0]), z = xy(r.pts[r.pts.length - 1]);
    let marks = '';
    if(markers){
      for(let m = 1; m * MI < r.ds[r.ds.length - 1]; m++){
        const i = r.ds.findIndex((d)=> d >= m * MI); const [x, y] = xy(r.pts[i]);
        marks += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="7" class="kd-mk"/><text x="${x.toFixed(1)}" y="${(y + 3).toFixed(1)}" class="kd-mkt">${m}</text>`;
      }
    }
    return `<svg viewBox="0 0 ${W} ${H}" class="kd-route" role="img" aria-label="Route of this run, ${(r.ds[r.ds.length - 1] / MI).toFixed(2)} miles"><path d="${line}" class="kd-case"/><path d="${line}" class="kd-line"/>${marks}<circle cx="${a[0].toFixed(1)}" cy="${a[1].toFixed(1)}" r="5" class="kd-start"/><circle cx="${z[0].toFixed(1)}" cy="${z[1].toFixed(1)}" r="5" class="kd-end"/><circle r="6" class="kd-dot" id="kdDot" cx="-20" cy="-20"/></svg>`;
  }

  // The 2D route on a plain street map: streets, water and parks from OpenFreeMap (free, no key), with the
  // buildings, shops and house numbers taken out. Dark at night.
  // The drawn route stays until the map is ready, and stays for good if the tiles can't load.
  let map2d = null;
  async function mapUnder(host, r){
    let gl;
    try{ gl = await window.kRecords?.loadMapLibre?.(); }catch(e){ return; }
    if(!gl || !host.isConnected) return;
    if(map2d){ map2d.remove(); map2d = null; }
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    const box = document.createElement('div'); box.className = 'kd-map-gl'; host.appendChild(box);
    const coords = r.pts.map((p)=> [p[1], p[0]]), b = r.stats.bounds;
    const m = new gl.Map({
      container: box, bounds: [[b.w, b.s], [b.e, b.n]], fitBoundsOptions: { padding: 40 }, cooperativeGestures: true, attributionControl: { compact: true },
      style: `https://tiles.openfreemap.org/styles/${dark ? 'dark' : 'liberty'}`,
    });
    map2d = m;
    m.on('load', ()=>{
      const css = getComputedStyle(document.documentElement), accent = css.getPropertyValue('--accent').trim() || '#e1371a';
      m.getStyle().layers.filter((l)=> /poi|building|housenumber|aeroway|transit/.test(l.id)).forEach((l)=> m.removeLayer(l.id));
      const miles = [];
      for(let k = 1; k * MI < r.ds[r.ds.length - 1]; k++){ const i = r.ds.findIndex((d)=> d >= k * MI); miles.push({ type:'Feature', properties:{ n: k }, geometry:{ type:'Point', coordinates: coords[i] } }); }
      m.addSource('route', { type:'geojson', data:{ type:'Feature', geometry:{ type:'LineString', coordinates: coords } } });
      m.addSource('ends', { type:'geojson', data:{ type:'FeatureCollection', features:[{ type:'Feature', properties:{ c:'#1f8a52' }, geometry:{ type:'Point', coordinates: coords[0] } }, { type:'Feature', properties:{ c:'#17171a' }, geometry:{ type:'Point', coordinates: coords[coords.length - 1] } }] } });
      m.addSource('spot', { type:'geojson', data:{ type:'FeatureCollection', features:[] } });
      m.addLayer({ id:'route-casing', type:'line', source:'route', layout:{ 'line-join':'round', 'line-cap':'round' }, paint:{ 'line-color':'#fff', 'line-width':7 } });
      m.addLayer({ id:'route-line', type:'line', source:'route', layout:{ 'line-join':'round', 'line-cap':'round' }, paint:{ 'line-color': accent, 'line-width':4 } });
      m.addLayer({ id:'ends', type:'circle', source:'ends', paint:{ 'circle-radius':6, 'circle-color':['get', 'c'], 'circle-stroke-color':'#fff', 'circle-stroke-width':2 } });
      m.addLayer({ id:'spot', type:'circle', source:'spot', paint:{ 'circle-radius':7, 'circle-color': accent, 'circle-stroke-color':'#fff', 'circle-stroke-width':2.5 } });
      miles.forEach((f)=>{ const el = document.createElement('span'); el.className = 'kd-mile'; el.textContent = f.properties.n; new gl.Marker({ element: el }).setLngLat(f.geometry.coordinates).addTo(m); });
      host.classList.add('gl');
    });
  }
  // The spot the chart points at, on whichever map is showing.
  function showSpot(r, i){
    if(map2d?.getSource?.('spot')) map2d.getSource('spot').setData({ type:'Point', coordinates:[r.pts[i][1], r.pts[i][0]] });
    const dot = document.getElementById('kdDot'), svg = dot?.ownerSVGElement;
    if(dot && svg){ const ln = svg.querySelector('.kd-line'), len = ln.getTotalLength(); const pt = ln.getPointAtLength(len * (i / (r.pts.length - 1))); dot.setAttribute('cx', pt.x); dot.setAttribute('cy', pt.y); }
  }

  function wireMap(r){
    const box = document.getElementById('kdMap'), m2 = document.getElementById('kdMap2d'), m3 = document.getElementById('kdMap3d');
    box.querySelectorAll('[data-kdv]').forEach((btn)=> btn.addEventListener('click', ()=>{
      const three = btn.dataset.kdv === '3d';
      box.querySelectorAll('[data-kdv]').forEach((b)=> { b.classList.toggle('on', b === btn); b.setAttribute('aria-pressed', String(b === btn)); });
      m2.hidden = three; m3.hidden = !three;
      if(three && !m3.dataset.on){ m3.dataset.on = '1'; window.kRecords?.mount3d?.(m3, r.pts, r.stats); }
    }));
  }

  // Elevation (filled) and heart rate (line) by distance, one grid line a mile. Pointing at it reads out that spot.
  const CW = 600, CH = 200;
  function chartHtml(r){
    const tot = r.ds[r.ds.length - 1] || 1, X = (d)=> (d / tot * CW).toFixed(1);
    const alts = r.pts.map((p)=> p[2]).filter((v)=> v != null), lo = Math.min(...alts), hi = Math.max(lo + 8, ...alts);
    const hrs = r.pts.map((p)=> p[4]).filter(Boolean), hlo = Math.min(...hrs) - 5, hhi = Math.max(hlo + 20, ...hrs) + 3;
    const ay = (a)=> (CH - 12 - (a - lo) / (hi - lo) * (CH * 0.55)).toFixed(1);
    const hy = (v)=> (CH - 12 - (v - hlo) / (hhi - hlo) * (CH - 28)).toFixed(1);
    let grid = ''; for(let m = 1; m * MI < tot; m++) grid += `M${X(m * MI)} 0V${CH - 10}`;
    const elev = r.hasAlt ? r.pts.map((p, i)=> `${X(r.ds[i])} ${ay(p[2] ?? lo)}`).join(' L') : '';
    const hr = r.hasHr ? r.pts.map((p, i)=> p[4] ? `${X(r.ds[i])} ${hy(p[4])}` : null).filter(Boolean).join(' L') : '';
    const miles = Math.floor(tot / MI);
    return `<div class="kd-chart-h"><h2 class="kv-ct">${r.hasHr ? 'Elevation &amp; heart rate' : 'Elevation'}</h2><span class="kd-sub">↑${Math.round(r.stats.gain_m * FT)} ft · ↓${Math.round(r.stats.loss_m * FT)} ft</span></div>
      <div class="kd-keys"><span><i class="ke"></i>Elevation</span>${r.hasHr ? '<span><i class="kh"></i>Heart rate</span>' : ''}</div>
      <div class="kd-read" id="kdRead">Point at the chart to read a spot on the run.</div>
      <div class="kd-plot"><svg viewBox="0 0 ${CW} ${CH}" preserveAspectRatio="none" role="img" aria-label="Elevation${r.hasHr ? ' and heart rate' : ''} along the run, ${Math.round(lo * FT)} to ${Math.round(hi * FT)} feet">
        <path d="${grid}" class="kd-grid"/>
        ${elev ? `<path d="M0 ${CH - 10} L${elev} L${CW} ${CH - 10} Z" class="kd-elev"/>` : ''}
        ${hr ? `<path d="M${hr}" class="kd-hr"/>` : ''}
        <path d="M-10 0V${CH}" class="kd-cur" id="kdCur"/></svg></div>
      <div class="kd-ticks" style="--n:${Math.max(1, miles)}">${Array.from({ length: miles }, (_, i)=> `<span>${i + 1}</span>`).join('')}</div>`;
  }

  function wireChart(el, r){
    const plot = el.querySelector('.kd-plot'), cur = document.getElementById('kdCur'), read = document.getElementById('kdRead');
    const tot = r.ds[r.ds.length - 1];
    const at = (ev)=>{
      const box = plot.getBoundingClientRect(), f = Math.min(1, Math.max(0, (ev.clientX - box.left) / box.width));
      const d = f * tot, i = Math.max(0, r.ds.findIndex((v)=> v >= d)), p = r.pts[i];
      // Pace over the tenth of a mile around the spot.
      const j0 = r.ds.findIndex((v)=> v >= d - 80), j1 = r.ds.findIndex((v)=> v >= d + 80);
      const a = r.pts[Math.max(0, j0)], b = r.pts[j1 < 0 ? r.pts.length - 1 : j1];
      const dd = r.ds[j1 < 0 ? r.ds.length - 1 : j1] - r.ds[Math.max(0, j0)], dt = (b[3] ?? 0) - (a[3] ?? 0);
      cur.setAttribute('d', `M${(f * CW).toFixed(1)} 0V${CH}`);
      read.innerHTML = [`mi ${(d / MI).toFixed(1)}`, dt > 0 && dd > 20 ? clock(dt / (dd / MI)) + '/mi' : null, p[4] ? p[4] + ' bpm' : null, p[2] != null ? Math.round(p[2] * FT) + ' ft' : null].filter(Boolean).map((s)=> `<span>${s}</span>`).join('');
      read.classList.add('on');
      showSpot(r, i);
    };
    plot.addEventListener('pointermove', at);
    plot.addEventListener('pointerdown', at);
  }

  function splitsHtml(rows, title){
    const ps = rows.map((x)=> x.pace).filter(Boolean), fast = Math.min(...ps), slow = Math.max(...ps);
    const w = (p)=> !p ? 0 : slow === fast ? 70 : Math.round(30 + (slow - p) / (slow - fast) * 65);
    const hasHr = rows.some((x)=> x.hr), hasEl = rows.some((x)=> x.elev != null);
    return `<h2 class="kv-ct">${title}</h2>
      <div class="kd-split hd"><span>Mile</span><span>Pace</span><span></span><span>${hasHr ? 'HR' : ''}</span><span>${hasEl ? 'Elev' : ''}</span></div>
      ${rows.map((x)=> `<div class="kd-split"><span class="m">${esc(x.label)}</span><b>${x.pace ? clock(x.pace) : '–'}</b><span class="bar"><i style="width:${w(x.pace)}%"></i></span><span>${x.hr ?? ''}</span><span class="m">${x.elev == null ? '' : (x.elev > 0 ? '+' : x.elev < 0 ? '−' : '') + Math.abs(x.elev) + ' ft'}</span></div>`).join('')}`;
  }

  // No route: the watch laps or the reps logged by hand.
  function lapsHtml(laps){
    const rows = (laps || []).filter((l)=> l.m && l.s).map((l)=> ({ label: l.m >= 1000 ? (l.m / MI).toFixed(2) + ' mi' : Math.round(l.m) + ' m', pace: l.s / (l.m / MI), hr: l.hr || null, elev: null }));
    return rows.length ? splitsHtml(rows, 'Laps').replace('<span>Mile</span>', '<span>Lap</span>') : '';
  }

  window.KDay = { peekHtml, mountPeek, fullHtml, mountFull, notchesHtml, levelOf, mileSplits };
})();
