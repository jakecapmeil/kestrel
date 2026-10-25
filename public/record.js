// Record: track a run with the phone's GPS (Record tab), then save it to the training log or export a GPX file.
// Runs after the main script, which owns $, escapeHtml, apiPost, activePersonId, todayKey and isRealPerson.
// Browsers only deliver GPS while the page is open, so the screen is kept awake (wake lock) while recording.
(function(){
  const MI = 1609.344;
  const KEY = 'kestrel.recording';
  const MAX_ACC = 35;          // metres: fixes worse than this are ignored
  const MAX_SPEED = 12;        // m/s: faster than a sprinter is a GPS jump
  const MIN_STEP = 3;          // metres: ignore jitter while standing still
  const R = { state:'idle', pts:[], dist:0, el:0, splits:[], lastT:0, tickAt:0, startedAt:0, acc:null, watch:null, timer:null, saveTimer:null, lock:null, summary:null, err:'' };

  const pad = (n)=> String(n).padStart(2, '0');
  function clock(sec){
    sec = Math.max(0, Math.round(sec));
    const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }
  const pace = (distM, sec)=> distM > 20 && sec > 0 ? clock(sec / distM * MI) : '–:––';
  const miles = (m)=> (m / MI).toFixed(2);
  function haversine(a, b){
    const rad = Math.PI / 180, dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
    return 12742000 * Math.asin(Math.sqrt(x));
  }
  const root = ()=> document.getElementById('recRoot');
  const esc = (s)=> escapeHtml(String(s ?? ''));

  // ---------- persistence (a refresh or crash shouldn't lose a run)
  function persist(){
    try{
      if(R.state === 'idle' || R.state === 'done') return localStorage.removeItem(KEY);
      localStorage.setItem(KEY, JSON.stringify({ state:R.state, pts:R.pts.slice(-20000), dist:R.dist, el:R.el, splits:R.splits, startedAt:R.startedAt }));
    }catch(e){}
  }
  function restore(){
    try{
      const d = JSON.parse(localStorage.getItem(KEY) || 'null');
      if(!d || !d.pts) return;
      Object.assign(R, { pts:d.pts, dist:d.dist, el:d.el, splits:d.splits || [], startedAt:d.startedAt, state:'paused', lastT:0 });
      document.body.classList.add('rec-live');
    }catch(e){}
  }

  // ---------- GPS
  function watchStart(){
    if(R.watch !== null) return;
    if(!('geolocation' in navigator)){ R.err = 'This browser has no GPS access.'; return; }
    R.watch = navigator.geolocation.watchPosition(onFix, (e)=>{
      R.err = e.code === 1 ? 'Location is blocked. Allow it for this site in your browser settings.' : 'Waiting for a GPS signal…';
      paintLive();
    }, { enableHighAccuracy:true, maximumAge:0, timeout:20000 });
  }
  function watchStop(){
    if(R.watch !== null) navigator.geolocation.clearWatch(R.watch);
    R.watch = null;
  }

  function onFix(p){
    R.err = '';
    R.acc = p.coords.accuracy;
    if(R.state === 'recording' && p.coords.accuracy <= MAX_ACC){
      const pt = { lat:p.coords.latitude, lon:p.coords.longitude, t:p.timestamp, alt:p.coords.altitude ?? null };
      const last = R.pts.length && R.lastT ? R.pts[R.pts.length - 1] : null;
      if(!last){ pt.el = elapsed(); R.pts.push(pt); R.lastT = pt.t; }
      else{
        const d = haversine(last, pt), dt = (pt.t - last.t) / 1000;
        if(d >= Math.max(MIN_STEP, p.coords.accuracy * 0.25) && dt > 0 && d / dt <= MAX_SPEED){
          const before = R.dist;
          R.dist += d;
          pt.el = elapsed();
          // A mile mark falls somewhere between the last point and this one.
          for(let k = Math.floor(before / MI) + 1; k * MI <= R.dist; k++){
            const f = (k * MI - before) / d;
            const at = last.el + (pt.el - last.el) * f;
            const prev = R.splits.length ? R.splits.reduce((a, x)=> a + x.s, 0) : 0;
            R.splits.push({ m:Math.round(MI), s:Math.round((at - prev) * 10) / 10 });
          }
          R.pts.push(pt); R.lastT = pt.t;
        }
      }
    }
    paintLive();
  }

  // Moving time counts only while recording.
  function elapsed(){ return R.el + (R.state === 'recording' && R.tickAt ? (Date.now() - R.tickAt) / 1000 : 0); }
  function tick(){ paintLive(); }
  function startClock(){ R.tickAt = Date.now(); clearInterval(R.timer); R.timer = setInterval(tick, 500); clearInterval(R.saveTimer); R.saveTimer = setInterval(()=>{ bank(); persist(); }, 5000); }
  function bank(){ if(R.state === 'recording' && R.tickAt){ R.el += (Date.now() - R.tickAt) / 1000; R.tickAt = Date.now(); } }
  function stopClock(){ bank(); R.tickAt = 0; clearInterval(R.timer); clearInterval(R.saveTimer); }

  async function lockOn(){ try{ if('wakeLock' in navigator) R.lock = await navigator.wakeLock.request('screen'); }catch(e){} }
  function lockOff(){ try{ R.lock?.release(); }catch(e){} R.lock = null; }
  document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState === 'visible' && R.state === 'recording') lockOn(); });

  // ---------- actions
  function start(){
    Object.assign(R, { state:'recording', pts:[], dist:0, el:0, splits:[], lastT:0, startedAt:Date.now(), summary:null });
    document.body.classList.add('rec-live');
    watchStart(); startClock(); lockOn(); persist(); render();
  }
  function pause(){ stopClock(); R.state = 'paused'; R.lastT = 0; persist(); render(); }
  function resume(){ R.state = 'recording'; R.lastT = 0; watchStart(); startClock(); lockOn(); persist(); render(); }
  function finish(){
    stopClock();
    const total = R.el;
    // The part of the last mile still being run is a split too (when it's long enough to mean something).
    const done = R.splits.reduce((a, x)=> a + x.m, 0);
    const rest = R.dist - done;
    const prevSec = R.splits.reduce((a, x)=> a + x.s, 0);
    const splits = R.splits.slice();
    if(rest >= 100) splits.push({ m:Math.round(rest), s:Math.round((total - prevSec) * 10) / 10, partial:true });
    R.summary = { dist:R.dist, sec:total, splits, date:new Date(R.startedAt || Date.now()) };
    R.state = 'done';
    watchStop(); lockOff(); persist();
    document.body.classList.remove('rec-live');
    render();
  }
  function discard(){
    if(!confirm('Discard this run?')) return;
    stopClock(); watchStop(); lockOff();
    Object.assign(R, { state:'idle', pts:[], dist:0, el:0, splits:[], summary:null });
    document.body.classList.remove('rec-live');
    persist(); render(); previewGps();
  }

  async function save(btn){
    if(!isRealPerson()){ alert('Pick a person first (You tab) to save this run to their log.'); return; }
    const sm = R.summary, mi = sm.dist / MI;
    const date = todayKeyOf(sm.date);
    btn.disabled = true;
    try{
      const res = await fetch(`/api/log?personId=${encodeURIComponent(activePersonId)}&from=${date}&to=${date}`, { cache:'no-store' });
      const day = (await res.json()).days?.[0] || null;
      const fields = {};
      const effort = Number(document.getElementById('recEffort')?.value);
      const note = (document.getElementById('recNote')?.value || '').trim();
      const tag = `Recorded with Kestrel GPS: ${mi.toFixed(2)} mi in ${clock(sm.sec)} (${pace(sm.dist, sm.sec)}/mi).`;
      if(!day?.locked){
        fields.manual_miles = Math.round(((day?.miles || 0) + mi) * 100) / 100;
        fields.minutes = Math.round((day?.minutes || 0) + sm.sec / 60);
        fields.runs = (day?.runs || 0) + 1;
        if(effort >= 1 && effort <= 10) fields.difficulty = Math.round(effort);
        if(!(day?.split_reps || []).length && sm.splits.length > 1) fields.split_reps = sm.splits.map(x=>({ m:x.m, s:x.s, rest:'' }));
      }
      fields.notes = [day?.notes, note, tag].filter(Boolean).join('\n');
      const out = await apiPost('/api/log/day', { personId:activePersonId, date, fields });
      if(!out || out.error) throw new Error(out?.error || 'Couldn’t save. Check your connection.');
      R.summary.saved = true;
      Object.assign(R, { state:'idle', pts:[], dist:0, el:0, splits:[] });
      persist();
      R.summary = { saved:true, mi, sec:sm.sec };
      render(); previewGps();
      try{ if(typeof tlDays === 'object') tlDirty = false; window.dispatchEvent(new Event('kestrel:log-changed')); }catch(e){}
    }catch(e){ alert(e.message); btn.disabled = false; }
  }
  const todayKeyOf = (d)=> `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  function gpx(){
    const pts = R.summary?.pts || R.pts;
    const trk = pts.map(p=>`<trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}">${p.alt != null ? `<ele>${p.alt.toFixed(1)}</ele>` : ''}<time>${new Date(p.t).toISOString()}</time></trkpt>`).join('');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Kestrel" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Kestrel run</name><trkseg>${trk}</trkseg></trk></gpx>`;
  }
  function download(){
    const blob = new Blob([gpx()], { type:'application/gpx+xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `kestrel-${todayKeyOf(R.summary?.date || new Date())}.gpx`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=> URL.revokeObjectURL(a.href), 4000);
  }

  // ---------- view
  function routeSvg(){
    const pts = R.pts;
    if(pts.length < 2) return '<svg class="rec-map" viewBox="0 0 300 200" aria-label="Route"><text x="150" y="104" text-anchor="middle" fill="currentColor" opacity=".45" font-size="13" font-family="inherit">Your route draws here</text></svg>';
    const lat0 = pts.reduce((a, p)=> a + p.lat, 0) / pts.length, k = Math.cos(lat0 * Math.PI / 180);
    const xy = pts.map(p=>[p.lon * k, -p.lat]);
    const xs = xy.map(a=>a[0]), ys = xy.map(a=>a[1]);
    const minX = Math.min(...xs), minY = Math.min(...ys), w = Math.max(...xs) - minX || 1e-6, h = Math.max(...ys) - minY || 1e-6;
    const sc = Math.min(260 / w, 160 / h), ox = (300 - w * sc) / 2, oy = (200 - h * sc) / 2;
    const P = xy.map(([x, y])=>[ox + (x - minX) * sc, oy + (y - minY) * sc]);
    const step = Math.ceil(P.length / 400);
    const d = P.filter((_, i)=> i % step === 0 || i === P.length - 1).map(([x, y], i)=> `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
    const [sx, sy] = P[0], [ex, ey] = P[P.length - 1];
    return `<svg class="rec-map" viewBox="0 0 300 200" aria-label="Route"><path d="${d}"/><circle class="start" cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="6"/><circle class="now" cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="7"/></svg>`;
  }
  function recentPace(){
    const pts = R.pts, n = pts.length;
    if(n < 2) return '';
    const last = pts[n - 1];
    let i = n - 2, d = 0;
    while(i >= 0 && last.el - pts[i].el < 30){ d += haversine(pts[i], pts[i + 1]); i--; }
    const span = last.el - pts[Math.max(i, 0)].el;
    return span >= 8 ? pace(d, span) : '';
  }
  function splitsHtml(list){
    if(!list.length) return '';
    return `<ul class="rec-splits">${list.map((x, i)=> `<li><span>${x.partial ? miles(x.m) + ' mi' : 'Mile ' + (i + 1)}</span><span>${clock(x.s)}${x.partial ? ` · ${pace(x.m, x.s)}/mi` : ''}</span></li>`).join('')}</ul>`;
  }
  function gpsBadge(){
    if(R.err) return `<div class="rec-gps bad"><i></i>${esc(R.err)}</div>`;
    if(R.acc == null) return '<div class="rec-gps"><i></i>Finding GPS…</div>';
    const q = R.acc <= 12 ? 'good' : R.acc <= MAX_ACC ? 'fair' : 'bad';
    const t = q === 'good' ? 'GPS ready' : q === 'fair' ? 'GPS weak' : 'GPS too weak, move into the open';
    return `<div class="rec-gps ${q}"><i></i>${t} · ±${Math.round(R.acc)} m</div>`;
  }

  function render(){
    const el = root();
    if(!el) return;
    if(R.state === 'idle'){
      const last = R.summary?.saved ? `<div class="card rec-hero"><div class="card-title">Saved to your log</div><div class="hint">${R.summary.mi.toFixed(2)} mi in ${clock(R.summary.sec)}. Find it under Train › Log.</div></div>` : '';
      el.innerHTML = `<div class="rec">${last}<div class="card rec-hero"><div id="recGps">${gpsBadge()}</div><button type="button" class="rec-go" id="recStart">Start</button><p class="rec-note" style="margin-top:var(--sp-4)">Your phone’s GPS tracks distance, pace and every mile split. Keep this screen open while you run.</p></div></div>`;
      document.getElementById('recStart').onclick = start;
      return;
    }
    if(R.state === 'done'){
      const sm = R.summary;
      el.innerHTML = `<div class="rec"><div class="card rec-hero"><div class="eyebrow">${sm.date.toLocaleDateString(undefined, { weekday:'long', month:'short', day:'numeric' })}</div><div class="rec-big">${miles(sm.dist)}<small>mi</small></div>
        <div class="rec-stats" style="margin-top:var(--sp-4)"><div><b>${clock(sm.sec)}</b><span>Time</span></div><div><b>${pace(sm.dist, sm.sec)}</b><span>Pace /mi</span></div><div><b>${sm.splits.length}</b><span>Splits</span></div></div></div>
        <div class="card">${routeSvg()}${sm.splits.length ? `<div class="card-title" style="margin:var(--sp-4) 0 var(--sp-2)">Splits</div>${splitsHtml(sm.splits)}` : ''}</div>
        <div class="card"><div class="rec-form"><label class="field"><span>How hard? 1-10</span><input type="number" id="recEffort" min="1" max="10" step="1" inputmode="numeric"></label><label class="field full"><span>Notes</span><textarea id="recNote" rows="2" maxlength="500"></textarea></label></div></div>
        <div class="rec-actions"><button type="button" class="ghost" id="recDiscard">Discard</button><button type="button" class="ghost" id="recGpx">GPX</button><button type="button" id="recSave">Save run</button></div></div>`;
      document.getElementById('recDiscard').onclick = discard;
      document.getElementById('recGpx').onclick = download;
      document.getElementById('recSave').onclick = (e)=> save(e.currentTarget);
      return;
    }
    el.innerHTML = `<div class="rec"><div class="card rec-hero"><div id="recGps">${gpsBadge()}</div><div class="rec-big" id="recDist">0.00<small>mi</small></div>
      <div class="rec-stats" style="margin-top:var(--sp-4)"><div><b id="recTime">0:00</b><span>Time</span></div><div><b id="recPace">–:––</b><span>Pace /mi</span></div><div><b id="recAvg">–:––</b><span>Avg /mi</span></div></div></div>
      <div class="card" id="recMapCard"></div>
      <div class="rec-actions">${R.state === 'recording' ? '<button type="button" class="ghost" id="recPause">Pause</button>' : '<button type="button" id="recResume">Resume</button>'}<button type="button" class="stop" id="recFinish">Finish</button></div>
      ${R.state === 'paused' ? '<p class="rec-note">Paused. The clock and distance are stopped.</p>' : '<p class="rec-note">Keep this screen open; locking the phone can pause GPS in the browser.</p>'}</div>`;
    const bind = (id, fn)=>{ const b = document.getElementById(id); if(b) b.onclick = fn; };
    bind('recPause', pause); bind('recResume', resume);
    bind('recFinish', ()=>{ if(R.dist < 50 && !confirm('That’s a very short run. Finish anyway?')) return; finish(); });
    paintLive(true);
  }

  let lastSplits = -1, lastPts = -1;
  function paintLive(force){
    if(R.state === 'idle'){ const g = document.getElementById('recGps'); if(g) g.innerHTML = gpsBadge(); return; }
    const set = (id, v)=>{ const n = document.getElementById(id); if(n && n.textContent !== v) n.textContent = v; };
    if(!document.getElementById('recDist')) return;
    const sec = elapsed();
    const dist = document.getElementById('recDist');
    if(dist.firstChild.textContent !== miles(R.dist)) dist.firstChild.textContent = miles(R.dist);
    set('recTime', clock(sec)); set('recAvg', pace(R.dist, sec)); set('recPace', recentPace() || '–:––');
    const g = document.getElementById('recGps'); if(g) g.innerHTML = gpsBadge();
    if(force || R.pts.length !== lastPts || R.splits.length !== lastSplits){
      lastPts = R.pts.length; lastSplits = R.splits.length;
      const m = document.getElementById('recMapCard');
      if(m) m.innerHTML = routeSvg() + (R.splits.length ? `<div class="card-title" style="margin:var(--sp-4) 0 var(--sp-2)">Splits</div>${splitsHtml(R.splits)}` : '');
    }
  }

  // An idle Record tab warms the GPS so Start has a fix.
  function previewGps(){
    if(R.state !== 'idle') return;
    if(R.watch === null) watchStart();
  }

  window.kRecord = {
    show(){
      if(R.state === 'idle' && !R.restored){ R.restored = true; restore(); }
      render();
      previewGps();
    },
    leave(){ if(R.state === 'idle') watchStop(); },
  };
  window.addEventListener('beforeunload', persist);
})();
