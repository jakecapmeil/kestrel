// Calibration: how well Fitness States predicted what athletes then raced.
//
// Every day's whole estimate is kept (fitness_history.estimates), and every PR is matched to the estimate made before
// the race (pr_checks), so the model's misses can be measured per event and per athlete, and retrained from the
// inputs that were true at the time. The race itself is an input to every later estimate, so the match is always the
// last snapshot strictly before the race date.
import { parseTime, PR_FOR_ESTIMATE } from './fitness.js';

const DAY = 86400000;
// A snapshot older than this before the race is too stale to score the race against.
const MAX_GAP_DAYS = 14;
// The cron picks up athletes whose Fitness State is older than this, a few per hourly run, so everyone gets a daily snapshot.
const STALE_MS = 20 * 3600 * 1000;
const PER_CRON = 4;

const addDays = (date, n) => new Date(Date.parse(date + 'T12:00:00Z') + n * DAY).toISOString().slice(0, 10);
const round1 = (n) => Math.round(n * 10) / 10;
// The estimate row a PR key is scored against ('2000 SC' -> '2000SC'). Read at call time: fitness.js and this file import each other.
const estimateFor = (prKey) => Object.keys(PR_FOR_ESTIMATE).find((est) => PR_FOR_ESTIMATE[est] === prKey);

// The Fitness State as stored with each day: only what is needed to score it and retrain from it.
export function snapshotOf(data) {
  const est = {};
  for (const e of data.estimates || []) est[e.event] = [e.sec, e.lo ?? null, e.hi ?? null, e.confidence];
  const courses = {};
  for (const c of data.course_estimates || []) courses[c.key] = c.sec;
  return JSON.stringify({
    est, courses,
    models: { race: data.model, short: data.model_short, marathon: data.model_marathon, overrides: data.model_overrides || null },
    inputs: data.lite_inputs || [],
    confidence: data.confidence ?? null,
    longest_28d: data.longest_28d ?? null,
    load: data.fitness_score ? { fitness: data.fitness_score.fitness, fatigue: data.fitness_score.fatigue } : null,
  });
}

// prs: the athlete's normalized PR object. Matches every PR not yet checked (or whose time changed) with the estimate from before it. Safe to run on every
// recompute: a PR already in pr_checks costs no query.
export async function recordPrChecks(db, personId, prs, today) {
  const have = new Map((await db.prepare('SELECT event, pr_date, pr_sec FROM pr_checks WHERE person_id = ?').bind(personId).all()).results
    .map((r) => [`${r.event}|${r.pr_date}`, r.pr_sec]));
  const writes = [];
  for (const [event, v] of Object.entries(prs)) {
    const sec = parseTime(v?.time);
    if (!sec || !v?.date || v.date > today) continue;
    const prSec = round1(sec);
    if (have.get(`${event}|${v.date}`) === prSec) continue;
    const snap = await db.prepare(
      'SELECT date, estimates FROM fitness_history WHERE person_id = ? AND date < ? AND date >= ? AND estimates IS NOT NULL ORDER BY date DESC LIMIT 1'
    ).bind(personId, v.date, addDays(v.date, -MAX_GAP_DAYS)).first();
    let pred = null;
    let model = null;
    if (snap) {
      try {
        const s = JSON.parse(snap.estimates);
        model = s.models?.race || null;
        const row = s.est?.[estimateFor(event)];
        if (row) pred = { sec: row[0], lo: row[1], hi: row[2] };
        else if (typeof s.courses?.[event] === 'number') pred = { sec: s.courses[event], lo: null, hi: null };
      } catch { /* an unreadable snapshot just leaves the PR unscored */ }
    }
    writes.push(db.prepare(
      `INSERT INTO pr_checks (person_id, event, pr_date, pr_sec, auto, snap_date, pred_sec, pred_lo, pred_hi, error_pct, in_range, model, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(person_id, event, pr_date) DO UPDATE SET pr_sec = excluded.pr_sec, auto = excluded.auto, snap_date = excluded.snap_date,
         pred_sec = excluded.pred_sec, pred_lo = excluded.pred_lo, pred_hi = excluded.pred_hi, error_pct = excluded.error_pct,
         in_range = excluded.in_range, model = excluded.model`
    ).bind(
      personId, event, v.date, prSec, v.auto ? 1 : 0, pred ? snap.date : null,
      pred?.sec ?? null, pred?.lo ?? null, pred?.hi ?? null,
      pred ? round1(((prSec - pred.sec) / pred.sec) * 1000) / 10 : null,
      pred?.lo != null ? (prSec >= pred.lo && prSec <= pred.hi ? 1 : 0) : null,
      model, Date.now(),
    ));
  }
  if (writes.length) await db.batch(writes);
  return writes.length;
}

// A PR Kestrel took back (it was found on the wrong course): its check goes with it.
export function dropPrCheck(db, personId, event, date) {
  return db.prepare('DELETE FROM pr_checks WHERE person_id = ? AND event = ? AND pr_date = ? AND auto = 1').bind(personId, event, date || '').run();
}

// Hourly cron: recompute (and so snapshot) a few athletes whose Fitness State is more than 20 hours old, oldest first.
// Picking by the state's age, not by a missing history row, keeps athletes with no estimate yet from crowding out the rest.
export async function snapshotDue(env, today, recompute) {
  const due = (await env.DB.prepare(
    `SELECT p.id FROM people p LEFT JOIN fitness_states f ON f.person_id = p.id
     WHERE COALESCE(f.computed_at, 0) < ? ORDER BY COALESCE(f.computed_at, 0) ASC LIMIT ?`
  ).bind(Date.now() - STALE_MS, PER_CRON).all()).results;
  const out = [];
  for (const p of due) {
    try { await recompute(env.DB, p.id, today); out.push({ id: p.id }); } catch (err) { out.push({ id: p.id, error: err.message }); }
  }
  return out;
}

// For the athlete: the estimates over time, each PR against what was estimated, and how the misses add up per event.
export async function calibrationFor(db, personId, days = 120) {
  const [hist, checks] = await Promise.all([
    db.prepare("SELECT date, vdot AS vo2r, mpw, estimates FROM fitness_history WHERE person_id = ? AND date >= date('now', ?) ORDER BY date")
      .bind(personId, `-${days} days`).all(),
    db.prepare('SELECT event, pr_date, pr_sec, auto, snap_date, pred_sec, pred_lo, pred_hi, error_pct, in_range, model FROM pr_checks WHERE person_id = ? ORDER BY pr_date DESC').bind(personId).all(),
  ]);
  const snapshots = hist.results.map((r) => {
    let est = {};
    try { for (const [k, v] of Object.entries(JSON.parse(r.estimates || '{}').est || {})) est[k] = v[0]; } catch { /* old rows have none */ }
    return { date: r.date, vo2r: r.vo2r, mpw: r.mpw, est };
  });
  return { snapshots, checks: checks.results, summary: summarize(checks.results) };
}

export function summarize(checks) {
  const scored = checks.filter((c) => c.error_pct != null);
  const by = {};
  for (const c of scored) (by[c.event] ||= []).push(c);
  const stats = (rows) => {
    const ranged = rows.filter((c) => c.in_range != null);
    const mean = rows.reduce((a, c) => a + c.error_pct, 0) / rows.length;
    return {
      n: rows.length,
      mean_error_pct: round1(mean), // negative: this athlete races faster than Kestrel estimates
      mean_abs_error_pct: round1(rows.reduce((a, c) => a + Math.abs(c.error_pct), 0) / rows.length),
      in_range_pct: ranged.length ? Math.round((ranged.filter((c) => c.in_range).length / ranged.length) * 100) : null,
    };
  };
  return { prs: checks.length, scored: scored.length, overall: scored.length ? stats(scored) : null, by_event: Object.fromEntries(Object.entries(by).map(([e, rows]) => [e, stats(rows)])) };
}
