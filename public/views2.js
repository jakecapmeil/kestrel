// The redesigned screens, part two: Calendar (your training and the team's), a run's own page and its editor,
// Body (recovery, cross-training, fuel) and Team. Shares views.js's helpers through window.KV.
(function(){
  const SCREENS = window.KV.screens, ACT = window.KV.act, V = window.KV.state;
  const { esc, sec, card, tiles, need, toast, getJson, post, logRange, weekStart, intensity, runTitle, paceOf, saveDayFields, iso, nice, clock, secs, push, redraw, ICON, feelCard, eventCard, spark, latestPost } = window.KV._h;
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
    const byDate = {}; (lg?.days || []).forEach(d=> byDate[d.date] = d);
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
    const ttl = x?.miles ? runTitle(x) : p ? (p.type === 'Off' ? 'Rest day' : p.type) : 'Rest day';
    if(x?.miles) return `<div class="card kv-card kd-peek"><div class="kv-ch"><div><div class="kv-eb">${esc(nice(d, { weekday:'long', month:'short', day:'numeric' }))}${isToday ? ' · today' : ''}</div><div class="kv-ct big">${esc(ttl)}</div></div>
      <div class="kv-ch-r"><button type="button" class="pri kd-open" data-a="dayFull" data-v="${d}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 2h4v4M6 14H2v-4M14 2 9 7M2 14l5-5"/></svg>${wide() ? 'Full screen' : 'Open'}</button></div></div>
      ${window.KDay.peekHtml(x, wide())}</div>`;
    const head = `<div class="card kv-card kv-dayhead"><div class="kv-ch"><div><div class="kv-eb">${esc(nice(d, { weekday:'long', month:'short', day:'numeric' }))}${isToday ? ' · today' : ''}</div><div class="kv-ct big">${esc(ttl)}</div></div>
      <div class="kv-ch-r"><button type="button" class="pri" data-a="dayFull" data-v="${d}">${x?.notes || x?.summary ? 'Open' : d <= todayKey() ? 'Add a run' : 'Details'}</button></div></div>
      ${p && !x?.miles ? `<div class="kv-hint">Planned: ${esc(p.type === 'Off' ? 'rest' : `${p.type} ${p.miles} mi`)}${sessionText(p) || p.base?.notes ? ' · ' + esc(sessionText(p) || p.base.notes) : ''}</div>` : ''}
      ${x?.plan ? `<div class="kv-hint">Plan: ${esc(x.plan.planned || x.plan.label || '')}</div>` : ''}
      ${x?.day_line ? `<div class="kv-note"><b>Kestrel AI:</b> ${esc(x.day_line)}</div>` : ''}</div>`;
    return head + (d > todayKey() && p ? card('', '', `<div class="kv-hint">Can’t make it, or want something different? Kestrel AI moves it inside the guardrails.</div><div class="kv-btns"><button type="button" data-a="dayKai" data-v="${d}">Change this day</button></div>`) : '');
  }
  ACT.dayFull = (d)=>{ V.sel = d; push('day|' + d); };
  ACT.dayKai = (d)=> openKai(`About ${nice(d, { weekday:'long', month:'short', day:'numeric' })}: `, false);
  SCREENS.day = async (d)=>{
    const [lg] = await Promise.all([logRange(d, d)]);
    const x = lg?.days?.[0]; V.cache['day:' + d] = x;
    V.days = { [d]: x || { date:d, types:[], sessions:[], split_reps:[] } };
    // A run gets the full layout, with the day card (the editor) kept out of sight until Edit. Other days show the card.
    if(!x?.miles) return `<button type="button" class="kv-back" data-a="back">‹ Back</button><div id="kvDayHost"></div>`;
    return `<div class="kd-top"><button type="button" class="kv-back" data-a="back">‹ Back</button><button type="button" class="sm-btn" data-a="dayEdit">Edit</button></div>${window.KDay.fullHtml(x)}<div id="kvDayHost" hidden></div>`;
  };
  ACT.dayEdit = ()=>{
    const h = document.getElementById('kvDayHost'); if(!h) return;
    h.hidden = false; document.getElementById('tlEdit')?.click();
    h.scrollIntoView({ behavior:'smooth', block:'start' });
  };
  SCREENS.day.after = (el, d)=>{ mountDay(d, V.days, true); if(V.days[d]?.miles) window.KDay.mountFull(V.days[d], own()); };

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
    const health = card('Health', 'From your log and your watch.', tiles([['Readiness', rd ? rd.score : '–', rd?.label || ''], ['Resting HR', h?.health?.resting_hr?.last7 ?? '–', h?.health?.resting_hr?.normal ? 'norm ' + h.health.resting_hr.normal : ''], ['HRV', h?.health?.hrv?.last7 ?? '–', h?.health?.hrv?.normal ? 'norm ' + h.health.hrv.normal : ''], ['Sleep', h?.health?.sleep?.last7 != null ? h.health.sleep.last7 + ' h' : '–', '7-day average']], 4)
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
  SCREENS.teamplan = async ()=>{ if(!window.KESTREL?.teamId) return need('Join a team to see its plan.'); if(own()) await loadKai(); setSub(''); return '<div id="kvTeamPlan" class="kv-stack"></div>'; };
  SCREENS.teamplan.after = ()=> window.kestrelRenderTeamTraining?.($('kvTeamPlan'));
  SCREENS.roster = async ()=>{ if(!window.KESTREL?.teamId) return need('Join a team to see its roster.'); setSub(''); return '<div id="kvRoster" class="kv-stack"></div>'; };
  SCREENS.roster.after = ()=> window.kestrelRenderRoster?.($('kvRoster'));

  function own(){ return isRealPerson(); }
  function setSub(s){ V.cache['sub:' + V.key] = s; }
})();
