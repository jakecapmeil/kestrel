// Records (You > Records): personal records that keep themselves up to date, the courses you follow
// ("my 5K at Van Cortlandt"), the course picker, and the GPS route of a run (2D, elevation, 3D terrain).
// Runs after the main script, which owns $, escapeHtml, apiPost and the people list.
(function(){
  const STD = ['100','200','400','600','800','1000','1600','3200','5K','2000 SC','3000 SC'];
  const PH = { '100':'ss.s', '200':'ss.s', '400':'ss.s', '600':'m:ss.s', '800':'m:ss', '1000':'m:ss', '1600':'m:ss', '3200':'mm:ss', '5K':'mm:ss', '2000 SC':'m:ss', '3000 SC':'mm:ss' };
  const NAME = { '100':'100 m', '200':'200 m', '400':'400 m', '600':'600 m', '800':'800 m', '1000':'1000 m', '1600':'1600 m', '3200':'3200 m', '5K':'5K', '2000 SC':'2000 m steeple', '3000 SC':'3000 m steeple' };
  const esc = (s)=> escapeHtml(String(s ?? ''));

  const S = { prs:{}, tracked:[], courses:{}, catalogue:null, stats:{}, distances:[], loaded:false };
  let saveTimer = null;

  const keyOf = (id, m)=> `course:${id}:${Math.round(m)}`;
  const parseKey = (k)=> { const x = /^course:([a-z0-9-]{1,40}):(\d{3,6})$/.exec(k); return x ? { id:x[1], m:Number(x[2]) } : null; };
  const distLabel = (m)=> { const d = S.distances.find(x=> x.m === Math.round(m)); return d ? d.label : m >= 1000 ? (Math.round(m / 100) / 10) + 'K' : Math.round(m) + ' m'; };
  const courseName = (id)=> S.courses[id]?.name || (S.catalogue || []).find(c=> c.id === id)?.name || 'Course';
  const prDate = (iso)=> iso ? new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { month:'short', day:'numeric', year:'numeric' }) : '';

  async function getJson(path){
    const res = await fetch(path, { cache:'no-store' });
    const data = await res.json();
    if(!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  // The course catalogue and what each course looks like in the runs people tagged there.
  async function ensureCourses(force){
    if(S.catalogue && !force) return S.catalogue;
    const d = await getJson('/api/courses');
    S.catalogue = d.courses; S.stats = d.stats || {}; S.distances = d.distances || []; S.tracked = d.tracked;
    return S.catalogue;
  }

  // Keep the rest of the app in step when a PR changes: the person's prs string and the Fitness caches.
  function adopt(prs){
    S.prs = prs;
    const p = typeof isRealPerson === 'function' && isRealPerson() ? people.find(x=>x.id === activePersonId) : null;
    if(p) p.prs = JSON.stringify(prs);
    try{ library = null; fitnessData = null; }catch(e){}
  }

  // ------------------------------------------------------------ the Records view

  function prRow(key, label, sub){
    const v = S.prs[key] || {};
    const auto = v.auto ? '<span class="badge tone-int-1" title="Found from your runs. Type a faster or different time to replace it.">Auto</span>' : v.time ? '<span class="badge">Typed</span>' : '';
    return `<div class="pr-row rec-row">
      <span class="pr-ev">${esc(label)}${sub ? `<small>${esc(sub)}</small>` : ''}</span>
      <input type="text" data-pr="${esc(key)}" value="${esc(v.time || '')}" placeholder="${esc(PH[key] || 'mm:ss')}" maxlength="10" inputmode="decimal" autocomplete="off" aria-label="${esc(label)} time">
      <input type="date" data-prdate="${esc(key)}" value="${esc(v.date || '')}" aria-label="${esc(label)} date">
      <span class="rec-flag">${auto}</span>
    </div>`;
  }

  function courseKeys(){
    // Followed distances first, then any other course PR Kestrel has found.
    const keys = S.tracked.map(t=> keyOf(t.course, t.m));
    Object.keys(S.prs).filter(k=> parseKey(k) && !keys.includes(k)).forEach(k=> keys.push(k));
    return keys;
  }

  function drawRecords(){
    const head = '<div class="pr-row rec-row head"><span>Event</span><span>Time</span><span>When</span><span></span></div>';
    $('recStd').innerHTML = head + STD.map(k=> prRow(k, NAME[k])).join('');
    const keys = courseKeys();
    $('recCourseList').innerHTML = keys.length
      ? `<div class="rec-course">${head}<span></span></div>` + keys.map(k=>{
          const c = parseKey(k);
          const followed = S.tracked.some(t=> t.course === c.id && t.m === c.m);
          return `<div class="rec-course">${prRow(k, distLabel(c.m), courseName(c.id))}${followed ? `<button type="button" class="rec-x" data-unfollow="${esc(k)}" aria-label="Stop following ${esc(courseName(c.id))} ${esc(distLabel(c.m))}" title="Stop following">×</button>` : '<span></span>'}</div>`;
        }).join('')
      : '<div class="hint">No courses yet. Add Van Cortlandt, Franklin Park or your own, and every race you run there updates its PR.</div>';
    $('recStatus').textContent = '';
    $('recStd').querySelectorAll('input').forEach(i=> i.addEventListener('change', queueSave));
    $('recCourseList').querySelectorAll('input').forEach(i=> i.addEventListener('change', queueSave));
    $('recCourseList').querySelectorAll('[data-unfollow]').forEach(b=> b.addEventListener('click', ()=> unfollow(b.dataset.unfollow)));
  }

  async function render(){
    const p = typeof isRealPerson === 'function' && isRealPerson() ? people.find(x=>x.id === activePersonId) : null;
    $('recHint').style.display = p ? 'none' : '';
    $('recBody').style.display = p ? '' : 'none';
    if(!p) return;
    try{
      // Opening Records re-reads your runs first, so a PR from this morning is already here.
      const [rec] = await Promise.all([getJson('/api/records'), ensureCourses()]);
      S.tracked = rec.tracked; S.courses = rec.courses;
      adopt(rec.prs);
      drawRecords();
    }catch(e){
      $('recStatus').textContent = 'Couldn’t load your records. Check your connection.';
    }
  }

  // Typed PRs save on their own a moment after you stop editing: there is no Save button.
  function queueSave(){
    $('recStatus').textContent = 'Saving…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(savePrs, 500);
  }

  async function savePrs(){
    const next = {};
    document.querySelectorAll('#recBody [data-pr]').forEach(inp=>{
      const k = inp.dataset.pr;
      const time = inp.value.trim();
      const date = document.querySelector(`#recBody [data-prdate="${CSS.escape(k)}"]`)?.value || '';
      const cur = S.prs[k] || {};
      if(time === (cur.time || '') && date === (cur.date || '')) return;
      const v = { time };
      if(date) v.date = date;
      if(cur.meet && !cur.auto) v.meet = cur.meet;
      next[k] = time ? v : { time: '' };
    });
    if(!Object.keys(next).length){ $('recStatus').textContent = ''; return; }
    const res = await apiPost('/api/people/prs', { prs: next });
    if(!res || res.error){ $('recStatus').textContent = res?.error || 'Couldn’t save. Check your connection.'; return; }
    adopt(res.prs);
    const est = res.fitness?.estimates?.find(x=> x.event === '5K');
    drawRecords();
    $('recStatus').textContent = est ? `Saved. Fitness updated: 5K now ${est.time}.` : 'Saved.';
  }

  async function unfollow(key){
    const c = parseKey(key);
    const tracked = S.tracked.filter(t=> !(t.course === c.id && t.m === c.m));
    const res = await apiPost('/api/courses/track', { tracked });
    if(!res || res.error){ $('recStatus').textContent = res?.error || 'Couldn’t update.'; return; }
    S.tracked = res.tracked; fitnessData = null;
    drawRecords();
  }

  // ------------------------------------------------------------ the course picker

  // mode 'follow': pick a course and the distances you race on it. mode 'tag': pick the course a run was on.
  let modalCb = null;
  function openPicker(mode, cb){
    modalCb = cb || null;
    $('courseModalTitle').textContent = mode === 'tag' ? 'Which course was this?' : 'Follow a course';
    $('courseModalOverlay').classList.add('show');
    ensureCourses().then(()=> pickerList(mode, ''));
  }
  function closePicker(){ $('courseModalOverlay').classList.remove('show'); modalCb = null; }

  function courseRow(c){
    const st = S.stats[c.id];
    const meta = [c.place, st ? `about ${st.climb_ft_per_mi} ft of climb per mile (${st.runs} runs)` : '', c.has_gps ? 'found from your GPS' : ''].filter(Boolean).join(' · ');
    return `<button type="button" class="course-opt" data-course="${esc(c.id)}"><b>${esc(c.name)}</b><small>${esc(meta)}</small></button>`;
  }

  function pickerList(mode, q){
    const term = q.trim().toLowerCase();
    const list = (S.catalogue || []).filter(c=> !term || (c.name + ' ' + c.place).toLowerCase().includes(term));
    $('courseModalBody').innerHTML = `
      <input type="search" id="courseSearch" placeholder="Search courses (name or city)" value="${esc(q)}" autocomplete="off" aria-label="Search courses">
      <div class="course-list">${list.map(courseRow).join('') || '<div class="hint">No course by that name yet.</div>'}</div>
      <button type="button" class="ghost" id="courseNew">Can’t find it? Add a new course</button>`;
    const search = $('courseSearch');
    search.addEventListener('input', ()=>{ const pos = search.selectionStart; pickerList(mode, search.value); const s2 = $('courseSearch'); s2.focus(); s2.setSelectionRange(pos, pos); });
    $('courseModalBody').querySelectorAll('[data-course]').forEach(b=> b.addEventListener('click', ()=> chosen(mode, b.dataset.course)));
    $('courseNew').addEventListener('click', ()=> newCourseForm(mode, search.value));
  }

  function distanceChips(selected, preferred){
    const first = S.distances.filter(d=> preferred.includes(d.m));
    const rest = S.distances.filter(d=> !preferred.includes(d.m));
    return `<div class="chip-wrap" data-chips>${[...first, ...rest].map(d=> `<button type="button" class="chip${selected.includes(d.m) ? ' on' : ''}" data-m="${d.m}" aria-pressed="${selected.includes(d.m)}">${esc(d.label)}</button>`).join('')}</div>`;
  }
  function wireChips(root){
    root.querySelectorAll('[data-chips] .chip').forEach(b=> b.addEventListener('click', ()=>{ b.classList.toggle('on'); b.setAttribute('aria-pressed', String(b.classList.contains('on'))); }));
  }
  const chosenDistances = (root)=> [...root.querySelectorAll('[data-chips] .chip.on')].map(b=> Number(b.dataset.m));

  function chosen(mode, id){
    if(mode === 'tag'){ const cb = modalCb; closePicker(); if(cb) cb(id); return; }
    const c = S.catalogue.find(x=> x.id === id);
    $('courseModalBody').innerHTML = `
      <div><b>${esc(c.name)}</b><div class="hint">${esc(c.place)}</div></div>
      <div class="hint">Which distances do you race here? Each one gets its own PR and its own predicted time.</div>
      ${distanceChips(c.distances.slice(0, 1), c.distances)}
      <div class="cluster"><button type="button" id="courseFollow">Follow</button><button type="button" class="ghost" id="courseBack">Back</button></div>
      <div class="hint" id="courseMsg"></div>`;
    wireChips($('courseModalBody'));
    $('courseBack').addEventListener('click', ()=> pickerList(mode, ''));
    $('courseFollow').addEventListener('click', ()=> follow(id, chosenDistances($('courseModalBody'))));
  }

  async function follow(id, ms){
    if(!ms.length){ $('courseMsg').textContent = 'Pick at least one distance.'; return; }
    const tracked = [...S.tracked];
    ms.forEach(m=> { if(!tracked.some(t=> t.course === id && t.m === m)) tracked.push({ course:id, m }); });
    $('courseMsg').textContent = 'Saving…';
    const res = await apiPost('/api/courses/track', { tracked });
    if(!res || res.error){ $('courseMsg').textContent = res?.error || 'Couldn’t save. Check your connection.'; return; }
    S.tracked = res.tracked; fitnessData = null;
    closePicker();
    await render();
  }

  function newCourseForm(mode, name){
    $('courseModalBody').innerHTML = `
      <div class="hint">Courses are shared: once you add it, anyone on Kestrel can pick it. Check the list first so it isn’t there twice.</div>
      <label class="field"><span>Course name</span><input type="text" id="newCourseName" maxlength="80" value="${esc(name)}" placeholder="Franklin Park"></label>
      <label class="field"><span>City and state</span><input type="text" id="newCoursePlace" maxlength="80" placeholder="Boston, MA"></label>
      <div class="hint">Distances you race on it</div>
      ${distanceChips([5000], [5000])}
      <div class="cluster"><button type="button" id="courseCreate">Add course</button><button type="button" class="ghost" id="courseBack">Back</button></div>
      <div class="hint" id="courseMsg"></div>`;
    wireChips($('courseModalBody'));
    $('courseBack').addEventListener('click', ()=> pickerList(mode, name));
    $('courseCreate').addEventListener('click', async ()=>{
      const body = { name:$('newCourseName').value, place:$('newCoursePlace').value, distances: chosenDistances($('courseModalBody')) };
      $('courseMsg').textContent = 'Adding…';
      const res = await apiPost('/api/courses', body);
      if(!res || res.error){ $('courseMsg').textContent = res?.error || 'Couldn’t add it. Check your connection.'; return; }
      await ensureCourses(true);
      if(res.existing) $('courseMsg').textContent = '';
      chosen(mode, res.course.id);
    });
  }

  // ------------------------------------------------------------ a run's course and route

  // Filled the first time a run is opened.
  async function mountActivity(el){
    if(el.dataset.mounted) return;
    el.dataset.mounted = '1';
    const box = el.querySelector('.act-extra');
    if(!box) return;
    const id = box.dataset.id;
    const draw = async ()=>{
      await ensureCourses();
      const cid = box.dataset.course;
      box.innerHTML = `<div class="act-course-row"><span class="act-k">Course</span>
        <button type="button" class="chip${cid ? ' on' : ''}" data-pick>${cid ? esc(courseName(cid)) : 'Choose course'}</button>
        ${cid ? '<button type="button" class="link-quiet" data-clear>Not a course run</button>' : ''}
        ${box.dataset.gps === '1' ? '<button type="button" class="chip" data-route>Route</button>' : ''}</div>
        <div class="act-course-msg hint"></div><div class="act-route"></div>`;
      box.querySelector('[data-pick]').onclick = ()=> openPicker('tag', (course)=> setCourse(course));
      const clear = box.querySelector('[data-clear]'); if(clear) clear.onclick = ()=> setCourse('none');
      const rb = box.querySelector('[data-route]'); if(rb) rb.onclick = ()=> toggleRoute(box, id);
    };
    const setCourse = async (course)=>{
      const msg = box.querySelector('.act-course-msg');
      msg.textContent = 'Saving…';
      const res = await apiPost('/api/runs/course', { strava_id: id, course_id: course });
      if(!res || res.error){ msg.textContent = res?.error || 'Couldn’t save. Check your connection.'; return; }
      box.dataset.course = course === 'none' ? '' : course;
      adopt(res.prs);
      await draw();
      const found = (res.new_prs || []).map(x=> `${x.event.startsWith('course:') ? distLabel(parseKey(x.event).m) + ' at ' + courseName(parseKey(x.event).id) : x.event} ${x.time}`);
      box.querySelector('.act-course-msg').textContent = found.length ? `New PR: ${found.join(', ')}.` : course === 'none' ? 'Saved. PRs from this run were rechecked.' : 'Saved. Fitness and PRs updated.';
    };
    draw().then(()=> { if(routeOpenId === id) toggleRoute(box, id); });
  }

  // Which run's route is open, so it comes back when the log redraws (a sync does that).
  let routeOpenId = null;
  async function toggleRoute(box, id){
    const out = box.querySelector('.act-route');
    if(out.dataset.open){ out.innerHTML = ''; delete out.dataset.open; routeOpenId = null; return; }
    out.dataset.open = '1'; routeOpenId = id;
    out.innerHTML = '<div class="hint">Loading the route…</div>';
    try{
      const r = await getJson('/api/runs/track?id=' + encodeURIComponent(id));
      if(r.error){ out.innerHTML = `<div class="hint">${esc(r.note || 'No route for this run.')}</div>`; return; }
      drawRoute(out, r);
    }catch(e){ out.innerHTML = '<div class="hint">Couldn’t load the route. Check your connection.</div>'; }
  }

  // The route flat on the page, with the climb under it. No map tiles, so it always works.
  function drawRoute(out, r){
    const pts = r.pts, st = r.stats;
    const W = 320, H = 200, pad = 14;
    const lat0 = (st.bounds.s + st.bounds.n) / 2, kx = Math.cos(lat0 * Math.PI / 180);
    const w = (st.bounds.e - st.bounds.w) * kx || 1e-5, h = (st.bounds.n - st.bounds.s) || 1e-5;
    const sc = Math.min((W - 2 * pad) / w, (H - 2 * pad) / h);
    const ox = (W - w * sc) / 2, oy = (H - h * sc) / 2;
    const xy = (p)=> [ox + (p[1] - st.bounds.w) * kx * sc, H - oy - (p[0] - st.bounds.s) * sc];
    const line = pts.map((p,i)=> { const [x,y] = xy(p); return (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1); }).join('');
    const a = xy(pts[0]), b = xy(pts[pts.length - 1]);
    // Elevation profile by distance.
    const alts = pts.map(p=> p[2]), hasAlt = alts.some(v=> v != null);
    let prof = '';
    if(hasAlt){
      const lo = st.min_alt_m, hi = Math.max(st.max_alt_m, lo + 5);
      let d = 0; const xs = [0];
      for(let i = 1; i < pts.length; i++){ const dy = (pts[i][0] - pts[i-1][0]) * 111320, dx = (pts[i][1] - pts[i-1][1]) * 111320 * kx; d += Math.hypot(dx, dy); xs.push(d); }
      const tot = d || 1;
      const path = pts.map((p,i)=> `${(xs[i] / tot * W).toFixed(1)} ${(70 - ((p[2] ?? lo) - lo) / (hi - lo) * 60).toFixed(1)}`);
      prof = `<svg viewBox="0 0 ${W} 76" class="route-prof" role="img" aria-label="Elevation profile, ${Math.round(lo * 3.281)} to ${Math.round(hi * 3.281)} feet"><path d="M0 74L${path.join('L')}L${W} 74Z" class="route-fill"/><path d="M${path.join('L')}" class="route-line"/></svg>`;
    }
    const ft = (m)=> Math.round(m * 3.281).toLocaleString();
    out.innerHTML = `<div class="route">
      <svg viewBox="0 0 ${W} ${H}" class="route-map" role="img" aria-label="Route of this run"><path d="${line}" class="route-path"/><circle cx="${a[0].toFixed(1)}" cy="${a[1].toFixed(1)}" r="5" class="route-start"/><circle cx="${b[0].toFixed(1)}" cy="${b[1].toFixed(1)}" r="5" class="route-end"/></svg>
      ${prof}
      <div class="route-stats"><span><b>${(st.distance_m / 1609.344).toFixed(2)}</b> mi</span>${hasAlt ? `<span><b>${ft(st.gain_m)}</b> ft up</span><span><b>${ft(st.loss_m)}</b> ft down</span>` : ''}</div>
      <div class="cluster"><button type="button" class="chip" data-3d>View in 3D</button></div>
      <div class="route-3d" hidden></div></div>`;
    out.querySelector('[data-3d]').onclick = (e)=> toggle3d(out.querySelector('.route-3d'), e.currentTarget, pts, st);
  }

  // 3D terrain: MapLibre with a public elevation tileset, loaded only when asked for.
  let mapLibre = null;
  function loadMapLibre(){
    if(window.maplibregl) return Promise.resolve(window.maplibregl);
    if(mapLibre) return mapLibre;
    mapLibre = new Promise((resolve, reject)=>{
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.css'; document.head.appendChild(css);
      const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.js';
      s.onload = ()=> resolve(window.maplibregl); s.onerror = ()=> { mapLibre = null; reject(new Error('maplibre')); };
      document.head.appendChild(s);
    });
    return mapLibre;
  }

  let map3d = null;
  async function toggle3d(host, btn, pts, st){
    if(!host.hidden){ host.hidden = true; btn.textContent = 'View in 3D'; if(map3d){ map3d.remove(); map3d = null; } return; }
    host.hidden = false; btn.textContent = 'Hide 3D';
    host.innerHTML = '<div class="hint">Loading terrain…</div>';
    try{
      const gl = await loadMapLibre();
      host.innerHTML = '';
      if(map3d){ map3d.remove(); map3d = null; }
      const coords = pts.map(p=> [p[1], p[0]]);
      map3d = new gl.Map({
        container: host, center: coords[Math.floor(coords.length / 2)], zoom: 14, pitch: 65, bearing: 20, maxPitch: 80, attributionControl: { compact: true },
        style: { version: 8,
          sources: {
            osm: { type:'raster', tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize:256, maxzoom:19, attribution:'© OpenStreetMap contributors' },
            dem: { type:'raster-dem', tiles:['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], encoding:'terrarium', tileSize:256, maxzoom:15, attribution:'Terrain: Mapzen, USGS, NASA' },
          },
          layers: [{ id:'osm', type:'raster', source:'osm' }],
          terrain: { source:'dem', exaggeration: 1.5 },
        },
      });
      map3d.addControl(new gl.NavigationControl({ visualizePitch:true }), 'top-right');
      map3d.on('load', ()=>{
        map3d.addSource('route', { type:'geojson', data:{ type:'Feature', geometry:{ type:'LineString', coordinates: coords } } });
        map3d.addLayer({ id:'route-casing', type:'line', source:'route', layout:{ 'line-join':'round', 'line-cap':'round' }, paint:{ 'line-color':'#fff', 'line-width':8 } });
        map3d.addLayer({ id:'route-line', type:'line', source:'route', layout:{ 'line-join':'round', 'line-cap':'round' }, paint:{ 'line-color':'#e1371a', 'line-width':4.5 } });
        const b = st.bounds;
        map3d.fitBounds([[b.w, b.s], [b.e, b.n]], { padding: 40, pitch: 65, bearing: 20, duration: 0 });
      });
      map3d.on('error', (e)=> { if(e?.error?.message && /Failed to fetch|NetworkError/i.test(e.error.message)) host.setAttribute('data-offline', '1'); });
    }catch(e){
      host.innerHTML = '<div class="hint">Couldn’t load the 3D view (it needs a network connection to the map tiles). The route above still works.</div>';
    }
  }

  window.kRecords = { render, openPicker, closePicker, mountActivity, ensureCourses, courseName, state: S };
})();
