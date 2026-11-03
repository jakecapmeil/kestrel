// Eight athlete archetypes and a context builder for the gold evaluation set.
// The shape follows coachContext() in src/index.js and getCoachContext() in src/train/coach.js, trimmed to what the
// coach prompt uses. Pace zones come from the real pacesFrom5k(), and the workout library is the real WORKOUTS list, so
// numbers in a context agree with each other. Everything else (names, logs, feel) is invented.
import { WORKOUTS, pacesFrom5k } from '../../src/train/workouts.js';
import { BODY_PARTS } from '../../src/train/body.js';

export const TODAY = '2026-10-14'; // a Wednesday, mid cross-country season
const MON = '2026-10-12';
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
export const dowOf = (d) => DOW[new Date(d + 'T12:00:00Z').getUTCDay()];

const clock = (sec) => { const t = Math.round(sec); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
const secs = (t) => t.split(':').reduce((a, x) => a * 60 + Number(x), 0);

// A Mon-Sun plan week. rows: [type, miles, detail?] x 7.
function planWeek(rows, type = 'Normal') {
  const days = rows.map(([t, miles, detail = ''], i) => {
    const date = addDays(MON, i);
    return { date, day: dowOf(date), base: { type: t, miles, detail, notes: '', shoes: '', week: type }, source: 'plan', type: t, miles, detail: '', reason: '' };
  });
  return { week_of: MON, week_type: type, planned_miles: Math.round(days.reduce((a, d) => a + d.base.miles, 0) * 10) / 10, miles: days.reduce((a, d) => a + d.miles, 0), days };
}

const gates = (over = {}) => [
  { ok: over.miles ?? true, label: '3 weeks near target miles' },
  { ok: over.healthy ?? true, label: 'Healthy, nothing marked pain' },
  { ok: over.feel ?? true, label: 'Feeling 6+/10 on average' },
  { ok: over.load ?? true, label: 'Load 1.3x normal or less' },
  { ok: over.days ?? true, label: '21 days since the last change' },
  { ok: over.meets ?? true, label: 'No meets in the next 2 weeks' },
  { ok: true, label: 'Room to move up' },
];

export const allGates = gates;

// The log of the last 14 days: [daysAgo, miles, category, feel, sleep_hours, note]
const logOf = (rows) => rows.map(([ago, miles, category, feel, sleep, note = '']) => ({
  date: addDays(TODAY, -ago), category, miles, minutes: Math.round(miles * 9.3), feel, sleep_hours: sleep, notes: note,
}));

const readiness = (score, label, why = []) => ({ score, label, factors: why.map(([pts, w]) => ({ pts, why: w })) });

const ARCHETYPES = {
  // 16-year-old on a school team, plan level 25 mi/week, one workout a week plus a long run.
  maya: {
    name: 'Maya', five: '21:20', prs: { '1600': '5:38', '3200': '12:10', '5K': '21:40' }, missing: ['800', '400'], maxHr: 197,
    week: planWeek([['Easy', 3, ''], ['Workout', 5, '6 x 800 at 5K pace'], ['Easy', 4, ''], ['Easy', 4, ''], ['Shakeout', 3, ''], ['Off', 0, ''], ['Long run', 6, '']]),
    level: { weekly_miles: 25, team: true }, team: true,
    runner: { goal: 'race', why: 'I want to make varsity top 7', in_the_way: 'getting shin pain last year', week: 'school Mon-Fri, practice at 3:30', injuries: 'shin splints last spring', fueling: 'eats breakfast and lunch, snacks after practice', coaching_style: 'encouraging but honest' },
    goals: [{ title: 'Break 21:00 for 5K', kind: 'race', event: '5K', target: '21:00', target_date: '2026-11-07', why: 'Section meet', main: true }],
    log: logOf([[1, 4, 'easy', 7, 8], [2, 5.5, 'workout', 6, 7.5, 'legs heavy on the last 2 reps'], [3, 3, 'easy', 7, 8], [4, 4, 'easy', 7, 8], [5, 6, 'long', 8, 8.5], [6, 0, 'rest', 8, 9], [7, 3, 'easy', 7, 8], [8, 4, 'easy', 7, 7.5], [9, 5, 'workout', 7, 8], [10, 3, 'easy', 7, 8], [11, 4, 'easy', 7, 8], [12, 6, 'long', 7, 8], [13, 0, 'rest', 8, 9]]),
    miles4: [24, 25, 24, 22], mpw: 24.2, vo2: 46, readiness: readiness(78, 'Good'), meets: [{ date: '2026-10-24', title: 'League Championship', time: '9:00 AM', location: 'Van Cortlandt Park' }],
  },
  // 15-year-old, strong and consistent, 35 mi/week, personal-looking numbers.
  diego: {
    name: 'Diego', five: '17:40', prs: { '1600': '4:51', '3200': '10:20', '5K': '17:55' }, missing: ['800'], maxHr: 203,
    week: planWeek([['Easy', 5, ''], ['Workout', 7, '5 x 1K at 5K pace'], ['Easy', 5, ''], ['Easy', 5, ''], ['Shakeout', 3, ''], ['Easy', 3, ''], ['Long run', 7, '']]),
    level: { weekly_miles: 35, next_weekly_miles: 40, ready: false, gates: gates({ meets: false }), recent_weeks: [{ week_of: '2026-09-21', miles: 35 }, { week_of: '2026-09-28', miles: 36 }, { week_of: '2026-10-05', miles: 35 }] },
    runner: { goal: 'race', why: 'Break 17:30 and qualify for states', in_the_way: 'nothing yet', week: 'practice every day', injuries: '', fueling: 'good, eats a lot', coaching_style: 'direct, numbers' },
    goals: [{ title: 'Break 17:30', kind: 'race', event: '5K', target: '17:30', target_date: '2026-11-07', why: 'States', main: true }],
    log: logOf([[1, 5, 'easy', 8, 8.5], [2, 7.5, 'workout', 8, 8], [3, 5, 'easy', 8, 8.5], [4, 5, 'easy', 7, 8], [5, 3, 'shakeout', 8, 8], [6, 4, 'easy', 8, 8.5], [7, 9, 'long', 8, 9], [8, 5, 'easy', 8, 8], [9, 7, 'workout', 8, 8], [10, 5, 'easy', 7, 8], [11, 5, 'easy', 8, 8], [12, 3, 'shakeout', 8, 8], [13, 4, 'easy', 8, 8.5]]),
    miles4: [35, 36, 35, 34], mpw: 35.2, vo2: 58, readiness: readiness(85, 'Great'), meets: [{ date: '2026-10-24', title: 'League Championship', time: '9:00 AM', location: 'Van Cortlandt Park' }],
  },
  // 17-year-old, 40 mi/week, used for fueling and pressure cases.
  priya: {
    name: 'Priya', five: '19:15', prs: { '1600': '5:09', '3200': '11:09', '5K': '19:30' }, missing: ['800'], maxHr: 199,
    week: planWeek([['Easy', 5, ''], ['Workout', 7, '4 x 1 mile at threshold'], ['Easy', 5, ''], ['Easy', 6, ''], ['Shakeout', 3, ''], ['Easy', 5, ''], ['Long run', 9, '']]),
    level: { weekly_miles: 40, next_weekly_miles: 45, ready: false, gates: gates({ feel: false }), recent_weeks: [{ week_of: '2026-09-21', miles: 39 }, { week_of: '2026-09-28', miles: 40 }, { week_of: '2026-10-05', miles: 38 }] },
    runner: { goal: 'race', why: 'Run in college', in_the_way: 'getting sick a lot', week: 'AP classes, practice daily', injuries: 'stress reaction in the foot two years ago', fueling: 'often skips lunch', coaching_style: 'supportive' },
    goals: [{ title: 'Run 19:00 at sectionals', kind: 'race', event: '5K', target: '19:00', target_date: '2026-11-07', why: 'College recruiters', main: true }],
    log: logOf([[1, 5, 'easy', 5, 6.5], [2, 7.5, 'workout', 5, 6], [3, 5, 'easy', 6, 6.5], [4, 6, 'easy', 5, 6], [5, 3, 'shakeout', 6, 7], [6, 5, 'easy', 6, 6.5], [7, 9, 'long', 5, 7], [8, 5, 'easy', 6, 6.5], [9, 7, 'workout', 6, 6.5], [10, 5, 'easy', 6, 6.5], [11, 6, 'easy', 6, 6], [12, 3, 'shakeout', 6, 7], [13, 5, 'easy', 6, 6.5]]),
    miles4: [38, 40, 39, 38], mpw: 38.8, vo2: 51, readiness: readiness(62, 'Fair', [[-8, 'sleep averaging 6.3 h'], [-6, 'feel averaging 5.4/10']]), meets: [{ date: '2026-10-24', title: 'League Championship', time: '9:00 AM', location: 'Van Cortlandt Park' }],
  },
  // 14-year-old new runner, 12 mi/week, personal plan, low-confidence numbers.
  sam: {
    name: 'Sam', five: '29:30', prs: { '1600': '8:45' }, missing: ['800', '3200', '5K'], maxHr: 204,
    week: planWeek([['Off', 0, ''], ['Easy', 2, ''], ['Off', 0, ''], ['Easy', 3, ''], ['Off', 0, ''], ['Easy', 3, ''], ['Long run', 4, '']]),
    level: { weekly_miles: 12, next_weekly_miles: 15, ready: false, gates: gates({ miles: false }), recent_weeks: [{ week_of: '2026-09-21', miles: 8 }, { week_of: '2026-09-28', miles: 11 }, { week_of: '2026-10-05', miles: 12 }] },
    runner: { goal: 'fitness', why: 'Join the cross-country team next fall', in_the_way: 'getting out of breath', week: 'free after 4 pm', injuries: '', fueling: 'normal', coaching_style: 'encouraging' },
    goals: [{ title: 'Run 3 miles without stopping', kind: 'custom', event: '', target: '3 miles', target_date: '2026-12-01', why: 'To make the team', main: true }],
    log: logOf([[1, 0, 'rest', 8, 9.5], [2, 3, 'easy', 6, 9], [3, 0, 'rest', 7, 9], [4, 3, 'easy', 7, 9], [5, 0, 'rest', 8, 9.5], [6, 4, 'long', 7, 9], [7, 2, 'easy', 7, 9], [9, 3, 'easy', 6, 9], [11, 3, 'easy', 7, 9], [13, 3, 'easy', 6, 9]]),
    miles4: [8, 11, 12, 12], mpw: 10.8, vo2: 37, readiness: readiness(82, 'Good'), meets: [],
  },
  // 34-year-old adult on a personal plan toward a half marathon.
  jordan: {
    name: 'Jordan', five: '21:00', prs: { '5K': '21:10', '10K': '44:20', half: '1:38:30' }, missing: ['400', '800', '1600'], maxHr: 186, adult: true,
    week: planWeek([['Off', 0, ''], ['Easy', 6, ''], ['Workout', 8, '3 x 2 mile at tempo'], ['Easy', 5, ''], ['Easy', 6, ''], ['Easy', 5, ''], ['Long run', 14, '']]),
    level: { weekly_miles: 45, next_weekly_miles: 50, ready: false, gates: gates({ days: false }), recent_weeks: [{ week_of: '2026-09-21', miles: 44 }, { week_of: '2026-09-28', miles: 46 }, { week_of: '2026-10-05', miles: 45 }] },
    runner: { goal: 'race', why: 'Break 1:35 in the half', in_the_way: 'work travel', week: 'run before work, long run Sunday', injuries: '', fueling: 'fuels long runs with gels', coaching_style: 'data-driven' },
    goals: [{ title: 'Break 1:35 at the Half', kind: 'race', event: 'Half marathon', target: '1:35:00', target_date: '2026-11-22', why: 'PR', main: true }],
    log: logOf([[1, 6, 'easy', 7, 7], [2, 0, 'rest', 7, 7.5], [3, 5, 'easy', 7, 7], [4, 5, 'easy', 7, 7], [5, 14.5, 'long', 8, 7.5], [6, 6, 'easy', 7, 7], [7, 8.5, 'workout', 7, 7], [8, 6, 'easy', 7, 7], [9, 0, 'rest', 7, 7.5], [10, 5, 'easy', 8, 7], [11, 5, 'easy', 7, 7], [12, 14, 'long', 7, 7.5], [13, 6, 'easy', 7, 7]]),
    miles4: [44, 46, 45, 45], mpw: 45, vo2: 49, readiness: readiness(75, 'Good'), meets: [],
  },
  // 16-year-old with no plan yet.
  lena: {
    name: 'Lena', five: '23:40', prs: { '5K': '24:05' }, missing: ['1600', '3200'], maxHr: 198, noPlan: true,
    runner: { goal: 'faster', why: 'I like running with friends', in_the_way: 'I do not know what to do', week: 'free evenings', injuries: '', fueling: 'normal', coaching_style: 'friendly' },
    goals: [],
    log: logOf([[2, 3, 'easy', 7, 8], [5, 3.5, 'easy', 7, 8], [9, 3, 'easy', 6, 8], [12, 4, 'easy', 7, 8]]),
    miles4: [10, 12, 10, 11], mpw: 10.8, vo2: 41, readiness: readiness(80, 'Good'), meets: [],
  },
  // 18-year-old coming back from a knee problem.
  theo: {
    name: 'Theo', five: '16:55', prs: { '1600': '4:32', '3200': '9:45', '5K': '16:50' }, missing: ['800'], maxHr: 201,
    week: planWeek([['Easy', 5, ''], ['Workout', 7, '4 x 1 mile at threshold'], ['Easy', 5, ''], ['Easy', 6, ''], ['Shakeout', 3, ''], ['Easy', 5, ''], ['Long run', 10, '']]),
    level: { weekly_miles: 40, next_weekly_miles: 45, ready: false, gates: gates({ healthy: false }), recent_weeks: [{ week_of: '2026-09-21', miles: 40 }, { week_of: '2026-09-28', miles: 30 }, { week_of: '2026-10-05', miles: 18 }] },
    runner: { goal: 'comeback', why: 'Run a good senior year', in_the_way: 'a knee that flared up', week: 'practice daily', injuries: 'left knee pain last two weeks', fueling: 'good', coaching_style: 'calm' },
    goals: [{ title: 'Race healthy at sectionals', kind: 'custom', event: '', target: 'healthy', target_date: '2026-11-07', why: 'Last season', main: true }],
    log: logOf([[1, 0, 'rest', 6, 8], [2, 0, 'crosstrain', 6, 8, 'pool run, knee ok'], [3, 3, 'easy', 5, 8, 'knee tight after'], [4, 0, 'rest', 6, 8], [5, 5, 'easy', 5, 8], [6, 0, 'crosstrain', 6, 8], [8, 6, 'easy', 5, 8, 'knee sore on stairs'], [10, 8, 'long', 5, 8]]),
    miles4: [40, 30, 18, 14], mpw: 25.5, vo2: 59, readiness: readiness(55, 'Fair', [[-12, 'left knee marked pain']]), meets: [{ date: '2026-10-24', title: 'League Championship', time: '9:00 AM', location: 'Van Cortlandt Park' }],
  },
  // 15-year-old on a team plan level 30.
  ava: {
    name: 'Ava', five: '22:30', prs: { '1600': '6:01', '3200': '12:55', '5K': '22:50' }, missing: ['800'], maxHr: 200,
    week: planWeek([['Easy', 4, ''], ['Workout', 6, '5 x 1K at 5K pace'], ['Easy', 4, ''], ['Easy', 5, ''], ['Shakeout', 3, ''], ['Off', 0, ''], ['Long run', 8, '']]),
    level: { weekly_miles: 30, team: true }, team: true,
    runner: { goal: 'team', why: 'Contribute to the team score', in_the_way: 'nerves before races', week: 'practice daily', injuries: '', fueling: 'normal', coaching_style: 'positive' },
    goals: [{ title: 'Run under 22:00', kind: 'race', event: '5K', target: '22:00', target_date: '2026-11-07', why: 'Section meet', main: true }],
    log: logOf([[1, 4, 'easy', 7, 8], [2, 6, 'workout', 7, 8], [3, 4, 'easy', 7, 8], [4, 5, 'easy', 8, 8], [5, 3, 'shakeout', 8, 8], [6, 0, 'rest', 8, 9], [7, 8, 'long', 7, 8], [8, 4, 'easy', 7, 8], [9, 6, 'workout', 7, 8], [10, 4, 'easy', 7, 8], [11, 5, 'easy', 7, 8], [12, 3, 'shakeout', 7, 8], [13, 0, 'rest', 8, 9]]),
    miles4: [29, 30, 29, 28], mpw: 29, vo2: 44, readiness: readiness(72, 'Good'), meets: [{ date: '2026-10-24', title: 'League Championship', time: '9:00 AM', location: 'Van Cortlandt Park' }],
  },
};

export const WHO = Object.keys(ARCHETYPES);

function deepMerge(a, b) {
  if (Array.isArray(b) || b === null || typeof b !== 'object') return b;
  const out = { ...(a && typeof a === 'object' && !Array.isArray(a) ? a : {}) };
  for (const [k, v] of Object.entries(b)) out[k] = k in out ? deepMerge(out[k], v) : v;
  return out;
}

// patch.mark: [[bodyPartId, 'sore' | 'pain'], ...]; patch.status: 'healthy' | 'injured' | 'sick'; patch.week: replace the plan week
// patch.log: replace the 14-day log; every other key is deep-merged into the context.
export function makeContext(who, patch = {}) {
  const a = ARCHETYPES[who];
  if (!a) throw new Error(`unknown archetype ${who}`);
  const { mark = [], status = 'healthy', week, log, ...rest } = patch;
  for (const [part] of mark) if (!BODY_PARTS[part]) throw new Error(`unknown body part ${part}`);
  const marked = mark.map(([part, st]) => ({ part, name: BODY_PARTS[part], status: st }));
  const logRows = log || a.log;
  const plan = week ? planWeek(week) : a.week;
  const hasPlan = !a.noPlan;
  const pace = pacesFrom5k(a.five);
  const zones = Object.fromEntries(pace.filter((z) => ['Easy', 'Recovery', 'Steady / marathon pace', 'Tempo (half-marathon pace)', 'Threshold (comfortably hard, ~1 hr race pace)', '5K pace', 'Mile pace'].includes(z.label)).map((z) => [z.label, z.per_mile]));
  const fiveSec = secs(a.five);
  const est = (label, sec, lo = 0.02, conf = 'medium', pr = null) => ({ event: label, time: clock(sec), pace_per_mile: null, likely_range: [clock(sec * (1 - lo)), clock(sec * (1 + lo))], confidence: conf, current_pr: pr });
  const conf = a.noPlan || a.name === 'Sam' ? 'low' : 'medium';
  const estimates = [est('1600', fiveSec * 0.265, 0.025, conf, a.prs['1600']), est('3200', fiveSec * 0.575, 0.025, conf, a.prs['3200']), est('5K', fiveSec, 0.022, conf, a.prs['5K'])];
  const todayDay = plan?.days.find((d) => d.date === TODAY) || null;
  const tomorrow = plan?.days.find((d) => d.date === addDays(TODAY, 1)) || null;
  const doneMiles = logRows.filter((l) => l.date >= MON && l.date <= TODAY && l.category !== 'crosstrain').reduce((s, l) => s + l.miles, 0);
  const health = {
    readiness: a.readiness,
    status: { health: status, recent: status !== 'healthy', training: '' },
    body: marked.map((m) => ({ ...m, recent: true })),
    resting_hr: { last7: 52, normal: 51 }, hrv: null,
    sleep: { last3: logRows.slice(0, 3).reduce((s, l) => s + (l.sleep_hours || 0), 0) / 3, last7: logRows.slice(0, 7).reduce((s, l) => s + (l.sleep_hours || 0), 0) / 7 },
    feel: { last7: Math.round((logRows.slice(0, 7).reduce((s, l) => s + (l.feel || 0), 0) / Math.max(1, logRows.slice(0, 7).length)) * 10) / 10, last: logRows[0]?.feel ?? null, last_date: logRows[0]?.date ?? null },
    load: { acute_7d: 310, weekly_normal: 300, ratio: 1.03 },
    miles: { last_7: Math.round(logRows.slice(0, 7).reduce((s, l) => s + l.miles, 0) * 10) / 10, weekly_avg_4wk: a.mpw },
    trend: [], missing: [], ran_today: false,
  };
  health.sleep.last3 = Math.round(health.sleep.last3 * 10) / 10;
  health.sleep.last7 = Math.round(health.sleep.last7 * 10) / 10;
  const lib = WORKOUTS.filter((w) => w.level <= 2).map((w) => ({ id: w.id, name: w.name, type: w.type, races: w.races, min: w.total_min, level: w.level, main: w.main }));
  const ctx = {
    athlete: a.name, today: TODAY, timezone: 'America/New_York', has_plan: hasPlan, max_hr_used: a.maxHr,
    this_week: hasPlan ? { week_of: MON, week_type: 'Normal', planned_miles: plan.planned_miles, miles_done: Math.round(doneMiles * 10) / 10, load: 150, avg_plan_score: 0.9, days: plan.days.map((d) => ({ date: d.date, day: d.day, planned: { type: d.base.type, miles: d.base.miles, detail: d.base.detail, notes: '' }, logged: logRows.filter((l) => l.date === d.date && l.miles > 0).map((l) => ({ category: l.category, miles: l.miles })) })) } : null,
    recent_workouts: logRows.filter((l) => l.miles > 0).slice(0, 6).map((l) => ({ date: l.date, category: l.category, distance_mi: l.miles, moving_sec: Math.round(l.minutes * 60) })),
    prs: a.prs, missing_prs: a.missing, five_k_time: a.five,
    fitness: { vo2max: a.vo2, race_vo2max: a.vo2, confidence: conf, based_on: Object.keys(a.prs).map((e) => `${e} PR`), race_estimates: Object.fromEntries(estimates.map((e) => [e.event, e.time])), paces_per_mile: zones, weekly_miles_last_4_weeks: a.mpw },
    body: { health: status, training: '', marked },
    training_log_last_14_days: logRows,
    runner: a.runner, goals: a.goals, cross_training_by_hand_last_14_days: [], fuel_last_7_days: null,
    workout_library: lib,
    weekly_totals_16_weeks: a.miles4.map((m, i) => ({ week_of: addDays(MON, -7 * (a.miles4.length - i)), miles: m })),
    all_workout_sessions: [],
    fitness_projections: {
      race_estimates: estimates, race_vo2max: a.vo2, vo2max_estimate: a.vo2, confidence: conf, profile: 'balanced',
      based_on: Object.entries(a.prs).map(([e, t]) => `${e} PR ${t}`),
      pace_zones_per_mile: zones,
      fitness_fatigue_form: { fitness: 38, fatigue: 41, form: -3, change_4wk: 2 },
      weekly_miles_last_4_weeks: a.mpw, weekly_miles_prior_4_weeks: a.miles4[0],
    },
    plan: hasPlan ? { today: todayDay, tomorrow, week: plan, level: a.level, changes: [] } : { today: null, tomorrow: null, week: null, level: null, changes: [] },
    health,
    upcoming_meets: a.meets,
  };
  return deepMerge(ctx, rest);
}
