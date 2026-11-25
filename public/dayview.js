// A run's day and its sessions. The day is one sentence, its miles, time and difficulty, and a card per session
// (a morning workout and an evening shakeout are two). Each session opens on its own: its numbers, its reps as a
// bar chart (a workout), its parts (warm-up, reps, cool-down), its route in 2D or 3D, elevation and heart rate, and its splits.
(function(){
  const esc = (s)=> String(s ?? '').replace(/[&<>"']/g, (c)=> ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const clock = (s)=>{ s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? `${h}:${String(m).padStart(2, '0')}` : m) + ':' + String(x).padStart(2, '0'); };
  const MI = 1609.344, FT = 3.281;
  const LEVEL = ['Not rated', 'Easy', 'Moderate', 'Hard', 'Very hard'];
  const levelOf = (d)=> !d ? 0 : d <= 3 ? 1 : d <= 5 ? 2 : d <= 7 ? 3 : 4;

  // The runner's own 5K (set from the log), so "quick" and "easy" mean quick and easy for them, not for anyone.
  let fiveK = null; // seconds per mile at 5K pace
  function setFiveK(t){ const m = String(t || '').trim().match(/^(\d{1,2}):(\d{2})$/); fiveK = m ? (+m[1] * 60 + +m[2]) / 3.10686 : null; }
  // 1 quick (red) to 4 easy (green), for this runner. Two readings, averaged: how the rep's pace sits against their 5K (at or inside
  // 10K pace is quick, up to tempo strong, up to steady steady, slower easy), and where it falls in the session's own range, so a
  // set of even 400s still shows which reps were the quickest. A very even set stays on the 5K reading alone.
  // With no 5K on file, the session's own range decides.
  function effortOf(pace, R){
    const lo = R.fast.pace, hi = R.slow.pace, spread = hi - lo >= lo * 0.015;
    const rel = spread ? 1 + 3 * (pace - lo) / (hi - lo) : null;
    if(!fiveK) return rel == null ? 1 : Math.round(rel);
    const q = pace / fiveK, abs = q <= 1.04 ? 1 : q <= 1.12 ? 2 : q <= 1.22 ? 3 : 4;
    return rel == null ? abs : Math.max(abs, Math.min(4, Math.round((abs + rel) / 2)));
  }
  const EFFORT = ['', 'quick', 'strong', 'steady', 'easy'];

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
  // Names a watch gives on its own ("Morning Run", Garmin's "New York Running"): the session's reps or kind say more.
  // Names a watch gives on its own: "Morning Run", and Garmin's place names ("New York Running", capitalised as Garmin
  // writes them; a runner's own "hill running" stays).
  const GENERIC = { test: (n)=> /^(?:(?:morning|afternoon|evening|lunch|night|midday) )?(?:run|running|activity|workout)$/i.test(n)
    || /^(?:\p{Lu}[\p{L}.'-]*\s){1,4}Running$/u.test(n) };
  const runs = (x)=> (x?.sessions || []).filter((s)=> s.category !== 'crosstrain');
  // A day as the pages show it. Logged by hand (no watch): one session from the day's own numbers and reps.
  // Hand-built reps on a watch day replace the workout session's laps (they were typed to fix them).
  function prepare(x){
    if(!x || x._prepped) return x;
    x._prepped = true;
    const reps = (x.split_reps || []).filter((r)=> r.m && r.s);
    if(!(x.sessions || []).length && x.miles){
      x.sessions = [{ key: x.date + '#hand', manual: true, category: reps.length >= 2 || (x.types || []).includes('workout') ? 'workout' : (x.types || []).includes('long') ? 'long' : 'easy',
        title: '', start: '', miles: x.miles, minutes: x.minutes, pace: x.miles && x.minutes ? clock(x.minutes * 60 / x.miles) : null,
        avg_hr: null, effort: x.difficulty, track: !!x.track, splits: reps, splits_hand: true, report: '', elev_ft: null, activities: [] }];
    } else if(x.split_source === 'hand' && reps.length >= 2){
      const w = (x.sessions || []).filter((z)=> z.category === 'workout' || z.category === 'race').sort((a, b)=> (b.miles || 0) - (a.miles || 0))[0];
      if(w){ w.splits = reps; w.splits_hand = true; }
    }
    return x;
  }
  const sessionOf = (x, key)=> (prepare(x)?.sessions || []).find((s)=> s.key === key) || null;
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
  // A session can hold more than one set (6 × 1 km, then 4 × 200 m): each set gets its own stats in R.sets.
  function repsOf(s){
    if(!s || s.category !== 'workout') return null;
    let laps = (s.splits || []).filter((l)=> l.m >= 100 && l.s > 0);
    if(laps.length < 2) return null;
    // One watch activity often holds the warm-up, the reps (with lapped jogs) and the cool-down. Keep the reps:
    // laps far slower than the fast half are recoveries, and slow laps at either end are the warm-up and cool-down.
    // Paces are compared as if every lap were 1 km (short reps are run faster), so 200s don't make 1 km reps look slow.
    const pace = (l)=> l.s / (l.m / MI);
    const norm = (l)=> pace(l) * Math.pow(1000 / Math.min(3200, Math.max(150, l.m)), 0.1);
    const sorted = laps.map(norm).sort((a, b)=> a - b), half = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 2)));
    const ref = half[Math.floor(half.length / 2)];
    // Reps typed by hand are exactly what the runner ran: keep them all. Watch laps: a warm-up or cool-down runs at
    // easy pace (well over 20% slower than the reps), so a threshold mile before 800s at 3200 pace stays in.
    if(!s.splits_hand){
      laps = laps.filter((l)=> norm(l) <= ref * 1.35);
      while(laps.length > 2 && norm(laps[0]) > ref * 1.22) laps = laps.slice(1);
      while(laps.length > 2 && norm(laps[laps.length - 1]) > ref * 1.22) laps = laps.slice(0, -1);
    }
    if(laps.length < 2) return null;
    // A lap joins the set before it when it is about the same distance as that set's average. Off the track the
    // distances are GPS, so one 300 m rep can read 272 m and the next 308 m: within 12% (or 25 m) is the same rep.
    // A track's lines are exact, so there 6%.
    const groups = [], tol = s.track ? 0.06 : 0.12;
    laps.forEach((l, i)=>{ const g = groups[groups.length - 1], avg = g && g.sum / g.n; if(g && Math.abs(l.m - avg) <= Math.max(25, avg * tol)) { g.sum += l.m; g.n++; g.to = i; } else groups.push({ m: l.m, sum: l.m, n: 1, from: i, to: i }); });
    const rows = laps.map((l, i)=> ({ i, m: l.m, s: l.s, hr: l.hr || null, pace: l.s / (l.m / MI), rest: restLabel(l.rest) }));
    const R = statsOf(rows, groups, !!s.track);
    // Separate sets: two blocks of repeats (6 × 1 km + 4 × 200 m), or three or more blocks of 3+. A ladder stays one set.
    const multi = groups.filter((g)=> g.n >= 2);
    if(groups.length >= 2 && groups.length <= 6 && (multi.length >= 2 && (groups.length === 2 || groups.filter((g)=> g.n >= 3).length >= 2))){
      R.sets = groups.map((g, k)=> ({ ...statsOf(rows.slice(g.from, g.to + 1), [g], !!s.track), n: k + 1 }));
    }
    return R;
  }
  // A set that repeats a pattern of distances (600, 200, 600, 200, 600, 200) reads as "3 × (600 m + 200 m)".
  function cycleLabel(groups, track){
    const tol = track ? 0.06 : 0.12;
    for(const c of [2, 3]){
      if(groups.length < c * 2 || groups.length % c) continue;
      const head = groups.slice(0, c);
      if(groups.every((g, i)=>{ const h = head[i % c]; return g.n === h.n && Math.abs(g.m - h.m) <= Math.max(25, h.m * tol); }))
        return `${groups.length / c} × (${head.map((g)=> g.n > 1 ? `${g.n} × ${distLabel(g.m, track)}` : distLabel(g.m, track)).join(' + ')})`;
    }
    return null;
  }
  function statsOf(rows, groups, track){
    const label = groups.length === 1 ? `${groups[0].n} × ${distLabel(groups[0].m, track)}`
      : cycleLabel(groups, track) ? cycleLabel(groups, track)
      : groups.every((g)=> g.n === 1) && groups.length <= 6 && groups.every((g)=> g.m >= 200 && (track || Math.abs(g.m - MI) >= 40)) ? groups.map((g)=> Math.round(g.m / 100) * 100).join(' · ') + ' m'
      : groups.map((g)=> g.n > 1 ? `${g.n} × ${distLabel(g.m, track)}` : distLabel(g.m, track)).join(' + ');
    const same = groups.length === 1;
    const by = (a, b)=> a.pace - b.pace;
    const fast = [...rows].sort(by)[0], slow = [...rows].sort(by).pop();
    const avgS = rows.reduce((a, r)=> a + r.s, 0) / rows.length;
    const avgPace = rows.reduce((a, r)=> a + r.s, 0) / (rows.reduce((a, r)=> a + r.m, 0) / MI);
    const rests = [...new Set(rows.map((r)=> r.rest).filter(Boolean))];
    const hrs = rows.filter((r)=> r.hr);
    return { track, rows, label, same, fast, slow, avgS, avgPace, rest: rests.length === 1 ? rests[0] : '', work: rows.reduce((a, r)=> a + r.m, 0),
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
    return `<div class="ksc-bars" aria-hidden="true">${R.rows.map((r)=> `<i style="height:${lo === hi ? 70 : Math.round(30 + (lo - r.pace) / (lo - hi) * 70)}%"${effortOf(r.pace, R) > 1 ? ` class="e${effortOf(r.pace, R)}"` : ''}></i>`).join('')}</div>`;
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
    prepare(x);
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
  // The session a day page shows in full: the one picked, else (one session, or a laptop with room beside the list)
  // the day's main one. null on a phone with several sessions (they open on their own pages).
  function shownOf(x, selKey, wide){
    const ss = x?.sessions || [];
    return sessionOf(x, selKey) || (ss.length === 1 || wide ? mainSession(x) || ss[0] || null : null);
  }
  function dayHtml(x, selKey, wide){
    prepare(x);
    const ss = x?.sessions || [];
    const sel = shownOf(x, selKey, wide);
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
  // One card per set; set: { n, of } when the session has more than one.
  function repCard(s, R, set){
    const lo = R.slow.pace, hi = R.fast.pace;
    const no = (r)=> R.rows.indexOf(r) + 1;
    const h = (r)=> lo === hi ? 70 : Math.round(28 + (lo - r.pace) / (lo - hi) * 72);
    const work = R.work >= 1000 ? `${r1(R.work / 1000)} km of reps` : `${Math.round(R.work)} m of reps`;
    const fourth = R.hr ? `<div><b>${R.hr.first}→${R.hr.last}</b><span class="a">heart rate, bpm</span></div>`
      : `<div><b>${repClock(Math.round((R.same ? R.slow.s - R.fast.s : R.slow.pace - R.fast.pace) * 10) / 10)}</b><span class="a">spread</span></div>`;
    return `<section class="card kr" aria-label="${set ? `Set ${set.n} of ${set.of}` : 'Reps'}">
      <div class="kr-top"><div class="kr-tags"><em class="kr-badge">${set ? `Set ${set.n} of ${set.of}` : esc(s.tag_label || 'Workout')}</em><span>${esc(work)}</span></div>
        <div class="kr-avg e${effortOf(R.avgPace, R)}"><span>Average</span><b>${repAvg(R)}</b></div></div>
      <div class="kr-title"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="14.5" cy="4" r="2"/><path d="M8 21l3-6 3 2v5M6 11l3-3 4 1 2 4 3 1M11 15l-2-3"/></svg><b>${esc(R.label)}</b>${R.rest ? `<span>off ${esc(R.rest)} rest</span>` : ''}</div>
      <div class="kr-plot"><div class="kr-tip" hidden></div>
        <div class="kr-bars" style="--n:${R.rows.length}">${R.rows.map((r, k)=> `<button type="button" class="kr-bar e${effortOf(r.pace, R)}" data-i="${k}" aria-label="Rep ${k + 1}, ${distLabel(r.m, R.track)} in ${repVal(R, r)}, ${EFFORT[effortOf(r.pace, R)]}${r.hr ? ', ' + r.hr + ' bpm' : ''}"><i style="height:${h(r)}%"></i></button>`).join('')}</div></div>
      <div class="kr-axis"><span>Rep 1</span><span>Rep ${R.rows.length}</span></div>
      <div class="kr-stats">
        <div><b>${repVal(R, R.fast)}</b><span class="e${effortOf(R.fast.pace, R)}">fastest · rep ${no(R.fast)}</span></div>
        <div><b>${repAvg(R)}</b><span class="e${effortOf(R.avgPace, R)}">average</span></div>
        <div><b>${repVal(R, R.slow)}</b><span class="e${effortOf(R.slow.pace, R)}">slowest · rep ${no(R.slow)}</span></div>
        ${fourth}</div>
    </section>`;
  }
  // Every rep, set by set; each set's bars are scaled to that set, with its average under it.
  function repTable(R){
    const block = (S, head)=> `${head ? `<div class="kr-sethd"><b>${esc(head)}</b><span>avg ${repAvg(S)}</span></div>` : ''}
      <div class="kd-split hd kr-row"><span>Rep</span><span>${S.same ? 'Time' : 'Dist'}</span><span></span><span>Pace</span><span>HR</span></div>
      ${S.rows.map((r, k)=> `<div class="kd-split kr-row"><span class="m">${k + 1}</span><b>${S.same ? repClock(r.s) : distLabel(r.m, S.track)}</b><span class="bar"><i style="width:${S.slow.pace === S.fast.pace ? 70 : Math.round(30 + (S.slow.pace - r.pace) / (S.slow.pace - S.fast.pace) * 65)}%"></i></span><span>${clock(r.pace)}</span><span class="m">${r.hr ?? ''}</span></div>`).join('')}`;
    return `<h2 class="kv-ct">Every rep</h2>${R.sets ? R.sets.map((S)=> block(S, `Set ${S.n} · ${S.label}`)).join('') : block(R)}`;
  }
  const repCards = (s, R)=> R.sets ? R.sets.map((S)=> repCard(s, S, { n: S.n, of: R.sets.length })).join('') : repCard(s, R);
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

  // Kestrel AI's report. With the runner's own model on run summaries, the app writes it (and can rewrite it).
  function reportHtml(s, busy){
    const t = window.kestrelAiTask?.('summary');
    if(s.manual) return `<div class="kd-eb">${eye}Kestrel AI on this session</div><p class="kv-hint">Logged by hand. Ask Kestrel AI about it in chat.</p>`;
    if(!s.report && t?.serverOwn && !t.own) return `<div class="kd-eb">${eye}Kestrel AI on this session</div><p class="kv-hint">Your run summaries are set to your own model, which this device doesn’t have. Switch them back to Kestrel free, or add your model here in You → Integrate.</p><button type="button" class="sm-btn" data-a="sumKestrel">Use Kestrel free for summaries</button>`;
    const btn = t?.own ? `<button type="button" class="sm-btn" data-a="sessReport" data-v="${esc(s.key)}"${busy ? ' disabled' : ''}>${busy ? 'Writing…' : s.report ? 'Rewrite' : 'Write it'} with ${esc(t.label)}</button>` : '';
    return `<div class="kd-eb">${eye}Kestrel AI on this session</div>${s.report ? `<p>${esc(s.report)}</p>` : `<p class="kv-hint">${t?.own ? 'Not written yet.' : 'Kestrel AI writes this once the run syncs and it reviews your day.'}</p>`}${btn}`;
  }
  async function writeReport(x, key){
    const s = sessionOf(x, key), el = document.getElementById('ksReport');
    if(!s || !el) return;
    el.innerHTML = reportHtml(s, true);
    try{ s.report = await window.kestrelWriteReport(key); }
    catch(e){ el.innerHTML = reportHtml(s) + `<p class="kv-hint">${esc(e.message)}</p>`; return; }
    if(el.isConnected) el.innerHTML = reportHtml(s);
  }
  const autoTried = new Set();

  // inline: part of the day page (no own header row). Otherwise the session's own page.
  function sessionHtml(x, s, inline){
    prepare(x);
    const R = repsOf(s), more = (s.activities || []).flatMap((z)=> z.prs || []);
    const conds = [s.temp_f != null ? `${Math.round(s.temp_f)}°F` : '', s.track ? 'On the track' : ''].filter(Boolean).join(' · ');
    return `<div class="ks ${inline ? 'inline' : ''}" data-key="${esc(s.key)}"><div class="ks-a">
      <section class="card kv-card ks-head">
        <div class="kv-eb">${esc([partOfDay(s.start), timeSpan(s)].filter(Boolean).join(' · '))}${conds ? ' · ' + esc(conds) : ''}</div>
        <div class="kv-ct big">${esc(sessionName(s))}</div>
        ${more.length ? `<div class="kdd-chips">${more.map((p)=> `<span class="kdd-chip pr">PR · ${esc(p.label)} ${esc(p.time)}</span>`).join('')}</div>` : ''}
        ${sessionStats(s)}${notchesHtml(s.effort)}
      </section>
      ${R ? repCards(s, R) : ''}
      ${partsHtml(s)}
      <section class="card kv-card kd-aicard" id="ksReport">${reportHtml(s)}</section>
      <section class="card kv-card ks-shoes" id="ksShoes" hidden></section>
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
    prepare(x);
    const s = sessionOf(x, key) || mainSession(x);
    const box = document.querySelector('.ks');
    if(!s || !box) return;
    wireReps(box, repsOf(s));
    // Which shoes each run counts toward (your own log only).
    if(own && (window.kMods ? window.kMods.has('shoes') : true)){
      const acts = (s.activities || []).filter((z)=> z.id && z.category !== 'crosstrain');
      window.kShoes?.picker(document.getElementById('ksShoes'), acts.map((z)=> ({ id: z.id, label: `${acts.length > 1 ? (ROLE[z.role] || KIND[z.category] || 'Run') + ' · ' : ''}${r2(z.miles || 0)} mi` })));
    }
    // Own model on summaries: write a missing report once, the first time the session opens.
    if(own && !s.report && window.kestrelAiTask?.('summary').own && !autoTried.has(s.key)){ autoTried.add(s.key); writeReport(x, s.key); }
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
    // Laps the runner typed or corrected are their word on the run: they show instead of the route's mile splits.
    const typed = typedLaps(s);
    const rows = r && !typed.length ? mileSplits(r.pts) : [];
    const html = typed.length ? typed.map((a)=> lapsHtml(a.laps, typed.length > 1 || runActs(s).length > 1 ? `${ROLE[a.role] || KIND[a.category] || 'Run'} · laps` : 'Laps')).join('')
      : rows.length ? splitsHtml(rows, 'Splits') : lapsHtml(s.splits || []);
    if(html && splitsEl){ splitsEl.innerHTML = html; splitsEl.hidden = false; }
  }
  const typedLaps = (s)=> (s.activities || []).filter((a)=> a.category !== 'crosstrain' && (a.laps || []).some((l)=> l.f === 2));

  // Tap (or point at) a rep to read it out above its bar.
  function wireReps(box, all){
    if(!all) return;
    const cards = [...box.querySelectorAll('.kr')];
    (all.sets || [all]).forEach((R, n)=> cards[n] && wireCard(cards[n], R));
  }
  function wireCard(box, R){
    const tip = box.querySelector('.kr-tip'); if(!tip || !R) return;
    const show = (b)=>{
      const r = R.rows[+b.dataset.i]; if(!r) return;
      box.querySelectorAll('.kr-bar.on').forEach((x)=> x.classList.remove('on')); b.classList.add('on');
      tip.innerHTML = `<b>Rep ${+b.dataset.i + 1}</b> ${esc(distLabel(r.m, R.track))} · ${repClock(r.s)}${R.same ? '' : ` · ${clock(r.pace)}/mi`}${r.hr ? ` · ${r.hr} bpm` : ''}${r.rest ? ` · ${esc(r.rest)} rest` : ''}`;
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
  // Pace (s/mi) at each point over about a tenth of a mile around it. Null where the runner stood still.
  function paceSeries(r){
    const n = r.pts.length, t = r.pts.map((p)=> p[3]), out = new Array(n).fill(null);
    if(t[0] == null) return out;
    let a = 0, b = 0;
    for(let i = 0; i < n; i++){
      while(r.ds[a] < r.ds[i] - 80) a++;
      while(b < n - 1 && r.ds[b] < r.ds[i] + 80) b++;
      const dd = r.ds[b] - r.ds[a], dt = (t[b] ?? 0) - (t[a] ?? 0);
      if(dd > 40 && dt > 0){ const v = dt / (dd / MI); if(v < 1200) out[i] = v; }
    }
    return out;
  }
  function chartHtml(r){
    const tot = r.ds[r.ds.length - 1] || 1, X = (d)=> (d / tot * CW).toFixed(1);
    const alts = r.pts.map((p)=> p[2]).filter((v)=> v != null), lo = Math.min(...alts), hi = Math.max(lo + 8, ...alts);
    const hrs = r.pts.map((p)=> p[4]).filter(Boolean), hlo = Math.min(...hrs) - 5, hhi = Math.max(hlo + 20, ...hrs) + 3;
    const ay = (a)=> (CH - 12 - (a - lo) / (hi - lo) * (CH * 0.55)).toFixed(1);
    const hy = (v)=> (CH - 12 - (v - hlo) / (hhi - hlo) * (CH - 28)).toFixed(1);
    let grid = ''; for(let m = 1; m * MI < tot; m++) grid += `M${X(m * MI)} 0V${CH - 10}`;
    const elev = r.hasAlt ? r.pts.map((p, i)=> `${X(r.ds[i])} ${ay(p[2] ?? lo)}`).join(' L') : '';
    const hr = r.hasHr ? r.pts.map((p, i)=> p[4] ? `${X(r.ds[i])} ${hy(p[4])}` : null).filter(Boolean).join(' L') : '';
    const pc = paceSeries(r), pv = pc.filter((v)=> v != null).sort((x, y)=> x - y);
    r.pace = pc; r.hasPace = pv.length > r.pts.length / 3;
    let pace = '';
    if(r.hasPace){
      const plo = pv[Math.floor(pv.length * 0.03)], phi = Math.max(plo + 30, pv[Math.floor(pv.length * 0.97)]);
      const py = (v)=> (CH - 12 - (phi - Math.min(phi, Math.max(plo, v))) / (phi - plo) * (CH - 28)).toFixed(1); // quicker is higher
      pace = pc.map((v, i)=> v == null ? null : `${X(r.ds[i])} ${py(v)}`).reduce((d, pt, i, arr)=> pt ? d + (i && arr[i - 1] ? 'L' : 'M') + pt : d, '');
    }
    const miles = Math.floor(tot / MI);
    const what = ['Elevation', r.hasHr ? 'heart rate' : null, r.hasPace ? 'pace' : null].filter(Boolean);
    const title = what.length > 1 ? what.slice(0, -1).join(', ') + ' &amp; ' + what[what.length - 1] : what[0];
    return `<div class="kd-chart-h"><h2 class="kv-ct">${title}</h2><span class="kd-sub">↑${Math.round(r.stats.gain_m * FT)} ft · ↓${Math.round(r.stats.loss_m * FT)} ft</span></div>
      <div class="kd-keys"><span><i class="ke"></i>Elevation</span>${r.hasHr ? '<span><i class="kh"></i>Heart rate</span>' : ''}${r.hasPace ? '<span><i class="kp"></i>Pace</span>' : ''}</div>
      <div class="kd-read" id="kdRead">Point at the chart to read a spot on the run.</div>
      <div class="kd-plot"><svg viewBox="0 0 ${CW} ${CH}" preserveAspectRatio="none" role="img" aria-label="${what.join(', ').toLowerCase()} along the run, ${Math.round(lo * FT)} to ${Math.round(hi * FT)} feet">
        <path d="${grid}" class="kd-grid"/>
        ${elev ? `<path d="M0 ${CH - 10} L${elev} L${CW} ${CH - 10} Z" class="kd-elev"/>` : ''}
        ${pace ? `<path d="${pace}" class="kd-pace"/>` : ''}
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
  function lapsHtml(laps, title = 'Laps'){
    const rows = (laps || []).filter((l)=> l.m && l.s).map((l)=> ({ label: l.m >= 1000 ? (l.m / MI).toFixed(2) + ' mi' : Math.round(l.m) + ' m', pace: l.s / (l.m / MI), hr: l.hr || null, elev: null }));
    return rows.length ? splitsHtml(rows, esc(title)).replace('<span>Mile</span>', '<span>Lap</span>') : '';
  }

  // ---------------------------------------------------------------- editing
  // Edit keeps the day page as it is and unlocks its boxes: each session's distance and time (each part's, when a
  // session is a warm-up, a workout and a cool-down saved apart), every split, the run type, and the day's own notes.
  // Pace and the day's totals follow as you type; difficulty is scored again on save. E holds what is typed, so a
  // redraw keeps it. Splits belong to one activity each (its own laps), or to the day when they were typed by hand.
  let E = null, TAGS = { builtin: [], custom: [] };
  const setTags = (t)=>{ if(t?.builtin) TAGS = t; };
  const runActs = (s)=> s.manual ? [] : (s.activities || []).filter((a)=> a.category !== 'crosstrain');
  const lapCopy = (ls)=> (ls || []).filter((l)=> l && l.m > 0 && l.s > 0).map((l)=> ({ m: l.m, s: l.s, hr: l.hr || null, rest: l.rest || '' }));
  // Whose splits a session edits: 'day' (typed by hand) or each of its activities.
  const splitKeys = (s)=> s.manual || s.splits_hand ? ['day'] : runActs(s).map((a)=> a.id);
  function startEdit(x){
    prepare(x);
    const acts = {};
    for(const s of x.sessions || []) for(const a of runActs(s)) acts[a.id] = { mi: a.miles ?? null, sec: a.moving_sec ?? (a.minutes != null ? a.minutes * 60 : null), laps: lapCopy(a.laps), tag: a.tag || '' };
    const handReps = !x.locked || x.split_source === 'hand';
    const day = { mi: x.locked ? null : x.miles ?? null, sec: x.locked ? null : x.minutes != null ? Math.round(x.minutes * 60) : null, difficulty: x.locked ? null : x.difficulty ?? null,
      laps: handReps ? lapCopy(x.split_reps) : null, feel: x.feel ?? null, sleep_hours: x.sleep_hours ?? null, strength: !!x.strength, notes: x.notes || '', track: !!x.track, library_id: x.library_id || '' };
    // typedBoxes: distance and time boxes the runner typed in (the laps stop moving those). savedMi: each run's distance
    // as saved, what a save compares against. handLaps: runs whose laps the runner typed. lapsMi: runs whose distance
    // was set from those laps (lapsRule) rather than typed.
    E = { date: x.date, locked: !!x.locked, acts, day, bad: new Set(), typedBoxes: new Set(), base: {}, savedMi: {}, handLaps: new Set(), lapsMi: new Set() };
    for(const s of x.sessions || []) for(const a of runActs(s)){ E.savedMi[a.id] = acts[a.id].mi; if((a.laps || []).some((l)=> l?.f === 2)) E.handLaps.add(a.id); }
    // A run whose typed laps already say otherwise opens at their distance, and saving keeps it (editPayload).
    for(const id of Object.keys(acts)){
      const v = lapsRule(id);
      if(v != null){ acts[id].mi = v; E.lapsMi.add(id); }
      E.base[id] = baseOf(acts[id]);
    }
    E.orig = JSON.stringify({ acts, day });
  }
  // What a run's laps add up to (complete laps only: a split still missing its time doesn't count yet).
  const lapTotals = (ls)=>{ const ok = (ls || []).filter((l)=> l.m > 0 && l.s > 0); return { m: ok.reduce((a, l)=> a + l.m, 0), s: ok.reduce((a, l)=> a + l.s, 0), n: ok.length, all: ok.length === (ls || []).length }; };
  // A run's distance and time when editing began, and whether its laps covered it then (a watch's laps add up to the
  // run). Only then do distance and time follow the laps: fix a 384 m lap to 600 m and the run gains 216 m.
  function baseOf(a){
    const t = lapTotals(a.laps), m = (a.mi || 0) * MI;
    return { mi: a.mi, sec: a.sec, m: t.m, s: t.s, cover: t.n > 0 && m > 0 && a.sec > 0 && nearM(t.m, m) && nearS(t.s, a.sec) };
  }
  // Close enough that laps and run are the same thing (GPS, auto-pause): within 10%, or 80 m and 15 s. The server's
  // rule uses the same numbers (coach.js lapsMiles).
  const nearM = (lapM, runM)=> Math.abs(lapM - runM) <= Math.max(80, runM * 0.1);
  const nearS = (lapS, runS)=> Math.abs(lapS - runS) <= Math.max(15, runS * 0.1);
  // Put a new value in a run's distance or time box (unless the runner is typing in it).
  function setBox(e, id, v){
    document.querySelectorAll(`.kde-on [data-e="${e}"][data-id="${CSS.escape(id)}"]`).forEach((el)=>{
      if(el === document.activeElement) return;
      el.value = e === 'mi' ? (v != null ? r2(v) : '') : runTime(v);
      el.classList.remove('bad'); el.setAttribute('aria-invalid', 'false');
    });
    E.bad.delete([e, id, undefined, NaN].join('|'));
  }
  // After a split changes: the run's distance and time move by as much as its laps did, unless the runner typed them.
  function followLaps(k){
    const a = E.acts[k], b = E.base[k];
    if(!a) return;
    E.handLaps.add(k);
    // Laps that didn't cover the run before: once they take as long as it, the run is what they add up to.
    if(!b?.cover){
      if(E.typedBoxes.has(k + '|mi')) return;
      const v = lapsRule(k);
      if(v != null){ a.mi = v; E.lapsMi.add(k); setBox('mi', k, v); }
      else if(E.lapsMi.delete(k)){ a.mi = E.savedMi[k]; setBox('mi', k, a.mi); }
      return;
    }
    const t = lapTotals(a.laps);
    if(!E.typedBoxes.has(k + '|mi')){ a.mi = Math.max(0.01, Math.round((b.mi + (t.m - b.m) / MI) * 100) / 100); setBox('mi', k, a.mi); }
    if(!E.typedBoxes.has(k + '|sec')){ a.sec = Math.max(1, Math.round(b.sec + (t.s - b.s))); setBox('sec', k, a.sec); }
  }
  // Laps the runner typed that take as long as the run (within 10%, or 15 s) are the run: a watch indoors reads
  // 0.87 mi for 2400 m of reps. The miles they add up to when the saved distance is more than 10% (or 80 m) off, or
  // null. The server applies the same rule (coach.js lapsMiles).
  function lapsRule(k){
    const a = E.acts[k];
    if(!a || !E.handLaps.has(k) || E.typedBoxes.has(k + '|mi')) return null;
    const t = lapTotals(a.laps); if(!t.n || !t.all || !(a.sec > 0)) return null;
    const m = (E.savedMi[k] || 0) * MI;
    if(!nearS(t.s, a.sec) || nearM(t.m, m)) return null;
    return Math.round(t.m / MI * 100) / 100;
  }
  // The laps and the run disagree (the GPS read 0.87 mi for 2400 m of reps): make the run what its laps add up to.
  function useLaps(k){
    const a = E.acts[k]; if(!a) return;
    const t = lapTotals(a.laps); if(!t.n || !t.all) return;
    a.mi = Math.round(t.m / MI * 100) / 100; a.sec = Math.round(t.s);
    E.typedBoxes.delete(k + '|mi'); E.typedBoxes.delete(k + '|sec');
    E.base[k] = { mi: a.mi, sec: a.sec, m: t.m, s: t.s, cover: true };
    setBox('mi', k, a.mi); setBox('sec', k, a.sec);
    live();
  }
  // Do a run's laps and its own distance and time disagree? Beyond what a watch's laps, GPS and auto-pause leave
  // (nearM/nearS, the rule that decides whether laps cover a run), so untouched watch laps never ask.
  function lapsDisagree(k){
    const a = E.acts[k]; if(!a) return null;
    const t = lapTotals(a.laps); if(!t.n || !t.all || !(a.mi > 0) || !(a.sec > 0)) return null;
    const m = a.mi * MI;
    return !nearM(t.m, m) || !nearS(t.s, a.sec) ? t : null;
  }
  // A run with no laps saved shows its GPS mile splits; editing starts from those, and they are saved only if changed.
  async function seedSplits(x){
    const e = E;
    for(const s of x.sessions || []){
      const a = e?.acts[s.main_id];
      if(!a || a.laps.length || s.track || s.splits_hand) continue;
      const r = await loadTrack(s.main_id);
      if(E !== e || !r) continue;
      const laps = mileSplits(r.pts).filter((z)=> z.pace).map((z)=>{ const m = /^\d+$/.test(z.label) ? Math.round(MI) : Math.round(+z.label * MI); return { m, s: Math.round(z.pace * m / MI * 10) / 10, hr: z.hr || null, rest: '' }; });
      if(!laps.length) continue;
      a.laps = laps;
      e.base[s.main_id] = baseOf(a);
      const o = JSON.parse(e.orig); o.acts[s.main_id].laps = JSON.parse(JSON.stringify(laps)); e.orig = JSON.stringify(o);
      redrawSplits(s.main_id);
    }
  }
  // With no date: is an edit on screen now (the background refresh holds off while one is)?
  const editing = (d)=> !!E && (d == null ? !!document.querySelector('#pageV .kde-on') : E.date === d);
  const stopEdit = ()=>{ E = null; };
  const dirty = ()=> !!E && JSON.stringify({ acts: E.acts, day: E.day }) !== E.orig;

  // Typed values. Run time: 45:12, 1:02:03, or minutes (45). Split time: 1:12.4, 72.4, or 245 for 2:45.
  // Split distance: metres (400), or 1 mi, 0.75mi, 1.5k; a bare number under 50 is miles.
  function parseRunTime(v){
    const t = String(v ?? '').trim(); if(!t) return null;
    if(/^\d+(\.\d+)?$/.test(t)) return Math.round(+t * 60);
    const p = t.split(':'); if(p.length > 3 || p.some((x)=> !/^\d+(\.\d+)?$/.test(x))) return NaN;
    return Math.round(p.reduce((a, x)=> a * 60 + +x, 0));
  }
  function parseLapTime(v){
    let t = String(v ?? '').trim(); if(!t) return null;
    if(/^\d{3,4}$/.test(t)) t = `${+t.slice(0, -2)}:${t.slice(-2)}`;
    const p = t.split(':'); if(p.length > 2 || p.some((x)=> !/^\d+(\.\d+)?$/.test(x))) return NaN;
    return Math.round(p.reduce((a, x)=> a * 60 + +x, 0) * 10) / 10;
  }
  function parseLapDist(v){
    const m = String(v ?? '').trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(m|k|km|mi|mile|miles)?$/);
    if(!m) return String(v ?? '').trim() ? NaN : null;
    const n = +m[1], u = m[2];
    return Math.round(u === 'mi' || u === 'mile' || u === 'miles' || (!u && n < 50) ? n * MI : u === 'k' || u === 'km' ? n * 1000 : n);
  }
  const numOr = (v)=>{ const t = String(v ?? '').trim(); return t === '' ? null : Number.isFinite(+t) ? +t : NaN; };
  const lapDist = (m)=> m == null ? '' : m < 1000 || m % 100 === 0 ? String(m) : Math.abs(m / MI - Math.round(m / MI)) < 0.002 ? Math.round(m / MI) + ' mi' : (m / MI).toFixed(2) + ' mi';
  const lapTime = (s)=> s == null ? '' : s >= 60 ? `${Math.floor(s / 60)}:${(s % 60).toFixed(Number.isInteger(s) ? 0 : 1).padStart(Number.isInteger(s) ? 2 : 4, '0')}` : String(s);
  const runTime = (s)=> s == null ? '' : clock(s);
  const paceTxt = (sec, mi)=> sec > 0 && mi > 0.05 ? clock(sec / mi) : '–';

  // What a session adds up to while editing.
  function sessTotals(s){
    if(s.manual) return { mi: E.day.mi, sec: E.day.sec };
    const as = runActs(s);
    return { mi: as.reduce((a, z)=> a + (E.acts[z.id]?.mi || 0), 0), sec: as.reduce((a, z)=> a + (E.acts[z.id]?.sec || 0), 0) };
  }
  function dayTotals(x){
    if(!E.locked) return { mi: E.day.mi, sec: E.day.sec };
    const all = Object.values(E.acts);
    return { mi: all.reduce((a, z)=> a + (z.mi || 0), 0), sec: all.reduce((a, z)=> a + (z.sec || 0), 0) };
  }
  const lapsFor = (k)=> k === 'day' ? E.day.laps : E.acts[k]?.laps;

  const inBox = (attrs, val, unit, label, mode = 'decimal')=> `<label class="kde-box"><input class="kde-in" ${attrs} inputmode="${mode}" autocomplete="off" value="${esc(val)}" aria-label="${esc(label)}">${unit ? `<i>${unit}</i>` : ''}</label>`;
  function typePick(s){
    const id = s.main_id; if(!id || !E.acts[id]) return '';
    const cur = E.acts[id].tag;
    const opt = (v, l)=> `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`;
    return `<label class="kde-type"><span>Run type</span><select class="kde-in" data-e="tag" data-id="${esc(id)}">${opt('', s.tag ? 'Auto (Kestrel decides by pace)' : `Auto · ${KIND[s.category] || 'Run'}`)}${TAGS.builtin.map((t)=> opt(t.id, t.label)).join('')}${(TAGS.custom || []).map((t)=> opt(t.name, t.name)).join('')}</select></label>`;
  }
  function editStats(s){
    const as = runActs(s), one = s.manual ? 'day' : as.length === 1 ? as[0].id : null, t = sessTotals(s);
    const src = one === 'day' ? E.day : one ? E.acts[one] : null;
    const dist = src ? inBox(`data-e="mi" data-id="${esc(one)}"`, src.mi != null ? r2(src.mi) : '', 'mi', 'Distance in miles')
      : `<b data-o="smi" data-k="${esc(s.key)}">${r2(t.mi || 0)}<i> mi</i></b>`;
    const time = src ? inBox(`data-e="sec" data-id="${esc(one)}"`, runTime(src.sec), '', 'Moving time', 'text')
      : `<b data-o="ssec" data-k="${esc(s.key)}">${t.sec ? clock(t.sec) : '–'}</b>`;
    const diff = s.manual ? `<label class="kde-box"><select class="kde-in" data-e="difficulty" data-id="day" aria-label="Difficulty, 1 to 10"><option value="">–</option>${Array.from({ length:10 }, (_, i)=> `<option${E.day.difficulty === i + 1 ? ' selected' : ''}>${i + 1}</option>`).join('')}</select><i>/10</i></label>` : null;
    return `<div class="kd-stats kde-stats">
      <div class="kd-stat"><span>Distance</span>${dist}</div>
      <div class="kd-stat"><span>Time</span>${time}</div>
      <div class="kd-stat"><span>Pace</span><b data-o="space" data-k="${esc(s.key)}">${paceTxt(t.sec, t.mi)}<i>/mi</i></b></div>
      <div class="kd-stat"><span>${s.manual ? 'Difficulty' : 'Effort'}</span>${diff || `<b>${s.effort ?? '–'}${s.effort ? '<i>/10</i>' : ''}</b>`}</div>
      ${stat('Avg HR', s.avg_hr, ' bpm')}
      ${s.track ? stat('Where', 'Track') : stat('Elev gain', s.elev_ft != null ? Math.round(s.elev_ft) : null, ' ft')}</div>`;
  }
  function editParts(s){
    const as = runActs(s);
    if(as.length < 2) return '';
    return `<section class="card kv-card ks-parts kde-parts"><h2 class="kv-ct">Parts</h2>
      ${as.map((z)=> `<div class="ks-part"><span class="m">${esc(ampm(z.start))}</span><b>${esc(ROLE[z.role] || KIND[z.category] || 'Run')}</b>
        ${inBox(`data-e="mi" data-id="${esc(z.id)}"`, E.acts[z.id].mi != null ? r2(E.acts[z.id].mi) : '', 'mi', `${ROLE[z.role] || 'Run'} distance in miles`)}
        ${inBox(`data-e="sec" data-id="${esc(z.id)}"`, runTime(E.acts[z.id].sec), '', `${ROLE[z.role] || 'Run'} moving time`, 'text')}
        <span data-o="apace" data-id="${esc(z.id)}">${paceTxt(E.acts[z.id].sec, E.acts[z.id].mi)}<i>/mi</i></span></div>`).join('')}</section>`;
  }
  function splitRowsHtml(k){
    const ls = lapsFor(k) || [];
    return `${ls.length ? `<div class="kd-split hd kde-row"><span>#</span><span>Distance</span><span>Time</span><span>Pace</span><span>HR</span><span></span></div>` : '<p class="kv-hint">No splits saved for this run yet.</p>'}
      ${ls.map((l, i)=> `<div class="kd-split kde-row"><span class="m">${i + 1}</span>
        ${inBox(`data-e="lm" data-k="${esc(k)}" data-i="${i}"`, lapDist(l.m), '', `Split ${i + 1} distance`, 'text')}
        ${inBox(`data-e="ls" data-k="${esc(k)}" data-i="${i}"`, lapTime(l.s), '', `Split ${i + 1} time`, 'text')}
        <span data-o="lpace" data-k="${esc(k)}" data-i="${i}">${l.m > 0 && l.s > 0 ? clock(l.s / (l.m / MI)) : '–'}</span>
        ${inBox(`data-e="lh" data-k="${esc(k)}" data-i="${i}"`, l.hr ?? '', '', `Split ${i + 1} heart rate`, 'numeric')}
        <button type="button" class="kde-x" data-a="kdeDel" data-v="${esc(k)}|${i}" aria-label="Remove split ${i + 1}">×</button></div>`).join('')}
      <div class="kde-foot"><button type="button" class="sm-btn" data-a="kdeAdd" data-v="${esc(k)}">+ Add split</button><span class="kv-hint" data-o="lsum" data-k="${esc(k)}">${lapSum(k)}</span></div>`;
  }
  // The splits' total, and when it disagrees with the run's own distance or time, a button to use the splits'.
  function lapSum(k){
    const t = lapTotals(lapsFor(k));
    if(!t.n) return '';
    const sum = `Splits add up to ${r2(t.m / MI)} mi in ${clock(t.s)}.`;
    const a = E.acts[k];
    if(k !== 'day' && E.lapsMi.has(k) && !E.typedBoxes.has(k + '|mi')) return esc(`${sum} The watch read ${r2(E.savedMi[k])} mi, so the run counts your splits’ ${r2(a.mi)} mi.`);
    if(k === 'day' || !lapsDisagree(k)) return esc(sum);
    return `${esc(sum)} This run reads ${r2(a.mi)} mi in ${clock(a.sec)}. <button type="button" class="sm-btn kde-use" data-a="kdeUseLaps" data-v="${esc(k)}">Use ${r2(t.m / MI)} mi · ${clock(t.s)}</button>`;
  }
  function editSplits(s){
    const ks = splitKeys(s), as = runActs(s);
    const head = (k)=>{ if(ks.length < 2) return ''; const z = as.find((a)=> a.id === k); return `<div class="kr-sethd"><b>${esc(ROLE[z?.role] || KIND[z?.category] || 'Run')}</b><span>${esc(ampm(z?.start))}</span></div>`; };
    return `<section class="card kv-card kd-splitcard kde-splits"><h2 class="kv-ct">Splits</h2>
      <p class="kv-hint">Every lap, as the watch saved it. Fix a distance or a time, or add the ones it missed.</p>
      ${ks.map((k)=> `${head(k)}<div data-sp="${esc(k)}">${splitRowsHtml(k)}</div>`).join('')}</section>`;
  }
  function sessionEditHtml(x, s, page){
    const conds = [s.temp_f != null ? `${Math.round(s.temp_f)}°F` : '', s.track ? 'On the track' : ''].filter(Boolean).join(' · ');
    const crossOnly = s.category === 'crosstrain';
    return `<div class="ks ${page ? '' : 'inline'} kde" data-key="${esc(s.key)}" id="kde-${esc(s.key.replace(/[^\w-]/g, '_'))}"><div class="ks-a">
      <section class="card kv-card ks-head">
        <div class="kv-eb">${esc([partOfDay(s.start), timeSpan(s)].filter(Boolean).join(' · '))}${conds ? ' · ' + esc(conds) : ''}</div>
        <div class="kv-ct big">${esc(sessionName(s))}</div>
        ${crossOnly ? sessionStats(s) : editStats(s)}${crossOnly ? '' : typePick(s)}
      </section>
      ${crossOnly ? '' : editParts(s)}
      </div><div class="ks-b">${crossOnly ? '' : editSplits(s)}</div></div>`;
  }
  // The day's own fields, under its summary.
  function dayEditHtml(x, lib){
    const d = E.day, opts = (n, cur)=> `<option value="">–</option>${Array.from({ length:n }, (_, i)=> `<option${cur === i + 1 ? ' selected' : ''}>${i + 1}</option>`).join('')}`;
    return `<section class="card kv-card kde-day"><h2 class="kv-ct">How it went</h2>
      <div class="kde-grid">
        <label><span>Felt (1-10)</span><select class="kde-in" data-e="feel">${opts(10, d.feel)}</select></label>
        <label><span>Sleep (hours)</span><input class="kde-in" data-e="sleep_hours" inputmode="decimal" value="${esc(d.sleep_hours ?? '')}"></label>
      </div>
      ${lib?.workouts?.length ? `<label><span>Workout from the library</span><select class="kde-in" data-e="library_id"><option value="">None</option>${lib.workouts.map((w)=> `<option value="${esc(w.id)}"${w.id === d.library_id ? ' selected' : ''}>${esc(w.name)}</option>`).join('')}</select></label>` : ''}
      <label class="kde-check"><input type="checkbox" class="kde-in" data-e="strength"${d.strength ? ' checked' : ''}><span>Did strength or core</span></label>
      <label class="kde-check"><input type="checkbox" class="kde-in" data-e="track"${d.track ? ' checked' : ''}><span>On the track <i>${E.locked ? 'The workout snaps to the lines: reps to 100 m, miles to eighths.' : 'Reps round to the nearest 100 m.'}</i></span></label>
      <label><span>Notes</span><textarea class="kde-in" data-e="notes" rows="3" maxlength="2000" placeholder="How it felt, the weather, anything to remember">${esc(d.notes)}</textarea></label>
    </section>`;
  }
  function dayEditStats(x){
    const t = dayTotals(x), ss = runs(x), lv = levelOf(totals(x).difficulty);
    return `<div class="kdd-stats">
      <div class="kd-stat"><span>Miles</span><b data-o="dmi">${t.mi != null ? r2(t.mi) : '–'}</b></div>
      <div class="kd-stat"><span>Time</span><b data-o="dsec">${t.sec ? clock(t.sec) : '–'}</b></div>
      ${stat(ss.length === 1 ? 'Session' : 'Sessions', ss.length || '–')}
      <div class="kd-stat"><span>Difficulty</span>${totals(x).difficulty ? `<em class="kd-pill l${lv}"><b>${totals(x).difficulty}</b>${LEVEL[lv]}</em>` : '<b>–</b>'}</div></div>`;
  }
  // The day page with its boxes unlocked: the same summary, then every session open, one under the other.
  function dayEditHtml2(x, wide, lib){
    prepare(x);
    const ss = x?.sessions || [];
    const sum = `<section class="card kv-card kdd-sum">
        <div class="kd-eb">${eye}Day summary · editing</div>
        ${daySentence(x) ? `<p class="kdd-line big">${esc(daySentence(x))}</p>` : ''}
        ${dayEditStats(x)}
        <p class="kv-hint">Difficulty, load and run type are scored again from what you save.</p>
      </section>`;
    const list = wide && ss.length > 1 ? `<section class="kdd-list"><h3 class="kdd-h">${ss.length} sessions</h3>${ss.map((s)=> sessionCard(s, false)).join('').replaceAll('data-a="sess"', 'data-a="kdeJump"')}</section>` : '';
    const edits = ss.map((s)=> sessionEditHtml(x, s)).join('');
    if(wide) return `<div class="kdd wide kde-on"><div class="kdd-side">${sum}${dayEditHtml(x, lib)}${list}</div><div class="kdd-main">${edits}</div></div>`;
    return `<div class="kdd kde-on">${sum}${edits}${dayEditHtml(x, lib)}</div>`;
  }
  // One session's page with its boxes unlocked: its distance and time (each part's), its splits and its run type.
  // The day's own fields stay on Edit day.
  function sessionEditPage(x, key){
    prepare(x);
    const s = sessionOf(x, key);
    return s ? `<div class="kde-on kde-one">${sessionEditHtml(x, s, true)}</div>` : '';
  }

  // Typing: keep E current and the numbers that follow from it (pace, totals) in step, without redrawing the inputs.
  function onInput(el){
    if(!E) return;
    const k = el.dataset.e, id = el.dataset.id, lk = el.dataset.k, i = +el.dataset.i;
    let bad = false;
    if(k === 'mi' || k === 'sec'){
      const v = k === 'mi' ? numOr(el.value) : parseRunTime(el.value);
      bad = Number.isNaN(v) || (v != null && v <= 0);
      const tgt = id === 'day' ? E.day : E.acts[id];
      if(tgt && !bad) tgt[k] = v;
      // Typed by hand: the laps stop moving it.
      if(id !== 'day') E.typedBoxes.add(id + '|' + k);
    } else if(k === 'lm' || k === 'ls' || k === 'lh'){
      const l = lapsFor(lk)?.[i]; if(!l) return;
      const v = k === 'lm' ? parseLapDist(el.value) : k === 'ls' ? parseLapTime(el.value) : numOr(el.value);
      bad = Number.isNaN(v) || (v != null && (k === 'lh' ? v < 30 || v > 250 : v <= 0));
      if(!bad) l[k === 'lm' ? 'm' : k === 'ls' ? 's' : 'hr'] = v;
      if(!bad && k !== 'lh') followLaps(lk);
    } else if(k === 'tag') E.acts[id].tag = el.value;
    else if(k === 'difficulty' || k === 'feel') E.day[k] = el.value ? +el.value : null;
    else if(k === 'sleep_hours'){ const v = numOr(el.value); bad = Number.isNaN(v) || (v != null && (v < 0 || v > 24)); if(!bad) E.day.sleep_hours = v; }
    else if(k === 'strength' || k === 'track') E.day[k] = el.checked;
    else if(k === 'notes' || k === 'library_id') E.day[k] = el.value;
    el.classList.toggle('bad', bad); el.setAttribute('aria-invalid', String(bad));
    const key = [k, id, lk, i].join('|');
    if(bad) E.bad.add(key); else E.bad.delete(key);
    live();
  }
  function live(){
    const root = document.querySelector('.kde-on'); if(!root || !E) return;
    const x = E.x;
    root.querySelectorAll('[data-o]').forEach((o)=>{
      const t = o.dataset.o;
      if(t === 'dmi' || t === 'dsec'){ const d = dayTotals(x); o.textContent = t === 'dmi' ? (d.mi != null ? r2(d.mi) : '–') : d.sec ? clock(d.sec) : '–'; }
      else if(t === 'smi' || t === 'ssec' || t === 'space'){
        const s = sessionOf(x, o.dataset.k); if(!s) return; const v = sessTotals(s);
        if(t === 'smi') o.innerHTML = `${r2(v.mi || 0)}<i> mi</i>`; else if(t === 'ssec') o.textContent = v.sec ? clock(v.sec) : '–'; else o.innerHTML = `${paceTxt(v.sec, v.mi)}<i>/mi</i>`;
      } else if(t === 'apace'){ const a = E.acts[o.dataset.id]; if(a) o.innerHTML = `${paceTxt(a.sec, a.mi)}<i>/mi</i>`; }
      else if(t === 'lpace'){ const l = lapsFor(o.dataset.k)?.[+o.dataset.i]; if(l) o.textContent = l.m > 0 && l.s > 0 ? clock(l.s / (l.m / MI)) : '–'; }
      else if(t === 'lsum'){ const h = lapSum(o.dataset.k); if(o.innerHTML !== h) o.innerHTML = h; }
    });
  }
  function addSplit(k){
    const ls = lapsFor(k); if(!ls) return;
    if(ls.length >= 40) return alert('A run holds at most 40 splits.');
    ls.push({ m: ls.length ? ls[ls.length - 1].m : 1609, s: null, hr: null, rest: '' });
    redrawSplits(k);
    document.querySelector(`.kde-on [data-e="ls"][data-k="${CSS.escape(k)}"][data-i="${ls.length - 1}"]`)?.focus();
  }
  function delSplit(k, i){ const ls = lapsFor(k); if(!ls) return; ls.splice(i, 1); [...E.bad].filter((b)=> b.includes(`|${k}|`)).forEach((b)=> E.bad.delete(b)); followLaps(k); redrawSplits(k); }
  function redrawSplits(k){ const el = document.querySelector(`.kde-on [data-sp="${CSS.escape(k)}"]`); if(el) el.innerHTML = splitRowsHtml(k); live(); }

  // What changed, ready for /api/log/edit. -> { error } or { runs, tags, fields, track }
  function editPayload(){
    if(!E) return null;
    if(E.bad.size) return { error: 'Some boxes don’t read as a number or a time. They’re outlined in red.' };
    const o = JSON.parse(E.orig), runs = [], tags = [], fields = {};
    const lapsOut = (ls)=> ls.map((l)=> ({ m: l.m, s: l.s, hr: l.hr || null, rest: l.rest || '' }));
    const half = (ls)=> (ls || []).some((l)=> !(l.m > 0) || !(l.s > 0));
    for(const [id, a] of Object.entries(E.acts)){
      const b = o.acts[id], e = { strava_id: id };
      // Against the distance as saved: a run that opened at its typed laps' distance (lapsRule) saves it.
      if(a.mi !== (id in E.savedMi ? E.savedMi[id] : b.mi)) e.distance_mi = a.mi;
      if(a.sec !== b.sec) e.moving_sec = a.sec;
      if(JSON.stringify(a.laps) !== JSON.stringify(b.laps)){ if(half(a.laps)) return { error: 'Every split needs a distance and a time (or remove it).' }; e.laps = lapsOut(a.laps); }
      if(e.distance_mi === null || e.moving_sec === null) return { error: 'A run needs a distance and a time.' };
      if(Object.keys(e).length > 1) runs.push(e);
      if(a.tag !== b.tag) tags.push({ strava_id: id, tag: a.tag });
    }
    const d = E.day, b = o.day;
    if(!E.locked){
      if(d.mi !== b.mi) fields.manual_miles = d.mi;
      if(d.sec !== b.sec) fields.minutes = d.sec != null ? Math.round(d.sec / 6) / 10 : null;
      if(d.difficulty !== b.difficulty) fields.difficulty = d.difficulty;
      if(d.track !== b.track) fields.surface = d.track ? 'track' : '';
    }
    if(d.laps && JSON.stringify(d.laps) !== JSON.stringify(b.laps)){ if(half(d.laps)) return { error: 'Every split needs a distance and a time (or remove it).' }; fields.split_reps = lapsOut(d.laps); }
    for(const k of ['feel', 'sleep_hours', 'strength', 'notes', 'library_id']) if(d[k] !== b[k]) fields[k] = d[k];
    return { runs, tags, fields, track: E.locked && d.track !== b.track ? d.track : null };
  }

  window.KDay = { setFiveK, prepare, writeReport, peekHtml, mountPeek, dayHtml, sessionHtml, mountSession, sessionOf, shownOf, sessionName, repsOf, notchesHtml, levelOf, mileSplits,
    setTags, startEdit(x){ startEdit(x); E.x = x; seedSplits(x); }, editing, stopEdit, dirty, dayEditHtml: dayEditHtml2, sessionEditHtml: sessionEditPage, onInput, addSplit, delSplit, useLaps, editPayload };
  document.addEventListener('input', (e)=>{ const el = e.target.closest('.kde-on .kde-in'); if(el) onInput(el); });
  document.addEventListener('change', (e)=>{ const el = e.target.closest('.kde-on .kde-in'); if(el && (el.tagName === 'SELECT' || el.type === 'checkbox')) onInput(el); });
})();
