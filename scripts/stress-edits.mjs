// Stress test for the split-edit pipeline's pure parts: thousands of seeded random runs and laps, sane and garbage,
// through handLaps -> lapsMiles -> paceStructure -> checkedCategory -> gradeRun -> activityFacts -> templateReport.
// Nothing may throw, and nothing a runner reads may say NaN, undefined or Infinity.
// node --no-warnings scripts/stress-edits.mjs [runs]
import assert from 'node:assert/strict';
import { handLaps, lapsMiles, SYNC_SPLITS } from '../src/train/coach.js';
import { splitsText } from '../src/train/intervals.js';
import { paceStructure, checkedCategory, gradeRun, pctVo2r } from '../src/train/grade.js';
import { activityFacts, templateReport, templateDayLine, setLabel, allowedNumbers, ungroundedNumbers } from '../src/train/runfacts.js';

const N = Number(process.argv[2]) || 5000;
let seed = 0x5eed;
const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
const pickOf = (a) => a[Math.floor(rnd() * a.length)];
const between = (a, b) => a + rnd() * (b - a);
const CATS = ['easy', 'recovery', 'shakeout', 'workout', 'long', 'race', 'crosstrain'];
const OUT_CATS = new Set(CATS);
const BAD = /NaN|undefined|Infinity|null|\[object/;

// A lap as a runner might type it, or as junk might arrive at the API.
function lapIn() {
  const r = rnd();
  if (r < 0.04) return pickOf([null, 'x', 42, {}, { m: 'abc', s: '1:00' }, { m: -400, s: 70 }, { m: 400, s: -1 }, { m: 1e9, s: 1e9 }, { m: NaN, s: 60 }]);
  const m = r < 0.5 ? pickOf([100, 150, 200, 300, 400, 600, 800, 1000, 1200, 1609, 3200]) : Math.round(between(20, 5000));
  const pace = between(200, 700); // s/mi
  return { m, s: Math.round((m / 1609.344) * pace * 10) / 10, hr: rnd() < 0.7 ? Math.round(between(90, 210)) : pickOf([null, 0, 400, 'fast']), rest: pickOf(['', '90s', '2:00', 'standing', 12345]) };
}
// What the runner ran, typed as laps: an easy run's even miles, a rep session's reps (no jogs, the way they're
// typed), a set of mixed reps, a tempo's miles, or a random mess.
const SHAPES = ['easy', 'reps', 'set', 'tempo', 'mess'];
// The pace (s/mi) at a share of race VO2max: pctVo2r falls as pace slows, so bisect.
function paceAt(vo2r, pct) {
  let lo = 150, hi = 1200;
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (pctVo2r(vo2r, mid) > pct) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}
function lapsFor(shape, ctx) {
  // Paces from the runner's own fitness: reps at 90% of race VO2max (interval-ish), easy miles at 65%.
  const fastPace = ctx.vo2r ? paceAt(ctx.vo2r, 0.9) : 330;
  const easyPace = ctx.vo2r ? paceAt(ctx.vo2r, 0.65) : 530;
  const at = (m, pace) => ({ m, s: Math.round((m / 1609.344) * pace * between(0.98, 1.02) * 10) / 10, hr: Math.round(between(120, 190)), rest: '' });
  if (shape === 'easy') return Array.from({ length: Math.floor(between(2, 9)) }, () => at(1609, easyPace));
  if (shape === 'reps') { const m = pickOf([200, 300, 400, 600, 800, 1000, 1200]); return Array.from({ length: Math.max(2, Math.ceil(1000 / m) + Math.floor(between(0, 8))) }, () => at(m, fastPace)); }
  if (shape === 'set') { const [a, b] = pickOf([[600, 200], [800, 400], [1000, 200], [400, 200]]); return Array.from({ length: Math.floor(between(2, 6)) }, () => [at(a, fastPace), at(b, fastPace - 10)]).flat(); }
  if (shape === 'tempo') return Array.from({ length: Math.floor(between(2, 6)) }, () => at(1609, fastPace + 30));
  return Array.from({ length: Math.floor(between(0, 48)) }, lapIn);
}
function runIn(ctx) {
  const shape = pickOf(SHAPES);
  const laps = handLaps(rnd() < 0.03 ? pickOf([null, 'laps', {}, 7]) : lapsFor(shape, ctx));
  const mi = rnd() < 0.05 ? pickOf([0, null, 0.01, 199]) : Math.round(between(0.2, 15) * 100) / 100;
  const sec = rnd() < 0.05 ? pickOf([0, null, 1, 86400]) : Math.round((mi || 1) * between(240, 720));
  // Half the runs: laps that are the whole run, with a GPS distance that is off (indoors, a track, a tunnel).
  const whole = laps.length && rnd() < 0.5;
  const lapS = laps.reduce((a, l) => a + l.s, 0), lapM = laps.reduce((a, l) => a + l.m, 0);
  return {
    shape: laps.length ? shape : 'none', whole: !!whole, strava_id: 'x', category: pickOf(CATS), name: pickOf(['Morning Run', 'New York Running', '6x800', 'Hills', '', 'Track Running']),
    distance_mi: whole ? Math.round((lapM / 1609.344) * between(0.4, 1.4) * 100) / 100 : mi,
    moving_sec: whole ? Math.round(lapS * between(0.95, 1.08)) : sec,
    avg_hr: rnd() < 0.85 ? Math.round(between(110, 190)) : null, elev_gain_ft: Math.round(between(0, 800)),
    surface: rnd() < 0.15 ? 'track' : '', laps: JSON.stringify(laps), lapList: laps,
  };
}

const ctxs = [{ vo2r: 61.7, maxHr: 206 }, { vo2r: 45, maxHr: 190 }, { vo2r: null, maxHr: 200 }, { vo2r: 75, maxHr: null }];
const tally = { runs: 0, fromLaps: 0, workout: 0, reps: 0, sets: 0, reports: 0 };
for (let i = 0; i < N; i++) {
  const ctx = pickOf(ctxs), w = runIn(ctx);
  const where = `run ${i} ctx ${JSON.stringify(ctx)} ${JSON.stringify({ ...w, laps: undefined }).slice(0, 900)}`;
  try {
    // The server's rule: typed laps covering the run's time set its miles.
    const mi = lapsMiles(w.lapList, w);
    if (mi != null) {
      assert.ok(Number.isFinite(mi) && mi > 0, `lapsMiles gave ${mi}`);
      const s = w.lapList.reduce((a, l) => a + l.s, 0);
      assert.ok(Math.abs(s - w.moving_sec) <= Math.max(15, w.moving_sec * 0.1) + 1e-9, 'lapsMiles only when the laps cover the time');
      w.distance_mi = mi; w.raw_distance_mi = mi; tally.fromLaps++;
    }
    const p = paceStructure(w, ctx);
    assert.ok(p.kind === null || ['reps', 'tempo', 'steady'].includes(p.kind), `kind ${p.kind}`);
    assert.ok(p.fast_laps >= 0 && p.fast_laps <= w.lapList.length, 'fast laps within the laps');
    if (p.kind === 'reps') tally.reps++;
    for (const hand of [false, true]) {
      const c = checkedCategory(w, ctx, { handLaps: hand, meetDay: rnd() < 0.1 }).category;
      assert.ok(OUT_CATS.has(c), `category ${c}`);
      if (hand && c === 'workout') tally.workout++;
    }
    // What the shapes must read as, with the runner's pace known: the laps decide the reps whatever the run's own
    // numbers say; and when the laps are the whole run (its miles now theirs), they decide its label too.
    if (ctx.vo2r) {
      const easyCat = pickOf(['easy', 'recovery', 'shakeout']);
      const c = checkedCategory({ ...w, category: easyCat }, ctx, { handLaps: true }).category;
      if (w.shape === 'reps' || w.shape === 'set') {
        assert.equal(p.kind, 'reps', `typed ${w.shape} read as reps`);
        assert.equal(c, 'workout', `typed ${w.shape} make an ${easyCat} run a workout`);
      }
      if (w.shape === 'easy' && w.whole && mi != null) assert.equal(c, easyCat, 'typed easy miles that are the whole run stay easy');
    }
    const g = gradeRun({ ...w, category: checkedCategory(w, ctx, { handLaps: true }).category }, ctx);
    assert.ok(g.effort == null || (g.effort >= 1 && g.effort <= 10), `effort ${g.effort}`);
    const f = activityFacts({ id: String(i), name: w.name, type: w.category === 'crosstrain' ? '' : 'Run', category: w.category, miles: w.distance_mi, sec: w.moving_sec,
      avg_hr: w.avg_hr, max_hr: w.avg_hr ? w.avg_hr + 10 : null, elev_ft: w.elev_gain_ft, laps: w.lapList, paceInfo: p, track: w.surface === 'track' }, ctx);
    if (f.reps?.set) { tally.sets++; assert.ok(/^\d+ × /.test(f.reps.set) || / \+ /.test(f.reps.set), `set ${f.reps.set}`); }
    if (w.shape === 'set' && ctx.vo2r && w.category !== 'crosstrain' && w.lapList.length >= 4) assert.match(f.reps?.set || '', /^\d+ × \(\d+ m \+ \d+ m\)$/, `a typed set is named: ${JSON.stringify(f.reps)} kind ${p.kind} fast ${p.fast_laps}`);
    if (w.shape === 'reps' && ctx.vo2r) assert.equal(f.reps?.set, undefined, 'reps of one length are counted, not named');
    for (const s of f.findings) assert.ok(!BAD.test(s), `finding: ${s}`);
    const sess = { main_id: String(i), facts: [f] };
    const report = templateReport(sess), line = templateDayLine([sess]);
    for (const t of [report, line]) assert.ok(!BAD.test(t), `text: ${t}`);
    // The written note uses only numbers from its facts (the same check a model's note gets).
    assert.equal(ungroundedNumbers(report, allowedNumbers([f])).length, 0, `report has a number not in the facts: ${report}`);
    if (report) tally.reports++;
    tally.runs++;
  } catch (e) {
    console.error('FAIL', where, '\n ', e.message);
    process.exit(1);
  }
}
// Set names on their own, including junk.
for (let i = 0; i < 2000; i++) {
  const laps = Array.from({ length: Math.floor(between(0, 30)) }, () => ({ m: rnd() < 0.05 ? pickOf([0, -5, NaN]) : pickOf([200, 300, 400, 600, 800, 1000, 1609]) * between(0.93, 1.07), s: 60 }));
  const got = setLabel(laps, rnd() < 0.3);
  assert.ok(got === null || (typeof got === 'string' && !BAD.test(got)), `setLabel gave ${got}`);
}
// The day's splits line the sync writes must read as the sync's (coach.js SYNC_SPLITS): that is how an edit knows it
// may rewrite the line rather than a runner's own words.
let lines = 0;
for (let i = 0; i < 3000; i++) {
  const laps = handLaps(Array.from({ length: Math.floor(between(1, 40)) }, () => ({ m: pickOf([100, 200, 384, 400, 600, 800, 1000, 1609, 1609.3, 3200]) * between(0.9, 1.1), s: between(14, 1400), hr: rnd() < 0.7 ? Math.round(between(90, 210)) : null })));
  if (!laps.length) continue;
  for (const track of [false, true]) { const t = splitsText(laps, track); assert.ok(SYNC_SPLITS.test(t), `the sync's splits line doesn't match SYNC_SPLITS: ${t}`); lines++; }
}
console.log(`stress: ${tally.runs} runs (${tally.fromLaps} took their laps' miles, ${tally.reps} rep sessions, ${tally.sets} named sets, ${tally.workout} typed-lap workouts), 2000 set names, ${lines} splits lines, no errors`);
