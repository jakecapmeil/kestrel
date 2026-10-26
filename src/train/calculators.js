// Race-day calculators. Heat uses the same temperature + dew point chart as the rest of Kestrel (conditions.js, Hadley's coaching table), which agrees with
// two checks on real results (research/hawkspredict/RESULTS.md, exp18): NRCD cross country runs about 0.2% slower per degree F above 60, and Ontario
// high-school 3000 m about 0.4% slower per 10 F of temperature + dew point, with no measurable effect from 400 to 1500 m. Taper follows published
// controlled studies; Kestrel' own marathon data cannot test it (exp21: runners whose last three weeks fell below 55% of their build ran slower, but that group includes
// the injured and ill).
import { heatCost, hillCost } from './conditions.js';

export class CalcError extends Error {}

const RACES = { '1600': 1609.344, '3200': 3218.688, '5K': 5000, '10K': 10000, half: 21097.5, marathon: 42195 };

export function parseClock(text) {
  const parts = String(text || '').trim().split(':').map(Number);
  if (!parts.length || parts.length > 3 || parts.some((x) => !Number.isFinite(x) || x < 0)) return null;
  return parts.reduce((a, x) => a * 60 + x, 0);
}
export function fmtClock(sec) {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
}
const num = (v, lo, hi, name) => {
  const x = Number(v);
  if (!Number.isFinite(x) || x < lo || x > hi) throw new CalcError(`${name} should be between ${lo} and ${hi}`);
  return x;
};

// What the weather and hills cost a race, and the time that equals a flat, cool-day performance.
//   input: { race, time ('18:30' = what you would run on a cool flat day), temp_f, dew_f, climb_ft_per_mile }
export function heatCalc(q) {
  const meters = RACES[q.race];
  if (!meters) throw new CalcError('Pick a race distance');
  const base = parseClock(q.time);
  if (!base || base < 30) throw new CalcError('Enter your cool-day time like 18:30');
  const temp = num(q.temp_f, -20, 130, 'Temperature');
  const dew = num(q.dew_f, -40, 90, 'Dew point');
  if (dew > temp + 1) throw new CalcError('The dew point cannot be above the temperature');
  const climb = q.climb_ft_per_mile === undefined || q.climb_ft_per_mile === '' ? 0 : num(q.climb_ft_per_mile, 0, 400, 'Climb');
  // Hadley's chart is for continuous running. Real results show no effect up to 1500 m and the full effect from 3000 m up; a mile gets half.
  const scale = meters <= 900 ? 0 : meters <= 1700 ? 0.5 : 1;
  const heat = heatCost(temp, dew) * scale;
  const hill = hillCost(climb * (meters / 1609.344), meters / 1609.344);
  const factor = (1 + heat) * (1 + hill);
  const t = base * factor;
  return {
    race: q.race, temp_plus_dew: Math.round(temp + dew), heat_pct: Math.round(heat * 1000) / 10, hill_pct: Math.round(hill * 1000) / 10,
    cool_day_time: fmtClock(base), expected_time: fmtClock(t), cost_sec: Math.round(t - base),
    pace_mi: fmtClock((t / meters) * 1609.344),
    note: scale === 0 ? 'Heat has no measurable effect on races up to 800 m.' : scale < 1 ? 'A mile pays about half of the continuous-running heat cost.' : (temp + dew <= 100 ? 'Under 100 (temperature + dew point) the weather costs nothing.' : ''),
  };
}

// Taper: weekly miles as a share of the peak week, by race, and the rules that go with it.
const TAPERS = {
  '1600': { weeks: [0.8, 0.6], long: 'Skip the long run in the last 10 days; run easy.' },
  '3200': { weeks: [0.8, 0.6], long: 'Skip the long run in the last 10 days; run easy.' },
  '5K': { weeks: [0.8, 0.6], long: 'Shorten the long run to about two thirds 10 days out, then nothing long.' },
  '10K': { weeks: [0.8, 0.6], long: 'Last long run 10 days out at two thirds of its usual length.' },
  half: { weeks: [0.85, 0.7, 0.55], long: 'Last long run 10-12 days out at about 70% of its usual length.' },
  marathon: { weeks: [0.85, 0.7, 0.5], long: 'Last long run 14-16 days out, at 60-70% of the peak long run.' },
};
export function taperCalc(q) {
  const t = TAPERS[q.race];
  if (!t) throw new CalcError('Pick a race distance');
  const peak = num(q.weekly_miles, 5, 150, 'Weekly miles');
  const longest = q.longest_run === undefined || q.longest_run === '' ? null : num(q.longest_run, 3, 40, 'Longest run');
  const n = t.weeks.length;
  const weeks = t.weeks.map((share, i) => ({
    label: i === n - 1 ? 'Race week' : n - 1 - i === 1 ? 'The week before' : `${n - 1 - i} weeks before`,
    miles: Math.round(peak * share), share_pct: Math.round(share * 100),
  }));
  return {
    race: q.race, peak_miles: peak, weeks,
    last_long_run_miles: longest ? Math.round(longest * (q.race === 'marathon' ? 0.65 : 0.7)) : null,
    rules: [
      'Cut the miles, not the speed: keep the same number of running days and keep a little race-pace work (short reps or strides) in each week.',
      t.long,
      'The last hard workout is 5-7 days before the race, about half its usual volume. After that, only easy runs and strides.',
      'The day before: 2-3 easy miles with a few strides. Sleep matters more than any extra run.',
      'Feeling flat or heavy mid-taper is normal. Do not add miles to fix it.',
    ],
    evidence: 'Controlled studies of tapering (a 2007 meta-analysis of 27 studies by Bosquet and colleagues) found the best results from about two weeks of cutting volume 40-60% while keeping intensity and frequency, worth around 2% in performance. Kestrel could not re-test this: in 13,000 real marathons, runners whose last three weeks fell under 55% of their build ran slower than expected, but that group includes people who were injured or ill.',
  };
}
