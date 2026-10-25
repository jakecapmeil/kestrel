// Fitness States: an up-to-date read on what each runner can race right now
// (400 through half marathon), a VO2max estimate and recent mileage. Every
// pace in Hawks (workout library, Hawky, the plan) comes from here.
//
// How it's worked out:
//   1. Race-quality efforts: race results from the watch, PRs (with their
//      dates) and a self-entered "current 5K" (only when nothing newer
//      exists), from the last two years. HawksPredict-Lite (pacemodel.js, a
//      small tree model trained on collegiate results) turns them into a time
//      and an 80% range for every event from 400 m to the half marathon. It
//      knows each runner's own speed/endurance shape from their results.
//   2. Race fitness (race VO2max) is read off that model's 1600, 3200 and 5K times;
//      it sets the aerobic training zones. Race paces come straight from the
//      model.
//   3. Only when a runner has no race result at all does the old training-based
//      estimate run (rep sessions, heart rate on steady runs, Garmin VO2max),
//      labelled as a training estimate.
//   4. Mileage: 10K and half estimates are slowed for low weekly mileage,
//      since a race result alone over-predicts long races for low-volume runners.
//
// Every race and hard run is first credited back to a flat course in good
// weather (conditions.js): Van Cortlandt runs ~5.5% slow, other XC courses
// 2.5% plus their hills, and heat by temperature + dew point. Heart rate on
// steady runs is read the same way. PRs stay the raw times.
import { parseReps, snap100 } from './workouts.js';
import { conditionsOf, heatCost, hillCost, XC_FACTOR, VC_RE } from './conditions.js';
// Race models come from Kestrel Lab: whichever the athlete picked for each task (HawksPredict by default).
import { modelSet, pickedModels, SHORT_METERS } from '../models.js';
const Z80 = 1.2816;

const DAY = 86400000;
const MILE = 1609.344;
// Fitness States switched from the race VO2max blend to HawksPredict-Lite on this date.
const LITE_SINCE = '2026-10-22';

export const EVENTS = [
  { key: '400', label: '400m', m: 400 },
  { key: '800', label: '800m', m: 800 },
  { key: '1600', label: '1600m', m: 1600 },
  { key: '3200', label: '3200m', m: 3200 },
  { key: '5K', label: '5K', m: 5000 },
  { key: '10K', label: '10K', m: 10000 },
  { key: 'half', label: 'Half marathon', m: 21097.5 },
];

// Events HawksPredict-Lite was not trained on. HawksPredict-Short estimates them from the Lite
// estimates and any PRs the runner has at these distances; they are offered in the table's edit mode.
export const EXTRA_EVENTS = [
  { key: '100', label: '100m', m: 100, group: 'sprint', short: '100' },
  { key: '200', label: '200m', m: 200, group: 'sprint', short: '200' },
  { key: '600', label: '600m', m: 600, group: 'middle', short: '600' },
  { key: '1000', label: '1000m', m: 1000, group: 'middle', short: '1000' },
  { key: '2000SC', label: '2000m steeple', m: 2000, group: 'steeple', short: 'S2000' },
  { key: '3000SC', label: '3000m steeple', m: 3000, group: 'steeple', short: 'S3000' },
  // The marathon is HawksPredict-Marathon's: from the last 16 weeks of training, not from PRs.
  { key: 'marathon', label: 'Marathon', m: 42195, group: 'long' },
];
// PR events that only HawksPredict-Short reads (a 100 or a steeple time says nothing about the 1600-to-5K model).
const SHORT_M = SHORT_METERS;
const SHORT_OWN = new Set(['100', '200', '600', '1000', 'S2000', 'S3000']);
const PR_NAMES = { 100: '100m', 200: '200m', 400: '400m', 600: '600m', 800: '800m', 1000: '1000m', 1609: 'mile', 3000: '3000m', 5000: '5K', S2000: '2000m steeple', S3000: '3000m steeple' };
const SHORT_ONLY_PR = { '100': '100', '200': '200', '2000 SC': 'S2000', '3000 SC': 'S3000' };

const VC_MILE_2_5 = 2.5 * MILE;
// Which PR each estimate row is compared with. The table reads `pr` off the
// estimate itself, so a new event only needs adding here, in PR_METERS and in
// PR_EVENTS (log.js); scripts/check-pr-events.mjs fails when they disagree.
export const PR_FOR_ESTIMATE = { '100': '100', '200': '200', '400': '400', '600': '600', '800': '800', '1000': '1000', '1600': '1600', '3200': '3200', '5K': '5K', '2000SC': '2000 SC', '3000SC': '3000 SC', vc5k: 'XC 5K', 'vc2.5': 'VC 2.5 mi' };
export const PR_METERS = { '100': 100, '200': 200, '400': 400, '600': 600, '800': 800, '1000': 1000, '1600': 1600, '3200': 3200, '5K': 5000, '2000 SC': 2000, '3000 SC': 3000, 'XC 5K': 5000, 'VC 2.5 mi': VC_MILE_2_5 };

// ------------------------------------------------------------------ Daniels

// Oxygen cost (ml/kg/min) of running at v metres/minute.
export const vo2At = (v) => -4.6 + 0.182258 * v + 0.000104 * v * v;
// Fraction of VO2max sustainable for t minutes.
const pctAt = (t) => 0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t);

export function vo2rOf(meters, sec) {
  if (!(meters > 0 && sec > 0)) return null;
  const t = sec / 60;
  return vo2At(meters / t) / pctAt(t);
}

// Race time (s) for a distance at a given race VO2max. f(t) falls as t grows.
export function timeFor(vo2r, meters) {
  let lo = meters / 1000, hi = meters / 40; // minutes
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (vo2At(meters / mid) / pctAt(mid) > vo2r) lo = mid; else hi = mid;
  }
  return ((lo + hi) / 2) * 60;
}

// Seconds per mile when running at `pct` of race VO2max.
function paceAtPct(vo2r, pct) {
  const a = 0.000104, b = 0.182258, c = -(4.6 + pct * vo2r);
  const v = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
  return (MILE / v) * 60;
}

// ------------------------------------------------------------------ helpers

export function parseTime(s) {
  const m = String(s || '').trim().match(/^(?:(\d{1,2}):)?(?:(\d{1,2}):)?(\d{1,2}(?:\.\d{1,2})?)$/);
  if (!m) return null;
  const parts = [m[1], m[2], m[3]].filter((x) => x !== undefined).map(Number);
  return parts.reduce((acc, p) => acc * 60 + p, 0) || null;
}

export function fmtTime(sec, { tenths = false } = {}) {
  if (!Number.isFinite(sec)) return '';
  if (sec < 60 && tenths) return sec.toFixed(1);
  const total = tenths && sec < 180 ? Math.round(sec * 10) / 10 : Math.round(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = tenths && sec < 180 ? s.toFixed(1).padStart(4, '0') : String(Math.round(s)).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

const fmtPace = (secPerMile) => fmtTime(secPerMile);
const ageDays = (date, today) => Math.max(0, Math.round((Date.parse(today + 'T12:00:00Z') - Date.parse(date + 'T12:00:00Z')) / DAY));
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const round1 = (n) => Math.round(n * 10) / 10;
const recency = (age, halfLife) => Math.pow(0.5, age / halfLife);

// Snap a GPS distance to the race distance it probably was.
function snapDistance(m) {
  for (const d of [1600, MILE, 3200, 5000, 8000, 10000, 21097.5]) if (Math.abs(m - d) / d <= 0.04) return d;
  return m;
}

function addDays(dateKey, n) {
  const d = new Date(dateKey + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ------------------------------------------------------------------ inputs

async function loadInputs(db, personId, today) {
  const since = addDays(today, -365);
  const [person, workouts, days, maxRow, events, efforts, well, model] = await Promise.all([
    db.prepare('SELECT id, prs, five_k_time, five_k_set_at, sex, settings FROM people WHERE id = ?').bind(personId).first(),
    db.prepare(
      `SELECT strava_id, date, name, category, distance_mi, raw_distance_mi, moving_sec, elapsed_sec, avg_hr, max_hr, elev_gain_ft, laps, surface, course, gps_vc, load, temp_f, dew_point_f
       FROM workouts WHERE person_id = ? AND date >= ? ORDER BY date`
    ).bind(personId, since).all(),
    db.prepare(
      'SELECT date, manual_miles, splits, split_reps, surface FROM training_days WHERE person_id = ? AND date >= ?'
    ).bind(personId, since).all(),
    db.prepare('SELECT MAX(max_hr) AS m FROM workouts WHERE person_id = ?').bind(personId).first(),
    // Every event on the athlete's teams, not just meets: where it was says which course a race was on.
    db.prepare(
      `SELECT e.date, e.type, e.title, e.location, e.description, l.name AS loc_name FROM events e
       JOIN team_members tm ON tm.team_id = e.team_id AND tm.person_id = ?
       LEFT JOIN locations l ON l.id = e.location_id WHERE e.date >= ?`
    ).bind(personId, since).all(),
    db.prepare(
      `SELECT b.meters, b.sec, b.date, b.activity_id, w.category, w.laps, w.name, w.distance_mi, w.elev_gain_ft, w.surface, w.course, w.gps_vc, w.temp_f, w.dew_point_f FROM best_efforts b
       LEFT JOIN workouts w ON w.person_id = b.person_id AND w.strava_id = 'intervals:' || b.activity_id WHERE b.person_id = ?`
    ).bind(personId).all(),
    db.prepare('SELECT date, vo2max, resting_hr, ctl, atl FROM wellness WHERE person_id = ? AND date >= ? ORDER BY date').bind(personId, since).all(),
    db.prepare('SELECT cs, d_prime, r2, updated_at FROM pace_models WHERE person_id = ?').bind(personId).first(),
  ]);
  const models = person ? modelSet(await pickedModels(db, personId, person.settings), person.sex) : modelSet();
  return {
    person, models, workouts: workouts.results, days: days.results, maxHr: maxRow?.m || null,
    events: events.results, meets: new Set(events.results.filter((e) => e.type === 'meet').map((e) => e.date)),
    efforts: efforts.results, wellness: well.results, paceModel: model || null,
  };
}

function parsePrs(raw) {
  try { const o = JSON.parse(raw || '{}'); return o && typeof o === 'object' ? o : {}; } catch { return {}; }
}

// Miles per day over a window, from synced runs plus hand-logged days with none.
function milesBetween(workouts, days, from, to) {
  const runDays = new Set();
  let miles = 0;
  let longest = 0;
  for (const w of workouts) {
    if (w.date < from || w.date > to || w.category === 'crosstrain') continue;
    miles += w.distance_mi || 0;
    longest = Math.max(longest, w.distance_mi || 0);
    runDays.add(w.date);
  }
  for (const d of days) {
    if (d.date < from || d.date > to || runDays.has(d.date) || !d.manual_miles) continue;
    miles += d.manual_miles;
    longest = Math.max(longest, d.manual_miles);
  }
  return { miles, longest };
}

// Work reps for a day: the watch laps if there are any, else the split builder.
// Track reps read as the lines.
function repsOf(w, dayRow) {
  const track = w?.surface === 'track' || dayRow?.surface === 'track';
  return rawReps(w, dayRow).map((r) => (track ? { ...r, m: snap100(r.m) } : r));
}

function rawReps(w, dayRow) {
  const out = [];
  try { for (const r of JSON.parse(w?.laps || '[]')) if (r.m > 0 && r.s > 0) out.push({ m: r.m, s: r.s }); } catch { /* ignore */ }
  if (out.length) return out;
  try { for (const r of JSON.parse(dayRow?.split_reps || '[]')) if (r.m > 0 && r.s > 0) out.push({ m: r.m, s: r.s }); } catch { /* ignore */ }
  if (out.length) return out;
  return parseReps(dayRow?.splits || '');
}

// ------------------------------------------------------------------ compute

// Race distances a whole run can count as, by GPS distance (3%).
// 2.5 mi before 4000 m: it's the high school course at Van Cortlandt.
const RACE_METERS = [1600, MILE, 3200, 2 * MILE, 2.5 * MILE, 4000, 5000, 3 * MILE, 6000, 8000, 10000];
function raceDistance(m) {
  for (const d of RACE_METERS) if (Math.abs(m - d) / d <= 0.03) return d;
  return null;
}
// PR events a race distance updates, and the time scaled to that event.
const PR_FOR = { 1600: '1600', [MILE]: '1600', 3200: '3200', [2 * MILE]: '3200', 5000: '5K' };

export function computeFitness({ person, models = modelSet(), workouts, days, maxHr, meets = new Set(), events = [], efforts = [], wellness = [], paceModel = null }, today) {
  const RM = models;
  const sources = [];
  const prs = parsePrs(person?.prs);
  const shortPrs = []; // PRs HawksPredict-Short can use: { ev, sec, age }

  // 1. Max efforts.
  for (const [event, v] of Object.entries(prs)) {
    const m = PR_METERS[event];
    const sec = parseTime(v?.time);
    if (!m || !sec) continue;
    const dated = /^\d{4}-\d{2}-\d{2}$/.test(v?.date || '');
    const age = dated ? ageDays(v.date, today) : 240;
    const shortSrc = SHORT_ONLY_PR[event] ? { ev: SHORT_ONLY_PR[event], sec } : RM.shortSource(m, sec);
    if (shortSrc && !/XC|VC/.test(event)) shortPrs.push({ ...shortSrc, age });
    if (SHORT_ONLY_PR[event]) continue;
    // XC courses run slower than the track. Hawks races are at Van Cortlandt
    // unless the PR says it was somewhere else.
    const onCourse = event === 'XC 5K' || event === 'VC 2.5 mi';
    const vc = event === 'VC 2.5 mi' || (event === 'XC 5K' && (!v?.meet || VC_RE.test(v.meet)));
    const t = onCourse ? (vc ? RM.toFlat('vc', sec) : sec / XC_FACTOR) : sec;
    sources.push({
      kind: 'pr', max: true, event, m, s: t, age, date: dated ? v.date : null,
      quality: (dated ? 0.9 : 0.5) * (onCourse ? 0.8 : 1),
      label: `${event} PR ${v.time}${v.meet ? ` (${v.meet})` : ''}${onCourse ? `: worth ${fmtTime(t)} on a flat course${vc ? ' (Van Cortlandt runs ~5.5% slow)' : ''}` : ''}`,
    });
  }
  // The runner's PR for an estimate row, for the table.
  const prOf = (key) => {
    const event = PR_FOR_ESTIMATE[key];
    const v = event && prs[event];
    return v?.time ? { event, time: v.time, date: v.date || null } : null;
  };
  const fiveK = parseTime(person?.five_k_time);
  if (fiveK) {
    // Entered before the date was recorded: assume about two months old.
    const age = person.five_k_set_at ? Math.round((Date.parse(today + 'T12:00:00Z') - person.five_k_set_at) / DAY) : 60;
    sources.push({ kind: 'manual', max: true, m: 5000, s: fiveK, age: Math.max(0, age), date: null, quality: 0.7, label: `Current 5K you entered (${person.five_k_time})` });
  }

  const hrMax = maxHr && maxHr >= 175 ? maxHr : null;
  // The PR search: every run, whatever it was labelled, that covered a race
  // distance at race effort (a meet, a race label, or 86%+ of max HR).
  const prCandidates = [];
  for (const w of workouts) {
    if (!w.distance_mi || !w.moving_sec || w.category === 'crosstrain') continue;
    const m = raceDistance((w.raw_distance_mi ?? w.distance_mi) * MILE);
    if (!m) continue;
    const hrPct = hrMax && w.avg_hr ? w.avg_hr / hrMax : null;
    const raceDay = w.category === 'race' || meets.has(w.date);
    if (!(hrPct != null ? hrPct >= 0.86 || (raceDay && hrPct >= 0.8) : raceDay)) continue;
    // Nobody stops mid-race: a long pause means a workout with rests.
    if (w.elapsed_sec && w.moving_sec && w.elapsed_sec > w.moving_sec * 1.3) continue;
    // Races are timed gun to finish: elapsed time, unless the watch was left running.
    const t = w.elapsed_sec && w.elapsed_sec <= w.moving_sec * 1.05 ? w.elapsed_sec : w.moving_sec;
    // Credited back to a flat course in good weather.
    const cond = conditionsOf(w, events, { courseFactor: RM.courseFactor });
    const adj = t / cond.factor;
    const credit = cond.factor > 1.004 ? `; ${cond.note}: worth ${fmtTime(adj)} flat and cool` : '';
    const label = `${raceDay ? 'Race' : 'Hard run'} ${m === MILE ? 'mile' : m === 2 * MILE ? '2 mi' : m === 2.5 * MILE ? '2.5 mi' : m === 3 * MILE ? '3 mi' : `${m >= 1000 && m % 1000 === 0 ? m / 1000 + 'K' : m + 'm'}`} in ${fmtTime(t)} (${w.date}${credit})`;
    sources.push({ kind: 'race', max: true, m, s: adj, age: ageDays(w.date, today), date: w.date, quality: raceDay ? 1 : 0.9, label });
    // PRs are the raw time. A cross-country 5K is an XC PR, never a track one.
    if (m === VC_MILE_2_5) {
      // The 2.5 mile course is Van Cortlandt's; it counts there unless the run
      // was somewhere else or on the track.
      if (w.surface !== 'track' && cond.course !== 'xc') prCandidates.push({ event: 'VC 2.5 mi', sec: t, date: w.date, name: 'Van Cortlandt' });
    } else if (cond.course) {
      if (m === 5000) prCandidates.push({ event: 'XC 5K', sec: t, date: w.date, name: cond.course === 'vc' ? 'Van Cortlandt' : w.name || '' });
    } else if (PR_FOR[m]) prCandidates.push({ event: PR_FOR[m], sec: t * (m === MILE ? 1600 / MILE : m === 2 * MILE ? 3200 / (2 * MILE) : 1), date: w.date, name: w.name || '' });
  }

  // Fastest stretches inside any run (intervals.icu's pace curve). Real
  // efforts, but often a split from a longer run, so a little less weight.
  for (const e of efforts) {
    if (!e.sec || !e.meters) continue;
    // Auto-PR: the fastest nonstop time ever recorded at a PR distance (the
    // pace curve is the best unbroken stretch). Raw time, filled only where
    // nobody has typed a PR of their own (see prsToUpdate). A 1600 and above
    // from an interval session is stitched from reps, so it doesn't count.
    const stitched = e.meters >= 1500 && (!e.category || e.category === 'workout' || e.laps); // unknown run: can't rule out reps
    const prEvent = { 400: '400', 800: '800', 1600: '1600', 1609: '1600', 3200: '3200', 5000: '5K' }[e.meters];
    if (prEvent && !stitched) {
      const pc = conditionsOf(e, events, { courseFactor: RM.courseFactor });
      const ev = prEvent === '5K' && pc.course ? 'XC 5K' : prEvent;
      const sec = e.meters === 1609 ? (e.sec * 1600) / 1609.344 : e.sec;
      prCandidates.push({ event: ev, sec, date: e.date || '', name: ev === 'XC 5K' ? (pc.course === 'vc' ? 'Van Cortlandt' : e.name || '') : `best nonstop ${prEvent === '5K' ? '5K' : prEvent + ' m'}`, fill: true });
    }
    // In an interval session the watch's moving time skips the rests, so a
    // "5K" stitched from reps isn't a 5K. Long best efforts count only from
    // continuous runs.
    if (e.meters >= 1500 && (e.category === 'workout' || e.laps)) continue;
    const age = e.date ? ageDays(e.date, today) : 120;
    if (age > 365) continue;
    // Conditions of the run it came from. A short burst is often the downhill
    // part of a hilly run, so only long efforts get the course and hill credit.
    const cond = e.distance_mi ? conditionsOf(e, events, { reps: e.meters < 1500, courseFactor: RM.courseFactor }) : null;
    const factor = !cond ? 1 : e.meters >= 1500 ? cond.factor : 1 + cond.heat;
    const s = e.sec / factor;
    const what = `Fastest ${e.meters === 1609 ? 'mile' : e.meters >= 1000 && e.meters % 1000 === 0 ? e.meters / 1000 + 'K' : e.meters + 'm'} in a run: ${fmtTime(e.sec, { tenths: e.meters <= 800 })}`;
    sources.push({ kind: 'best', max: true, m: e.meters, s, age, date: e.date, quality: e.meters >= 1500 ? 0.7 : 0.6, label: `${what}${e.date ? ` (${e.date}${factor > 1.004 ? `; worth ${fmtTime(s, { tenths: e.meters <= 800 })} flat and cool` : ''})` : ''}` });
  }

  // 2. Training: rep sessions.
  const dayByDate = new Map(days.map((d) => [d.date, d]));
  const seenDates = new Set();
  for (const w of workouts) {
    if (w.category !== 'workout' || seenDates.has(w.date)) continue;
    const reps = repsOf(w, dayByDate.get(w.date)).filter((r) => r.m >= 300 && r.m <= 3300);
    if (reps.length < 2) continue;
    seenDates.add(w.date);
    const work = reps.reduce((a, r) => a + r.m, 0);
    // Heat counts half on reps (Hadley); hills don't, since hill reps are run by effort.
    const secs = reps.reduce((a, r) => a + r.s, 0) / (1 + heatCost(w.temp_f, w.dew_point_f) * 0.5);
    // Reps with recovery are run faster than a continuous race of the same
    // total distance; treat the set as a race of 3/4 of the work.
    const eqM = Math.max(reps[0].m, work * 0.75);
    const eqS = (secs / work) * eqM;
    sources.push({ kind: 'reps', max: false, m: eqM, s: eqS, age: ageDays(w.date, today), date: w.date, quality: 0.45, label: `${reps.length} x ${Math.round(work / reps.length)}m on ${w.date}` });
  }
  for (const d of days) {
    if (seenDates.has(d.date)) continue;
    const reps = repsOf(null, d).filter((r) => r.m >= 300 && r.m <= 3300);
    if (reps.length < 2) continue;
    const work = reps.reduce((a, r) => a + r.m, 0);
    const secs = reps.reduce((a, r) => a + r.s, 0);
    const eqM = Math.max(reps[0].m, work * 0.75);
    sources.push({ kind: 'reps', max: false, m: eqM, s: (secs / work) * eqM, age: ageDays(d.date, today), date: d.date, quality: 0.4, label: `${reps.length} reps logged on ${d.date}` });
  }

  // Training: heart rate on steady runs. Needs a real observed max HR.
  const hrEst = [];
  // Resting HR (median of the last 4 weeks of watch readings) lets the estimate use
  // heart-rate reserve: %HRR matches %VO2 reserve closely (Swain 1997), so it is
  // steadier than %HRmax, whose intercept varies a lot between runners.
  const rhrs = wellness.filter((r) => r.resting_hr && ageDays(r.date, today) <= 28).map((r) => r.resting_hr).sort((a, b) => a - b);
  const rhr = rhrs.length >= 5 ? rhrs[Math.floor(rhrs.length / 2)] : null;
  if (hrMax) {
    for (const w of workouts) {
      if (!w.avg_hr || !w.distance_mi || !w.moving_sec || w.distance_mi < 2.5 || w.moving_sec < 1200) continue;
      if (!['easy', 'long', 'workout', 'recovery'].includes(w.category)) continue;
      if (w.laps && w.category === 'workout') continue; // intervals, not steady
      if ((w.elev_gain_ft || 0) / w.distance_mi > 150) continue;
      const age = ageDays(w.date, today);
      if (age > 56) continue;
      const pHr = w.avg_hr / hrMax;
      if (pHr < 0.65 || pHr > 0.93) continue;
      const useHrr = rhr && rhr >= 35 && rhr < hrMax - 60;
      const pHrr = useHrr ? (w.avg_hr - rhr) / (hrMax - rhr) : null;
      // VO2 at the run's speed = rest (3.5) + %HRR x (VO2max - 3.5), solved for VO2max below.
      const pVo2 = useHrr ? pHrr : (pHr - 0.37) / 0.64;
      if (useHrr && pHrr < 0.4) continue;
      // Heat and hills push heart rate up at a given pace: read the run at
      // the pace it was worth on flat ground in cool weather.
      const worth = (1 + heatCost(w.temp_f, w.dew_point_f)) * (1 + (w.surface === 'track' ? 0 : hillCost(w.elev_gain_ft, w.distance_mi)));
      const v = ((w.distance_mi * MILE) / (w.moving_sec / 60)) * worth;
      hrEst.push({ est: useHrr ? 3.5 + (vo2At(v) - 3.5) / pVo2 : vo2At(v) / pVo2, age, date: w.date });
    }
  }
  if (hrEst.length >= 4) {
    // The median of every steady run, not just the best ones: a hot day or a
    // strap glitch shouldn't move it.
    const all = hrEst.map((x) => x.est).sort((a, b) => a - b);
    const med = all[Math.floor(all.length / 2)];
    const newest = hrEst.reduce((a, b) => (a.date > b.date ? a : b));
    sources.push({ kind: 'hr', max: false, vo2r: med, age: newest.age, date: newest.date, quality: 0.35, label: `Heart rate on ${hrEst.length} steady runs (last 8 weeks, adjusted for heat and hills)` });
  }

  // Garmin's VO2max (heart rate vs speed on steady runs, Firstbeat) tends to
  // run high against race results, and by a different amount for each
  // runner. Scale it by this runner's own ratio, from races run within two
  // weeks of a Garmin reading; it then tracks fitness between races.
  const garmin = wellness.filter((r) => r.vo2max);
  const latestG = garmin[garmin.length - 1];
  let garminRatio = null;
  if (latestG) {
    const gap = (a, b) => Math.abs(Date.parse(a + 'T12:00:00Z') - Date.parse(b + 'T12:00:00Z')) / DAY;
    const ratios = sources.filter((x) => x.date && x.m >= 1500 && (x.kind === 'race' || x.kind === 'pr')).map((x) => {
      const near = garmin.reduce((b, r) => (gap(r.date, x.date) < gap(b.date, x.date) ? r : b), garmin[0]);
      return gap(near.date, x.date) <= 14 ? vo2rOf(x.m, x.s) / near.vo2max : null;
    }).filter(Boolean).sort((a, b) => a - b);
    garminRatio = ratios.length ? ratios[Math.floor(ratios.length / 2)] : null;
    const age = ageDays(latestG.date, today);
    if (age <= 45) {
      sources.push({
        kind: 'watch', max: false, vo2r: latestG.vo2max * (garminRatio || 0.9), age, date: latestG.date, quality: garminRatio ? 0.6 : 0.25,
        label: `Watch VO2max ${round1(latestG.vo2max)}${garminRatio ? `, scaled to your races (x${garminRatio.toFixed(2)})` : ' (not yet matched to a race)'}`,
      });
    }
  }

  for (const s of sources) {
    if (s.vo2r === undefined) s.vo2r = s.m >= 1500 ? vo2rOf(s.m, s.s) : null;
    s.weight = s.quality * recency(s.age, s.max ? 75 : 30);
    // Fitness fades a little each month after the effort, and old results
    // are less certain anyway.
    if (s.vo2r) s.eff = s.vo2r * (1 - clamp((s.age - 28) * 0.0004, 0, 0.06));
  }

  // A recent race outranks older results and the self-entered 5K: older
  // sources fade fast once there's something newer to go on.
  const newestRace = Math.min(...sources.filter((x) => x.kind === 'race' || x.kind === 'pr' && x.date).map((x) => x.age), Infinity);
  for (const x of sources) {
    if (!x.max) continue;
    if (x.kind === 'manual' && newestRace <= 75) x.weight = 0;
    else if (x.age > newestRace + 45) x.weight *= 0.35;
  }

  const wmean = (list) => {
    const w = list.reduce((a, s) => a + s.weight, 0);
    return w > 0 ? { v: list.reduce((a, s) => a + s.eff * s.weight, 0) / w, w, age: list.reduce((a, s) => a + s.age * s.weight, 0) / w } : null;
  };
  // Races show what you can do; a much slower "race" was a hilly course, a
  // bad day or a tempo effort. Drop results more than 3 race VO2max points under
  // the best recent race (last 120 days).
  const recentBest = Math.max(...sources.filter((x) => x.max && x.eff && x.age <= 120 && x.quality >= 0.9).map((x) => x.eff), 0);
  for (const x of sources) if (x.max && x.eff && recentBest && x.eff < recentBest - 3) x.weight = 0;
  const maxSrc = sources.filter((s) => s.max && s.eff && s.weight > 0);
  const M = wmean(maxSrc);
  // Rep sets far below race fitness were easy running the watch split into
  // "intervals", not a real session.
  const subSrc = sources.filter((s) => !s.max && s.eff && (!M || s.kind !== 'reps' || s.eff >= M.v - 8));
  const S = wmean(subSrc);
  for (const x of [...maxSrc, ...subSrc]) x.used = true;
  for (const x of sources) if (x.kind === 'pr' && !x.eff) x.used = true; // 400/800 PRs shape the short estimates

  // HawksPredict-Lite: race-quality efforts (races, PRs, and a self-entered 5K
  // only when nothing newer exists) from the last two years, every one already
  // credited back to a flat, cool course. Splits from runs, rep sets, heart
  // rate and Garmin are not race evidence and stay out. Needs at least one.
  const liteIn = sources.filter((s) => s.max && s.m && s.s && s.age <= 730
    && (s.kind === 'race' || s.kind === 'pr' || (s.kind === 'manual' && newestRace > 75)));
  let lite = null;
  if (liteIn.length) {
    const results = liteIn.map((s) => ({ m: s.m, sec: s.s, surf: 'track' }));
    let by = {};
    for (const e of EVENTS) {
      by[e.key] = RM.raceAny(results, { m: e.m, surf: 'track' });
      if (!by[e.key]) { by = null; break; }
    }
    if (by) {
      // Race fitness (race VO2max) for the aerobic zones: the model's own 1600, 3200 and 5K read.
      const v = ['1600', '3200', '5K'].map((k) => vo2rOf(EVENTS.find((e) => e.key === k).m, by[k].sec));
      lite = { by, vo2r: v.reduce((a, b) => a + b, 0) / v.length };
      // The results that set the estimate count fully; the rest are context.
      const at5k = (s) => s.s * Math.pow(5000 / s.m, 1.06);
      const best = Math.min(...liteIn.map(at5k));
      for (const x of sources) x.used = false;
      for (const x of liteIn) { x.used = true; x.weight = at5k(x) <= best * 1.015 ? 1 : 0.1; }
    }
  }

  // Mileage.
  const cur = milesBetween(workouts, days, addDays(today, -27), today);
  const prev = milesBetween(workouts, days, addDays(today, -55), addDays(today, -28));
  const mpw = round1(cur.miles / 4);
  const mpwPrev = round1(prev.miles / 4);

  let vo2r = null;
  let basis = 'none';
  if (lite) {
    vo2r = lite.vo2r;
    basis = 'hawkspredict';
  } else if (M) {
    vo2r = M.v;
    basis = 'races';
    if (S) {
      // The older the races, the more training is allowed to move the number.
      const pull = clamp((M.age - 45) / 150, 0, 0.6);
      vo2r += (S.v - vo2r) * (S.v > vo2r ? pull : pull * 0.5);
      if (pull > 0.05) basis = 'races+training';
    }
  } else if (S) {
    // Submax only: no race to anchor on, so it's an estimate of an estimate.
    vo2r = S.v;
    basis = 'training';
  }

  if (!vo2r) {
    return {
      as_of: today, basis, vo2r: null, vo2max: latestG ? round1(latestG.vo2max) : null, vo2max_source: latestG ? 'watch' : null,
      confidence: 'none', mpw, mpw_prev: mpwPrev, fitness_score: fitnessScore(workouts, wellness, today), pr_candidates: prCandidates,
      longest_28d: round1(cur.longest), estimates: [], zones: [], cs: null, speed_index: null,
      sources: [], note: 'Add a PR or connect your watch so Hawks can estimate your fitness.',
    };
  }
  vo2r = clamp(vo2r, 20, 85);

  // 3a. Speed/endurance index: the athlete's own exponent between two max
  // efforts a reasonable distance apart vs the exponent Daniels implies.
  let speedIndex = 0;
  const shape = maxSrc.concat(sources.filter((s) => s.max && !s.eff)).filter((s) => s.age <= 400)
    .sort((a, b) => b.weight - a.weight);
  for (let i = 0; i < shape.length && !speedIndex; i++) {
    for (let j = i + 1; j < shape.length; j++) {
      const a = shape[i], b = shape[j];
      if (Math.max(a.m, b.m) / Math.min(a.m, b.m) < 1.9 || Math.abs(a.age - b.age) > 200) continue;
      const [lo, hi] = a.m < b.m ? [a, b] : [b, a];
      const kAth = Math.log(hi.s / lo.s) / Math.log(hi.m / lo.m);
      const loT = lo.m >= 1500 ? timeFor(vo2r, lo.m) : shortFromMile(timeFor(vo2r, 1600), lo.m);
      const kDan = Math.log(timeFor(vo2r, hi.m) / loT) / Math.log(hi.m / lo.m);
      speedIndex = clamp(kAth - kDan, -0.06, 0.06);
      break;
    }
  }

  // 3b. Critical speed from recent efforts of 2-20 minutes.
  // Max efforts only: rep sets are submaximal and flatten the curve.
  const csPts = sources.filter((s) => s.max && s.weight > 0 && s.kind !== 'manual' && s.m && s.s && s.age <= 180 && s.s >= 120 && s.s <= 1200);
  let cs = null;
  if (csPts.length >= 2 && Math.max(...csPts.map((p) => p.m)) / Math.min(...csPts.map((p) => p.m)) >= 1.5) {
    const n = csPts.length;
    const mt = csPts.reduce((a, p) => a + p.s, 0) / n;
    const md = csPts.reduce((a, p) => a + p.m, 0) / n;
    const sxy = csPts.reduce((a, p) => a + (p.s - mt) * (p.m - md), 0);
    const sxx = csPts.reduce((a, p) => a + (p.s - mt) ** 2, 0);
    const speed = sxx > 0 ? sxy / sxx : 0;
    const dPrime = md - speed * mt;
    if (speed > 2.5 && speed < 7 && dPrime > 0 && dPrime < 600) cs = { speed, dPrime };
  }
  // intervals.icu's own critical speed fit of the whole pace curve (every
  // run from the watch) beats a fit to a handful of races when it's good.
  if (paceModel && (paceModel.r2 ?? 1) >= 0.95 && Date.now() - paceModel.updated_at < 21 * DAY) {
    cs = { speed: paceModel.cs, dPrime: paceModel.d_prime, source: 'intervals.icu' };
  }

  const confFor = (meters) => {
    const near = maxSrc.filter((s) => Math.max(s.m, meters) / Math.min(s.m, meters) <= 2.2);
    if (near.some((s) => s.age <= 90 && s.kind !== 'manual')) return 'high';
    if (maxSrc.some((s) => s.age <= 365)) return 'medium';
    return 'low';
  };

  const est = {};
  const mileT = timeFor(vo2r, 1600) * Math.pow(1600 / 5000, speedIndex);
  for (const e of EVENTS) {
    let t = lite ? lite.by[e.key].sec : e.m >= 1500 ? timeFor(vo2r, e.m) * Math.pow(e.m / 5000, speedIndex) : shortFromMile(mileT, e.m);
    if (!lite && cs && e.m >= 1500 && e.m <= 5000) t = 0.7 * t + 0.3 * ((e.m - cs.dPrime) / cs.speed);
    // A recent race or PR at this exact distance is the best evidence there
    // is; the model is pulled toward it (strongly for 400/800, where the
    // aerobic models are weakest).
    for (const s of lite ? [] : sources) {
      if (!s.max || s.kind === 'manual' || s.weight === 0 || Math.abs(s.m - e.m) / e.m > 0.02) continue;
      const w = recency(s.age, 90) * (e.m < 1500 ? 1.5 : 1) * s.quality;
      t = (t + w * s.s * (e.m / s.m)) / (1 + w);
    }
    const raw = t;
    if (e.key === '10K') t *= 1 + clamp((25 - mpw) * 0.0015, 0, 0.05);
    if (e.key === 'half') t *= 1 + clamp((35 - mpw) * 0.003, 0, 0.09);
    const scale = t / raw;
    est[e.key] = { ...e, sec: t, raw, lo: lite ? lite.by[e.key].lo * scale : null, hi: lite ? lite.by[e.key].hi * scale : null };
  }

  // HawksPredict-Short: the events Lite was not trained on. Its sources are Lite's own estimates (a little
  // less exact than a real result, so they carry extra uncertainty) and any PRs at the other short distances.
  if (lite) {
    const fromLite = [];
    for (const k of ['400', '800', '1600', '3200', '5K']) {
      const src = RM.shortSource(est[k].m, est[k].sec);
      // Its own 80% range, as a log-SD: whatever Short derives from it can't be surer than the estimate it started from.
      if (src) fromLite.push({ ...src, extra: Math.log(est[k].hi / est[k].lo) / (2 * Z80), name: est[k].label });
    }
    for (const e of EXTRA_EVENTS) {
      if (!e.short) continue;
      const own = shortPrs.filter((p) => p.ev === e.short).sort((a, b) => a.age - b.age)[0];
      // 400-to-5K PRs are already inside Lite's estimates, so only PRs at the events Short owns count as extra sources.
      const prsUsed = shortPrs.filter((p) => p.ev !== e.short && SHORT_OWN.has(p.ev)).map((p) => ({ ev: p.ev, sec: p.sec, extra: p.age > 365 ? 0.02 : 0.008, name: `${PR_NAMES[p.ev] || p.ev} PR` }));
      const r = RM.shortAny([...fromLite, ...prsUsed], e.short);
      if (!r) continue;
      let mu = Math.log(r.sec);
      let sd = r.sd;
      if (own) {
        // A PR at this exact distance anchors the estimate; the older it is, the less.
        const w = own.age <= 365 ? 0.7 : 0.45;
        mu = w * Math.log(own.sec) + (1 - w) * mu;
        sd = Math.sqrt(((1 - w) * sd) ** 2 + (w * 0.03) ** 2);
      }
      const near = [...fromLite, ...prsUsed].filter((x) => x.ev !== e.short).sort((a, b) => Math.abs(Math.log(SHORT_M[a.ev] / e.m)) - Math.abs(Math.log(SHORT_M[b.ev] / e.m))).slice(0, 3).map((x) => x.name);
      est[e.key] = { ...e, sec: Math.exp(mu), raw: Math.exp(mu), lo: Math.exp(mu - Z80 * sd), hi: Math.exp(mu + Z80 * sd), hw: Z80 * sd, from: own ? [`your ${e.label} PR`, ...near] : near, short: true };
    }
  }

  // HawksPredict-Marathon: from the 16 weeks of running before today (needs 15 running days). Independent of the PR-based models.
  let mar = null;
  try { mar = RM.marathon(workouts, today); } catch (e) { /* never let the marathon row break the rest of Fitness States */ }
  if (mar) {
    est.marathon = { ...EXTRA_EVENTS.find((e) => e.key === 'marathon'), sec: mar.sec, raw: mar.sec, lo: mar.lo, hi: mar.hi, marathon: true,
      from: [...(est.half ? [`your half marathon estimate scaled up would be ${fmtTime(est.half.sec * Math.pow(2, 1.06))}; the training below is what this row follows`] : []), `${mar.run_days} running days in the last 16 weeks`, `${Math.round(mar.feats.wk_mean / (MILE / 1000))} mi a week on average`, `longest run ${Math.round(mar.feats.longest / (MILE / 1000))} mi`] };
  }

  // The same fitness on the team's home course: what to expect at Van
  // Cortlandt (the 5K, and the 2.5-mile course by Riegel from the 5K).
  const vc5 = RM.toCourse('vc', est['5K'].sec);
  const courseEstimates = [
    { key: 'vc5k', label: '5K at Van Cortlandt', meters: 5000, sec: Math.round(vc5 * 10) / 10 },
    { key: 'vc2.5', label: '2.5 mi at Van Cortlandt', meters: 2.5 * MILE, sec: Math.round(vc5 * Math.pow((2.5 * MILE) / 5000, 1.06) * 10) / 10 },
  ].map((c) => ({ ...c, time: fmtTime(c.sec), pace_mi: fmtPace((c.sec / c.meters) * MILE) }));

  // Zones: race paces from the estimates, aerobic zones from race VO2max (Daniels'
  // percentages: easy 62-70%, steady 81%, threshold 88%).
  // Training zones use fitness, not race-readiness: no mileage penalty.
  const perMile = (key) => (est[key].raw / est[key].m) * MILE;
  const zones = [
    { key: 'recovery', label: 'Recovery', sec: [paceAtPct(vo2r, 0.62) + 25, paceAtPct(vo2r, 0.57) + 40] },
    { key: 'easy', label: 'Easy', sec: [paceAtPct(vo2r, 0.7), paceAtPct(vo2r, 0.62)] },
    { key: 'steady', label: 'Steady', sec: paceAtPct(vo2r, 0.81) },
    { key: 'tempo', label: 'Tempo (half pace)', sec: Math.min(perMile('half'), paceAtPct(vo2r, 0.85)) },
    { key: 'threshold', label: 'Threshold', sec: paceAtPct(vo2r, 0.88) },
    ...(cs ? [{ key: 'cv', label: 'Critical velocity', sec: MILE / cs.speed }] : []),
    { key: '10k', label: '10K pace', sec: perMile('10K') },
    { key: '5k', label: '5K pace', sec: perMile('5K') },
    { key: '3200', label: '3200 pace', sec: perMile('3200') },
    { key: 'mile', label: 'Mile pace', sec: perMile('1600') },
    { key: '800', label: '800 pace', sec: perMile('800') },
    { key: '400', label: '400 pace', sec: perMile('400') },
  ].map((z) => ({
    ...z,
    per_mile: Array.isArray(z.sec) ? `${fmtPace(z.sec[0])}-${fmtPace(z.sec[1])}` : fmtPace(z.sec),
    per_400: Array.isArray(z.sec) ? null : fmtTime((z.sec / MILE) * 400, { tenths: z.sec < 330 }),
  }));

  const real = maxSrc.filter((s) => s.kind !== 'manual');
  const overall = real.some((s) => s.age <= 90) ? 'high' : maxSrc.some((s) => s.age <= 365) ? 'medium' : 'low';
  // VO2max: the watch's own number (Garmin or COROS, via intervals.icu) when it sends it; else the same kind
  // of heart-rate estimate Garmin makes; else race fitness.
  const hrV = sources.find((x) => x.kind === 'hr');
  const vo2 = latestG && ageDays(latestG.date, today) <= 45 ? { v: latestG.vo2max, src: 'watch' }
    : hrV ? { v: hrV.vo2r, src: 'heart rate on steady runs' } : { v: vo2r, src: 'your races' };
  return {
    as_of: today,
    basis,
    vo2r: round1(vo2r),
    vo2max: round1(vo2.v),
    vo2max_source: vo2.src,
    garmin_ratio: garminRatio ? Math.round(garminRatio * 100) / 100 : null,
    fitness_score: fitnessScore(workouts, wellness, today),
    pr_candidates: prCandidates,
    model: lite ? `${RM.info.race.name} ${RM.info.race.version}` : null,
    lite_inputs: lite ? liteIn.map((s) => ({ kind: s.kind, m: s.m, sec: Math.round(s.s * 10) / 10, date: s.date })) : [],
    confidence: overall,
    mpw, mpw_prev: mpwPrev, longest_28d: round1(cur.longest),
    model_short: lite ? `${RM.info.short.name} ${RM.info.short.version}` : null,
    model_marathon: est.marathon ? `${RM.info.marathon.name} ${RM.info.marathon.version}` : null,
    estimates: [...EVENTS, ...EXTRA_EVENTS.filter((e) => est[e.key])].map((e) => {
      const x = est[e.key];
      // How sure the model is, as the half-width of its 80% range (+-3% of the time, say), turned into a word.
      const hw = x.lo ? (x.hi - x.lo) / 2 / x.sec : null;
      const wordFor = (h) => (h < 0.04 ? 'high' : h < 0.08 ? 'medium' : 'low');
      // No non-elite sprint data and few real 600 m or steeple marks stand behind these rows, so they never read surer than this
      // unless the runner has a PR at that very event.
      const ownPr = !!prOf(e.key);
      const capWord = (w, top) => (['low', 'medium', 'high'].indexOf(w) > ['low', 'medium', 'high'].indexOf(top) ? top : w);
      const shortWord = (w) => (e.group === 'sprint' ? capWord(w, ownPr ? 'medium' : 'low') : capWord(w, ownPr ? 'high' : 'medium'));
      return {
        event: e.key, label: e.label, meters: e.m, sec: Math.round(x.sec * 10) / 10,
        time: fmtTime(x.sec, { tenths: e.m <= 800 }), pace_mi: fmtPace((x.sec / e.m) * MILE),
        confidence: x.marathon ? wordFor(hw) : x.short ? shortWord(wordFor(hw)) : confFor(e.m),
        pr: prOf(e.key),
        ...(x.lo ? { lo: Math.round(x.lo * 10) / 10, hi: Math.round(x.hi * 10) / 10, range: `${fmtTime(x.lo, { tenths: e.m <= 800 })}-${fmtTime(x.hi, { tenths: e.m <= 800 })}`, plus_minus_pct: Math.round(hw * 1000) / 10 } : {}),
        ...(x.short || x.marathon ? { optional: true, group: e.group, from: x.from } : {}),
      };
    }),
    course_estimates: courseEstimates.map((c) => ({ ...c, pr: prOf(c.key) })),
    zones,
    cs: cs ? { per_mile: fmtPace(MILE / cs.speed), d_prime_m: Math.round(cs.dPrime), source: cs.source || 'your races' } : null,
    speed_index: round1(speedIndex * 100) / 100,
    profile: speedIndex > 0.012 ? 'speed' : speedIndex < -0.012 ? 'endurance' : 'balanced',
    sources: sources
      .filter((s) => s.used && s.weight > 0.02)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 6)
      .map((s) => ({ kind: s.kind, label: s.label, date: s.date, vo2r: s.vo2r ? round1(s.vo2r) : null, weight: Math.round(s.weight * 100) / 100 })),
  };
}

// Fitness score, like Strava's Fitness & Freshness (Banister's model):
// fitness is the 42-day weighted average of daily training load, fatigue the
// 7-day one, and form is fitness minus fatigue. intervals.icu's own numbers
// are used when the sync brings them (they count every activity); otherwise
// Hawks works them out from its load (minutes x effort).
function fitnessScore(workouts, wellness, today) {
  const icu = wellness.filter((r) => r.ctl != null);
  const lastIcu = icu[icu.length - 1];
  const series = [];
  let fitness, fatigue, source;
  if (lastIcu && ageDays(lastIcu.date, today) <= 3) {
    fitness = lastIcu.ctl; fatigue = lastIcu.atl; source = 'intervals.icu';
    icu.filter((r) => r.date >= addDays(today, -55)).forEach((r) => series.push({ date: r.date, fitness: r.ctl }));
  } else {
    const load = new Map();
    workouts.forEach((w) => load.set(w.date, (load.get(w.date) || 0) + (w.load || 0)));
    if (!load.size) return null;
    let ctl = 0, atl = 0;
    for (let i = 364; i >= 0; i--) {
      const d = addDays(today, -i);
      const L = load.get(d) || 0;
      ctl += (L - ctl) / 42;
      atl += (L - atl) / 7;
      if (i <= 55) series.push({ date: d, fitness: round1(ctl) });
    }
    fitness = ctl; fatigue = atl; source = 'Hawks';
  }
  const ago = series.find((p) => p.date >= addDays(today, -28));
  return {
    fitness: Math.round(fitness), fatigue: Math.round(fatigue), form: Math.round(fitness - fatigue), source,
    change_4wk: ago ? Math.round(fitness - ago.fitness) : null,
    trend: series.filter((_, i) => i % 7 === series.length % 7 || i === series.length - 1).map((p) => ({ date: p.date, fitness: Math.round(p.fitness) })),
  };
}

// 400 and 800 from the mile: distance runners hold pace better over short
// races than a single Riegel exponent says, so the exponents are steeper.
function shortFromMile(mileSec, meters) {
  const t800 = mileSec * Math.pow(800 / 1600, 1.12);
  if (meters >= 800) return t800;
  return t800 * Math.pow(meters / 800, 1.15);
}

// ------------------------------------------------------------------ storage

// The PR search runs every time fitness is recomputed (every sync, PR edit
// and log change): any race-effort run faster than the PR on file replaces it.
function prsToUpdate(currentRaw, candidates) {
  const cur = parsePrs(currentRaw);
  const out = {};
  for (const c of candidates) {
    const have = parseTime((out[c.event] || cur[c.event])?.time);
    if (have && have <= c.sec + 0.5) continue;
    // A PR someone typed in stays; the nonstop-best search only fills blanks and Hawks' own finds.
    if (c.fill && cur[c.event] && !cur[c.event].auto && !out[c.event]) continue;
    out[c.event] = { time: fmtTime(c.sec, { tenths: c.sec < 180 }), date: c.date, meet: `Found by Hawks${c.name && !/running$|^run$/i.test(c.name) ? `: ${c.name}` : ''}`, auto: true };
  }
  return out;
}

export async function recomputeFitness(db, personId, today) {
  const inputs = await loadInputs(db, personId, today);
  if (!inputs.person) return null;
  const found = prsToUpdate(inputs.person.prs, computeFitness(inputs, today).pr_candidates || []);
  if (Object.keys(found).length) {
    const prs = { ...parsePrs(inputs.person.prs), ...found };
    await db.prepare('UPDATE people SET prs = ? WHERE id = ?').bind(JSON.stringify(prs), personId).run();
    inputs.person.prs = JSON.stringify(prs);
  }
  const data = computeFitness(inputs, today);
  data.new_prs = Object.entries(found).map(([event, v]) => ({ event, ...v }));
  delete data.pr_candidates;
  const fiveK = data.estimates.find((e) => e.event === '5K');
  // Trend: the 5K estimate four weeks ago, from history.
  const old = await db.prepare(
    'SELECT date, five_k_sec, vdot AS vo2r FROM fitness_history WHERE person_id = ? AND date <= ? ORDER BY date DESC LIMIT 1'
  ).bind(personId, addDays(today, -28)).first();
  // History before the switch to HawksPredict-Lite came from the old method: no trend across the cutover.
  if (old && fiveK && old.date >= LITE_SINCE) {
    data.trend = { five_k_sec_change: Math.round(fiveK.sec - old.five_k_sec), vo2r_change: round1(data.vo2r - old.vo2r), since: addDays(today, -28) };
  }
  await db.batch([
    db.prepare(
      `INSERT INTO fitness_states (person_id, computed_at, data) VALUES (?, ?, ?)
       ON CONFLICT(person_id) DO UPDATE SET computed_at = excluded.computed_at, data = excluded.data`
    ).bind(personId, Date.now(), JSON.stringify(data)),
    ...(data.vo2r ? [db.prepare(
      `INSERT INTO fitness_history (person_id, date, vdot, five_k_sec, mpw) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(person_id, date) DO UPDATE SET vdot = excluded.vdot, five_k_sec = excluded.five_k_sec, mpw = excluded.mpw`
    ).bind(personId, today, data.vo2r, Math.round(fiveK.sec), data.mpw)] : []),
  ]);
  return data;
}

// Cached read; recomputes when older than six hours or on a new day.
export async function getFitness(db, personId, today, { fresh = false } = {}) {
  if (!fresh) {
    const row = await db.prepare('SELECT computed_at, data FROM fitness_states WHERE person_id = ?').bind(personId).first();
    if (row && Date.now() - row.computed_at < 6 * 3600 * 1000) {
      try {
        const data = JSON.parse(row.data);
        if (data.as_of === today && 'vo2r' in data) return data;
      } catch { /* recompute */ }
    }
  }
  return await recomputeFitness(db, personId, today);
}

export async function fitnessHistory(db, personId, days = 180) {
  const rows = await db.prepare(
    "SELECT date, vdot AS vo2r, five_k_sec, mpw FROM fitness_history WHERE person_id = ? AND date >= date('now', ?) ORDER BY date"
  ).bind(personId, `-${days} days`).all();
  return rows.results;
}

// Pace for a zone key as seconds per mile (midpoint for ranges).
export function zoneSec(fitness, key) {
  const z = fitness?.zones?.find((x) => x.key === key);
  if (!z) return null;
  return Array.isArray(z.sec) ? (z.sec[0] + z.sec[1]) / 2 : z.sec;
}
