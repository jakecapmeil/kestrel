// The redesigned screens, part two: Calendar (your training and the team's), a run's own page and its editor,
// Body (recovery, cross-training, fuel) and Team. Shares views.js's helpers through window.KV.
(function(){
  const SCREENS = window.KV.screens, ACT = window.KV.act, V = window.KV.state;
  const { esc, sec, card, tiles, need, hero, empty, noTeam, toast, getJson, post, logRange, weekStart, intensity, runTitle, paceOf, saveDayFields, iso, nice, clock, secs, push, redraw, ICON, feelCard, eventCard, spark, latestPost } = window.KV._h;
  const modOn = (id)=> window.kMods ? window.kMods.has(id) : true;
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  // ---------------------------------------------------------------- month grid (your training, or the team's events)
  function monthGrid(y, m, cell, side, act){
    const first = new Date(y, m, 1), lead = (first.getDay() + 6) % 7, n = new Date(y, m + 1, 0).getDate();
    const days = Array(lead).fill(null).concat(Array.from({ length:n }, (_, i)=> iso(new Date(y, m, i + 1))));
    while(days.length % 7) days.push(null);
    let html = ['M','T','W','T','F','S','S'].map((d)=> `<div class="hd">${d}</div>`).join('') + (side ? '<div class="hd">mi</div>' : '');
    for(let i = 0; i < days.length; i += 7){
      const wk = days.slice(i, i + 7);
      html += wk.map((d)=> d ? cell(d) : '<div class="kv-cday blank"></div>').join('');
      if(side) html += `<div class="kv-wkt">${side(wk)}</div>`;
    }
    return `<div class="card kv-card kv-cal"><div class="kv-ch"><button type="button" class="kv-nav" data-a="${act}" data-v="-1" aria-label="Previous month">‹</button><div class="kv-ct">${MONTHS[m]} ${y}</div><button type="button" class="kv-nav" data-a="${act}" data-v="1" aria-label="Next month">›</button></div>
      <div class="kv-grid ${side ? '' : 'nt'}">${html}</div></div>`;
  }

  // ---------------------------------------------------------------- Calendar › Training
  // Beside (desktop) or under (phone) the month: the day's summary from dayview.js. Its full-screen page has the
  // route, charts and splits, with the app's own day card (sessions, the editor) under them.
  const wide = ()=> window.innerWidth >= 1024;
  let tlHome = null;
  // Put the day card back on its own page before this page's HTML is replaced, or the redraw would delete it.
  function parkDay(){
    const c = document.getElementById('tlDayCard');
    if(c && tlHome && document.getElementById('pageV')?.contains(c)) tlHome.appendChild(c);
  }
  async function mountDay(d, days, full){
    const c = document.getElementById('tlDayCard'), slot = document.getElementById('kvDayHost');
    if(!c || !slot) return;
    if(!tlHome) tlHome = c.parentNode;
    slot.appendChild(c);
    c.classList.toggle('kv-full', !!full);
    const t = new Date(d + 'T12:00:00');
    tlDays = days; tlSelected = d; tlYear = t.getFullYear(); tlMonthIdx = t.getMonth();
    if(V.openEdit){ V.openEdit = false; tlEditDate = d; tlEditing = true; }
    await renderTrainingDay();
    document.body.classList.remove('tl-sheet');
    const fb = document.getElementById('tlFull');
    if(fb){ fb.textContent = full ? 'Exit full screen' : 'Full screen'; fb.setAttribute('aria-pressed', String(!!full)); }
  }
  window.KV.park = parkDay;
  // The card's own Full screen button opens (and leaves) the day's page.
  document.addEventListener('click', (e)=>{
    const b = e.target.closest('#pageV #tlFull'); if(!b) return;
    e.stopPropagation();
    if(V.stack.length) ACT.back(); else push('day|' + tlSelected);
  }, true);

  SCREENS.log = async ()=>{
    if(!own()) return need('Pick your name to see your training.');
    const today = todayKey();
    if(!V.month){ const d = new Date((V.sel || today) + 'T12:00:00'); V.month = [d.getFullYear(), d.getMonth()]; }
    if(!V.sel) V.sel = today;
    const [y, m] = V.month, first = iso(new Date(y, m, 1)), last = iso(new Date(y, m + 1, 0));
    // The week totals count whole weeks, so the log runs from the Monday before the 1st to the Sunday after the last.
    const gridFrom = iso(weekStart(new Date(y, m, 1))), gridTo = iso(new Date(weekStart(new Date(y, m + 1, 0)).getTime() + 6 * 864e5));
    const [lg, h] = await Promise.all([logRange(gridFrom, gridTo), loadKai()]);
    const byDate = {}; (lg?.days || []).forEach(d=> byDate[d.date] = window.KDay.prepare(d));
    const plan = {}; (h?.week?.days || []).forEach(d=> { if(d.date >= today) plan[d.date] = d; });
    const done = (lg?.days || []).filter(d=> d.miles > 0 && d.date >= first && d.date <= last);
    const tot = done.reduce((a, d)=> a + d.miles, 0);
    V.cache.monthTitle = `${Math.round(tot)} miles in ${MONTHS[m]}`;
    setSub(`${done.length} ${done.length === 1 ? 'run' : 'runs'} · longest ${Math.round(done.reduce((a, d)=> Math.max(a, d.miles), 0) * 10) / 10} mi · ${done.filter(d=> d.difficulty >= 6).length} hard ${done.filter(d=> d.difficulty >= 6).length === 1 ? 'day' : 'days'}`);
    const cell = (d)=>{ const x = byDate[d], p = plan[d], day = +d.slice(8);
      const cls = x?.miles ? intensity(x.difficulty) : p && p.type !== 'Off' ? 'plan' : 'rest';
      return `<button type="button" class="kv-cday ${cls} ${d === V.sel ? 'sel' : ''} ${d === today ? 'now' : ''}" data-a="logSel" data-v="${d}"><b>${day}</b><span>${x?.miles ? Math.round(x.miles * 10) / 10 : p && p.type !== 'Off' ? p.miles : ''}</span></button>`; };
    const side = (wk)=>{ const mon = weekStart(new Date(wk.find(Boolean) + 'T12:00:00')).getTime(); let s = 0; for(let i = 0; i < 7; i++) s += byDate[iso(new Date(mon + i * 864e5))]?.miles || 0; return s ? Math.round(s) : ''; };
    V.cache['day:' + V.sel] = byDate[V.sel];
    V.days = byDate;
    return `<div class="kv-row" style="--c:1.15fr 1fr"><div class="kv-stack">${monthGrid(y, m, cell, side, 'logMonth')}
        <div class="kv-legend"><span><i class="i1"></i>Easy 1-3</span><span><i class="i2"></i>Moderate 4-5</span><span><i class="i3"></i>Hard 6-7</span><span><i class="i4"></i>Very hard 8-10</span><span><i class="pl"></i>Planned</span></div></div>
      <div class="kv-stack">${dayPanel(V.sel, byDate[V.sel], plan[V.sel])}</div></div>`;
  };
  SCREENS.log.after = ()=>{ const x = V.days?.[V.sel]; if(wide() && x?.miles) window.KDay.mountPeek(x, own()); };
  ACT.logMonth = (s)=>{ let [y, m] = V.month; m += +s; if(m < 0){ m = 11; y--; } if(m > 11){ m = 0; y++; } V.month = [y, m];
    // The day beside the month must belong to it: keep the same day number, or the 1st.
    const t = todayKey(), inMonth = (k)=> k && +k.slice(0, 4) === y && +k.slice(5, 7) === m + 1;
    V.sel = inMonth(t) ? t : iso(new Date(y, m, Math.min(+(V.sel || t).slice(8), new Date(y, m + 1, 0).getDate())));
    redraw(); };
  ACT.logSel = (d)=>{ if(V.sel === d && !wide()) return push('day|' + d); V.sel = d; redraw(); };

  // What was planned or run. A run day shows its six numbers, difficulty and Kestrel AI's line (desktop adds the route).
  function dayPanel(d, x, p){
    const isToday = d === todayKey();
    const many = (x?.sessions || []).filter((z)=> z.category !== 'crosstrain').length > 1;
    const ttl = x?.miles ? (many ? `${(x.sessions || []).filter((z)=> z.category !== 'crosstrain').length} sessions · ${Math.round(x.miles * 10) / 10} mi` : runTitle(x)) : p ? (p.type === 'Off' ? 'Rest day' : p.type) : 'Rest day';
    if(x?.miles) return `<div class="card kv-card kd-peek"><div class="kv-ch"><div><div class="kv-eb">${esc(nice(d, { weekday:'long', month:'short', day:'numeric' }))}${isToday ? ' · today' : ''}</div><div class="kv-ct big">${esc(ttl)}</div></div>
      <div class="kv-ch-r"><button type="button" class="pri kd-open" data-a="dayFull" data-v="${d}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 2h4v4M6 14H2v-4M14 2 9 7M2 14l5-5"/></svg>${wide() ? 'Full screen' : 'Open'}</button></div></div>
      ${window.KDay.peekHtml(x, wide())}</div>`;
    const head = `<div class="card kv-card kv-dayhead"><div class="kv-ch"><div><div class="kv-eb">${esc(nice(d, { weekday:'long', month:'short', day:'numeric' }))}${isToday ? ' · today' : ''}</div><div class="kv-ct big">${esc(ttl)}</div></div>
      <div class="kv-ch-r"><button type="button" class="pri" data-a="dayFull" data-v="${d}">${x?.notes || x?.summary ? 'Open' : d <= todayKey() ? 'Add a run' : 'Details'}</button></div></div>
      ${p && !x?.miles ? `<div class="kv-hint">Planned: ${esc(p.type === 'Off' ? 'rest' : `${p.type} ${p.miles} mi`)}${sessionText(p) || p.base?.notes ? ' · ' + esc(sessionText(p) || p.base.notes) : ''}</div>` : ''}
      ${x?.plan ? `<div class="kv-hint">Plan: ${esc(x.plan.planned || x.plan.label || '')}</div>` : ''}
      ${x?.day_line ? `<div class="kv-note"><b>Kestrel AI:</b> ${esc(x.day_line)}</div>` : ''}</div>`;
    return head + (d > todayKey() && p && modOn('coach') ? card('', '', `<div class="kv-hint">Can’t make it, or want something different? Kestrel AI moves it inside the guardrails.</div><div class="kv-btns"><button type="button" data-a="dayKai" data-v="${d}">Change this day</button></div>`) : '');
  }
  ACT.dayFull = (d)=>{ V.sel = d; push('day|' + d); };
  ACT.dayKai = (d)=> openKai(`About ${nice(d, { weekday:'long', month:'short', day:'numeric' })}: `, false);
  // The day: one sentence, its numbers, then every session. A session opens on its own page (phone) or beside the list (laptop).
  async function loadDay(d){
    const [lg] = await Promise.all([logRange(d, d)]);
    window.KDay.setTags(lg?.tags);
    const x = window.KDay.prepare(lg?.days?.[0]); V.cache['day:' + d] = x;
    V.days = { [d]: x || { date:d, types:[], sessions:[], split_reps:[] } };
    return x;
  }
  SCREENS.day = async (d)=>{
    const K = window.KDay;
    // Editing keeps what was typed: the page is drawn from the day as it was when Edit was pressed.
    if(K.editing(d) && !V.editSess && V.cache['day:' + d]){
      const x = V.cache['day:' + d];
      return `<div class="kd-top kde-top"><button type="button" class="kv-back" data-a="kdeCancel">‹ Cancel</button><span class="kde-flag">Editing</span><button type="button" class="pri sm-btn" data-a="kdeSave">Save changes</button></div>
        ${K.dayEditHtml(x, wide(), typeof library !== 'undefined' ? library : null)}
        <div class="kde-bar"><button type="button" class="sm-btn" data-a="kdeCancel">Cancel</button><span class="kv-hint" id="kdeMsg"></span><button type="button" class="pri sm-btn" data-a="kdeSave">Save changes</button></div><div id="kvDayHost" hidden></div>`;
    }
    const x = await loadDay(d);
    // A run gets the full layout; Edit unlocks its boxes in place. Other days show the app's day card.
    if(!x?.miles) return `<button type="button" class="kv-back" data-a="back">‹ Back</button><div id="kvDayHost"></div>`;
    if(V.sessDay !== d){ V.sessDay = d; V.sessSel = null; }
    // On a laptop a session picked from the list sits beside the day: it can be edited on its own too.
    const picked = wide() && (x.sessions || []).length > 1 && V.sessSel && window.KDay.sessionOf(x, V.sessSel) ? V.sessSel : null;
    const btns = own() ? `<span class="kd-acts">${picked ? `<button type="button" class="sm-btn" data-a="sessEdit" data-v="${esc(picked)}">Edit session</button>` : ''}<button type="button" class="sm-btn" data-a="dayEdit">Edit day</button></span>` : '';
    return `<div class="kd-top"><button type="button" class="kv-back" data-a="back">‹ Back</button>${btns}</div>${window.KDay.dayHtml(x, V.sessSel, wide())}<div id="kvDayHost" hidden></div>`;
  };
  // The date of the page on top: a day page is "day|2026-11-24", a session page "sess|2026-11-24#0".
  const topDate = ()=> ((V.stack[V.stack.length - 1] || '').split('|')[1] || '').split('#')[0];
  ACT.dayEdit = async ()=>{
    const d = topDate(), x = V.cache['day:' + d];
    if(!x || !own()) return;
    try{ await loadLibrary(); }catch(e){ /* the library picker is optional */ }
    V.editSess = null;
    window.KDay.startEdit(x);
    window.scrollTo(0, 0);
    redraw();
  };
  // Edit one session from its own page: the same editor, scoped to that session's runs and splits.
  ACT.sessEdit = (key)=>{
    const d = String(key).split('#')[0], x = V.cache['day:' + d];
    if(!x || !own()) return;
    V.editSess = key;
    window.KDay.startEdit(x);
    // On a laptop the session sits beside the day: it opens on its own page to be edited.
    if(V.stack[V.stack.length - 1] !== 'sess|' + key){ V.sessDay = d; V.sessSel = key; V.stack.push('sess|' + key); }
    window.scrollTo(0, 0);
    redraw();
  };
  ACT.kdeCancel = ()=>{
    if(window.KDay.dirty() && !confirm('Discard your changes?')) return;
    window.KDay.stopEdit(); V.editSess = null; redraw();
  };
  ACT.kdeUseLaps = (k)=> window.KDay.useLaps(k);
  ACT.kdeAdd = (k)=> window.KDay.addSplit(k);
  ACT.kdeDel = (v)=>{ const i = v.lastIndexOf('|'); window.KDay.delSplit(v.slice(0, i), +v.slice(i + 1)); };
  ACT.kdeJump = (key)=> document.getElementById('kde-' + String(key).replace(/[^\w-]/g, '_'))?.scrollIntoView({ behavior:'smooth', block:'start' });
  ACT.kdeSave = async ()=>{
    const K = window.KDay, d = topDate();
    const p = K.editPayload(), msg = document.getElementById('kdeMsg');
    const say = (t)=>{ if(msg) msg.textContent = t; else alert(t); };
    if(!p) return;
    if(p.error) return say(p.error);
    if(!p.runs.length && !p.tags.length && !Object.keys(p.fields).length && p.track == null){ K.stopEdit(); V.editSess = null; return redraw(); }
    document.querySelectorAll('[data-a="kdeSave"]').forEach((b)=>{ b.disabled = true; b.textContent = 'Saving…'; });
    // The track toggle first: it resets a watch day's miles to the lines, and typed distances then go on top.
    const t = p.track != null ? await post('/api/log/track', { personId:activePersonId, date:d, track:p.track }) : null;
    const r = t?.error ? t : await post('/api/log/edit', { personId:activePersonId, date:d, runs:p.runs, tags:p.tags, fields:p.fields });
    if(r?.error){
      document.querySelectorAll('[data-a="kdeSave"]').forEach((b)=>{ b.disabled = false; b.textContent = 'Save changes'; });
      return say(r.error);
    }
    // Sessions whose splits, distance or time changed: Kestrel AI's report on them was written from the old numbers,
    // so offer to redo it.
    const changed = p.runs.filter((e)=> e.laps || e.distance_mi !== undefined || e.moving_sec !== undefined);
    const ids = new Set(changed.map((e)=> String(e.strava_id)));
    const keys = (E0(d)?.sessions || []).filter((s)=> !s.manual && s.main_id && (s.activities || []).some((z)=> ids.has(String(z.id)))).map((s)=> s.key);
    const ai = window.kestrelAiTask?.('summary');
    V.reassess = keys.length && !ai?.serverOwn ? { date:d, keys, label: ai?.label || 'Kestrel AI', splits: changed.some((e)=> e.laps) } : null;
    K.stopEdit(); V.editSess = null;
    V.cache = {}; fitnessData = null; library = null;
    toast('Saved');
    await redraw();
    reassessPop();
  };
  const E0 = (d)=> V.cache['day:' + d];

  // ---------------------------------------------------------------- the reassess prompt
  // A banner that drops in over the screen from the top, the way a phone shows a notification: Kestrel's mark, who
  // it is from, the question and two buttons. It sits above the page (not in it), so a redraw or moving to another
  // screen keeps it until it is answered. Swipe it up (or ×) for Not now.
  function reassessPop(){
    const r = V.reassess;
    let el = document.getElementById('kdReassess');
    if(!r){ if(el) popAway(el); return; }
    const n = r.keys.length, what = n > 1 ? `these ${n} sessions` : 'this session';
    if(!el){
      el = document.createElement('div');
      el.id = 'kdReassess'; el.className = 'k-notif';
      el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'false'); el.setAttribute('aria-labelledby', 'kdReassessT'); el.setAttribute('aria-describedby', 'kdReassessMsg');
      document.body.appendChild(el);
      wirePop(el);
    }
    el.classList.remove('out');
    el.innerHTML = `<div class="k-notif-grab" aria-hidden="true"></div>
      <div class="k-notif-top"><img class="k-notif-app" src="/favicon.svg" alt="" width="22" height="22"><span class="k-notif-src">Kestrel AI</span><span class="k-notif-when">now</span>
        <button type="button" class="k-notif-x" data-r="no" aria-label="Not now">×</button></div>
      <b class="k-notif-t" id="kdReassessT">${r.splits ? 'Splits changed' : 'Run changed'}</b>
      <p class="k-notif-b" id="kdReassessMsg" aria-live="polite">Have Kestrel AI reassess ${what} with your new ${r.splits ? 'splits' : 'distance and time'}? It rewrites the report${n > 1 ? 's' : ''} using ${esc(r.label)}.</p>
      <div class="k-notif-btns"><button type="button" class="pri" data-r="go">Reassess</button><button type="button" data-r="no">Not now</button></div>`;
  }
  function popAway(el){
    el.classList.add('out');
    setTimeout(()=>{ if(el.classList.contains('out')) el.remove(); }, 320);
  }
  function wirePop(el){
    el.addEventListener('click', (e)=>{
      const b = e.target.closest('[data-r]'); if(!b || b.disabled) return;
      if(b.dataset.r === 'go') reassessGo(); else reassessNo();
    });
    el.addEventListener('keydown', (e)=>{ if(e.key === 'Escape') reassessNo(); });
    // Swipe up to put it away, as on a phone. It follows the finger up (and only a little down), then goes or settles back.
    let y0 = null, dy = 0;
    el.addEventListener('pointerdown', (e)=>{ if(e.target.closest('button')) return; y0 = e.clientY; dy = 0; el.classList.add('drag'); el.setPointerCapture?.(e.pointerId); });
    el.addEventListener('pointermove', (e)=>{ if(y0 == null) return; dy = e.clientY - y0; el.style.setProperty('--dy', `${dy < 0 ? dy : Math.min(12, dy / 4)}px`); });
    const end = ()=>{ if(y0 == null) return; y0 = null; el.classList.remove('drag'); el.style.removeProperty('--dy'); if(dy < -36) reassessNo(); };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  }
  function reassessNo(){ if(V.reassess?.busy) return; V.reassess = null; reassessPop(); }
  async function reassessGo(){
    const r = V.reassess, box = document.getElementById('kdReassess');
    if(!r || !box || r.busy) return;
    r.busy = true;
    box.querySelectorAll('button').forEach((b)=> b.disabled = true);
    box.querySelector('.pri').textContent = 'Reassessing…';
    try{ for(const k of r.keys) await window.kestrelReassess(k); }
    catch(e){
      r.busy = false;
      box.querySelectorAll('button').forEach((b)=> b.disabled = false);
      box.querySelector('.pri').textContent = 'Try again';
      document.getElementById('kdReassessMsg').textContent = e.message || 'Kestrel AI couldn’t reassess it. Try again in a minute.';
      return;
    }
    V.reassess = null; delete V.cache['day:' + r.date];
    reassessPop();
    toast(r.keys.length > 1 ? 'Kestrel AI reassessed your sessions' : 'Kestrel AI reassessed your session');
    // Only the page showing that day needs drawing again.
    if(topDate() === r.date) redraw();
  }
  // Which session the page shows beside (or under) the day.
  const shownSession = (x)=> V.sessSel || (wide() || (x?.sessions || []).length === 1 ? document.querySelector('#pageV .ks')?.dataset.key : null);
  SCREENS.day.after = (el, d)=>{ mountDay(d, V.days, true); if(window.KDay.editing(d)) return; const x = V.days[d], k = shownSession(x); if(x?.miles && k) window.KDay.mountSession(x, k, own()); };
  // Leaving the day page drops an edit in progress (asking first when something was typed).
  const back0 = ACT.back;
  ACT.back = ()=>{ if(window.KDay.editing()){ if(window.KDay.dirty() && !confirm('Discard your changes?')) return; window.KDay.stopEdit(); V.editSess = null; } back0(); };
  // A session: on a laptop the day page swaps the one beside the list; on a phone it opens on its own page.
  ACT.sess = (key)=>{
    const d = String(key).split('#')[0];
    const top = V.stack[V.stack.length - 1] || '';
    if(wide() && top === 'day|' + d){ V.sessSel = key; return redraw(); }
    V.sessDay = d; V.sessSel = key;
    push('sess|' + key);
  };
  SCREENS.sess = async (key)=>{
    const d = String(key).split('#')[0];
    const x = V.cache['day:' + d]?.sessions ? V.cache['day:' + d] : await loadDay(d);
    const s = window.KDay.sessionOf(x, key);
    if(!s) return `<button type="button" class="kv-back" data-a="back">‹ Back</button>${need('That session is gone. It may have been merged or deleted on your watch.')}`;
    // Editing this session: the same page with its boxes unlocked, saved or cancelled from the bar.
    if(window.KDay.editing(d) && V.editSess === key){
      return `<div class="kd-top kde-top"><button type="button" class="kv-back" data-a="kdeCancel">‹ Cancel</button><span class="kde-flag">Editing session</span><button type="button" class="pri sm-btn" data-a="kdeSave">Save changes</button></div>
        ${window.KDay.sessionEditHtml(x, key)}
        <div class="kde-bar"><button type="button" class="sm-btn" data-a="kdeCancel">Cancel</button><span class="kv-hint" id="kdeMsg"></span><button type="button" class="pri sm-btn" data-a="kdeSave">Save changes</button></div>`;
    }
    const ss = x.sessions || [], i = ss.indexOf(s);
    const step = ss.length > 1 ? `<div class="ks-step">${i > 0 ? `<button type="button" class="sm-btn" data-a="sessGo" data-v="${esc(ss[i - 1].key)}" aria-label="Previous session">‹</button>` : ''}<span>${i + 1} of ${ss.length}</span>${i < ss.length - 1 ? `<button type="button" class="sm-btn" data-a="sessGo" data-v="${esc(ss[i + 1].key)}" aria-label="Next session">›</button>` : ''}</div>` : '';
    const edit = own() ? `<button type="button" class="sm-btn" data-a="sessEdit" data-v="${esc(s.key)}">Edit session</button>` : '';
    return `<div class="kd-top ks-top"><button type="button" class="kv-back" data-a="back">‹ ${esc(nice(d, { weekday:'short', month:'short', day:'numeric' }))}</button>${step}${edit}</div>${window.KDay.sessionHtml(x, s)}`;
  };
  SCREENS.sess.after = (el, key)=>{ const d = String(key).split('#')[0], x = V.cache['day:' + d]; if(x && !window.KDay.editing(d)) window.KDay.mountSession(x, key, own()); };
  ACT.sumKestrel = async ()=>{ await window.kestrelSetSummary?.('kestrel'); redraw(); };
  ACT.sessReport = (key)=>{ const x = V.cache['day:' + String(key).split('#')[0]]; if(x) window.KDay.writeReport(x, key); };
  ACT.sessGo = (key)=>{ V.stack[V.stack.length - 1] = 'sess|' + key; V.sessSel = key; window.scrollTo(0, 0); redraw(); };

  // ---------------------------------------------------------------- Run › The Kestrel ethos
  // What every Kestrel AI follows, whichever model runs it, and the runner's own ethos on top.
  SCREENS.ethos = async ()=>{
    const e = await getJson('/api/ethos');
    if(!e) return need('Couldn’t load the ethos. Check your connection.');
    setSub('How Kestrel coaches. Every AI in Kestrel follows it, whichever model you pick.');
    const cards = e.sections.map((x, i)=> `<section class="card kv-card kv-ethos"><div class="kv-eb">${String(i + 1).padStart(2, '0')}</div><h2 class="kv-ct">${esc(x.title)}</h2><ul>${x.points.map((p)=> `<li>${esc(p)}</li>`).join('')}</ul></section>`).join('');
    const mine = own() ? `<form class="card kv-card kv-ethos mine" data-f="ethosSave">
        <div class="kv-eb">Yours</div><h2 class="kv-ct">Your ethos</h2>
        <p class="kv-hint">Add how you like to train, and Kestrel AI follows it on top of the ethos above: “I race the 800, keep one speed day all year”, “No running on Sundays”, “Vegetarian, so suggest plant protein”. Safety always comes first: if yours clashes with a health rule or the plan’s limits, Kestrel AI tells you why.</p>
        <textarea class="kv-input" name="mine" rows="5" maxlength="2000" placeholder="Write a few lines in your own words.">${esc(e.mine || '')}</textarea>
        <div class="kv-btns"><button type="submit" class="pri">Save my ethos</button><span class="kv-hint" id="kvEthosMsg"></span></div></form>` : '';
    return `<div class="kv-ethos-grid">${cards}${mine}</div>
      <p class="kv-hint kv-ethos-src">The research behind each point, with sources: <a href="https://github.com/jakecapmeil/kestrel/blob/main/docs/ethos.md" target="_blank" rel="noopener">docs/ethos.md</a>. Version ${esc(e.version)}.</p>`;
  };
  ACT.ethosSave = async (v, f)=>{
    const msg = document.getElementById('kvEthosMsg');
    try{
      const r = await fetch('/api/ethos', { method:'PUT', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ mine: f.mine.value }) });
      if(!r.ok) throw new Error();
      msg.textContent = f.mine.value.trim() ? 'Saved. Kestrel AI follows it from your next message.' : 'Cleared.';
    }catch(e){ msg.textContent = 'That didn’t save. Try again.'; }
  };

  // ---------------------------------------------------------------- Body › Recovery
  SCREENS.recovery = async ()=>{
    if(!own()) return need('Pick your name to check in.');
    const today = todayKey(), from = iso(new Date(Date.now() - 6 * 864e5));
    const [lg, h] = await Promise.all([logRange(from, today), loadKai()]);
    const byDate = {}; (lg?.days || []).forEach(d=> byDate[d.date] = d);
    const t = byDate[today];
    V.cache.feelTitle = t?.feel ? `Feeling ${t.feel}/10` : 'How you feel';
    const rd = h?.health?.readiness;
    setSub(rd?.score != null ? `Readiness ${rd.score} · ${rd.label}` : '');
    const status = currentTrainingStatus();
    const statusCard = card('Training status', 'What you’re doing right now. Teammates see it.', `<div class="kv-chips">${TRAINING_KEYS.map(k=> `<button type="button" class="kv-chip ${k === status ? 'on' : ''}" data-a="trainStatus" data-v="${k}">${TRAINING_STATES[k].label}</button>`).join('')}</div>`);
    const week = Array.from({ length:7 }, (_, i)=> iso(new Date(Date.now() - (6 - i) * 864e5)));
    const trend = card('Last 7 days', 'How you felt and slept.', `<div class="kv-trendbars">${week.map(d=>{ const x = byDate[d]; return `<div><div class="tb"><i class="f" style="height:${(x?.feel || 0) * 10}%"></i><i class="s" style="height:${Math.min(100, (x?.sleep_hours || 0) * 10)}%"></i></div><span>${new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday:'short' })}</span></div>`; }).join('')}</div>
      <div class="kv-legend"><span><i style="background:var(--accent)"></i>Feel</span><span><i style="background:var(--info)"></i>Sleep</span></div>`);
    const health = card('Health', 'From your log and your watch.', tiles([['Readiness', rd?.score ?? '–', rd?.label || ''], ['Resting HR', h?.health?.resting_hr?.last7 ?? '–', h?.health?.resting_hr?.normal ? 'norm ' + h.health.resting_hr.normal : ''], ['HRV', h?.health?.hrv?.last7 ?? '–', h?.health?.hrv?.normal ? 'norm ' + h.health.hrv.normal : ''], ['Sleep', h?.health?.sleep?.last7 != null ? h.health.sleep.last7 + ' h' : '–', '7-day average']], 4)
      + (rd?.factors?.length ? `<div class="kv-list u-mt2">${rd.factors.map(x=> `<div class="kv-li"><div><span class="u-text">${esc(x.why)}</span></div><i>${x.pts > 0 ? '+' : ''}${x.pts}</i></div>`).join('')}</div>` : ''));
    const marks = bodyMarks[activePersonId] || {};
    const map = card('Body map', 'Tap anything that hurts: sore, then pain, then clear. Kestrel AI keeps hard runs off it.', `<div class="kv-bodymap"><div id="kvBodyMount"></div>
      <div class="kv-bmchips">${Object.entries(marks).map(([id, st])=> `<span class="kv-bmchip ${st}">${esc(BODY_PART_LABELS[id] || id)}<button type="button" data-a="bmClear" data-v="${id}" aria-label="Clear">✕</button></span>`).join('')}</div>
      <button type="button" class="kv-bmflip" data-a="bmFlip">${ICON.flip}<span>${V.bmView === 'front' ? 'Front' : 'Back'}</span></button></div>
      <div class="kv-legend" style="justify-content:center"><span><i style="background:#94a3b8"></i>OK</span><span><i style="background:#f97316"></i>Sore</span><span><i style="background:#dc2626"></i>Pain</span></div>
      ${modOn('coach') ? '<div class="kv-btns"><button type="button" data-a="bmKai">Tell Kestrel AI how it feels</button></div>' : ''}`);
    const hs = h?.health || {}, sore = Object.keys(marks).length;
    const top = hero({ eb:'Readiness · today', big:rd?.score != null ? esc(rd.label) : 'Check in', unit:rd?.score != null ? rd.score : '',
      lines:[rd?.score != null ? [hs.resting_hr?.last7 != null && `Resting HR ${hs.resting_hr.last7}${hs.resting_hr.normal ? `, normal ${hs.resting_hr.normal}` : ''}.`, hs.sleep?.last7 != null && `Sleeping ${hs.sleep.last7} h a night.`].filter(Boolean).join(' ') : 'Log how you feel and how you slept for a few days, and Kestrel works out your readiness.',
        sore ? `${sore} ${sore === 1 ? 'spot' : 'spots'} marked on the body map.` : 'Nothing marked on the body map.'],
      btns:modOn('coach') ? `<button type="button" data-a="ask">Ask Kestrel AI</button>` : '' });
    return `${top}<div class="kv-row" style="--c:1.2fr 1fr"><div class="kv-stack">${feelCard(t, false)}${trend}${health}</div><div class="kv-stack">${map}</div></div>`;
  };
  SCREENS.recovery.after = ()=>{
    const el = $('kvBodyMount'); if(!el || !window.BodyMuscles) return;
    const bodyState = {}; for(const [id, st] of Object.entries(bodyMarks[activePersonId] || {})) bodyState[id] = { intensity:st === 'pain' ? BODY_PAIN_INTENSITY : BODY_SORE_INTENSITY, selected:true };
    new BodyMuscles.BodyChart(el, { view:V.bmView === 'front' ? BodyMuscles.ViewSide.FRONT : BodyMuscles.ViewSide.BACK, bodyState, ariaLabel:'Body map', onMuscleClick:async (id)=>{ await onBodyPartClick(id); redraw(); } });
  };
  ACT.trainStatus = async (k)=>{ await setTraining(k); redraw(); };
  ACT.bmFlip = ()=>{ V.bmView = V.bmView === 'front' ? 'back' : 'front'; redraw(); };
  ACT.bmClear = async (id)=>{ await clearBodyPart(id); redraw(); };
  ACT.bmKai = ()=>{ const m = Object.entries(bodyMarks[activePersonId] || {}).map(([id, st])=> `${(BODY_PART_LABELS[id] || id).toLowerCase()} (${st})`); openKai(m.length ? `My ${m.join(', ')} ` : 'Something hurts: ', false); };

  // ---------------------------------------------------------------- Body › Cross-train
  SCREENS.xtrain = async ()=>{
    if(!own()) return need('Pick your name to log cross-training.');
    const x = await getJson('/api/xtrain');
    if(!x) return need('Couldn’t load cross-training. Check your connection.');
    const w = x.this_week || {};
    V.cache.xtTitle = w.sessions ? `${w.sessions} ${w.sessions === 1 ? 'session' : 'sessions'} this week` : 'Cross-training';
    setSub(x.avg_min ? `About ${Math.round(x.avg_min)} min a week lately${x.share_pct != null ? ` · ${x.share_pct}% of your training` : ''}` : '');
    const sport = V.xtSport;
    const list = card('Recent sessions', 'Bike, pool, strength and anything else that isn’t running.', `<div class="kv-list">${x.entries.slice(0, 8).map(e=> `<div class="kv-li"><div><b>${esc(e.label)} · ${e.minutes} min</b><span>${esc(nice(e.date))} · effort ${e.rpe}/10${e.distance_mi ? ` · ${e.distance_mi} mi` : ''}${e.source !== 'manual' ? ' · from your watch' : ''}</span></div>${e.source === 'manual' ? `<button type="button" class="kv-x" data-a="xtDel" data-v="${e.id}" aria-label="Remove">×</button>` : ''}</div>`).join('') || '<div class="kv-hint">Nothing logged yet.</div>'}</div>`);
    const add = card('Add a session', sport ? 'How long, and how hard it felt.' : 'Pick what you did.', sport
      ? `<form class="kv-form" data-f="xtSave"><div class="kv-pill bl" style="align-self:flex-start">${esc(x.sports.find(s=> s.key === sport)?.label || sport)}</div><div class="kv-grid3"><label><span>Minutes</span><input name="minutes" inputmode="numeric" required></label><label><span>Effort 1-10</span><input name="rpe" inputmode="numeric" value="4" required></label><label><span>Date</span><input name="date" type="date" value="${todayKey()}"></label></div><label><span>Notes</span><input name="notes"></label><div class="kv-btns"><button type="submit" class="pri">Save</button><button type="button" data-a="xtSport" data-v="">Back</button></div></form>`
      : `<div class="kv-addgrid">${x.sports.map(s=> `<button type="button" data-a="xtSport" data-v="${s.key}">${esc(s.label)}</button>`).join('')}</div>`);
    const totals = card('This week', '', tiles([['Time', `${Math.round(w.xt_min || 0)} min`], ['Sessions', w.sessions || 0], ['Load', w.load || 0]], 3));
    return `<div class="kv-row" style="--c:1fr 1.1fr 1fr">${list}${add}<div class="kv-stack">${totals}${card('Making it count', '', '<div class="kv-how"><p><b>Hurt?</b> Pool running and cycling keep most of your fitness while you heal.</p><p><b>Strength:</b> two short sessions a week are linked to fewer running injuries.</p><p><b>Effort</b> lets Kestrel count any sport in your load.</p></div>')}</div></div>`;
  };
  ACT.xtSport = (k)=>{ V.xtSport = k || null; redraw(); };
  ACT.xtSave = async (_, f)=>{ const b = Object.fromEntries(new FormData(f)); const r = await post('/api/xtrain', { ...b, sport:V.xtSport }); if(r.error) return alert(r.error); V.xtSport = null; toast('Session saved'); redraw(); };
  ACT.xtDel = async (id)=>{ await post('/api/xtrain/delete', { id }); redraw(); };

  // ---------------------------------------------------------------- Body › Fuel
  SCREENS.food = async ()=>{
    if(!own()) return need('Pick your name to log food.');
    if(!V.foodDate) V.foodDate = todayKey();
    const [d, rec] = await Promise.all([getJson('/api/food?date=' + V.foodDate), getJson('/api/food/recent')]);
    if(!d) return need('Couldn’t load fuel. Check your connection.');
    const t = d.totals || {}, tg = d.targets || {};
    V.cache.foodTitle = `${Math.round(t.kcal || 0).toLocaleString()} kcal${V.foodDate === todayKey() ? ' today' : ''}`;
    setSub(`${d.tier?.label || ''}${d.training?.run_mi ? ` · ${d.training.run_mi} mi run` : ''}`);
    const rng = (k)=> Array.isArray(tg[k]) ? tg[k] : tg[k] ? [tg[k], tg[k]] : null;
    const bar = (label, k, cls)=>{ const r = rng(k), v = Math.round(t[k] || 0), max = r ? r[1] : Math.max(v, 1); return `<div class="kv-macro"><div class="kv-ch"><b>${label}</b><span class="kv-hint">${v} g${r ? ` of ${r[0]}–${r[1]}` : ''}</span></div><div class="kv-bar big ${cls}"><i style="width:${Math.min(100, v / max * 100)}%"></i></div></div>`; };
    const kmax = rng('kcal')?.[1] || Math.max(2400, t.kcal || 0), c = 2 * Math.PI * 58, fr = Math.min(1, (t.kcal || 0) / kmax) * c;
    const ring = `<svg viewBox="0 0 140 140" class="kv-ring"><circle cx="70" cy="70" r="58" fill="none" stroke="var(--surface-2)" stroke-width="13"/><circle cx="70" cy="70" r="58" fill="none" stroke="var(--accent)" stroke-width="13" stroke-linecap="round" stroke-dasharray="${fr} ${c}" transform="rotate(-90 70 70)"/><text x="70" y="70" text-anchor="middle" class="r1">${Math.round(t.kcal || 0).toLocaleString()}</text><text x="70" y="88" text-anchor="middle" class="r2">kcal</text></svg>`;
    const day = card(`<button type="button" class="kv-nav" data-a="foodDay" data-v="-1" aria-label="Previous day">‹</button> ${esc(V.foodDate === todayKey() ? 'Today' : nice(V.foodDate))} <button type="button" class="kv-nav" data-a="foodDay" data-v="1" aria-label="Next day">›</button>`, esc(d.tier?.note || ''),
      `<div class="kv-fuel">${ring}<div class="kv-macros">${bar('Carbs', 'carbs_g', '')}${bar('Protein', 'protein_g', 'bl')}${bar('Fat', 'fat_g', 'g')}</div></div>${d.weight_known ? '' : '<div class="kv-note">Add your weight in your profile to get gram targets.</div>'}`);
    const meals = card('Meals', '', `<div class="kv-list">${(d.entries || []).map(e=> `<div class="kv-li"><div><b>${esc(e.name || 'Food')}</b><span>${esc((d.meals || []).find(m=> m.key === e.meal)?.label || e.meal)} · ${Math.round(e.carbs_g || 0)} g carbs · ${Math.round(e.protein_g || 0)} g protein</span></div><i>${e.kcal ? Math.round(e.kcal) : ''}</i><button type="button" class="kv-x" data-a="foodDel" data-v="${e.id}" aria-label="Remove">×</button></div>`).join('') || '<div class="kv-hint">Nothing logged for this day yet.</div>'}</div>`);
    const add = card('Add food', 'Snap it, say it, or tap a recent food.', snapHtml(d) + `<div class="kv-or"><span>or by hand</span></div><div class="kv-addgrid">${(rec?.foods || []).slice(0, 6).map((x, i)=> `<button type="button" data-a="foodQuick" data-v="${i}">${esc(x.name)}</button>`).join('')}</div>
      <form class="kv-form" data-f="foodSave" style="margin-top:12px"><label><span>What</span><input name="name" placeholder="Bagel with peanut butter" required></label><div class="kv-grid3"><label><span>Carbs g</span><input name="carbs_g" inputmode="numeric"></label><label><span>Protein g</span><input name="protein_g" inputmode="numeric"></label><label><span>kcal</span><input name="kcal" inputmode="numeric"></label></div>
      <label><span>Meal</span><select name="meal">${(d.meals || []).map(m=> `<option value="${m.key}">${esc(m.label)}</option>`).join('')}</select></label><div class="kv-btns"><button type="submit" class="pri">Add</button></div></form>`);
    V.cache.recentFoods = rec?.foods || [];
    const tips = card('Fueling your running', '', `<div class="kv-how">${(d.run_fuel || []).map(x=> `<p><b>${esc(cap(x.when))}:</b> ${esc(x.text)}</p>`).join('')}</div>`);
    return `<div class="kv-row" style="--c:1fr 1fr 1fr"><div class="kv-stack">${day}${meals}</div>${add}<div class="kv-stack">${tips}</div></div>`;
  };
  // ---- Snap or describe: a photo and/or a few words, Kestrel AI estimates, the runner checks, then adds.
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  // The meal a photo most likely is, from the time of day.
  const mealNow = ()=>{ const h = new Date().getHours() + new Date().getMinutes() / 60; return h < 10.5 ? 'breakfast' : h < 14.5 ? 'lunch' : h >= 17 && h < 21.5 ? 'dinner' : 'snack'; };
  const snap = ()=> V.snap || (V.snap = { images:[], text:'', out:null, busy:false, err:'', meal: mealNow() });
  function snapHtml(d){
    const st = snap(), ai = window.kestrelAiTask?.('food') || { label:'Kestrel free', vision:false };
    const meals = (d.meals || []).map(m=> `<option value="${m.key}" ${st.meal === m.key ? 'selected' : ''}>${esc(m.label)}</option>`).join('');
    const out = st.out ? snapResult(st.out) : '';
    return `<div class="kv-snap">
      ${st.images.length ? `<div class="kv-snap-photos">${st.images.map((im, i)=> `<span class="kv-snap-ph"><img src="${im.url}" alt="Food photo ${i + 1}"><button type="button" data-a="snapDrop" data-v="${i}" aria-label="Remove photo">×</button></span>`).join('')}</div>` : ''}
      <div class="kv-snap-row">
        ${ai.vision ? '' : '<p class="kv-hint" style="margin:0;flex-basis:100%">Photos need a model that can see images: pick one for Food photos in You → Integrate. Describing it works now.</p>'}
        <label class="kv-snap-btn${st.images.length >= 3 || !ai.vision ? ' off' : ''}"><input type="file" id="kvSnapFile" accept="image/*" multiple ${st.images.length >= 3 || !ai.vision ? 'disabled' : ''}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>${st.images.length ? 'Add photo' : 'Photo'}</label>
        ${SR ? `<button type="button" class="kv-snap-btn${st.listening ? ' on' : ''}" data-a="snapMic"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>${st.listening ? 'Listening…' : 'Speak'}</button>` : ''}
        <select class="kv-snap-meal" id="kvSnapMeal" aria-label="Meal">${meals}</select>
      </div>
      <textarea id="kvSnapText" rows="2" maxlength="600" placeholder="Describe it: “bowl of pasta with meat sauce, about 2 cups, glass of milk”. Add amounts and anything hidden, like oil or sauce.">${esc(st.text)}</textarea>
      <div class="kv-btns"><button type="button" class="pri" data-a="snapGo" ${st.busy ? 'disabled' : ''}>${st.busy ? 'Estimating…' : 'Estimate with Kestrel AI'}</button>${st.images.length || st.text || st.out ? '<button type="button" data-a="snapClear">Clear</button>' : ''}</div>
      ${st.err ? `<div class="kv-note">${esc(st.err)}</div>` : ''}
      ${out}
      <p class="kv-hint kv-snap-foot">Runs on ${esc(ai.label)}. Estimates are rough, often 20-30% off: check them before adding.</p></div>`;
  }
  function snapResult(o){
    if(!o.items.length) return `<div class="kv-note">${esc(o.note || 'Nothing to add.')}</div>`;
    const mid = (r)=> Math.round((r[0] + r[1]) / 2);
    const rng = (r, u)=> r[0] === r[1] ? `${r[0]}${u}` : `${r[0]}–${r[1]}${u}`;
    return `<form class="kv-snap-out" data-f="snapAdd"><div class="kv-snap-conf"><b>Kestrel AI’s estimate</b><span class="kv-pill">${esc(o.confidence)} confidence</span></div>
      ${o.items.map((x, i)=> `<fieldset class="kv-snap-item"><label class="kv-snap-name"><input type="checkbox" name="use${i}" checked aria-label="Add ${esc(x.name)}"><input name="name${i}" value="${esc(x.name)}" aria-label="Name"></label>
        <div class="kv-hint">${esc(x.portion)}</div>
        <div class="kv-grid4"><label><span>kcal <i>${rng(x.kcal, '')}</i></span><input name="kcal${i}" inputmode="numeric" value="${mid(x.kcal)}"></label><label><span>Carbs <i>${rng(x.carbs_g, ' g')}</i></span><input name="carbs_g${i}" inputmode="numeric" value="${mid(x.carbs_g)}"></label><label><span>Protein <i>${rng(x.protein_g, ' g')}</i></span><input name="protein_g${i}" inputmode="numeric" value="${mid(x.protein_g)}"></label><label><span>Fat <i>${rng(x.fat_g, ' g')}</i></span><input name="fat_g${i}" inputmode="numeric" value="${mid(x.fat_g)}"></label></div></fieldset>`).join('')}
      ${o.note ? `<p class="kv-hint">${esc(o.note)}</p>` : ''}
      <div class="kv-btns"><button type="submit" class="pri">Add to ${esc(V.foodDate === todayKey() ? 'today' : nice(V.foodDate))}</button></div></form>`;
  }
  // Photos are shrunk to 1024 px JPEG in the browser before they go anywhere.
  async function shrink(file){
    const url = URL.createObjectURL(file);
    try{
      const img = await new Promise((ok, bad)=>{ const i = new Image(); i.onload = ()=> ok(i); i.onerror = bad; i.src = url; });
      const k = Math.min(1, 1024 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const du = c.toDataURL('image/jpeg', 0.82);
      return { mime:'image/jpeg', data: du.split(',')[1], url: du };
    } finally { URL.revokeObjectURL(url); }
  }
  const keepText = ()=>{ const t = document.getElementById('kvSnapText'), m = document.getElementById('kvSnapMeal'); if(t) snap().text = t.value; if(m) snap().meal = m.value; };
  SCREENS.food.after = ()=>{
    const f = document.getElementById('kvSnapFile');
    if(f) f.onchange = async ()=>{ keepText(); const st = snap(); st.err = '';
      for(const file of [...f.files].slice(0, 3 - st.images.length)){ try{ st.images.push(await shrink(file)); }catch(e){ st.err = 'That photo couldn’t be read. Try a JPEG or PNG.'; } }
      redraw(); };
    const t = document.getElementById('kvSnapText'); if(t) t.oninput = ()=>{ snap().text = t.value; };
    const m = document.getElementById('kvSnapMeal'); if(m) m.onchange = ()=>{ snap().meal = m.value; };
  };
  ACT.snapDrop = (i)=>{ keepText(); snap().images.splice(+i, 1); redraw(); };
  ACT.snapClear = ()=>{ V.snap = null; redraw(); };
  ACT.snapMic = ()=>{
    keepText(); const st = snap();
    if(st.rec){ st.rec.stop(); return; }
    const rec = new SR(); rec.lang = navigator.language || 'en-US'; rec.interimResults = false; rec.continuous = false;
    rec.onresult = (e)=>{ const said = [...e.results].map((r)=> r[0].transcript).join(' ').trim(); if(said) st.text = (st.text ? st.text.trim() + ' ' : '') + said; };
    rec.onerror = (e)=>{ st.err = e.error === 'not-allowed' ? 'Kestrel needs the microphone to listen. You can also tap the mic on your keyboard.' : ''; };
    rec.onend = ()=>{ st.rec = null; st.listening = false; redraw(); };
    st.rec = rec; st.listening = true; rec.start(); redraw();
  };
  ACT.snapGo = async ()=>{
    keepText(); const st = snap();
    if(!st.images.length && !st.text.trim()){ st.err = 'Take a photo or describe what you ate first.'; return redraw(); }
    st.busy = true; st.err = ''; st.out = null; redraw();
    try{ st.out = await window.kestrelFoodEstimate({ images: st.images.map(({ mime, data })=> ({ mime, data })), text: st.text, meal: st.meal }); }
    catch(e){ st.err = e.message || 'The estimate didn’t work. Try again.'; }
    st.busy = false; redraw();
  };
  ACT.snapAdd = async (_, f)=>{
    const st = snap(), fd = new FormData(f), meal = st.meal || document.getElementById('kvSnapMeal')?.value;
    let added = 0;
    for(let i = 0; i < (st.out?.items || []).length; i++){
      if(!fd.get('use' + i)) continue;
      const r = await post('/api/food', { date:V.foodDate, meal, name: fd.get('name' + i), kcal: fd.get('kcal' + i), carbs_g: fd.get('carbs_g' + i), protein_g: fd.get('protein_g' + i), fat_g: fd.get('fat_g' + i), notes: 'Estimated by Kestrel AI' });
      if(r.error) return alert(r.error);
      added++;
    }
    V.snap = null; toast(added ? `Added ${added} ${added === 1 ? 'item' : 'items'}` : 'Nothing added'); redraw();
  };
  ACT.foodDay = (s)=>{ const d = new Date(V.foodDate + 'T12:00:00'); d.setDate(d.getDate() + +s); V.foodDate = iso(d); redraw(); };
  ACT.foodDel = async (id)=>{ await post('/api/food/delete', { id }); redraw(); };
  ACT.foodQuick = async (i)=>{ const { meal, ...q } = V.cache.recentFoods[+i]; const r = await post('/api/food', { date:V.foodDate, meal, ...q }); if(r.error) return alert(r.error); toast('Added'); redraw(); };
  ACT.foodSave = async (_, f)=>{ const b = Object.fromEntries(new FormData(f)); const r = await post('/api/food', { date:V.foodDate, ...b }); if(r.error) return alert(r.error); toast('Added'); redraw(); };

  // ---------------------------------------------------------------- Team › Feed
  // Team › Feed: posts on one side; on the other, the last eight weeks of miles (a line you can hover) and the board for
  // whichever week is picked. /api/team already sends eight weeks, oldest first, for the team and each sharing teammate.
  const wkLabel = (w, i)=> i === 7 ? 'This week' : i === 6 ? 'Last week' : 'Week of ' + nice(w.week_of, { month:'short', day:'numeric' });
  function milesChart(d, who){
    const me = (d.athletes || []).find((r)=> r.id === activePersonId);
    const pts = d.weeks.map((w, i)=> ({ i, w, mi: who === 'me' ? (me?.weeks?.[i] || 0) : w.miles }));
    const W = 320, H = 132, L = 30, R = 10, T = 12, B = 22, top = Math.max(5, ...pts.map((p)=> p.mi));
    const step = top <= 10 ? 2 : top <= 25 ? 5 : top <= 60 ? 10 : top <= 150 ? 25 : top <= 400 ? 50 : 100, max = Math.ceil(top / step) * step;
    const x = (i)=> L + i * (W - L - R) / 7, y = (mi)=> T + (H - T - B) * (1 - mi / max);
    const grid = [0, Math.round(max / 2), max].map((v)=> `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('');
    const line = pts.map((p)=> `${x(p.i)},${y(p.mi)}`).join(' ');
    const sel = V.feedWeek ?? 7;
    return `<div class="kv-mchart" id="kvMiles"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${who === 'me' ? 'Your' : 'Team'} miles for the last eight weeks">
      <g class="g">${grid}</g>
      <polygon points="${line} ${x(7)},${y(0)} ${x(0)},${y(0)}" class="area"/><polyline points="${line}" class="ln"/>
      ${pts.map((p)=> `<text x="${x(p.i)}" y="${H - 6}" text-anchor="middle" class="xl ${p.i === sel ? 'on' : ''}">${p.i === 7 ? 'Now' : nice(p.w.week_of, { month:'numeric', day:'numeric' })}</text><circle cx="${x(p.i)}" cy="${y(p.mi)}" r="${p.i === sel ? 5 : 3.5}" class="pt ${p.i === sel ? 'on' : ''}"/>`).join('')}
      ${pts.map((p)=> `<rect x="${x(p.i) - (W - L - R) / 14}" y="0" width="${(W - L - R) / 7}" height="${H}" class="hit" tabindex="0" data-i="${p.i}" data-x="${x(p.i) / W}" data-y="${y(p.mi) / H}" data-tip="${esc(wkLabel(p.w, p.i))}|${Math.round(p.mi * 10) / 10} mi${who === 'me' ? '' : ` · ${p.w.athletes} ${p.w.athletes === 1 ? 'athlete' : 'athletes'}`}"><title>${esc(wkLabel(p.w, p.i))}: ${Math.round(p.mi * 10) / 10} miles</title></rect>`).join('')}
    </svg><div class="kv-mtip" role="status" hidden></div></div>`;
  }
  SCREENS.feed = async ()=>{
    if(!window.KESTREL?.teamId) return noTeam('the team feed');
    // Stepping through weeks or switching the chart reuses the last answer; anything else fetches fresh.
    const d = V.feedKeep && V.cache.team?.teamId === window.KESTREL.teamId ? V.cache.team.d : await getJson('/api/team');
    if(!V.feedKeep) V.feedWeek = 7;
    V.feedKeep = false;
    if(d) V.cache.team = { teamId: window.KESTREL.teamId, d };
    setSub(d ? `${d.this_week} miles this week · ${d.logged}/${d.members} athletes logged` : '');
    const wk = Math.min(7, Math.max(0, V.feedWeek ?? 7));
    const shares = (d?.athletes || []).some((r)=> r.id === activePersonId);
    const who = V.feedWho === 'me' && shares ? 'me' : 'team';
    const chart = d?.weeks?.length === 8 ? card('Weekly miles', 'The last eight weeks. Hover or tap a week; pick one to see its board.', milesChart(d, who),
      shares ? `<div class="seg kv-seg kv-seg-sm">${[['team','Team'],['me','You']].map(([v, l])=> `<button type="button" class="seg-btn ${who === v ? 'active' : ''}" data-a="feedWho" data-v="${v}">${l}</button>`).join('')}</div>` : '') : '';
    const wOf = (r)=> r.weeks?.[wk] ?? (wk === 7 ? r.this_week : 0);
    const rows = (d?.athletes || []).slice().sort((a, b)=> wOf(b) - wOf(a) || b.avg4 - a.avg4);
    const top = Math.max(1, ...rows.map(wOf));
    const w = d?.weeks?.[wk], prev = d?.weeks?.[wk - 1];
    const nav = d?.weeks ? `<div class="kv-wknav"><button type="button" class="kv-nav" data-a="feedWk" data-v="-1" aria-label="Earlier week" ${wk === 0 ? 'disabled' : ''}>‹</button><button type="button" class="kv-nav" data-a="feedWk" data-v="1" aria-label="Later week" ${wk === 7 ? 'disabled' : ''}>›</button></div>` : '';
    const board = card(w ? (wk === 7 ? 'Miles this week' : `Miles · ${esc(wkLabel(w, wk).replace(/^Week of /, 'week of '))}`) : 'Miles this week', 'Only teammates who share their miles appear.',
      tiles([['Team', w?.miles ?? '–', 'miles'], [wk === 7 ? 'Last week' : 'Before', prev?.miles ?? '–', 'miles'], ['Logged', w ? `${w.athletes}/${d.members}` : '–', 'athletes']], 3)
      + `<div class="kv-board">${rows.map((r, i)=> `<div class="kv-lb ${r.id === activePersonId ? 'me' : ''}"><span class="rk">${wOf(r) > 0 ? i + 1 : '–'}</span><span class="nm" title="${esc(r.name)}"><i style="background:${r.color}"></i>${esc(r.name)}</span><span class="kv-bar"><i style="width:${wOf(r) / top * 100}%"></i></span><b>${wOf(r) || '–'}</b></div>`).join('') || '<div class="kv-hint">Nobody shares their weekly miles yet.</div>'}</div>`, nav);
    const sorted = [...posts].sort((a, b)=> b.createdAt - a.createdAt);
    const feed = `<form class="card kv-card kv-compose" data-f="post"><input name="text" placeholder="Post to the team" autocomplete="off" maxlength="2000"><button type="submit" class="pri">Post</button></form>
      <div class="card kv-card kv-posts" id="kvPosts">${sorted.length ? sorted.slice(0, 6).map(renderPostItem).join('') : '<div class="kv-hint">No posts yet.</div>'}</div>
      <div id="kvActivities"></div>`;
    const today = todayKey(), ev = (events[today] || [])[0];
    // Nothing today: name the next thing on the calendar within a week, so the block still answers "when do we meet?".
    const nextKey = ev ? null : Object.keys(events).filter(k=> k > today && (events[k] || []).length).sort()[0];
    const next = nextKey && (new Date(nextKey + 'T12:00:00') - new Date(today + 'T12:00:00')) / 864e5 <= 7 ? events[nextKey][0] : null;
    const lead = hero({ eb:ev ? esc(['Team today', eventStyle(ev).label].filter(Boolean).join(' · ')) : 'Team today', big:ev ? esc(ev.title) : 'No practice',
      lines:[ev && [formatEventTimeRange(ev), ev.location].filter(Boolean).map(esc).join(' · '), next && `Next: ${esc(next.title)}, ${esc(nice(nextKey, { weekday:'long' }))}${next.time ? ' ' + esc(next.time) : ''}.`, d && `${d.this_week} team miles this week · ${d.logged} of ${d.members} logged.`],
      btns:`<button type="button" data-a="go" data-v="calendar/team">Open the calendar</button>` });
    return `${lead}<div class="kv-row" style="--c:1.3fr 1fr"><div class="kv-stack">${feed}</div><div class="kv-stack">${chart}${board}</div></div>`;
  };
  ACT.feedWk = (s)=>{ V.feedWeek = Math.min(7, Math.max(0, (V.feedWeek ?? 7) + Number(s))); V.feedKeep = true; redraw(); };
  ACT.feedWho = (v)=>{ V.feedWho = v; V.feedKeep = true; redraw(); };
  // Hover, focus or tap a week to see its miles; click (or Enter) picks that week for the board.
  function wireMilesChart(){
    const box = $('kvMiles'); if(!box) return;
    const tip = box.querySelector('.kv-mtip');
    const show = (h)=>{ const [a, b] = h.dataset.tip.split('|'); tip.innerHTML = `<span>${a}</span><b>${b}</b>`; tip.hidden = false;
      tip.style.left = (Number(h.dataset.x) * 100) + '%'; tip.style.top = (Number(h.dataset.y) * 100) + '%'; tip.classList.toggle('l', Number(h.dataset.x) > .7); tip.classList.toggle('r', Number(h.dataset.x) < .3); };
    const pick = (h)=>{ V.feedWeek = Number(h.dataset.i); V.feedKeep = true; redraw(); };
    box.querySelectorAll('.hit').forEach((h)=>{
      h.addEventListener('pointerenter', ()=> show(h)); h.addEventListener('focus', ()=> show(h));
      h.addEventListener('click', ()=> pick(h)); h.addEventListener('keydown', (e)=>{ if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); pick(h); } });
    });
    box.addEventListener('pointerleave', ()=>{ tip.hidden = true; });
    box.addEventListener('focusout', (e)=>{ if(!box.contains(e.relatedTarget)) tip.hidden = true; });
    // A picked past week keeps its numbers showing (a tap on a phone has no hover to show them).
    const picked = (V.feedWeek ?? 7) !== 7 && box.querySelector(`.hit[data-i="${V.feedWeek}"]`);
    if(picked) show(picked);
  }
  SCREENS.feed.after = ()=>{ wireMilesChart(); const p = $('kvPosts'); if(p && typeof wirePostItems === 'function') wirePostItems(p, redraw); if($('kvActivities')) window.kestrelRenderActivities?.($('kvActivities')); };
  ACT.post = async (_, f)=>{ const text = f.elements.text.value.trim(); if(!text) return; const r = await createPostRemote(activePersonId, text, ''); posts.push(r?.post || { id:'post_' + Date.now(), personId:activePersonId, text, header:'', createdAt:Date.now() }); redraw(); };

  // ---------------------------------------------------------------- Team › Schedule (practices, meets, places)
  // Anyone adds to the schedule; whoever added an event, a captain or the owner changes it. Leads also fill a week of practices.
  const ICON_EDIT = '<svg class="kv-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg>';
  const lead = ()=> ['owner', 'captain'].includes(window.KESTREL?.role);
  const canEditEv = (e)=> lead() || (e.createdBy && e.createdBy === activePersonId);
  const allEvents = ()=> Object.entries(events).flatMap(([d, list])=> list.map(e=> ({ ...e, date:d }))).sort((a, b)=> a.date.localeCompare(b.date) || String(a.time || '').localeCompare(String(b.time || '')));
  const evById = (id)=> allEvents().find(e=> e.id === id);
  SCREENS.meets = async ()=>{
    if(!window.KESTREL?.teamId) return noTeam('its schedule');
    const today = todayKey(), all = allEvents(), type = V.schedType || 'all';
    const past = all.filter(e=> e.date < today && e.type === 'meet').reverse();
    const nextMeet = all.find(e=> e.date >= today && e.type === 'meet');
    setSub(nextMeet ? `Next meet: ${nextMeet.title}, ${nice(nextMeet.date)}` : 'No meets coming up');
    const mon = iso(weekStart(new Date(today + 'T12:00:00')));
    const weekName = (m)=>{ const w = Math.round((Date.parse(m) - Date.parse(mon)) / 6048e5); return w === 0 ? 'This week' : w === 1 ? 'Next week' : 'Week of ' + nice(m, { month:'short', day:'numeric' }); };
    // Only this week and next, whole weeks: days already past this week stay visible.
    const nextMon = iso(new Date(Date.parse(mon + 'T12:00:00') + 7 * 864e5));
    const weeks = [mon, nextMon].map(m=> ({ m, list: all.filter(e=> iso(weekStart(new Date(e.date + 'T12:00:00'))) === m && (type === 'all' || e.type === type)) }));
    const row = (e)=>{
      const st = own() ? getRsvp(e.id) : null, et = eventStyle(e), d = new Date(e.date + 'T12:00:00');
      const meta = [et.label, formatEventTimeRange(e), e.location].filter(Boolean).join(' · ');
      return `<div class="kv-li kv-evrow"><span class="kv-evd${e.date === today ? ' now' : ''}"><i>${esc(d.toLocaleDateString(undefined, { weekday:'short' }))}</i><b>${d.getDate()}</b></span>
        <div><b>${esc(e.title)}</b><span>${esc(meta)}</span>${e.checklist ? `<span>Bring: ${esc(e.checklist)}</span>` : ''}${e.desc ? `<span>${esc(e.desc)}</span>` : ''}</div>
        <div class="kv-evact">${st ? `<button type="button" class="kv-rsvp ${st}" data-a="rsvp" data-v="${e.id}">${esc(rsvpLabel[st])}</button>` : ''}${canEditEv(e) ? `<button type="button" class="kv-iconbtn" data-a="evEdit" data-v="${e.id}" aria-label="Edit ${esc(e.title)}" title="Edit">${ICON_EDIT}</button>` : ''}</div></div>`;
    };
    const filters = `<div class="kv-chips" role="group" aria-label="Show">${[['all', 'All'], ['practice', 'Practices'], ['meet', 'Meets'], ['other', 'Other']].map(([v, l])=> `<button type="button" class="kv-chip ${type === v ? 'on' : ''}" aria-pressed="${type === v}" data-a="schedType" data-v="${v}">${l}</button>`).join('')}</div>`;
    const tools = `<div class="card kv-card kv-schedbar">${filters}<div class="kv-btns"><button type="button" class="pri" data-a="evAdd">Add</button>${lead() ? '<button type="button" data-a="evWeek">Week of practices</button>' : ''}<button type="button" data-a="evAi">Import with Kestrel AI</button></div></div>`;
    const none = type === 'all' ? 'Nothing scheduled.' : `No ${type === 'other' ? 'other events' : type + 's'}.`;
    const list = weeks.map(w=> card(esc(weekName(w.m)), '', w.list.length ? `<div class="kv-list">${w.list.map(row).join('')}</div>` : `<div class="kv-hint">${none} Add practices and meets here, or let Kestrel AI read a schedule you paste or attach.</div>`)).join('');
    const results = card('Results', 'Past meets.', `<div class="kv-list">${past.slice(0, 6).map(e=> `<div class="kv-li"><div><b>${esc(e.title)}</b><span>${esc(nice(e.date))}${e.location ? ' · ' + esc(e.location) : ''}</span>${e.results ? `<span class="u-text">${esc(e.results)}</span>` : ''}</div>${canEditEv(e) ? `<button type="button" class="kv-link-sm" data-a="evEdit" data-v="${e.id}">${e.results ? 'Edit' : 'Add results'}</button>` : ''}</div>`).join('') || '<div class="kv-hint">No past meets yet.</div>'}</div>`);
    const places = card('Places', 'Courses, tracks and meeting spots.', `<div class="kv-list">${(locations || []).map(l=> `<div class="kv-li"><div><b>${esc(l.name)}</b><span>${esc(l.address || '')}</span></div><a class="kv-link-sm" href="${mapsSearchLink(l.address || l.name)}" target="_blank" rel="noopener">Map</a>${lead() ? `<button type="button" class="kv-link-sm" data-a="placeEdit" data-v="${l.id}">Edit</button>` : ''}</div>`).join('') || '<div class="kv-hint">No places saved yet.</div>'}</div><div class="kv-btns"><button type="button" data-a="placeAdd">Add a place</button></div>`);
    return `${tools}<div class="kv-row" style="--c:1.3fr 1fr"><div class="kv-stack">${list}</div><div class="kv-stack">${results}${places}</div></div>`;
  };
  ACT.schedType = (v)=>{ V.schedType = v; redraw(); };
  ACT.evAdd = ()=> window.kestrelEventForm?.({ type: V.schedType === 'meet' || V.schedType === 'other' ? V.schedType : 'practice', places: locations || [] });
  ACT.evEdit = (id)=>{ const e = evById(id); if(e) window.kestrelEventForm?.({ event:{ ...e, rsvps: rsvps[id] || {} }, places: locations || [] }); };
  ACT.evWeek = ()=> window.kestrelPracticeWeek?.({ places: locations || [] });
  ACT.evAi = ()=> window.kestrelScheduleAi?.({ places: locations || [] });
  ACT.placeAdd = ()=> window.kestrelPlaceForm?.();
  ACT.placeEdit = (id)=>{ const l = (locations || []).find(x=> x.id === id); if(l) window.kestrelPlaceForm?.(l); };

  // ---------------------------------------------------------------- Team › Plan and Roster (the team's own editors)
  SCREENS.teamplan = async ()=>{ if(!window.KESTREL?.teamId) return noTeam('its plan'); if(own()) await loadKai(); setSub(''); return '<div id="kvTeamPlan" class="kv-stack"></div>'; };
  SCREENS.teamplan.after = ()=> window.kestrelRenderTeamTraining?.($('kvTeamPlan'));
  SCREENS.teamplan.selfFed = true;
  SCREENS.roster = async ()=>{ if(!window.KESTREL?.teamId) return noTeam('its roster'); setSub(''); return '<div id="kvRoster" class="kv-stack"></div>'; };
  SCREENS.roster.after = ()=> window.kestrelRenderRoster?.($('kvRoster'));
  SCREENS.roster.selfFed = true;

  function own(){ return isRealPerson(); }
  function setSub(s){ V.cache['sub:' + V.key] = s; }
})();
