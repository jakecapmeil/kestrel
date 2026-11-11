// A run's day and its sessions. The day is one sentence, its miles, time and difficulty, and a card per session
// (a morning workout and an evening shakeout are two). Each session opens on its own: its numbers, its reps as a
// bar chart (a workout), its parts (warm-up, reps, cool-down), its route in 2D or 3D, elevation and heart rate, and its splits.
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

  // ---------------------------------------------------------------- sessions
  // A day can hold several sessions (a morning workout and an evening shakeout). Each one is its own page.
  const KIND = { easy:'Easy run', recovery:'Recovery run', long:'Long run', workout:'Workout', race:'Race', shakeout:'Shakeout', crosstrain:'Cross-training' };
  const ROLE = { warmup:'Warm-up', cooldown:'Cool-down' };
  const SEG = { warmup:'Warm', cooldown:'Cool' };
  const GENERIC = /^(morning|afternoon|evening|lunch|night|midday)? ?(run|running|activity|workout)$/i;
  const runs = (x)=> (x?.sessions || []).filter((s)=> s.category !== 'crosstrain');
  const sessionOf = (x, key)=> (x?.sessions || []).find((s)=> s.key === key) || null;
  const toMin = (t)=>{ const m = String(t || '').match(/^(\d{1,2}):(\d{2})/); return m ? +m[1] * 60 + +m[2] : null; };
  const ampm = (t)=>{ const m = toMin(t); if(m == null) return ''; const h = Math.floor(m / 60), mm = String(m % 60).padStart(2, '0'); return `${h % 12 || 12}:${mm} ${h < 12 ? 'AM' : 'PM'}`; };
  const partOfDay = (t)=>{ const m = toMin(t); return m == null ? '' : m < 660 ? 'Morning' : m < 840 ? 'Midday' : m < 1020 ? 'Afternoon' : 'Evening'; };
  const r1 = (n)=> Math.round(n * 10) / 10;
  const r2 = (n)=> (Math.round(n * 100) / 100).toFixed(2);

  // Rep times: tenths when the watch has them, m:ss for long reps.
  function repClock(s){
    if(s >= 600 || Number.isInteger(s)) return s < 60 ? Math.round(s) + 's' : clock(s);
    return s < 60 ? s.toFixed(1) : `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
  }
  const distLabel = (m, track)=> !track && Math.abs(m - MI) < 40 ? '1 mi' : m >= 200 ? `${Math.round(m / 100) * 100} m` : `${Math.round(m / 10) * 10} m`;
  const restLabel = (r)=>{ const t = String(r || '').trim(); if(!t) return ''; const m = t.match(/^(\d+)\s*s(ec)?$/i); return m ? `${m[1]} s` : t; };

  // A workout's reps from its laps: how they group ("25 × 400 m", "1600 · 1200 · 800 · 400 m"), and the fastest,
  // slowest and average by pace. Only workouts get reps; an easy run's mile laps are splits.
  function repsOf(s){
    if(!s || s.category !== 'workout') return null;
    const laps = (s.splits || []).filter((l)=> l.m >= 100 && l.s > 0);
    if(laps.length < 2) return null;
    const groups = [];
    for(const l of laps){ const g = groups[groups.length - 1]; if(g && Math.abs(l.m - g.m) <= Math.max(25, g.m * 0.06)) g.n++; else groups.push({ m: l.m, n: 1 }); }
    const label = groups.length === 1 ? `${groups[0].n} × ${distLabel(groups[0].m, s.track)}`
      : groups.every((g)=> g.n === 1) && groups.length <= 6 && groups.every((g)=> g.m >= 200 && (s.track || Math.abs(g.m - MI) >= 40)) ? groups.map((g)=> Math.round(g.m / 100) * 100).join(' · ') + ' m'
      : groups.map((g)=> g.n > 1 ? `${g.n} × ${distLabel(g.m, s.track)}` : distLabel(g.m, s.track)).join(' + ');
    const same = groups.length === 1;
    const rows = laps.map((l, i)=> ({ i, m: l.m, s: l.s, hr: l.hr || null, pace: l.s / (l.m / MI), rest: restLabel(l.rest) }));
    const by = (a, b)=> a.pace - b.pace;
    const fast = [...rows].sort(by)[0], slow = [...rows].sort(by).pop();
    const avgS = rows.reduce((a, r)=> a + r.s, 0) / rows.length;
    const avgPace = rows.reduce((a, r)=> a + r.s, 0) / (rows.reduce((a, r)=> a + r.m, 0) / MI);
    const rests = [...new Set(rows.map((r)=> r.rest).filter(Boolean))];
    const hrs = rows.filter((r)=> r.hr);
    return { track: !!s.track, rows, label, same, fast, slow, avgS, avgPace, rest: rests.length === 1 ? rests[0] : '', work: rows.reduce((a, r)=> a + r.m, 0),
      hr: hrs.length >= 2 ? { first: hrs[0].hr, last: hrs[hrs.length - 1].hr, max: Math.max(...hrs.map((r)=> r.hr)) } : null };
  }
  // What a rep reads as: its time when every rep is the same distance, its pace when they differ.
  const repVal = (R, r)=> R.same ? repClock(r.s) : clock(r.pace) + '/mi';
  const repAvg = (R)=> R.same ? repClock(Math.round(R.avgS * 10) / 10) : clock(R.avgPace) + '/mi';

  function sessionName(s){
    if(s.title && !GENERIC.test(s.title.trim())) return s.title;
    const R = repsOf(s);
    return R ? R.label : KIND[s.category] || 'Run';
  }
  const timeSpan = (s)=>{ const a = s.activities || []; const st = a[0]?.start || s.start, en = a[a.length - 1]?.end; return [ampm(st), en ? ampm(en) : ''].filter(Boolean).join(' – '); };

  // The one-sentence day: Kestrel AI's own line when it has written one, else built from the sessions.
  function daySentence(x){
    if(x?.day_line) return x.day_line;
    const ss = runs(x);
    if(!ss.length) return '';
    const bits = ss.map((s)=>{ const R = repsOf(s), when = partOfDay(s.start).toLowerCase();
      const what = R ? `${R.label} workout` : `${(KIND[s.category] || 'run').toLowerCase()} of ${r1(s.miles || 0)} mi`;
      return when ? `${what} in the ${when === 'midday' ? 'middle of the day' : when}` : what; });
    const lead = ss.length === 1 ? '' : `${ss.length === 2 ? 'Two' : ss.length === 3 ? 'Three' : ss.length} sessions, ${r1(x.miles || 0)} mi: `;
    const list = bits.length === 1 ? bits[0] : bits.slice(0, -1).join(', ') + ' and ' + bits[bits.length - 1];
    return (lead ? lead + list : list.charAt(0).toUpperCase() + list.slice(1)) + '.';
  }

  // The day's own numbers: miles, time, how many sessions, how hard.
  function dayStats(x){
    const ss = runs(x), t = totals(x), lv = levelOf(t.difficulty);
    return `<div class="kdd-stats">
      ${stat('Miles', t.miles != null ? r2(t.miles) : null)}
      ${stat('Time', t.minutes != null ? clock(t.minutes * 60) : null)}
      ${stat(ss.length === 1 ? 'Session' : 'Sessions', ss.length || '–')}
      <div class="kd-stat"><span>Difficulty</span>${t.difficulty ? `<em class="kd-pill l${lv}"><b>${t.difficulty}</b>${LEVEL[lv]}</em>` : '<b>–</b>'}</div></div>`;
  }
  function dayExtras(x){
    const chips = [];
    if(x?.plan) chips.push(`<span class="kdd-chip ${x.plan.tone}" title="${esc(x.plan.reason || '')}">${esc(x.plan.label)}${x.plan.reason && x.plan.tone !== 'on' ? ' · ' + esc(x.plan.reason) : ''}</span>`);
    if(x?.load) chips.push(`<span class="kdd-chip">Load ${Math.round(x.load)}</span>`);
    if(x?.feel) chips.push(`<span class="kdd-chip">Felt ${x.feel}/10</span>`);
    if(x?.sleep_hours) chips.push(`<span class="kdd-chip">Slept ${x.sleep_hours} h</span>`);
    return chips.length ? `<div class="kdd-chips">${chips.join('')}</div>` : '';
  }

  // Bars for a session card: one per rep, taller is faster.
  function miniBars(R){
    const lo = R.slow.pace, hi = R.fast.pace;
    return `<div class="ksc-bars" aria-hidden="true">${R.rows.map((r)=> `<i style="height:${lo === hi ? 70 : Math.round(30 + (lo - r.pace) / (lo - hi) * 70)}%"${r === R.fast ? ' class="f"' : r === R.slow ? ' class="s"' : ''}></i>`).join('')}</div>`;
  }
  function segBar(s){
    const a = (s.activities || []).filter((z)=> z.miles > 0);
    if(a.length < 2) return '';
    const tot = a.reduce((m, z)=> m + z.miles, 0);
    return `<div class="ksc-seg" aria-label="${a.map((z)=> `${ROLE[z.role] || KIND[z.category] || 'Run'} ${r1(z.miles)} mi`).join(', ')}">${a.map((z)=> `<span class="${z.role || (z.category === 'workout' || z.category === 'race' ? 'main' : 'easy')}" style="flex:${z.miles / tot}"><b>${esc(SEG[z.role] || (z.category === 'workout' ? 'Reps' : z.category === 'race' ? 'Race' : 'Run'))}</b>${r1(z.miles)}</span>`).join('')}</div>`;
  }

  // One session as a card on the day: when, what, the numbers, and its reps or parts at a glance.
  function sessionCard(s, on, compact){
    const R = repsOf(s), lv = levelOf(s.effort);
    const nums = [[r1(s.miles || 0), 'mi'], s.pace ? [s.pace, '/mi'] : null, s.avg_hr ? [s.avg_hr, 'bpm'] : null, !compact && s.minutes ? [clock(s.minutes * 60), ''] : null].filter(Boolean);
    return `<button type="button" class="ksc ${on ? 'on' : ''} ${compact ? 'sm' : ''}" data-a="sess" data-v="${esc(s.key)}" aria-pressed="${!!on}">
      <span class="ksc-t"><span>${esc([partOfDay(s.start), ampm(s.start)].filter(Boolean).join(' · ') || 'Session')}</span>${s.effort ? `<em class="kd-pill l${lv}">${esc(s.tag_label || KIND[s.category] || 'Run')}</em>` : `<em class="kd-pill">${esc(s.tag_label || KIND[s.category] || 'Run')}</em>`}</span>
      <b class="ksc-name">${esc(sessionName(s))}</b>
      <span class="ksc-nums">${nums.map(([v, u])=> `<span><b>${esc(v)}</b>${u ? `<i>${u}</i>` : ''}</span>`).join('')}</span>
      ${!compact && R ? miniBars(R) : ''}${!compact ? segBar(s) : ''}
      <i class="ksc-go" aria-hidden="true">›</i></button>`;
  }

  // ---------------------------------------------------------------- the summary beside the calendar
  // wide: desktop, which leads with the route. One sentence, the day's numbers, then each session to open.
  function peekHtml(x, wide){
    const ss = x?.sessions || [];
    return `${wide ? '<div class="kd-thumb" id="kdThumb" hidden></div>' : ''}
      ${daySentence(x) ? `<p class="kdd-line">${esc(daySentence(x))}</p>` : ''}
      ${dayStats(x)}
      ${ss.length ? `<div class="kdd-sl"><div class="kd-eb">${ss.length === 1 ? 'Session' : ss.length + ' sessions'} · tap to open</div>${ss.map((s)=> sessionCard(s, false, true)).join('')}</div>` : ''}`;
  }

  async function mountPeek(x, own){
    const host = document.getElementById('kdThumb'), s = mainSession(x);
    if(!host || !own || !s?.main_id || s.track) return;
    const r = await loadTrack(s.main_id);
    if(!r || !host.isConnected) return;
    host.innerHTML = routeSvg(r, false);
    host.hidden = false;
  }

  // ---------------------------------------------------------------- the day page
  // The day on top (one sentence, its numbers), then its sessions. On a phone a session opens on its own page;
  // on a laptop the chosen session sits beside the list. A one-session day shows that session straight away.
  function dayHtml(x, selKey, wide){
    const ss = x?.sessions || [];
    const sel = sessionOf(x, selKey) || (ss.length === 1 || wide ? mainSession(x) || ss[0] : null);
    const ai = x?.summary || x?.coach_note;
    const sum = `<section class="card kv-card kdd-sum">
        <div class="kd-eb">${eye}Day summary</div>
        ${daySentence(x) ? `<p class="kdd-line big">${esc(daySentence(x))}</p>` : ''}
        ${dayStats(x)}${notchesHtml(totals(x).difficulty)}${dayExtras(x)}
        ${ai ? `<div class="kdd-ai">${x.summary ? `<p>${esc(x.summary)}</p>` : ''}${x.coach_note ? `<div class="kd-next"><b>Next:</b> ${esc(x.coach_note)}</div>` : ''}</div>` : ''}
      </section>`;
    const list = ss.length > 1 || wide ? `<section class="kdd-list"><h3 class="kdd-h">${ss.length === 1 ? 'Session' : ss.length + ' sessions'}</h3>${ss.map((s)=> sessionCard(s, wide && s === sel)).join('')}</section>` : '';
    if(wide) return `<div class="kdd wide"><div class="kdd-side">${sum}${list}</div><div class="kdd-main">${sel ? sessionHtml(x, sel, true) : ''}</div></div>`;
    return `<div class="kdd">${sum}${list}${ss.length === 1 && sel ? `<h3 class="kdd-h">The session</h3>${sessionHtml(x, sel, true)}` : ''}</div>`;
  }

  // ---------------------------------------------------------------- one session
  function repCard(s, R){
    const lo = R.slow.pace, hi = R.fast.pace;
    const h = (r)=> lo === hi ? 70 : Math.round(28 + (lo - r.pace) / (lo - hi) * 72);
    const work = R.work >= 1000 ? `${r1(R.work / 1000)} km of reps` : `${Math.round(R.work)} m of reps`;
    const fourth = R.hr ? `<div><b>${R.hr.first}→${R.hr.last}</b><span class="a">heart rate, bpm</span></div>`
      : `<div><b>${repClock(Math.round((R.same ? R.slow.s - R.fast.s : R.slow.pace - R.fast.pace) * 10) / 10)}</b><span class="a">spread</span></div>`;
    return `<section class="card kr" aria-label="Reps">
      <div class="kr-top"><div class="kr-tags"><em class="kr-badge">${esc(s.tag_label || 'Workout')}</em><span>${esc(work)}</span></div>
        <div class="kr-avg"><span>Average</span><b>${repAvg(R)}</b></div></div>
      <div class="kr-title"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="14.5" cy="4" r="2"/><path d="M8 21l3-6 3 2v5M6 11l3-3 4 1 2 4 3 1M11 15l-2-3"/></svg><b>${esc(R.label)}</b>${R.rest ? `<span>off ${esc(R.rest)} rest</span>` : ''}</div>
      <div class="kr-plot"><div class="kr-tip" id="krTip" hidden></div>
        <div class="kr-bars" style="--n:${R.rows.length}">${R.rows.map((r)=> `<button type="button" class="kr-bar ${r === R.fast ? 'f' : r === R.slow ? 's' : ''}" data-i="${r.i}" aria-label="Rep ${r.i + 1}, ${distLabel(r.m, R.track)} in ${repVal(R, r)}${r.hr ? ', ' + r.hr + ' bpm' : ''}"><i style="height:${h(r)}%"></i></button>`).join('')}</div></div>
      <div class="kr-axis"><span>Rep 1</span><span>Rep ${R.rows.length}</span></div>
      <div class="kr-stats">
        <div><b>${repVal(R, R.fast)}</b><span class="g">fastest · rep ${R.fast.i + 1}</span></div>
        <div><b>${repAvg(R)}</b><span class="r">average</span></div>
        <div><b>${repVal(R, R.slow)}</b><span class="b">slowest · rep ${R.slow.i + 1}</span></div>
        ${fourth}</div>
    </section>`;
  }
  function repTable(R){
    return `<h2 class="kv-ct">Every rep</h2>
      <div class="kd-split hd kr-row"><span>Rep</span><span>${R.same ? 'Time' : 'Dist'}</span><span></span><span>Pace</span><span>HR</span></div>
      ${R.rows.map((r)=> `<div class="kd-split kr-row"><span class="m">${r.i + 1}</span><b>${R.same ? repClock(r.s) : distLabel(r.m, R.track)}</b><span class="bar"><i style="width:${R.slow.pace === R.fast.pace ? 70 : Math.round(30 + (R.slow.pace - r.pace) / (R.slow.pace - R.fast.pace) * 65)}%"></i></span><span>${clock(r.pace)}</span><span class="m">${r.hr ?? ''}</span></div>`).join('')}`;
  }
  function sessionStats(s){
    return `<div class="kd-stats">
      ${stat('Distance', s.miles != null ? r2(s.miles) : null, ' mi')}
      ${stat('Time', s.minutes ? clock(s.minutes * 60) : null)}
      ${stat('Pace', s.pace, '/mi')}
      ${stat('Effort', s.effort, '/10')}
      ${stat('Avg HR', s.avg_hr, ' bpm')}
      ${s.track ? stat('Where', 'Track') : stat('Elev gain', s.elev_ft != null ? Math.round(s.elev_ft) : null, ' ft')}</div>`;
  }
  // The parts of a session (warm-up, the reps, cool-down), each with its own numbers.
  function partsHtml(s){
    const a = (s.activities || []).filter((z)=> z.miles > 0);
    if(a.length < 2) return '';
    return `<section class="card kv-card ks-parts"><h2 class="kv-ct">Parts</h2>${segBar(s)}
      ${a.map((z)=> `<div class="ks-part"><span class="m">${esc(ampm(z.start))}</span><b>${esc(ROLE[z.role] || KIND[z.category] || 'Run')}</b><span>${r2(z.miles)} mi</span><span>${esc(z.pace || '–')}${z.pace ? '<i>/mi</i>' : ''}</span><span class="m">${z.avg_hr ? z.avg_hr + ' bpm' : ''}</span></div>`).join('')}</section>`;
  }

  // inline: part of the day page (no own header row). Otherwise the session's own page.
  function sessionHtml(x, s, inline){
    const R = repsOf(s), more = (s.activities || []).flatMap((z)=> z.prs || []);
    const conds = [s.temp_f != null ? `${Math.round(s.temp_f)}°F` : '', s.track ? 'On the track' : ''].filter(Boolean).join(' · ');
    return `<div class="ks ${inline ? 'inline' : ''}" data-key="${esc(s.key)}"><div class="ks-a">
      <section class="card kv-card ks-head">
        <div class="kv-eb">${esc([partOfDay(s.start), timeSpan(s)].filter(Boolean).join(' · '))}${conds ? ' · ' + esc(conds) : ''}</div>
        <div class="kv-ct big">${esc(sessionName(s))}</div>
        ${more.length ? `<div class="kdd-chips">${more.map((p)=> `<span class="kdd-chip pr">PR · ${esc(p.label)} ${esc(p.time)}</span>`).join('')}</div>` : ''}
        ${sessionStats(s)}${notchesHtml(s.effort)}
      </section>
      ${R ? repCard(s, R) : ''}
      ${partsHtml(s)}
      <section class="card kv-card kd-aicard"><div class="kd-eb">${eye}Kestrel AI on this session</div>${s.report ? `<p>${esc(s.report)}</p>` : '<p class="kv-hint">Kestrel AI writes this once the run syncs and it reviews your day.</p>'}</section>
      </div><div class="ks-b">
      <div class="kd-map card" id="kdMap"${s.main_id && !s.track ? '' : ' hidden'}>
        <div class="kd-map-in" id="kdMap2d"><div class="kv-hint">Loading the route…</div></div>
        <div class="kd-map-in" id="kdMap3d" hidden></div>
        <div class="kd-seg" role="group" aria-label="Map view"><button type="button" class="on" aria-pressed="true" data-kdv="2d">Route</button><button type="button" aria-pressed="false" data-kdv="3d">3D</button></div>
      </div>
      <section class="card kv-card kd-chartcard" id="kdChart" hidden></section>
      <section class="card kv-card kd-splitcard" id="kdSplits"${R ? '' : ' hidden'}>${R ? repTable(R) : ''}</section>
    </div></div>`;
  }

  async function mountSession(x, key, own){
    const s = sessionOf(x, key) || mainSession(x);
    const box = document.querySelector('.ks');
    if(!s || !box) return;
    wireReps(box, repsOf(s));
    const splitsEl = document.getElementById('kdSplits');
    let r = null;
    if(own && s.main_id && !s.track) r = await loadTrack(s.main_id);
    if(!document.getElementById('kdMap')?.isConnected) return;
    if(r){
      document.getElementById('kdMap2d').innerHTML = routeSvg(r, true);
      wireMap(r);
      mapUnder(document.getElementById('kdMap2d'), r);
      const chart = document.getElementById('kdChart');
      chart.innerHTML = chartHtml(r); chart.hidden = false; wireChart(chart, r);
    } else document.getElementById('kdMap').hidden = true;
    if(repsOf(s)) return;
    const rows = r ? mileSplits(r.pts) : [];
    const html = rows.length ? splitsHtml(rows, 'Splits') : lapsHtml(s.splits || []);
    if(html && splitsEl){ splitsEl.innerHTML = html; splitsEl.hidden = false; }
  }

  // Tap (or point at) a rep to read it out above its bar.
  function wireReps(box, R){
    const tip = box.querySelector('#krTip'); if(!tip || !R) return;
    const show = (b)=>{
      const r = R.rows[+b.dataset.i]; if(!r) return;
      box.querySelectorAll('.kr-bar.on').forEach((x)=> x.classList.remove('on')); b.classList.add('on');
      tip.innerHTML = `<b>Rep ${r.i + 1}</b> ${esc(distLabel(r.m, R.track))} · ${repClock(r.s)}${R.same ? '' : ` · ${clock(r.pace)}/mi`}${r.hr ? ` · ${r.hr} bpm` : ''}${r.rest ? ` · ${esc(r.rest)} rest` : ''}`;
      tip.hidden = false;
      const pb = b.parentNode.getBoundingClientRect(), bb = b.getBoundingClientRect(), tw = tip.offsetWidth;
      tip.style.left = Math.max(0, Math.min(pb.width - tw, bb.left - pb.left + bb.width / 2 - tw / 2)) + 'px';
    };
    box.querySelectorAll('.kr-bar').forEach((b)=>{ b.addEventListener('click', ()=> show(b)); b.addEventListener('pointerenter', (e)=>{ if(e.pointerType === 'mouse') show(b); }); });
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

  window.KDay = { peekHtml, mountPeek, dayHtml, sessionHtml, mountSession, sessionOf, sessionName, repsOf, notchesHtml, levelOf, mileSplits };
})();
