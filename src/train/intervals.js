// intervals.icu sync: Garmin and COROS both sync to intervals.icu for free,
// and its API lets Hawks pull those runs (with laps) without Claude, Strava or
// any subscription. Each runner pastes their athlete id and API key once.
//
// The key is AES-GCM encrypted with a key derived from MCP_AUTH_TOKEN (a
// Worker secret) and is never returned to a browser.
//
// Runs get a rule-based category first (the math), then Hawky (Gemini), if
// it's set up, refines the category and writes one report per session.
// Scoring is the same logWorkouts path Hawky in Claude uses. Old history is
// imported in chunks with rules only, so it never spends the AI quota.
import { logWorkouts, todayInTz, COACH_RUBRIC, bodyStatus, backfillConditions } from './coach.js';
import { saveDay, sessionsOf } from './log.js';
import { reportSessions, AiError } from './gemini.js';
import { recomputeFitness } from './fitness.js';
import { gradeRun } from './grade.js';
import { inVanCortlandt, VC_RE } from './conditions.js';
import { vo2rFor, withPlans } from './coach.js';
import { looksLikeTrack, snap100, trackMilesFromMeters, TRACK_MILE_M } from './workouts.js';

export class IntervalsError extends Error {}

const API = 'https://intervals.icu/api/v1'; // ICU_API_BASE overrides it for local testing
const RUN_TYPES = new Set(['Run', 'TrailRun', 'VirtualRun', 'Treadmill', 'TrackRun']);
const FIRST_SYNC_DAYS = 28;
const MAX_LAP_FETCHES = 8; // Workers cap subrequests per invocation
const IMPORT_WINDOW_DAYS = 90;
const IMPORT_LAP_FETCHES = 20;
const IMPORT_MAX_YEARS = 6;
const AI_REPORT_DAYS = 10; // only recent sessions get an AI report
export const SYNC_CRON = '17 * * * *';
const PEOPLE_PER_CRON = 3;

// ------------------------------------------------------------------ crypto

async function aesKey(env) {
  // KESTREL_SECRET (a Worker secret) encrypts each athlete's intervals.icu key at rest.
  if (!env.KESTREL_SECRET) throw new IntervalsError('Watch sync is not set up on this server yet (KESTREL_SECRET).');
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.KESTREL_SECRET), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('kestrel-intervals'), info: new TextEncoder().encode('icu-key-v1') },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function encrypt(env, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(env), new TextEncoder().encode(text));
  return `${b64(iv)}.${b64(ct)}`;
}

async function decrypt(env, blob) {
  const [iv, ct] = String(blob || '').split('.');
  if (!iv || !ct) throw new IntervalsError('Not connected');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await aesKey(env), unb64(ct));
  return new TextDecoder().decode(pt);
}

// ------------------------------------------------------------------ API

async function icu(apiKey, path, env) {
  const res = await fetch((env?.ICU_API_BASE || API) + path, { headers: { Authorization: 'Basic ' + btoa('API_KEY:' + apiKey), Accept: 'application/json' } });
  if (res.status === 401 || res.status === 403) throw new IntervalsError('intervals.icu rejected the API key or athlete id.');
  if (res.status === 404) throw new IntervalsError('intervals.icu athlete not found. Check the athlete id (it looks like i12345).');
  if (!res.ok) throw new IntervalsError(`intervals.icu error ${res.status}`);
  return res.json();
}

const athletePath = (id) => `/athlete/${encodeURIComponent(id)}`;

export async function connect(env, personId, athleteId, apiKey) {
  const id = String(athleteId || '').trim();
  const key = String(apiKey || '').trim();
  if (!/^i?\d{1,12}$/.test(id)) throw new IntervalsError('Athlete id looks like i12345 (Settings on intervals.icu, under your name).');
  if (key.length < 10 || key.length > 200) throw new IntervalsError('Paste the API key from intervals.icu Settings → Developer Settings.');
  const me = await icu(key, athletePath(id), env);
  const person = await env.DB.prepare('SELECT id FROM people WHERE id = ?').bind(personId).first();
  if (!person) throw new IntervalsError('Unknown person');
  await env.DB.prepare("UPDATE people SET icu_athlete = ?, icu_key_enc = ?, icu_synced_at = NULL, icu_status = ?, icu_import_cursor = '', icu_import_done = 0 WHERE id = ?")
    .bind(id, await encrypt(env, key), 'connected', personId).run();
  return { connected: true, athlete: id, name: me?.name || '' };
}

// The decrypted key for calls Hawks makes on the runner's behalf (writing planned workouts); never sent to a browser.
export async function credentials(env, personId) {
  const person = await loadPerson(env, personId);
  return { athlete: person.icu_athlete, key: await decrypt(env, person.icu_key_enc), base: env?.ICU_API_BASE || API };
}

export async function disconnect(env, personId) {
  await env.DB.prepare("UPDATE people SET icu_athlete = '', icu_key_enc = '', icu_synced_at = NULL, icu_status = '', icu_import_cursor = '', icu_import_done = 0 WHERE id = ?").bind(personId).run();
  return { connected: false };
}

export async function status(db, personId) {
  const row = await db.prepare('SELECT icu_athlete, icu_key_enc, icu_synced_at, icu_status, icu_import_cursor, icu_import_done FROM people WHERE id = ?').bind(personId).first();
  if (!row) return null;
  return {
    connected: !!row.icu_key_enc, athlete: row.icu_athlete || '', synced_at: row.icu_synced_at || null, status: row.icu_status || '',
    import_done: !!row.icu_import_done, import_cursor: String(row.icu_import_cursor || '').split('|')[0] || null,
  };
}

// ------------------------------------------------------------------ math

function fmtPace(secPerMile) {
  if (!secPerMile || !Number.isFinite(secPerMile)) return null;
  const s = Math.round(secPerMile);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function fmtTime(sec) {
  const s = Math.round(sec);
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s}s`;
}

// WORK intervals -> "800m 2:45 (5:32/mi, 178)" style splits. On the track
// the reps read as the lines (nearest 100 m) and a mile is 1600 m.
function splitsText(laps, track) {
  return laps.slice(0, 20).map((l) => {
    const m = track ? snap100(l.m) : l.m;
    const mile = track ? TRACK_MILE_M : 1609.344;
    const dist = !track && m >= 1500 && Math.abs(m - 1609) < 40 ? '1 mi' : `${m}m`;
    return `${dist} ${fmtTime(l.s)} (${fmtPace(l.s / (m / mile))}/mi${l.hr ? `, ${l.hr}` : ''})`;
  }).join('; ');
}

function splitsFrom(intervals) {
  const all = (intervals || []).filter((i) => i.distance > 0);
  const work = all.filter((i) => i.type === 'WORK' && i.distance > 50 && i.moving_time > 0);
  // Every segment snapped to the lines: the session's distance if it was on a track.
  const trackM = all.reduce((a, i) => a + (i.distance >= 50 ? snap100(i.distance) : 0), 0);
  if (work.length < 2) return { work: [], laps: [], trackM };
  const laps = work.slice(0, 40).map((i) => ({ m: Math.round(i.distance), s: i.moving_time, hr: i.average_heartrate ? Math.round(i.average_heartrate) : null }));
  return { work, laps, trackM };
}

// The pre-built, no-AI classifier: HR share of max, structure and distance.
function ruleCategory(a, work, maxHr, longest, vo2r, laps = []) {
  if (!RUN_TYPES.has(a.type)) return 'crosstrain';
  const miles = (a.distance || 0) / 1609.344;
  const hrPct = a.average_heartrate ? a.average_heartrate / maxHr : null;
  if (/race|meet|xc|5k|champ|invitational/i.test(a.name || '') && (hrPct ?? 0) > 0.86) return 'race';
  if (work.length >= 3) return 'workout';
  // Pace against the runner's own training paces, checked by heart rate (grade.js).
  const g = gradeRun({
    distance_mi: miles, moving_sec: a.moving_time, avg_hr: a.average_heartrate, laps,
    elev_gain_ft: a.total_elevation_gain != null ? a.total_elevation_gain * 3.281 : null, name: a.name || '', category: 'easy',
  }, { vo2r, maxHr });
  if (g.hr_effort >= 6 && miles >= 2 && (g.pace_effort == null || g.pace_effort >= 6)) return 'workout';
  if (miles >= 7 && miles >= longest * 0.9) return 'long';
  if (miles <= 3.2 && g.hr_effort <= 3) return 'recovery';
  return 'easy';
}

function dayTypes(category, work) {
  const t = { easy: ['easy'], recovery: ['recovery'], long: ['long'], race: ['race'], shakeout: ['shakeout'], crosstrain: ['crosstrain'] }[category];
  if (t) return t;
  if (!work.length) return ['tempo'];
  const avg = work.reduce((s, i) => s + i.distance, 0) / work.length;
  return avg <= 450 ? ['track'] : avg >= 1400 ? ['threshold'] : ['intervals'];
}

// ------------------------------------------------------------------ sync

const WORKOUT_NAME = /\d\s*x|x\s*\d|rep|interval|tempo|workout|track|fartlek|threshold|hill|cruise|ladder|progression|race|meet|xc|\bk\b/i;

// Whether an activity's laps are worth a fetch: a workout, not auto-laps on
// an easy run.
function wantsLaps(a, maxHr) {
  const n = a.icu_lap_count || 0;
  if (!RUN_TYPES.has(a.type) || n < 2 || n > 60) return false;
  const hrPct = a.average_heartrate ? a.average_heartrate / maxHr : 0;
  return WORKOUT_NAME.test(a.name || '') || hrPct >= 0.8 || !!a.interval_summary?.length;
}

// Extra numbers intervals.icu works out per activity, for the log. Speeds
// are m/s; anything outside a sane range is left out.
function metricsOf(a) {
  const n = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : undefined);
  const perMile = (mps) => (n(mps, 1, 10) ? 1609.344 / mps : undefined);
  const zones = Array.isArray(a.icu_hr_zone_times) && a.icu_hr_zone_times.length <= 12 && a.icu_hr_zone_times.every((x) => Number.isFinite(x)) ? a.icu_hr_zone_times : undefined;
  const m = {
    gap_sec_mi: perMile(a.gap),
    max_pace_sec_mi: perMile(a.max_speed),
    decoupling: n(a.decoupling, -50, 100),
    ef: n(a.icu_efficiency_factor, 0.1, 10),
    hr_zones: zones,
    icu_load: n(a.icu_training_load, 0, 2000),
    trimp: n(a.trimp, 0, 2000),
    intensity: n(a.icu_intensity, 0, 300),
    stride_m: n(a.average_stride, 0.3, 3),
    calories: n(a.calories, 1, 10000),
    elev_loss_ft: n(a.total_elevation_loss, 0, 15000) !== undefined ? Math.round(a.total_elevation_loss * 3.281) : undefined,
    rpe: n(a.icu_rpe, 1, 10),
  };
  for (const k of Object.keys(m)) if (m[k] === undefined) delete m[k];
  return m;
}

// GPS start of an activity: the summary's position when intervals.icu sends one.
function startOf(a) {
  const ll = a.start_latlng || a.startLatlng;
  const lat = Array.isArray(ll) ? ll[0] : a.start_lat ?? a.startLat;
  const lon = Array.isArray(ll) ? ll[1] : a.start_lon ?? a.start_lng ?? a.startLon ?? a.startLng;
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) > 0.01 ? [lat, lon] : null;
}

// Without a position in the summary, read the first GPS point of the run's
// stream (only for runs that say they were at Van Cortlandt).
async function streamStart(key, id, env) {
  try {
    const s = await icu(key, `/activity/${encodeURIComponent(id)}/streams?types=latlng`, env);
    const st = (Array.isArray(s) ? s : s?.streams || []).find((x) => x?.type === 'latlng');
    const a = st?.data, b = st?.data2;
    if (Array.isArray(a) && Array.isArray(b)) {
      const i = a.findIndex((v, k) => Number.isFinite(v) && Number.isFinite(b[k]) && Math.abs(v) > 0.01);
      return i >= 0 ? [a[i], b[i]] : null;
    }
    const p = Array.isArray(a) ? a.find((x) => Array.isArray(x) && Number.isFinite(x[0]) && Math.abs(x[0]) > 0.01) : null;
    return p ? [p[0], p[1]] : null;
  } catch { return null; }
}

const timeOf = (a) => (String(a.start_date_local || '').match(/T(\d{2}:\d{2})/) || [])[1] || '';
const dateOf = (a) => String(a.start_date_local || '').slice(0, 10);

// Pull activities between two dates and log them. `ai` turns on Hawky's
// session reports for recent sessions.
async function importRange(env, person, key, { oldest, newest, ai: useAi, lapBudget }) {
  const db = env.DB;
  const today = todayInTz();
  const acts = await icu(key, `${athletePath(person.icu_athlete)}/activities?oldest=${oldest}&newest=${newest}`, env);
  const all = Array.isArray(acts) ? acts : [];
  // Strava-sourced activities come back as stubs (Strava doesn't let
  // intervals.icu share them), so only real files are used.
  const skippedStrava = all.filter((a) => a?.source === 'STRAVA').length;
  const usable = all.filter((a) => a && a.id && a.distance > 0 && a.moving_time > 0 && a.source !== 'STRAVA');

  const ids = usable.map((a) => `intervals:${a.id}`);
  const logged = new Set();
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    (await db.prepare(`SELECT strava_id FROM workouts WHERE person_id = ? AND strava_id IN (${chunk.map(() => '?').join(',')})`)
      .bind(person.id, ...chunk).all()).results.forEach((r) => logged.add(r.strava_id));
  }
  const fresh = usable.filter((a) => !logged.has(`intervals:${a.id}`));
  // Runs already in Hawks still get the newest numbers intervals.icu has (no
  // extra requests), and a start time if they were logged before we kept one:
  // without it the day's runs can't be put in order.
  const refresh = usable.filter((a) => logged.has(`intervals:${a.id}`)).map((a) => [a, JSON.stringify(metricsOf(a)), timeOf(a)]).filter(([, m, t]) => m !== '{}' || t);
  for (let i = 0; i < refresh.length; i += 50) {
    await db.batch(refresh.slice(i, i + 50).map(([a, m, t]) => db.prepare(
      "UPDATE workouts SET metrics = COALESCE(NULLIF(?, '{}'), metrics), start_local = COALESCE(NULLIF(start_local, ''), NULLIF(?, '')) WHERE person_id = ? AND strava_id = ?"
    ).bind(m, t, person.id, `intervals:${a.id}`)));
  }
  const gpsRefresh = usable.filter((a) => logged.has(`intervals:${a.id}`) && startOf(a));
  for (let i = 0; i < gpsRefresh.length; i += 50) {
    await db.batch(gpsRefresh.slice(i, i + 50).map((a) => db.prepare('UPDATE workouts SET gps_vc = ? WHERE person_id = ? AND strava_id = ?')
      .bind(inVanCortlandt(...startOf(a)) ? 1 : 0, person.id, `intervals:${a.id}`)));
  }
  if (!fresh.length) return { imported: 0, checked: usable.length, total: all.length, skipped_strava: skippedStrava };

  const maxRow = await db.prepare('SELECT MAX(max_hr) AS m FROM workouts WHERE person_id = ?').bind(person.id).first();
  const maxHr = Math.max(maxRow?.m || 0, ...fresh.map((a) => a.max_heartrate || 0)) || 200;

  // Longest run per week decides what counts as a "long" run.
  const weekLongest = new Map();
  for (const a of usable) {
    const wk = dateOf(a).slice(0, 8) + String(Math.floor(Number(dateOf(a).slice(8)) / 7));
    weekLongest.set(wk, Math.max(weekLongest.get(wk) || 0, a.distance / 1609.344));
  }

  const vo2r = await vo2rFor(db, person.id);
  let lapFetches = 0;
  let gpsFetches = 0;
  const runs = [];
  // Most likely workouts get their laps first.
  const order = [...fresh].sort((x, y) => Number(wantsLaps(y, maxHr)) - Number(wantsLaps(x, maxHr)) || String(y.start_date_local).localeCompare(String(x.start_date_local)));
  for (const a of order) {
    let work = [];
    let laps = [];
    let trackM = 0;
    if (wantsLaps(a, maxHr) && lapFetches < lapBudget) {
      lapFetches++;
      try {
        const iv = await icu(key, `/activity/${encodeURIComponent(a.id)}/intervals`, env);
        ({ work, laps, trackM } = splitsFrom(iv?.icu_intervals));
      } catch { /* laps are a nice-to-have */ }
    }
    let gpsStart = startOf(a);
    if (!gpsStart && VC_RE.test(`${a.name || ''} ${a.description || ''}`) && gpsFetches < 8) { gpsFetches++; gpsStart = await streamStart(key, a.id, env); }
    const date = dateOf(a);
    const wk = date.slice(0, 8) + String(Math.floor(Number(date.slice(8)) / 7));
    const miles = a.distance / 1609.344;
    const track = RUN_TYPES.has(a.type) && looksLikeTrack({ name: a.name || '', type: a.type, elevFtPerMile: ((a.total_elevation_gain || 0) * 3.281) / Math.max(miles, 0.1), laps });
    runs.push({ a, gps: gpsStart ? (inVanCortlandt(...gpsStart) ? 1 : 0) : null, work, laps, track, trackM, splits: laps.length ? splitsText(laps, track) : '', date, start: timeOf(a), category: ruleCategory(a, work, maxHr, weekLongest.get(wk) || 0, vo2r, laps) });
  }
  runs.sort((x, y) => (x.date + x.start).localeCompare(y.date + y.start));

  // Hawky: one report per session (warm-up + workout + cool-down together)
  // for recent days. Failures fall back to the rule-based labels.
  let ai = null;
  let aiNote = '';
  const recentFrom = todayInTz(new Date(Date.now() - AI_REPORT_DAYS * 86400000));
  const recent = runs.filter((r) => r.date >= recentFrom);
  if (recent.length && useAi) {
    const pseudo = recent.map((r) => ({
      strava_id: String(r.a.id), date: r.date, category: r.category, distance_mi: r.a.distance / 1609.344,
      moving_sec: r.a.moving_time, elapsed_sec: r.a.elapsed_time, start_local: r.start, name: r.a.name || '',
    }));
    // What the athlete's teams had on those days, so the AI can tell where a race was.
    const calendar = (await db.prepare(
      `SELECT e.date, e.type, e.title, e.location, l.name AS loc_name FROM events e
       JOIN team_members tm ON tm.team_id = e.team_id AND tm.person_id = ?
       LEFT JOIN locations l ON l.id = e.location_id WHERE e.date >= ?`
    ).bind(person.id, recentFrom).all()).results
      .filter((e) => pseudo.some((p) => p.date === e.date))
      .map((e) => ({ date: e.date, type: e.type, title: e.title, location: e.loc_name || e.location || '' }));
    const byDate = new Map();
    pseudo.forEach((p) => byDate.set(p.date, [...(byDate.get(p.date) || []), p]));
    const sessions = [];
    for (const [date, list] of byDate) {
      for (const sess of sessionsOf(list)) {
        sessions.push({
          key: sess.key, date,
          activities: sess.activities.map((x) => {
            const r = recent.find((y) => String(y.a.id) === x.id);
            return {
              id: x.id, start: r.start, name: r.a.name || '', type: r.a.type, rule_category: r.category,
              elev_ft: r.a.total_elevation_gain != null ? Math.round(r.a.total_elevation_gain * 3.281) : null,
              miles: Math.round(r.a.distance / 16.09344) / 100, minutes: Math.round(r.a.moving_time / 60),
              pace: fmtPace(r.a.moving_time / (r.a.distance / 1609.344)), avg_hr: r.a.average_heartrate || null, max_hr: r.a.max_heartrate || null,
              laps: r.splits || null, on_track: r.track || undefined, gps_at_van_cortlandt: r.gps == null ? undefined : !!r.gps, athlete_note: (r.a.description || '').slice(0, 300) || null,
            };
          }),
        });
      }
    }
    try {
      ai = await reportSessions(env, db, person, sessions, { rubric: COACH_RUBRIC, maxHr, today, body: await bodyStatus(db, person.id), calendar });
    } catch (err) {
      aiNote = err instanceof AiError ? err.message : 'AI unavailable';
    }
  }
  const catById = new Map();
  const courseById = new Map();
  const reportById = new Map();
  for (const sess of ai?.sessions || []) {
    for (const x of sess.activities || []) if (x?.id && x?.category) catById.set(String(x.id), x.category);
    for (const x of sess.activities || []) if (x?.id && x?.course) courseById.set(String(x.id), x.course);
    if (sess.main_id && sess.report) reportById.set(String(sess.main_id), sess.report);
  }

  const rows = runs.map((r) => ({
    source: 'intervals', activity_id: String(r.a.id), date: r.date, name: r.a.name || '', sport: r.a.type,
    category: catById.get(String(r.a.id)) || r.category,
    // On the track the session's miles come from its segments snapped to the lines.
    distance_mi: r.track && r.trackM ? trackMilesFromMeters(r.trackM) : Math.round(r.a.distance / 16.09344) / 100,
    raw_distance_mi: Math.round(r.a.distance / 16.09344) / 100,
    surface: r.track ? 'track' : '',
    moving_sec: r.a.moving_time, elapsed_sec: r.a.elapsed_time,
    avg_hr: r.a.average_heartrate, max_hr: r.a.max_heartrate, avg_cadence: r.a.average_cadence,
    elev_gain_ft: r.a.total_elevation_gain != null ? Math.round(r.a.total_elevation_gain * 3.281) : null,
    start_local: r.start, laps: r.laps,
    course: courseById.get(String(r.a.id)) || '',
    metrics: metricsOf(r.a),
    summary: reportById.get(String(r.a.id)) || '',
  }));
  let imported = 0;
  for (let i = 0; i < rows.length; i += 60) {
    imported += (await logWorkouts(db, person, rows.slice(i, i + 60))).logged.length;
  }

  // The GPS verdict on each run's course (the course column holds Hawky's guess).
  const gpsRuns = runs.filter((r) => r.gps != null);
  for (let i = 0; i < gpsRuns.length; i += 50) {
    await db.batch(gpsRuns.slice(i, i + 50).map((r) => db.prepare('UPDATE workouts SET gps_vc = ? WHERE person_id = ? AND strava_id = ?')
      .bind(r.gps, person.id, `intervals:${r.a.id}`)));
  }

  // Workouts also go on the day log with their rep splits; Hawky's day lines too.
  for (const r of runs) {
    if (!r.splits) continue;
    const existing = await db.prepare('SELECT splits FROM training_days WHERE person_id = ? AND date = ?').bind(person.id, r.date).first();
    if (existing?.splits) continue;
    await saveDay(db, person.id, r.date, { splits: r.splits, types: dayTypes(catById.get(String(r.a.id)) || r.category, r.work), ...(r.track ? { surface: 'track' } : {}) });
  }
  for (const d of ai?.days || []) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(d?.date || '') && d.line) await saveDay(db, person.id, d.date, { day_line: d.line });
  }
  return { imported, checked: usable.length, total: all.length, skipped_strava: skippedStrava, ai: !!ai, ai_note: aiNote || undefined };
}

async function loadPerson(env, personId) {
  const person = await withPlans(env.DB, await env.DB.prepare(
    'SELECT id, name, class_year, plan_rank, coach_rank, health_status, health_updated_at, training_status, icu_athlete, icu_key_enc, icu_synced_at, icu_import_cursor, icu_import_done FROM people WHERE id = ?'
  ).bind(personId).first());
  if (!person?.icu_key_enc) throw new IntervalsError('Not connected to intervals.icu');
  return person;
}

async function fail(env, person, err) {
  const msg = err instanceof IntervalsError ? err.message : 'Sync failed';
  if (!(err instanceof IntervalsError)) console.error('intervals sync', person.id, err);
  await env.DB.prepare('UPDATE people SET icu_status = ? WHERE id = ?').bind('error: ' + msg, person.id).run();
  return err instanceof IntervalsError ? err : new IntervalsError(msg);
}

function stravaNote(res) {
  return res.skipped_strava && !res.checked
    ? `${res.skipped_strava} ${res.skipped_strava === 1 ? 'activity' : 'activities'} came from Strava, which doesn't share runs with intervals.icu. Connect Garmin or COROS directly in intervals.icu.`
    : '';
}

// Resting HR, HRV and sleep for the last 5 weeks (Garmin sends them to
// intervals.icu when the watch is worn overnight). One request per sync.
// The watch's VO2max from intervals.icu wellness (Garmin sends it; COROS fills
// the same field when its sync provides one). Field spelling varies by source.
function vo2Of(w) {
  const v = w.vo2max ?? w.VO2max ?? w.vo2Max ?? w.vo2_max;
  return v > 20 && v < 95 ? v : null;
}

async function syncWellness(env, person, key, today) {
  // A year the first time (to line Garmin's VO2max up with past races), then 5 weeks.
  const have = await env.DB.prepare('SELECT COUNT(*) AS n FROM wellness WHERE person_id = ?').bind(person.id).first();
  const oldest = todayInTz(new Date(Date.now() - (have?.n > 60 ? 35 : 365) * 86400000));
  let rows;
  try {
    rows = await icu(key, `${athletePath(person.icu_athlete)}/wellness?oldest=${oldest}&newest=${today}`, env);
  } catch { return 0; }
  const good = (Array.isArray(rows) ? rows : []).filter((w) => /^\d{4}-\d{2}-\d{2}$/.test(w?.id || ''))
    .map((w) => ({
      date: w.id,
      rhr: w.restingHR > 25 && w.restingHR < 120 ? w.restingHR : null,
      hrv: w.hrv > 5 && w.hrv < 300 ? w.hrv : null,
      sleep: w.sleepSecs > 3600 && w.sleepSecs < 16 * 3600 ? Math.round((w.sleepSecs / 3600) * 10) / 10 : null,
      score: w.sleepScore > 0 && w.sleepScore <= 100 ? w.sleepScore : null,
      vo2: vo2Of(w),
      ctl: Number.isFinite(w.ctl) ? Math.round(w.ctl * 10) / 10 : null,
      atl: Number.isFinite(w.atl) ? Math.round(w.atl * 10) / 10 : null,
    }))
    .filter((w) => w.rhr || w.hrv || w.sleep || w.vo2 || w.ctl != null);
  if (!good.length) return 0;
  const stmts = good.map((w) => env.DB.prepare(
    `INSERT INTO wellness (person_id, date, resting_hr, hrv, sleep_hours, sleep_score, vo2max, ctl, atl) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(person_id, date) DO UPDATE SET resting_hr = excluded.resting_hr, hrv = excluded.hrv, sleep_hours = excluded.sleep_hours,
       sleep_score = excluded.sleep_score, vo2max = excluded.vo2max, ctl = excluded.ctl, atl = excluded.atl`
  ).bind(person.id, w.date, w.rhr, w.hrv, w.sleep, w.score, w.vo2, w.ctl, w.atl));
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
  return good.length;
}

// Best efforts inside any run over the last year (intervals.icu's pace curve:
// fastest time for each distance, with the activity it came from). One
// request per sync; anything unexpected in the response is skipped.
const EFFORT_METERS = [400, 800, 1000, 1600, 1609, 3200, 5000, 8000, 10000];
async function syncBestEfforts(env, person, key) {
  // All-time curve first (PRs are "ever"); the one-year curve if that isn't accepted.
  let res;
  for (const span of ['all', '1y']) {
    try {
      res = await icu(key, `${athletePath(person.icu_athlete)}/pace-curves?type=Run&curves=${span}`, env);
      if ((Array.isArray(res?.list) ? res.list : Array.isArray(res) ? res : [])[0]) break;
    } catch (err) {
      console.log('pace-curves failed', span, err.message);
    }
  }
  if (!res) return 0;
  const curve = (Array.isArray(res?.list) ? res.list : Array.isArray(res) ? res : [])[0];
  if (!curve) { console.log('pace-curves: no list', Object.keys(res || {}).join(',')); return 0; }
  const dist = curve.distance || [];
  // values are seconds; GPS spikes at the very short end (15+ m/s) are skipped point by point.
  const times = curve.values || curve.secs || [];
  const ok = (i) => dist[i] > 0 && times[i] > 0 && dist[i] / times[i] > 1.5 && dist[i] / times[i] < 9.5;
  // intervals.icu fits a critical speed model to the same curve.
  const cs = (curve.paceModels || []).find((m) => m?.type === 'CS' && m.criticalSpeed > 2 && m.criticalSpeed < 7 && m.dPrime > 0 && m.dPrime < 800);
  if (cs) {
    await env.DB.prepare(
      `INSERT INTO pace_models (person_id, cs, d_prime, r2, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(person_id) DO UPDATE SET cs = excluded.cs, d_prime = excluded.d_prime, r2 = excluded.r2, updated_at = excluded.updated_at`
    ).bind(person.id, cs.criticalSpeed, cs.dPrime, cs.r2 ?? null, Date.now()).run();
  }
  const acts = res?.activities || {};
  const rows = [];
  for (const m of EFFORT_METERS) {
    let best = -1;
    dist.forEach((d, i) => { if (ok(i) && Math.abs(d - m) / m <= 0.01 && (best < 0 || Math.abs(d - m) < Math.abs(dist[best] - m))) best = i; });
    if (best < 0 || !times[best]) continue;
    const aid = String(curve.activity_id?.[best] || '');
    const date = String(acts[aid]?.start_date_local || '').slice(0, 10) || null;
    rows.push(env.DB.prepare(
      `INSERT INTO best_efforts (person_id, meters, sec, date, activity_id, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(person_id, meters) DO UPDATE SET sec = excluded.sec, date = excluded.date, activity_id = excluded.activity_id, updated_at = excluded.updated_at`
    ).bind(person.id, m, times[best] * (m / dist[best]), date, aid, Date.now()));
  }
  if (rows.length) await env.DB.batch(rows);
  return rows.length;
}

// `backfill` also looks up the weather for older runs (one or two requests):
// on for syncs from the page, off for the cron, which does it once at the end.
export async function syncPerson(env, personId, { days, backfill = false } = {}) {
  const db = env.DB;
  const person = await loadPerson(env, personId);
  const today = todayInTz();
  try {
    const key = await decrypt(env, person.icu_key_enc);
    const lastSyncDay = person.icu_synced_at ? todayInTz(new Date(person.icu_synced_at - 3 * 86400000)) : null;
    const oldest = days ? todayInTz(new Date(Date.now() - days * 86400000)) : (lastSyncDay || todayInTz(new Date(Date.now() - FIRST_SYNC_DAYS * 86400000)));
    const res = await importRange(env, person, key, { oldest, newest: today, ai: true, lapBudget: MAX_LAP_FETCHES });
    res.wellness_days = await syncWellness(env, person, key, today);
    res.best_efforts = await syncBestEfforts(env, person, key);
    if (backfill) res.weather = await backfillConditions(db, person.id);
    const note = [res.ai_note, stravaNote(res)].filter(Boolean).join(' ');
    await db.prepare('UPDATE people SET icu_synced_at = ?, icu_status = ? WHERE id = ?').bind(Date.now(), note ? `ok (${note})` : 'ok', person.id).run();
    // Always: the PR search and fitness re-run on everything, not just new runs.
    await recomputeFitness(db, person.id, today);
    return { ...res, note: note || undefined };
  } catch (err) {
    throw await fail(env, person, err);
  }
}

// Full history, newest to oldest, one window per call. The page calls this
// until done; the cron also advances it so nobody has to wait on the page.
// Cursor format: "<oldest date reached>|<empty windows in a row>".
export async function importHistory(env, personId, { lapBudget = IMPORT_LAP_FETCHES } = {}) {
  const db = env.DB;
  const person = await loadPerson(env, personId);
  const today = todayInTz();
  if (person.icu_import_done) return { done: true, imported: 0, cursor: String(person.icu_import_cursor || '').split('|')[0] || null };
  try {
    const key = await decrypt(env, person.icu_key_enc);
    const [cur, emptyRaw] = String(person.icu_import_cursor || '').split('|');
    const newest = /^\d{4}-\d{2}-\d{2}$/.test(cur || '') ? cur : today;
    const oldestD = new Date(newest + 'T12:00:00Z');
    oldestD.setUTCDate(oldestD.getUTCDate() - IMPORT_WINDOW_DAYS);
    const oldest = oldestD.toISOString().slice(0, 10);
    const res = await importRange(env, person, key, { oldest, newest, ai: false, lapBudget });
    const empty = res.total === 0 ? Number(emptyRaw || 0) + 1 : 0;
    const tooOld = oldest < todayInTz(new Date(Date.now() - IMPORT_MAX_YEARS * 365 * 86400000));
    const done = empty >= 3 || tooOld;
    const cursor = oldest;
    await db.prepare('UPDATE people SET icu_import_cursor = ?, icu_import_done = ? WHERE id = ?').bind(`${cursor}|${empty}`, done ? 1 : 0, person.id).run();
    if (res.imported || done) await recomputeFitness(db, person.id, today);
    return { ...res, done, cursor, note: stravaNote(res) || undefined };
  } catch (err) {
    throw await fail(env, person, err);
  }
}

// Cron: a few connected people per run, least recently synced first, so the
// whole team cycles through without hitting per-invocation fetch limits
// (each sync is at most 1 + 8 lap fetches + 1 AI call + 1 weather lookup). Then one history
// window for one person whose import isn't finished, with a smaller lap budget.
const CRON_IMPORT_LAPS = 8;
export async function syncDue(env) {
  const due = (await env.DB.prepare(
    "SELECT id FROM people WHERE icu_key_enc != '' ORDER BY COALESCE(icu_synced_at, 0) ASC LIMIT ?"
  ).bind(PEOPLE_PER_CRON).all()).results;
  const out = [];
  for (const p of due) {
    try { out.push({ id: p.id, ...(await syncPerson(env, p.id)) }); } catch (err) { out.push({ id: p.id, error: err.message }); }
  }
  const pending = await env.DB.prepare(
    "SELECT id FROM people WHERE icu_key_enc != '' AND COALESCE(icu_import_done, 0) = 0 ORDER BY COALESCE(icu_synced_at, 0) DESC LIMIT 1"
  ).first();
  let imported = false;
  if (pending) {
    try { out.push({ id: pending.id, import: await importHistory(env, pending.id, { lapBudget: CRON_IMPORT_LAPS }) }); imported = true; } catch (err) { out.push({ id: pending.id, import_error: err.message }); }
  }
  // Weather for older runs, one runner per run (watch or not), then their
  // Fitness States are worked out again with it. Skipped when a history
  // window was imported this run, to stay under the per-run request cap.
  const noWx = await env.DB.prepare(
    "SELECT person_id FROM workouts WHERE COALESCE(weather_checked, 0) = 0 AND category != 'crosstrain' AND date <= ? LIMIT 1"
  ).bind(todayInTz()).first();
  if (noWx && !imported) {
    try {
      const n = await backfillConditions(env.DB, noWx.person_id);
      if (n) await recomputeFitness(env.DB, noWx.person_id, todayInTz());
      out.push({ id: noWx.person_id, weather: n });
    } catch (err) { out.push({ id: noWx.person_id, weather_error: err.message }); }
  }
  return out;
}
