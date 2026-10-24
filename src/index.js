// Kestrel: open-source AI running coaching for school teams, plus Kestrel Lab for publishing running models.
// Static files come from public/; /api/* and /mcp/* are handled here.
//
// The app and its training engine (src/train/) come from Hawks Calendar. The API keeps Hawks' paths and
// request shapes so the same views work, with three rules on top:
//   - who you are comes only from the Supabase sign-in (authUser), never from a personId in the request;
//   - the team comes from the X-Kestrel-Team header and is used only after a membership check;
//   - teammates see each other's name, colour, availability and RSVPs, never training, health or contact details.

import { authUser, AuthError } from './auth.js';
import { EVENT, parseTime } from './events.js';
import { BUILTIN, DEFAULTS, TASKS, KINDS, predictEvent, marathonPredict, validateModel, ModelError, MAX_MODEL_BYTES } from './models.js';
import { PLANS, plansOf, rankOf, rankForMiles, validateTeamPlans, PlanFormatError } from './train/plans.js';
import { getLog, saveDay, setDayTrack, libraryMeta, setFiveK, fiveKFor, setPrs, getPrs, LogError } from './train/log.js';
import { WORKOUTS, WORKOUT_GROUPS, workoutGroup, workoutTargets, personalWorkout } from './train/workouts.js';
import { todayInTz, getCoachContext, compactFitness, loadPerson, planFor, COACH_TOOLS, callCoachTool, personForToken, workoutsForApp, issueCoachToken } from './train/coach.js';
import { connect as icuConnect, disconnect as icuDisconnect, status as icuStatus, syncPerson, importHistory, syncDue, IntervalsError, SYNC_CRON } from './train/intervals.js';
import { getFitness, recomputeFitness, fitnessHistory } from './train/fitness.js';
import { pushPlan, planWorkouts } from './train/planpush.js';
import { heatCalc, taperCalc, CalcError } from './train/calculators.js';
import { cohortReport } from './train/cohorts.js';
import { racePredictions } from './train/racepredict.js';
import { BODY_PARTS } from './train/body.js';
import { hawkyState, applyPlanChange, resetPlanDay, changeLevel, healthSummary, PlanError } from './train/hawky.js';
import { aiEnabled, askCoach, coachChat, AiError } from './train/gemini.js';

class BadRequest extends Error {}
class NotFound extends Error {}
class Forbidden extends Error {}

const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra } });
const str = (v, max = 500) => String(v ?? '').trim().slice(0, max);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !Number.isNaN(Date.parse(s));
const COLORS = ['#e1371a', '#2a6fc8', '#1f8a5b', '#8a5ac8', '#c8862a', '#c82a7f', '#4f7a2a', '#2a8fa8'];
const MAX_TEAMS = 10;
const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);

function randomId(prefix, bytes = 9) {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return prefix + [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}
// 8 characters, no 0/O/1/I/L, from a crypto source.
function inviteCode() {
  const ABC = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  return [...crypto.getRandomValues(new Uint8Array(8))].map((b) => ABC[b % ABC.length]).join('');
}
async function sha256(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function readJson(request) {
  try { return await request.json(); } catch { throw new BadRequest('Expected a JSON body.'); }
}
const settingsOf = (row) => { try { return JSON.parse(row?.settings || '{}'); } catch { return {}; } };

// ------------------------------------------------------------------ people

async function loadMe(db, auth) {
  let row = await db.prepare('SELECT * FROM people WHERE id = ?').bind(auth.id).first();
  if (!row) {
    await db.prepare('INSERT OR IGNORE INTO people (id, email, name, color, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(auth.id, auth.email, str(auth.name, 60), COLORS[Math.floor(Math.random() * COLORS.length)], Date.now()).run();
    row = await db.prepare('SELECT * FROM people WHERE id = ?').bind(auth.id).first();
  }
  return row;
}

async function meView(db, me) {
  const { results: teams } = await db.prepare(
    `SELECT t.id, t.name, t.school, m.role, (SELECT COUNT(*) FROM team_members x WHERE x.team_id = t.id) AS members
     FROM teams t JOIN team_members m ON m.team_id = t.id WHERE m.person_id = ? ORDER BY m.joined_at`
  ).bind(me.id).all();
  return {
    user: {
      id: me.id, email: me.email, name: me.name, color: me.color, sex: me.sex, class_year: me.class_year,
      age_ok: !!me.age_ok, share_miles: !!me.share_miles, plan_rank: me.plan_rank,
    },
    models: { ...DEFAULTS, ...(settingsOf(me).models || {}) },
    teams,
  };
}

async function updateMe(db, me, b) {
  const sets = [];
  const vals = [];
  const set = (col, v) => { sets.push(`${col} = ?`); vals.push(v); };
  if (b.name !== undefined) { const n = str(b.name, 60); if (!n) throw new BadRequest('Add your name.'); set('name', n); }
  if (b.color !== undefined && /^#[0-9a-f]{6}$/i.test(b.color)) set('color', b.color);
  if (b.sex !== undefined && ['', 'f', 'm'].includes(b.sex)) set('sex', b.sex);
  if (b.class_year !== undefined) set('class_year', ['', 'Middle school', 'Freshman', 'Sophomore', 'Junior', 'Senior', 'College', 'Adult'].includes(b.class_year) ? b.class_year : '');
  if (b.age_ok !== undefined) set('age_ok', b.age_ok ? 1 : 0);
  if (b.share_miles !== undefined) set('share_miles', b.share_miles ? 1 : 0);
  // Weekly miles now -> the plan level to start on (only before any level has been set).
  if (b.weekly_miles !== undefined && me.plan_rank == null) {
    const r = rankForMiles(Number(b.weekly_miles));
    set('plan_rank', r);
    set('coach_rank', r);
  }
  if (b.models && typeof b.models === 'object') {
    const settings = settingsOf(me);
    const models = { ...(settings.models || {}) };
    for (const [task, id] of Object.entries(b.models)) {
      if (!TASKS[task]) throw new BadRequest(`Unknown task ${task}.`);
      const m = await findModel(db, me.id, String(id));
      if (!m) throw new BadRequest('That model does not exist or is private.');
      if (m.task !== task) throw new BadRequest(`${m.name} is a ${m.task} model, not ${task}.`);
      models[task] = m.id;
    }
    set('settings', JSON.stringify({ ...settings, models }));
    // Fitness States are cached; the next read recomputes them with the new models.
    await db.prepare('UPDATE fitness_states SET computed_at = 0 WHERE person_id = ?').bind(me.id).run();
  }
  if (!sets.length) return;
  await db.prepare(`UPDATE people SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, me.id).run();
}

// Everything about one person, removed. Teams they own pass to the longest-standing member.
async function deleteMe(db, me) {
  const { results } = await db.prepare('SELECT team_id FROM team_members WHERE person_id = ?').bind(me.id).all();
  for (const t of results) await removeMember(db, t.team_id, me.id);
  await db.prepare("UPDATE teams SET created_by = (SELECT person_id FROM team_members WHERE team_id = teams.id AND role = 'owner') WHERE created_by = ?").bind(me.id).run();
  await db.prepare('DELETE FROM api_keys WHERE person_id = ?').bind(me.id).run();
  await db.prepare('DELETE FROM ai_usage WHERE person_id = ?').bind(me.id).run();
  await db.prepare('DELETE FROM people WHERE id = ?').bind(me.id).run();
}

// ------------------------------------------------------------------ teams

async function roleIn(db, teamId, personId) {
  if (!teamId) return null;
  const row = await db.prepare('SELECT role FROM team_members WHERE team_id = ? AND person_id = ?').bind(teamId, personId).first();
  return row?.role || null;
}
async function requireMember(db, teamId, personId) {
  const role = await roleIn(db, teamId, personId);
  if (!role) throw new NotFound('Team not found.');
  return role;
}

async function teamView(db, teamId, role) {
  const team = await db.prepare('SELECT id, name, school, invite_code, created_at FROM teams WHERE id = ?').bind(teamId).first();
  const { results: members } = await db.prepare(
    'SELECT p.id, p.name, p.color, m.role FROM team_members m JOIN people p ON p.id = m.person_id WHERE m.team_id = ? ORDER BY m.role DESC, p.name'
  ).bind(teamId).all();
  const plan = await db.prepare('SELECT updated_at FROM team_plans WHERE team_id = ?').bind(teamId).first();
  return { ...team, role, members, has_plan: !!plan };
}

async function createTeam(db, me, b) {
  const name = str(b.name, 80);
  if (!name) throw new BadRequest('Give the team a name.');
  const n = await db.prepare('SELECT COUNT(*) AS n FROM team_members WHERE person_id = ?').bind(me.id).first();
  if (n.n >= MAX_TEAMS) throw new BadRequest(`You can be on up to ${MAX_TEAMS} teams.`);
  const id = randomId('t_');
  const now = Date.now();
  await db.batch([
    db.prepare('INSERT INTO teams (id, name, school, invite_code, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(id, name, str(b.school, 120), inviteCode(), me.id, now),
    db.prepare("INSERT INTO team_members (team_id, person_id, role, joined_at) VALUES (?, ?, 'owner', ?)").bind(id, me.id, now),
  ]);
  return id;
}

async function joinTeam(db, me, code) {
  const c = str(code, 20).toUpperCase().replace(/[^0-9A-Z]/g, '');
  const team = c && await db.prepare('SELECT id FROM teams WHERE invite_code = ?').bind(c).first();
  if (!team) throw new BadRequest('No team has that invite code. Check it with whoever sent it.');
  const already = await roleIn(db, team.id, me.id);
  if (!already) {
    const n = await db.prepare('SELECT COUNT(*) AS n FROM team_members WHERE person_id = ?').bind(me.id).first();
    if (n.n >= MAX_TEAMS) throw new BadRequest(`You can be on up to ${MAX_TEAMS} teams.`);
    await db.prepare("INSERT INTO team_members (team_id, person_id, role, joined_at) VALUES (?, ?, 'member', ?)").bind(team.id, me.id, Date.now()).run();
  }
  return team.id;
}

// Leaving or being removed. The last member leaving deletes the team; an owner leaving hands it on.
async function removeMember(db, teamId, personId) {
  await db.prepare('DELETE FROM team_members WHERE team_id = ? AND person_id = ?').bind(teamId, personId).run();
  await db.prepare('DELETE FROM comments WHERE team_id = ? AND person_id = ?').bind(teamId, personId).run();
  await db.prepare('DELETE FROM rsvps WHERE person_id = ? AND event_id IN (SELECT id FROM events WHERE team_id = ?)').bind(personId, teamId).run();
  if (await db.prepare("SELECT 1 FROM team_members WHERE team_id = ? AND role = 'owner'").bind(teamId).first()) return;
  const next = await db.prepare('SELECT person_id FROM team_members WHERE team_id = ? ORDER BY joined_at LIMIT 1').bind(teamId).first();
  if (next) await db.prepare("UPDATE team_members SET role = 'owner' WHERE team_id = ? AND person_id = ?").bind(teamId, next.person_id).run();
  else await db.prepare('DELETE FROM teams WHERE id = ?').bind(teamId).run();
}

// The team calendar in the shape the Hawks views read (/api/state). Members are name and colour only;
// availability and RSVPs are the team's; body marks and personal fields are the caller's own.
async function teamState(db, me, teamId) {
  const empty = { people: [], overrides: {}, comments: {}, events: {}, rsvps: {}, body: {}, posts: [], locations: [], travelEstimates: [] };
  const mine = {
    id: me.id, name: me.name, color: me.color, default_status: me.default_status, health_status: me.health_status,
    training_status: me.training_status, class_year: me.class_year, prs: me.prs, five_k_time: me.five_k_time,
  };
  const marks = await db.prepare('SELECT part, status FROM body_marks WHERE person_id = ?').bind(me.id).all();
  const body = { [me.id]: Object.fromEntries(marks.results.map((m) => [m.part, m.status])) };
  if (!teamId) return { ...empty, people: [mine], body, me: mine };
  const [people, overrides, comments, events, rsvps, posts, locations] = await Promise.all([
    db.prepare('SELECT p.id, p.name, p.color, p.default_status FROM team_members m JOIN people p ON p.id = m.person_id WHERE m.team_id = ? ORDER BY p.name').bind(teamId).all(),
    db.prepare('SELECT a.person_id, a.date, a.status FROM availability_overrides a JOIN team_members m ON m.person_id = a.person_id AND m.team_id = ? WHERE a.date >= ?').bind(teamId, addDays(todayInTz(), -120)).all(),
    db.prepare('SELECT date, person_id, text FROM comments WHERE team_id = ?').bind(teamId).all(),
    db.prepare('SELECT id, date, title, time, end_time, description, type, kind, auto, location, location_id, checklist, results, created_by FROM events WHERE team_id = ?').bind(teamId).all(),
    db.prepare('SELECT r.event_id, r.person_id, r.status FROM rsvps r JOIN events e ON e.id = r.event_id WHERE e.team_id = ?').bind(teamId).all(),
    db.prepare('SELECT id, person_id, text, header, created_at FROM posts WHERE team_id = ? ORDER BY created_at DESC LIMIT 200').bind(teamId).all(),
    db.prepare('SELECT id, name, address, kind, lat, lng FROM locations WHERE team_id = ?').bind(teamId).all(),
  ]);
  const by = (rows, k1, k2, v) => { const o = {}; for (const r of rows) (o[r[k1]] ??= {})[r[k2]] = r[v]; return o; };
  const eventsMap = {};
  for (const e of events.results) {
    (eventsMap[e.date] ??= []).push({
      id: e.id, date: e.date, title: e.title, time: e.time, endTime: e.end_time || '', desc: e.description, type: e.type, kind: e.kind || '',
      auto: !!e.auto, location: e.location || '', locationId: e.location_id || '', checklist: e.checklist || '', results: e.results || '', createdBy: e.created_by,
    });
  }
  return {
    people: people.results.map((p) => (p.id === me.id ? { ...p, ...mine } : p)),
    overrides: by(overrides.results, 'person_id', 'date', 'status'),
    comments: by(comments.results, 'date', 'person_id', 'text'),
    events: eventsMap,
    rsvps: by(rsvps.results, 'event_id', 'person_id', 'status'),
    body,
    posts: posts.results.map((r) => ({ id: r.id, personId: r.person_id, text: r.text, header: r.header || '', createdAt: r.created_at })),
    locations: locations.results,
    travelEstimates: [],
    me: mine,
  };
}

const EVENT_TYPES = ['practice', 'meet', 'other'];
const EVENT_KINDS = ['', 'easy', 'workout', 'long_run'];
const kindFor = (type, raw) => (type === 'practice' && EVENT_KINDS.includes(raw) ? raw : '');

async function eventIn(db, teamId, eventId) {
  const e = await db.prepare('SELECT * FROM events WHERE id = ? AND team_id = ?').bind(str(eventId, 100), teamId).first();
  if (!e) throw new NotFound('Event not found.');
  return e;
}
const canEdit = (e, me, role) => e.created_by === me.id || role === 'owner';

// The team's practice rhythm: easy, workout, easy, workout, easy (Mon-Fri). Owners apply it a week at a time;
// generated rows carry auto = 1 so clearing removes only what this made.
const WEEK_TEMPLATE = [
  { offset: 0, kind: 'easy', title: 'Easy Run' },
  { offset: 1, kind: 'workout', title: 'Workout' },
  { offset: 2, kind: 'easy', title: 'Easy Run' },
  { offset: 3, kind: 'workout', title: 'Workout' },
  { offset: 4, kind: 'easy', title: 'Easy Run' },
];
function mondayOf(raw) {
  const d = str(raw, 20);
  return isDate(d) && new Date(d + 'T00:00:00Z').getUTCDay() === 1 ? d : null;
}

// Team mileage: totals and weekly bars for everyone; per-athlete rows only for those who chose to share.
async function teamMileage(db, teamId) {
  const today = todayInTz();
  const dow = new Date(today + 'T12:00:00Z').getUTCDay();
  const weekStart = addDays(today, dow === 0 ? -6 : 1 - dow);
  const from = addDays(weekStart, -7 * 7);
  const [people, runs, manual] = await Promise.all([
    db.prepare("SELECT p.id, p.name, p.color, p.share_miles, p.icu_key_enc != '' AS watch FROM team_members m JOIN people p ON p.id = m.person_id WHERE m.team_id = ? ORDER BY p.name").bind(teamId).all(),
    db.prepare(`SELECT w.person_id, w.date, SUM(w.distance_mi) AS mi FROM workouts w JOIN team_members m ON m.person_id = w.person_id AND m.team_id = ?
                WHERE w.date >= ? AND w.category != 'crosstrain' GROUP BY w.person_id, w.date`).bind(teamId, from).all(),
    db.prepare(`SELECT d.person_id, d.date, d.manual_miles AS mi FROM training_days d JOIN team_members m ON m.person_id = d.person_id AND m.team_id = ?
                WHERE d.date >= ? AND d.manual_miles > 0`).bind(teamId, from).all(),
  ]);
  const byPerson = new Map();
  const put = (pid, date, mi, synced) => {
    if (!byPerson.has(pid)) byPerson.set(pid, new Map());
    const m = byPerson.get(pid);
    if (synced || !m.has(date)) m.set(date, { mi, synced });
  };
  runs.results.forEach((r) => put(r.person_id, r.date, r.mi || 0, true));
  manual.results.forEach((r) => { if (!byPerson.get(r.person_id)?.get(r.date)?.synced) put(r.person_id, r.date, r.mi, false); });
  const weekIdx = (date) => Math.floor((Date.parse(date + 'T12:00:00Z') - Date.parse(from + 'T12:00:00Z')) / (7 * 86400000));
  const round = (n) => Math.round(n * 10) / 10;
  const weeks = Array.from({ length: 8 }, (_, i) => ({ week_of: addDays(from, i * 7), miles: 0, athletes: 0 }));
  const athletes = [];
  let logged = 0;
  for (const p of people.results) {
    const perWeek = Array(8).fill(0);
    let daysThisWeek = 0;
    for (const [date, d] of byPerson.get(p.id) || []) {
      const i = weekIdx(date);
      if (i < 0 || i > 7) continue;
      perWeek[i] += d.mi;
      if (i === 7 && d.mi > 0) daysThisWeek++;
    }
    perWeek.forEach((mi, i) => { weeks[i].miles += mi; if (mi > 0) weeks[i].athletes++; });
    if (perWeek[7] > 0) logged++;
    if (!p.share_miles) continue;
    athletes.push({
      id: p.id, name: p.name, color: p.color, watch: !!p.watch,
      this_week: round(perWeek[7]), last_week: round(perWeek[6]), avg4: round((perWeek[3] + perWeek[4] + perWeek[5] + perWeek[6]) / 4),
      days_this_week: daysThisWeek, weeks: perWeek.map(round),
    });
  }
  weeks.forEach((w) => { w.miles = round(w.miles); });
  return { today, week_of: weekStart, weeks, athletes, members: people.results.length, logged, this_week: weeks[7].miles, last_week: weeks[6].miles };
}

// ------------------------------------------------------------------ coaching

// What the coach reads: the athlete's own data plus their teams' meets (coach.js), the workout library,
// 16 weeks of totals, every workout session, and the plan as the Plan tab shows it.
async function coachContext(db, person) {
  const { rubric, already_logged, ...context } = await getCoachContext(db, person);
  context.workout_library = WORKOUTS.map((w) => ({ id: w.id, name: w.name, type: w.type, races: w.races, min: w.total_min, level: w.level, main: w.main }));
  const past = await getLog(db, person.id, todayInTz(new Date(Date.now() - 112 * 86400000)), todayInTz());
  context.weekly_totals_16_weeks = past.weeks;
  const sessions = (await db.prepare(
    "SELECT date, library_id, splits, summary, difficulty FROM training_days WHERE person_id = ? AND (library_id != '' OR splits != '') ORDER BY date"
  ).bind(person.id).all()).results;
  context.all_workout_sessions = sessions.map((d) => ({ date: d.date, workout: d.library_id || null, splits: d.splits || null, summary: (d.summary || '').slice(0, 200), difficulty: d.difficulty }));
  const state = await hawkyState(db, person.id);
  context.plan = { today: state.today, tomorrow: state.tomorrow, week: state.week, level: state.level, changes: state.changes };
  context.health = state.health;
  const meets = await db.prepare(
    `SELECT e.date, e.title, e.time, e.location FROM events e JOIN team_members tm ON tm.team_id = e.team_id AND tm.person_id = ?
     WHERE e.type = 'meet' AND e.date >= ? AND e.date <= ? ORDER BY e.date LIMIT 12`
  ).bind(person.id, todayInTz(), addDays(todayInTz(), 60)).all();
  context.upcoming_meets = meets.results;
  return context;
}

// What the coach heard in the chat, checked and saved: a day's feel, sleep and a note; body map changes;
// health status; a plan day or level change through the plan's guardrails. Refusals come back marked "!".
async function applyCoachSaves(db, personId, out) {
  const saved = [];
  const today = todayInTz();
  const log = out?.log;
  if (log && isDate(log.date) && log.date <= today && log.date >= addDays(today, -14)) {
    const fields = {};
    const feel = Math.round(Number(log.feel));
    if (feel >= 1 && feel <= 10) { fields.feel = feel; saved.push(`feel ${feel}/10`); }
    const sleep = Number(log.sleep_hours);
    if (sleep > 0 && sleep <= 16) { fields.sleep_hours = Math.round(sleep * 2) / 2; saved.push(`${fields.sleep_hours} h sleep`); }
    const note = str(log.note, 300);
    if (note) {
      const row = await db.prepare('SELECT notes FROM training_days WHERE person_id = ? AND date = ?').bind(personId, log.date).first();
      if (!(row?.notes || '').includes(note)) { fields.notes = str(row?.notes ? `${row.notes}\n${note}` : note, 2000); saved.push('a note'); }
    }
    if (Object.keys(fields).length) {
      await saveDay(db, personId, log.date, fields);
      const label = new Date(log.date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
      saved.splice(0, saved.length, `${saved.join(', ')} on ${label}`);
    }
  }
  for (const b of Array.isArray(out?.body) ? out.body.slice(0, 6) : []) {
    if (!BODY_PARTS[b?.part] || !['sore', 'pain', 'none'].includes(b?.status)) continue;
    if (b.status === 'none') await db.prepare('DELETE FROM body_marks WHERE person_id = ? AND part = ?').bind(personId, b.part).run();
    else await db.prepare('INSERT INTO body_marks (person_id, part, status, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(person_id, part) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at').bind(personId, b.part, b.status, Date.now()).run();
    saved.push(`${BODY_PARTS[b.part]}: ${b.status === 'none' ? 'cleared' : b.status}`);
  }
  if (['healthy', 'injured', 'sick'].includes(out?.health_status)) {
    await db.prepare('UPDATE people SET health_status = ?, health_updated_at = ? WHERE id = ?').bind(out.health_status, Date.now(), personId).run();
    saved.push(`status: ${out.health_status}`);
  }
  const person = (out?.plan_change || out?.level_change) ? await loadPerson(db, personId) : null;
  if (out?.plan_change && person) {
    try {
      const c = await applyPlanChange(db, person, out.plan_change, 'hawky');
      const label = new Date(c.date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
      saved.push(`plan for ${label}: ${c.type}${c.miles ? ` ${c.miles} mi` : ''}`);
    } catch (err) {
      if (!(err instanceof PlanError)) throw err;
      saved.push(`!${err.message}`);
    }
  }
  if (out?.level_change && person) {
    try {
      const m = await changeLevel(db, person, out.level_change.direction, out.level_change.reason, today, await healthSummary(db, person, today));
      saved.push(`plan level: ${m.from_miles} → ${m.to_miles} mi a week`);
    } catch (err) {
      if (!(err instanceof PlanError)) throw err;
      saved.push(`!${err.message}`);
    }
  }
  return { saved: saved.filter((x) => !x.startsWith('!')), refused: saved.filter((x) => x.startsWith('!')).map((x) => x.slice(1)) };
}

// The plan an athlete sees (or another level of their plan set, to browse), with their own rep targets.
async function planView(db, me, level) {
  const person = await loadPerson(db, me.id);
  const plans = plansOf(person);
  const rank = level && plans[level] ? Number(level) : rankOf(person);
  let plan = plans[rank];
  if (!plan) return null;
  const fitness = await getFitness(db, me.id, todayInTz());
  plan = JSON.parse(JSON.stringify(plan));
  if (fitness?.vo2r) for (const sec of plan.ref.sessions) sec.targets = sec.items.map((item) => workoutTargets({ main: item, paces: item, type: 'vo2' }, fitness));
  return { ...plan, level: rank, mine: rank === rankOf(person), levels: Object.keys(plans).map((r) => ({ level: Number(r), miles: plans[r].weeks[0].miles })), source: person.plans ? 'team' : 'kestrel' };
}

// ------------------------------------------------------------------ Kestrel Lab

const pub = (m) => ({
  id: m.id, slug: m.slug || m.id, name: m.name, version: m.version || '', kind: m.kind, task: m.task, license: m.license || '',
  description: m.description || '', trained_on: m.trained_on || '', base_model: m.base_model || '', builtin: !!m.builtin,
  owner: m.owner || 'Kestrel', owner_id: m.builtin ? null : m.owner_id, visibility: m.visibility || 'public',
  size: m.size ?? JSON.stringify(m.weights).length, downloads: m.downloads || 0, created_at: m.created_at || null,
});

async function findModel(db, viewerId, id) {
  const b = BUILTIN.find((m) => m.id === id);
  if (b) return b;
  const row = await db.prepare('SELECT m.*, p.name AS owner FROM models m JOIN people p ON p.id = m.owner_id WHERE m.id = ?').bind(id).first();
  if (!row || (row.visibility !== 'public' && row.owner_id !== viewerId)) return null;
  const file = JSON.parse(row.body);
  return { ...file, ...row, weights: file.weights, owner: row.owner || 'someone' };
}

async function usedBy(db, id) {
  const r = await db.prepare('SELECT COUNT(*) AS n FROM people WHERE settings LIKE ?').bind(`%"${id}"%`).first();
  return r?.n || 0;
}

async function listModels(db, viewerId, { task = '', q = '' } = {}) {
  const where = ["(m.visibility = 'public' OR m.owner_id = ?)"];
  const vals = [viewerId || ''];
  if (TASKS[task]) { where.push('m.task = ?'); vals.push(task); }
  if (q) { where.push('(m.name LIKE ? OR m.description LIKE ?)'); vals.push(`%${q}%`, `%${q}%`); }
  const { results } = await db.prepare(
    `SELECT m.id, m.slug, m.name, m.version, m.kind, m.task, m.license, m.description, m.base_model, m.visibility, m.size, m.downloads, m.owner_id, m.created_at, p.name AS owner
     FROM models m JOIN people p ON p.id = m.owner_id WHERE ${where.join(' AND ')} ORDER BY m.downloads DESC, m.created_at DESC LIMIT 200`
  ).bind(...vals).all();
  const ql = q.toLowerCase();
  const built = BUILTIN.filter((m) => (!TASKS[task] || m.task === task) && (!ql || `${m.name} ${m.description}`.toLowerCase().includes(ql)));
  const out = [...built.map(pub), ...results.map((r) => ({ ...pub(r), mine: r.owner_id === viewerId }))];
  for (const m of out) m.used_by = await usedBy(db, m.id);
  return out;
}

async function uploadModel(db, me, request) {
  const raw = await request.text();
  if (raw.length > MAX_MODEL_BYTES + 20000) throw new BadRequest('Model files can be up to 1 MB.');
  let b;
  try { b = JSON.parse(raw); } catch { throw new BadRequest('That is not valid JSON.'); }
  const file = validateModel(b.model ?? b);
  const text = JSON.stringify(file);
  if (text.length > MAX_MODEL_BYTES) throw new BadRequest('Model files can be up to 1 MB.');
  const n = await db.prepare('SELECT COUNT(*) AS n FROM models WHERE owner_id = ?').bind(me.id).first();
  if (n.n >= 20) throw new BadRequest('You can publish up to 20 models. Delete one first.');
  const base = str(b.base_model, 80);
  const id = randomId('m_', 6);
  const slug = `${(me.name || 'user').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'user'}/${file.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)}`;
  await db.prepare(
    'INSERT INTO models (id, owner_id, slug, name, version, kind, task, description, license, readme, base_model, visibility, body, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, me.id, slug, file.name, file.version, file.kind, file.task, file.description, file.license, str(b.readme, 20000), base,
    b.visibility === 'private' ? 'private' : 'public', text, text.length, Date.now()).run();
  return id;
}

// Public predict API: API keys are "kst_" + 32 hex characters; only their SHA-256 is stored.
const API_DAILY = 1000;
async function apiKeyUser(db, request) {
  const h = request.headers.get('Authorization') || '';
  const key = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!/^kst_[0-9a-f]{32}$/.test(key)) throw new AuthError('Send your Kestrel Lab API key as "Authorization: Bearer kst_...".');
  const row = await db.prepare('SELECT id, person_id FROM api_keys WHERE key_hash = ?').bind(await sha256(key)).first();
  if (!row) throw new AuthError('Unknown API key.');
  const day = todayInTz();
  const use = await db.prepare('INSERT INTO api_usage (key_id, date, calls) VALUES (?, ?, 1) ON CONFLICT(key_id, date) DO UPDATE SET calls = calls + 1 RETURNING calls').bind(row.id, day).first();
  if (use.calls > API_DAILY) throw new BadRequest(`This key has used today's ${API_DAILY} calls.`);
  await db.prepare('UPDATE api_keys SET last_used = ? WHERE id = ?').bind(Date.now(), row.id).run();
  return row;
}

// { model, event, prs: [{ event, time }], sex } or { model, training: [{ date, miles, minutes }], today }
async function apiPredict(db, viewerId, b) {
  const model = await findModel(db, viewerId, str(b.model, 80) || DEFAULTS.race);
  if (!model) throw new NotFound('Model not found.');
  if (model.task === 'marathon') {
    const days = (Array.isArray(b.training) ? b.training : []).slice(0, 400).map((d) => ({ date: str(d?.date, 10), miles: Number(d?.miles) || 0, minutes: Number(d?.minutes) || 0 }));
    const today = isDate(b.today) ? b.today : todayInTz();
    const r = marathonPredict(model.weights, days, today);
    return { model: model.id, event: 'marathon', prediction: r && { sec: r.sec, lo: r.lo, hi: r.hi }, note: r ? undefined : 'Needs at least 15 running days in the 16 weeks before today.' };
  }
  const ev = EVENT.get(str(b.event, 20));
  if (!ev) throw new BadRequest('event must be one of: ' + [...EVENT.keys()].join(', '));
  const prs = (Array.isArray(b.prs) ? b.prs : []).slice(0, 30).map((p) => {
    const e = EVENT.get(str(p?.event, 20));
    const sec = typeof p?.sec === 'number' ? p.sec : parseTime(p?.time);
    return e && sec > 0 ? { key: e.key, m: e.m, surf: e.surf, steeple: !!e.steeple, sec } : null;
  }).filter(Boolean);
  if (!prs.length) throw new BadRequest('Send at least one PR: { "event": "1600", "time": "5:05.3" }.');
  const r = predictEvent(model, prs, ev, ['f', 'm'].includes(b.sex) ? b.sex : '');
  return { model: model.id, event: ev.key, prediction: r && { sec: r.sec, lo: r.lo, hi: r.hi, range: '80%' }, note: r ? undefined : 'This model cannot predict that event from those results.' };
}

// ------------------------------------------------------------------ calendar feed

function parseTimeToHM(text) {
  const m = String(text || '').trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM|am|pm)?$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const ap = m[3] ? m[3].toUpperCase() : null;
  if (ap === 'PM' && h !== 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return h > 23 || min > 59 ? null : { h, min };
}
const icsEscape = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
function icsFold(line) {
  if (line.length <= 75) return line;
  let out = line.slice(0, 75);
  for (let rest = line.slice(75); rest.length; rest = rest.slice(74)) out += '\r\n ' + rest.slice(0, 74);
  return out;
}

// A private feed of the meets on every team the athlete is on, with their RSVP. The URL holds a random token.
async function icsFeed(db, token) {
  if (!/^[0-9a-f]{32,64}$/.test(token)) return null;
  const person = await db.prepare('SELECT id, name FROM people WHERE ics_token = ?').bind(token).first();
  if (!person) return null;
  const [events, rsvps] = await Promise.all([
    db.prepare(`SELECT e.id, e.date, e.title, e.time, e.end_time, e.description, e.type, e.location, t.name AS team FROM events e
                JOIN team_members m ON m.team_id = e.team_id AND m.person_id = ? JOIN teams t ON t.id = e.team_id
                WHERE e.type = 'meet' ORDER BY e.date, e.time`).bind(person.id).all(),
    db.prepare('SELECT event_id, status FROM rsvps WHERE person_id = ?').bind(person.id).all(),
  ]);
  const rsvp = Object.fromEntries(rsvps.results.map((r) => [r.event_id, r.status]));
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'PRODID:-//Kestrel//EN', `X-WR-CALNAME:${icsEscape(person.name)}: meets (Kestrel)`, 'X-WR-TIMEZONE:America/New_York'];
  for (const ev of events.results) {
    const start = parseTimeToHM(ev.time);
    const end = parseTimeToHM(ev.end_time);
    const d = ev.date.replace(/-/g, '');
    lines.push('BEGIN:VEVENT', `UID:${ev.id}@kestrel`, `DTSTAMP:${stamp}`);
    if (!start) lines.push(`DTSTART;VALUE=DATE:${d}`);
    else {
      const hm = (t) => `${String(t.h).padStart(2, '0')}${String(t.min).padStart(2, '0')}00`;
      lines.push(`DTSTART;TZID=America/New_York:${d}T${hm(start)}`);
      lines.push(`DTEND;TZID=America/New_York:${d}T${hm(end || { h: (start.h + 1) % 24, min: start.min })}`);
    }
    lines.push(icsFold(`SUMMARY:${icsEscape(`Meet: ${ev.title}`)}`));
    if (ev.location) lines.push(icsFold(`LOCATION:${icsEscape(ev.location)}`));
    const desc = [ev.team, ev.description, `RSVP: ${rsvp[ev.id] === 'available' ? 'Coming' : rsvp[ev.id] === 'unavailable' ? 'Not coming' : 'No response yet'}`].filter(Boolean);
    lines.push(icsFold(`DESCRIPTION:${desc.map(icsEscape).join('\\n')}`), 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

// ------------------------------------------------------------------ MCP (the athlete's own AI)

const WATCH_TOOLS = [
  { name: 'watch_status', description: "Whether this athlete's watch (Garmin/COROS via intervals.icu) is connected to Kestrel, when it last synced, and whether their history has been imported.", inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'connect_watch', description: "Connect the athlete's intervals.icu account with the athlete id (like i12345) and API key from intervals.icu Settings > Developer Settings. Kestrel stores the key encrypted and syncs the last 4 weeks.", inputSchema: { type: 'object', required: ['athlete_id', 'api_key'], properties: { athlete_id: { type: 'string' }, api_key: { type: 'string' } }, additionalProperties: false } },
  { name: 'sync_watch', description: 'Pull new runs now. With full_history: true it imports about 3 months of older history per call; keep calling until done is true.', inputSchema: { type: 'object', properties: { full_history: { type: 'boolean' } }, additionalProperties: false } },
  { name: 'get_plan_status', description: "Today's and tomorrow's session, this week day by day, readiness and health, and the plan level with whether they're ready to move up.", inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  {
    name: 'change_plan_day', description: "Change one day of the plan (today to 13 days out). Kestrel enforces the limits (no big mileage jumps, no back-to-back hard days, week within 10% of plan) and says why if it refuses. reset: true puts the day back to the plan.",
    inputSchema: { type: 'object', required: ['date'], properties: { date: { type: 'string' }, type: { type: 'string', enum: ['Easy', 'Recovery', 'Workout', 'Long run', 'Race', 'Shakeout', 'Cross-train', 'Off'] }, miles: { type: 'number' }, detail: { type: 'string' }, reason: { type: 'string' }, reset: { type: 'boolean' } }, additionalProperties: false },
  },
  { name: 'change_level', description: 'Move the athlete up a plan level (only when get_plan_status says ready) or down one (injury, illness, exhaustion).', inputSchema: { type: 'object', required: ['direction', 'reason'], properties: { direction: { type: 'string', enum: ['up', 'down'] }, reason: { type: 'string' } }, additionalProperties: false } },
  { name: 'get_fitness', description: "Fitness States: race estimates, VO2max estimate, weekly mileage, pace zones and what they're based on.", inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
];

class McpToolError extends Error {}
async function callWatchTool(env, person, name, args) {
  try {
    if (name === 'watch_status') return await icuStatus(env.DB, person.id);
    if (name === 'connect_watch') return { ...(await icuConnect(env, person.id, args.athlete_id, args.api_key)), synced: await syncPerson(env, person.id), next: 'Call sync_watch with full_history: true until done.' };
    if (name === 'sync_watch') return args.full_history ? await importHistory(env, person.id) : await syncPerson(env, person.id);
    if (name === 'get_fitness') return compactFitness(await recomputeFitness(env.DB, person.id, todayInTz()));
    if (name === 'get_plan_status') return await hawkyState(env.DB, person.id);
    const full = await loadPerson(env.DB, person.id);
    if (name === 'change_level') return await changeLevel(env.DB, full, args.direction, args.reason, todayInTz(), await healthSummary(env.DB, full, todayInTz()));
    if (name === 'change_plan_day') {
      if (args.reset) { await resetPlanDay(env.DB, person.id, args.date, false); return { reset: args.date }; }
      return await applyPlanChange(env.DB, full, args, 'hawky');
    }
  } catch (err) {
    if (err instanceof IntervalsError || err instanceof PlanError) throw new McpToolError(err.message);
    throw err;
  }
  throw new McpToolError(`Unknown tool: ${name}`);
}

async function serveMcp(request, tools, call) {
  let rpc;
  try { rpc = await request.json(); } catch { return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400); }
  const { id, method, params } = rpc || {};
  const note = id === undefined;
  const ok = (result) => (note ? new Response(null, { status: 202 }) : json({ jsonrpc: '2.0', id, result }));
  if (method === 'initialize') return ok({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'kestrel', version: '1.0.0' } });
  if (method === 'notifications/initialized') return new Response(null, { status: 202 });
  if (method === 'ping') return ok({});
  if (method === 'tools/list') return ok({ tools });
  if (method === 'tools/call') {
    try {
      return ok({ content: [{ type: 'text', text: JSON.stringify(await call(params?.name, params?.arguments || {})) }] });
    } catch (err) {
      return ok({ content: [{ type: 'text', text: err.message || 'Tool failed' }], isError: true });
    }
  }
  return note ? new Response(null, { status: 202 }) : json({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
}

// ------------------------------------------------------------------ router

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };

async function route(request, env, url) {
  const db = env.DB;
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method;
  const q = url.searchParams;

  // ---- public
  if (path === '/api/config') {
    return json({ supabaseUrl: env.SUPABASE_URL || '', supabaseKey: env.SUPABASE_KEY || '', tasks: TASKS, kinds: KINDS, defaults: DEFAULTS, freeAi: aiEnabled(env), bodyParts: BODY_PARTS, levels: Object.keys(PLANS).map((r) => ({ level: Number(r), miles: PLANS[r].weeks[0].miles })) });
  }
  if ((path === '/api/calc/heat' || path === '/api/calc/taper') && method === 'GET') {
    const args = Object.fromEntries([...q.entries()].map(([k, v]) => [k, str(v, 40)]));
    return json(path === '/api/calc/heat' ? heatCalc(args) : taperCalc(args));
  }
  const ics = path.match(/^\/api\/calendar\/([0-9a-f]+)\.ics$/);
  if (ics && method === 'GET') {
    const feed = await icsFeed(db, ics[1]);
    return feed ? new Response(feed, { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'inline; filename="kestrel-meets.ics"' } }) : new Response('Not found', { status: 404 });
  }
  const mcp = path.match(/^\/mcp\/coach\/([a-f0-9]{20,64})$/);
  if (mcp) {
    if (method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
    const person = await personForToken(db, mcp[1]);
    if (!person) return json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unknown Kestrel AI link. Make a new one in Kestrel > You > Settings.' } }, 401);
    return await serveMcp(request, [...WATCH_TOOLS, ...COACH_TOOLS], (name, args) =>
      (WATCH_TOOLS.some((t) => t.name === name) ? callWatchTool(env, person, name, args) : callCoachTool(db, person, name, args)));
  }

  // ---- Kestrel Lab: public reads, downloads and the developer API
  if (path.startsWith('/api/v1/')) {
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (path === '/api/v1/models' && method === 'GET') return json({ models: await listModels(db, null, { task: str(q.get('task'), 20), q: str(q.get('q'), 60) }) }, 200, CORS);
    if (path === '/api/v1/predict' && method === 'POST') {
      const key = await apiKeyUser(db, request);
      return json(await apiPredict(db, key.person_id, await readJson(request)), 200, CORS);
    }
    throw new NotFound('No such API route. See /lab/docs.');
  }
  let viewer = null;
  try { viewer = await authUser(request, env); } catch { /* signed out: public Lab pages only */ }
  if (path === '/api/lab/models' && method === 'GET') return json({ models: await listModels(db, viewer?.id, { task: str(q.get('task'), 20), q: str(q.get('q'), 60) }) });
  const labModel = path.match(/^\/api\/lab\/models\/(.+)$/);
  if (labModel && method === 'GET') {
    const m = await findModel(db, viewer?.id, decodeURIComponent(labModel[1]));
    if (!m) throw new NotFound('Model not found.');
    if (q.get('download') === '1') {
      if (!m.builtin) await db.prepare('UPDATE models SET downloads = downloads + 1 WHERE id = ?').bind(m.id).run();
      const file = { kestrel: 1, name: m.name, version: m.version, kind: m.kind, task: m.task, license: m.license, description: m.description, trained_on: m.trained_on, weights: m.weights };
      return new Response(JSON.stringify(file), { headers: { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="${`${m.name}-${m.version || 'model'}`.replace(/[^\w.-]+/g, '_')}.json"` } });
    }
    return json({ model: { ...pub(m), readme: m.readme || '', mine: !!viewer && m.owner_id === viewer.id, used_by: await usedBy(db, m.id), weights_summary: weightsSummary(m) } });
  }

  // ---- everything below needs a signed-in, onboarded person
  if (!viewer) await authUser(request, env);
  const me = await loadMe(db, viewer);
  const today = todayInTz();

  if (path === '/api/me') {
    if (method === 'GET') return json(await meView(db, me));
    if (method === 'PUT') { await updateMe(db, me, await readJson(request)); return json(await meView(db, await loadMe(db, viewer))); }
    if (method === 'DELETE') { await deleteMe(db, me); return json({ ok: true }); }
  }
  if (!me.age_ok) throw new Forbidden('Finish setting up your profile first.');

  // Kestrel Lab, signed in
  if (path === '/api/lab/models' && method === 'POST') return json({ id: await uploadModel(db, me, request) });
  if (labModel && (method === 'PUT' || method === 'DELETE')) {
    const id = decodeURIComponent(labModel[1]);
    const row = await db.prepare('SELECT id FROM models WHERE id = ? AND owner_id = ?').bind(id, me.id).first();
    if (!row) throw new NotFound('Model not found.');
    if (method === 'DELETE') { await db.prepare('DELETE FROM models WHERE id = ?').bind(id).run(); return json({ ok: true }); }
    const b = await readJson(request);
    await db.prepare('UPDATE models SET readme = COALESCE(?, readme), description = COALESCE(?, description), visibility = COALESCE(?, visibility) WHERE id = ?')
      .bind(b.readme !== undefined ? str(b.readme, 20000) : null, b.description !== undefined ? str(b.description, 2000) : null,
        ['public', 'private'].includes(b.visibility) ? b.visibility : null, id).run();
    return json({ ok: true });
  }
  if (path === '/api/lab/keys') {
    if (method === 'GET') return json({ keys: (await db.prepare('SELECT id, name, prefix, created_at, last_used FROM api_keys WHERE person_id = ? ORDER BY created_at DESC').bind(me.id).all()).results });
    if (method === 'POST') {
      const n = await db.prepare('SELECT COUNT(*) AS n FROM api_keys WHERE person_id = ?').bind(me.id).first();
      if (n.n >= 5) throw new BadRequest('You can have up to 5 API keys. Delete one first.');
      const key = 'kst_' + [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
      const id = randomId('k_', 6);
      await db.prepare('INSERT INTO api_keys (id, person_id, name, key_hash, prefix, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(id, me.id, str((await readJson(request)).name, 40), await sha256(key), key.slice(0, 8), Date.now()).run();
      return json({ id, key });
    }
  }
  const keyDel = path.match(/^\/api\/lab\/keys\/(k_[0-9a-f]+)$/);
  if (keyDel && method === 'DELETE') { await db.prepare('DELETE FROM api_keys WHERE id = ? AND person_id = ?').bind(keyDel[1], me.id).run(); return json({ ok: true }); }
  if (path === '/api/lab/predict' && method === 'POST') return json(await apiPredict(db, me.id, await readJson(request)));

  // Teams
  if (path === '/api/teams' && method === 'POST') return json({ id: await createTeam(db, me, await readJson(request)) });
  if (path === '/api/teams/join' && method === 'POST') return json({ id: await joinTeam(db, me, (await readJson(request)).code) });
  const tm = path.match(/^\/api\/teams\/(t_[0-9a-f]+)(?:\/(.+))?$/);
  if (tm) {
    const [, teamId, sub = ''] = tm;
    const role = await requireMember(db, teamId, me.id);
    const owner = role === 'owner';
    if (!sub && method === 'GET') return json(await teamView(db, teamId, role));
    if (!sub && method === 'PUT') {
      if (!owner) throw new Forbidden('Only the team owner can rename the team.');
      const b = await readJson(request);
      if (!str(b.name, 80)) throw new BadRequest('Give the team a name.');
      await db.prepare('UPDATE teams SET name = ?, school = ? WHERE id = ?').bind(str(b.name, 80), str(b.school, 120), teamId).run();
      return json(await teamView(db, teamId, role));
    }
    if (sub === 'code' && method === 'POST') {
      if (!owner) throw new Forbidden('Only the team owner can make a new invite code.');
      await db.prepare('UPDATE teams SET invite_code = ? WHERE id = ?').bind(inviteCode(), teamId).run();
      return json(await teamView(db, teamId, role));
    }
    const mm = sub.match(/^members\/(.+)$/);
    if (mm && method === 'DELETE') {
      if (mm[1] !== me.id && !owner) throw new Forbidden('Only the team owner can remove someone.');
      await removeMember(db, teamId, mm[1]);
      return json({ ok: true });
    }
    if (sub === 'plan') {
      if (method === 'GET') {
        const row = await db.prepare('SELECT data, updated_at FROM team_plans WHERE team_id = ?').bind(teamId).first();
        return json({ plans: row ? JSON.parse(row.data) : PLANS, custom: !!row, updated_at: row?.updated_at || null });
      }
      if (!owner) throw new Forbidden('Only the team owner can change the team plan.');
      if (method === 'PUT') {
        const plans = validateTeamPlans((await readJson(request)).plans);
        await db.prepare('INSERT INTO team_plans (team_id, data, updated_by, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(team_id) DO UPDATE SET data = excluded.data, updated_by = excluded.updated_by, updated_at = excluded.updated_at')
          .bind(teamId, JSON.stringify(plans), me.id, Date.now()).run();
        return json({ ok: true });
      }
      if (method === 'DELETE') { await db.prepare('DELETE FROM team_plans WHERE team_id = ?').bind(teamId).run(); return json({ ok: true }); }
    }
  }

  // The team the request is about (calendar, posts, mileage). Checked here, once.
  const teamId = str(request.headers.get('X-Kestrel-Team'), 40) || null;
  const role = teamId ? await roleIn(db, teamId, me.id) : null;
  if (teamId && !role) throw new NotFound('Team not found.');
  const needTeam = () => { if (!role) throw new BadRequest('Pick or join a team first.'); };

  if (method === 'GET') {
    if (path === '/api/state') return json(await teamState(db, me, role ? teamId : null));
    if (path === '/api/team') { needTeam(); return json(await teamMileage(db, teamId)); }
    if (path === '/api/cohort') { const rep = await cohortReport(db, me.id, str(q.get('goal'), 12)); return json(rep, rep.error ? 400 : 200); }
    if (path === '/api/plan/export') {
      const fitness = await getFitness(db, me.id, today);
      if (!fitness?.zones?.length) throw new BadRequest('Add a race or PR first so Kestrel can set your paces.');
      const days = Math.min(Math.max(Number(q.get('days')) || 14, 1), 28);
      return json({ workouts: await planWorkouts(db, await loadPerson(db, me.id), fitness, today, days) });
    }
    if (path === '/api/plan') { const p = await planView(db, me, Number(q.get('level')) || null); return p ? json(p) : json({ error: 'no_plan' }, 404); }
    if (path === '/api/distance') return json({ configured: false, available: false });
    if (path === '/api/log') return json({ ...(await getLog(db, me.id, str(q.get('from'), 10), str(q.get('to'), 10))), five_k_time: await fiveKFor(db, me.id) });
    if (path === '/api/intervals/status') return json({ ...(await icuStatus(db, me.id)), ai: aiEnabled(env) });
    if (path === '/api/library') {
      const person = await loadPerson(db, me.id);
      const fitness = await getFitness(db, me.id, today);
      return json({
        ...libraryMeta(), groups: WORKOUT_GROUPS,
        workouts: WORKOUTS.map((w) => ({ ...w, group: workoutGroup(w), personal: personalWorkout(w, fitness?.vo2r ? fitness : null, rankOf(person)) })),
        fitness, five_k_time: await fiveKFor(db, me.id), prs: await getPrs(db, me.id),
      });
    }
    if (path === '/api/fitness') return json({ fitness: await getFitness(db, me.id, today), history: await fitnessHistory(db, me.id) });
    if (path === '/api/predict') { try { return json(await racePredictions(env, me.id, today)); } catch (e) { return json({ enabled: false, error: String(e?.message || e) }); } }
    if (path === '/api/hawky') return json(await hawkyState(db, me.id));
    if (path === '/api/workouts') return json(await workoutsForApp(db, me.id));
    if (path === '/api/models') return json({ models: await listModels(db, me.id, { task: str(q.get('task'), 20) }) });
    if (path === '/api/calendar-link') {
      let token = me.ics_token;
      if (!token) {
        token = [...crypto.getRandomValues(new Uint8Array(20))].map((b) => b.toString(16).padStart(2, '0')).join('');
        await db.prepare('UPDATE people SET ics_token = ? WHERE id = ?').bind(token, me.id).run();
      }
      return json({ url: `${url.origin}/api/calendar/${token}.ics` });
    }
  }

  if (method !== 'POST') throw new NotFound('No such API route.');
  const b = await readJson(request);

  // Your own profile and status (Hawks paths; any personId in the body is ignored)
  if (path === '/api/people') { await updateMe(db, me, { name: b.name, color: b.color }); return json({ ok: true }); }
  if (path === '/api/people/personal') { await updateMe(db, me, { class_year: b.classYear }); return json({ ok: true }); }
  if (path === '/api/people/delete') { await deleteMe(db, me); return json({ ok: true }); }
  if (path === '/api/people/default-status') {
    if (!['available', 'unavailable'].includes(b.status)) throw new BadRequest('Invalid status.');
    await db.prepare('UPDATE people SET default_status = ? WHERE id = ?').bind(b.status, me.id).run();
    return json({ ok: true });
  }
  if (path === '/api/people/health-status') {
    if (!['healthy', 'injured', 'sick'].includes(b.status)) throw new BadRequest('Invalid status.');
    await db.prepare('UPDATE people SET health_status = ?, health_updated_at = ? WHERE id = ?').bind(b.status, Date.now(), me.id).run();
    return json({ ok: true });
  }
  if (path === '/api/people/training-status') {
    if (!['resting', 'running', 'crosstraining'].includes(b.status)) throw new BadRequest('Invalid status.');
    await db.prepare('UPDATE people SET training_status = ? WHERE id = ?').bind(b.status, me.id).run();
    return json({ ok: true });
  }
  if (path === '/api/availability/toggle') {
    const date = str(b.date, 10);
    if (!isDate(date)) throw new BadRequest('Missing date.');
    const existing = await db.prepare('SELECT status FROM availability_overrides WHERE person_id = ? AND date = ?').bind(me.id, date).first();
    const next = (existing ? existing.status : me.default_status) === 'available' ? 'unavailable' : 'available';
    if (next === me.default_status) await db.prepare('DELETE FROM availability_overrides WHERE person_id = ? AND date = ?').bind(me.id, date).run();
    else await db.prepare('INSERT INTO availability_overrides (person_id, date, status) VALUES (?, ?, ?) ON CONFLICT(person_id, date) DO UPDATE SET status = excluded.status').bind(me.id, date, next).run();
    return json({ status: next });
  }
  if (path === '/api/body/toggle') {
    const part = str(b.part, 40);
    if (!BODY_PARTS[part]) throw new BadRequest('Unknown body part.');
    const cur = (await db.prepare('SELECT status FROM body_marks WHERE person_id = ? AND part = ?').bind(me.id, part).first())?.status || 'none';
    const next = { none: 'sore', sore: 'pain', pain: 'none' }[cur];
    if (next === 'none') await db.prepare('DELETE FROM body_marks WHERE person_id = ? AND part = ?').bind(me.id, part).run();
    else await db.prepare('INSERT INTO body_marks (person_id, part, status, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(person_id, part) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at').bind(me.id, part, next, Date.now()).run();
    return json({ status: next });
  }

  // Team calendar (Hawks paths, scoped to the X-Kestrel-Team team)
  if (path === '/api/comment') {
    needTeam();
    const date = str(b.date, 10);
    const text = str(b.text, 2000);
    if (!isDate(date)) throw new BadRequest('Missing date.');
    if (text) await db.prepare('INSERT INTO comments (team_id, date, person_id, text) VALUES (?, ?, ?, ?) ON CONFLICT(team_id, date, person_id) DO UPDATE SET text = excluded.text').bind(teamId, date, me.id, text).run();
    else await db.prepare('DELETE FROM comments WHERE team_id = ? AND date = ? AND person_id = ?').bind(teamId, date, me.id).run();
    return json({ ok: true });
  }
  if (path === '/api/events') {
    needTeam();
    const date = str(b.date, 10);
    const title = str(b.title, 200);
    if (!isDate(date) || !title) throw new BadRequest('Missing date or title.');
    const type = EVENT_TYPES.includes(b.type) ? b.type : 'practice';
    const id = 'e_' + crypto.randomUUID();
    const ev = { id, date, title, time: str(b.time, 40), endTime: str(b.endTime, 40), desc: str(b.desc, 2000), type, kind: kindFor(type, b.kind), location: str(b.location, 200), locationId: '', checklist: str(b.checklist, 1000), results: '', auto: false, createdBy: me.id };
    await db.prepare('INSERT INTO events (id, team_id, date, title, time, end_time, description, type, kind, location, checklist, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, teamId, date, title, ev.time, ev.endTime, ev.desc, type, ev.kind, ev.location, ev.checklist, me.id, Date.now()).run();
    return json({ event: ev });
  }
  if (path === '/api/events/update') {
    needTeam();
    const e = await eventIn(db, teamId, b.eventId);
    if (!canEdit(e, me, role)) throw new Forbidden('Only whoever added the event, or the team owner, can change it.');
    const title = str(b.title, 200);
    if (!title) throw new BadRequest('Missing title.');
    const type = EVENT_TYPES.includes(b.type) ? b.type : 'practice';
    await db.prepare('UPDATE events SET title = ?, time = ?, end_time = ?, description = ?, type = ?, kind = ?, location = ?, checklist = ?, results = ? WHERE id = ?')
      .bind(title, str(b.time, 40), str(b.endTime, 40), str(b.desc, 2000), type, kindFor(type, b.kind), str(b.location, 200),
        b.checklist !== undefined ? str(b.checklist, 1000) : e.checklist, b.results !== undefined ? str(b.results, 2000) : e.results, e.id).run();
    return json({ ok: true });
  }
  if (path === '/api/events/delete') {
    needTeam();
    const e = await eventIn(db, teamId, b.eventId);
    if (!canEdit(e, me, role)) throw new Forbidden('Only whoever added the event, or the team owner, can delete it.');
    await db.prepare('DELETE FROM events WHERE id = ?').bind(e.id).run();
    return json({ ok: true });
  }
  if (path === '/api/rsvp') {
    needTeam();
    const e = await eventIn(db, teamId, b.eventId);
    if (['available', 'unavailable'].includes(b.status)) await db.prepare('INSERT INTO rsvps (event_id, person_id, status) VALUES (?, ?, ?) ON CONFLICT(event_id, person_id) DO UPDATE SET status = excluded.status').bind(e.id, me.id, b.status).run();
    else await db.prepare('DELETE FROM rsvps WHERE event_id = ? AND person_id = ?').bind(e.id, me.id).run();
    return json({ ok: true });
  }
  if (path === '/api/posts') {
    needTeam();
    const text = str(b.text, 2000);
    if (!text) throw new BadRequest('Write something first.');
    const post = { id: 'post_' + crypto.randomUUID(), personId: me.id, text, header: str(b.header, 80), createdAt: Date.now() };
    await db.prepare('INSERT INTO posts (id, team_id, person_id, text, header, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(post.id, teamId, me.id, text, post.header, post.createdAt).run();
    return json({ post });
  }
  if (path === '/api/posts/delete') {
    needTeam();
    const p = await db.prepare('SELECT person_id FROM posts WHERE id = ? AND team_id = ?').bind(str(b.postId, 100), teamId).first();
    if (!p) throw new NotFound('Post not found.');
    if (p.person_id !== me.id && role !== 'owner') throw new Forbidden('Only the author or the team owner can delete a post.');
    await db.prepare('DELETE FROM posts WHERE id = ?').bind(str(b.postId, 100)).run();
    return json({ ok: true });
  }
  if (path === '/api/schedule/week/apply' || path === '/api/schedule/week/clear') {
    needTeam();
    if (role !== 'owner') throw new Forbidden('Only the team owner can fill in practice weeks.');
    const week = mondayOf(b.weekStart);
    if (!week) throw new BadRequest('weekStart must be a Monday (YYYY-MM-DD).');
    if (path.endsWith('/clear')) {
      const rows = (await db.prepare('SELECT id FROM events WHERE team_id = ? AND auto = 1 AND date >= ? AND date <= ?').bind(teamId, week, addDays(week, 4)).all()).results;
      for (const r of rows) await db.prepare('DELETE FROM events WHERE id = ?').bind(r.id).run();
      return json({ removed: rows.map((r) => r.id) });
    }
    const time = str(b.time, 40) || '4:00 PM';
    const have = new Set((await db.prepare('SELECT date FROM events WHERE team_id = ? AND auto = 1 AND date >= ? AND date <= ?').bind(teamId, week, addDays(week, 4)).all()).results.map((r) => r.date));
    const created = [];
    for (const t of WEEK_TEMPLATE) {
      const date = addDays(week, t.offset);
      if (have.has(date)) continue;
      const id = 'e_' + crypto.randomUUID();
      await db.prepare("INSERT INTO events (id, team_id, date, title, time, description, type, kind, auto, created_by, created_at) VALUES (?, ?, ?, ?, ?, '', 'practice', ?, 1, ?, ?)")
        .bind(id, teamId, date, t.title, time, t.kind, me.id, Date.now()).run();
      created.push({ id, date, title: t.title, time, desc: '', type: 'practice', kind: t.kind, auto: true, createdBy: me.id });
    }
    return json({ created });
  }

  // Your own training (Hawks paths)
  if (path === '/api/plan/reset') { await resetPlanDay(db, me.id, str(b.date, 10), b.keep === true); return json(await hawkyState(db, me.id)); }
  if (path === '/api/log/session-splits') {
    const reps = (Array.isArray(b.reps) ? b.reps : []).slice(0, 40)
      .map((r) => ({ m: Math.round(Number(r?.m)), s: Math.round(Number(r?.s) * 10) / 10, hr: r?.hr ? Math.round(Number(r.hr)) : null, rest: str(r?.rest, 12) }))
      .filter((r) => r.m >= 50 && r.m <= 20000 && r.s > 0 && r.s < 7200);
    const res = await db.prepare('UPDATE workouts SET laps = ? WHERE person_id = ? AND strava_id = ?').bind(reps.length ? JSON.stringify(reps) : '', me.id, str(b.strava_id, 60)).run();
    if (!res.meta.changes) throw new NotFound('Unknown session.');
    await db.prepare('UPDATE fitness_states SET computed_at = 0 WHERE person_id = ?').bind(me.id).run();
    return json({ ok: true, reps });
  }
  if (path === '/api/log/track') {
    const day = await setDayTrack(db, me.id, str(b.date, 10), b.track === true);
    await db.prepare('UPDATE fitness_states SET computed_at = 0 WHERE person_id = ?').bind(me.id).run();
    return json(day);
  }
  if (path === '/api/fitness/refresh') return json({ fitness: await recomputeFitness(db, me.id, today) });
  if (path === '/api/people/prs') return json({ ...(await setPrs(db, me.id, b.prs)), fitness: await recomputeFitness(db, me.id, today) });
  if (path === '/api/people/5k') return json({ ...(await setFiveK(db, me.id, b.time)), fitness: await recomputeFitness(db, me.id, today) });
  if (path === '/api/log/day') {
    // Watch days are locked: their miles, minutes, runs and difficulty come from the synced activities.
    const date = str(b.date, 10);
    const fields = { ...(b.fields || {}) };
    if (await db.prepare('SELECT 1 FROM workouts WHERE person_id = ? AND date = ? LIMIT 1').bind(me.id, date).first()) ['manual_miles', 'minutes', 'runs', 'difficulty'].forEach((k) => delete fields[k]);
    const day = await saveDay(db, me.id, date, fields);
    if ('split_reps' in fields || 'manual_miles' in fields) await db.prepare('UPDATE fitness_states SET computed_at = 0 WHERE person_id = ?').bind(me.id).run();
    return json(day);
  }
  if (path === '/api/intervals/connect') return json(await icuConnect(env, me.id, b.athleteId, b.apiKey));
  if (path === '/api/intervals/disconnect') return json(await icuDisconnect(env, me.id));
  if (path === '/api/intervals/push-plan') return json(await pushPlan(env, me.id, { days: b.days }));
  if (path === '/api/intervals/sync') return json(await syncPerson(env, me.id, { days: b.days === 60 ? 60 : undefined, backfill: true }));
  if (path === '/api/intervals/import') return json(await importHistory(env, me.id));

  // Kestrel AI. ask: the free default answers on the server. prompt + apply: any other model, called from the
  // browser with the same prompt and schema, then its answer is checked and saved the same way.
  if (path === '/api/coach/ask') {
    const person = await loadPerson(db, me.id);
    const history = Array.isArray(b.history) ? b.history : [{ role: 'user', text: b.question }];
    const out = await askCoach(env, db, person, history, await coachContext(db, person), today, BODY_PARTS);
    return json({ answer: String(out?.answer || ''), ...(await applyCoachSaves(db, me.id, out)) });
  }
  if (path === '/api/coach/prompt') {
    const person = await loadPerson(db, me.id);
    return json(coachChat(Array.isArray(b.history) ? b.history : [], await coachContext(db, person), today, BODY_PARTS));
  }
  if (path === '/api/coach/apply') return json(await applyCoachSaves(db, me.id, b.out || {}));
  if (path === '/api/coach/link') {
    const token = await issueCoachToken(db, me.id, b.regenerate === true);
    return json({ url: `${url.origin}/mcp/coach/${token}` });
  }

  throw new NotFound('No such API route.');
}

function weightsSummary(m) {
  const w = m.weights || {};
  if (m.kind === 'lite-trees' || m.kind === 'marathon-trees') return { trees: w.trees?.length || 0, nodes: (w.trees || []).reduce((a, t) => a + t.f.length, 0), features: w.feats?.length || 0 };
  if (m.kind === 'short-pairs') return { pairs: w.pairs?.length || 0, events: Object.keys(w.events || {}).length };
  if (m.kind === 'riegel') return { exponent: w.exponent, sd: w.sd };
  return {};
}

export default {
  async scheduled(event, env, ctx) {
    if (event.cron === SYNC_CRON) ctx.waitUntil(syncDue(env).catch((err) => console.error('intervals sync failed', err)));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/mcp/')) return env.ASSETS.fetch(request);
    try {
      return await route(request, env, url);
    } catch (err) {
      const cors = url.pathname.startsWith('/api/v1/') ? CORS : {};
      if (err instanceof AuthError) return json({ error: err.message, auth: true }, 401, cors);
      if (err instanceof Forbidden) return json({ error: err.message }, 403, cors);
      if (err instanceof NotFound) return json({ error: err.message }, 404, cors);
      if (err instanceof BadRequest || err instanceof ModelError || err instanceof AiError || err instanceof LogError
        || err instanceof IntervalsError || err instanceof PlanError || err instanceof CalcError || err instanceof PlanFormatError) return json({ error: err.message }, 400, cors);
      console.error('kestrel', err?.stack || String(err));
      return json({ error: 'Something went wrong on our side.' }, 500, cors);
    }
  },
};
