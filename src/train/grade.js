// Run grading: how hard a run was, judged against the runner's own
// KestrelPredict-Lite training paces (Fitness States) and checked by heart rate.
//
// Pace side: a run's pace is turned into a share of the runner's race VO2max (Daniels'
// %VO2max: easy 62-70%, steady 81%, marathon 84%, threshold 88%, 10K ~92%, 5K
// ~97%, 3K and faster 100%+) and graded 1-10. Because it is relative to each
// runner's own paces, a 7:30 mile is a hard effort for one runner and a jog for
// another. Intervals are graded on their work reps only, not the warm-up and
// cool-down around them. Hills, heat and Van Cortlandt are credited back first
// (conditions.js), so a slow hilly tempo still grades as a tempo.
// Heart rate side: avg HR as a share of max HR (Daniels' zones: easy 65-79%,
// threshold 88-92%, interval 98-100%).
// The two are blended; HR also catches a run that was slower than it should
// have been because of fatigue, and pace catches HR that lags (short reps).
import { vo2At } from './fitness.js';
import { conditionsOf, conditionsBump } from './conditions.js';

const MILE = 1609.344;

// [upper bound as a share of race VO2max, effort]
const PACE_STEPS = [[0.55, 1], [0.62, 2], [0.70, 3], [0.76, 4], [0.82, 5], [0.86, 6], [0.90, 7], [0.94, 8], [0.99, 9]];
// [upper bound as a share of max HR, effort]
const HR_STEPS = [[0.65, 2], [0.72, 3], [0.78, 4], [0.83, 5], [0.87, 6], [0.90, 7], [0.93, 8], [0.96, 9]];
const CATEGORY_EFFORT = { recovery: 2, easy: 4, shakeout: 3, long: 5, crosstrain: 4, workout: 7, race: 9 };

const stepped = (steps, x) => {
  for (const [cut, e] of steps) if (x < cut) return e;
  return 10;
};

// Share of race VO2max a pace costs (sec per mile -> 0.62 means 62% of VO2max).
export function pctVo2r(vo2r, secPerMile) {
  if (!(vo2r > 0 && secPerMile > 0)) return null;
  const v = (MILE / secPerMile) * 60; // m/min
  return vo2At(v) / vo2r;
}

export function hrEffortFor(avgHr, maxHr) {
  return avgHr && maxHr ? stepped(HR_STEPS, avgHr / maxHr) : null;
}

function repsOf(laps) {
  let arr = laps;
  if (typeof arr === 'string') { try { arr = JSON.parse(arr); } catch { return []; } }
  return Array.isArray(arr) ? arr.filter((l) => l?.m > 0 && l?.s > 0) : [];
}

// Was it a workout, judged by pace? Laps alone don't say so: watches split every mile (or km) by themselves,
// so an easy run at an even 8:00 arrives as "5 x 1 mi". What makes a workout is running fast against the
// runner's own paces: laps at marathon-to-tempo effort (82%+ of race VO2max) or faster, at least 800 m of
// them, or a whole run at that pace. A run at recovery or easy pace is never a workout, whatever its laps.
// Without pace fitness yet, a lap counts as fast when it is 10%+ quicker than the run's slower laps.
// -> { known, workout, kind: 'reps' | 'tempo' | 'steady' | null, fast_m, fast_laps, run_pct, rep_pct, run_zone, rep_zone, work }
const FAST_PCT = 0.82;
const ZONES = [[0.62, 'recovery'], [0.76, 'easy'], [0.82, 'steady'], [0.88, 'tempo'], [0.92, 'threshold']];
export function zoneOf(pct) {
  if (pct == null) return null;
  for (const [cut, z] of ZONES) if (pct < cut) return z;
  return 'interval';
}

// Names that say the athlete ran a workout on purpose (hill reps are run by effort, not pace).
export const WORKOUT_WORDS = /\d\s*x\s*\d|\bhills?\b|fartlek|tempo|threshold|interval|repeats?|workout|ladder|cruise/i;

export function paceStructure(w, { vo2r }) {
  const all = repsOf(w.laps);
  // Strides and tiny lap-button laps aren't work.
  const laps = all.filter((l) => l.m >= 250);
  const mi = w.raw_distance_mi || w.distance_mi;
  const factor = conditionsOf({ ...w, distance_mi: w.distance_mi || mi }, [], { reps: false }).factor || 1;
  const runPace = mi > 0.3 && w.moving_sec > 0 ? w.moving_sec / mi : null;
  const pctAt = (secPerMile) => (vo2r && secPerMile ? pctVo2r(vo2r, secPerMile / factor) : null);
  const lapPace = (l) => (l.s / l.m) * MILE;
  const run_pct = pctAt(runPace);
  let isFast;
  if (vo2r) isFast = (l) => pctAt(lapPace(l)) >= FAST_PCT;
  else if (laps.length >= 3) {
    const sorted = laps.map(lapPace).sort((a, b) => b - a);
    const slow = sorted[Math.floor((sorted.length - 1) / 4)]; // the slower laps' pace
    isFast = (l) => lapPace(l) <= slow * 0.9;
  } else isFast = null;
  const fast = isFast ? laps.filter(isFast) : [];
  const fast_m = fast.reduce((a, l) => a + l.m, 0);
  const rep_pace = fast_m ? (fast.reduce((a, l) => a + l.s, 0) / fast_m) * MILE : null;
  const rep_pct = pctAt(rep_pace);
  const reps = fast.length >= 2 && fast.length < laps.length && fast_m >= 800;
  const tempo = !reps && fast_m >= 1600;
  // A whole run at tempo pace, or a short one at threshold or faster (a rep saved as its own activity).
  const steady = !reps && !tempo && run_pct != null && run_pct >= FAST_PCT && (mi >= 2 || (run_pct >= 0.88 && mi >= 0.4));
  // The slowest real lap: in a race it is still quick (a hill), in a rep session it is the jog.
  const slow_pct = vo2r && laps.length ? Math.min(...laps.map((l) => pctAt(lapPace(l)))) : null;
  const kind = reps ? 'reps' : tempo ? 'tempo' : steady ? 'steady' : null;
  return {
    known: !!vo2r || !!isFast, workout: !!kind, kind, fast_m: Math.round(fast_m), fast_laps: fast.length,
    run_pct: run_pct != null ? Math.round(run_pct * 1000) / 1000 : null, rep_pct: rep_pct != null ? Math.round(rep_pct * 1000) / 1000 : null,
    run_zone: zoneOf(run_pct), rep_zone: zoneOf(rep_pct), slow_pct,
    // The laps a workout is graded on: its fast laps, not the warm-up, jogs and cool-down around them.
    work: reps || tempo ? fast : null,
  };
}

// The category a run gets once its pace has been checked. A "workout" run at recovery or easy pace (no fast laps,
// no fast stretch) becomes recovery, long or easy; a continuous hard effort on a meet day becomes a race. The
// athlete's own word wins: a name like "6x800" or "hills" keeps it a workout, and runner tags never reach here.
export function checkedCategory(w, ctx, { meetDay = false } = {}) {
  const cat = w.category;
  if (cat !== 'workout' && cat !== 'easy' && cat !== 'long') return { category: cat };
  const s = paceStructure(w, ctx);
  const mi = w.raw_distance_mi || w.distance_mi || 0;
  const hrE = hrEffortFor(w.avg_hr, ctx.maxHr);
  const continuous = s.kind !== 'reps' || (s.slow_pct != null && s.slow_pct >= 0.76);
  if (meetDay && continuous && mi >= 0.9 && mi <= 7.5 && ((hrE ?? 0) >= 7 || (s.run_pct ?? 0) >= 0.9) && (s.run_pct == null || s.run_pct >= 0.86)) {
    return { category: 'race', why: 'continuous hard effort on a meet day' };
  }
  if (cat !== 'workout' || s.workout || WORKOUT_WORDS.test(w.name || '')) return { category: cat };
  // Pace unknown (no fitness yet, no laps to compare): heart rate decides.
  if (!s.known && !(hrE != null && hrE <= 4)) return { category: cat };
  // Recovery is a short run at recovery pace (or heart rate); a longer one at that pace is an easy run.
  const easyCat = mi >= 8 ? 'long' : mi <= 4.5 && (s.run_zone === 'recovery' || (hrE ?? 9) <= 3) ? 'recovery' : 'easy';
  return { category: easyCat, why: `${s.run_zone || 'easy'} pace with no fast laps` };
}

// w: { distance_mi, raw_distance_mi?, moving_sec, avg_hr, laps, elev_gain_ft, temp_f, dew_point_f, surface, course, name, category }
// -> { effort, pace_effort, hr_effort, pct_vo2r, pace_sec, reps }
// effort includes the credit for conditions; hr_effort is the blend without
// the heat/hill bump (plan matching uses it, so an easy day run easy in the
// heat still counts as easy).
export function gradeRun(w, { vo2r, maxHr }) {
  // A workout is graded on its fast laps; every lap is the fallback (and what other runs use).
  const work = w.category === 'workout' ? paceStructure(w, { vo2r }).work : null;
  const reps = work?.length ? work : repsOf(w.laps);
  const isReps = reps.length >= 2 || !!work?.length;
  const mi = w.raw_distance_mi || w.distance_mi;
  let paceSec = null;
  let hr = w.avg_hr || null;
  let shortReps = false;
  if (isReps) {
    const m = reps.reduce((a, l) => a + l.m, 0);
    paceSec = (reps.reduce((a, l) => a + l.s, 0) / m) * MILE;
    const withHr = reps.filter((l) => l.hr);
    if (withHr.length >= 2) hr = withHr.reduce((a, l) => a + l.hr * l.s, 0) / withHr.reduce((a, l) => a + l.s, 0);
    shortReps = m / reps.length <= 500;
  } else if (mi > 0.3 && w.moving_sec > 0) {
    paceSec = w.moving_sec / mi;
  }
  let pct = null;
  let paceEffort = null;
  if (vo2r && paceSec && w.category !== 'crosstrain') {
    const c = conditionsOf({ ...w, distance_mi: w.distance_mi || mi }, [], { reps: isReps });
    pct = pctVo2r(vo2r, paceSec / c.factor);
    // Reps of 500 m or less are anaerobic and run well past VO2max pace by
    // design: they top out at 9 (a hard rep session), never "off the chart".
    paceEffort = Math.min(shortReps ? 9 : 10, stepped(PACE_STEPS, pct));
  }
  const hrEffort = hrEffortFor(hr, maxHr);
  const base = CATEGORY_EFFORT[w.category] ?? 4;
  let blend;
  if (paceEffort != null && hrEffort != null) {
    const wp = isReps ? 0.65 : 0.5; // short reps outrun the heart rate
    blend = Math.round(paceEffort * wp + hrEffort * (1 - wp));
  } else blend = paceEffort ?? hrEffort ?? base;
  // Heat and hills are already in the pace credit; add them only when pace is unknown.
  const bump = paceEffort == null && w.category !== 'crosstrain' ? conditionsBump(w) : 0;
  return {
    effort: Math.min(10, blend + bump), hr_effort: blend,
    pace_effort: paceEffort, hr_only_effort: hrEffort,
    pct_vo2r: pct != null ? Math.round(pct * 1000) / 1000 : null,
    pace_sec: paceSec ? Math.round(paceSec) : null, reps: isReps,
  };
}
