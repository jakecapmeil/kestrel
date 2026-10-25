// Plan -> watch. Garmin and COROS both pull planned workouts from intervals.icu (Settings, "upload planned workouts"), and Kessler already
// holds each runner's intervals.icu key, so the plan is sent there as structured running workouts with the runner's own Fitness States paces.
//
//   buildWorkout(day, fitness, personId)  one plan day -> an intervals.icu event (or null for an off day)
//   planWorkouts(db, person, fitness, today, days)  the next `days` days as events (the dry-run preview)
//   pushPlan(env, personId, { days })     sends them; re-sending updates in place (events carry external_id "hawks:<person>:<date>"),
//                                          days that became rest lose their workout, then reads everything back to check intervals.icu parsed the steps
//
// Workout text follows intervals.icu's builder: "- <distance or time> <pace range>/mi Pace" lines, a block per set ("6x" header), blank lines between blocks.
import { planWeek } from './kai.js';
import { weekStartOf, todayInTz, loadPerson } from './coach.js';
import { getFitness } from './fitness.js';
import { segmentsOf, zoneOf } from './workouts.js';
import { credentials, IntervalsError } from './intervals.js';

const MILE_M = 1609.344;
const addDays = (key, n) => new Date(Date.parse(key + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const r2 = (x) => Math.round(x * 100) / 100;

const fmtPace = (s) => { const r = Math.round(s); return `${Math.floor(r / 60)}:${String(r % 60).padStart(2, '0')}`; };
// intervals.icu's own examples write a pace range slow-to-fast ("7:15-7:00/km Pace").
const paceRange = (fast, slow) => `${fmtPace(slow)}-${fmtPace(fast)}/mi Pace`;
const around = (s, pct = 0.02) => paceRange(s * (1 - pct), s * (1 + pct));
const distText = (m) => (m >= 1000 && m % 1000 === 0 ? `${m / 1000}km` : `${Math.round(m)}mtr`);
const timeText = (s) => { const m = Math.floor(s / 60); const x = Math.round(s % 60); return m ? `${m}m${x ? x + 's' : ''}` : `${x}s`; };
const labelDist = (m) => (m >= 1000 && m % 1000 === 0 ? `${m / 1000}K` : Math.abs(m - MILE_M) < 5 ? 'mile' : m >= MILE_M * 1.9 && Math.abs(m / MILE_M - Math.round(m / MILE_M)) < 0.02 ? `${Math.round(m / MILE_M)} mi` : `${Math.round(m)}m`);

function zoneTools(fitness) {
  const zones = fitness?.zones || [];
  const get = (key) => zones.find((z) => z.key === key);
  const sec = (key) => { const z = get(key); return z ? (Array.isArray(z.sec) ? (z.sec[0] + z.sec[1]) / 2 : z.sec) : null; };
  const easy = get('easy');
  return { sec, easy: easy && Array.isArray(easy.sec) ? easy.sec : null };
}

// Rest between reps, from the session text: "200 jog rest", "90 seconds standing rest", "2 min jog recovery", "(3 min on, 1 min off)".
export function restOf(text) {
  const t = String(text || '').toLowerCase();
  const found = [];
  for (const m of t.matchAll(/(\d+)\s*(?:m\b|meters?|metres?)?\s*(?:easy\s+)?(?:jog|walk)\b/g)) if (Number(m[1]) >= 50) found.push({ i: m.index, m: Number(m[1]) });
  for (const m of t.matchAll(/(\d+)\s*(?:seconds?|secs?|s)\b[^,;]*?(?:rest|jog|recovery|off|standing)/g)) found.push({ i: m.index, sec: Number(m[1]) });
  for (const m of t.matchAll(/(\d+)(?::(\d{2}))?\s*min(?:ute)?s?\b[^,;]*?(?:rest|jog|recovery|off)/g)) found.push({ i: m.index, sec: Number(m[1]) * 60 + (m[2] ? Number(m[2]) : 0) });
  found.sort((a, b) => a.i - b.i);
  return found[0] || null;
}

const isRest = (s) => /\b(jog|rest|recovery|walk|standing)\b/i.test(s.text || '');

// One plan day -> { name, description, moving_time, ... } or null (nothing to send).
export function buildWorkout(day, fitness, personId) {
  if (!day || day.type === 'Off' || day.type === 'Cross-train' || !(day.miles > 0)) return null;
  const { sec, easy } = zoneTools(fitness);
  if (!easy) return null;
  const easyR = paceRange(easy[0], easy[1]);
  const easyMid = (easy[0] + easy[1]) / 2;
  const notes = `${day.base?.notes || ''} ${day.detail || ''}`;
  const num = (re) => { const m = notes.match(re); return m ? Number(m[1]) : null; };
  const wu = num(/(\d+(?:\.\d+)?)\s*wu\b/i);
  const cd = num(/(\d+(?:\.\d+)?)\s*cd\b/i);
  const blocks = [];
  let seconds = 0;
  const addSeconds = (m, paceSec) => { seconds += (m / MILE_M) * paceSec; };
  const easyBlock = (title, miles) => { blocks.push(`${title}\n- ${r2(miles)}mi ${easyR}`); addSeconds(miles * MILE_M, easyMid); };
  const text = (day.session?.text || (day.detail_set ? day.detail : '') || '').trim();
  let title;
  let heading;

  if (day.type === 'Workout' || day.type === 'Race') {
    const wuMi = wu ?? 1.5;
    const cdMi = cd ?? 1.5;
    easyBlock('Warm up', wuMi);
    let mainMi = 0;
    if (day.type === 'Race') {
      const m = String(day.base?.detail || '').match(/\(\s*(\d+(?:\.\d+)?)\s*r(?:ace)?/i);
      const raceMi = m ? Number(m[1]) : Math.max(day.miles - wuMi - cdMi, 1);
      const p = sec('5k');
      blocks.push(`Race (effort, not a target; flat 5K pace shown)\n- ${r2(raceMi)}mi ${p ? around(p, 0.03) : easyR}`);
      addSeconds(raceMi * MILE_M, p || easyMid);
      mainMi = raceMi; title = `Race, ${r2(raceMi)} mi`;
    } else {
      const segs = segmentsOf(text).filter((s) => !isRest(s) && (s.reps > 1 || s.m || s.sec));
      const rest = restOf(text);
      const parts = [];
      for (const s of segs) {
        const z = zoneOf(s.text) || zoneOf(text) || { keys: ['5k'], offset: 0 };
        const secs = z.keys.map(sec).filter(Boolean);
        const pace = secs.length ? secs.reduce((a, b) => a + b, 0) / secs.length + z.offset : null;
        const work = s.m ? distText(s.m) : timeText(s.sec);
        const workStep = `- ${work} ${pace ? around(pace) : easyR}`;
        const workM = s.m || (pace ? (s.sec / pace) * MILE_M : 0);
        let restStep = '';
        let restM = 0;
        if (s.reps > 1) {
          if (rest?.m) { restStep = `\n- ${distText(rest.m)} ${easyR}`; restM = rest.m; }
          else { const rs = rest?.sec || 60; restStep = `\n- ${timeText(rs)} ${easyR}`; restM = (rs / easyMid) * MILE_M; }
        }
        blocks.push(`${s.reps > 1 ? `Main set ${s.reps}x` : 'Main set'}\n${workStep}${restStep}`);
        addSeconds(workM * s.reps, pace || easyMid); addSeconds(restM * (s.reps - 1 || 0), easyMid);
        mainMi += (workM * s.reps + restM * Math.max(s.reps - 1, 0)) / MILE_M;
        parts.push(`${s.reps > 1 ? s.reps + ' x ' : ''}${s.m ? labelDist(s.m) : timeText(s.sec)}`);
      }
      if (!segs.length) {
        // A session the text parser cannot structure (hills, free-form): the miles go in as one steady block and the words stay in the description.
        const wo = Math.max(day.miles - wuMi - cdMi, 1);
        const p = sec('steady');
        blocks.push(`Main set\n- ${r2(wo)}mi ${p ? around(p, 0.04) : easyR}`);
        addSeconds(wo * MILE_M, p || easyMid); mainMi = wo;
      }
      title = parts.length ? parts.join(' + ') : 'Workout';
    }
    easyBlock('Cool down', cdMi);
    heading = day.type === 'Race' ? 'Race' : 'Workout';
  } else {
    // Easy, recovery, shakeout, long run. A long run with a session in it (progression, steady blocks) is warm-up + sets + cool-down.
    const segs = day.type === 'Long run' ? segmentsOf(text).filter((s) => !isRest(s) && (s.reps > 1 || s.m || s.sec)) : [];
    if (segs.length) {
      const wuMi = Math.min(2, day.miles / 3);
      easyBlock('Warm up', wuMi);
      const rest = restOf(text);
      let mainMi = 0;
      for (const s of segs) {
        const z = zoneOf(s.text) || zoneOf(text) || { keys: ['steady'], offset: 0 };
        const secs = z.keys.map(sec).filter(Boolean);
        const pace = secs.length ? secs.reduce((a, b) => a + b, 0) / secs.length + z.offset : null;
        const rs = rest?.sec || (rest?.m ? (rest.m / MILE_M) * easyMid : 120);
        blocks.push(`Main set ${s.reps > 1 ? s.reps + 'x' : ''}`.trim() + `\n- ${s.m ? distText(s.m) : timeText(s.sec)} ${pace ? around(pace) : easyR}` + (s.reps > 1 ? `\n- ${timeText(rs)} ${easyR}` : ''));
        const workM = s.m || (pace ? (s.sec / pace) * MILE_M : 0);
        addSeconds(workM * s.reps, pace || easyMid); seconds += rs * Math.max(s.reps - 1, 0);
        mainMi += (workM * s.reps) / MILE_M + (rs * Math.max(s.reps - 1, 0)) / easyMid;
      }
      const cdMi = Math.max(day.miles - wuMi - mainMi, 0);
      if (cdMi >= 0.25) easyBlock('Cool down', cdMi);
      title = `Long run with ${segs.map((s) => `${s.reps > 1 ? s.reps + ' x ' : ''}${s.m ? labelDist(s.m) : timeText(s.sec)}`).join(' + ')}`;
    } else {
      blocks.push(`${day.type === 'Long run' ? 'Long run' : 'Easy run'}\n- ${r2(day.miles)}mi ${easyR}`);
      addSeconds(day.miles * MILE_M, easyMid);
      title = `${r2(day.miles)} mi`;
    }
    heading = day.type === 'Long run' ? 'Long run' : day.type === 'Race' ? 'Race' : day.type;
  }
  const strides = /stride/i.test(notes) && day.type !== 'Workout' ? '\n\nStrides: 4-6 x 20s relaxed fast, after the run.' : '';
  const note = text ? `\n\nKessler plan: ${text}` : '';
  return {
    category: 'WORKOUT', type: 'Run', target: 'PACE', start_date_local: `${day.date}T00:00:00`,
    name: `${heading}: ${title}`, description: blocks.join('\n\n') + strides + note, moving_time: Math.round(seconds),
    external_id: `hawks:${personId}:${day.date}`,
  };
}

export async function planWorkouts(db, person, fitness, today, days = 14) {
  const out = [];
  const end = addDays(today, days - 1);
  const seen = new Set();
  for (let ws = weekStartOf(today); ws <= end; ws = addDays(ws, 7)) {
    const wk = await planWeek(db, person, ws, today, null, fitness);
    for (const d of wk?.days || []) {
      if (d.date < today || d.date > end || seen.has(d.date)) continue;
      seen.add(d.date);
      const w = buildWorkout(d, fitness, person.id);
      if (w) out.push(w);
    }
  }
  return out;
}

// ------------------------------------------------------------------ push

async function call(cred, method, path, body) {
  const res = await fetch(cred.base + `/athlete/${encodeURIComponent(cred.athlete)}${path}`, {
    method,
    headers: { Authorization: 'Basic ' + btoa('API_KEY:' + cred.key), Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 || res.status === 403) throw new IntervalsError('intervals.icu rejected the API key (it needs permission to write the calendar).');
  if (res.status === 429) throw new IntervalsError('intervals.icu is rate limiting; try again in a few minutes.');
  if (!res.ok) throw new IntervalsError(`intervals.icu error ${res.status} on ${method} ${path.split('?')[0]}`);
  return res.status === 204 ? null : res.json().catch(() => null);
}

const stepCount = (ev) => {
  const steps = ev?.workout_doc?.steps;
  return Array.isArray(steps) ? steps.length : 0;
};

export async function pushPlan(env, personId, { days = 14 } = {}) {
  const db = env.DB;
  const n = Math.min(Math.max(Math.round(Number(days) || 14), 1), 28);
  const cred = await credentials(env, personId);
  const person = await loadPerson(db, personId);
  if (!person) throw new IntervalsError('Unknown person');
  const today = todayInTz();
  const fitness = await getFitness(db, personId, today);
  if (!fitness?.zones?.length) throw new IntervalsError('Add a race or PR first so Kessler can set your paces.');
  const wanted = await planWorkouts(db, person, fitness, today, n);
  const end = addDays(today, n - 1);
  const prefix = `hawks:${personId}:`;

  // What of ours is already on the calendar (we never touch events without our external_id).
  const existing = (await call(cred, 'GET', `/events?oldest=${today}&newest=${end}&category=WORKOUT`)) || [];
  const inRange = (e) => { const d = String(e.start_date_local || '').slice(0, 10); return d >= today && d <= end; };
  const mine = new Map(existing.filter((e) => String(e.external_id || '').startsWith(prefix) && inRange(e)).map((e) => [e.external_id, e]));
  let created = 0, updated = 0, deleted = 0;
  const sent = [];
  for (const w of wanted) {
    const have = mine.get(w.external_id);
    if (have) { await call(cred, 'PUT', `/events/${have.id}`, w); updated++; mine.delete(w.external_id); }
    else { await call(cred, 'POST', '/events?upsertOnUid=false', w); created++; }
    sent.push(w);
  }
  for (const [, e] of mine) { await call(cred, 'DELETE', `/events/${e.id}`); deleted++; }

  // Read back: did intervals.icu turn the text into steps, and did the watch services report a problem?
  const back = ((await call(cred, 'GET', `/events?oldest=${today}&newest=${end}&category=WORKOUT`)) || []).filter((e) => String(e.external_id || '').startsWith(prefix));
  const unread = back.filter((e) => stepCount(e) === 0).map((e) => String(e.external_id).slice(prefix.length));
  const pushErrors = back.flatMap((e) => (e.push_errors || []).map((p) => `${String(e.external_id).slice(prefix.length)}: ${p.service || ''} ${p.message || ''}`.trim()));
  let toggles = null;
  try {
    const me = await call(cred, 'GET', '');
    toggles = { garmin: me?.icu_garmin_upload_workouts ?? null, coros: me?.coros_upload_workouts ?? null };
  } catch { /* the toggles are only a hint */ }
  return {
    sent: sent.length, created, updated, deleted, from: today, to: end,
    steps_understood: back.length - unread.length, steps_not_read: unread, push_errors: pushErrors, watch_upload: toggles,
    note: unread.length
      ? 'intervals.icu saved these days as text but did not turn them into steps; they will show as notes. Tell Kessler which days so the format can be fixed.'
      : 'Workouts are on your intervals.icu calendar. Turn on "upload planned workouts" for Garmin or COROS in intervals.icu (Settings, Connections) and they appear on the watch after its next sync.',
  };
}
