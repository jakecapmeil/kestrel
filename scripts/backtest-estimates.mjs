// Estimate backtest: replays each athlete's history day by day, finds every PR the way recomputeFitness does (plus PRs the
// athlete typed with a date), and scores each against the Fitness State computed from only the data before that day.
// The race is an input to every later estimate, so the estimate scored is the one from the day before.
//
//   node scripts/backtest-estimates.mjs <dump dir> [--mode=prs|races] [--undated=include|exclude] [--json=out.json] [--quiet=1]
//
// mode=prs (default): every PR. mode=races: every run labelled a race and every typed dated PR, PR or not; tune on this one,
//   since a PR is by choice a best-ever day and even a perfect model reads optimistic on PR days.
// undated=include (default): typed PRs with no date are taken as run before the watch history starts. exclude: left out.
// Only races and typed PRs are scored. PRs found in unlabelled runs ("hard-run") or inside longer runs ("split") are listed
// and counted, since whether they were real is what the PR search is being tested on.
//
// <dump dir> holds people, workouts, training_days, best_efforts, wellness and events (with person_id and loc_name) as JSON
// arrays, e.g. from `wrangler d1 execute kestrel_db --remote --json --command "SELECT * FROM workouts WHERE ..."`.
// It holds athletes' data: keep it out of the repo.
import fs from 'node:fs';
import path from 'node:path';
import * as F from '../src/train/fitness.js';
import * as C from '../src/train/courses.js';
import * as M from '../src/models.js';

const [dump] = process.argv.slice(2);
const opt = Object.fromEntries(process.argv.slice(3).map((a) => a.replace(/^--/, '').split('=')));
const undated = opt.undated || 'include';
const load = (n) => JSON.parse(fs.readFileSync(path.join(dump, n + '.json'), 'utf8'));
const people = load('people'), workouts = load('workouts'), tdays = load('training_days'), efforts = load('best_efforts'),
  wellness = load('wellness'), events = load('events');
const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const MILE = 1609.344;
const COURSES = new Map(C.BUILTIN_COURSES.map((c) => [c.id, c]));

// Same rule as prsToUpdate in fitness.js.
function prsToUpdate(cur, candidates) {
  const out = {};
  for (const c of candidates) {
    const have = F.parseTime((out[c.event] || cur[c.event])?.time);
    if (have && have <= c.sec + 0.5) continue;
    if (c.fill && cur[c.event] && !cur[c.event].auto && !out[c.event]) continue;
    out[c.event] = { time: F.fmtTime(c.sec, { tenths: c.sec < 180 }), date: c.date, auto: true, fill: !!c.fill, name: c.name, run: c.run, sec: c.sec };
  }
  return out;
}

function inputsAsOf(p, today, prs) {
  const since = addDays(today, -365);
  const ws = workouts.filter((w) => w.person_id === p.id && w.date <= today && w.date >= since);
  const ev = events.filter((e) => e.person_id === p.id && e.date >= since && e.date <= addDays(today, 30));
  const effs = efforts.filter((e) => e.person_id === p.id && e.date && e.date <= today).map((b) => {
    const w = workouts.find((x) => x.person_id === p.id && x.strava_id === 'intervals:' + b.activity_id) || {};
    return { meters: b.meters, sec: b.sec, date: b.date, activity_id: b.activity_id, category: w.category, laps: w.laps, name: w.name, distance_mi: w.distance_mi, elev_gain_ft: w.elev_gain_ft, surface: w.surface, course: w.course, course_id: w.course_id, gps_vc: w.gps_vc, gps_course: w.gps_course, temp_f: w.temp_f, dew_point_f: w.dew_point_f };
  });
  const maxHr = Math.max(0, ...workouts.filter((w) => w.person_id === p.id && w.date <= today).map((w) => w.max_hr || 0)) || null;
  const models = M.modelSet({}, p.sex);
  return {
    person: { ...p, prs: JSON.stringify(prs) }, models, courses: COURSES,
    workouts: ws, days: tdays.filter((d) => d.person_id === p.id && d.date <= today && d.date >= since), maxHr,
    events: ev, meets: new Set(ev.filter((e) => e.type === 'meet').map((e) => e.date)), efforts: effs,
    wellness: wellness.filter((r) => r.person_id === p.id && r.date <= today && r.date >= since).sort((a, b) => a.date.localeCompare(b.date)),
    paceModel: null,
  };
}

function predict(data, inputs, event) {
  const key = Object.keys(F.PR_FOR_ESTIMATE).find((k) => F.PR_FOR_ESTIMATE[k] === event);
  let row = key && data.estimates.find((e) => e.event === key);
  let out = row ? { sec: row.sec, lo: row.lo ?? null, hi: row.hi ?? null } : null;
  const ck = C.parseCourseKey(event);
  if (ck) {
    const fiveK = data.estimates.find((e) => e.event === '5K');
    if (!fiveK) return null;
    const flat = fiveK.sec * Math.pow(ck.m / 5000, 1.06);
    const tracked = (data.course_estimates || []).find((c) => c.key === event);
    const factor = COURSES.get(ck.id)?.factor ?? (ck.id === 'vc' ? 1.055 : 1.025);
    out = { sec: tracked ? tracked.sec : inputs.models.toCourse(ck.id, flat, ck.m, factor), lo: null, hi: null, flat };
  }
  return out;
}

const rows = [];
for (const p of people) {
  const typed = C.normalizePrs(JSON.parse(p.prs || '{}'));
  // Starting PRs: typed ones with no date (variant include) are taken as from before the watch data.
  let prs = {};
  if (undated === 'include') for (const [k, v] of Object.entries(typed)) if (!v.date && !v.auto) prs[k] = { time: v.time };
  const typedDated = Object.entries(typed).filter(([, v]) => v.date && !v.auto);
  const mine = workouts.filter((w) => w.person_id === p.id);
  const dates = [...new Set([...mine.map((w) => w.date), ...typedDated.map(([, v]) => v.date)])].sort();
  for (const day of dates) {
    const newPrs = [];
    // Typed PRs dated today: the athlete raced it.
    for (const [k, v] of typedDated) if (v.date === day) {
      const have = F.parseTime(prs[k]?.time), sec = F.parseTime(v.time);
      if (!have || sec < have - 0.5) newPrs.push({ event: k, sec, source: 'typed', name: v.meet || '' });
    }
    // PRs the app would find in today's runs.
    const today = F.computeFitness(inputsAsOf(p, day, prs), day);
    const found = prsToUpdate(prs, (today.pr_candidates || []).filter((c) => c.date === day));
    for (const [k, v] of Object.entries(found)) if (!newPrs.some((n) => n.event === k)) {
      // A split inside today's race that beat the race's own time: the PR that was raced is the race's time.
      const raced = v.fill && (today.pr_candidates || []).find((c) => c.date === day && c.event === k && !c.fill && mine.find((x) => x.strava_id === c.run)?.category === 'race');
      if (raced) { const have = F.parseTime(prs[k]?.time); if (!have || raced.sec < have - 0.5) newPrs.push({ event: k, sec: raced.sec, source: 'race', name: '' }); continue; }
      const w = mine.find((x) => x.strava_id === v.run);
      newPrs.push({ event: k, sec: v.sec, source: v.fill ? 'split' : w?.category === 'race' ? 'race' : 'hard-run', name: w?.name || v.name });
    }
    if (opt.mode === 'races') {
      newPrs.length = 0;
      for (const [k, v] of typedDated) if (v.date === day) newPrs.push({ event: k, sec: F.parseTime(v.time), source: 'typed', name: v.meet || '' });
      for (const c of (today.pr_candidates || []).filter((c) => c.date === day && !c.fill)) {
        const w = mine.find((x) => x.strava_id === c.run);
        if (w?.category === 'race' && !newPrs.some((n) => n.event === c.event)) newPrs.push({ event: c.event, sec: c.sec, source: 'race', name: w.name });
      }
    }
    // Races mode: the day's PR improvements join the PR state only after the day is scored.
    const better = (k, sec) => { const have = F.parseTime(prs[k]?.time); return !have || sec < have - 0.5; };
    // Found PRs keep auto, as in the app: a later split may replace them, never a typed one.
    const setPr = (k, sec, auto) => { prs[k] = { time: F.fmtTime(sec, { tenths: sec < 180 }), date: day, ...(auto ? { auto: true } : {}) }; };
    const apply = () => { if (opt.mode === 'races') for (const [k, v] of Object.entries(found)) if (better(k, v.sec)) setPr(k, v.sec, true); };
    if (!newPrs.length) { apply(); continue; }
    const prev = addDays(day, -1);
    const prsBefore = JSON.parse(JSON.stringify(prs));
    const inp = inputsAsOf(p, prev, prsBefore);
    const data = F.computeFitness(inp, prev);
    for (const n of newPrs) {
      const pred = data.estimates?.length ? predict(data, inp, n.event) : null;
      rows.push({
        athlete: p.name.split(' ')[0], date: day, event: n.event, source: n.source, name: n.name,
        prev_pr: prs[n.event]?.time || null, actual: Math.round(n.sec * 10) / 10,
        pred: pred ? Math.round(pred.sec * 10) / 10 : null, lo: pred?.lo ?? null, hi: pred?.hi ?? null,
        err_sec: pred ? Math.round((n.sec - pred.sec) * 10) / 10 : null,
        err_pct: pred ? Math.round(((n.sec - pred.sec) / pred.sec) * 1000) / 10 : null,
        in_range: pred?.lo != null ? n.sec >= pred.lo && n.sec <= pred.hi : null,
        basis: data.basis, inputs: (data.lite_inputs || []).length, lite_inputs: data.lite_inputs, prs_before: prsBefore,
      });
      if (opt.mode !== 'races') setPr(n.event, n.sec, n.source !== 'typed');
      else if (n.source === 'typed' && better(n.event, n.sec)) setPr(n.event, n.sec, false);
    }
    apply();
  }
}
if (opt.json) fs.writeFileSync(opt.json, JSON.stringify(rows, null, 1));
const fmt = (s) => (s == null ? '-' : F.fmtTime(s, { tenths: s < 180 }));
if (!opt.quiet) for (const r of rows) console.log([r.athlete.padEnd(6), r.date, r.event.padEnd(15), r.source.padEnd(8), `prev ${String(r.prev_pr ?? '-').padEnd(7)}`, `est ${fmt(r.pred).padEnd(7)}`, `ran ${fmt(r.actual).padEnd(7)}`, `${r.err_sec == null ? '' : (r.err_sec > 0 ? '+' : '') + r.err_sec + 's'}`.padEnd(8), r.err_pct == null ? '' : `${r.err_pct > 0 ? '+' : ''}${r.err_pct}%`, r.in_range == null ? '' : r.in_range ? 'in80' : 'OUT', r.basis].join('  '));
const scored = rows.filter((r) => r.err_pct != null && (r.source === 'race' || r.source === 'typed'));
const detected = rows.filter((r) => r.source === 'hard-run' || r.source === 'split');
console.log(`\ndetected (unlabelled) PRs: ${detected.length} (${detected.map((r) => r.athlete + ' ' + r.event + ' ' + r.date).join(', ')})`);
const mae = scored.reduce((a, r) => a + Math.abs(r.err_pct), 0) / scored.length;
const bias = scored.reduce((a, r) => a + r.err_pct, 0) / scored.length;
console.log(`\nscored ${scored.length} (races + typed) of ${rows.length}: MAE ${mae.toFixed(2)}%  bias ${bias.toFixed(2)}%  mean |sec| ${(scored.reduce((a, r) => a + Math.abs(r.err_sec), 0) / scored.length).toFixed(1)}s`);
