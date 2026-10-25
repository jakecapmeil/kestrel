// Daily training log: one row per person per day, merged with whatever Claude
// Coach logged from Strava that day. Same idea as the XC Coach Log in Notion:
// planned vs actual, status, difficulty, notes, and a rolling load note.
import { WORKOUTS, WORKOUT_TYPES, RACES, PHASES, PACE_ZONES, pacesFrom5k, findWorkouts, workoutTargets, parseReps, snap100, trackMiles, TRACK_MILE_M } from './workouts.js';
import { getFitness } from './fitness.js';
import { conditionsOf, courseIdOf } from './conditions.js';
import { normalizePrs, parseCourseKey, getCourse } from './courses.js';

// Marks Fitness States stale so the next read recomputes them.
const staleFitness = (db, personId) => db.prepare('UPDATE fitness_states SET computed_at = 0 WHERE person_id = ?').bind(personId).run();

export class LogError extends Error {}

export const DAY_TYPES = ['easy', 'recovery', 'long', 'tempo', 'threshold', 'intervals', 'track', 'fartlek', 'hills', 'strides', 'race', 'shakeout', 'crosstrain', 'strength', 'rest'];
export const PR_EVENTS = ['100', '200', '400', '600', '800', '1000', '1600', '3200', '5K', '2000 SC', '3000 SC'];
// Course PRs ("course:vc:5000", the 5K at Van Cortlandt) are accepted as well: see courses.js.
export const DAY_STATUSES = ['as_planned', 'harder', 'easier', 'missed', 'adjusted', 'rest'];

// Strava workout category -> day type.
const CATEGORY_TYPE = { easy: 'easy', recovery: 'recovery', long: 'long', workout: 'intervals', race: 'race', shakeout: 'shakeout', crosstrain: 'crosstrain' };

// Tags a run can carry. `base` is the category the rest of Kestrel reasons with: hard-day logic, fitness and plan matching.
export const BUILTIN_TAGS = [
  { id: 'easy', label: 'Easy', base: 'easy' }, { id: 'recovery', label: 'Recovery', base: 'recovery' },
  { id: 'long', label: 'Long run', base: 'long' }, { id: 'shakeout', label: 'Shakeout', base: 'shakeout' },
  { id: 'tempo', label: 'Tempo', base: 'workout' }, { id: 'threshold', label: 'Threshold', base: 'workout' },
  { id: 'intervals', label: 'Intervals', base: 'workout' }, { id: 'fartlek', label: 'Fartlek', base: 'workout' },
  { id: 'hills', label: 'Hills', base: 'workout' }, { id: 'workout', label: 'Workout', base: 'workout' },
  { id: 'time_trial', label: 'Time trial', base: 'race' }, { id: 'race', label: 'Race', base: 'race' },
  { id: 'crosstrain', label: 'Cross-training', base: 'crosstrain' },
];
export const TAG_BASES = ['easy', 'recovery', 'long', 'workout', 'race'];
const TAG_LABEL = Object.fromEntries(BUILTIN_TAGS.map((t) => [t.id, t.label]));

export async function customTags(db, personId) {
  return (await db.prepare('SELECT name, base FROM run_tags WHERE person_id = ? ORDER BY name').bind(personId).all()).results;
}

export async function addCustomTag(db, personId, name, base) {
  name = clip(name, 24);
  if (!name) throw new LogError('Name the tag');
  if (!TAG_BASES.includes(base)) throw new LogError(`base must be one of ${TAG_BASES.join(', ')}`);
  if (BUILTIN_TAGS.some((t) => t.id === name.toLowerCase() || t.label.toLowerCase() === name.toLowerCase())) throw new LogError('That tag already exists');
  await db.prepare('INSERT INTO run_tags (person_id, name, base) VALUES (?, ?, ?) ON CONFLICT(person_id, name) DO UPDATE SET base = excluded.base').bind(personId, name, base).run();
  return customTags(db, personId);
}

export async function removeCustomTag(db, personId, name) {
  await db.prepare('DELETE FROM run_tags WHERE person_id = ? AND name = ?').bind(personId, clip(name, 24)).run();
  return customTags(db, personId);
}

// Tag one run ('' clears it back to Kestrel's own guess). The tag's base becomes the run's category.
export async function setRunTag(db, personId, stravaId, tag) {
  tag = clip(tag, 24);
  const run = await db.prepare('SELECT category, tag, auto_category FROM workouts WHERE person_id = ? AND strava_id = ?').bind(personId, stravaId).first();
  if (!run) throw new LogError('Unknown run');
  if (!tag) {
    await db.prepare("UPDATE workouts SET tag = '', category = COALESCE(NULLIF(auto_category, ''), category), auto_category = '' WHERE person_id = ? AND strava_id = ?").bind(personId, stravaId).run();
  } else {
    const builtin = BUILTIN_TAGS.find((t) => t.id === tag);
    const custom = builtin ? null : await db.prepare('SELECT base FROM run_tags WHERE person_id = ? AND name = ?').bind(personId, tag).first();
    const base = builtin?.base || custom?.base;
    if (!base) throw new LogError('Unknown tag');
    await db.prepare("UPDATE workouts SET tag = ?, auto_category = CASE WHEN COALESCE(tag, '') = '' THEN category ELSE auto_category END, category = ? WHERE person_id = ? AND strava_id = ?").bind(tag, base, personId, stravaId).run();
  }
  await staleFitness(db, personId);
}

// What Kestrel thinks the run was, when that differs from its label. The runner's own tag is never second-guessed.
function suggestTag(main, meet, laps) {
  if (main.tag || main.category === 'crosstrain') return null;
  const miles = main.distance_mi || 0;
  const hrE = main.hr_effort ?? main.effort ?? 0;
  const reps = laps.length >= 3;
  if (main.category !== 'race' && meet && !reps && miles >= 0.9 && hrE >= 7) return { tag: 'race', why: `You had "${meet.title}" on the calendar and this was one hard, continuous effort.` };
  if (main.category === 'workout' && !reps && miles >= 0.9 && miles <= 26.3 && hrE >= 8) return { tag: 'time_trial', why: 'One steady, near-max effort with no rep breaks. That reads as a time trial or race, not a workout.' };
  if (main.category === 'race' && reps && !meet) return { tag: 'workout', why: 'It has rep breaks and no meet that day, so it looks like a workout.' };
  return null;
}

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const clip = (v, max) => String(v ?? '').trim().slice(0, max);

function numOrNull(v, min, max) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new LogError(`Value ${v} is out of range (${min}-${max})`);
  return n;
}

function addDays(dateKey, n) {
  const d = new Date(dateKey + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function parseTypes(raw) {
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw || '[]') : raw;
    return Array.isArray(arr) ? arr.filter((t) => DAY_TYPES.includes(t)) : [];
  } catch {
    return [];
  }
}

function round1(n) {
  return Math.round(n * 100) / 100;
}

const fmtSec = (s) => {
  if (!Number.isFinite(s)) return '';
  const r = Math.round(s * 10) / 10;
  const m = Math.floor(r / 60);
  const ss = r - m * 60;
  const whole = Math.abs(ss - Math.round(ss)) < 0.05;
  return m ? `${m}:${(whole ? String(Math.round(ss)) : ss.toFixed(1)).padStart(whole ? 2 : 4, '0')}` : `${whole ? Math.round(ss) : ss.toFixed(1)}`;
};

// Split builder rows: [{ m: 800, s: 165.2, rest: '2:00' }].
export function parseSplitReps(raw) {
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw || '[]') : raw;
    return Array.isArray(arr) ? arr.filter((r) => r && r.m > 0 && r.s > 0).map((r) => ({ m: Number(r.m), s: Number(r.s), rest: clip(r.rest, 12) })) : [];
  } catch {
    return [];
  }
}

// On the track a mile is 1600 m and reps read as the lines (nearest 100 m).
export function splitsText(reps, track = false) {
  return reps.map((r) => {
    const m = track ? snap100(r.m) : r.m;
    const pace = (r.s / m) * (track ? TRACK_MILE_M : 1609.344);
    return `${Math.round(m)}m ${fmtSec(r.s)} (${fmtSec(Math.round(pace))}/mi)${r.rest ? `, rest ${r.rest}` : ''}`;
  }).join('; ');
}

// Watch laps (work reps) for the day, when nobody built splits by hand.
function lapsOf(rs, track) {
  for (const w of rs) {
    try {
      const laps = JSON.parse(w.laps || '[]');
      if (Array.isArray(laps) && laps.length) return laps.map((l) => ({ m: track || w.surface === 'track' ? snap100(l.m) : l.m, s: l.s, hr: l.hr || null, rest: l.rest || '' }));
    } catch { /* ignore */ }
  }
  return [];
}

// Activities less than 75 min apart (end to start) are one session: warm-up,
// workout and cool-down saved as separate activities read as one workout.
// Kai's report for a session lives on its main activity.
const HARD_CATS = new Set(['workout', 'race']);
const RANK = { race: 6, workout: 5, long: 4, easy: 3, shakeout: 2, recovery: 1, crosstrain: 0 };
const toMin = (hhmm) => { const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const hhmm = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

// When the recording ended (minutes into the day), which is what puts a day's
// runs in order. Null when the start time is unknown.
const endMin = (w) => { const s = toMin(w.start_local); return s === null ? null : s + Math.round((w.elapsed_sec || w.moving_sec || 0) / 60); };
const byEnd = (a, b) => {
  const x = endMin(a);
  const y = endMin(b);
  return x === null || y === null ? (x === null) - (y === null) : x - y;
};

// A run before the day's hard effort is the warm-up, one after it the cool-down.
const EASYISH = new Set(['easy', 'recovery', 'shakeout']);
function rolesOf(rs) {
  const roles = new Map();
  const run = rs.filter((w) => w.category !== 'crosstrain' && endMin(w) !== null).sort(byEnd);
  const hard = run.filter((w) => HARD_CATS.has(w.category));
  if (!hard.length) return roles;
  const first = endMin(hard[0]);
  const last = endMin(hard[hard.length - 1]);
  for (const w of run) {
    if (!EASYISH.has(w.category)) continue;
    const e = endMin(w);
    if (e < first) roles.set(w.strava_id, 'warmup');
    else if (e > last) roles.set(w.strava_id, 'cooldown');
  }
  return roles;
}

// One activity with everything the watch and the weather say about it.
// `events` (that day's calendar) tells which course it was on.
function activityDetail(w, events = [], role = '') {
  let metrics = {};
  try { metrics = JSON.parse(w.metrics || '{}') || {}; } catch { /* ignore */ }
  let laps = [];
  try { laps = JSON.parse(w.laps || '[]'); } catch { /* ignore */ }
  const miles = w.distance_mi || 0;
  const pace = miles > 0.2 && w.moving_sec ? w.moving_sec / miles : null;
  const cond = w.category === 'crosstrain' ? null : conditionsOf(w, events);
  const heat = cond?.heat || 0;
  const hill = cond?.hill || 0;
  return {
    id: w.strava_id, name: w.name, category: w.category, tag: w.tag || '', role, start: w.start_local || '', end: endMin(w) === null ? '' : hhmm(endMin(w)),
    miles: w.distance_mi, minutes: w.moving_sec ? Math.round(w.moving_sec / 60) : null,
    moving_sec: w.moving_sec ?? null, elapsed_sec: w.elapsed_sec ?? null,
    pace: pace ? fmtSec(Math.round(pace)) : null,
    // The same effort on a flat course in cool weather (as Fitness States count it).
    pace_adjusted: pace && cond && cond.factor >= 1.005 ? fmtSec(Math.round(pace / cond.factor)) : null,
    course: cond?.course || '',
    course_id: courseIdOf(w, events),
    can_track: String(w.strava_id || '').startsWith('intervals:'),
    avg_hr: w.avg_hr ?? null, max_hr: w.max_hr ?? null, cadence: w.avg_cadence ?? null,
    elev_ft: w.elev_gain_ft ?? null, elev_per_mi: w.elev_gain_ft != null && miles > 0.3 ? Math.round(w.elev_gain_ft / miles) : null,
    temp_f: w.temp_f ?? null, dew_point_f: w.dew_point_f ?? null,
    heat_pct: heat ? Math.round(heat * 1000) / 10 : 0, hill_pct: hill ? Math.round(hill * 1000) / 10 : 0,
    effort: w.effort ?? null, hr_effort: w.hr_effort ?? null, load: w.load ?? null,
    track: w.surface === 'track',
    laps: Array.isArray(laps) ? laps.slice(0, 40) : [],
    metrics,
  };
}

export function sessionsOf(rs, events = []) {
  rs = [...rs].sort(byEnd);
  const roles = rolesOf(rs);
  const groups = [];
  for (const w of rs) {
    const start = toMin(w.start_local);
    const last = groups[groups.length - 1];
    const sameKind = last && (w.category === 'crosstrain') === (last.items[0].category === 'crosstrain');
    const close = last && (start === null || last.end === null || start - last.end <= 75);
    if (last && sameKind && close) last.items.push(w);
    else groups.push({ items: [w], end: null });
    const g = groups[groups.length - 1];
    g.end = start === null ? null : start + Math.round((w.elapsed_sec || w.moving_sec || 0) / 60);
  }
  return groups.map(({ items }, i) => {
    const main = items.reduce((a, b) => ((RANK[b.category] ?? 0) > (RANK[a.category] ?? 0) || ((RANK[b.category] ?? 0) === (RANK[a.category] ?? 0) && (b.distance_mi || 0) > (a.distance_mi || 0)) ? b : a));
    const miles = items.reduce((a, w) => a + (w.distance_mi || 0), 0);
    const sec = items.reduce((a, w) => a + (w.moving_sec || 0), 0);
    const hr = items.filter((w) => w.avg_hr && w.moving_sec);
    return {
      key: `${main.date}#${i}`,
      main_id: main.strava_id,
      start: items[0].start_local || '',
      category: main.category,
      tag: main.tag || '',
      tag_label: main.tag ? (TAG_LABEL[main.tag] || main.tag) : '',
      suggest: (() => {
        const meet = events.find((e) => e.date === main.date && e.type === 'meet');
        let laps = [];
        try { laps = JSON.parse(main.laps || '[]'); } catch { /* ignore */ }
        return suggestTag(main, meet, Array.isArray(laps) ? laps : []);
      })(),
      title: main.name || '',
      miles: round1(miles),
      minutes: Math.round(sec / 60),
      // Track miles are 1600 m, so pace uses the track mileage as is.
      pace: miles > 0.2 ? fmtSec(Math.round(sec / miles)) : null,
      avg_hr: hr.length ? Math.round(hr.reduce((a, w) => a + w.avg_hr * w.moving_sec, 0) / hr.reduce((a, w) => a + w.moving_sec, 0)) : null,
      effort: items.reduce((m, w) => Math.max(m, w.effort || 0), 0) || null,
      track: items.some((w) => w.surface === 'track'),
      // The session's own splits: the work laps of its main activity.
      splits: lapsOf([main, ...items.filter((w) => w !== main)], main.surface === 'track'),
      report: main.summary || items.find((w) => w.summary)?.summary || '',
      elev_ft: items.some((w) => w.elev_gain_ft != null) ? items.reduce((a, w) => a + (w.elev_gain_ft || 0), 0) : null,
      temp_f: main.temp_f ?? null, dew_point_f: main.dew_point_f ?? null,
      activities: items.map((w) => activityDetail(w, events, roles.get(w.strava_id) || '')),
    };
  });
}

// How the whole day compared with the plan. Replaces the old per-activity
// letter grades, which compared a warm-up on its own to the full day's miles.
export function dayPlanTag(rs, miles, maxEffort) {
  const planned = rs.find((w) => w.planned_type);
  if (!planned) return null;
  const type = planned.planned_type.toLowerCase();
  const want = planned.planned_miles || 0;
  const cats = new Set(rs.map((w) => w.category));
  const ranHard = [...cats].some((c) => HARD_CATS.has(c));
  const running = [...cats].some((c) => c !== 'crosstrain');
  let tone = 'on';
  let reason = '';
  if (type === 'off' || want === 0) {
    if (running) { tone = 'off'; reason = 'Planned rest day'; } else reason = 'Rest day';
  } else if ((type === 'workout' || type === 'race') && !ranHard) {
    tone = 'close'; reason = 'Workout day, ran easy';
  } else if (type !== 'workout' && type !== 'race' && (ranHard || maxEffort >= 7)) {
    tone = 'off'; reason = 'Too hard for an easy day';
  }
  if (want > 0 && running) {
    const diff = miles - want;
    const miss = Math.abs(diff) / want;
    if (miss > 0.1) {
      const d = `${diff < 0 ? 'Short' : 'Long'} by ${Math.round(Math.abs(diff) * 10) / 10} mi`;
      reason = reason ? `${reason}, ${d.toLowerCase()}` : d;
      // Running a bit long is less of a miss than running short.
      if (miss > (diff < 0 ? 0.3 : 0.5)) tone = 'off'; else if (tone === 'on') tone = 'close';
    }
  }
  return { tone, label: tone === 'on' ? 'On plan' : tone === 'close' ? 'Close to plan' : 'Off plan', reason: reason || `${planned.planned_type} ${want ? want + ' mi' : ''}`.trim(), planned: `${planned.planned_type}${want ? ' ' + want + ' mi' : ''}` };
}

export async function getDays(db, personId, from, to) {
  if (!isDate(from) || !isDate(to)) throw new LogError('from and to must be YYYY-MM-DD');
  if (from > to) throw new LogError('from must be on or before to');
  const [days, runs, events] = await Promise.all([
    db.prepare('SELECT * FROM training_days WHERE person_id = ? AND date >= ? AND date <= ?').bind(personId, from, to).all(),
    db.prepare(
      `SELECT strava_id, date, name, category, tag, distance_mi, moving_sec, elapsed_sec, avg_hr, max_hr, avg_cadence, elev_gain_ft, effort, hr_effort, load, library_id, summary,
              start_local, laps, planned_type, planned_miles, surface, course, course_id, gps_vc, gps_course, temp_f, dew_point_f, metrics
       FROM workouts WHERE person_id = ? AND date >= ? AND date <= ? ORDER BY start_local, created_at`
    ).bind(personId, from, to).all(),
    db.prepare(
      `SELECT e.date, e.type, e.title, e.location, e.description, l.name AS loc_name FROM events e
       JOIN team_members tm ON tm.team_id = e.team_id AND tm.person_id = ?
       LEFT JOIN locations l ON l.id = e.location_id WHERE e.date >= ? AND e.date <= ?`
    ).bind(personId, from, to).all(),
  ]);

  const byDate = new Map();
  const get = (date) => {
    if (!byDate.has(date)) byDate.set(date, { date, entry: null, runs: [] });
    return byDate.get(date);
  };
  days.results.forEach((d) => { get(d.date).entry = d; });
  [...runs.results].sort(byEnd).forEach((w) => { get(w.date).runs.push(w); });

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).map(({ date, entry: e, runs: rs }) => {
    const running = rs.filter((w) => w.category !== 'crosstrain');
    const stravaMiles = running.reduce((s, w) => s + (w.distance_mi || 0), 0);
    const types = new Set(parseTypes(e?.types));
    rs.forEach((w) => types.add(DAY_TYPES.includes(w.tag) ? w.tag : (CATEGORY_TYPE[w.category] || 'easy')));
    const maxEffort = rs.reduce((m, w) => Math.max(m, w.effort || 0), 0);
    // Plan matching goes by heart rate alone: an easy run in the heat is still easy.
    const maxHrEffort = rs.reduce((m, w) => Math.max(m, w.hr_effort ?? w.effort ?? 0), 0);
    const track = e?.surface === 'track' || rs.some((w) => w.surface === 'track');
    const reps = parseSplitReps(e?.split_reps).map((r) => (track ? { ...r, m: snap100(r.m) } : r));
    const laps = lapsOf(rs, track);
    return {
      date,
      track,
      // Watch days are locked: miles, minutes, runs and difficulty come from
      // the synced activities and can't be typed over.
      locked: rs.length > 0,
      miles: rs.length ? round1(stravaMiles) : (e?.manual_miles ?? null),
      minutes: rs.length ? Math.round(rs.reduce((s, w) => s + (w.moving_sec || 0), 0) / 60) : (e?.minutes ?? null),
      runs: rs.length ? running.length : (e?.runs ?? null),
      difficulty: rs.length ? (maxEffort || null) : (e?.difficulty ?? null),
      types: [...types],
      status: e?.status || '',
      planned: e?.planned || '',
      library_id: e?.library_id || rs.find((w) => w.library_id)?.library_id || '',
      splits: e?.splits || '',
      // Hand-built reps win, then the watch laps, then whatever the splits text says.
      split_reps: reps.length ? reps : laps.length ? laps : parseReps(e?.splits).map((r) => ({ ...r, m: track ? snap100(r.m) : r.m, rest: '' })),
      day_line: e?.day_line || '',
      plan: dayPlanTag(rs, stravaMiles, maxHrEffort),
      sessions: sessionsOf(rs, events.results),
      summary: e?.summary || '',
      coach_note: e?.coach_note || '',
      load_note: e?.load_note || '',
      feel: e?.feel ?? null,
      sleep_hours: e?.sleep_hours ?? null,
      strength: !!e?.strength,
      notes: e?.notes || '',
      load: rs.reduce((s, w) => s + (w.load || 0), 0) || null,
      strava: rs.map((w) => ({ strava_id: w.strava_id, name: w.name, category: w.category, miles: w.distance_mi, minutes: w.moving_sec ? Math.round(w.moving_sec / 60) : null, avg_hr: w.avg_hr, effort: w.effort, start: w.start_local || '' })),
    };
  });
}

// Partial upsert: only the fields passed are changed.
const DAY_FIELDS = {
  manual_miles: (v) => numOrNull(v, 0, 100),
  minutes: (v) => numOrNull(v, 0, 1000),
  runs: (v) => { const n = numOrNull(v, 0, 10); return n === null ? null : Math.round(n); },
  difficulty: (v) => { const n = numOrNull(v, 1, 10); return n === null ? null : Math.round(n); },
  types: (v) => {
    if (!Array.isArray(v)) throw new LogError('types must be an array');
    const bad = v.filter((t) => !DAY_TYPES.includes(t));
    if (bad.length) throw new LogError(`Unknown type(s): ${bad.join(', ')}. Use: ${DAY_TYPES.join(', ')}`);
    return JSON.stringify([...new Set(v)]);
  },
  status: (v) => { const s = clip(v, 20); if (s && !DAY_STATUSES.includes(s)) throw new LogError(`status must be one of ${DAY_STATUSES.join(', ')}`); return s; },
  planned: (v) => clip(v, 500),
  library_id: (v) => { const s = clip(v, 60); if (s && !WORKOUTS.some((w) => w.id === s)) throw new LogError(`Unknown library workout "${s}"`); return s; },
  splits: (v) => clip(v, 500),
  split_reps: (v) => {
    const reps = parseSplitReps(v);
    if (reps.length > 40) throw new LogError('At most 40 reps');
    return reps.length ? JSON.stringify(reps) : '';
  },
  day_line: (v) => clip(v, 300),
  surface: (v) => (v === 'track' ? 'track' : ''),
  summary: (v) => clip(v, 4000),
  coach_note: (v) => clip(v, 4000),
  load_note: (v) => clip(v, 4000),
  feel: (v) => { const n = numOrNull(v, 1, 10); return n === null ? null : Math.round(n); },
  sleep_hours: (v) => numOrNull(v, 0, 24),
  strength: (v) => (v ? 1 : 0),
  notes: (v) => clip(v, 2000),
};

export async function saveDay(db, personId, date, fields) {
  if (!isDate(date)) throw new LogError('date must be YYYY-MM-DD');
  const person = await db.prepare('SELECT id FROM people WHERE id = ?').bind(personId).first();
  if (!person) throw new LogError('Unknown person');
  if (fields && 'split_reps' in fields && !('splits' in fields)) {
    const track = 'surface' in fields ? fields.surface === 'track'
      : (await db.prepare('SELECT surface FROM training_days WHERE person_id = ? AND date = ?').bind(personId, date).first())?.surface === 'track';
    const reps = parseSplitReps(fields.split_reps).map((r) => (track ? { ...r, m: snap100(r.m) } : r));
    fields = { ...fields, split_reps: reps, splits: splitsText(reps, track) };
  }
  const cols = [];
  const vals = [];
  for (const [k, fn] of Object.entries(DAY_FIELDS)) {
    if (fields && k in fields) { cols.push(k); vals.push(fn(fields[k])); }
  }
  if (!cols.length) throw new LogError(`Nothing to save. Fields: ${Object.keys(DAY_FIELDS).join(', ')}`);
  const now = Date.now();
  await db.prepare(
    `INSERT INTO training_days (person_id, date, ${cols.join(', ')}, updated_at) VALUES (?, ?, ${cols.map(() => '?').join(', ')}, ?)
     ON CONFLICT(person_id, date) DO UPDATE SET ${cols.map((c) => `${c}=excluded.${c}`).join(', ')}, updated_at=excluded.updated_at`
  ).bind(personId, date, ...vals, now).run();
  return (await getDays(db, personId, date, date))[0];
}

// "On the track" toggle for a day: the day's running sessions snap to the
// lines (miles in eighths, no elevation) or go back to the GPS numbers.
export async function setDayTrack(db, personId, date, track) {
  if (!isDate(date)) throw new LogError('date must be YYYY-MM-DD');
  const rows = (await db.prepare(
    "SELECT strava_id, category, distance_mi, raw_distance_mi, elev_gain_ft, raw_elev_ft FROM workouts WHERE person_id = ? AND date = ? AND category != 'crosstrain'"
  ).bind(personId, date).all()).results;
  // Only the workout itself moves to the track; the warm-up jog usually didn't.
  const hard = rows.filter((w) => ['workout', 'race'].includes(w.category));
  const target = hard.length ? hard : rows;
  await db.batch(target.map((w) => {
    const gps = w.raw_distance_mi ?? w.distance_mi;
    return db.prepare('UPDATE workouts SET surface = ?, distance_mi = ?, raw_distance_mi = ?, elev_gain_ft = ?, raw_elev_ft = ? WHERE person_id = ? AND strava_id = ?')
      .bind(track ? 'track' : '', track && gps != null ? trackMiles(gps) : gps, gps, track ? 0 : (w.raw_elev_ft ?? w.elev_gain_ft), w.raw_elev_ft ?? w.elev_gain_ft, personId, w.strava_id);
  }));
  const day = await db.prepare('SELECT split_reps FROM training_days WHERE person_id = ? AND date = ?').bind(personId, date).first();
  const fields = { surface: track ? 'track' : '' };
  if (day?.split_reps) fields.split_reps = parseSplitReps(day.split_reps);
  return await saveDay(db, personId, date, fields);
}

// Mon-Sun weekly totals over a date range, for trends.
export function weeklyTotals(days) {
  const weeks = new Map();
  for (const d of days) {
    const dow = new Date(d.date + 'T12:00:00Z').getUTCDay();
    const start = addDays(d.date, dow === 0 ? -6 : 1 - dow);
    const w = weeks.get(start) || { week_of: start, miles: 0, run_days: 0, hard_days: 0, avg_difficulty: null, _diff: [] };
    w.miles = round1(w.miles + (d.miles || 0));
    if (d.miles) w.run_days += 1;
    if (d.types.some((t) => ['tempo', 'threshold', 'intervals', 'track', 'fartlek', 'hills', 'race'].includes(t))) w.hard_days += 1;
    if (d.difficulty) w._diff.push(d.difficulty);
    weeks.set(start, w);
  }
  return [...weeks.values()].map(({ _diff, ...w }) => ({ ...w, avg_difficulty: _diff.length ? round1(_diff.reduce((a, b) => a + b, 0) / _diff.length) : null }));
}

// For Claude and Kai: the same days without what only the page draws (an
// activity's laps, already in the session's splits, and its HR zone bars).
export function compactDays(days) {
  return days.map((d) => ({
    ...d,
    sessions: d.sessions.map((s) => ({
      ...s,
      activities: s.activities.map(({ laps, metrics, ...a }) => {
        const { hr_zones, ...m } = metrics || {};
        return Object.keys(m).length ? { ...a, metrics: m } : a;
      }),
    })),
  }));
}

export async function getLog(db, personId, from, to) {
  const days = await getDays(db, personId, from, to);
  return { from, to, weeks: weeklyTotals(days), days, tags: { builtin: BUILTIN_TAGS, custom: await customTags(db, personId) } };
}

// Every time this person ran a given library workout, oldest first, so Claude
// can compare splits and HR over the season.
export async function workoutHistory(db, personId, libraryId) {
  const w = WORKOUTS.find((x) => x.id === libraryId);
  if (!w) throw new LogError(`Unknown library workout "${libraryId}"`);
  const [days, runs] = await Promise.all([
    db.prepare('SELECT date FROM training_days WHERE person_id = ? AND library_id = ?').bind(personId, libraryId).all(),
    db.prepare('SELECT date FROM workouts WHERE person_id = ? AND library_id = ?').bind(personId, libraryId).all(),
  ]);
  const dates = [...new Set([...days.results, ...runs.results].map((r) => r.date))].sort();
  const out = [];
  for (const date of dates) out.push(compactDays(await getDays(db, personId, date, date))[0]);
  return { workout: { id: w.id, name: w.name }, times_run: out.length, history: out };
}

export async function fiveKFor(db, personId) {
  const row = await db.prepare('SELECT five_k_time FROM people WHERE id = ?').bind(personId).first();
  return row?.five_k_time || '';
}

export async function setFiveK(db, personId, time) {
  const t = clip(time, 8);
  if (t && !pacesFrom5k(t)) throw new LogError('5K time must look like 19:25');
  const res = await db.prepare('UPDATE people SET five_k_time = ?, five_k_set_at = ? WHERE id = ?').bind(t, t ? Date.now() : null, personId).run();
  if (!res.meta.changes) throw new LogError('Unknown person');
  await staleFitness(db, personId);
  return { five_k_time: t, paces: pacesFrom5k(t) };
}

const PR_TIME = /^(\d{1,2}:)?\d{1,2}(\.\d{1,2})?$|^\d{1,2}:\d{2}(\.\d{1,2})?$/;

export function parsePrs(raw) {
  try {
    const o = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw;
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  } catch {
    return {};
  }
}

export async function getPrs(db, personId) {
  const row = await db.prepare('SELECT prs FROM people WHERE id = ?').bind(personId).first();
  return normalizePrs(parsePrs(row?.prs));
}

// Merges: pass an event with a null/empty time to clear it.
export async function setPrs(db, personId, prs) {
  if (!prs || typeof prs !== 'object' || Array.isArray(prs)) throw new LogError(`prs must be an object keyed by event: ${PR_EVENTS.join(', ')}`);
  const current = normalizePrs(await getPrs(db, personId));
  for (const [rawEvent, v] of Object.entries(normalizePrs(prs))) {
    const event = rawEvent;
    const ck = parseCourseKey(event);
    if (ck) {
      if (!(await getCourse(db, ck.id))) throw new LogError(`Unknown course "${ck.id}". Course PRs look like course:vc:5000 (the course id, then metres).`);
    } else if (!PR_EVENTS.includes(event)) throw new LogError(`Unknown event "${event}". Use: ${PR_EVENTS.join(', ')}, or course:<id>:<metres> for a course PR.`);
    const time = clip(typeof v === 'string' ? v : v?.time, 10);
    if (!time) { delete current[event]; continue; }
    if (!PR_TIME.test(time)) throw new LogError(`${event}: time must look like 58.4, 2:15 or 19:38`);
    const date = clip(v?.date, 10);
    if (date && !isDate(date)) throw new LogError(`${event}: date must be YYYY-MM-DD`);
    current[event] = { time, ...(date ? { date } : {}), ...(v?.meet ? { meet: clip(v.meet, 100) } : {}) };
  }
  const res = await db.prepare('UPDATE people SET prs = ? WHERE id = ?').bind(JSON.stringify(current), personId).run();
  if (!res.meta.changes) throw new LogError('Unknown person');
  await staleFitness(db, personId);
  return { prs: current };
}

export function libraryMeta() {
  return { types: WORKOUT_TYPES, races: RACES, phases: PHASES, pace_zones: PACE_ZONES.map((z) => z.label), day_types: DAY_TYPES, statuses: DAY_STATUSES };
}

export function searchLibrary(args) {
  const list = findWorkouts(args || {});
  return {
    count: list.length,
    workouts: list.map((w) => ({ id: w.id, name: w.name, type: w.type, races: w.races, phase: w.phase, level: w.level, total_min: w.total_min, main: w.main, source: w.source })),
  };
}

export async function getLibraryWorkout(db, personId, id) {
  const w = WORKOUTS.find((x) => x.id === id);
  if (!w) throw new LogError(`Unknown library workout "${id}"`);
  const fitness = personId ? await getFitness(db, personId, new Date().toISOString().slice(0, 10)) : null;
  if (!fitness?.vo2r) return { ...w, your_targets: 'No Fitness States yet: add PRs (set_prs) or sync the watch to get personal paces.' };
  return {
    ...w,
    your_targets: workoutTargets(w, fitness),
    your_paces: Object.fromEntries(fitness.zones.map((z) => [z.label, z.per_mile])),
  };
}

// ------------------------------------------------------------------ MCP tools

const DAY_PROPS = {
  manual_miles: { type: 'number', description: 'Total miles, only for days with no Strava runs (Strava runs are summed automatically)' },
  minutes: { type: 'number' },
  runs: { type: 'integer', description: 'Number of runs that day (doubles = 2)' },
  difficulty: { type: 'integer', minimum: 1, maximum: 10, description: 'How hard the day was, 1-10' },
  types: { type: 'array', items: { type: 'string', enum: DAY_TYPES } },
  status: { type: 'string', enum: [...DAY_STATUSES, ''] },
  planned: { type: 'string', description: 'The planned session, as prescribed' },
  library_id: { type: 'string', description: 'Workout library id, when the session was a library workout (lets you track progress on it)' },
  splits: { type: 'string', description: 'Rep splits as text, e.g. "800m 2:45; 800m 2:44". Prefer split_reps.' },
  split_reps: { type: 'array', description: 'Rep splits, one per rep: meters, seconds and the recovery after it', items: { type: 'object', properties: { m: { type: 'number' }, s: { type: 'number' }, rest: { type: 'string', description: 'e.g. "2:00" or "200m jog"' } }, required: ['m', 's'] } },
  day_line: { type: 'string', description: "Kai's one-line summary of the whole day" },
  summary: { type: 'string', description: 'What actually happened: dose, pace, HR, conditions, how it felt' },
  coach_note: { type: 'string', description: 'What was changed for upcoming days and why' },
  load_note: { type: 'string', description: 'Standing read on the last 7-10 days, carried forward' },
  feel: { type: 'integer', minimum: 1, maximum: 10, description: 'How the runner felt, 1 (awful) to 10 (great)' },
  sleep_hours: { type: 'number' },
  strength: { type: 'boolean', description: 'Did strength/core work' },
  notes: { type: 'string', description: "The athlete's own notes" },
};

const FIND_PROPS = {
  type: { type: 'string', enum: Object.keys(WORKOUT_TYPES) },
  race: { type: 'string', enum: RACES, description: 'Race being prepared for' },
  phase: { type: 'string', enum: PHASES },
  level: { type: 'integer', minimum: 1, maximum: 3, description: 'Max difficulty level: 1 beginner (30-35 mpw), 2 intermediate (40-50), 3 advanced (55+)' },
  max_min: { type: 'integer', description: 'Longest total session length in minutes' },
  min_min: { type: 'integer' },
  q: { type: 'string', description: 'Text search' },
};

// `withPerson` adds a person argument for the admin MCP; the coach MCP is
// already scoped to one runner.
export function logTools(withPerson) {
  const person = withPerson ? { person: { type: 'string', description: 'Name or id' } } : {};
  const req = withPerson ? ['person'] : [];
  return [
    {
      name: 'get_training_log',
      description: `Daily training log${withPerson ? ' for one person' : ''} between two dates (default: last 28 days): miles, runs, difficulty, run types, status vs plan, planned session, splits, summary and coach notes per day, plus Mon-Sun weekly totals. Runs synced from the watch or logged through Kai are merged in automatically, grouped into sessions with a plan tag per day.`,
      inputSchema: { type: 'object', required: req, properties: { ...person, from: { type: 'string' }, to: { type: 'string' } }, additionalProperties: false },
    },
    {
      name: 'log_day',
      description: 'Create or update one day of the training log. Only the fields you pass change. Use it after every coaching review: status vs plan, difficulty, summary of what happened, coach_note for any change you made, load_note for the rolling picture, and library_id if it was a library workout.',
      inputSchema: { type: 'object', required: [...req, 'date'], properties: { ...person, date: { type: 'string', description: 'YYYY-MM-DD' }, ...DAY_PROPS }, additionalProperties: false },
    },
    {
      name: 'find_workouts',
      description: `Search the Hawks workout library (${WORKOUTS.length} workouts built from the Hawks plans, past training logs and standard distance training). Filter by type (tempo, threshold, vo2, track, fartlek, hills, long, ...), race being trained for, season phase, level and session length. Use it whenever you suggest or swap a workout.`,
      inputSchema: { type: 'object', properties: FIND_PROPS, additionalProperties: false },
    },
    {
      name: 'get_workout',
      description: "Full details of one library workout: structure, paces, recovery, purpose, coaching cues and how to progress it, plus the runner's own rep targets and pace zones from their Fitness States.",
      inputSchema: { type: 'object', required: [...req, 'id'], properties: { ...person, id: { type: 'string' } }, additionalProperties: false },
    },
    {
      name: 'get_workout_history',
      description: 'Every time this runner did a given library workout, oldest first, with splits, HR, difficulty and notes. Use it to judge improvement and set the next target.',
      inputSchema: { type: 'object', required: [...req, 'id'], properties: { ...person, id: { type: 'string' } }, additionalProperties: false },
    },
    {
      name: 'set_prs',
      description: `Save the runner's personal records (merged into what's there; an empty time clears one). Events: ${PR_EVENTS.join(', ')}; a PR on a course is course:<id>:<metres>, e.g. course:vc:5000 for the 5K at Van Cortlandt or course:vc:4023 for the 2.5 mi. Kestrel also finds PRs itself from synced races, so only ask for ones it is missing. Ask for PRs during setup if they're missing.`,
      inputSchema: {
        type: 'object', required: [...req, 'prs'],
        properties: {
          ...person,
          prs: {
            type: 'object',
            description: 'Keyed by event, e.g. {"1600": {"time": "5:12", "date": "2026-05-07", "meet": "PSAL Champs"}}',
            additionalProperties: { type: 'object', properties: { time: { type: 'string' }, date: { type: 'string' }, meet: { type: 'string' } }, required: ['time'] },
          },
        },
        additionalProperties: false,
      },
    },
    {
      name: 'set_5k_time',
      description: "Set the runner's current 5K fitness (race or equivalent, mm:ss). Returns their pace for every training zone. Update it after a race or time trial.",
      inputSchema: { type: 'object', required: [...req, 'time'], properties: { ...person, time: { type: 'string', description: 'e.g. 19:25' } }, additionalProperties: false },
    },
  ];
}

export async function callLogTool(db, personId, name, a, today) {
  switch (name) {
    case 'get_training_log': {
      const to = isDate(a.to) ? a.to : today;
      const from = isDate(a.from) ? a.from : addDays(to, -27);
      const log = await getLog(db, personId, from, to);
      return { ...log, days: compactDays(log.days) };
    }
    case 'log_day': {
      const { person, date, ...fields } = a;
      return await saveDay(db, personId, date, fields);
    }
    case 'find_workouts': return searchLibrary(a);
    case 'get_workout': return await getLibraryWorkout(db, personId, a.id);
    case 'get_workout_history': return await workoutHistory(db, personId, a.id);
    case 'set_5k_time': return await setFiveK(db, personId, a.time);
    case 'set_prs': return await setPrs(db, personId, a.prs);
    default: return undefined;
  }
}
