// The redesigned screens, part two: Calendar (your training and the team's), a run's own page and its editor,
// Body (recovery, cross-training, fuel) and Team. Shares views.js's helpers through window.KV.
(function(){
  const SCREENS = window.KV.screens, ACT = window.KV.act, V = window.KV.state;
  const { esc, sec, card, tiles, need, toast, getJson, post, logRange, intensity, runTitle, paceOf, saveDayFields, iso, nice, clock, secs, push, redraw, ICON, feelCard, eventCard, spark, latestPost } = window.KV._h;
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
  SCREENS.log = async ()=>{
    if(!own()) return need('Pick your name to see your training.');
    const today = todayKey();
    if(!V.month){ const d = new Date((V.sel || today) + 'T12:00:00'); V.month = [d.getFullYear(), d.getMonth()]; }
    if(!V.sel) V.sel = today;
    const [y, m] = V.month, first = iso(new Date(y, m, 1)), last = iso(new Date(y, m + 1, 0));
    const [lg, h] = await Promise.all([logRange(first, last), loadKai()]);
    const byDate = {}; (lg?.days || []).forEach(d=> byDate[d.date] = d);
    const plan = {}; (h?.week?.days || []).forEach(d=> { if(d.date >= today) plan[d.date] = d; });
    const done = (lg?.days || []).filter(d=> d.miles > 0);
    const tot = done.reduce((a, d)=> a + d.miles, 0);
    V.cache.monthTitle = `${Math.round(tot)} miles in ${MONTHS[m]}`;
    setSub(`${done.length} runs · longest ${done.reduce((a, d)=> Math.max(a, d.miles), 0)} mi · hard days ${done.filter(d=> d.difficulty >= 6).length}`);
    const cell = (d)=>{ const x = byDate[d], p = plan[d], day = +d.slice(8);
      const cls = x?.miles ? intensity(x.difficulty) : p && p.type !== 'Off' ? 'plan' : 'rest';
      return `<button type="button" class="kv-cday ${cls} ${d === V.sel ? 'sel' : ''} ${d === today ? 'now' : ''}" data-a="logSel" data-v="${d}"><b>${day}</b><span>${x?.miles ? x.miles : p && p.type !== 'Off' ? p.miles : ''}</span></button>`; };
    const side = (wk)=>{ const s = wk.reduce((a, d)=> a + (d && byDate[d]?.miles || 0), 0); return s ? Math.round(s) : ''; };
    V.cache['day:' + V.sel] = byDate[V.sel];
    return `<div class="kv-row" style="--c:1.15fr 1fr"><div class="kv-stack">${monthGrid(y, m, cell, side, 'logMonth')}
        <div class="kv-legend"><span><i class="i1"></i>Easy 1-3</span><span><i class="i2"></i>Moderate 4-5</span><span><i class="i3"></i>Hard 6-7</span><span><i class="i4"></i>Very hard 8-10</span><span><i class="pl"></i>Planned</span></div></div>
      <div class="kv-stack">${dayPanel(V.sel, byDate[V.sel], plan[V.sel], false)}</div></div>`;
  };
  ACT.logMonth = (s)=>{ let [y, m] = V.month; m += +s; if(m < 0){ m = 11; y--; } if(m > 11){ m = 0; y++; } V.month = [y, m]; redraw(); };
  ACT.logSel = (d)=>{ if(V.sel === d && window.innerWidth < 1024) return push('day|' + d); V.sel = d; redraw(); };

  // A day: what was planned, what you ran, the reps, how it went. Compact beside the calendar; full on its own page.
  function dayPanel(d, x, p, full){
    // On its own page the heading already names the day, so only the actions show.
    const fullHead = `<div class="kv-ch kv-dayttl" style="margin-bottom:14px"><div class="kv-hint" style="margin:0">${p && !x?.miles ? `Planned: ${esc(p.type === 'Off' ? 'rest' : `${p.type} ${p.miles} mi`)}` : x?.plan ? `Plan: ${esc(x.plan.label || '')}` : ''}</div>${d <= todayKey() ? `<button type="button" class="pri" data-a="dayEdit" data-v="${d}">${x?.miles ? 'Edit run' : 'Add a run'}</button>` : ''}</div>`;
    const head = full ? fullHead : `<div class="card kv-card kv-dayhead"><div class="kv-ch"><div><div class="kv-eb">${esc(nice(d, { weekday:'long', month:'short', day:'numeric' }))}${d === todayKey() ? ' · today' : ''}</div><div class="kv-ct big">${esc(x?.miles ? runTitle(x) : p ? (p.type === 'Off' ? 'Rest day' : p.type) : 'Rest day')}</div></div>
      <div class="kv-ch-r">${full ? '' : `<button type="button" data-a="dayFull" data-v="${d}">${ICON.full}Full screen</button>`}${d <= todayKey() ? `<button type="button" class="pri" data-a="dayEdit" data-v="${d}">${x?.miles ? 'Edit' : 'Add a run'}</button>` : ''}</div></div>
      ${p && !x?.miles ? `<div class="kv-hint">Planned: ${esc(p.type === 'Off' ? 'rest' : `${p.type} ${p.miles} mi`)}${sessionText(p) || p.base?.notes ? ' · ' + esc(sessionText(p) || p.base.notes) : ''}</div>` : ''}
      ${x?.plan ? `<div class="kv-hint">Plan: ${esc(x.plan.label || '')}</div>` : ''}</div>`;
    if(!x?.miles && !x?.notes && !x?.summary) return head + (d > todayKey() && p ? card('', '', `<div class="kv-hint">Can’t make it, or want something different? Kestrel AI moves it inside the guardrails.</div><div class="kv-btns"><button type="button" data-a="dayKai" data-v="${d}">Change this day</button></div>`) : '');
    const stats = tiles([['Miles', x.miles ?? '–'], ['Time', x.minutes ? clock(x.minutes * 60) : '–'], ['Pace', paceOf(x.miles, x.minutes) + (x.miles && x.minutes ? '/mi' : '')], ['Effort', x.difficulty ? x.difficulty + '/10' : '–'], ['Feel', x.feel ? x.feel + '/10' : '–'], ['Sleep', x.sleep_hours != null ? x.sleep_hours + ' h' : '–']], 3);
    const reps = x.split_reps?.length ? card(`Reps · ${x.split_reps.length} × ${x.split_reps[0].m} m`, `avg ${clock(x.split_reps.reduce((a, r)=> a + r.s, 0) / x.split_reps.length)}`, `<div class="kv-reps">${x.split_reps.map((r, i)=> `<span><small>${i + 1}${r.m !== x.split_reps[0].m ? ' · ' + r.m + 'm' : ''}</small>${clock(r.s)}</span>`).join('')}</div>`) : '';
    const sessions = (x.sessions || []).length ? card('Sessions', 'From your watch.', `<div class="kv-list">${x.sessions.map(s=> `<div class="kv-li"><div><b>${esc(SESSION_LABEL[s.category] || 'Run')} · ${esc(s.miles)} mi</b><span>${esc([s.start, s.pace && s.pace + '/mi', s.avg_hr && s.avg_hr + ' bpm', s.elev_ft && s.elev_ft + ' ft up'].filter(Boolean).join(' · '))}</span></div></div>`).join('')}</div>`) : '';
    const notes = card('How it went', '', `${x.coach_note ? `<div class="kv-note"><b>Kestrel AI:</b> ${esc(x.coach_note)}</div>` : ''}${x.notes ? `<div class="kv-hint" style="color:var(--text)">${esc(x.notes)}</div>` : '<div class="kv-hint">No notes.</div>'}${x.strength ? '<div class="kv-hint">Did strength / core.</div>' : ''}${x.track ? '<div class="kv-hint">On the track.</div>' : ''}
      <div class="kv-btns"><button type="button" data-a="dayKai" data-v="${d}">Ask Kestrel AI about it</button></div>`);
    return head + (full ? `<div class="kv-row" style="--c:1fr 1fr 1fr"><div class="kv-stack">${card('', '', stats)}${sessions}</div><div class="kv-stack">${reps || card('', '', '<div class="kv-hint">No reps logged.</div>')}</div><div class="kv-stack">${notes}</div></div>` : card('', '', stats) + reps + notes);
  }
  ACT.dayFull = (d)=> push('day|' + d);
  ACT.dayEdit = (d)=> push('edit|' + d);
  ACT.dayKai = (d)=> openKai(`About ${nice(d, { weekday:'long', month:'short', day:'numeric' })}: `, false);
  SCREENS.day = async (d)=>{
    const [lg, h] = await Promise.all([logRange(d, d), loadKai()]);
    const x = lg?.days?.[0]; V.cache['day:' + d] = x;
    const p = (h?.week?.days || []).find(z=> z.date === d);
    return `<button type="button" class="kv-back" data-a="back">‹ Back</button>${dayPanel(d, x, p, true)}`;
  };

  // ---------------------------------------------------------------- editing a run
  SCREENS.edit = async (d)=>{
    const x = (await logRange(d, d))?.days?.[0] || {};
    if(!V.edit || V.edit.date !== d) V.edit = { date:d, reps:(x.split_reps || []).map(r=> ({ m:r.m, s:r.s, rest:r.rest || '' })), repM:x.split_reps?.[0]?.m || 800 };
    const E = V.edit, lock = x.locked;
    const f = (label, name, val, attrs = '')=> `<label><span>${label}</span><input name="${name}" value="${esc(val ?? '')}" ${attrs} ${lock && ['manual_miles','minutes','runs','difficulty'].includes(name) ? 'disabled' : ''}></label>`;
    return `<button type="button" class="kv-back" data-a="back">‹ Back</button>
      <form class="card kv-card kv-form kv-edit" data-f="saveRun" data-v="${d}">
        ${lock ? '<div class="kv-note">Miles, time and effort come from your watch for this day.</div>' : ''}
        <div class="kv-grid3">${f('Miles', 'manual_miles', x.miles, 'inputmode="decimal"')}${f('Minutes', 'minutes', x.minutes, 'inputmode="numeric"')}${f('Effort 1-10', 'difficulty', x.difficulty, 'inputmode="numeric"')}</div>
        <div class="kv-grid3">${f('Feel 1-10', 'feel', x.feel, 'inputmode="numeric"')}${f('Sleep (h)', 'sleep_hours', x.sleep_hours, 'inputmode="decimal"')}${f('Runs', 'runs', x.runs, 'inputmode="numeric"')}</div>
        <label><span>What it was</span><input name="summary" value="${esc(x.summary || '')}" placeholder="Tempo, easy, 6 × 800…"></label>
        <label class="kv-check"><input type="checkbox" name="track" ${x.track ? 'checked' : ''}> On the track <small>reps round to the nearest 100 m</small></label>
        <label class="kv-check"><input type="checkbox" name="strength" ${x.strength ? 'checked' : ''}> Did strength / core</label>
        <div class="kv-eb">Splits · ${E.reps.length} reps</div>
        <div class="kv-repedit">${E.reps.map((r, i)=> `<span><small>${i + 1} · ${r.m}m</small><input name="rep${i}" value="${r.s ? clock(r.s) : ''}" aria-label="Rep ${i + 1} time"><button type="button" class="kv-x" data-a="repDel" data-v="${i}" aria-label="Remove rep ${i + 1}">×</button></span>`).join('') || '<span class="kv-hint">No reps. Add a set, or leave empty for a steady run.</span>'}</div>
        <div class="kv-line"><div class="kv-chips"><input class="kv-mini" name="setN" value="4" aria-label="Reps"> × <input class="kv-mini" name="setM" value="${E.repM}" aria-label="Metres"> m <button type="button" data-a="repSet">Add set</button></div></div>
        <div class="kv-chips">${['6x200','8x400','5x800','4x1000','3x1600'].map(q=> `<button type="button" class="kv-chip" data-a="repQuick" data-v="${q}">${q.replace('x', '×')}</button>`).join('')}</div>
        <label><span>Paste times</span><textarea name="paste" rows="2" placeholder="1:12 1:11 1:10.5, or one per line"></textarea></label>
        <div class="kv-btns"><button type="button" data-a="repPaste">Fill reps from pasted times</button></div>
        <label><span>Notes</span><textarea name="notes" rows="3">${esc(x.notes || '')}</textarea></label>
        <div class="kv-btns"><button type="submit" class="pri">Save run</button><button type="button" data-a="back">Cancel</button>${(x.sessions || []).length ? `<button type="button" data-a="oldEdit" data-v="${d}">Watch sessions and splits</button>` : ''}</div>
      </form>`;
  };
  const form = ()=> document.querySelector('#pageV form[data-f="saveRun"]');
  function harvest(){ const f = form(); if(!f) return; V.edit.reps = V.edit.reps.map((r, i)=>{ const s = secs(f.elements['rep' + i]?.value || ''); return isNaN(s) ? r : { ...r, s }; }); V.edit.repM = +f.elements.setM.value || V.edit.repM; }
  ACT.repDel = (i)=>{ harvest(); V.edit.reps.splice(+i, 1); redraw(); };
  const addSet = (n, m)=>{ for(let i = 0; i < n; i++) V.edit.reps.push({ m, s:0, rest:'' }); V.edit.repM = m; redraw(); };
  ACT.repSet = ()=>{ harvest(); const f = form(); addSet(Math.min(40, +f.elements.setN.value || 1), +f.elements.setM.value || 400); };
  ACT.repQuick = (v)=>{ harvest(); const [n, m] = v.split('x').map(Number); addSet(n, m); };
  ACT.repPaste = ()=>{ harvest(); const t = form().elements.paste.value.split(/[\s,]+/).filter(Boolean).map(x=> x.includes(':') ? secs(x) : +x >= 100 ? Math.floor(+x / 100) * 60 + (+x % 100) : +x).filter(x=> x > 0);
    if(!t.length) return toast('No times found');
    const m = V.edit.repM; V.edit.reps = t.map((s, i)=> ({ m:V.edit.reps[i]?.m || m, s, rest:'' })); redraw(); toast(`Filled ${t.length} reps`); };
  ACT.oldEdit = (d)=> openLogDay(d);
  ACT.saveRun = async (d, f)=>{
    harvest();
    const num = (n)=>{ const v = f.elements[n]?.value?.trim(); return v === '' || v == null ? null : Number(v); };
    const fields = { summary:f.elements.summary.value, notes:f.elements.notes.value, feel:num('feel'), sleep_hours:num('sleep_hours'), strength:f.elements.strength.checked, surface:f.elements.track.checked ? 'track' : '',
      split_reps:V.edit.reps.filter(r=> r.m > 0 && r.s > 0) };
    if(!f.elements.manual_miles.disabled) Object.assign(fields, { manual_miles:num('manual_miles'), minutes:num('minutes'), runs:num('runs'), difficulty:num('difficulty') });
    const r = await saveDayFields(d, fields);
    if(r && !r.error){ V.edit = null; V.stack.pop(); toast('Run saved'); redraw(); }
  };

  // ---------------------------------------------------------------- Calendar › Team
  SCREENS.teamcal = async ()=>{
    if(!window.KESTREL?.teamId) return need('Join a team to see its practices and meets.');
    const today = todayKey();
    if(!V.teamMonth){ const d = new Date(today + 'T12:00:00'); V.teamMonth = [d.getFullYear(), d.getMonth()]; }
    if(!V.teamSel) V.teamSel = today;
    const [y, m] = V.teamMonth;
    const next = Object.keys(events).filter(d=> d >= today).sort().map(d=> (events[d] || []).find(e=> e.type === 'meet') && d).find(Boolean);
    V.cache.teamCalTitle = next ? `Next meet: ${events[next].find(e=> e.type === 'meet').title}` : 'Team schedule';
    setSub(next ? nice(next, { weekday:'long', month:'long', day:'numeric' }) : '');
    const cell = (d)=>{ const ev = events[d] || [], meet = ev.some(e=> e.type === 'meet');
      return `<button type="button" class="kv-cday ${meet ? 'meet' : ''} ${d === V.teamSel ? 'sel' : ''} ${d === today ? 'now' : ''}" data-a="teamSel" data-v="${d}"><b>${+d.slice(8)}</b>${meet ? '<em>Meet</em>' : `<i class="kv-dots">${ev.slice(0, 3).map(e=> `<i style="background:${eventStyle(e).color}"></i>`).join('')}</i>`}</button>`; };
    const ev = events[V.teamSel] || [];
    return `<div class="kv-row" style="--c:1.15fr 1fr"><div class="kv-stack">${monthGrid(y, m, cell, null, 'teamMonth')}</div>
      <div class="kv-stack"><div class="kv-ch kv-dayttl"><div class="kv-ct">${esc(nice(V.teamSel, { weekday:'long', month:'short', day:'numeric' }))}${V.teamSel === today ? ' · today' : ''}</div><button type="button" data-a="oldCal">Add or change events</button></div>
      ${ev.length ? ev.map(e=> eventCard(e, V.teamSel)).join('') : need('Nothing on the team calendar this day.')}</div></div>`;
  };
  ACT.teamMonth = (s)=>{ let [y, m] = V.teamMonth; m += +s; if(m < 0){ m = 11; y--; } if(m > 11){ m = 0; y++; } V.teamMonth = [y, m]; redraw(); };
  ACT.teamSel = (d)=>{ V.teamSel = d; selectedDate = d; redraw(); };
  ACT.oldCal = ()=>{ selectedDate = V.teamSel; const d = new Date(V.teamSel + 'T12:00:00'); viewYear = d.getFullYear(); viewMonth = d.getMonth(); scheduleView = 'calendar'; setPage('schedule'); renderCalendar?.(); renderDayDetail?.(); };

  // ---------------------------------------------------------------- Body › Recovery
  SCREENS.recovery = async ()=>{
    if(!own()) return need('Pick your name to check in.');
    const today = todayKey(), from = iso(new Date(Date.now() - 6 * 864e5));
    const [lg, h] = await Promise.all([logRange(from, today), loadKai()]);
    const byDate = {}; (lg?.days || []).forEach(d=> byDate[d.date] = d);
    const t = byDate[today];
    V.cache.feelTitle = t?.feel ? `Feeling ${t.feel}/10` : 'How you feel';
    const rd = h?.health?.readiness;
    setSub(rd ? `Readiness ${rd.score} · ${rd.label}` : '');
    const status = currentTrainingStatus();
    const statusCard = card('Training status', 'What you’re doing right now. Teammates see it.', `<div class="kv-chips">${TRAINING_KEYS.map(k=> `<button type="button" class="kv-chip ${k === status ? 'on' : ''}" data-a="trainStatus" data-v="${k}">${TRAINING_STATES[k].label}</button>`).join('')}</div>`);
    const week = Array.from({ length:7 }, (_, i)=> iso(new Date(Date.now() - (6 - i) * 864e5)));
    const trend = card('Last 7 days', 'How you felt and slept.', `<div class="kv-trendbars">${week.map(d=>{ const x = byDate[d]; return `<div><div class="tb"><i class="f" style="height:${(x?.feel || 0) * 10}%"></i><i class="s" style="height:${Math.min(100, (x?.sleep_hours || 0) * 10)}%"></i></div><span>${new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday:'short' })}</span></div>`; }).join('')}</div>
      <div class="kv-legend"><span><i style="background:var(--accent)"></i>Feel</span><span><i style="background:var(--info)"></i>Sleep</span></div>`);
    const health = card('Health', 'From your log and your watch.', tiles([['Readiness', rd ? rd.score : '–', rd?.label || ''], ['Resting HR', h?.health?.resting_hr ?? '–'], ['HRV', h?.health?.hrv ?? '–'], ['Sleep', h?.health?.sleep?.last7 != null ? h.health.sleep.last7 + ' h' : '–', '7-day average']], 4)
      + (rd?.factors?.length ? `<div class="kv-list" style="margin-top:8px">${rd.factors.map(x=> `<div class="kv-li"><div><span style="color:var(--text)">${esc(x.why)}</span></div><i>${x.pts > 0 ? '+' : ''}${x.pts}</i></div>`).join('')}</div>` : ''));
    const marks = bodyMarks[activePersonId] || {};
    const map = card('Body map', 'Tap anything that hurts: sore, then pain, then clear. Kestrel AI keeps hard runs off it.', `<div class="kv-bodymap"><div id="kvBodyMount"></div>
      <div class="kv-bmchips">${Object.entries(marks).map(([id, st])=> `<span class="kv-bmchip ${st}">${esc(BODY_PART_LABELS[id] || id)}<button type="button" data-a="bmClear" data-v="${id}" aria-label="Clear">✕</button></span>`).join('')}</div>
      <button type="button" class="kv-bmflip" data-a="bmFlip">${ICON.flip}<span>${V.bmView === 'front' ? 'Front' : 'Back'}</span></button></div>
      <div class="kv-legend" style="justify-content:center"><span><i style="background:#94a3b8"></i>OK</span><span><i style="background:#f97316"></i>Sore</span><span><i style="background:#dc2626"></i>Pain</span></div>
      <div class="kv-btns"><button type="button" data-a="bmKai">Tell Kestrel AI how it feels</button></div>`);
    return `<div class="kv-row" style="--c:1.2fr 1fr"><div class="kv-stack">${feelCard(t, false)}${trend}${health}</div><div class="kv-stack">${map}</div></div>`;
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
    const add = card('Add food', 'Tap a recent food, or type your own.', `<div class="kv-addgrid">${(rec?.foods || []).slice(0, 6).map((x, i)=> `<button type="button" data-a="foodQuick" data-v="${i}">${esc(x.name)}</button>`).join('')}</div>
      <form class="kv-form" data-f="foodSave" style="margin-top:12px"><label><span>What</span><input name="name" placeholder="Bagel with peanut butter" required></label><div class="kv-grid3"><label><span>Carbs g</span><input name="carbs_g" inputmode="numeric"></label><label><span>Protein g</span><input name="protein_g" inputmode="numeric"></label><label><span>kcal</span><input name="kcal" inputmode="numeric"></label></div>
      <label><span>Meal</span><select name="meal">${(d.meals || []).map(m=> `<option value="${m.key}">${esc(m.label)}</option>`).join('')}</select></label><div class="kv-btns"><button type="submit" class="pri">Add</button></div></form>`);
    V.cache.recentFoods = rec?.foods || [];
    const tips = card('Fueling your running', '', `<div class="kv-how">${(d.run_fuel || []).map(x=> `<p><b>${esc(cap(x.when))}:</b> ${esc(x.text)}</p>`).join('')}</div>`);
    return `<div class="kv-row" style="--c:1fr 1fr 1fr"><div class="kv-stack">${day}${meals}</div>${add}<div class="kv-stack">${tips}</div></div>`;
  };
  ACT.foodDay = (s)=>{ const d = new Date(V.foodDate + 'T12:00:00'); d.setDate(d.getDate() + +s); V.foodDate = iso(d); redraw(); };
  ACT.foodDel = async (id)=>{ await post('/api/food/delete', { id }); redraw(); };
  ACT.foodQuick = async (i)=>{ const { meal, ...q } = V.cache.recentFoods[+i]; const r = await post('/api/food', { date:V.foodDate, meal, ...q }); if(r.error) return alert(r.error); toast('Added'); redraw(); };
  ACT.foodSave = async (_, f)=>{ const b = Object.fromEntries(new FormData(f)); const r = await post('/api/food', { date:V.foodDate, ...b }); if(r.error) return alert(r.error); toast('Added'); redraw(); };

  // ---------------------------------------------------------------- Team › Feed
  SCREENS.feed = async ()=>{
    if(!window.KESTREL?.teamId) return need('Join or start a team to see the team feed.');
    const d = await getJson('/api/team');
    setSub(d ? `${d.this_week} miles this week · ${d.logged}/${d.members} athletes logged` : '');
    const rows = (d?.athletes || []).slice().sort((a, b)=> b.this_week - a.this_week || b.avg4 - a.avg4);
    const top = Math.max(1, ...rows.map(r=> r.this_week), ...rows.map(r=> r.avg4));
    const board = card('Miles this week', 'Only teammates who share their miles appear.', tiles([['Team', d?.this_week ?? '–', 'miles'], ['Last week', d?.last_week ?? '–', 'miles'], ['Logged', d ? `${d.logged}/${d.members}` : '–', 'athletes']], 3)
      + `<div class="kv-board">${rows.map((r, i)=> `<div class="kv-lb ${r.id === activePersonId ? 'me' : ''}"><span class="rk">${r.this_week > 0 ? i + 1 : '–'}</span><span class="nm"><i style="background:${r.color}"></i>${esc(r.name)}</span><span class="kv-bar"><i style="width:${r.this_week / top * 100}%"></i></span><b>${r.this_week || '–'}</b></div>`).join('') || '<div class="kv-hint">Nobody shares their weekly miles yet.</div>'}</div>`);
    const sorted = [...posts].sort((a, b)=> b.createdAt - a.createdAt);
    const feed = `<form class="card kv-card kv-compose" data-f="post"><input name="text" placeholder="Post to the team" autocomplete="off" maxlength="2000"><button type="submit" class="pri">Post</button></form>
      <div class="card kv-card kv-posts" id="kvPosts">${sorted.length ? sorted.slice(0, 6).map(renderPostItem).join('') : '<div class="kv-hint">No posts yet.</div>'}</div>
      <div id="kvActivities"></div>`;
    return `<div class="kv-row" style="--c:1.3fr 1fr"><div class="kv-stack">${feed}</div><div class="kv-stack">${board}</div></div>`;
  };
  SCREENS.feed.after = ()=>{ const p = $('kvPosts'); if(p && typeof wirePostItems === 'function') wirePostItems(p, redraw); if($('kvActivities')) window.kestrelRenderActivities?.($('kvActivities')); };
  ACT.post = async (_, f)=>{ const text = f.elements.text.value.trim(); if(!text) return; const r = await createPostRemote(activePersonId, text, ''); posts.push(r?.post || { id:'post_' + Date.now(), personId:activePersonId, text, header:'', createdAt:Date.now() }); redraw(); };

  // ---------------------------------------------------------------- Team › Meets & places
  SCREENS.meets = async ()=>{
    if(!window.KESTREL?.teamId) return need('Join a team to see its meets.');
    const today = todayKey();
    const all = Object.entries(events).flatMap(([d, list])=> list.filter(e=> e.type === 'meet').map(e=> ({ ...e, date:d }))).sort((a, b)=> a.date.localeCompare(b.date));
    const up = all.filter(e=> e.date >= today), past = all.filter(e=> e.date < today).reverse();
    setSub(up[0] ? `Next: ${up[0].title}, ${nice(up[0].date)}` : 'No meets coming up');
    const meet = (e)=>{ const st = own() ? getRsvp(e.id) : null, loc = (locations || []).find(l=> l.id === e.locationId);
      return card(esc(e.title), esc(`${nice(e.date, { weekday:'short', month:'short', day:'numeric' })}${e.time ? ' · ' + e.time : ''}`), `${e.location ? `<div class="kv-li" style="border:0;padding:8px 0 0"><div><b>${esc(e.location)}</b><span>${esc(loc?.address || '')}</span></div><a class="kv-link-sm" href="${mapsSearchLink(loc?.address || e.location)}" target="_blank" rel="noopener">Map</a></div>` : ''}${e.desc ? `<div class="kv-hint">${esc(e.desc)}</div>` : ''}`,
        st ? `<button type="button" class="kv-rsvp ${st}" data-a="rsvp" data-v="${e.id}">${esc(rsvpLabel[st])}</button>` : ''); };
    const results = card('Results', 'Past meets.', `<div class="kv-list">${past.slice(0, 6).map(e=> `<div class="kv-li"><div><b>${esc(e.title)}</b><span>${esc(nice(e.date))}${e.location ? ' · ' + esc(e.location) : ''}</span>${e.results ? `<span style="color:var(--text)">${esc(e.results)}</span>` : ''}</div></div>`).join('') || '<div class="kv-hint">No past meets yet.</div>'}</div>`);
    const places = card('Places', 'Courses, tracks and meeting spots.', `<div class="kv-list">${(locations || []).map(l=> `<div class="kv-li"><div><b>${esc(l.name)}</b><span>${esc(l.address || '')}</span></div><a class="kv-link-sm" href="${mapsSearchLink(l.address || l.name)}" target="_blank" rel="noopener">Map</a></div>`).join('') || '<div class="kv-hint">No places saved yet.</div>'}</div><div class="kv-btns"><button type="button" data-a="oldPlaces">Add or edit places</button></div>`);
    return `<div class="kv-row" style="--c:1.3fr 1fr"><div class="kv-stack">${up.map(meet).join('') || need('No meets coming up.')}</div><div class="kv-stack">${results}${places}</div></div>`;
  };
  ACT.oldPlaces = ()=>{ scheduleView = 'places'; setPage('schedule'); };

  // ---------------------------------------------------------------- Team › Plan and Roster (the team's own editors)
  SCREENS.teamplan = async ()=>{ if(!window.KESTREL?.teamId) return need('Join a team to see its plan.'); if(own()) await loadKai(); setSub('Each row is a level, by weekly miles. Tap a day for the workout.'); return '<div id="kvTeamPlan" class="kv-stack"></div>'; };
  SCREENS.teamplan.after = ()=> window.kestrelRenderTeamTraining?.($('kvTeamPlan'));
  SCREENS.roster = async ()=>{ if(!window.KESTREL?.teamId) return need('Join a team to see its roster.'); setSub(''); return '<div id="kvRoster" class="kv-stack"></div>'; };
  SCREENS.roster.after = ()=> window.kestrelRenderRoster?.($('kvRoster'));

  function own(){ return isRealPerson(); }
  function setSub(s){ V.cache['sub:' + V.key] = s; }
})();
