// The AI coach's side of the plan. The athlete's plan level (from their team's template or Kestrel's built-in
// plans) is the base and should be followed; the coach changes single days (from the chat, or automatically
// when readiness says so) and moves athletes up a plan level once they're ready.
//
// Guardrails, all enforced here rather than trusted to the AI:
//   - Days can always get easier, shorter, or become rest / cross-training.
//   - A day can grow by at most 20% (and 2 mi) of what the plan had; rest
//     days can only become an easy jog of 4 mi or less.
//   - No two hard days in a row (workout, race), and the week stays within
//     10% of the plan's weekly miles.
//   - Level ups need three steady weeks near the current plan's mileage, no
//     pain, no illness, decent feel and no load spike; one level at a time,
//     21 days apart, at most two levels above where the athlete started. Every change is logged.
import { plansOf, rankOf as planRank, milesOfRank } from './plans.js';
import { addDays, weekStartOf, planFor, plannedFor, meetDates, todayInTz, loadPerson as loadAthlete } from './coach.js';
import { BODY_PARTS } from './body.js';
import { workoutTargets } from './workouts.js';
import { getFitness } from './fitness.js';
import { getDays } from './log.js';

export class PlanError extends Error {}

export const DAY_TYPES = ['Easy', 'Recovery', 'Workout', 'Long run', 'Race', 'Shakeout', 'Cross-train', 'Off'];
const HARD = new Set(['Workout', 'Race']);
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const round1 = (n) => Math.round(n * 10) / 10;
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function normType(t) {
  const s = String(t || '').trim().toLowerCase();
  if (s === 'lr' || s.startsWith('long')) return 'Long run';
  if (s.startsWith('work')) return 'Workout';
  if (s.startsWith('race')) return 'Race';
  if (s.startsWith('shake')) return 'Shakeout';
  if (s.startsWith('cross')) return 'Cross-train';
  if (s.startsWith('recov')) return 'Recovery';
  if (s === 'off' || s === 'rest') return 'Off';
  return 'Easy';
}

const rankOf = (person) => planRank(person);

async function loadPerson(db, personId) {
  const p = await loadAthlete(db, personId);
  if (!p) throw new PlanError('Unknown person');
  return p;
}

// ------------------------------------------------------------------ health

// Readiness from the watch (resting HR, HRV, sleep), what the runner logged
// (feel, sleep), the body map and training load. HRV and resting HR are
// compared with the runner's own 4-week baseline, never a population norm.
export async function healthSummary(db, person, today) {
  const from = addDays(today, -34);
  const [well, days, runs, marks] = await Promise.all([
    db.prepare('SELECT date, resting_hr, hrv, sleep_hours, sleep_score FROM wellness WHERE person_id = ? AND date >= ? ORDER BY date').bind(person.id, from).all(),
    db.prepare('SELECT date, feel, sleep_hours FROM training_days WHERE person_id = ? AND date >= ? ORDER BY date').bind(person.id, addDays(today, -13)).all(),
    db.prepare("SELECT date, load, distance_mi, category FROM workouts WHERE person_id = ? AND date >= ?").bind(person.id, addDays(today, -27)).all(),
    db.prepare('SELECT part, status, updated_at FROM body_marks WHERE person_id = ?').bind(person.id).all(),
  ]);
  const w = well.results;
  const recent = (rows, n) => rows.filter((r) => r.date > addDays(today, -n));
  const base = w.filter((r) => r.date <= addDays(today, -7));
  const rhr7 = avg(recent(w, 7).map((r) => r.resting_hr).filter(Boolean));
  const rhrBase = avg(base.map((r) => r.resting_hr).filter(Boolean));
  const hrv7 = avg(recent(w, 7).map((r) => r.hrv).filter(Boolean));
  const hrvBase = avg(base.map((r) => r.hrv).filter(Boolean));
  // Sleep: the watch if it has it, else what the runner logged.
  const sleepByDate = new Map();
  days.results.forEach((d) => { if (d.sleep_hours) sleepByDate.set(d.date, d.sleep_hours); });
  // Watch sleep over 12 h is the watch counting time off-wrist or in bed, not sleep.
  w.forEach((r) => { if (r.sleep_hours >= 3 && r.sleep_hours <= 12) sleepByDate.set(r.date, r.sleep_hours); });
  const sleep3 = avg([...sleepByDate.entries()].filter(([d]) => d > addDays(today, -3)).map(([, h]) => h));
  const sleep7 = avg([...sleepByDate.entries()].filter(([d]) => d > addDays(today, -7)).map(([, h]) => h));
  const feels = days.results.filter((d) => d.feel != null);
  const feel3 = avg(feels.filter((d) => d.date > addDays(today, -5)).slice(-3).map((d) => d.feel));
  const feel7 = avg(feels.filter((d) => d.date > addDays(today, -7)).map((d) => d.feel));
  const load = (n) => runs.results.filter((r) => r.date > addDays(today, -n)).reduce((a, r) => a + (r.load || 0), 0);
  const acute = load(7);
  const chronic = load(28) / 4;
  const acwr = chronic > 50 ? Math.round((acute / chronic) * 100) / 100 : null;
  const miles = (n) => round1(runs.results.filter((r) => r.date > addDays(today, -n) && r.category !== 'crosstrain').reduce((a, r) => a + (r.distance_mi || 0), 0));

  // Only marks set in the last week count; older ones may just never have
  // been cleared, so Hawky asks about them instead of acting on them.
  const fresh = (t, days) => !!t && Date.now() - t < days * 86400000;
  const marked = marks.results.map((m) => ({ part: m.part, name: BODY_PARTS[m.part] || m.part, status: m.status, recent: fresh(m.updated_at, 7) }));
  const pain = marked.filter((m) => m.status === 'pain' && m.recent);
  const sore = marked.filter((m) => m.status === 'sore' && m.recent);
  const stale = marked.filter((m) => !m.recent);
  const statusRecent = fresh(person.health_updated_at, 14);

  let score = 80;
  const factors = [];
  const hit = (pts, why) => { score += pts; factors.push({ pts, why }); };
  if (person.health_status === 'sick' && statusRecent) { score = Math.min(score, 15); factors.push({ pts: -65, why: 'Marked sick' }); }
  if (person.health_status === 'injured' && statusRecent) { score = Math.min(score, 25); factors.push({ pts: -55, why: 'Marked injured' }); }
  if (person.health_status !== 'healthy' && person.health_status && !statusRecent) factors.push({ pts: 0, why: `Marked ${person.health_status} a while ago: still true?` });
  if (pain.length) hit(-25, `${pain.map((m) => m.name).join(', ')}: pain`);
  if (sore.length) hit(-6 * Math.min(2, sore.length), `${sore.map((m) => m.name).slice(0, 2).join(', ')}: sore`);
  if (stale.length) factors.push({ pts: 0, why: `${stale.map((m) => m.name).slice(0, 2).join(', ')} marked over a week ago: still there?` });
  if (hrv7 && hrvBase && base.filter((r) => r.hrv).length >= 7) {
    const pct = (hrv7 - hrvBase) / hrvBase;
    if (pct < -0.1) hit(-12, `HRV ${Math.round(-pct * 100)}% under your normal`);
    else if (pct > 0.05) hit(4, 'HRV above your normal');
  }
  if (rhr7 && rhrBase && base.filter((r) => r.resting_hr).length >= 7) {
    const d = rhr7 - rhrBase;
    if (d >= 4) hit(-10, `Resting HR ${Math.round(d)} bpm above normal`);
    else if (d >= 2) hit(-5, `Resting HR a bit high (+${Math.round(d)})`);
  }
  if (sleep3 != null) {
    if (sleep3 < 6.5) hit(-10, `Short sleep (${round1(sleep3)} h a night)`);
    else if (sleep3 < 7.5) hit(-4, `A little short on sleep (${round1(sleep3)} h)`);
    else if (sleep3 >= 8.5) hit(3, 'Sleeping well');
  }
  if (feel3 != null) {
    if (feel3 <= 4) hit(-12, `Feeling rough lately (${round1(feel3)}/10)`);
    else if (feel3 <= 6) hit(-4, `Feeling so-so (${round1(feel3)}/10)`);
    else if (feel3 >= 8) hit(4, `Feeling good (${round1(feel3)}/10)`);
  }
  if (acwr != null) {
    if (acwr > 1.5) hit(-10, `Load spiking (${acwr}x your normal)`);
    else if (acwr > 1.3) hit(-4, `Load climbing (${acwr}x your normal)`);
  }
  score = Math.max(5, Math.min(100, Math.round(score)));
  // With nothing to go on, a number would just be a guess.
  const anyData = w.length || feels.length || chronic > 0 || pain.length || sore.length || (statusRecent && person.health_status !== 'healthy');
  const label = !anyData ? 'Not enough data' : score >= 75 ? 'Ready' : score >= 55 ? 'Steady' : score >= 35 ? 'Take it easy' : 'Rest';
  if (!anyData) score = null;

  const missing = [];
  if (!w.length) missing.push('watch wellness (resting HR, HRV, sleep)');
  if (!feels.length) missing.push('how runs felt');
  return {
    readiness: { score, label, factors },
    status: { health: person.health_status || 'healthy', recent: statusRecent, training: person.training_status || '' },
    body: marked,
    resting_hr: rhr7 ? { last7: Math.round(rhr7), normal: rhrBase ? Math.round(rhrBase) : null } : null,
    hrv: hrv7 ? { last7: Math.round(hrv7), normal: hrvBase ? Math.round(hrvBase) : null } : null,
    sleep: sleep7 != null ? { last3: sleep3 != null ? round1(sleep3) : null, last7: round1(sleep7) } : null,
    feel: feel7 != null ? { last7: round1(feel7), last: feels[feels.length - 1].feel, last_date: feels[feels.length - 1].date } : null,
    load: { acute_7d: Math.round(acute), weekly_normal: Math.round(chronic), ratio: acwr },
    miles: { last_7: miles(7), weekly_avg_4wk: round1(miles(28) / 4) },
    trend: w.slice(-14).map((r) => ({ date: r.date, resting_hr: r.resting_hr, hrv: r.hrv, sleep_hours: r.sleep_hours })),
    missing,
  };
}

// ------------------------------------------------------------------ plan days

async function changesBetween(db, personId, from, to) {
  const rows = await db.prepare(
    'SELECT * FROM plan_changes WHERE person_id = ? AND date >= ? AND date <= ? AND cleared = 0 ORDER BY created_at'
  ).bind(personId, from, to).all();
  const byDate = new Map();
  rows.results.forEach((r) => byDate.set(r.date, r)); // latest wins
  return byDate;
}

function baseDay(plan, date, meets) {
  const p = plannedFor(plan, date, meets);
  if (!p) return null;
  const type = normType(p.type);
  return { type, miles: type === 'Off' ? 0 : p.miles, detail: p.detail, notes: p.notes || '', shoes: p.shoes || '', week: p.week };
}

// Which session to run on a plan workout or long-run day, from the coach's
// menu for the plan (first workout of the week -> the Tuesday menu, the
// second -> Thursday, long runs -> Sunday), rotating each week, with the
// runner's own rep targets.
function suggestSession(plan, date, type, weekDays, fitness) {
  const menus = plan?.ref?.sessions || [];
  let menu = null;
  if (type === 'Long run') menu = menus.find((m) => /sunday|long/i.test(m.title));
  else if (type === 'Workout') {
    const hardDays = weekDays.filter((d) => d.type === 'Workout').map((d) => d.date);
    const nth = hardDays.indexOf(date);
    menu = menus.filter((m) => !/sunday|long/i.test(m.title))[nth > 0 ? 1 : 0];
  }
  const items = (menu?.items || []).filter((i) => !/if tired/i.test(i));
  if (!items.length) return null;
  const weekNo = Math.floor(Date.parse(date + 'T12:00:00Z') / (7 * 86400000));
  const text = items[weekNo % items.length];
  return { text, targets: fitness?.vo2r ? workoutTargets({ main: text, paces: text, type: 'vo2' }, fitness) : [] };
}

// The rules Hawky applies by itself, only to today and tomorrow, only to make
// a day easier. A runner can always keep the plan instead.
function autoAdjust(base, health) {
  if (!base || base.type === 'Off') return null;
  const st = health.status.recent ? health.status.health : 'healthy';
  const pain = health.body.filter((m) => m.status === 'pain' && m.recent);
  // Race days are the coach's call: never changed automatically, only flagged.
  if (base.type === 'Race') {
    const why = st !== 'healthy' ? `you're marked ${st}` : pain.length ? `${pain[0].name} is marked pain` : '';
    return why ? { warning: `Race day and ${why}: check with your coach or a parent before racing.` } : null;
  }
  const hard = HARD.has(base.type) || base.type === 'Long run';
  if (st === 'sick') return { type: 'Off', miles: 0, reason: "You're marked sick: rest until you're better. Light walking is fine." };
  if (st === 'injured') return { type: 'Cross-train', miles: 0, detail: '30-40 min easy bike, pool or elliptical if it doesn\'t hurt', reason: "You're marked injured: cross-train, and tell your coach or a parent." };
  if (pain.length && hard) return { type: 'Easy', miles: Math.min(base.miles, 4), reason: `${pain[0].name} is marked pain: easy and short instead. Stop if it hurts.` };
  if (health.readiness.score != null && health.readiness.score < 35 && hard) return { type: 'Easy', miles: Math.min(base.miles, 5), reason: `Readiness is low (${health.readiness.score}): ${health.readiness.factors.filter((f) => f.pts < 0).map((f) => f.why).slice(0, 2).join('; ')}.` };
  if (health.load.ratio > 1.5 && HARD.has(base.type) && health.readiness.score != null && health.readiness.score < 55) return { type: 'Easy', miles: base.miles, reason: `Your load is spiking (${health.load.ratio}x normal) and readiness is ${health.readiness.score}: easy today, workout another day.` };
  return null;
}

// Every day of a Mon-Sun week as the runner should run it: the plan, or the
// change Hawky made, or (today/tomorrow) Hawky's readiness adjustment.
export async function planWeek(db, person, weekStart, today, health, fitness) {
  const plan = planFor(person);
  if (!plan) return null;
  const end = addDays(weekStart, 6);
  const [meets, changes] = await Promise.all([meetDates(db, person.id, weekStart, addDays(end, 6)), changesBetween(db, person.id, weekStart, end)]);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(weekStart, i);
    days.push(effectiveDay(date, baseDay(plan, date, meets), changes.get(date), today, health));
  }
  if (fitness !== undefined) {
    for (const d of days) {
      if ((d.type === 'Workout' || d.type === 'Long run') && !d.detail_set) d.session = suggestSession(plan, d.date, d.type, days, fitness);
      if (d.session && d.source === 'plan') d.detail = '';
    }
  }
  return {
    week_of: weekStart, week_type: days[0]?.base?.week || '',
    planned_miles: round1(days.reduce((a, d) => a + (d.base?.miles || 0), 0)),
    miles: round1(days.reduce((a, d) => a + (d.miles || 0), 0)),
    days,
  };
}

function effectiveDay(date, base, change, today, health) {
  // The plan's mileage cell ("7 (4 WO)") is only worth showing when it says more than the miles.
  const extra = base && !/^\s*\d+(\.\d+)?\s*$/.test(base.detail || '') ? base.detail : '';
  const day = { date, day: DOW[new Date(date + 'T12:00:00Z').getUTCDay()], base, source: 'plan', type: base?.type || 'Off', miles: base?.miles || 0, detail: extra, reason: '' };
  if (change) {
    if (change.source === 'athlete') { day.source = 'kept'; return day; }
    return { ...day, source: change.source, change_id: change.id, type: change.type, miles: change.miles ?? 0, detail: change.detail || '', detail_set: !!change.detail, reason: change.reason || '' };
  }
  if (health && (date === addDays(today, 1) || (date === today && !health.ran_today))) {
    const auto = autoAdjust(base, health);
    if (auto?.warning) return { ...day, warning: auto.warning };
    if (auto) return { ...day, source: 'auto', type: auto.type, miles: auto.miles, detail: auto.detail || '', reason: auto.reason };
  }
  return day;
}

// A change from Hawky's chat (or Hawky in Claude), checked against the
// guardrails above. Returns the saved change.
export async function applyPlanChange(db, person, raw, source = 'hawky') {
  const today = todayInTz();
  const date = String(raw?.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < today || date > addDays(today, 13)) throw new PlanError('The coach can change days from today to two weeks out.');
  const plan = planFor(person);
  if (!plan) throw new PlanError('No plan yet.');
  const type = normType(raw?.type);
  const meets = await meetDates(db, person.id, addDays(date, -7), addDays(date, 13));
  const base = baseDay(plan, date, meets);
  let miles = type === 'Off' || type === 'Cross-train' ? 0 : Math.round(Number(raw?.miles) * 10) / 10;
  if (type !== 'Off' && type !== 'Cross-train' && !(miles > 0 && miles <= 30)) throw new PlanError('Give the day a distance in miles.');
  if (base && base.miles > 0 && miles > Math.min(base.miles * 1.2, base.miles + 2) + 0.05) {
    throw new PlanError(`That's more than the plan allows for ${DOW[new Date(date + 'T12:00:00Z').getUTCDay()]} (${base.type} ${base.miles} mi): at most ${round1(Math.min(base.miles * 1.2, base.miles + 2))} mi.`);
  }
  if ((!base || base.miles === 0) && (miles > 4 || HARD.has(type) || type === 'Long run')) throw new PlanError('A rest day can only become an easy jog of 4 miles or less.');
  if (HARD.has(type)) {
    const ws = weekStartOf(date);
    const wk = await planWeek(db, person, ws, today, null);
    const next = ws === weekStartOf(addDays(date, 1)) ? null : await planWeek(db, person, weekStartOf(addDays(date, 1)), today, null);
    const around = [...(wk?.days || []), ...(next?.days || [])].filter((d) => d.date === addDays(date, -1) || d.date === addDays(date, 1));
    if (around.some((d) => HARD.has(d.type))) throw new PlanError('No hard days back to back: move the other workout first, or make this one easy.');
  }
  const ws = weekStartOf(date);
  const wk = await planWeek(db, person, ws, today, null);
  if (wk) {
    const total = wk.days.reduce((a, d) => a + (d.date === date ? miles : d.miles), 0);
    const cap = wk.planned_miles * 1.1;
    if (total > cap + 0.05) throw new PlanError(`That would put the week at ${round1(total)} mi, over the plan's limit (${round1(cap)} mi).`);
  }
  const id = 'pc_' + crypto.randomUUID();
  await db.prepare(
    'INSERT INTO plan_changes (id, person_id, date, type, miles, detail, reason, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, person.id, date, type, miles, String(raw?.detail || '').slice(0, 300), String(raw?.reason || '').slice(0, 300), source, Date.now()).run();
  return { id, date, type, miles, detail: raw?.detail || '', reason: raw?.reason || '' };
}

// Undo: back to the plan. For a readiness adjustment (nothing stored), this
// records that the runner chose to keep the plan.
export async function resetPlanDay(db, personId, date, keepPlan) {
  await db.prepare('UPDATE plan_changes SET cleared = 1 WHERE person_id = ? AND date = ? AND cleared = 0').bind(personId, date).run();
  if (keepPlan) {
    await db.prepare("INSERT INTO plan_changes (id, person_id, date, type, source, created_at) VALUES (?, ?, ?, 'Easy', 'athlete', ?)")
      .bind('pc_' + crypto.randomUUID(), personId, date, Date.now()).run();
  }
}

// ------------------------------------------------------------------ levels

async function weeklyMiles(db, personId, weekStart) {
  const end = addDays(weekStart, 6);
  const [runs, manual] = await Promise.all([
    db.prepare("SELECT date, SUM(distance_mi) AS mi FROM workouts WHERE person_id = ? AND date >= ? AND date <= ? AND category != 'crosstrain' GROUP BY date").bind(personId, weekStart, end).all(),
    db.prepare('SELECT date, manual_miles AS mi FROM training_days WHERE person_id = ? AND date >= ? AND date <= ? AND manual_miles > 0').bind(personId, weekStart, end).all(),
  ]);
  const byDate = new Map(manual.results.map((r) => [r.date, r.mi]));
  runs.results.forEach((r) => byDate.set(r.date, r.mi));
  return round1([...byDate.values()].reduce((a, b) => a + (b || 0), 0));
}

export async function levelStatus(db, person, today, health) {
  const rank = rankOf(person);
  if (!rank) return null;
  const coach = person.coach_rank ?? rank;
  const cap = Math.min(6, coach + 2);
  const target = milesOfRank(person, rank);
  const thisWeek = weekStartOf(today);
  const weeks = [];
  for (let i = 3; i >= 1; i--) weeks.push({ week_of: addDays(thisWeek, -7 * i), miles: await weeklyMiles(db, person.id, addDays(thisWeek, -7 * i)) });
  const last = await db.prepare('SELECT created_at, to_rank, from_rank FROM level_changes WHERE person_id = ? ORDER BY created_at DESC LIMIT 1').bind(person.id).first();
  const daysSince = last ? Math.floor((Date.now() - last.created_at) / 86400000) : null;
  const pain = health.body.some((m) => m.status === 'pain' && m.recent);
  const soonMeets = await meetDates(db, person.id, today, addDays(today, 14));
  const gates = [
    { ok: weeks.every((w) => w.miles >= target * 0.85), label: `3 weeks near ${target} mi (${weeks.map((w) => w.miles).join(', ')})` },
    { ok: (health.status.health === 'healthy' || !health.status.recent) && !pain, label: 'Healthy, nothing marked pain' },
    { ok: !health.feel || health.feel.last7 >= 6, label: health.feel ? `Feeling ${health.feel.last7}/10 on average` : 'Feel not logged (counts as fine)' },
    { ok: health.load.ratio == null || health.load.ratio <= 1.3, label: health.load.ratio == null ? 'Load steady' : `Load ${health.load.ratio}x normal (needs 1.3 or less)` },
    { ok: daysSince == null || daysSince >= 21, label: daysSince == null ? 'No recent level change' : `${daysSince} days since the last change (needs 21)` },
    { ok: !soonMeets.length, label: soonMeets.length ? 'No meets in the next 2 weeks (not during race season)' : 'No meets in the next 2 weeks' },
    { ok: rank < cap, label: rank < cap ? 'Room to move up' : 'Two levels above where you started: the most the coach moves you by itself' },
  ];
  return {
    weekly_miles: target,
    next_weekly_miles: rank < cap ? milesOfRank(person, rank + 1) : null,
    ready: gates.every((g) => g.ok),
    gates,
    recent_weeks: weeks,
    _rank: rank, _cap: cap,
  };
}

async function setRank(db, person, to, reason, source) {
  const from = rankOf(person);
  await db.batch([
    db.prepare('UPDATE people SET plan_rank = ?, coach_rank = COALESCE(coach_rank, ?) WHERE id = ?').bind(to, from, person.id),
    db.prepare('INSERT INTO level_changes (id, person_id, from_rank, to_rank, reason, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind('lc_' + crypto.randomUUID(), person.id, from, to, String(reason || '').slice(0, 300), source, Date.now()),
  ]);
  person.plan_rank = to;
  return { from_miles: milesOfRank(person, from), to_miles: milesOfRank(person, to) };
}

// Hawky moves a runner up by itself early in the week, so a week's plan
// never changes halfway through.
export async function autoLevel(db, person, today, health) {
  const dow = new Date(today + 'T12:00:00Z').getUTCDay();
  if (dow < 1 || dow > 3) return null;
  const st = await levelStatus(db, person, today, health);
  if (!st?.ready) return null;
  const moved = await setRank(db, person, st._rank + 1, `Three steady weeks at about ${st.weekly_miles} mi, healthy and feeling good.`, 'auto');
  return { ...moved, reason: 'Three steady weeks near your mileage, healthy and feeling good.' };
}

// From the chat: up only when the gates pass, down whenever there's a reason.
export async function changeLevel(db, person, direction, reason, today, health) {
  const st = await levelStatus(db, person, today, health);
  if (!st) throw new PlanError('No plan yet.');
  if (direction === 'up') {
    if (!st.ready) throw new PlanError(`Not ready to level up yet: ${st.gates.filter((g) => !g.ok).map((g) => g.label).join('; ')}.`);
    return await setRank(db, person, st._rank + 1, reason || 'Ready for more', 'hawky');
  }
  if (direction === 'down') {
    if (st._rank <= 1) throw new PlanError('Already on the lightest plan.');
    return await setRank(db, person, st._rank - 1, reason || 'Backing off', 'hawky');
  }
  throw new PlanError('direction must be up or down');
}

// ------------------------------------------------------------------ state

export async function hawkyState(db, personId, today = todayInTz()) {
  const person = await loadPerson(db, personId);
  let health = await healthSummary(db, person, today);
  health.ran_today = !!(await db.prepare("SELECT 1 FROM workouts WHERE person_id = ? AND date = ? AND category != 'crosstrain' LIMIT 1").bind(person.id, today).first());
  const leveled = await autoLevel(db, person, today, health);
  const fitness = await getFitness(db, person.id, today);
  const week = await planWeek(db, person, weekStartOf(today), today, health, fitness);
  const tomorrowDate = addDays(today, 1);
  const tomorrowWeek = weekStartOf(tomorrowDate) === weekStartOf(today) ? week : await planWeek(db, person, weekStartOf(tomorrowDate), today, health, fitness);
  const level = await levelStatus(db, person, today, health);
  // What's already been run today, session by session, for the Today card.
  const ranToday = health.ran_today ? (await getDays(db, person.id, today, today))[0] : null;
  const upcoming = await db.prepare(
    "SELECT id, date, type, miles, detail, reason, source FROM plan_changes WHERE person_id = ? AND date >= ? AND cleared = 0 AND source != 'athlete' ORDER BY date"
  ).bind(person.id, today).all();
  const levels = await db.prepare('SELECT from_rank, to_rank, reason, source, created_at FROM level_changes WHERE person_id = ? ORDER BY created_at DESC LIMIT 5').bind(person.id).all();
  const strip = (l) => l && { weekly_miles: l.weekly_miles, next_weekly_miles: l.next_weekly_miles, ready: l.ready, gates: l.gates, recent_weeks: l.recent_weeks };
  return {
    today: week?.days.find((d) => d.date === today) || null,
    today_done: ranToday ? {
      miles: ranToday.miles, minutes: ranToday.minutes, difficulty: ranToday.difficulty, plan: ranToday.plan,
      sessions: ranToday.sessions.map((s) => ({ key: s.key, category: s.category, title: s.title, start: s.start, miles: s.miles, minutes: s.minutes, pace: s.pace, avg_hr: s.avg_hr, effort: s.effort, temp_f: s.temp_f, dew_point_f: s.dew_point_f, elev_ft: s.elev_ft })),
    } : null,
    tomorrow: tomorrowWeek?.days.find((d) => d.date === tomorrowDate) || null,
    week,
    health,
    level: strip(level),
    leveled_up: leveled,
    changes: upcoming.results,
    level_history: levels.results.map((l) => ({
      from_miles: milesOfRank(person, l.from_rank), to_miles: milesOfRank(person, l.to_rank),
      reason: l.reason, source: l.source, date: todayInTz(new Date(l.created_at)),
    })),
  };
}
