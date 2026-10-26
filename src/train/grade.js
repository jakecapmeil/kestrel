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

// w: { distance_mi, raw_distance_mi?, moving_sec, avg_hr, laps, elev_gain_ft, temp_f, dew_point_f, surface, course, name, category }
// -> { effort, pace_effort, hr_effort, pct_vo2r, pace_sec, reps }
// effort includes the credit for conditions; hr_effort is the blend without
// the heat/hill bump (plan matching uses it, so an easy day run easy in the
// heat still counts as easy).
export function gradeRun(w, { vo2r, maxHr }) {
  const reps = repsOf(w.laps);
  const isReps = reps.length >= 2;
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
