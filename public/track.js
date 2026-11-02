// Train > Goals, Cross-train and Fuel, plus "Customize" for the Train tabs. The server (src/train/tracking.js) does
// the maths; this draws it and saves what the runner types. Runs after the main script, which owns $, escapeHtml,
// sparkline/drawSparks, openKai and the people list.
(function(){
  const esc = (s)=> escapeHtml(String(s ?? ''));
  const T = { prefs:null, meta:null, foodDate:null, foodTier:'', recent:null, goals:null, xt:null, xtSport:'' };
  const todayIso = ()=>{ const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  const shiftIso = (iso, n)=>{ const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  const dayLabel = (iso)=>{ const t = todayIso(); if(iso === t) return 'Today'; if(iso === shiftIso(t, -1)) return 'Yesterday'; return new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { weekday:'short', month:'short', day:'numeric' }); };
  const weekLabel = (iso)=> new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { month:'short', day:'numeric' });
  const mins = (m)=> m >= 60 ? `${Math.floor(m / 60)}h ${Math.round(m % 60)}m` : `${Math.round(m)}m`;
  const tile = (v, l)=> `<div class="stat"><b>${esc(v)}</b><span>${esc(l)}</span></div>`;

  async function getJson(path){
    const res = await fetch(path, { cache:'no-store' });
    const data = await res.json().catch(()=> ({}));
    if(!res.ok) throw new Error(data.error || 'Couldn’t load this. Check your connection and try again.');
    return data;
  }
  async function send(path, body, method = 'POST'){
    const res = await fetch(path, { method, headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(body) });
    const data = await res.json().catch(()=> ({}));
    if(!res.ok) throw new Error(data.error || 'That didn’t save. Try again.');
    return data;
  }
  function fail(el, err){ el.innerHTML = `<section class="card"><div class="hint">${esc(err.message)}</div></section>`; }
  function flash(btn, text){ if(!btn) return; const t = btn.textContent; btn.textContent = text; setTimeout(()=>{ btn.textContent = t; }, 1600); }

  // One modal for every editor here.
  function modal(title, body, onOpen){
    let o = $('trackModal');
    if(!o){
      o = document.createElement('div');
      o.className = 'modal-overlay'; o.id = 'trackModal';
      o.innerHTML = `<div class="modal-box" role="dialog" aria-modal="true" aria-labelledby="trackModalTitle"><div class="modal-head"><h3 id="trackModalTitle"></h3><button class="ghost" type="button" id="trackModalClose" aria-label="Close">✕</button></div><div class="modal-list stack" id="trackModalBody"></div></div>`;
      document.body.appendChild(o);
      o.addEventListener('click', (e)=>{ if(e.target === o) closeModal(); });
      $('trackModalClose').onclick = closeModal;
    }
    $('trackModalTitle').textContent = title;
    $('trackModalBody').innerHTML = body;
    o.classList.add('show');
    onOpen?.($('trackModalBody'));
  }
  function closeModal(){ $('trackModal')?.classList.remove('show'); }

  // ------------------------------------------------------------ preferences (which Train tabs, fuel display)

  async function loadPrefs(force){
    if(T.prefs && !force) return T.prefs;
    const fromMe = window.KESTREL?.me?.prefs;
    if(fromMe && !force && T.meta){ T.prefs = fromMe; return T.prefs; }
    const d = await getJson('/api/me/prefs');
    T.prefs = d.prefs; T.meta = { tabs:d.tabs, sports:d.sports, meals:d.meals };
    if(window.KESTREL?.me) window.KESTREL.me.prefs = d.prefs;
    return T.prefs;
  }
  async function savePrefs(patch){
    const d = await send('/api/me/prefs', patch, 'PUT');
    T.prefs = d.prefs; T.meta = { tabs:d.tabs, sports:d.sports, meals:d.meals };
    if(window.KESTREL?.me) window.KESTREL.me.prefs = d.prefs;
    return d;
  }

  const ALL_TABS = [['plan','Plan'],['log','Log'],['goals','Goals'],['xtrain','Cross-train'],['food','Fuel'],['library','Workouts'],['fitness','Fitness'],['kai','Coach']];
  // The tab keys to show, in order. Before prefs load (or for a guest) every tab shows.
  function visibleTabs(){
    const p = T.prefs || window.KESTREL?.me?.prefs;
    return p?.train_tabs?.length ? p.train_tabs : ALL_TABS.map(t=> t[0]);
  }

  function customizeTabs(){
    let order = visibleTabs().slice();
    const hidden = ()=> ALL_TABS.map(t=> t[0]).filter(k=> !order.includes(k));
    const label = (k)=> ALL_TABS.find(t=> t[0] === k)[1];
    const draw = (box)=>{
      box.innerHTML = `<p class="hint">Choose the Train tabs you use and put them in your order. Plan always stays.</p>
        <div class="tk-list">${order.map((k, i)=> `<div class="tk-row"><label class="check-row"><input type="checkbox" data-tab="${k}" checked ${k === 'plan' ? 'disabled' : ''}><span>${label(k)}</span></label>
          <span class="tk-move"><button type="button" class="ghost" data-up="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Move ${label(k)} up">↑</button><button type="button" class="ghost" data-down="${i}" ${i === order.length - 1 ? 'disabled' : ''} aria-label="Move ${label(k)} down">↓</button></span></div>`).join('')}
        ${hidden().map(k=> `<div class="tk-row off"><label class="check-row"><input type="checkbox" data-tab="${k}"><span>${label(k)}</span></label><span class="hint">Hidden</span></div>`).join('')}</div>
        <div class="cluster"><button type="button" id="tkSave">Save</button><button type="button" class="ghost" id="tkReset">Show all, default order</button></div>`;
      box.querySelectorAll('[data-tab]').forEach(c=> c.onchange = ()=>{ const k = c.dataset.tab; order = c.checked ? [...order, k] : order.filter(x=> x !== k); draw(box); });
      box.querySelectorAll('[data-up]').forEach(b=> b.onclick = ()=>{ const i = +b.dataset.up; [order[i-1], order[i]] = [order[i], order[i-1]]; draw(box); });
      box.querySelectorAll('[data-down]').forEach(b=> b.onclick = ()=>{ const i = +b.dataset.down; [order[i+1], order[i]] = [order[i], order[i+1]]; draw(box); });
      $('tkReset').onclick = ()=>{ order = ALL_TABS.map(t=> t[0]); draw(box); };
      $('tkSave').onclick = async (e)=>{
        e.target.disabled = true;
        try{ await savePrefs({ train_tabs: order }); closeModal(); window.kTrack.paintTabs(); renderTraining(); }
        catch(err){ alert(err.message); e.target.disabled = false; }
      };
    };
    modal('Customize Train', '', draw);
  }

  // Draws the Train tab bar from the runner's choice; returns the view to show.
  function paintTabs(){
    const bar = $('tpViews'); if(!bar) return;
    const tabs = visibleTabs();
    const view = typeof trainingView === 'string' ? trainingView : 'plan';
    bar.innerHTML = tabs.map(k=> `<button type="button" class="seg-btn ${k === view ? 'active' : ''}" role="tab" aria-selected="${k === view}" data-tview="${k}">${ALL_TABS.find(t=> t[0] === k)[1]}</button>`).join('')
      + `<button type="button" class="seg-btn tk-gear" id="tpCustomize" aria-label="Customize Train tabs" title="Customize Train tabs"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg></button>`;
    $('tpCustomize').onclick = customizeTabs;
    bar.querySelector('.seg-btn.active')?.scrollIntoView({ block:'nearest', inline:'nearest' });
  }

  // ------------------------------------------------------------ Goals

  const STATE = {
    on_track: ['On track', 'tone-int-1'], close: ['Close', 'tone-int-2'], building: ['Building', 'tone-int-3'],
    no_estimate: ['Needs data', ''], incomplete: ['Needs a target', ''],
  };
  const GOAL_TEMPLATES = [
    { label:'Sub-3 marathon', kind:'race', event:'marathon', t:'2:59:59' },
    { label:'Sub-1:30 half', kind:'race', event:'half', t:'1:29:59' },
    { label:'Sub-40 10K', kind:'race', event:'10K', t:'39:59' },
    { label:'Sub-20 5K', kind:'race', event:'5K', t:'19:59' },
    { label:'Sub-5 mile', kind:'race', event:'1600', t:'4:59' },
    { label:'30 miles a week', kind:'mileage', target:30 },
    { label:'Run 4 times a week', kind:'consistency', target:4 },
    { label:'Finish my first marathon', kind:'custom', title:'Finish my first marathon' },
  ];

  function bar(pct){ return `<div class="gl-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${Math.max(2, pct)}%"></i></div>`; }

  function weekStrip(g, unit){
    const top = Math.max(g.target || 1, ...g.weeks.map(w=> w.value), 1);
    return `<div class="gl-weeks" aria-label="Last 8 weeks">${g.weeks.map(w=> `<div class="gl-wk ${w.met ? 'met' : ''} ${w.current ? 'now' : ''}" title="Week of ${weekLabel(w.week)}: ${w.value} ${unit}"><i style="height:${Math.max(3, w.value / top * 64)}px"></i><span>${w.current ? 'Now' : weekLabel(w.week).split(' ')[1]}</span></div>`).join('')}
      <div class="gl-line" style="bottom:${(g.target / top) * 64 + 18}px" aria-hidden="true"></div></div>`;
  }

  function goalCard(g){
    const [stateText, tone] = g.achieved ? ['Achieved', 'tone-int-1'] : STATE[g.state] || ['', ''];
    const when = g.target_date ? (g.days_left > 0 ? `${g.days_left} days to go · ${new Date(g.target_date + 'T12:00:00').toLocaleDateString(undefined, { month:'short', day:'numeric', year:'numeric' })}` : g.days_left === 0 ? 'Today' : 'Date has passed') : '';
    let body = '';
    if(g.kind === 'race'){
      body += `<div class="stat-grid gl-stats">${tile(g.estimate || '–', 'you now')}${tile(g.target_time, 'goal')}${tile(g.gap || '–', 'gap')}${tile(g.goal_pace_mi, 'goal pace /mi')}</div>`;
      if(g.state === 'no_estimate') body += `<p class="hint">${esc(g.message)}${g.hint_estimate ? ` From your shorter races you'd be around <b>${esc(g.hint_estimate)}</b> if the training is there.` : ''}</p>`;
      else body += `${bar(g.pct || 0)}<div class="hint">${g.state === 'on_track' ? `Your estimate (${esc(g.range || g.estimate)}) is already under your goal. Now prove it on race day.` : `${g.pct || 0}% of the way from ${esc(g.start)} when you set this goal.`} ${g.pr ? `PR ${esc(g.pr)}.` : ''} Goal pace is ${esc(g.goal_pace_km)}/km.</div>`;
      if(g.trend?.length >= 2) body += `<div class="gl-sub">Your estimate, last ${g.trend.length} weeks</div>${sparkline(g.trend.map(p=> ({ v: -p.sec })))}`;
      if(g.equivalents?.length) body += `<div class="gl-sub">Checkpoint races that say you're on pace</div><div class="cluster">${g.equivalents.map(e=> `<span class="badge">${esc(e.label)} ${esc(e.time)}</span>`).join('')}</div>`;
      if(g.guide){
        const pct = Math.min(100, Math.round(g.mpw / g.guide.peak_mpw[0] * 100));
        body += `<div class="gl-sub">Training for it</div><div class="hint">${esc(g.guide.text)} You've averaged <b>${g.mpw} mi</b> a week the last 4 weeks.</div>${bar(pct)}`;
      }
    }
    if(g.kind === 'mileage'){
      body += `<div class="stat-grid gl-stats">${tile(g.current, 'mi/wk now')}${tile(g.target, 'goal')}${tile(g.pct + '%', 'there')}${tile(g.weeks.filter(w=> w.met).length + '/8', 'weeks hit')}</div>${weekStrip(g, 'mi')}
        <div class="hint">${g.current >= g.target ? 'You’re there. Hold it a few weeks before adding more.' : g.weeks_to_target ? `Building about 10% a week, with an easier week every third or fourth, gets you there in about ${g.weeks_to_target} weeks. Faster than that is when injuries happen.` : 'Log a few weeks of running and Kestrel shows how long the build takes.'}</div>`;
    }
    if(g.kind === 'consistency'){
      body += `<div class="stat-grid gl-stats">${tile(g.current, 'runs this week')}${tile(g.target, 'goal')}${tile(g.streak, g.streak === 1 ? 'week streak' : 'week streak')}${tile(`${g.hit}/${g.of}`, 'weeks hit')}</div>${weekStrip(g, 'runs')}`;
    }
    if(g.kind === 'custom'){
      body += `${bar(g.pct)}<div class="cluster gl-custom"><input type="range" min="0" max="100" step="5" value="${g.pct}" data-progress="${g.id}" aria-label="Progress"><b>${g.pct}%</b></div>`;
    }
    return `<section class="card gl-card ${g.priority ? 'main' : ''}" data-goal="${g.id}">
      <div class="section-head"><div>
        <div class="eyebrow">${g.priority ? 'Main goal' : { race:'Race goal', mileage:'Weekly miles', consistency:'Consistency', custom:'Goal' }[g.kind]}${when ? ` · ${esc(when)}` : ''}</div>
        <div class="card-title">${esc(g.title)}</div>
        ${g.why ? `<div class="hint">Why: ${esc(g.why)}</div>` : ''}
      </div>${stateText ? `<span class="badge ${tone}">${stateText}</span>` : ''}</div>
      ${body}
      <div class="cluster gl-actions">
        <button type="button" class="ghost sm-btn" data-edit="${g.id}">Edit</button>
        ${g.status === 'active' ? `<button type="button" class="ghost sm-btn" data-done="${g.id}">Mark done</button>` : `<button type="button" class="ghost sm-btn" data-reopen="${g.id}">Make active</button>`}
        ${g.status === 'active' && !g.priority ? `<button type="button" class="ghost sm-btn" data-main="${g.id}">Make main goal</button>` : ''}
        ${g.status === 'active' ? `<button type="button" class="ghost sm-btn" data-ask="${g.id}">Ask Kestrel AI</button>` : ''}
      </div>
    </section>`;
  }

  async function renderGoals(el){
    el.innerHTML = '<section class="card"><div class="hint">Loading your goals…</div></section>';
    let d;
    try{ d = await getJson('/api/goals'); }catch(err){ return fail(el, err); }
    T.goals = d;
    const active = d.goals.filter(g=> g.status === 'active');
    const past = d.goals.filter(g=> g.status !== 'active');
    el.innerHTML = `<div class="stack-cards">
        <section class="card gl-head"><div class="section-head"><div><div class="card-title">${active.length ? 'Your goals' : 'Set a goal'}</div>
          <div class="hint">${active.length ? 'Progress updates on its own from your runs, PRs and Fitness States.' : 'A race time, a weekly mileage, a habit, or anything else. Kestrel tracks the progress from your training.'}</div></div>
          <button type="button" id="glAdd">+ Goal</button></div>
          ${active.length ? '' : `<div class="chip-scroll">${GOAL_TEMPLATES.map((t, i)=> `<button type="button" class="chip" data-tpl="${i}">${esc(t.label)}</button>`).join('')}</div>`}
        </section>
        ${active.map(goalCard).join('')}
        ${past.length ? `<details class="card gl-past"><summary class="card-title">Done and archived (${past.length})</summary>${past.map(goalCard).join('')}</details>` : ''}
      </div>`;
    drawSparks();
    $('glAdd').onclick = ()=> editGoal(null);
    el.querySelectorAll('[data-tpl]').forEach(b=> b.onclick = ()=> editGoal(null, GOAL_TEMPLATES[+b.dataset.tpl]));
    const find = (id)=> d.goals.find(g=> g.id === id);
    const update = async (g, patch)=>{ try{ await send('/api/goals', { ...goalBody(g), ...patch }); renderGoals(el); }catch(err){ alert(err.message); } };
    el.querySelectorAll('[data-edit]').forEach(b=> b.onclick = ()=> editGoal(find(b.dataset.edit)));
    el.querySelectorAll('[data-done]').forEach(b=> b.onclick = ()=> update(find(b.dataset.done), { status:'done' }));
    el.querySelectorAll('[data-reopen]').forEach(b=> b.onclick = ()=> update(find(b.dataset.reopen), { status:'active' }));
    el.querySelectorAll('[data-main]').forEach(b=> b.onclick = ()=> update(find(b.dataset.main), { priority:true }));
    el.querySelectorAll('[data-ask]').forEach(b=> b.onclick = ()=>{
      const g = find(b.dataset.ask);
      const extra = g.kind === 'race' ? ` My estimate now is ${g.estimate || 'unknown'}; the goal pace is ${g.goal_pace_mi}/mi.` : '';
      openKai(`My goal is "${g.title}"${g.target_date ? ` by ${g.target_date}` : ''}.${extra} Am I on track, and what should my training focus on next?`);
    });
    el.querySelectorAll('[data-progress]').forEach(r=>{
      r.oninput = ()=>{ r.nextElementSibling.textContent = r.value + '%'; };
      r.onchange = ()=> update(find(r.dataset.progress), { progress: Number(r.value) });
    });
  }

  function goalBody(g){
    return { id:g.id, kind:g.kind, title:g.title, event:g.event, target:g.target, target_time:g.target_time, target_date:g.target_date, why:g.why, priority:!!g.priority, status:g.status, progress:g.pct };
  }

  function editGoal(g, tpl){
    const x = g ? { ...g } : { kind: tpl?.kind || 'race', event: tpl?.event || '', target_time: tpl?.t || '', target: tpl?.target || '', title: tpl?.title || '', why:'', target_date:'' };
    const events = T.goals?.events || [];
    const draw = (box)=>{
      const k = x.kind;
      box.innerHTML = `<div class="seg" role="tablist">${[['race','Race time'],['mileage','Weekly miles'],['consistency','Runs a week'],['custom','Other']].map(([v, l])=> `<button type="button" class="seg-btn ${k === v ? 'active' : ''}" data-kind="${v}">${l}</button>`).join('')}</div>
        <form id="glForm" class="stack">
          ${k === 'race' ? `<div class="field-grid">
              <label class="field"><span>Distance</span><select name="event" required><option value="">Choose</option>${events.map(e=> `<option value="${e.key}" ${x.event === e.key ? 'selected' : ''}>${esc(e.label)}</option>`).join('')}</select></label>
              <label class="field"><span>Goal time</span><input name="target_time" value="${esc(x.target_time || '')}" placeholder="e.g. 2:59:59" inputmode="numeric" required></label>
            </div><p class="hint" id="glPace"></p>` : ''}
          ${k === 'mileage' ? `<label class="field"><span>Miles a week</span><input name="target" type="number" min="1" max="200" value="${esc(x.target || '')}" required></label>` : ''}
          ${k === 'consistency' ? `<label class="field"><span>Runs a week</span><input name="target" type="number" min="1" max="14" value="${esc(x.target || '')}" required></label>` : ''}
          <label class="field"><span>${k === 'custom' ? 'Your goal' : 'Name (optional)'}</span><input name="title" maxlength="80" value="${esc(x.title || '')}" placeholder="${k === 'custom' ? 'e.g. Finish my first marathon' : 'Kestrel names it for you'}" ${k === 'custom' ? 'required' : ''}></label>
          <label class="field"><span>${k === 'race' ? 'Race date' : 'By when (optional)'}</span><input name="target_date" type="date" value="${esc(x.target_date || '')}"></label>
          <label class="field"><span>Why it matters to you (optional)</span><textarea name="why" rows="2" maxlength="300" placeholder="e.g. Qualify for Boston with my dad">${esc(x.why || '')}</textarea></label>
          <label class="check-row"><input type="checkbox" name="priority" ${x.priority || (!g && !(T.goals?.goals || []).some(z=> z.status === 'active')) ? 'checked' : ''}><span>This is my main goal</span></label>
          <div class="cluster"><button type="submit">${g ? 'Save' : 'Add goal'}</button>${g ? '<button type="button" class="ghost" id="glDelete">Delete</button>' : ''}</div>
        </form>`;
      box.querySelectorAll('[data-kind]').forEach(b=> b.onclick = ()=>{ Object.assign(x, Object.fromEntries(new FormData($('glForm')))); x.kind = b.dataset.kind; draw(box); });
      const pace = ()=>{
        const p = $('glPace'); if(!p) return;
        const f = Object.fromEntries(new FormData($('glForm')));
        const m = { '800':800, '1600':1609.344, '3200':3218.688, '5K':5000, '10K':10000, half:21097.5, marathon:42195 }[f.event];
        const parts = String(f.target_time || '').split(':').map(Number);
        const sec = parts.every(n=> Number.isFinite(n)) ? parts.reduce((a, n)=> a * 60 + n, 0) : 0;
        if(!m || !(sec > 0)){ p.textContent = ''; return; }
        const fmt = (s)=>{ s = Math.round(s); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
        p.textContent = `That's ${fmt(sec / (m / 1609.344))}/mi (${fmt(sec / (m / 1000))}/km) the whole way.`;
      };
      box.querySelectorAll('[name=event],[name=target_time]').forEach(i=> i.oninput = pace); pace();
      $('glForm').onsubmit = async (e)=>{
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.target));
        const btn = e.submitter || e.target.querySelector('[type=submit]'); btn.disabled = true;
        try{
          await send('/api/goals', { id:g?.id, kind:x.kind, status:g?.status || 'active', progress:g?.pct, ...f, priority: !!f.priority });
          closeModal(); renderGoals($('tpGoalsView'));
        }catch(err){ alert(err.message); btn.disabled = false; }
      };
      if($('glDelete')) $('glDelete').onclick = async ()=>{
        if(!confirm('Delete this goal?')) return;
        await send('/api/goals/delete', { id:g.id }).catch(err=> alert(err.message));
        closeModal(); renderGoals($('tpGoalsView'));
      };
    };
    modal(g ? 'Edit goal' : 'New goal', '', draw);
  }

  // ------------------------------------------------------------ Cross-training

  const RPE = ['', 'Very easy', 'Easy', 'Easy', 'Moderate', 'Moderate', 'Somewhat hard', 'Hard', 'Very hard', 'Very, very hard', 'All out'];

  async function renderXtrain(el){
    el.innerHTML = '<section class="card"><div class="hint">Loading cross-training…</div></section>';
    let d;
    try{ [d] = await Promise.all([getJson('/api/xtrain'), loadPrefs()]); }catch(err){ return fail(el, err); }
    T.xt = d;
    const w = d.this_week;
    const top = Math.max(1, ...d.weeks.map(x=> x.run_min + x.xt_min));
    // The activities the runner said they do at setup come first.
    const mine = window.KESTREL?.me?.profile?.xtrain || [];
    const sports = [...d.sports].sort((a, b)=> (mine.includes(b.key) ? 1 : 0) - (mine.includes(a.key) ? 1 : 0));
    if(!T.xtSport || !sports.some(s=> s.key === T.xtSport)) T.xtSport = sports[0].key;
    const byDate = {};
    d.entries.forEach(e=> (byDate[e.date] ||= []).push(e));
    el.innerHTML = `<div class="split split-fit">
      <div class="stack-cards">
        <section class="card">
          <div class="card-title">This week</div>
          <div class="stat-grid" style="margin-top:var(--sp-3);">${tile(mins(w.xt_min), 'cross-training')}${tile(w.sessions, w.sessions === 1 ? 'session' : 'sessions')}${tile(w.load || '–', 'load (min × RPE)')}${tile(d.share_pct + '%', 'of training time')}</div>
          <div class="xt-bars" aria-label="Running and cross-training minutes, last 8 weeks">${d.weeks.map(x=> `<div class="xt-wk" title="Week of ${weekLabel(x.week)}: ${x.run_min} min running, ${x.xt_min} min cross-training"><div class="xt-stack"><i class="xt" style="height:${x.xt_min / top * 90}px"></i><i class="run" style="height:${x.run_min / top * 90}px"></i></div><span>${weekLabel(x.week).split(' ')[1]}</span></div>`).join('')}</div>
          <div class="legend"><span><i style="background:var(--gold)"></i>Running</span><span><i style="background:var(--int-2)"></i>Cross-training</span></div>
          <div class="hint" style="margin-top:var(--sp-2);">You average ${mins(d.avg_min)} of cross-training a week over the last 7 weeks.</div>
        </section>
        <section class="card">
          <div class="section-head"><div><div class="card-title">Log cross-training</div><div class="hint">Bike, swim, lift, pool run… Rides and swims from your watch show up below on their own.</div></div></div>
          <form id="xtForm" class="stack">
            <div class="chip-scroll" role="radiogroup" aria-label="Activity">${sports.map(s=> `<button type="button" class="chip ${s.key === T.xtSport ? 'on' : ''}" data-sport="${esc(s.key)}" role="radio" aria-checked="${s.key === T.xtSport}">${esc(s.label)}</button>`).join('')}<button type="button" class="chip" id="xtCustom">+ Your own</button></div>
            <div class="field-grid">
              <label class="field"><span>Date</span><input type="date" name="date" value="${todayIso()}" max="${todayIso()}" required></label>
              <label class="field"><span>Minutes</span><input type="number" name="minutes" min="1" max="900" inputmode="numeric" placeholder="45" required></label>
              <label class="field"><span>Distance (mi, optional)</span><input type="number" name="distance_mi" min="0" max="500" step="0.1" inputmode="decimal"></label>
              <label class="field"><span>How hard? <b id="xtRpeText">5 · Moderate</b></span><input type="range" name="rpe" min="1" max="10" value="5"></label>
              <label class="field full"><span>Notes (optional)</span><input name="notes" maxlength="300" placeholder="e.g. 6 x 3 min hard, easy spin between"></label>
            </div>
            <div class="cluster"><button type="submit">Save session</button><span class="hint" id="xtMsg"></span></div>
          </form>
        </section>
        <section class="card">
          <div class="card-title" style="margin-bottom:var(--sp-3);">Recent sessions</div>
          ${d.entries.length ? Object.keys(byDate).map(date=> `<div class="xt-day"><div class="eyebrow">${esc(dayLabel(date))}</div>${byDate[date].map(e=> `<div class="xt-row">
              <span class="xt-what"><b>${esc(e.label)}</b>${e.name ? ` <span class="hint">${esc(e.name)}</span>` : ''}${e.notes ? `<span class="hint">${esc(e.notes)}</span>` : ''}</span>
              <span class="xt-num">${mins(e.minutes)}${e.distance_mi ? ` · ${e.distance_mi} mi` : ''}${e.rpe ? ` · RPE ${e.rpe}` : e.avg_hr ? ` · ${e.avg_hr} bpm` : ''}</span>
              ${e.source === 'watch' ? '<span class="badge">Watch</span>' : `<button type="button" class="ghost sm-btn" data-xdel="${esc(e.id)}" aria-label="Delete ${esc(e.label)} on ${esc(dayLabel(date))}">Delete</button>`}
            </div>`).join('')}</div>`).join('') : '<div class="hint">Nothing in the last 8 weeks yet.</div>'}
        </section>
      </div>
      <div class="split-side">
        <section class="card">
          <div class="card-title">Making it count</div>
          <ul class="tk-tips">
            <li><b>Easy days:</b> an easy ride, swim or elliptical session builds your aerobic engine with less pounding than another run.</li>
            <li><b>Hurt?</b> Pool running and cycling keep most of your fitness while you heal. Match the effort of the run you'd have done.</li>
            <li><b>Strength:</b> two short sessions a week (legs, hips, core) are linked to fewer running injuries.</li>
            <li><b>Effort (RPE)</b> lets Kestrel count any sport in your load: minutes × how hard it felt, 1 to 10.</li>
          </ul>
        </section>
      </div>
    </div>`;
    const form = $('xtForm');
    const rpe = form.elements.rpe;
    rpe.oninput = ()=>{ $('xtRpeText').textContent = `${rpe.value} · ${RPE[rpe.value]}`; };
    el.querySelectorAll('[data-sport]').forEach(b=> b.onclick = ()=>{ T.xtSport = b.dataset.sport; el.querySelectorAll('[data-sport]').forEach(c=>{ const on = c === b; c.classList.toggle('on', on); c.setAttribute('aria-checked', String(on)); }); });
    $('xtCustom').onclick = ()=> editSports(el);
    form.onsubmit = async (e)=>{
      e.preventDefault();
      const f = Object.fromEntries(new FormData(form));
      const btn = e.submitter || form.querySelector('[type=submit]'); btn.disabled = true;
      try{ await send('/api/xtrain', { ...f, sport:T.xtSport }); renderXtrain(el); }
      catch(err){ $('xtMsg').textContent = err.message; btn.disabled = false; }
    };
    el.querySelectorAll('[data-xdel]').forEach(b=> b.onclick = async ()=>{
      if(!confirm('Delete this session?')) return;
      await send('/api/xtrain/delete', { id:b.dataset.xdel }).catch(err=> alert(err.message));
      renderXtrain(el);
    });
  }

  function editSports(el){
    let list = (T.prefs?.xt_sports || []).slice();
    const draw = (box)=>{
      box.innerHTML = `<p class="hint">Add the activities you do that aren't on the list, like climbing, dance or a spin class.</p>
        <div class="cluster">${list.map((s, i)=> `<span class="badge">${esc(s)} <button type="button" class="tk-x" data-rm="${i}" aria-label="Remove ${esc(s)}">✕</button></span>`).join('') || '<span class="hint">None yet.</span>'}</div>
        <form id="spForm" class="cluster"><input name="s" maxlength="30" placeholder="e.g. Climbing" aria-label="New activity" style="flex:1;min-width:0;"><button type="submit">Add</button></form>
        <button type="button" id="spSave">Save</button>`;
      box.querySelectorAll('[data-rm]').forEach(b=> b.onclick = ()=>{ list.splice(+b.dataset.rm, 1); draw(box); });
      $('spForm').onsubmit = (e)=>{ e.preventDefault(); const v = e.target.elements.s.value.trim(); if(v && !list.includes(v) && list.length < 12) list.push(v); draw(box); box.querySelector('[name=s]').focus(); };
      $('spSave').onclick = async ()=>{ try{ await savePrefs({ xt_sports:list }); closeModal(); renderXtrain(el); }catch(err){ alert(err.message); } };
    };
    modal('Your activities', '', draw);
  }

  // ------------------------------------------------------------ Fuel

  // Common runner foods, approximate grams per serving (USDA FoodData Central values, rounded).
  const QUICK = [
    { name:'Banana', meal:'snack', carbs_g:27, protein_g:1, fat_g:0, kcal:105 },
    { name:'Oatmeal (1 cup cooked)', meal:'breakfast', carbs_g:28, protein_g:6, fat_g:4, kcal:165 },
    { name:'Bagel', meal:'breakfast', carbs_g:48, protein_g:10, fat_g:2, kcal:250 },
    { name:'2 eggs', meal:'breakfast', carbs_g:1, protein_g:12, fat_g:10, kcal:145 },
    { name:'Greek yogurt (170 g)', meal:'snack', carbs_g:6, protein_g:17, fat_g:0, kcal:100 },
    { name:'PB & J sandwich', meal:'lunch', carbs_g:45, protein_g:13, fat_g:16, kcal:380 },
    { name:'Pasta (1 cup cooked)', meal:'dinner', carbs_g:43, protein_g:8, fat_g:1, kcal:220 },
    { name:'Rice (1 cup cooked)', meal:'dinner', carbs_g:45, protein_g:4, fat_g:0, kcal:205 },
    { name:'Chicken breast (4 oz)', meal:'dinner', carbs_g:0, protein_g:35, fat_g:4, kcal:185 },
    { name:'Chocolate milk (1 cup)', meal:'after', carbs_g:26, protein_g:8, fat_g:5, kcal:190, fluid_ml:240 },
    { name:'Energy gel', meal:'during', carbs_g:22, protein_g:0, fat_g:0, kcal:90 },
    { name:'Sports drink (500 ml)', meal:'during', carbs_g:30, protein_g:0, fat_g:0, kcal:120, fluid_ml:500 },
    { name:'Water (500 ml)', meal:'snack', fluid_ml:500 },
  ];

  function rangeBar(have, [lo, hi], unit){
    const max = hi * 1.15;
    const st = have >= lo && have <= hi ? 'in' : have > hi ? 'over' : 'under';
    return `<div class="fu-bar ${st}"><div class="fu-band" style="left:${lo / max * 100}%;width:${(hi - lo) / max * 100}%"></div><i style="width:${Math.min(100, have / max * 100)}%"></i></div>
      <div class="fu-legend"><span>${Math.round(have)} ${unit}</span><span>target ${lo}-${hi} ${unit}</span></div>`;
  }

  async function renderFood(el){
    if(!T.foodDate) T.foodDate = todayIso();
    el.innerHTML = '<section class="card"><div class="hint">Loading…</div></section>';
    let d;
    try{
      [d] = await Promise.all([getJson(`/api/food?date=${T.foodDate}${T.foodTier ? '&tier=' + T.foodTier : ''}`), loadPrefs()]);
      if(!T.recent) T.recent = (await getJson('/api/food/recent')).foods;
    }catch(err){ return fail(el, err); }
    const P = d.prefs;
    const meals = d.meals;
    const byMeal = {};
    d.entries.forEach(e=> (byMeal[e.meal] ||= []).push(e));
    const quick = [...T.recent.filter(r=> !QUICK.some(q=> q.name.toLowerCase() === r.name.toLowerCase())), ...QUICK].slice(0, 16);
    const macro = (e)=> [e.carbs_g != null ? `${e.carbs_g}g carbs` : '', e.protein_g != null ? `${e.protein_g}g protein` : '', P.show_fat && e.fat_g != null ? `${e.fat_g}g fat` : '', P.show_kcal && e.kcal != null ? `${Math.round(e.kcal)} kcal` : '', P.show_fluid && e.fluid_ml ? `${e.fluid_ml} ml` : ''].filter(Boolean).join(' · ');
    el.innerHTML = `<div class="split split-fit">
      <div class="stack-cards">
        <section class="card">
          <div class="month-nav"><button class="navbtn" type="button" id="fuPrev" aria-label="Previous day">‹</button><div class="label">${esc(dayLabel(d.date))}</div><button class="navbtn" type="button" id="fuNext" aria-label="Next day" ${d.date >= todayIso() ? 'disabled' : ''}>›</button></div>
          <div class="eyebrow" style="margin-top:var(--sp-3);">What kind of day</div>
          <div class="chip-scroll" style="margin-top:var(--sp-2);">${d.tiers.map(t=> `<button type="button" class="chip ${t.key === d.tier.key ? 'on' : ''}" data-tier="${t.key}">${esc(t.label)}${t.key === d.tier.auto_key ? ' ✓' : ''}</button>`).join('')}</div>
          <div class="hint" style="margin-top:var(--sp-2);">${esc(d.tier.note)} ${d.training.minutes ? `You've logged ${mins(d.training.minutes)} of training${d.training.run_mi ? ` (${d.training.run_mi} mi running)` : ''} today, so ✓ marks the day type that matches.` : 'Nothing logged yet today; pick the day you have planned.'}</div>
          ${d.targets ? `<div class="fu-macros">
              <div><div class="fu-name">Carbohydrate <span class="hint">${d.bands.carbs[0]}-${d.bands.carbs[1]} g/kg${d.bands.custom_carbs ? ' (yours)' : ''}</span></div>${rangeBar(d.totals.carbs_g, d.targets.carbs_g, 'g')}</div>
              <div><div class="fu-name">Protein <span class="hint">${d.bands.protein[0]}-${d.bands.protein[1]} g/kg${d.bands.custom_protein ? ' (yours)' : ''}</span></div>${rangeBar(d.totals.protein_g, d.targets.protein_g, 'g')}</div>
            </div>` : `<div class="fu-noweight"><b>Add your weight to get gram targets.</b> <span class="hint">Fuel needs scale with body size. Only you see it.</span> <button type="button" class="ghost sm-btn" id="fuWeight">Add weight</button></div>`}
          <div class="stat-grid" style="margin-top:var(--sp-3);">${tile(Math.round(d.totals.carbs_g) + 'g', 'carbs')}${tile(Math.round(d.totals.protein_g) + 'g', 'protein')}${P.show_fluid ? tile(d.totals.fluid_ml ? (d.totals.fluid_ml / 1000).toFixed(1) + ' L' : '–', 'fluid') : ''}${P.show_kcal ? tile(d.totals.kcal || '–', 'kcal') : P.show_fat ? tile(Math.round(d.totals.fat_g) + 'g', 'fat') : tile(d.totals.entries, d.totals.entries === 1 ? 'entry' : 'entries')}</div>
        </section>
        ${d.flag ? `<section class="card fu-flag" role="note"><div class="card-title">A note about fueling</div><p>${esc(d.flag)}</p></section>` : ''}
        <section class="card">
          <div class="section-head"><div><div class="card-title">Add food or drink</div><div class="hint">Tap a food to add it, or type your own. Numbers are approximate; close is good enough.</div></div></div>
          <form id="fuForm" class="stack">
            <div class="chip-scroll" role="radiogroup" aria-label="Meal">${meals.map(m=> `<button type="button" class="chip" data-meal="${m.key}" role="radio">${esc(m.label)}</button>`).join('')}</div>
            <div class="chip-scroll">${quick.map((q, i)=> `<button type="button" class="chip ghosty" data-quick="${i}">+ ${esc(q.name)}</button>`).join('')}</div>
            <div class="field-grid">
              <label class="field full"><span>What</span><input name="name" maxlength="80" placeholder="e.g. Turkey sandwich and an apple"></label>
              <label class="field"><span>Carbs (g)</span><input name="carbs_g" type="number" min="0" max="1500" inputmode="decimal"></label>
              <label class="field"><span>Protein (g)</span><input name="protein_g" type="number" min="0" max="500" inputmode="decimal"></label>
              ${P.show_fat ? '<label class="field"><span>Fat (g)</span><input name="fat_g" type="number" min="0" max="500" inputmode="decimal"></label>' : ''}
              ${P.show_kcal ? '<label class="field"><span>Calories</span><input name="kcal" type="number" min="0" max="10000" inputmode="numeric"></label>' : ''}
              ${P.show_fluid ? '<label class="field"><span>Fluid (ml)</span><input name="fluid_ml" type="number" min="0" max="10000" inputmode="numeric"></label>' : ''}
            </div>
            <div class="cluster"><button type="submit">Add</button><span class="hint" id="fuMsg"></span></div>
          </form>
        </section>
        <section class="card">
          <div class="card-title" style="margin-bottom:var(--sp-2);">${esc(dayLabel(d.date))}</div>
          ${d.entries.length ? meals.filter(m=> byMeal[m.key]).map(m=> `<div class="xt-day"><div class="eyebrow">${esc(m.label)}</div>${byMeal[m.key].map(e=> `<div class="xt-row"><span class="xt-what"><b>${esc(e.name || 'Food')}</b><span class="hint">${esc(macro(e))}</span></span><button type="button" class="ghost sm-btn" data-fdel="${esc(e.id)}" aria-label="Remove ${esc(e.name || 'food')}">Remove</button></div>`).join('')}</div>`).join('') : '<div class="hint">Nothing logged for this day yet.</div>'}
        </section>
      </div>
      <div class="split-side">
        <section class="card">
          <div class="card-title">Fueling your running</div>
          <ul class="tk-tips">${d.run_fuel.map(t=> `<li><b>${{ before:'Before', during:'During', after:'After' }[t.when]}:</b> ${esc(t.text.replace(/^[^:]+:\s*/, ''))}</li>`).join('')}</ul>
          <div class="hint">From the sports nutrition position stand (Academy of Nutrition and Dietetics, Dietitians of Canada and ACSM). Kestrel tracks fuel for training, not dieting.</div>
        </section>
        <section class="card">
          <div class="section-head"><div><div class="card-title">Your Fuel settings</div><div class="hint">Show only what you want to track.</div></div></div>
          <div class="stack">
            <label class="check-row"><input type="checkbox" data-fpref="show_fluid" ${P.show_fluid ? 'checked' : ''}><span>Fluid</span></label>
            <label class="check-row"><input type="checkbox" data-fpref="show_fat" ${P.show_fat ? 'checked' : ''}><span>Fat</span></label>
            <label class="check-row"><input type="checkbox" data-fpref="show_kcal" ${P.show_kcal ? 'checked' : ''}><span>Calories</span></label>
            <button type="button" class="ghost sm-btn" id="fuTargets">Change my targets</button>
          </div>
        </section>
      </div>
    </div>`;
    let meal = T.foodMeal || guessMeal();
    const paintMeal = ()=> el.querySelectorAll('[data-meal]').forEach(b=>{ const on = b.dataset.meal === meal; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
    paintMeal();
    el.querySelectorAll('[data-meal]').forEach(b=> b.onclick = ()=>{ meal = T.foodMeal = b.dataset.meal; paintMeal(); });
    $('fuPrev').onclick = ()=>{ T.foodDate = shiftIso(d.date, -1); T.foodTier = ''; renderFood(el); };
    $('fuNext').onclick = ()=>{ T.foodDate = shiftIso(d.date, 1); T.foodTier = ''; renderFood(el); };
    el.querySelectorAll('[data-tier]').forEach(b=> b.onclick = ()=>{ T.foodTier = b.dataset.tier === d.tier.auto_key ? '' : b.dataset.tier; renderFood(el); });
    if($('fuWeight')) $('fuWeight').onclick = ()=> window.kestrelEditRunner?.(1);
    const add = async (body)=>{
      try{ await send('/api/food', { date:d.date, meal, ...body }); T.recent = null; renderFood(el); }
      catch(err){ $('fuMsg').textContent = err.message; }
    };
    el.querySelectorAll('[data-quick]').forEach(b=> b.onclick = ()=>{ const { meal:m, ...q } = quick[+b.dataset.quick]; add(q); });
    $('fuForm').onsubmit = (e)=>{ e.preventDefault(); add(Object.fromEntries(new FormData(e.target))); };
    el.querySelectorAll('[data-fdel]').forEach(b=> b.onclick = async ()=>{ await send('/api/food/delete', { id:b.dataset.fdel }).catch(()=>{}); renderFood(el); });
    el.querySelectorAll('[data-fpref]').forEach(c=> c.onchange = async ()=>{ await savePrefs({ food:{ [c.dataset.fpref]: c.checked } }).catch(err=> alert(err.message)); renderFood(el); });
    $('fuTargets').onclick = ()=> editTargets(el, d);
  }

  // Breakfast before 10:30, lunch to 2:30, dinner after 5, snack between.
  function guessMeal(){ const h = new Date().getHours() + new Date().getMinutes() / 60; return h < 10.5 ? 'breakfast' : h < 14.5 ? 'lunch' : h < 17 ? 'snack' : 'dinner'; }

  function editTargets(el, d){
    const c = d.bands.custom_carbs ? d.bands.carbs : ['', ''];
    const p = d.bands.custom_protein ? d.bands.protein : ['', ''];
    modal('Your fuel targets', `<p class="hint">By default Kestrel sets carbohydrate by how big your training day is (3-12 g per kg of body weight) and protein at 1.2-2.0 g/kg. If a dietitian gave you different numbers, put them here. Leave blank to use Kestrel's.</p>
      <form id="tgForm" class="stack">
        <div class="field-grid">
          <label class="field"><span>Carbs from (g/kg)</span><input name="c0" type="number" step="0.5" min="3" max="14" value="${c[0]}"></label>
          <label class="field"><span>Carbs to (g/kg)</span><input name="c1" type="number" step="0.5" min="3" max="14" value="${c[1]}"></label>
          <label class="field"><span>Protein from (g/kg)</span><input name="p0" type="number" step="0.1" min="0.8" max="2.5" value="${p[0]}"></label>
          <label class="field"><span>Protein to (g/kg)</span><input name="p1" type="number" step="0.1" min="0.8" max="2.5" value="${p[1]}"></label>
        </div>
        <div class="cluster"><button type="submit">Save</button><button type="button" class="ghost" id="tgReset">Use Kestrel's</button></div>
      </form>`, ()=>{
      const save = async (food)=>{ try{ await savePrefs({ food }); closeModal(); renderFood(el); }catch(err){ alert(err.message); } };
      $('tgForm').onsubmit = (e)=>{
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.target));
        save({ carbs: f.c0 && f.c1 ? [Number(f.c0), Number(f.c1)] : null, protein: f.p0 && f.p1 ? [Number(f.p0), Number(f.p1)] : null });
      };
      $('tgReset').onclick = ()=> save({ carbs:null, protein:null });
    });
  }

  // You > Profile: what the runner told Kestrel at setup, with a way back into it.
  function runnerCard(el){
    if(!el) return;
    const me = window.KESTREL?.me;
    if(!me || !isRealPerson()){ el.style.display = 'none'; return; }
    const p = me.profile || {};
    const L = {
      experience:{ new:'Just starting', under1:'Under a year', '1to3':'1 to 3 years', '3plus':'More than 3 years' },
      goal:{ race:'Run a specific race', faster:'Get faster', distance:'Build up distance', fitness:'Stay fit and healthy', comeback:'Come back from injury or a break', weight:'Get healthier', team:'Train with my team' },
      day:{ mon:'Monday', tue:'Tuesday', wed:'Wednesday', thu:'Thursday', fri:'Friday', sat:'Saturday', sun:'Sunday' },
      watch:{ garmin:'Garmin', coros:'COROS', apple:'Apple Watch', suunto:'Suunto', polar:'Polar', wahoo:'Wahoo', strava:'Strava only', other:'Something else', none:'Nothing yet' },
      tone:{ encouraging:'Encouraging', direct:'Straight to the point', detailed:'The details and the why' },
    };
    const rows = [
      ['Goal', [p.goal_event && p.goal_time ? `${p.goal_event} in ${p.goal_time}` : L.goal[p.goal], p.goal_race_name, p.goal_date].filter(Boolean).join(' · ')],
      ['Why', p.why], ['Bigger goal', p.long_goal], ['What gets in the way', p.blockers],
      ['Running', [L.experience[p.experience], p.weekly_miles != null ? `${p.weekly_miles} mi a week at setup` : '', p.days_per_week ? `${p.days_per_week} days a week` : ''].filter(Boolean).join(' · ')],
      ['Week', [p.long_run_day ? `Long run ${L.day[p.long_run_day]}` : '', p.rest_day ? `never ${L.day[p.rest_day]}` : ''].filter(Boolean).join(' · ')],
      ['Watch', L.watch[p.watch]], ['Injuries', p.injuries], ['Coaching style', L.tone[p.coach_tone]],
    ].filter(r=> r[1]);
    el.style.display = '';
    el.innerHTML = `<div class="section-head"><div><div class="card-title">Runner profile</div><div class="hint">What your coach knows about you: goals, your week, injuries, fueling and how you like to be coached.</div></div></div>
      ${rows.length ? `<dl class="rp-list">${rows.map(([k, v])=> `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : '<p class="hint">Not filled in yet.</p>'}
      <div class="cluster"><button type="button" id="rpEdit">Edit runner profile</button><button type="button" class="ghost" id="rpTabs">Customize Train tabs</button></div>`;
    $('rpEdit').onclick = ()=> window.kestrelEditRunner?.(0);
    $('rpTabs').onclick = customizeTabs;
  }

  window.kTrack = {
    runnerCard,
    paintTabs, visibleTabs, loadPrefs, customizeTabs,
    goals: renderGoals, xtrain: renderXtrain, food: renderFood,
    reset(){ Object.assign(T, { prefs:null, meta:null, foodDate:null, foodTier:'', recent:null, goals:null, xt:null }); },
  };
})();
