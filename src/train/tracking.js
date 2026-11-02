// Cross-training, fueling and goals: the Train tabs a runner fills in themself, plus the preferences that let them
// choose which Train tabs they see. Everything here is personal and never shown to teammates.
//
// Fueling targets follow the joint sports-nutrition position (Academy of Nutrition and Dietetics, Dietitians of
// Canada and ACSM, 2016): daily carbohydrate scaled to the day's training, protein 1.2-2.0 g/kg, and 30-90 g of
// carbohydrate an hour in runs past about 75 minutes. Kestrel shows fueling, never a calorie deficit, and points a
// runner who keeps logging less than their training needs to a coach, parent or doctor (low energy availability, RED-S).
// Cross-training load is session RPE (minutes x effort 1-10, Foster 2001), the same unit coaches use for any sport.
// Race goals read the runner's Fitness States estimate; equivalent times at other distances use Riegel (t2 = t1 (d2/d1)^1.06).
import { parseTime, fmtTime } from '../events.js';

export class TrackError extends Error {}

const DAY = 86400000;
const MILE = 1609.344;
const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * DAY).toISOString().slice(0, 10);
const mondayOf = (d) => { const t = new Date(d + 'T12:00:00Z'); return addDays(d, -((t.getUTCDay() + 6) % 7)); };
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !Number.isNaN(Date.parse(s));
const str = (v, n) => String(v ?? '').trim().slice(0, n);
const num = (v, lo, hi) => { if (v === '' || v == null) return null; const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n * 10) / 10 : null; };
const round1 = (n) => Math.round(n * 10) / 10;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const newId = (p) => p + [...crypto.getRandomValues(new Uint8Array(9))].map((b) => b.toString(16).padStart(2, '0')).join('');

// ------------------------------------------------------------------ preferences

// Every Train tab, in the default order. `plan` can't be hidden: it's where the app lands.
export const TRAIN_TABS = [
  { key: 'plan', label: 'Plan' },
  { key: 'log', label: 'Log' },
  { key: 'goals', label: 'Goals' },
  { key: 'xtrain', label: 'Cross-train' },
  { key: 'food', label: 'Fuel' },
  { key: 'library', label: 'Workouts' },
  { key: 'fitness', label: 'Fitness' },
  { key: 'kai', label: 'Coach' },
];
const TAB_KEYS = TRAIN_TABS.map((t) => t.key);

export const XT_SPORTS = [
  { key: 'bike', label: 'Bike' },
  { key: 'indoor_bike', label: 'Indoor bike' },
  { key: 'swim', label: 'Swim' },
  { key: 'pool_run', label: 'Pool running' },
  { key: 'elliptical', label: 'Elliptical' },
  { key: 'row', label: 'Rowing' },
  { key: 'strength', label: 'Strength' },
  { key: 'mobility', label: 'Yoga or mobility' },
  { key: 'walk', label: 'Walk or hike' },
  { key: 'ski', label: 'Skiing' },
  { key: 'sport', label: 'Team sport' },
  { key: 'other', label: 'Other' },
];
// intervals.icu activity types -> our sports (anything else is "other").
const ICU_SPORT = {
  Ride: 'bike', GravelRide: 'bike', MountainBikeRide: 'bike', EBikeRide: 'bike', VirtualRide: 'indoor_bike', Velomobile: 'bike',
  Swim: 'swim', OpenWaterSwim: 'swim', Elliptical: 'elliptical', Rowing: 'row', VirtualRow: 'row', Canoeing: 'row', Kayaking: 'row',
  WeightTraining: 'strength', Crossfit: 'strength', Workout: 'strength', HighIntensityIntervalTraining: 'strength',
  Yoga: 'mobility', Pilates: 'mobility', Walk: 'walk', Hike: 'walk', StairStepper: 'elliptical',
  NordicSki: 'ski', BackcountrySki: 'ski', AlpineSki: 'ski', RollerSki: 'ski', Snowshoe: 'walk',
  Soccer: 'sport', Basketball: 'sport', Tennis: 'sport', Squash: 'sport', Badminton: 'sport', Pickleball: 'sport',
};

export const MEALS = [
  { key: 'breakfast', label: 'Breakfast' },
  { key: 'lunch', label: 'Lunch' },
  { key: 'dinner', label: 'Dinner' },
  { key: 'snack', label: 'Snack' },
  { key: 'before', label: 'Before a run' },
  { key: 'during', label: 'During a run' },
  { key: 'after', label: 'After a run' },
];
const MEAL_KEYS = MEALS.map((m) => m.key);

const DEFAULT_PREFS = {
  train_tabs: TAB_KEYS,
  xt_sports: [],
  food: { show_kcal: false, show_fat: false, show_fluid: true, carbs: null, protein: null },
};

export function prefsOf(settings) {
  const p = settings?.prefs || {};
  const tabs = Array.isArray(p.train_tabs) ? p.train_tabs.filter((k) => TAB_KEYS.includes(k)) : DEFAULT_PREFS.train_tabs;
  return {
    train_tabs: tabs.includes('plan') ? tabs : ['plan', ...tabs],
    xt_sports: Array.isArray(p.xt_sports) ? p.xt_sports : [],
    food: { ...DEFAULT_PREFS.food, ...(p.food || {}) },
  };
}

// Only known keys survive; custom sports are short labels, at most 12.
export function cleanPrefs(b, current) {
  const out = { ...current };
  if (Array.isArray(b.train_tabs)) {
    const tabs = [...new Set(b.train_tabs.map(String))].filter((k) => TAB_KEYS.includes(k));
    out.train_tabs = tabs.includes('plan') ? tabs : ['plan', ...tabs];
  }
  if (Array.isArray(b.xt_sports)) out.xt_sports = [...new Set(b.xt_sports.map((s) => str(s, 30)).filter(Boolean))].slice(0, 12);
  if (b.food && typeof b.food === 'object') {
    const f = { ...current.food };
    for (const k of ['show_kcal', 'show_fat', 'show_fluid']) if (k in b.food) f[k] = !!b.food[k];
    // A custom band in g/kg, or null for Kestrel's training-scaled default.
    const band = (v, lo, hi) => (Array.isArray(v) && v.length === 2 && num(v[0], lo, hi) !== null && num(v[1], lo, hi) !== null && Number(v[0]) <= Number(v[1]) ? [num(v[0], lo, hi), num(v[1], lo, hi)] : null);
    if ('carbs' in b.food) f.carbs = band(b.food.carbs, 3, 14);
    if ('protein' in b.food) f.protein = band(b.food.protein, 0.8, 2.5);
    out.food = f;
  }
  return out;
}

export function trackMeta(prefs) {
  return {
    tabs: TRAIN_TABS,
    sports: [...XT_SPORTS, ...prefs.xt_sports.map((s) => ({ key: 'c:' + s, label: s, custom: true }))],
    meals: MEALS,
  };
}

// ------------------------------------------------------------------ training by day

// Running miles and minutes per day (synced runs, else what the runner typed on the log) and cross-training minutes
// per day (synced and by hand), from `from` to `to`.
async function dayTotals(db, personId, from, to) {
  const days = {};
  const at = (d) => (days[d] ||= { run_mi: 0, run_min: 0, runs: 0, xt_min: 0, longest_min: 0 });
  const { results: ws } = await db.prepare(
    'SELECT date, category, distance_mi, moving_sec FROM workouts WHERE person_id = ? AND date >= ? AND date <= ?'
  ).bind(personId, from, to).all();
  const synced = new Set();
  for (const w of ws) {
    const d = at(w.date);
    const min = (w.moving_sec || 0) / 60;
    if (w.category === 'crosstrain') { d.xt_min += min; continue; }
    synced.add(w.date);
    d.run_mi += w.distance_mi || 0; d.run_min += min; d.runs++;
    d.longest_min = Math.max(d.longest_min, min);
  }
  const { results: td } = await db.prepare(
    'SELECT date, manual_miles, minutes, runs FROM training_days WHERE person_id = ? AND date >= ? AND date <= ?'
  ).bind(personId, from, to).all();
  for (const t of td) {
    if (synced.has(t.date) || !(t.manual_miles > 0)) continue;
    const d = at(t.date);
    d.run_mi += t.manual_miles; d.run_min += t.minutes || 0; d.runs += t.runs || 1;
    d.longest_min = Math.max(d.longest_min, t.minutes || 0);
  }
  const { results: xs } = await db.prepare('SELECT date, minutes FROM xtrain WHERE person_id = ? AND date >= ? AND date <= ?').bind(personId, from, to).all();
  for (const x of xs) at(x.date).xt_min += x.minutes || 0;
  return days;
}

// The last `weeks` Monday-to-Sunday weeks ending with this one.
async function weeklyRunning(db, personId, today, weeks) {
  const first = addDays(mondayOf(today), -7 * (weeks - 1));
  const days = await dayTotals(db, personId, first, today);
  const out = [];
  for (let i = 0; i < weeks; i++) {
    const start = addDays(first, 7 * i);
    let mi = 0, runs = 0, min = 0, xt = 0, longest = 0;
    for (let j = 0; j < 7; j++) {
      const d = days[addDays(start, j)];
      if (!d) continue;
      mi += d.run_mi; runs += d.runs; min += d.run_min; xt += d.xt_min; longest = Math.max(longest, d.longest_min);
    }
    out.push({ week: start, miles: round1(mi), runs, run_min: Math.round(min), xt_min: Math.round(xt), current: i === weeks - 1 });
  }
  return out;
}

// ------------------------------------------------------------------ cross-training

const sportLabel = (key) => XT_SPORTS.find((s) => s.key === key)?.label || (key?.startsWith('c:') ? key.slice(2) : 'Other');

export async function xtrainView(db, personId, today, prefs, weeks = 8) {
  const from = addDays(mondayOf(today), -7 * (weeks - 1));
  const { results: manual } = await db.prepare(
    'SELECT id, date, sport, minutes, distance_mi, rpe, notes FROM xtrain WHERE person_id = ? AND date >= ? ORDER BY date DESC, created_at DESC'
  ).bind(personId, from).all();
  const { results: synced } = await db.prepare(
    "SELECT strava_id, date, name, sport, moving_sec, distance_mi, avg_hr, load FROM workouts WHERE person_id = ? AND category = 'crosstrain' AND date >= ? ORDER BY date DESC"
  ).bind(personId, from).all();
  const entries = [
    ...manual.map((m) => ({ id: m.id, source: 'manual', date: m.date, sport: m.sport, label: sportLabel(m.sport), minutes: m.minutes, distance_mi: m.distance_mi, rpe: m.rpe, load: m.rpe ? Math.round(m.minutes * m.rpe) : null, notes: m.notes || '' })),
    ...synced.map((w) => {
      const sport = ICU_SPORT[w.sport] || 'other';
      return { id: w.strava_id, source: 'watch', date: w.date, sport, label: sport === 'other' && w.sport ? w.sport.replace(/([a-z])([A-Z])/g, '$1 $2') : sportLabel(sport), name: w.name || '', minutes: Math.round((w.moving_sec || 0) / 60), distance_mi: w.distance_mi ? round1(w.distance_mi) : null, avg_hr: w.avg_hr || null, rpe: null, load: null };
    }),
  ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const run = await weeklyRunning(db, personId, today, weeks);
  const week = run.map((w) => ({ week: w.week, run_min: w.run_min, xt_min: 0, sessions: 0, load: 0, by_sport: {} }));
  for (const e of entries) {
    const i = Math.floor((Date.parse(e.date) - Date.parse(from)) / (7 * DAY));
    if (i < 0 || i >= weeks) continue;
    const w = week[i];
    w.xt_min += e.minutes || 0; w.sessions++; w.load += e.load || 0;
    w.by_sport[e.label] = (w.by_sport[e.label] || 0) + (e.minutes || 0);
  }
  week.forEach((w) => { w.xt_min = Math.round(w.xt_min); });
  const thisWeek = week[weeks - 1];
  const done = week.slice(0, -1).filter((w) => w.xt_min || w.run_min);
  const avg = done.length ? Math.round(done.reduce((s, w) => s + w.xt_min, 0) / done.length) : 0;
  const share = thisWeek.xt_min + thisWeek.run_min ? Math.round((thisWeek.xt_min / (thisWeek.xt_min + thisWeek.run_min)) * 100) : 0;
  return { entries, weeks: week, this_week: thisWeek, avg_min: avg, share_pct: share, ...trackMeta(prefs) };
}

export async function saveXtrain(db, personId, b, prefs) {
  const date = str(b.date, 10);
  if (!isDate(date)) throw new TrackError('Pick a date.');
  const sport = str(b.sport, 40);
  const known = XT_SPORTS.some((s) => s.key === sport) || (sport.startsWith('c:') && prefs.xt_sports.includes(sport.slice(2)));
  if (!known) throw new TrackError('Pick an activity.');
  const minutes = num(b.minutes, 1, 900);
  if (minutes === null) throw new TrackError('Add how many minutes (1 to 900).');
  const row = [date, sport, minutes, num(b.distance_mi, 0, 500), b.rpe ? num(b.rpe, 1, 10) : null, str(b.notes, 300)];
  if (b.id) {
    const r = await db.prepare('UPDATE xtrain SET date = ?, sport = ?, minutes = ?, distance_mi = ?, rpe = ?, notes = ? WHERE id = ? AND person_id = ?').bind(...row, str(b.id, 40), personId).run();
    if (!r.meta.changes) throw new TrackError('That session is gone.');
    return { id: b.id };
  }
  const id = newId('x_');
  await db.prepare('INSERT INTO xtrain (id, person_id, date, sport, minutes, distance_mi, rpe, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, personId, ...row, Date.now()).run();
  return { id };
}

export async function deleteXtrain(db, personId, id) {
  await db.prepare('DELETE FROM xtrain WHERE id = ? AND person_id = ?').bind(str(id, 40), personId).run();
  return { ok: true };
}

// ------------------------------------------------------------------ fueling

// Daily carbohydrate in g/kg by how much the day's training asks for.
export const FUEL_TIERS = [
  { key: 'light', label: 'Rest or light day', note: 'A rest day, or under about 45 minutes of easy running.', carbs: [3, 5], upto: 45 },
  { key: 'moderate', label: 'Normal training day', note: 'About an hour of training.', carbs: [5, 7], upto: 90 },
  { key: 'high', label: 'Big day', note: 'One to three hours, or a hard workout.', carbs: [6, 10], upto: 200 },
  { key: 'very_high', label: 'Very big day', note: 'Four hours or more.', carbs: [8, 12], upto: Infinity },
];
const PROTEIN = [1.2, 2.0];

function tierFor(minutes) { return FUEL_TIERS.find((t) => minutes < t.upto) || FUEL_TIERS[FUEL_TIERS.length - 1]; }

// What to eat around a run of this length (from the same position stand).
function runFuel(minutes, kg) {
  const g = (lo, hi) => (kg ? `${Math.round(lo * kg)}-${Math.round(hi * kg)} g` : `${lo}-${hi} g per kg`);
  const tips = [];
  if (minutes >= 75) tips.push({ when: 'before', text: `1-4 hours before: a carbohydrate meal you know sits well (${g(1, 4)} of carbs, more the earlier you eat).` });
  else tips.push({ when: 'before', text: 'A normal meal 2-3 hours before, or a small carbohydrate snack 30-60 minutes before, is enough for a run this long.' });
  if (minutes >= 150) tips.push({ when: 'during', text: 'During: 60-90 g of carbohydrate an hour, starting early (gels, chews or sports drink). Practise it on long runs before race day.' });
  else if (minutes >= 75) tips.push({ when: 'during', text: 'During: 30-60 g of carbohydrate an hour after the first 45 minutes, plus water to thirst.' });
  else tips.push({ when: 'during', text: 'During: water to thirst is enough; you don’t need carbs under about 75 minutes.' });
  tips.push({ when: 'after', text: `Within an hour or two after: carbs and about ${kg ? Math.round(0.3 * kg) + ' g' : '0.3 g per kg'} of protein (a meal, or milk and a sandwich).` });
  return tips;
}

const FOOD_COLS = 'id, date, meal, name, carbs_g, protein_g, fat_g, kcal, fluid_ml, notes';

export async function foodView(db, personId, date, profile, prefs, tierKey = '') {
  if (!isDate(date)) throw new TrackError('Pick a date.');
  const { results: entries } = await db.prepare(`SELECT ${FOOD_COLS} FROM food_log WHERE person_id = ? AND date = ? ORDER BY created_at`).bind(personId, date).all();
  const sum = (k) => round1(entries.reduce((s, e) => s + (e[k] || 0), 0));
  const totals = { carbs_g: sum('carbs_g'), protein_g: sum('protein_g'), fat_g: sum('fat_g'), kcal: Math.round(sum('kcal')), fluid_ml: Math.round(sum('fluid_ml')), entries: entries.length };

  const days = await dayTotals(db, personId, addDays(date, -13), date);
  const day = days[date] || { run_min: 0, xt_min: 0, run_mi: 0, longest_min: 0 };
  const trainMin = Math.round(day.run_min + day.xt_min);
  const auto = tierFor(trainMin);
  const tier = FUEL_TIERS.find((t) => t.key === tierKey) || auto;
  const kg = Number(profile?.weight_kg) || null;
  const carbsBand = prefs.food.carbs || tier.carbs;
  const proteinBand = prefs.food.protein || PROTEIN;
  const targets = kg ? {
    carbs_g: [Math.round(carbsBand[0] * kg), Math.round(carbsBand[1] * kg)],
    protein_g: [Math.round(proteinBand[0] * kg), Math.round(proteinBand[1] * kg)],
  } : null;

  // Under-fueling: days in the last two weeks the runner logged fully (3+ entries with carbs) but ate under the
  // bottom of their band. Three or more is worth a word with an adult; we never diagnose.
  let low = 0, logged = 0;
  if (kg) {
    const { results: past } = await db.prepare(
      'SELECT date, COUNT(*) AS n, SUM(COALESCE(carbs_g, 0)) AS carbs FROM food_log WHERE person_id = ? AND date >= ? AND date <= ? GROUP BY date'
    ).bind(personId, addDays(date, -13), date).all();
    for (const p of past) {
      if (p.n < 3 || !(p.carbs > 0)) continue;
      logged++;
      const d = days[p.date];
      // Always the position stand's floor for that day, whatever custom band is set, so the referral can't be switched off.
      const lo = tierFor(Math.round((d?.run_min || 0) + (d?.xt_min || 0))).carbs[0] * kg;
      if (p.carbs < lo * 0.85) low++;
    }
  }
  const flag = low >= 3
    ? `On ${low} of the ${logged} days you logged fully in the last two weeks, you ate less carbohydrate than your training needs. Running low on fuel for a while can hurt your energy, your bones and your racing. Please talk to a coach, a parent or a doctor about it.`
    : null;

  return {
    date, entries, totals, targets, weight_known: !!kg,
    training: { minutes: trainMin, run_mi: round1(day.run_mi), longest_min: Math.round(day.longest_min) },
    tier: { ...tier, auto: tier.key === auto.key, auto_key: auto.key },
    tiers: FUEL_TIERS.map(({ key, label, note, carbs }) => ({ key, label, note, carbs })),
    bands: { carbs: carbsBand, protein: proteinBand, custom_carbs: !!prefs.food.carbs, custom_protein: !!prefs.food.protein },
    // Around today's longest run, or a typical run for the kind of day it is when nothing is logged yet.
    run_fuel: runFuel(day.longest_min || { light: 30, moderate: 60, high: 100, very_high: 180 }[tier.key], kg),
    flag, prefs: prefs.food, meals: MEALS,
  };
}

export async function saveFood(db, personId, b) {
  const date = str(b.date, 10);
  if (!isDate(date)) throw new TrackError('Pick a date.');
  const meal = MEAL_KEYS.includes(b.meal) ? b.meal : null;
  if (!meal) throw new TrackError('Pick a meal.');
  const name = str(b.name, 80);
  const row = [date, meal, name, num(b.carbs_g, 0, 1500), num(b.protein_g, 0, 500), num(b.fat_g, 0, 500), num(b.kcal, 0, 10000), num(b.fluid_ml, 0, 10000), str(b.notes, 200)];
  if (!name && row.slice(3, 8).every((v) => v === null)) throw new TrackError('Add what you ate or drank.');
  if (b.id) {
    const r = await db.prepare('UPDATE food_log SET date = ?, meal = ?, name = ?, carbs_g = ?, protein_g = ?, fat_g = ?, kcal = ?, fluid_ml = ?, notes = ? WHERE id = ? AND person_id = ?').bind(...row, str(b.id, 40), personId).run();
    if (!r.meta.changes) throw new TrackError('That entry is gone.');
    return { id: b.id };
  }
  const id = newId('f_');
  await db.prepare('INSERT INTO food_log (id, person_id, date, meal, name, carbs_g, protein_g, fat_g, kcal, fluid_ml, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, personId, ...row, Date.now()).run();
  return { id };
}

export async function deleteFood(db, personId, id) {
  await db.prepare('DELETE FROM food_log WHERE id = ? AND person_id = ?').bind(str(id, 40), personId).run();
  return { ok: true };
}

// Foods the runner has logged before, most used first, for one-tap re-logging.
export async function recentFoods(db, personId) {
  const { results } = await db.prepare(
    `SELECT name, meal, carbs_g, protein_g, fat_g, kcal, fluid_ml, COUNT(*) AS n, MAX(created_at) AS last
     FROM food_log WHERE person_id = ? AND name != '' GROUP BY lower(name) ORDER BY n DESC, last DESC LIMIT 12`
  ).bind(personId).all();
  return results.map(({ n, last, ...f }) => f);
}

// ------------------------------------------------------------------ goals

export const GOAL_EVENTS = [
  { key: '800', label: '800m', m: 800 },
  { key: '1600', label: '1600m / mile', m: 1609.344 },
  { key: '3200', label: '3200m / 2 mile', m: 3218.688 },
  { key: '5K', label: '5K', m: 5000 },
  { key: '10K', label: '10K', m: 10000 },
  { key: 'half', label: 'Half marathon', m: 21097.5 },
  { key: 'marathon', label: 'Marathon', m: 42195 },
];
// Names the onboarding form and older profiles use.
const EVENT_ALIAS = { '1600': '1600', mile: '1600', '3200': '3200', '5k': '5K', '10k': '10K', 'half marathon': 'half', half: 'half', marathon: 'marathon', '800': '800' };
export const eventKey = (s) => EVENT_ALIAS[String(s || '').trim().toLowerCase()] || (GOAL_EVENTS.some((e) => e.key === s) ? s : '');
const GOAL_KINDS = ['race', 'mileage', 'consistency', 'custom'];

// What typical plans for a marathon or half goal build to. A guide, not a rule: the coach adapts to the runner.
function buildGuide(event, target) {
  if (event === 'marathon') {
    const band = target <= 3 * 3600 ? [55, 70, 20] : target <= 3.5 * 3600 ? [45, 60, 20] : target <= 4 * 3600 ? [35, 50, 18] : [25, 40, 16];
    return { peak_mpw: [band[0], band[1]], long_run_mi: band[2], text: `Plans aimed at this time usually peak around ${band[0]}-${band[1]} miles a week, with long runs up to ${band[2]}-22 miles.` };
  }
  if (event === 'half') {
    const band = target <= 1.5 * 3600 ? [40, 55, 14] : target <= 1.75 * 3600 ? [30, 45, 13] : [20, 35, 12];
    return { peak_mpw: [band[0], band[1]], long_run_mi: band[2], text: `Plans aimed at this time usually peak around ${band[0]}-${band[1]} miles a week, with long runs of ${band[2]}-15 miles.` };
  }
  return null;
}

const paceOf = (sec, m, per) => fmtTime((sec / m) * per);

async function raceProgress(db, personId, g, fitness, today) {
  const ev = GOAL_EVENTS.find((e) => e.key === g.event);
  if (!ev || !(g.target > 0)) return { state: 'incomplete' };
  const est = (fitness?.estimates || []).find((e) => e.event === g.event);
  const current = est?.sec || null;
  const prTime = est?.pr?.time || (typeof est?.pr === 'string' ? est.pr : null);
  const prSec = prTime ? parseTime(prTime) : NaN;
  const out = {
    target_time: fmtTime(g.target), goal_pace_mi: paceOf(g.target, ev.m, MILE), goal_pace_km: paceOf(g.target, ev.m, 1000),
    estimate: current ? fmtTime(current, false) : null, range: est?.range || null, pr: prTime,
    equivalents: GOAL_EVENTS.filter((e) => e.key !== ev.key && e.m >= ev.m / 4.5 && e.m <= ev.m * 4.5 && e.m >= 1600)
      .map((e) => ({ event: e.key, label: e.label, time: fmtTime(g.target * Math.pow(e.m / ev.m, 1.06)) })),
    guide: buildGuide(g.event, g.target),
  };
  if (Number.isFinite(prSec) && prSec <= g.target) out.achieved = true;
  if (!current) {
    out.state = 'no_estimate';
    // A marathon goal with too little logged training still gets a sense of scale from the half (Riegel, 1.06).
    const half = g.event === 'marathon' ? (fitness?.estimates || []).find((e) => e.event === 'half')?.sec : null;
    if (half) out.hint_estimate = fmtTime(half * Math.pow(2, 1.06), false);
    out.message = g.event === 'marathon'
      ? 'Kestrel estimates your marathon from your last 16 weeks of running. It needs at least 15 running days logged; sync your watch or log your runs and this fills in.'
      : 'Add a recent race or PR (You → Records) and Kestrel can estimate where you are now.';
    return out;
  }
  const start = g.start_value > 0 ? g.start_value : current;
  out.gap_sec = Math.round(current - g.target);
  out.gap = (out.gap_sec > 0 ? '+' : '−') + fmtTime(Math.abs(out.gap_sec), false);
  out.pct = current <= g.target ? 100 : start > g.target ? clamp(Math.round(((start - current) / (start - g.target)) * 100), 0, 99) : 0;
  out.state = current <= g.target ? 'on_track' : out.gap_sec / g.target < 0.03 ? 'close' : 'building';
  out.start = fmtTime(start, false);
  // Trend: the 5K history scaled to this event by today's ratio, one point a week for 16 weeks.
  const five = (fitness?.estimates || []).find((e) => e.event === '5K')?.sec;
  if (five) {
    const { results } = await db.prepare('SELECT date, five_k_sec FROM fitness_history WHERE person_id = ? AND date >= ? AND five_k_sec > 0 ORDER BY date').bind(personId, addDays(today, -112)).all();
    const byWeek = new Map();
    for (const r of results) byWeek.set(mondayOf(r.date), r.five_k_sec);
    out.trend = [...byWeek.entries()].map(([week, s]) => ({ week, sec: Math.round(s * (current / five)) }));
  }
  return out;
}

export async function goalsView(db, personId, today, fitness) {
  const { results } = await db.prepare("SELECT * FROM goals WHERE person_id = ? AND status != 'deleted' ORDER BY status = 'active' DESC, priority DESC, created_at").bind(personId).all();
  const weeks = await weeklyRunning(db, personId, today, 8);
  const full = weeks.slice(0, -1);
  const last4 = full.slice(-4);
  const avg4 = last4.length ? round1(last4.reduce((s, w) => s + w.miles, 0) / last4.length) : 0;
  const goals = [];
  for (const g of results) {
    const base = { id: g.id, kind: g.kind, title: g.title, event: g.event, target: g.target, target_date: g.target_date, why: g.why, status: g.status, priority: g.priority, created_at: g.created_at };
    if (g.target_date && isDate(g.target_date)) base.days_left = Math.round((Date.parse(g.target_date) - Date.parse(today)) / DAY);
    if (g.kind === 'race') {
      // A goal set before Kestrel had an estimate starts its progress bar at the first estimate it gets.
      const est = (fitness?.estimates || []).find((e) => e.event === g.event)?.sec;
      if (!(g.start_value > 0) && est) {
        await db.prepare('UPDATE goals SET start_value = ? WHERE id = ? AND person_id = ?').bind(est, g.id, personId).run();
        g.start_value = est;
      }
      Object.assign(base, await raceProgress(db, personId, g, fitness, today), { mpw: avg4 });
    }
    if (g.kind === 'mileage') {
      base.current = avg4;
      base.pct = g.target > 0 ? clamp(Math.round((avg4 / g.target) * 100), 0, 100) : 0;
      base.weeks = weeks.map((w) => ({ week: w.week, value: w.miles, met: w.miles >= g.target, current: w.current }));
      // The safe way up: about 10% more a week, with an easier week every third or fourth.
      if (avg4 < g.target && avg4 > 0) base.weeks_to_target = Math.ceil(Math.log(g.target / avg4) / Math.log(1.1) * 4 / 3);
      base.state = avg4 >= g.target ? 'on_track' : base.pct >= 85 ? 'close' : 'building';
    }
    if (g.kind === 'consistency') {
      base.weeks = weeks.map((w) => ({ week: w.week, value: w.runs, met: w.runs >= g.target, current: w.current }));
      const hit = full.filter((w) => w.runs >= g.target).length;
      let streak = weeks[weeks.length - 1].runs >= g.target ? 1 : 0;
      for (let i = full.length - 1; i >= 0 && full[i].runs >= g.target; i--) streak++;
      base.hit = hit; base.of = full.length; base.streak = streak;
      base.pct = full.length ? Math.round((hit / full.length) * 100) : 0;
      base.current = weeks[weeks.length - 1].runs;
      base.state = base.pct >= 75 ? 'on_track' : base.pct >= 50 ? 'close' : 'building';
    }
    if (g.kind === 'custom') { base.pct = g.progress ?? 0; base.state = base.pct >= 100 ? 'on_track' : 'building'; }
    goals.push(base);
  }
  return { goals, weekly: weeks, mpw: avg4, events: GOAL_EVENTS.map(({ key, label }) => ({ key, label })) };
}

export async function saveGoal(db, personId, b, fitness) {
  const kind = GOAL_KINDS.includes(b.kind) ? b.kind : null;
  if (!kind) throw new TrackError('Pick a kind of goal.');
  const date = str(b.target_date, 10);
  if (date && !isDate(date)) throw new TrackError('That date doesn’t look right.');
  let event = '', target = null, title = str(b.title, 80);
  if (kind === 'race') {
    event = eventKey(b.event);
    if (!event) throw new TrackError('Pick the race distance.');
    target = parseTime(str(b.target_time ?? b.target, 12));
    if (!(target > 0)) throw new TrackError('Goal time looks like 18:30 or 2:59:59.');
    if (!title) title = `${GOAL_EVENTS.find((e) => e.key === event).label} in ${fmtTime(target)}`;
  } else if (kind === 'mileage') {
    target = num(b.target, 1, 200);
    if (target === null) throw new TrackError('Miles a week, 1 to 200.');
    if (!title) title = `${target} miles a week`;
  } else if (kind === 'consistency') {
    target = num(b.target, 1, 14);
    if (target === null) throw new TrackError('Runs a week, 1 to 14.');
    if (!title) title = `Run ${target} times a week`;
  } else if (!title) throw new TrackError('Name your goal.');
  const progress = kind === 'custom' ? clamp(Math.round(Number(b.progress) || 0), 0, 100) : null;
  const status = ['active', 'done', 'archived'].includes(b.status) ? b.status : 'active';
  const why = str(b.why, 300);
  const priority = b.priority ? 1 : 0;
  if (b.id) {
    const old = await db.prepare('SELECT * FROM goals WHERE id = ? AND person_id = ?').bind(str(b.id, 40), personId).first();
    if (!old) throw new TrackError('That goal is gone.');
    // A new race target or event restarts the progress bar from today's estimate.
    const restart = kind === 'race' && (old.event !== event || old.kind !== 'race');
    const start = restart ? (fitness?.estimates || []).find((e) => e.event === event)?.sec || null : old.start_value;
    await db.prepare('UPDATE goals SET kind = ?, title = ?, event = ?, target = ?, target_date = ?, start_value = ?, progress = ?, priority = ?, why = ?, status = ?, done_at = ? WHERE id = ? AND person_id = ?')
      .bind(kind, title, event, target, date, start, progress, priority, why, status, status === 'done' ? old.done_at || Date.now() : null, old.id, personId).run();
    if (priority) await db.prepare('UPDATE goals SET priority = 0 WHERE person_id = ? AND id != ?').bind(personId, old.id).run();
    return { id: old.id };
  }
  const { n } = await db.prepare("SELECT COUNT(*) AS n FROM goals WHERE person_id = ? AND status = 'active'").bind(personId).first();
  if (n >= 12) throw new TrackError('You have 12 active goals. Finish or archive one first.');
  const id = newId('g_');
  const start = kind === 'race' ? (fitness?.estimates || []).find((e) => e.event === event)?.sec || null : null;
  await db.prepare('INSERT INTO goals (id, person_id, kind, title, event, target, target_date, start_value, progress, priority, why, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, personId, kind, title, event, target, date, start, progress, priority || (n === 0 ? 1 : 0), why, status, Date.now()).run();
  if (priority) await db.prepare('UPDATE goals SET priority = 0 WHERE person_id = ? AND id != ?').bind(personId, id).run();
  return { id };
}

export async function deleteGoal(db, personId, id) {
  await db.prepare('DELETE FROM goals WHERE id = ? AND person_id = ?').bind(str(id, 40), personId).run();
  return { ok: true };
}

// Turns the onboarding race goal into a tracked goal, once. Called after the profile is saved.
export async function goalFromProfile(db, personId, profile, fitness) {
  const event = eventKey(profile?.goal_event);
  const target = parseTime(profile?.goal_time || '');
  if (!event || !(target > 0)) return null;
  const any = await db.prepare('SELECT 1 FROM goals WHERE person_id = ? LIMIT 1').bind(personId).first();
  if (any) return null;
  return saveGoal(db, personId, { kind: 'race', event, target_time: profile.goal_time, target_date: profile.goal_date || '', why: profile.why || '', priority: true }, fitness);
}

// For the coach: who the runner is (the intake), what they're chasing, and their cross-training and fueling lately.
export async function coachTracking(db, person, today) {
  let settings = {};
  const raw = person.settings ?? (await db.prepare('SELECT settings FROM people WHERE id = ?').bind(person.id).first())?.settings;
  try { settings = JSON.parse(raw || '{}'); } catch { /* bad JSON: no intake */ }
  const { completed_at, ...runner } = settings.profile || {};
  const { results: goals } = await db.prepare("SELECT title, kind, event, target, target_date, why, priority FROM goals WHERE person_id = ? AND status = 'active' ORDER BY priority DESC, created_at").bind(person.id).all();
  const from = addDays(today, -13);
  const { results: xt } = await db.prepare('SELECT date, sport, minutes, rpe, notes FROM xtrain WHERE person_id = ? AND date >= ? ORDER BY date').bind(person.id, from).all();
  const { results: food } = await db.prepare(
    'SELECT date, COUNT(*) AS entries, ROUND(SUM(COALESCE(carbs_g, 0))) AS carbs_g, ROUND(SUM(COALESCE(protein_g, 0))) AS protein_g FROM food_log WHERE person_id = ? AND date >= ? GROUP BY date ORDER BY date'
  ).bind(person.id, addDays(today, -6)).all();
  return {
    runner,
    goals: goals.map((g) => ({ ...g, main: !!g.priority, priority: undefined, target: g.kind === 'race' ? fmtTime(g.target, false) : g.target })),
    cross_training_by_hand_last_14_days: xt.map((x) => ({ ...x, sport: sportLabel(x.sport) })),
    fuel_last_7_days: food.length ? { weight_kg: runner.weight_kg || null, days: food } : null,
  };
}
