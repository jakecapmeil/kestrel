// Race predictor card: the same KestrelPredict-Lite numbers Fitness States use,
// with their 80% ranges, plus an experimental heart-rate adjustment, and the
// next meet's predictions logged so real results can score them.
// Behind env.KESTREL_PREDICT === '1'.
import { getPrs } from './log.js';
import { getFitness, fmtTime } from './fitness.js';
import { heatCost, hillCost } from './conditions.js';

const DAY = 86400000;
const MILE = 1609.344;
// The estimate rows the card shows, plus a row for each course the runner follows.
const ROWS = [
  { key: '800', label: '800m' },
  { key: '1600', label: '1600m' },
  { key: '3200', label: '3200m' },
  { key: '5K', label: '5K' },
];
// The heart-rate layer is exploratory: a quarter of the fitness change, never more than 3%.
const HR_SHRINK = 0.25;
const HR_CAP = 0.03;
const MODEL_TAG = 'KestrelPredict-Lite v1.1 fitness-states';

const addDays = (date, n) => new Date(Date.parse(date + 'T12:00:00Z') + n * DAY).toISOString().slice(0, 10);
const vo2At = (v) => -4.6 + 0.182258 * v + 0.000104 * v * v;

function hashOf(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16);
}

// Median heart-rate fitness (race VO2max-like) of steady runs in the 56 days before asOf.
function hrFitness(workouts, hrMax, asOf) {
  const from = addDays(asOf, -56);
  const est = [];
  for (const w of workouts) {
    if (w.date >= asOf || w.date < from) continue;
    if (!w.avg_hr || !w.distance_mi || !w.moving_sec || w.distance_mi < 2.5 || w.moving_sec < 1200) continue;
    if (!['easy', 'long', 'workout', 'recovery'].includes(w.category)) continue;
    if (w.laps && w.category === 'workout') continue;
    if ((w.elev_gain_ft || 0) / w.distance_mi > 150) continue;
    const pHr = w.avg_hr / hrMax;
    if (pHr < 0.65 || pHr > 0.93) continue;
    const worth = (1 + heatCost(w.temp_f, w.dew_point_f)) * (1 + (w.surface === 'track' ? 0 : hillCost(w.elev_gain_ft, w.distance_mi)));
    const v = ((w.distance_mi * MILE) / (w.moving_sec / 60)) * worth;
    est.push(vo2At(v) / ((pHr - 0.37) / 0.64));
  }
  if (est.length < 4) return null;
  est.sort((a, b) => a - b);
  return { fit: est[Math.floor(est.length / 2)], n: est.length };
}

export async function racePredictions(env, personId, today) {
  const db = env.DB;
  const fitness = await getFitness(db, personId, today);
  const model = { name: 'KestrelPredict-Lite', version: 'v1.1' };
  if (!fitness?.model) return { enabled: true, model, predictions: [], reason: 'Add a race or PR (or two) and KestrelPredict can predict your other events.' };

  // Exploratory heart-rate layer: fitness now vs. fitness when the newest result was set.
  let hr = null;
  const newest = (fitness.lite_inputs || []).filter((i) => i.date).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  const maxRow = await db.prepare('SELECT MAX(max_hr) AS m FROM workouts WHERE person_id = ?').bind(personId).first();
  const hrMax = maxRow?.m >= 175 ? maxRow.m : null;
  if (hrMax && newest) {
    const { results: workouts } = await db.prepare(
      `SELECT date, category, distance_mi, moving_sec, avg_hr, elev_gain_ft, laps, surface, temp_f, dew_point_f
       FROM workouts WHERE person_id = ? AND date >= ? AND date <= ?`
    ).bind(personId, addDays(newest.date, -56), today).all();
    const now = hrFitness(workouts, hrMax, addDays(today, 1));
    const then = hrFitness(workouts, hrMax, newest.date);
    if (now && then) {
      const delta = Math.log(now.fit / then.fit);
      const applied = Math.max(-HR_CAP, Math.min(HR_CAP, HR_SHRINK * delta));
      hr = { delta_pct: Math.round(delta * 1000) / 10, applied_pct: Math.round(applied * 1000) / 10, runs_now: now.n, runs_then: then.n, since: newest.date, factor: Math.exp(-applied) };
    }
  }

  const prs = await getPrs(db, personId);
  const rows = [];
  for (const r of ROWS) {
    const e = fitness.estimates.find((x) => x.event === r.key);
    if (e?.lo) rows.push({ key: r.key, label: r.label, sec: e.sec, lo: e.lo, hi: e.hi, pr: prs[r.key]?.time || null });
  }
  // The courses the runner follows (the 5K at Van Cortlandt, ...): the same fitness times each course's factor.
  const five = fitness.estimates.find((x) => x.event === '5K');
  if (five?.lo) {
    for (const ce of fitness.course_estimates || []) {
      const k = ce.sec / five.sec;
      rows.push({ key: ce.key, label: ce.label, sec: five.sec * k, lo: five.lo * k, hi: five.hi * k, pr: ce.pr?.time || null });
    }
  }
  const predictions = rows.map((p) => {
    const f = (x) => fmtTime(x);
    const adj = hr ? { sec: p.sec * hr.factor, lo: p.lo * hr.factor, hi: p.hi * hr.factor } : null;
    return {
      event: p.key, label: p.label, pr: p.pr,
      raw: { sec: p.sec, lo: p.lo, hi: p.hi, time: f(p.sec), lo_time: f(p.lo), hi_time: f(p.hi) },
      adjusted: adj && { ...adj, time: f(adj.sec), lo_time: f(adj.lo), hi_time: f(adj.hi) },
    };
  });

  // Lock the first prediction for the next meet (within two weeks).
  const meet = await db.prepare(
    `SELECT e.date, e.title FROM events e JOIN team_members tm ON tm.team_id = e.team_id AND tm.person_id = ?
     WHERE e.type = 'meet' AND e.date >= ? AND e.date <= ? ORDER BY e.date LIMIT 1`
  ).bind(personId, today, addDays(today, 14)).first();
  if (meet && predictions.length) {
    const hash = hashOf((fitness.lite_inputs || []).map((i) => `${i.m}=${i.sec}`).sort().join('|'));
    await db.batch(predictions.map((p) => db.prepare(
      `INSERT OR IGNORE INTO prediction_log (person_id, event, race_date, model, inputs_hash, raw_sec, raw_lo, raw_hi, adj_sec, adj_lo, adj_hi, hr_delta, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(personId, p.event, meet.date, MODEL_TAG, hash, p.raw.sec, p.raw.lo, p.raw.hi, p.adjusted?.sec ?? null, p.adjusted?.lo ?? null, p.adjusted?.hi ?? null, hr?.delta_pct ?? null, Date.now())));
  }
  return { enabled: true, model, predictions, hr: hr && { ...hr, factor: undefined }, next_meet: meet ? { date: meet.date, title: meet.title } : null };
}
