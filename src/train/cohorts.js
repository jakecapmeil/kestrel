// "Runners like you": how a runner's last 16 weeks of training compare with real marathoners (BMClab 2019, CC BY 4.0; research/hawkspredict/scripts/exp22_cohorts.py).
// Only aggregate tables ship (cohorts.json): for a goal finish time, what those finishers trained; for a training volume and pace, how they finished.
// The data are runs logged on one running social network by adults, so they undercount training done off-platform and say nothing about teenagers.
import COH from './cohorts.json' with { type: 'json' };
import { modelSet, pickedModels } from '../models.js';
import { todayInTz } from './coach.js';
import { parseClock, fmtClock } from './calculators.js';

const KM = 1.609344;
export const COHORT_INFO = { source: COH.source, n: COH.n };

// Where v falls in a distribution given by its 10/25/50/75/90th percentiles, as a rough percentile (clamped to 5-95).
export function percentileIn(arr, v) {
  const P = COH.pct;
  if (v <= arr[0]) return Math.max(5, Math.round(P[0] * (arr[0] > 0 ? Math.max(v, 0) / arr[0] : 0)));
  for (let i = 1; i < arr.length; i++) {
    if (v <= arr[i]) return Math.round(P[i - 1] + ((v - arr[i - 1]) / Math.max(arr[i] - arr[i - 1], 1e-9)) * (P[i] - P[i - 1]));
  }
  return Math.min(95, Math.round(P[P.length - 1] + 5));
}

export function goalCohort(goalSec) {
  return COH.goal.find((g) => goalSec >= g.lo && goalSec < g.hi) || null;
}

export function likeCell(wkMi, paceMi) {
  const { weekly_miles_edges: we, pace_edges: pe } = COH.like;
  const idx = (edges, x) => { for (let i = 0; i < edges.length - 1; i++) if (x >= edges[i] && x < edges[i + 1]) return i; return edges.length - 2; };
  const w = idx(we, wkMi), p = idx(pe, paceMi);
  const cell = COH.like.cells.find((c) => c.w === w && c.p === p) || null;
  return cell && { ...cell, weekly_miles: [we[w], we[w + 1]], pace: [pe[p], pe[p + 1]] };
}

const r1 = (x) => Math.round(x * 10) / 10;
const pace = (m) => { const s = Math.round(m * 60); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export async function cohortReport(db, personId, goalText) {
  const today = todayInTz();
  const since = new Date(Date.parse(today + 'T12:00:00Z') - 120 * 86400000).toISOString().slice(0, 10);
  const { results } = await db.prepare('SELECT date, distance_mi, moving_sec, category FROM workouts WHERE person_id = ? AND date >= ?').bind(personId, since).all();
  const person = await db.prepare('SELECT settings, sex FROM people WHERE id = ?').bind(personId).first();
  const mar = modelSet(await pickedModels(db, personId, person?.settings), person?.sex).marathon(results, today);
  if (!mar) return { error: 'Needs at least 15 running days in the last 16 weeks of watch runs.' };
  const f = mar.feats;
  const you = { weekly_miles: r1(f.wk_mean / KM), last6_miles: r1(f.wk_last6 / KM), longest_mi: r1(f.longest / KM), long10: f.long16_n, days_wk: r1(f.runs_wk), pace_mi: r1(f.pace_med * KM) };
  const out = { you: { ...you, pace_text: pace(you.pace_mi), run_days: mar.run_days }, predicted: { time: fmtClock(mar.sec), range: `${fmtClock(mar.lo)}-${fmtClock(mar.hi)}` }, source: COH.source, n: COH.n };

  const cell = likeCell(you.weekly_miles, you.pace_mi);
  if (cell) out.like = { n: cell.n, weekly_miles: cell.weekly_miles, pace: cell.pace.map(pace), finish: cell.finish.map(fmtClock), percentiles: COH.pct };

  if (goalText) {
    const goal = parseClock(goalText);
    if (!goal || goal < 7200 || goal > 25200) return { ...out, goal_error: 'Enter a goal marathon time like 3:30:00 (between 2:00:00 and 7:00:00).' };
    const g = goalCohort(goal);
    if (!g) return { ...out, goal_error: 'Not enough real marathons near that time to compare (2:30 to 6:30 is covered).' };
    const row = (label, key, mine, unit) => ({ label, unit, you: mine, typical: g[key][2], middle_half: [g[key][1], g[key][3]], you_percentile: percentileIn(g[key], mine) });
    out.goal = {
      time: fmtClock(goal), finishers: g.n, band: `${fmtClock(g.lo)}-${fmtClock(g.hi)}`,
      rows: [
        row('Miles a week (16-week average)', 'wk_mi', you.weekly_miles, 'mi'),
        row('Miles a week, last 6 weeks', 'last6_mi', you.last6_miles, 'mi'),
        row('Longest run', 'longest_mi', you.longest_mi, 'mi'),
        row('Runs of 10+ miles', 'long10', you.long10, ''),
        row('Running days a week', 'days_wk', you.days_wk, ''),
        { ...row('Typical training pace (min/mi)', 'pace_mi', you.pace_mi, ''), you_text: pace(you.pace_mi), typical_text: pace(g.pace_mi[2]), middle_half_text: [pace(g.pace_mi[1]), pace(g.pace_mi[3])] },
      ],
    };
  }
  return out;
}
