// The redesigned screens (docs/layouts/final.html), drawn from the app's own data and APIs.
// Each screen is a function that returns HTML for #pageV; buttons carry data-a="action" and are handled below.
// Runs after the main script, so it uses its globals: activePersonId, isRealPerson, escapeHtml, events, posts,
// locations, bodyMarks, loadKai, loadFitness, loadLibrary, openKai, navGo and friends.
(function(){
  const esc = (s)=> escapeHtml(String(s ?? ''));
  const V = { key:null, stack:[], month:null, sel:null, teamMonth:null, teamSel:null, wtime:0, wopen:null, fitEdit:false, fitTab:'prs', foodDate:null, xtSport:null, bmView:'front', edit:null, cache:{} };
  const SCREENS = {}, ACT = {};
  // Tab/view (from the heading row) to the screen that draws it.
  const SCREEN_OF = { 'run/plan':'plan', 'run/library':'library', 'run/fitness':'fitness', 'run/goals':'goals', 'calendar/log':'log', 'calendar/team':'teamcal',
    'body/recovery':'recovery', 'body/xtrain':'xtrain', 'body/food':'food', 'team/feed':'feed', 'team/meets':'meets', 'team/training':'teamplan', 'team/roster':'roster' };
  const host = ()=> document.getElementById('pageV');
  const own = ()=> isRealPerson();
  const iso = (d)=> `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const nice = (d, opts)=> new Date(d + 'T12:00:00').toLocaleDateString(undefined, opts || { weekday:'short', month:'short', day:'numeric' });
  const clock = (s)=>{ s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? `${h}:${String(m).padStart(2, '0')}` : m) + ':' + String(x).padStart(2, '0'); };
  const secs = (t)=>{ const p = String(t).trim().split(':').map(Number); return p.some(isNaN) || !p.length ? NaN : p.reduce((a, x)=> a * 60 + x, 0); };
  const ICON = {
    bike:'<svg viewBox="0 0 24 24"><circle cx="6" cy="16" r="3.5"/><circle cx="18" cy="16" r="3.5"/><path d="M6 16l4-7h5l3 7M10 9l2 7M13.5 6H16"/></svg>',
    fuel:'<svg viewBox="0 0 24 24"><path d="M12 7c-1.5-2.5-6-2-6 2.5 0 5 3.5 10.5 6 10.5s6-5.5 6-10.5C18 5 13.5 4.5 12 7z"/><path d="M12 7c0-2 1-3.5 2.5-4"/></svg>',
    lift:'<svg viewBox="0 0 24 24"><path d="M3 12h18M6 8v8M9 9.5v5M18 8v8M15 9.5v5"/></svg>',
    full:'<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
    flip:'<svg viewBox="0 0 24 24"><path d="M17 2.1 21 6l-4 3.9"/><path d="M3 12.6v-2a4 4 0 0 1 4-4h14"/><path d="M7 21.9 3 18l4-3.9"/><path d="M21 11.4v2a4 4 0 0 1-4 4H3"/></svg>',
  };
  const sec = (title, body, aside)=> `<section class="kv-sec"><h3>${title}${aside ? `<small>${aside}</small>` : ''}</h3>${body}</section>`;
  const card = (title, hint, body, right, cls)=> `<div class="card kv-card ${cls || ''}">${title ? `<div class="kv-ch"><div><div class="kv-ct">${title}</div>${hint ? `<div class="kv-hint">${hint}</div>` : ''}</div>${right || ''}</div>` : ''}${body}</div>`;
  const tiles = (rows, cols)=> `<div class="kv-tiles" style="--cols:${cols || rows.length}">${rows.map(([n, v, s])=> `<div><span>${esc(n)}</span><b>${v}</b>${s ? `<i>${esc(s)}</i>` : ''}</div>`).join('')}</div>`;
  const need = (what)=> `<div class="card kv-card"><div class="kv-hint">${what}</div></div>`;
  const toast = (t)=>{ const n = document.createElement('div'); n.className = 'kv-toast'; n.textContent = t; document.body.appendChild(n); setTimeout(()=> n.remove(), 1800); };
  async function getJson(u){ try{ const r = await fetch(u, { cache:'no-store' }); return r.ok ? await r.json() : null; }catch(e){ return null; } }
  async function post(u, body){ try{ const r = await fetch(u, { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(body) }); const d = await r.json().catch(()=> ({})); return r.ok ? d : { error:d.error || 'That didn’t save. Try again.' }; }catch(e){ return { error:'Couldn’t reach Kestrel. Check your connection.' }; } }
  async function logRange(from, to){ return own() ? await getJson(`/api/log?personId=${encodeURIComponent(activePersonId)}&from=${from}&to=${to}`) : null; }
  const weekStart = (d = new Date())=>{ const x = new Date(d); x.setHours(12, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
  const intensity = (diff)=> !diff ? 'i1' : diff <= 3 ? 'i1' : diff <= 5 ? 'i2' : diff <= 7 ? 'i3' : 'i4';
  // A run's name: the main run's own title (not a watch's "Morning Run"), else its kind. Kestrel AI's summary is a paragraph, not a name.
  const runTitle = (d)=>{
    const s = (d?.sessions || []).filter((x)=> x.category !== 'crosstrain').sort((a, b)=> (b.miles || 0) - (a.miles || 0))[0] || d?.sessions?.[0];
    if(s) return s.title && !/^(morning|afternoon|evening|lunch|night)? ?run$/i.test(s.title) ? s.title : SESSION_LABEL[s.category] || 'Run';
    return d?.summary && d.summary.length <= 40 ? d.summary : d?.miles ? 'Run' : 'Rest day';
  };
  const paceOf = (mi, min)=> mi && min ? clock(min * 60 / mi) : '–';
  async function saveDayFields(date, fields){ const r = await post('/api/log/day', { personId:activePersonId, date, fields }); if(r?.error) alert(r.error); else { fitnessData = null; V.cache = {}; } return r; }

  // ---------------------------------------------------------------- shell
  async function draw(){
    const el = host(); if(!el) return;
    const key = V.stack.length ? V.stack[V.stack.length - 1] : V.key;
    const [k, arg] = key.split('|');
    const name = SCREEN_OF[k] || k;
    const fn = SCREENS[name]; if(!fn) return;
    const token = V.token = {};
    const top = window.scrollY;
    const html = await fn(arg);
    if(V.token !== token || currentPage !== 'v') return;
    window.KV.park?.();
    el.className = 'kv kvs-' + name;
    el.innerHTML = html;
    fn.after?.(el, arg);
    window.renderNav?.();
    if(V.keepScroll) window.scrollTo(0, top); V.keepScroll = false;
  }
  const redraw = ()=>{ V.keepScroll = true; return draw(); };
  window.kvRefresh = ()=>{ if(currentPage === 'v') redraw(); };
  window.KV = {
    show(key){ V.key = key; V.stack = []; window.scrollTo(0, 0); return draw(); },
    redraw,
    key(){ return V.key; },
    spoke(){ return V.stack[V.stack.length - 1] || null; },
    title(){ return title(); },
    sub(){ return subtitle(); },
  };
  const push = (k)=>{ V.stack.push(k); window.scrollTo(0, 0); draw(); };
  ACT.back = ()=>{ V.stack.pop(); window.scrollTo(0, 0); draw(); };
  document.addEventListener('click', (e)=>{
    const b = e.target.closest('#pageV [data-a]'); if(!b) return;
    const f = ACT[b.dataset.a]; if(!f) return;
    e.preventDefault(); f(b.dataset.v, b, e);
  });
  document.addEventListener('submit', (e)=>{
    const f = e.target.closest('#pageV form[data-f]'); if(!f) return;
    e.preventDefault(); ACT[f.dataset.f]?.(f.dataset.v, f);
  });

  // Headings: what the page says, not the page's name.
  function title(){
    const sp = V.stack[V.stack.length - 1];
    if(sp){ const [n, a] = sp.split('|'); if(n === 'day') return runTitle(V.cache['day:' + a]) || nice(a); if(n === 'edit') return 'Edit run'; if(n === 'wk') return (WO_TILES.find(t=> t.key === a) || {}).label || 'Workouts'; }
    const k = V.key;
    if(k === 'today') return new Date().toLocaleDateString(undefined, { weekday:'long', month:'long', day:'numeric' });
    if(k === 'run/plan') return V.cache.weekTitle || 'This week';
    if(k === 'run/library') return `${V.cache.libCount || ''} workouts`.trim();
    if(k === 'run/fitness') return V.cache.fitTitle || 'Fitness';
    if(k === 'run/goals') return V.cache.goalsTitle || 'Goals';
    if(k === 'calendar/log') return V.cache.monthTitle || 'Your training';
    if(k === 'calendar/team') return V.cache.teamCalTitle || 'Team schedule';
    if(k === 'body/recovery') return V.cache.feelTitle || 'How you feel';
    if(k === 'body/xtrain') return V.cache.xtTitle || 'Cross-training';
    if(k === 'body/food') return V.cache.foodTitle || 'Fuel';
    if(k.startsWith('team/')) return (window.KESTREL?.teams || []).find(t=> t.id === window.KESTREL?.teamId)?.name || 'Team';
    return '';
  }
  function subtitle(){
    if(V.stack.length){ const [n, a] = V.stack[V.stack.length - 1].split('|'); return n === 'day' || n === 'edit' ? nice(a, { weekday:'long', month:'long', day:'numeric' }) : ''; }
    return V.cache['sub:' + V.key] || '';
  }
  const setSub = (k, s)=>{ V.cache['sub:' + k] = s; };

  // ---------------------------------------------------------------- Today
  SCREENS.today = async ()=>{
    const today = todayKey();
    const [h, wk, x, f] = own() ? await Promise.all([loadKai(), logRange(iso(weekStart()), today), getJson('/api/xtrain'), getJson('/api/food')]) : [null, null, null, null];
    const byDate = {}; (wk?.days || []).forEach(d=> byDate[d.date] = d);
    const t = h?.today, day = byDate[today];
    const ev = (events[today] || []);
    setSub('today', [t && t.type !== 'Off' ? `${t.type} day` : t ? 'Rest day' : '', ev[0] && `${ev[0].title}${ev[0].time ? ' ' + ev[0].time : ''}${ev[0].location ? ' at ' + ev[0].location : ''}`].filter(Boolean).join(' · '));
    let run;
    if(!own()) run = need('Pick your name to see your run for today.');
    else if(!h?.week) run = card('No plan yet', 'Tell Kestrel AI your goals and it builds your plan with you.', `<div class="kv-btns"><button type="button" data-a="go" data-v="run/plan">Set up your plan</button></div>`);
    else {
      const changed = ['kai','hawky','auto'].includes(t?.source);
      const done = h.today_done?.sessions || [];
      const detail = t ? (sessionText(t) || t.base?.notes || '') : '';
      run = `<div class="card kv-card kv-run">
        <div class="kv-eb">${done.length ? 'Done today' : 'Today’s workout'}${changed ? ' · changed by Kestrel AI' : ''}${t?.base?.week ? ' · ' + esc(t.base.week) : ''}</div>
        <button type="button" class="kv-runh" data-a="day" data-v="${today}">${esc(t?.type === 'Off' ? 'Rest day' : t?.type || 'Rest day')}${t?.miles ? ` <span>${esc(t.miles)} mi</span>` : ''} <i>›</i></button>
        ${detail ? `<div class="kv-hint kv-on">${esc(detail)}</div>` : ''}
        ${changed && t.reason ? `<div class="kv-hint kv-on"><b>Why:</b> ${esc(t.reason)}</div>` : ''}
        ${done.length ? `<div class="kv-done">${done.map(s=> `<button type="button" data-a="day" data-v="${today}"><b>${esc(SESSION_LABEL[s.category] || 'Run')} ${esc(s.miles)} mi</b><span>${esc([s.pace && s.pace + '/mi', s.avg_hr && s.avg_hr + ' bpm'].filter(Boolean).join(' · '))}</span></button>`).join('')}</div>` : ''}
        ${h.tomorrow ? `<div class="kv-hint kv-on kv-next">Tomorrow: ${esc(h.tomorrow.type === 'Off' ? 'Rest' : `${h.tomorrow.type}${h.tomorrow.miles ? ' ' + h.tomorrow.miles + ' mi' : ''}`)}</div>` : ''}
        <div class="kv-btns">${done.length ? `<button type="button" class="pri" data-a="day" data-v="${today}">View run</button>` : `<button type="button" class="pri" data-a="record">Start run</button><button type="button" data-a="cant">Can’t do this</button>`}<button type="button" data-a="ask">Ask Kestrel AI</button>${changed ? `<button type="button" data-a="unswap" data-v="${t.date}">Back to the plan</button>` : ''}</div>
      </div>`;
    }
    const feel = own() ? feelCard(day, true) : need('Pick your name to check in.');
    const week = h?.week ? `<div class="kv-week">${h.week.days.map(d=>{ const lg = byDate[d.date], dt = new Date(d.date + 'T12:00:00'), off = d.type === 'Off';
        const did = lg?.miles > 0;
        return `<button type="button" class="kv-wk ${d.date === today ? 'now' : ''} ${did ? 'did' : ''} ${off ? 'off' : ''}" data-a="day" data-v="${d.date}"><span>${dt.toLocaleDateString(undefined, { weekday:'short' })} ${dt.getDate()}</span><b>${esc(off ? 'Rest' : d.type)}</b><i>${did ? '✓ ' + lg.miles + ' mi' : off ? '–' : d.miles + ' mi'}</i>${(events[d.date] || []).some(e=> e.type === 'meet') ? '<em>Meet</em>' : ''}</button>`; }).join('')}</div>` : '';
    const planned = h?.week ? h.week.days.reduce((a, d)=> a + (Number(d.miles) || 0), 0) : 0;
    const doneMi = (wk?.days || []).reduce((a, d)=> a + (d.miles || 0), 0);
    const xw = x?.this_week || {};
    const off = `<div class="kv-off">
      <button type="button" class="card kv-card kv-tile" data-a="go" data-v="body/xtrain">${ICON.bike}<span><b>Cross-train</b><small>${xw.sessions ? `${xw.sessions} ${xw.sessions === 1 ? 'session' : 'sessions'} · ${Math.round(xw.xt_min)} min this week` : 'Nothing yet this week'}</small></span></button>
      <button type="button" class="card kv-card kv-tile" data-a="go" data-v="body/food">${ICON.fuel}<span><b>${f ? Math.round(f.totals?.kcal || 0).toLocaleString() + ' kcal' : 'Fuel'}</b><small>${f ? `${Math.round(f.totals?.carbs_g || 0)} g carbs today` : 'Log what you eat'}</small></span></button></div>`;
    const teamToday = window.KESTREL?.teamId ? (ev.length ? ev.map(e=> eventCard(e, today)).join('') : card('', '', `<div class="kv-hint">Nothing on the team calendar today.</div><button type="button" class="kv-link" data-a="go" data-v="calendar/team"><span>Open the team calendar</span><i>›</i></button>`))
      + (latestPost() ? card('', '', latestPost()) : '') : need('Join a team to see practices and meets here.');
    const kai = card('', '', `<div class="kv-hint">Tell it how a run felt, what hurts, or what you can’t make, and it adjusts your plan.</div>
      <form class="kv-compose" data-f="askToday"><input name="q" placeholder="Tell Kestrel AI how it went" autocomplete="off"><button type="submit" class="pri">Send</button></form>`);
    return `<div class="kv-today">
      <div class="kv-row" style="--c:1.55fr 1fr">${sec('Your run', run)}${sec('How you feel', feel)}</div>
      ${week ? sec('This week', week, `${Math.round(doneMi * 10) / 10} of ${Math.round(planned * 10) / 10} mi${h?.level ? ' · ' + h.level.weekly_miles + ' mi level' : ''}`) : ''}
      <div class="kv-row" style="--c:1fr 1fr 1.15fr">${sec('Off the run', off)}${sec('Team today', teamToday)}${sec('Kestrel AI', kai)}</div>
    </div>`;
  };
  function latestPost(){
    const p = [...(posts || [])].sort((a, b)=> b.createdAt - a.createdAt)[0];
    if(!p) return '';
    const who = people.find(x=> x.id === p.personId);
    return `<div class="kv-post"><span class="kv-av" style="background:${who?.color || '#888'}">${esc((who?.name || '?').slice(0, 1))}</span><div><b>${esc(who?.name || 'Teammate')}</b><div class="kv-hint" style="color:var(--text)">${esc(p.header ? p.header + ': ' : '')}${esc(p.text)}</div></div></div>`;
  }
  function eventCard(e, date){
    const st = own() ? getRsvp(e.id) : null;
    const et = eventStyle(e);
    return `<div class="card kv-card kv-ev"><div class="kv-ch"><div><div class="kv-eb" style="color:${et.text}">${esc([formatEventTimeRange(e), et.label].filter(Boolean).join(' · '))}</div><div class="kv-ct">${esc(e.title)}</div>${e.location ? `<div class="kv-hint">${esc(e.location)}</div>` : ''}</div>
      ${st ? `<button type="button" class="kv-rsvp ${st}" data-a="rsvp" data-v="${e.id}">${esc(st === 'unknown' ? 'RSVP' : rsvpLabel[st])}</button>` : ''}</div>${e.desc ? `<div class="kv-hint" style="margin-top:8px">${esc(e.desc)}</div>` : ''}</div>`;
  }
  // Feel 1-10 and sleep save to today's training log; health and sore spots are the app's statuses.
  function feelCard(day, compact){
    const feel = day?.feel, sleep = day?.sleep_hours ?? null, health = currentHealthStatus(), marks = Object.keys(bodyMarks[activePersonId] || {});
    return card('', '', `<div class="kv-eb">How do you feel today?</div><div class="kv-feel">${[1,2,3,4,5,6,7,8,9,10].map(n=> `<button type="button" class="${feel === n ? 'on' : ''}" data-a="feel" data-v="${n}">${n}</button>`).join('')}</div>
      <div class="kv-line"><div><b>Sleep</b><span>last night</span></div><div class="kv-step"><button type="button" data-a="sleep" data-v="-0.5" aria-label="Less sleep">−</button><b>${sleep == null ? 'Not set' : sleep + ' h'}</b><button type="button" data-a="sleep" data-v="0.5" aria-label="More sleep">+</button></div></div>
      <div class="kv-line"><b>Status</b><div class="kv-chips">${HEALTH_KEYS.map(k=> `<button type="button" class="kv-chip ${k === health ? 'on' : ''}" data-a="health" data-v="${k}">${HEALTH_STATES[k].label}</button>`).join('')}</div></div>
      ${compact ? '' : `<div class="kv-line"><b>Training</b><div class="kv-chips">${TRAINING_KEYS.map(k=> `<button type="button" class="kv-chip ${k === currentTrainingStatus() ? 'on' : ''}" data-a="trainStatus" data-v="${k}">${TRAINING_STATES[k].label}</button>`).join('')}</div></div>`}
      ${compact ? `<button type="button" class="kv-link" data-a="go" data-v="body/recovery"><span>${marks.length ? `${marks.length} sore ${marks.length === 1 ? 'spot' : 'spots'} on your body map` : 'Body map: nothing marked'}</span><i>›</i></button>` : ''}`);
  }
  ACT.feel = async (v)=>{ await saveDayFields(todayKey(), { feel:+v }); redraw(); };
  ACT.sleep = async (v)=>{ const d = (await logRange(todayKey(), todayKey()))?.days?.[0]; const cur = d?.sleep_hours ?? 7.5; await saveDayFields(todayKey(), { sleep_hours:Math.max(0, Math.min(14, cur + +v)) }); redraw(); };
  ACT.health = async (v)=>{ await setHealth(v); redraw(); };
  ACT.record = ()=> setPage('record');
  ACT.cant = ()=> openKai("I can't do today's run as planned because ", false);
  ACT.ask = ()=> openKai();
  ACT.unswap = async (d)=>{ await resetPlanDay(d, false); redraw(); };
  ACT.go = (v)=>{ const [t, s] = v.split('/'); navGo(t, s); };
  ACT.rsvp = async (id)=>{ await cycleRsvp(id); redraw(); };
  ACT.askToday = (_, f)=>{ const q = f.elements.q.value.trim(); if(!q) return; kaiPending = q; navGo('run', 'kai'); };
  ACT.day = (d)=>{ V.sel = d; push('day|' + d); };

  // ---------------------------------------------------------------- Run › Plan
  SCREENS.plan = async ()=>{
    if(!own()) return need('Pick your name to see your plan.');
    const h = await loadKai();
    const host2 = '<div id="kvPersonalPlan"></div>';
    if(!h?.week){ V.cache.weekTitle = 'No plan yet'; return `<div class="kv-row" style="--c:1.4fr 1fr"><div>${host2}</div><div></div></div>`; }
    const days = h.week.days, today = todayKey();
    const lg = await logRange(days[0].date, days[days.length - 1].date);
    const byDate = {}; (lg?.days || []).forEach(d=> byDate[d.date] = d);
    V.cache.weekTitle = `Week of ${nice(days[0].date, { month:'long', day:'numeric' })}`;
    setSub('run/plan', `${h.week.week_type ? (/week$/i.test(h.week.week_type) ? h.week.week_type : h.week.week_type + ' week') : 'This week'}${h.changes.length ? ' · with Kestrel AI’s changes' : ''}`);
    const planned = days.reduce((a, d)=> a + (Number(d.miles) || 0), 0), done = days.reduce((a, d)=> a + (byDate[d.date]?.miles || 0), 0);
    const list = `<div class="card kv-card kv-days">${days.map(d=>{ const off = d.type === 'Off', did = byDate[d.date], dt = new Date(d.date + 'T12:00:00');
        const changed = ['kai','hawky','auto'].includes(d.source);
        const lanes = [[off ? 'bl' : '', off ? 'Rest' : d.type], ...(changed ? [['', 'Kestrel AI']] : []), ...(events[d.date] || []).map(e=> ['g', `${e.title}${e.time ? ' ' + e.time : ''}`])];
        return `<button type="button" class="kv-day ${d.date === today ? 'now' : ''}" data-a="day" data-v="${d.date}"><div class="kv-dn"><b>${dt.getDate()}</b><span>${dt.toLocaleDateString(undefined, { weekday:'short' })}</span></div>
          <div class="kv-dm"><div class="kv-dt">${did?.miles ? `✓ ${esc(runTitle(did))} · ${did.miles} mi` : esc(off ? 'Rest' : `${d.type} · ${d.miles} mi`)}</div>${sessionText(d) || d.base?.notes ? `<div class="kv-hint">${esc(sessionText(d) || d.base.notes)}</div>` : ''}<div class="kv-lanes">${lanes.map(([c, l])=> `<span class="kv-pill ${c}">${esc(l)}</span>`).join('')}</div></div></button>`; }).join('')}</div>`;
    const side = card('This week', '', tiles([['Done', Math.round(done * 10) / 10, `of ${Math.round(planned * 10) / 10} mi`], ['Runs', days.filter(d=> byDate[d.date]?.miles).length, `of ${days.filter(d=> d.type !== 'Off').length}`]], 2))
      + card('Your level', '', levelHtml(h))
      + card('Kestrel AI’s changes', 'What moved in your plan and why.', `<div class="kv-changes">${changesHtml(h)}</div>`);
    return `<div class="kv-row" style="--c:1.4fr 1fr"><div class="kv-stack">${list}${host2}</div><div class="kv-stack">${side}</div></div>`;
  };
  SCREENS.plan.after = (el)=>{
    el.querySelectorAll('[data-undo]').forEach(b=> b.addEventListener('click', async ()=>{ await resetPlanDay(b.dataset.undo, false); redraw(); }));
    if(window.kestrelRenderPersonalPlan && $('kvPersonalPlan')) window.kestrelRenderPersonalPlan($('kvPersonalPlan'));
  };

  // ---------------------------------------------------------------- Run › Workouts
  const LIB_LEN = [[0, 'Any length'], [35, 'Up to 35 min'], [50, 'Up to 50 min'], [65, 'Up to 65 min']];
  SCREENS.library = async ()=>{
    const lib = await loadLibrary();
    if(!lib) return need('Couldn’t load the workout library. Check your connection.');
    const fits = (w)=> !V.wtime || w.total_min <= V.wtime;
    V.cache.libCount = lib.workouts.length;
    setSub('run/library', lib.fitness?.vo2r ? 'Written for you: your level, with goal splits from your fitness.' : 'Add PRs or connect your watch to get goal splits written for you.');
    const tilesHtml = WO_TILES.map(t=>{ const n = t.key === 'kai' ? null : lib.workouts.filter(w=> fits(w) && (t.key === 'all' || w.type === t.key)).length;
      return `<button type="button" class="card kv-card kv-wo ${t.key === 'kai' ? 'kai' : ''} ${n === 0 ? 'none' : ''}" data-a="${t.key === 'kai' ? 'woKai' : 'wo'}" data-v="${t.key}">${WO_ICON[t.icon] || ''}${n !== null ? `<i>${n}</i>` : ''}<b>${t.label}</b><small>${t.sub}</small></button>`; }).join('');
    return `<div class="kv-chips kv-filter">${LIB_LEN.map(([v, l])=> `<button type="button" class="kv-chip ${V.wtime === v ? 'on' : ''}" data-a="wtime" data-v="${v}">${l}</button>`).join('')}</div><div class="kv-wogrid">${tilesHtml}</div>`;
  };
  ACT.wtime = (v)=>{ V.wtime = +v; redraw(); };
  ACT.wo = (k)=> push('wk|' + k);
  ACT.woKai = ()=> openKai(`Build me a workout for tomorrow${V.wtime ? ` in under ${V.wtime} minutes` : ''}, with my rep targets.`, false);
  SCREENS.wk = async (type)=>{
    const lib = await loadLibrary();
    const list = (lib?.workouts || []).filter(w=> (type === 'all' || w.type === type) && (!V.wtime || w.total_min <= V.wtime));
    const tile = WO_TILES.find(t=> t.key === type) || {};
    const set = (x)=> `<div class="kv-set"><div class="kv-ch"><b>${esc(x.label)}</b><span class="kv-hint">${esc(x.zone)}${x.rest ? ` · ${esc(x.rest)} between` : ''}</span></div>${x.rows[0]?.goal ? `<div class="kv-reps">${x.rows.map(r=> `<span><small>${esc(r.n)} · ${esc(r.what)}</small>${esc(r.goal)}</span>`).join('')}</div>` : ''}</div>`;
    return `<button type="button" class="kv-back" data-a="back">‹ Workouts</button>
      <div class="kv-chips kv-filter">${LIB_LEN.map(([v, l])=> `<button type="button" class="kv-chip ${V.wtime === v ? 'on' : ''}" data-a="wtime" data-v="${v}">${l}</button>`).join('')}</div>
      <div class="kv-hint" style="margin:0 0 12px">${esc(tile.sub || '')} · ${list.length} workouts</div>
      <div class="kv-wolist">${list.map(w=>{ const pw = w.personal, open = V.wopen === w.id;
        return `<div class="card kv-card kv-woitem ${open ? 'open' : ''}"><button type="button" class="kv-ch kv-wohead" data-a="wopen" data-v="${w.id}"><div><div class="kv-ct" style="font-size:17px">${esc(w.name)}</div><div class="kv-hint">${esc(pw?.session || w.main)}</div></div><span class="kv-pill bl">${w.total_min} min</span></button>
          ${open ? `<div class="kv-wobody">${(pw?.sections || []).map(set).join('')}
            <div class="kv-why"><b>Why</b><span>${esc(w.purpose)}</span></div><div class="kv-why"><b>How to run it</b><span>${esc(w.cues)}</span></div><div class="kv-why"><b>Next time</b><span>${esc(w.progress)}</span></div>
            ${own() ? `<div class="kv-btns"><button type="button" class="pri" data-a="woFit" data-v="${w.id}">Fit it into my week</button></div>` : ''}</div>` : ''}</div>`; }).join('') || need('Nothing this short. Try a longer time.')}</div>`;
  };
  ACT.wopen = (id)=>{ V.wopen = V.wopen === id ? null : id; redraw(); };
  ACT.woFit = async (id)=>{ const w = (await loadLibrary()).workouts.find(x=> x.id === id); openKai(`Can I fit "${w.name}" into my week? Which day works best?`, false); };

  // ---------------------------------------------------------------- Run › Fitness
  const spark = (vs, w = 600, h = 56)=>{ if(vs.length < 2) return ''; const lo = Math.min(...vs), hi = Math.max(...vs), sp = (hi - lo) || 1, xy = vs.map((v, i)=> [6 + i / (vs.length - 1) * (w - 12), 6 + (1 - (v - lo) / sp) * (h - 12)]);
    const line = xy.map(([x, y])=> `${x.toFixed(1)},${y.toFixed(1)}`).join(' '), [lx, ly] = xy[xy.length - 1];
    return `<svg class="kv-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polygon points="${line} ${w - 6},${h} 6,${h}" fill="var(--accent)" opacity=".12"/><polyline points="${line}" fill="none" stroke="var(--accent)" stroke-width="2.5" vector-effect="non-scaling-stroke" stroke-linejoin="round"/><circle cx="${lx}" cy="${ly}" r="4" fill="var(--accent)"/></svg>`; };
  const conf = (c)=> `<i class="kv-conf ${c || 'low'}" title="${esc(c || 'low')} confidence"></i>`;
  SCREENS.fitness = async ()=>{
    if(!own()) return need('Pick your name to see your fitness.');
    const data = await loadFitness();
    const f = data?.fitness;
    if(!f || !f.vo2r){ V.cache.fitTitle = 'No fitness data yet'; return card('Race fitness', 'Add your PRs (with dates) or connect your watch, and Kestrel works out what you can race now.', `<div class="kv-btns"><button type="button" class="pri" data-a="prs">Add PRs</button><button type="button" data-a="watch">Set up watch</button></div>`); }
    const five = f.estimates.find(e=> e.event === '5K');
    V.cache.fitTitle = five ? `5K in ${five.time}` : 'Fitness';
    const hist = (data.history || []).filter(x=> x.vo2r);
    setSub('run/fitness', [`${cap(f.confidence)} confidence`, f.trend ? `5K ${f.trend.five_k_sec_change <= 0 ? 'down' : 'up'} ${Math.abs(f.trend.five_k_sec_change)} s since ${nice(f.trend.since, { month:'short', day:'numeric' })}` : '', f.model?.name || 'KestrelPredict'].filter(Boolean).join(' · '));
    const fs = f.fitness_score;
    const hero = tiles([[f.vo2max_source === 'watch' ? 'VO2max (watch)' : 'VO2max', f.vo2max ?? '–', f.vo2max_source === 'watch' ? 'from your watch' : 'Kestrel estimate'], ['Kestrel VO2max', f.vo2r, 'from your races'],
      fs ? ['Fitness', fs.fitness, fs.change_4wk != null ? `${fs.change_4wk >= 0 ? '+' : ''}${fs.change_4wk} in 4 wk` : ''] : ['Miles a week', f.mpw ?? '–', 'last 4 weeks'],
      fs ? ['Form', `${fs.form > 0 ? '+' : ''}${fs.form}`, `fatigue ${fs.fatigue}`] : ['Longest run', f.longest_28d ? f.longest_28d + ' mi' : '–', 'last 4 weeks']], 4);
    let table;
    if(V.fitEdit) table = `<div class="kv-hint" style="margin:12px 0 10px">Tap the events you want to see. The dot shows how sure each estimate is.</div>
      <div class="kv-evpick">${byDistance(f.estimates).map(e=>{ const on = fitShown.includes(e.event); return `<button type="button" class="${on ? 'on' : ''}" data-a="fitev" data-v="${esc(e.event)}" role="checkbox" aria-checked="${on}"><span class="box">${on ? '✓' : ''}</span>${esc(e.label)}${conf(e.confidence)}</button>`; }).join('')}</div>`;
    else {
      const rows = byDistance([...f.estimates.filter(e=> fitShown.includes(e.event)), ...(f.course_estimates || []).map(c=> ({ ...c, course:true }))]);
      const row = (e)=> `<div class="kv-frow ${e.course ? 'course' : ''}"><span class="ev">${e.course ? '<i class="kv-conf course"></i>' : conf(e.confidence)}${esc(e.label)}</span><span class="tm">${esc(e.time)}${e.plus_minus_pct != null ? `<small>±${e.plus_minus_pct}%</small>` : ''}</span><span class="pc">${esc(e.pace_mi || '')}${e.pace_mi ? '/mi' : ''}${e.pr?.time ? ` <b>PR ${esc(e.pr.time)}</b>` : ''}</span></div>`;
      table = rows.length > 8 ? `<div class="kv-fgrid">${rows.map(row).join('')}</div>` : `<div class="kv-frow head"><span>Event</span><span>Estimate</span><span>Pace · PR</span></div>${rows.map(row).join('') || '<div class="kv-hint">No events picked. Tap Edit events to choose some.</div>'}`;
      table += `<div class="kv-legend"><span>${conf('high')}high</span><span>${conf('medium')}medium</span><span>${conf('low')}low confidence: how tight the 80% range is</span></div>`;
    }
    const trend = !V.fitEdit && hist.length >= 2 ? `<div class="kv-trend">${spark(hist.map(x=> x.vo2r))}<div class="kv-hint">Race fitness over time${f.trend ? `: 5K ${f.trend.five_k_sec_change <= 0 ? 'down' : 'up'} ${Math.abs(f.trend.five_k_sec_change)} s` : ''}.</div></div>` : '';
    const main = card('Race fitness', 'What you could race right now, from your races and PRs. The ± is each estimate’s 80% range.', hero + `<div class="kv-ftable">${table}</div>` + trend,
      `<div class="kv-ch-r">${f.new_prs?.length ? `<span class="kv-pill g">New PR</span>` : ''}<button type="button" class="${V.fitEdit ? 'pri' : ''}" data-a="fitedit">${V.fitEdit ? 'Done' : 'Edit events'}</button></div>`);
    const paces = card('Training paces', 'Every workout in Kestrel uses these.', `<div class="kv-paces">${(f.zones || []).map(z=> `<div><span>${esc(PACE_SHORT[z.key] || z.label)}</span><b>${esc(z.per_mile)}</b>${z.per_400 ? `<i>${esc(z.per_400)}/400</i>` : ''}</div>`).join('')}</div>`);
    const kind = { race:'Race effort', pr:'PR', manual:'You entered', reps:'Workout', hr:'Heart rate', best:'Best effort', watch:'Watch' };
    const prs = (f.sources || []).filter(x=> x.kind === 'pr' && x.date).sort((a, b)=> b.date.localeCompare(a.date)).slice(0, 4);
    const tab = V.fitTab;
    const body = tab === 'prs' ? `${(f.new_prs || []).map(p=> `<div class="kv-note">New PR found: <b>${esc(p.event)} ${esc(p.time)}</b> on ${esc(p.date)}</div>`).join('')}<div class="kv-list">${prs.map(x=> `<div class="kv-li"><div><b>${esc(x.label.replace(/ \(.*$/, ''))}</b><span>${esc(nice(x.date, { month:'short', day:'numeric', year:'numeric' }))}</span></div></div>`).join('') || '<div class="kv-hint">No PRs with dates yet.</div>'}</div><div class="kv-btns"><button type="button" data-a="prs">Edit PRs</button></div>`
      : tab === 'based' ? `<div class="kv-list">${(f.sources || []).slice(0, 5).map(x=> `<div class="kv-li"><div><b>${esc(x.label)}</b><span>${esc(kind[x.kind] || x.kind)}${x.date ? ' · ' + esc(x.date) : ''}${x.vo2r ? ' · rated ' + x.vo2r : ''}</span></div></div>`).join('')}</div><div class="kv-hint">Profile: ${f.profile === 'speed' ? 'speed-leaning' : f.profile === 'endurance' ? 'endurance-leaning' : 'balanced'}.</div><div class="kv-btns"><button type="button" data-a="fitRecalc">Recalculate</button><button type="button" data-a="prs">Update PRs</button></div>`
      : tab === 'calc' ? `<form class="kv-form" data-f="heat"><div class="kv-ct" style="font-size:16px">Heat and hills</div><div class="kv-grid3"><label><span>Cool-day 5K</span><input name="time" value="${esc(five?.time || '')}"></label><label><span>Temp °F</span><input name="temp_f" type="number" value="75"></label><label><span>Dew point °F</span><input name="dew_f" type="number" value="60"></label></div><div class="kv-btns"><button type="submit" class="pri">Calculate</button></div><div class="kv-hint" id="kvHeatOut"></div></form><button type="button" class="kv-link" data-a="oldCalc"><span>Taper and Runners like you</span><i>›</i></button>`
      : `<div class="kv-how"><p><b>Every run is searched for races.</b> Any run at a race distance and race effort counts, and a faster one updates your PR.</p><p><b>Course and weather are taken out.</b> Each race is credited back to a flat course on a cool day.</p><p><b>KestrelPredict reads your results</b> from the last two years. The ± is its 80% range.</p><p><b>VO2max</b> is your watch’s when it sends one; Kestrel VO2max is what your races are worth and sets your paces.</p></div>`;
    const tabs = card('', '', `<div class="seg kv-seg">${[['prs','Recent PRs'],['based','Based on'],['calc','Calculators'],['how','How it works']].map(([v, l])=> `<button type="button" class="seg-btn ${tab === v ? 'active' : ''}" data-a="fittab" data-v="${v}">${l}</button>`).join('')}</div><div class="kv-tab">${body}</div>`);
    return `<div class="kv-row" style="--c:1.5fr 1fr">${main}<div class="kv-stack">${paces}${tabs}</div></div>`;
  };
  ACT.fitedit = ()=>{ V.fitEdit = !V.fitEdit; redraw(); };
  ACT.fitev = (k)=>{ fitShown = fitShown.includes(k) ? fitShown.filter(x=> x !== k) : [...fitShown, k]; saveFitShown(); redraw(); };
  ACT.fittab = (v)=>{ V.fitTab = v; redraw(); };
  ACT.fitRecalc = async ()=>{ await loadFitness(true); toast('Recalculated'); redraw(); };
  ACT.prs = ()=> goToPrs();
  ACT.watch = ()=>{ setPage('you'); setYouView('integrations'); };
  ACT.oldCalc = ()=>{ trainingView = 'fitness'; setPage('training'); setTimeout(()=> document.querySelector('#tpFitnessView details')?.scrollIntoView({ block:'center' }), 300); };
  ACT.heat = async (_, f)=>{ const p = Object.fromEntries(new FormData(f)); const d = await getJson('/api/calc/heat?' + new URLSearchParams({ race:'5K', climb_ft_per_mile:0, ...p }));
    $('kvHeatOut').innerHTML = !d ? 'Couldn’t calculate.' : d.error ? esc(d.error) : `<b>${esc(d.expected_time)}</b> expected (${esc(d.pace_mi)}/mi), ${d.cost_sec >= 0 ? '+' : ''}${d.cost_sec} s vs ${esc(d.cool_day_time)}.`; };

  // ---------------------------------------------------------------- Run › Goals
  SCREENS.goals = async ()=>{
    if(!own()) return need('Pick your name to set goals.');
    const d = await getJson('/api/goals');
    if(window.kTrack) window.kTrack.goals($('tpGoalsView'));  // loads the goal editor's lists
    const goals = (d?.goals || []).filter(g=> g.status !== 'archived');
    V.cache.goalsTitle = goals.length ? `${goals.length} ${goals.length === 1 ? 'goal' : 'goals'}` : 'No goals yet';
    setSub('run/goals', goals.find(g=> g.priority) ? `Main goal: ${goals.find(g=> g.priority).title}` : '');
    const STATE = { on_track:['On track', 'g'], close:['Close', 'bl'], building:['Building', ''], no_estimate:['Needs data', ''], incomplete:['Needs a target', ''] };
    const gcard = (g, i)=>{
      const [st, tone] = g.achieved ? ['Achieved', 'g'] : STATE[g.state] || ['', ''];
      const when = g.target_date ? (g.days_left > 0 ? `${g.days_left} days to go · ${nice(g.target_date, { month:'short', day:'numeric', year:'numeric' })}` : 'Date has passed') : '';
      let body = '';
      if(g.kind === 'race') body = tiles([['You now', esc(g.estimate || '–')], ['Goal', esc(g.target_time)], ['Gap', esc(g.gap || '–')], ['Goal pace', esc(g.goal_pace_mi || '–') + '/mi']], 4)
        + `<div class="kv-bar big"><i style="width:${Math.max(2, g.pct || 0)}%"></i></div><div class="kv-hint">${g.state === 'on_track' ? `Your estimate (${esc(g.range || g.estimate)}) is already under your goal.` : g.state === 'no_estimate' ? esc(g.message || 'Add a race or PR to track this.') : `${g.pct || 0}% of the way from ${esc(g.start)} when you set this goal.`}${g.pr ? ` PR ${esc(g.pr)}.` : ''}</div>`
        + (g.equivalents?.length ? `<div class="kv-chips" style="margin-top:10px">${g.equivalents.map(e=> `<span class="kv-pill">${esc(e.label.split(' /')[0])} ${esc(e.time)}</span>`).join('')}</div>` : '');
      else body = `${g.current != null ? tiles([['Now', esc(g.current)], ['Target', esc(g.target)]], 2) : ''}<div class="kv-bar big"><i style="width:${Math.max(2, Math.min(100, g.pct || 0))}%"></i></div><div class="kv-hint">${g.pct || 0}%${g.message ? ' · ' + esc(g.message) : ''}</div>`;
      return card(`${esc(g.title)}${g.priority ? ' <span class="kv-pill">Main</span>' : ''}`, esc(when), body, `<div class="kv-ch-r">${st ? `<span class="kv-pill ${tone}">${st}</span>` : ''}<button type="button" data-a="goalEdit" data-v="${i}">Edit</button></div>`);
    };
    V.cache.goals = goals;
    const ideas = card('Add a goal', 'Pick one, or write your own.', `<div class="kv-list">${(window.kTrack?.GOAL_TEMPLATES || []).map((t, i)=> `<button type="button" class="kv-li" data-a="goalNew" data-v="${i}"><div><b>${esc(t.label)}</b></div><i>+ Add</i></button>`).join('')}</div>`);
    return `<div class="kv-row" style="--c:1.5fr 1fr"><div class="kv-stack">${goals.map(gcard).join('') || need('No goals yet. Pick one on the right.')}</div><div class="kv-stack">${ideas}</div></div>`;
  };
  ACT.goalEdit = (i)=> window.kTrack?.editGoal(V.cache.goals[+i]);
  ACT.goalNew = (i)=> window.kTrack?.editGoal(null, window.kTrack.GOAL_TEMPLATES[+i]);

  window.KV.screens = SCREENS; window.KV.has = (k)=> !!SCREENS[SCREEN_OF[k] || k]; window.KV.act = ACT; window.KV.state = V;
  window.KV._h = { esc, sec, card, tiles, need, toast, getJson, post, logRange, weekStart, intensity, runTitle, paceOf, saveDayFields, iso, nice, clock, secs, push, redraw, ICON, feelCard, eventCard, spark, latestPost };
})();
