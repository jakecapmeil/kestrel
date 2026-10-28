// Kestrel: open-source AI running coaching for school teams, plus Kestrel Lab for publishing running models.
// Static files come from public/; /api/* and /mcp/* are handled here.
//
// The app and its training engine (src/train/) come from Kestrel Calendar. The API keeps Kestrel' paths and
// request shapes so the same views work, with three rules on top:
//   - who you are comes only from the Supabase sign-in (authUser), never from a personId in the request;
//   - the team comes from the X-Kestrel-Team header and is used only after a membership check;
//   - teammates see each other's name, colour, availability and RSVPs, never training, health or contact details.

import { authUser, AuthError } from './auth.js';
import { EVENT, EVENTS, parseTime } from './events.js';
import { BUILTIN, DEFAULTS, TASKS, KINDS, PURPOSES, SLOT_EVENTS, slotPurpose, courseSlot, PLATFORM_NAME, predictEvent, marathonPredict, tandaPredict, toCourse, validateModel, ModelError, MAX_MODEL_BYTES } from './models.js';
import { PLANS, plansOf, rankOf, milesOfRank, rankForMiles, libraryRank, validateTeamPlans, expandPlanSpec, PlanFormatError } from './train/plans.js';
import { getLog, sessionsOf, setRunTag, addCustomTag, removeCustomTag, saveDay, setDayTrack, libraryMeta, setFiveK, fiveKFor, setPrs, getPrs, LogError } from './train/log.js';
import { WORKOUTS, WORKOUT_GROUPS, workoutGroup, workoutTargets, personalWorkout } from './train/workouts.js';
import { todayInTz, weekStartOf, weekKindOf, meetDates, WEEK_KINDS, getCoachContext, compactFitness, loadPerson, planFor, COACH_TOOLS, callCoachTool, personForToken, workoutsForApp, issueCoachToken, CoachError } from './train/coach.js';
import { connect as icuConnect, disconnect as icuDisconnect, status as icuStatus, syncPerson, importHistory, syncDue, IntervalsError, SYNC_CRON } from './train/intervals.js';
import { getFitness, recomputeFitness, fitnessHistory, dropAutoPrsFrom } from './train/fitness.js';
import { pushPlan, planWorkouts } from './train/planpush.js';
import { heatCalc, taperCalc, CalcError } from './train/calculators.js';
import { cohortReport } from './train/cohorts.js';
import { racePredictions } from './train/racepredict.js';
import { BODY_PARTS } from './train/body.js';
import { kaiState, applyPlanChange, resetPlanDay, changeLevel, healthSummary, levelStatus, setRank, PlanError } from './train/kai.js';
import { aiEnabled, askCoach, coachChat, askPlan, planChat, parseProfileText, askSchedule, scheduleChat, AiError } from './train/gemini.js';
import { COURSE_DISTANCES, CourseError, listCourses, getCourse, coursesById, createCourse, setTracked, trackedOf, courseStats, parseCourseKey } from './train/courses.js';
import { getTrack } from './train/tracks.js';
import { importModel, exportToGithub, exportToHuggingface, modelFile, SOURCES } from './labsync.js';

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
    await db.prepare('INSERT OR IGNORE INTO people (id, email, name, color, created_at, share_miles, share_activities) VALUES (?, ?, ?, ?, ?, 1, 1)')
      .bind(auth.id, auth.email, str(auth.name, 60), COLORS[Math.floor(Math.random() * COLORS.length)], Date.now()).run();
    row = await db.prepare('SELECT * FROM people WHERE id = ?').bind(auth.id).first();
  }
  return row;
}

async function meView(db, me) {
  const { results: teams } = await db.prepare(
    `SELECT t.id, t.name, t.school, CASE WHEN m.role = 'owner' THEN 'owner' WHEN m.leader = 1 THEN 'captain' ELSE 'member' END AS role, (SELECT COUNT(*) FROM team_members x WHERE x.team_id = t.id) AS members
     FROM teams t JOIN team_members m ON m.team_id = t.id WHERE m.person_id = ? ORDER BY m.joined_at`
  ).bind(me.id).all();
  return {
    user: {
      id: me.id, email: me.email, name: me.name, color: me.color, sex: me.sex, class_year: me.class_year,
      age_ok: !!me.age_ok, share_miles: !!me.share_miles, share_activities: !!me.share_activities, plan_rank: me.plan_rank,
    },
    profile: settingsOf(me).profile || {},
    models: { ...DEFAULTS, ...Object.fromEntries(Object.entries(settingsOf(me).models || {}).filter(([k]) => TASKS[k])) },
    event_models: settingsOf(me).event_models || {},
    teams,
  };
}

// The sign-up questionnaire. Stored in settings.profile; every field is optional and clipped.
const PROFILE_GOALS = ['race', 'faster', 'distance', 'fitness', 'weight', 'team'];
const PROFILE_EXPERIENCE = ['new', 'under1', '1to3', '3plus'];
function cleanProfile(p) {
  const num = (v, lo, hi) => { const n = Number(v); return v !== '' && v != null && Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n * 10) / 10 : null; };
  const txt = (v, n) => String(v ?? '').trim().slice(0, n);
  const out = {
    height_cm: num(p.height_cm, 100, 230),
    weight_kg: num(p.weight_kg, 25, 220),
    birth_year: num(p.birth_year, 1930, new Date().getFullYear() - 8),
    units: p.units === 'km' ? 'km' : 'mi',
    experience: PROFILE_EXPERIENCE.includes(p.experience) ? p.experience : '',
    longest_run_mi: num(p.longest_run_mi, 0, 100),
    days_per_week: num(p.days_per_week, 1, 7),
    goal: PROFILE_GOALS.includes(p.goal) ? p.goal : '',
    goal_event: txt(p.goal_event, 20),
    goal_time: /^(\d{1,2}:)?\d{1,2}:\d{2}(\.\d)?$/.test(txt(p.goal_time, 12)) ? txt(p.goal_time, 12) : '',
    goal_date: /^\d{4}-\d{2}-\d{2}$/.test(txt(p.goal_date, 10)) ? txt(p.goal_date, 10) : '',
    injuries: txt(p.injuries, 300),
    resting_hr: num(p.resting_hr, 30, 120),
    max_hr: num(p.max_hr, 120, 230),
    watch: ['', 'garmin', 'coros', 'apple', 'strava', 'other', 'none'].includes(p.watch) ? p.watch : '',
    completed_at: Date.now(),
  };
  for (const k of Object.keys(out)) if (out[k] === null) delete out[k];
  return out;
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
  if (b.share_activities !== undefined) set('share_activities', b.share_activities ? 1 : 0);
  // Weekly miles now -> the plan level to start on (only before any level has been set).
  if (b.weekly_miles !== undefined && me.plan_rank == null) {
    const r = rankForMiles(Number(b.weekly_miles));
    set('plan_rank', r);
    set('coach_rank', r);
  }
  let settings = settingsOf(me);
  let settingsDirty = false;
  if (b.profile && typeof b.profile === 'object') {
    settings = { ...settings, profile: cleanProfile(b.profile) };
    settingsDirty = true;
  }
  if (b.prs && typeof b.prs === 'object' && Object.keys(b.prs).length) await setPrs(db, me.id, b.prs);
  if ((b.models && typeof b.models === 'object') || (b.event_models && typeof b.event_models === 'object')) {
    const models = { ...(settings.models || {}) };
    for (const [task, id] of Object.entries(b.models || {})) {
      if (!TASKS[task]) throw new BadRequest(`Unknown task ${task}.`);
      // `course` has no default model: an empty pick puts every course back on its catalogue factor.
      if (task === 'course' && !id) { delete models.course; continue; }
      const m = await findModel(db, me.id, String(id));
      if (!m) throw new BadRequest('That model does not exist or is private.');
      if (m.task !== task) throw new BadRequest(`${m.name} is a ${m.task} model, not ${task}.`);
      models[task] = m.id;
    }
    // Per-event picks, keyed `purpose:event` (see SLOT_EVENTS). An empty id clears the slot so it follows its purpose again.
    const eventModels = { ...(settings.event_models || {}) };
    for (const [slot, id] of Object.entries(b.event_models || {})) {
      const purpose = slotPurpose(slot);
      if (!purpose) throw new BadRequest(`Unknown slot ${slot}. Slots are purpose:event (race:5K) or course:<id>[:<metres>] (course:vc:5000).`);
      if (!id) { delete eventModels[slot]; continue; }
      if (purpose === 'course' && !(await getCourse(db, courseSlot(slot).id))) throw new BadRequest(`No course called ${courseSlot(slot).id}.`);
      const m = await findModel(db, me.id, String(id));
      if (!m) throw new BadRequest('That model does not exist or is private.');
      if (m.task !== purpose) throw new BadRequest(`${m.name} is a ${m.task} model, not ${purpose}.`);
      eventModels[slot] = m.id;
    }
    settings = { ...settings, models, event_models: eventModels };
    settingsDirty = true;
    // Fitness States are cached; the next read recomputes them with the new models.
    await db.prepare('UPDATE fitness_states SET computed_at = 0 WHERE person_id = ?').bind(me.id).run();
  }
  if (settingsDirty) set('settings', JSON.stringify(settings));
  if (!sets.length) return;
  await db.prepare(`UPDATE people SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, me.id).run();
}

// Shoe tracker: shoes live in settings.shoes; miles are counted from synced and logged runs since the start date.
async function shoesView(db, me) {
  const shoes = Array.isArray(settingsOf(me).shoes) ? settingsOf(me).shoes : [];
  const out = [];
  for (const sh of shoes) {
    const r = await db.prepare("SELECT COALESCE(SUM(distance_mi), 0) AS mi FROM workouts WHERE person_id = ? AND sport = 'Run' AND date >= ? AND date <= ?")
      .bind(me.id, sh.since || '0000-00-00', sh.retired || '9999-12-31').first();
    const miles = Math.round(((sh.start_mi || 0) + (r?.mi || 0)) * 10) / 10;
    out.push({ ...sh, miles, left: Math.max(0, Math.round((sh.limit_mi - miles) * 10) / 10), status: sh.retired ? 'retired' : miles >= sh.limit_mi ? 'replace' : miles >= sh.limit_mi * 0.85 ? 'soon' : 'ok' });
  }
  return out;
}
async function saveShoes(db, me, list) {
  if (!Array.isArray(list)) throw new BadRequest('shoes must be a list.');
  const shoes = list.slice(0, 30).map((x) => {
    const name = str(x.name, 60);
    if (!name) throw new BadRequest('Name each pair of shoes.');
    const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : d; };
    const date = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : '');
    return { id: str(x.id, 40) || 's_' + crypto.randomUUID().slice(0, 8), name, since: date(x.since), start_mi: num(x.start_mi, 0, 3000, 0), limit_mi: num(x.limit_mi, 50, 1500, 400), retired: date(x.retired) };
  });
  await db.prepare('UPDATE people SET settings = ? WHERE id = ?').bind(JSON.stringify({ ...settingsOf(me), shoes }), me.id).run();
  return shoesView(db, { ...me, settings: JSON.stringify({ ...settingsOf(me), shoes }) });
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
  const row = await db.prepare('SELECT role, leader FROM team_members WHERE team_id = ? AND person_id = ?').bind(teamId, personId).first();
  if (!row) return null;
  return row.role === 'owner' ? 'owner' : row.leader ? 'captain' : 'member';
}
// The owner and captains run the team: calendar, roster details, posts, the training plan.
const isLead = (role) => role === 'owner' || role === 'captain';
async function requireMember(db, teamId, personId) {
  const role = await roleIn(db, teamId, personId);
  if (!role) throw new NotFound('Team not found.');
  return role;
}

async function teamView(db, teamId, role) {
  const team = await db.prepare('SELECT id, name, school, invite_code, created_at FROM teams WHERE id = ?').bind(teamId).first();
  const { results: members } = await db.prepare(
    "SELECT p.id, p.name, p.color, CASE WHEN m.role = 'owner' THEN 'owner' WHEN m.leader = 1 THEN 'captain' ELSE 'member' END AS role FROM team_members m JOIN people p ON p.id = m.person_id WHERE m.team_id = ? ORDER BY m.role DESC, m.leader DESC, p.name"
  ).bind(teamId).all();
  const plan = await db.prepare('SELECT updated_at FROM team_plans WHERE team_id = ?').bind(teamId).first();
  return { ...team, role, members, has_plan: !!plan };
}

// Who is on which plan level, for the captain's Plan tab. Kestrel AI only recommends a move up (levelStatus.ready);
// the captain decides. Athletes on a plan of their own (or a different team's) are shown but not changeable here.
async function teamLevels(db, teamId, today) {
  const { results } = await db.prepare('SELECT m.person_id FROM team_members m JOIN people p ON p.id = m.person_id WHERE m.team_id = ? ORDER BY p.name').bind(teamId).all();
  const rows = await Promise.all(results.map(async ({ person_id }) => {
    const person = await loadPerson(db, person_id);
    if (!person) return null;
    const mine = person.plan_source === 'team' && person.plan_team_id === teamId;
    const rank = rankOf(person);
    let rec = null;
    if (mine) {
      try {
        const st = await levelStatus(db, person, today, await healthSummary(db, person, today));
        if (st?.ready) rec = { to: rank + 1, miles: milesOfRank(person, rank + 1), why: 'Three steady weeks near their mileage, healthy and feeling good.' };
      } catch { /* a recommendation is optional */ }
    }
    return { id: person.id, name: person.name, class_year: person.class_year, level: rank, miles: milesOfRank(person, rank), locked: mine ? null : person.plan_source === 'own' ? 'Uses their own plan' : 'Follows another team’s plan', recommend: rec };
  }));
  return rows.filter(Boolean);
}

// What kind of week each athlete is on, for the captain's Plan tab: this week and the next three. `auto` is what
// Kestrel would pick by itself (race week when a meet is on that week's calendar); `set` is the captain's choice, if any.
async function teamWeeks(db, teamId, today) {
  const weeks = Array.from({ length: 4 }, (_, i) => addDays(weekStartOf(today), i * 7));
  const { results } = await db.prepare('SELECT m.person_id FROM team_members m JOIN people p ON p.id = m.person_id WHERE m.team_id = ? ORDER BY p.name').bind(teamId).all();
  const athletes = await Promise.all(results.map(async ({ person_id }) => {
    const person = await loadPerson(db, person_id);
    if (!person) return null;
    const meets = await meetDates(db, person_id, weeks[0], addDays(weeks[3], 6));
    const auto = [...meets]; // a copy without the captain's choices: what Kestrel would pick on its own
    const mine = person.plan_source === 'team' && person.plan_team_id === teamId;
    return {
      id: person.id, name: person.name, class_year: person.class_year,
      locked: mine ? null : person.plan_source === 'own' ? 'Uses their own plan' : 'Follows another team’s plan',
      weeks: weeks.map((w) => ({ week_of: w, kind: WEEK_KINDS[weekKindOf(meets, w)], auto: WEEK_KINDS[weekKindOf(auto, w)], set: meets.weekKinds.has(w) })),
    };
  }));
  return { weeks, athletes: athletes.filter(Boolean) };
}

// A captain sets (or clears, kind 'auto') the kind of week for some athletes on the team's plan.
async function setTeamWeek(db, teamId, me, today, b) {
  const week = str(b.week_of, 10);
  if (!isDate(week) || weekStartOf(week) !== week) throw new BadRequest('Pick a week (it starts on a Monday).');
  if (week < weekStartOf(today) || week > addDays(weekStartOf(today), 7 * 12)) throw new BadRequest('Pick this week or one up to 12 weeks ahead.');
  const kind = str(b.kind, 10);
  if (kind !== 'auto' && !WEEK_KINDS.includes(kind)) throw new BadRequest('Week type should be auto, normal, race or taper.');
  const { results } = await db.prepare('SELECT person_id FROM team_members WHERE team_id = ?').bind(teamId).all();
  const onTeam = new Set(results.map((r) => r.person_id));
  const ids = b.person_ids === 'all' ? [...onTeam] : (Array.isArray(b.person_ids) ? b.person_ids : [b.person_id]).map((x) => str(x, 80));
  if (!ids.length || ids.some((id) => !onTeam.has(id))) throw new NotFound('Not on this team.');
  const stmts = [];
  const skipped = [];
  for (const id of ids) {
    const person = await loadPerson(db, id);
    if (!person || person.plan_source !== 'team' || person.plan_team_id !== teamId) { skipped.push(id); continue; }
    stmts.push(kind === 'auto'
      ? db.prepare('DELETE FROM week_types WHERE person_id = ? AND week_of = ?').bind(id, week)
      : db.prepare('INSERT INTO week_types (person_id, week_of, kind, set_by, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(person_id, week_of) DO UPDATE SET kind = excluded.kind, set_by = excluded.set_by, created_at = excluded.created_at')
        .bind(id, week, kind, me.id, Date.now()));
  }
  if (!stmts.length && ids.length) throw new BadRequest(ids.length === 1 ? 'That athlete does not train from this team’s plan.' : 'None of those athletes train from this team’s plan.');
  if (stmts.length) await db.batch(stmts);
  return skipped;
}

// The roster: name, number, grade, events for the whole team; age only for that person and for leaders.
async function teamRoster(db, teamId, me, role) {
  const { results } = await db.prepare(
    `SELECT p.id, p.name, p.color, p.class_year, p.sex, CASE WHEN m.role = 'owner' THEN 'owner' WHEN m.leader = 1 THEN 'captain' ELSE 'member' END AS role,
            m.jersey, m.age, m.events, m.joined_at
     FROM team_members m JOIN people p ON p.id = m.person_id WHERE m.team_id = ? ORDER BY m.role DESC, m.leader DESC, p.name`
  ).bind(teamId).all();
  return results.map((r) => ({ ...r, age: isLead(role) || r.id === me.id ? r.age : null }));
}

async function saveRosterEntry(db, teamId, me, role, personId, b) {
  if (personId !== me.id && !isLead(role)) throw new Forbidden('Only a captain or the team owner can edit someone else.');
  const target = await roleIn(db, teamId, personId);
  if (!target) throw new NotFound('Not on this team.');
  const sets = [];
  const vals = [];
  if (b.jersey !== undefined) { sets.push('jersey = ?'); vals.push(str(b.jersey, 6)); }
  if (b.events !== undefined) { sets.push('events = ?'); vals.push(str(b.events, 80)); }
  if (b.age !== undefined) {
    const n = b.age === '' || b.age === null ? null : Math.round(Number(b.age));
    if (n !== null && !(n >= 8 && n <= 99)) throw new BadRequest('Age should be between 8 and 99, or blank.');
    sets.push('age = ?'); vals.push(n);
  }
  if (b.leader !== undefined) {
    if (role !== 'owner') throw new Forbidden('Only the team owner can name captains.');
    if (target === 'owner') throw new BadRequest('The owner already leads the team.');
    sets.push('leader = ?'); vals.push(b.leader ? 1 : 0);
  }
  if (sets.length) await db.prepare(`UPDATE team_members SET ${sets.join(', ')} WHERE team_id = ? AND person_id = ?`).bind(...vals, teamId, personId).run();
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

// The team calendar in the shape the Kestrel views read (/api/state). Members are name and colour only;
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
const canEdit = (e, me, role) => e.created_by === me.id || isLead(role);

const PLACE_KINDS = ['practice', 'meet'];

// A place on this team, by id or by name (names match without regard to case). null when there is none.
async function placeFor(db, teamId, id, name) {
  if (id) return (await db.prepare('SELECT id, name, address, kind, lat, lng FROM locations WHERE id = ? AND team_id = ?').bind(str(id, 100), teamId).first()) || null;
  const n = str(name, 200).toLowerCase();
  if (!n) return null;
  return (await db.prepare('SELECT id, name, address, kind, lat, lng FROM locations WHERE team_id = ? AND lower(name) = ?').bind(teamId, n).first()) || null;
}

// Coordinates for an address, so a meet shows its forecast. Best effort: any failure leaves the place without them.
async function geocode(query) {
  const q = str(query, 200);
  if (!q) return null;
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`, {
      headers: { 'User-Agent': 'Kestrel/1.0 (https://github.com/jakecapmeil/kestrel)' },
      signal: AbortSignal.timeout(3000),
    });
    const hit = res.ok ? (await res.json())?.[0] : null;
    const lat = Number(hit?.lat), lng = Number(hit?.lon);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  } catch { return null; }
}

async function addPlaceNoGeo(db, teamId, b) { return addPlace(db, teamId, b, false); }
async function addPlace(db, teamId, b, geocodeIt = true) {
  const name = str(b.name, 120);
  if (!name) throw new BadRequest('Give the place a name.');
  const found = await placeFor(db, teamId, null, name);
  if (found) return found;
  const kind = PLACE_KINDS.includes(b.kind) ? b.kind : 'practice';
  const address = str(b.address, 200);
  // Only an address is looked up: a bare name like "Lincoln HS Track" can land in the wrong town and give the wrong forecast.
  const geo = geocodeIt && address ? await geocode(address) : null;
  const place = { id: 'loc_' + crypto.randomUUID(), name, address, kind, lat: geo?.lat ?? null, lng: geo?.lng ?? null };
  await db.prepare('INSERT INTO locations (id, team_id, name, address, kind, lat, lng) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(place.id, teamId, name, address, kind, place.lat, place.lng).run();
  return place;
}

// ---- plan builder helpers
function previewSpec(spec) {
  const { plans, spec: clean } = expandPlanSpec(spec);
  return { spec: clean, levels: Object.entries(plans).map(([r, p]) => ({ level: Number(r), miles: p.weeks[0].miles, weeks: Object.fromEntries(['normal', 'race', 'taper'].map((k, i) => [k, p.days.map((d) => ({ day: d.day, type: d.cells[i].type, miles: parseFloat(d.cells[i].miles) || 0, notes: d.cells[i].notes }))])) })) };
}

// Chat (server model) or the prompt for the browser to send to the person's own model. A plan in the reply is validated here.
async function planChatRoute(env, db, me, b, scope, promptOnly, today) {
  const history = Array.isArray(b.history) ? b.history : [];
  const documents = (Array.isArray(b.documents) ? b.documents : []).slice(0, 5)
    .map((d) => ({ name: str(d?.name, 80), text: String(d?.text || '').slice(0, 12000) })).filter((d) => d.text.trim());
  const sc = { ...scope, documents, current: b.current && typeof b.current === 'object' ? b.current : scope.current };
  if (promptOnly) return planChat(history, sc, today);
  const out = await askPlan(env, db, me, history, sc, today);
  return checkedPlanReply(out);
}
function checkedPlanReply(out) {
  const reply = { answer: String(out?.answer || '').slice(0, 2000) };
  // A half-finished plan next to a clarifying question is dropped quietly; a full attempt that fails the checks is reported.
  const attempted = Array.isArray(out?.plan?.normal_week) && Array.isArray(out?.plan?.race_week) && Array.isArray(out?.plan?.taper_week);
  if (out?.plan && attempted) {
    try { reply.preview = previewSpec(out.plan); reply.plan = reply.preview.spec; }
    catch (e) { if (!(e instanceof PlanFormatError)) throw e; reply.answer += `\n\n(I could not use that plan: ${e.message} Ask me to fix it.)`; }
  }
  return reply;
}
async function teamPlanScope(db, teamId) {
  const team = await db.prepare('SELECT name FROM teams WHERE id = ?').bind(teamId).first();
  const row = await db.prepare('SELECT spec FROM team_plans WHERE team_id = ?').bind(teamId).first();
  const { results } = await db.prepare('SELECT p.class_year, p.plan_rank FROM team_members m JOIN people p ON p.id = m.person_id WHERE m.team_id = ?').bind(teamId).all();
  const grades = {};
  for (const r of results) grades[r.class_year || 'Not set'] = (grades[r.class_year || 'Not set'] || 0) + 1;
  const levels = results.map((r) => PLANS[r.plan_rank]?.weeks[0].miles).filter(Boolean).sort((a, b) => a - b);
  return { team: true, name: team?.name, roster: { athletes: results.length, grades, weekly_mile_levels: levels }, current: row?.spec ? JSON.parse(row.spec) : null };
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

// Team activities, newest first, like a Strava feed: one card per athlete per day's session, going back as far as
// the team's history goes (`before` is the cursor from the last page). Teammates appear only if they share
// activities; you always see your own. Only summary numbers leave here: no map, no splits, no coach notes.
const FEED_PAGE = 20;
async function teamActivities(db, teamId, me, before) {
  const cut = /^\d{4}-\d{2}-\d{2}\|[\w-]+$/.test(before || '') ? before.split('|') : null;
  const { results: days } = await db.prepare(
    `SELECT x.date, x.person_id FROM (
       SELECT w.date, w.person_id FROM workouts w
       UNION
       SELECT d.date, d.person_id FROM training_days d WHERE d.manual_miles > 0
     ) x
     JOIN team_members m ON m.person_id = x.person_id AND m.team_id = ?1
     JOIN people p ON p.id = x.person_id
     WHERE (p.share_activities = 1 OR p.id = ?2) AND (?3 IS NULL OR x.date < ?3 OR (x.date = ?3 AND x.person_id > ?4))
     ORDER BY x.date DESC, x.person_id ASC LIMIT ?5`
  ).bind(teamId, me.id, cut ? cut[0] : null, cut ? cut[1] : '', FEED_PAGE + 1).all();
  const more = days.length > FEED_PAGE;
  const page = days.slice(0, FEED_PAGE);
  if (!page.length) return { activities: [], next: null };
  const ids = [...new Set(page.map((d) => d.person_id))];
  const dates = [...new Set(page.map((d) => d.date))];
  const qs = (n) => Array(n).fill('?').join(',');
  const [people, runs, manual] = await Promise.all([
    db.prepare(`SELECT id, name, color, share_activities FROM people WHERE id IN (${qs(ids.length)})`).bind(...ids).all(),
    db.prepare(`SELECT * FROM workouts WHERE person_id IN (${qs(ids.length)}) AND date IN (${qs(dates.length)})`).bind(...ids, ...dates).all(),
    db.prepare(`SELECT person_id, date, manual_miles, minutes, types FROM training_days WHERE person_id IN (${qs(ids.length)}) AND date IN (${qs(dates.length)}) AND manual_miles > 0`).bind(...ids, ...dates).all(),
  ]);
  const who = new Map(people.results.map((p) => [p.id, p]));
  const activities = [];
  for (const d of page) {
    const p = who.get(d.person_id);
    const rs = runs.results.filter((w) => w.person_id === d.person_id && w.date === d.date);
    const head = { person: { id: p.id, name: p.name, color: p.color }, date: d.date, private: !p.share_activities };
    if (rs.length) {
      sessionsOf(rs).forEach((s) => activities.push({
        ...head, key: `${d.person_id}|${s.key}`, category: s.category, label: s.tag_label || '', title: s.title,
        start: s.start, miles: s.miles, minutes: s.minutes, pace: s.pace, avg_hr: s.avg_hr, elev_ft: s.elev_ft, track: s.track, parts: s.activities.length,
      }));
    } else {
      const m = manual.results.find((x) => x.person_id === d.person_id && x.date === d.date);
      let types = [];
      try { types = JSON.parse(m?.types || '[]'); } catch { /* ignore */ }
      const miles = Math.round((m?.manual_miles || 0) * 100) / 100;
      activities.push({
        ...head, key: `${d.person_id}|${d.date}#manual`, category: types.find((t) => t !== 'strides') || 'easy', label: '', title: '', start: '', miles,
        minutes: m?.minutes ? Math.round(m.minutes) : null, pace: m?.minutes && miles > 0.2 ? clockPace(m.minutes * 60 / miles) : null,
        avg_hr: null, elev_ft: null, track: false, parts: 0, manual: true,
      });
    }
  }
  const last = page[page.length - 1];
  return { activities, next: more ? `${last.date}|${last.person_id}` : null };
}
const clockPace = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

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
  // What Fitness States shows: every race estimate with its likely range and confidence, so the coach can quote them.
  const fit = await getFitness(db, person.id, todayInTz());
  if (fit?.vo2r) {
    context.fitness_projections = {
      race_estimates: [...fit.estimates, ...(fit.course_estimates || [])].map((e) => ({
        event: e.label, time: e.time, pace_per_mile: e.pace_mi, likely_range: e.range || null, confidence: e.confidence, current_pr: e.pr?.time || null,
      })),
      race_vo2max: fit.vo2r, vo2max_estimate: fit.vo2max, confidence: fit.confidence, profile: fit.profile,
      based_on: (fit.sources || []).map((s) => `${s.label}${s.date ? ` (${s.date})` : ''}`),
      pace_zones_per_mile: Object.fromEntries((fit.zones || []).map((z) => [z.label, z.per_mile])),
      fitness_fatigue_form: fit.fitness_score ? { fitness: fit.fitness_score.fitness, fatigue: fit.fitness_score.fatigue, form: fit.fitness_score.form, change_4wk: fit.fitness_score.change_4wk } : null,
      weekly_miles_last_4_weeks: fit.mpw, weekly_miles_prior_4_weeks: fit.mpw_prev,
    };
  }
  const state = await kaiState(db, person.id);
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
      const c = await applyPlanChange(db, person, out.plan_change, 'kai');
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
  return { ...plan, level: rank, mine: rank === rankOf(person), levels: Object.keys(plans).map((r) => ({ level: Number(r), miles: plans[r].weeks[0].miles })), source: 'custom' };
}

// ------------------------------------------------------------------ Kestrel Lab

const pub = (m) => ({
  id: m.id, slug: m.slug || m.id, name: m.name, version: m.version || '', kind: m.kind, task: m.task, course: m.course || '', license: m.license || '',
  description: m.description || '', trained_on: m.trained_on || '', base_model: m.base_model || '', builtin: !!m.builtin,
  owner: m.owner || 'Kestrel', owner_id: m.builtin ? null : m.owner_id, visibility: m.visibility || 'public',
  size: m.size ?? JSON.stringify(m.weights).length, downloads: m.downloads || 0, created_at: m.created_at || null, source_url: m.source_url || '',
});

async function findModel(db, viewerId, id) {
  const b = BUILTIN.find((m) => m.id === id);
  if (b) return b;
  const row = await db.prepare('SELECT m.*, p.name AS owner FROM models m JOIN people p ON p.id = m.owner_id WHERE m.id = ?').bind(id).first();
  if (!row || (row.visibility !== 'public' && row.owner_id !== viewerId)) return null;
  const file = JSON.parse(row.body);
  return { ...file, ...row, weights: file.weights, owner: row.owner || 'someone' };
}

// Athletes who use this model: whose pick for its purpose is this model (an athlete who never picked uses the
// default), or who picked it for a single event or course (a slot). A purpose with no default, like `course`, counts only picks.
async function usedBy(db, id, task) {
  if (!TASKS[task]) return 0;
  const r = await db.prepare(
    `SELECT COUNT(*) AS n FROM people p WHERE p.age_ok = 1 AND (
       COALESCE(json_extract(p.settings, '$.models.${task}'), ?) = ?
       OR EXISTS (SELECT 1 FROM json_each(COALESCE(json_extract(p.settings, '$.event_models'), '{}')) j WHERE j.value = ?))`
  ).bind(DEFAULTS[task] ?? '', id, id).first();
  return r?.n || 0;
}

async function listModels(db, viewerId, { task = '', q = '' } = {}) {
  const where = ["(m.visibility = 'public' OR m.owner_id = ?)"];
  const vals = [viewerId || ''];
  if (TASKS[task]) { where.push('m.task = ?'); vals.push(task); }
  if (q) { where.push('(m.name LIKE ? OR m.description LIKE ?)'); vals.push(`%${q}%`, `%${q}%`); }
  const { results } = await db.prepare(
    `SELECT m.id, m.slug, m.name, m.version, m.kind, m.task, m.license, m.description, m.base_model, m.visibility, m.size, m.downloads, m.owner_id, m.created_at, m.source_url, p.name AS owner
     FROM models m JOIN people p ON p.id = m.owner_id WHERE ${where.join(' AND ')} ORDER BY m.downloads DESC, m.created_at DESC LIMIT 200`
  ).bind(...vals).all();
  const ql = q.toLowerCase();
  const built = BUILTIN.filter((m) => (!TASKS[task] || m.task === task) && (!ql || `${m.name} ${m.description}`.toLowerCase().includes(ql)));
  const out = [...built.map(pub), ...results.map((r) => ({ ...pub(r), mine: r.owner_id === viewerId }))];
  for (const m of out) m.used_by = await usedBy(db, m.id, m.task);
  return out;
}

async function uploadModel(db, me, request) {
  const raw = await request.text();
  if (raw.length > MAX_MODEL_BYTES + 20000) throw new BadRequest('Model files can be up to 1 MB.');
  let b;
  try { b = JSON.parse(raw); } catch { throw new BadRequest('That is not valid JSON.'); }
  return insertModel(db, me, { file: validateModel(b.model ?? b), readme: b.readme, base_model: b.base_model, visibility: b.visibility });
}

// Stores a validated model as a new Lab model with its first version.
async function insertModel(db, me, { file, readme = '', base_model = '', visibility = 'public', source_url = '', note = 'First version' }) {
  const text = JSON.stringify(file);
  if (text.length > MAX_MODEL_BYTES) throw new BadRequest('Model files can be up to 1 MB.');
  const n = await db.prepare('SELECT COUNT(*) AS n FROM models WHERE owner_id = ?').bind(me.id).first();
  if (n.n >= 20) throw new BadRequest('You can publish up to 20 models. Delete one first.');
  const id = randomId('m_', 6);
  const slug = `${(me.name || 'user').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'user'}/${file.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)}`;
  const now = Date.now();
  await db.batch([
    db.prepare(
      'INSERT INTO models (id, owner_id, slug, name, version, kind, task, description, license, readme, base_model, visibility, body, size, created_at, source_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(id, me.id, slug, file.name, file.version, file.kind, file.task, file.description, file.license, str(readme, 20000), str(base_model, 80),
      visibility === 'private' ? 'private' : 'public', text, text.length, now, str(source_url, 300)),
    db.prepare('INSERT INTO model_versions (id, model_id, version, body, size, note, source_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(randomId('v_', 6), id, file.version, text, text.length, str(note, 200), str(source_url, 300), now),
  ]);
  return id;
}

// A new version of a model you own. The kind and task cannot change, since athletes may have picked it for that task.
async function addVersion(db, me, id, file, { note = '', source_url = '', readme } = {}) {
  const row = await db.prepare('SELECT id, kind, task FROM models WHERE id = ? AND owner_id = ?').bind(id, me.id).first();
  if (!row) throw new NotFound('Model not found.');
  if (row.kind !== file.kind || row.task !== file.task) throw new BadRequest(`A new version must stay a ${row.kind} model for ${row.task}. Publish a different kind as a new model.`);
  const text = JSON.stringify(file);
  if (text.length > MAX_MODEL_BYTES) throw new BadRequest('Model files can be up to 1 MB.');
  const count = await db.prepare('SELECT COUNT(*) AS n FROM model_versions WHERE model_id = ?').bind(id).first();
  if (count.n >= 50) throw new BadRequest('A model can have up to 50 versions.');
  const now = Date.now();
  await db.batch([
    db.prepare('INSERT INTO model_versions (id, model_id, version, body, size, note, source_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(randomId('v_', 6), id, file.version, text, text.length, str(note, 200), str(source_url, 300), now),
    db.prepare('UPDATE models SET body = ?, size = ?, version = ?, name = ?, description = ?, license = ?, source_url = COALESCE(NULLIF(?, \'\'), source_url), readme = COALESCE(?, readme) WHERE id = ?')
      .bind(text, text.length, file.version, file.name, file.description, file.license, str(source_url, 300), readme !== undefined ? str(readme, 20000) : null, id),
  ]);
}

// Imports and exports call other sites, so each person gets 30 a day.
async function syncBudget(db, me) {
  const use = await db.prepare('INSERT INTO api_usage (key_id, date, calls) VALUES (?, ?, 1) ON CONFLICT(key_id, date) DO UPDATE SET calls = calls + 1 RETURNING calls').bind(`sync:${me.id}`, todayInTz()).first();
  if (use.calls > 30) throw new BadRequest('That is today\'s 30 imports and exports. Try again tomorrow.');
}

// Leave-one-out on your own PRs: hide each result, ask the model for it from the others, compare. Nothing is saved.
async function workbench(db, me, ids) {
  const prs = await getPrs(db, me.id);
  // PRs are stored under the app's names (5K, 2000 SC); the Lab's events use metres.
  const PR_TO_EVENT = { '100': '100', '200': '200', '400': '400', '600': '600', '800': '800', '1000': '1000', '1600': '1600', '3200': '3200', '5K': '5000', '2000 SC': 'S2000', '3000 SC': 'S3000' };
  const have = Object.entries(PR_TO_EVENT).filter(([k]) => prs[k]?.time).map(([k, key]) => {
    const e = EVENT.get(key);
    return { key: e.key, m: e.m, surf: e.surf, steeple: !!e.steeple, sec: parseTime(prs[k].time), ev: e };
  }).filter((p) => p.sec > 0);
  const out = [];
  for (const id of ids.slice(0, 4)) {
    const model = await findModel(db, me.id, id);
    if (!model) throw new NotFound('Model not found.');
    if (model.task === 'marathon') { out.push({ id: model.id, name: model.name, version: model.version, task: model.task, rows: [], note: 'Marathon models read training logs, not PRs, so the Workbench cannot test them here.' }); continue; }
    if (model.task === 'course') { out.push({ id: model.id, name: model.name, version: model.version, task: model.task, rows: [], note: 'Course models convert a flat-course time into a course time, so the Workbench cannot score them on PRs. Pick one for a course on the Purposes page to see it in Fitness.' }); continue; }
    const rows = [];
    for (const p of have) {
      if (p.ev.task !== model.task) continue;
      const r = predictEvent(model, have, p.ev, me.sex || '');
      if (!r) continue;
      rows.push({ event: p.key, label: p.ev.label, actual: p.sec, predicted: r.sec, lo: r.lo, hi: r.hi, err: (r.sec - p.sec) / p.sec, inside: p.sec >= r.lo && p.sec <= r.hi });
    }
    const mae = rows.length ? rows.reduce((a, r) => a + Math.abs(r.err), 0) / rows.length : null;
    out.push({ id: model.id, name: model.name, version: model.version, task: model.task, rows, mae, coverage: rows.length ? rows.filter((r) => r.inside).length / rows.length : null,
      note: rows.length ? undefined : 'Needs at least two PRs in this task to test.' });
  }
  return { results: out, prs: have.length };
}

// Public predict API: API keys are "kst_" + 32 hex characters; only their SHA-256 is stored.
const API_DAILY = 1000;
async function apiKeyUser(db, request) {
  const h = request.headers.get('Authorization') || '';
  const key = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!/^kst_[0-9a-f]{32}$/.test(key)) throw new AuthError(`Send your ${PLATFORM_NAME} API key as "Authorization: Bearer kst_...".`);
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
    const r = model.kind === 'tanda' ? tandaPredict(model.weights, days, today) : marathonPredict(model.weights, days, today);
    return { model: model.id, event: 'marathon', prediction: r && { sec: r.sec, lo: r.lo, hi: r.hi }, note: r ? undefined : model.kind === 'tanda' ? 'Needs enough running days in the 8 weeks before today, and a predicted time between 2:47 and 3:36.' : 'Needs at least 15 running days in the 16 weeks before today.' };
  }
  if (model.task === 'course') {
    const flat = Number(b.flat_sec);
    if (!(flat > 30 && flat < 100000)) throw new BadRequest('Send flat_sec: the time in seconds the runner would run on a flat course in good weather.');
    const sex = ['f', 'm'].includes(b.sex) ? b.sex : '';
    return { model: model.id, course: model.course || null, flat_sec: flat, prediction: { sec: toCourse(model.weights, flat, sex) } };
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
  { name: 'change_level', description: 'Move the athlete up a plan level (only when get_plan_status says ready; athletes on a team plan cannot be moved up, their captain decides) or down one (injury, illness, exhaustion).', inputSchema: { type: 'object', required: ['direction', 'reason'], properties: { direction: { type: 'string', enum: ['up', 'down'] }, reason: { type: 'string' } }, additionalProperties: false } },
  { name: 'get_profile', description: "The athlete's sign-up profile: height, weight, birth year, experience, weekly miles, goal, injuries, resting and max heart rate, and PRs. Check it before asking the athlete anything you could already know.", inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  {
    name: 'set_profile', description: "Fill in or update the athlete's profile from what they tell you. Only send fields they actually said; others are kept. Height and weight are metric. The athlete still confirms their age in the app.",
    inputSchema: { type: 'object', properties: {
      name: { type: 'string' }, sex: { type: 'string', enum: ['f', 'm', ''] },
      height_cm: { type: 'number', minimum: 100, maximum: 230 }, weight_kg: { type: 'number', minimum: 25, maximum: 220 }, birth_year: { type: 'integer' },
      units: { type: 'string', enum: ['mi', 'km'] }, experience: { type: 'string', enum: ['new', 'under1', '1to3', '3plus'], description: 'just starting / under a year / 1-3 years / over 3 years' },
      weekly_miles: { type: 'number', minimum: 0, maximum: 150, description: 'Typical miles per week now. Only used to pick the starting plan level, and only before one is set.' },
      longest_run_mi: { type: 'number' }, days_per_week: { type: 'integer', minimum: 1, maximum: 7 },
      resting_hr: { type: 'integer' }, max_hr: { type: 'integer' }, watch: { type: 'string', enum: ['garmin', 'coros', 'apple', 'strava', 'other', 'none'] },
      injuries: { type: 'string' }, goal: { type: 'string', enum: PROFILE_GOALS }, goal_event: { type: 'string' }, goal_time: { type: 'string', description: 'm:ss or h:mm:ss' }, goal_date: { type: 'string', description: 'YYYY-MM-DD' },
    }, additionalProperties: false },
  },
  { name: 'get_fitness', description: "Fitness States: race estimates, VO2max estimate, weekly mileage, pace zones and what they're based on.", inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
];

class McpToolError extends Error {}
async function callWatchTool(env, person, name, args) {
  try {
    if (name === 'watch_status') return await icuStatus(env.DB, person.id);
    if (name === 'connect_watch') return { ...(await icuConnect(env, person.id, args.athlete_id, args.api_key)), synced: await syncPerson(env, person.id), next: 'Call sync_watch with full_history: true until done.' };
    if (name === 'sync_watch') return args.full_history ? await importHistory(env, person.id) : await syncPerson(env, person.id);
    if (name === 'get_profile') { const me = await loadMe(env.DB, person); return { ...(await meView(env.DB, me)).user, profile: settingsOf(me).profile || {}, prs: await getPrs(env.DB, person.id), plan_level: me.plan_rank }; }
    if (name === 'set_profile') {
      const me = await loadMe(env.DB, person);
      const { name: nm, sex, weekly_miles, ...fields } = args;
      const known = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== null && v !== ''));
      if (!Object.keys(known).length && nm === undefined && sex === undefined && weekly_miles === undefined) throw new McpToolError('Nothing to save. Send at least one field.');
      await updateMe(env.DB, me, { name: nm, sex, weekly_miles, profile: { ...(settingsOf(me).profile || {}), ...known } });
      return { saved: true, profile: settingsOf(await loadMe(env.DB, person)).profile };
    }
    if (name === 'get_fitness') return compactFitness(await recomputeFitness(env.DB, person.id, todayInTz()));
    if (name === 'get_plan_status') return await kaiState(env.DB, person.id);
    const full = await loadPerson(env.DB, person.id);
    if (name === 'change_level') return await changeLevel(env.DB, full, args.direction, args.reason, todayInTz(), await healthSummary(env.DB, full, todayInTz()));
    if (name === 'change_plan_day') {
      if (args.reset) { await resetPlanDay(env.DB, person.id, args.date, false); return { reset: args.date }; }
      return await applyPlanChange(env.DB, full, args, 'kai');
    }
  } catch (err) {
    if (err instanceof IntervalsError || err instanceof PlanError || err instanceof BadRequest) throw new McpToolError(err.message);
    throw err;
  }
  throw new McpToolError(`Unknown tool: ${name}`);
}

const MCP_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const MCP_MAX_BODY = 512 * 1024;
const MCP_MAX_CALLS_PER_MIN = 90;
const mcpCalls = new Map(); // per-isolate, best effort: slows a runaway client, not a determined one

// Cheap argument check against a tool's inputSchema so a model gets a clear message instead of a stack trace.
function checkArgs(schema, args, at = '') {
  if (schema?.type === 'object') {
    if (args === null || typeof args !== 'object' || Array.isArray(args)) return `${at || 'arguments'} must be an object`;
    for (const k of schema.required || []) if (args[k] === undefined || args[k] === null) return `Missing required field "${at}${k}"`;
    for (const [k, v] of Object.entries(args)) {
      const sub = schema.properties?.[k];
      if (!sub) { if (schema.additionalProperties === false) return `Unknown field "${at}${k}". Allowed: ${Object.keys(schema.properties || {}).join(', ') || 'none'}`; continue; }
      const bad = checkArgs(sub, v, `${at}${k}.`);
      if (bad) return bad;
    }
    return '';
  }
  const label = at.replace(/\.$/, '');
  if (schema?.type === 'array') {
    if (!Array.isArray(args)) return `"${label}" must be a list`;
    if (schema.minItems && args.length < schema.minItems) return `"${label}" needs at least ${schema.minItems} item${schema.minItems > 1 ? 's' : ''}`;
    if (schema.maxItems && args.length > schema.maxItems) return `"${label}" can have at most ${schema.maxItems} items`;
    for (let i = 0; i < args.length; i++) { const bad = checkArgs(schema.items, args[i], `${at}${i}.`); if (bad) return bad; }
    return '';
  }
  if (schema?.type === 'string' && typeof args !== 'string') return `"${label}" must be text`;
  if ((schema?.type === 'number' || schema?.type === 'integer')) {
    if (typeof args !== 'number' || !Number.isFinite(args)) return `"${label}" must be a number`;
    if (schema.type === 'integer' && !Number.isInteger(args)) return `"${label}" must be a whole number`;
    if (schema.minimum !== undefined && args < schema.minimum) return `"${label}" must be at least ${schema.minimum}`;
    if (schema.maximum !== undefined && args > schema.maximum) return `"${label}" must be at most ${schema.maximum}`;
  }
  if (schema?.type === 'boolean' && typeof args !== 'boolean') return `"${label}" must be true or false`;
  if (schema?.enum && !schema.enum.includes(args)) return `"${label}" must be one of: ${schema.enum.join(', ')}`;
  return '';
}

// Errors an athlete or their AI can act on. Anything else is logged here and reported generically.
const isUserError = (err) => err instanceof McpToolError || err instanceof BadRequest || err instanceof LogError || err instanceof IntervalsError
  || err instanceof PlanError || err instanceof CourseError || err instanceof CalcError || err instanceof AiError || err instanceof CoachError;

const readOnlyTool = (name) => /^(get_|find_|watch_status)/.test(name);

async function serveMcp(request, tools, call, key = '') {
  const reply = (status, body) => json(body, status);
  const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
  if (Number(request.headers.get('content-length')) > MCP_MAX_BODY) return reply(413, rpcError(null, -32600, 'Request too large'));
  let raw;
  try { raw = await request.text(); } catch { return reply(400, rpcError(null, -32700, 'Parse error')); }
  if (raw.length > MCP_MAX_BODY) return reply(413, rpcError(null, -32600, 'Request too large'));
  let rpc;
  try { rpc = JSON.parse(raw); } catch { return reply(400, rpcError(null, -32700, 'Parse error')); }

  const now = Date.now();
  const recent = (mcpCalls.get(key) || []).filter((t) => now - t < 60000);
  recent.push(now);
  mcpCalls.set(key, recent);
  if (mcpCalls.size > 500) for (const [k, v] of mcpCalls) if (!v.some((t) => now - t < 60000)) mcpCalls.delete(k);
  const limited = recent.length > MCP_MAX_CALLS_PER_MIN;

  const toolList = tools.map((t) => ({ ...t, annotations: { title: t.name.replace(/_/g, ' '), readOnlyHint: readOnlyTool(t.name), openWorldHint: false, ...(t.annotations || {}) } }));

  async function one(msg) {
    if (!msg || typeof msg !== 'object' || Array.isArray(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return rpcError(msg?.id, -32600, 'Invalid request');
    const { id, method, params } = msg;
    const note = id === undefined || id === null && method.startsWith('notifications/');
    const ok = (result) => (note ? null : { jsonrpc: '2.0', id, result });
    if (method.startsWith('notifications/')) return null;
    if (limited && method === 'tools/call') return ok({ content: [{ type: 'text', text: 'Too many requests. Wait a minute and try again.' }], isError: true });
    if (method === 'initialize') {
      const asked = params?.protocolVersion;
      return ok({ protocolVersion: MCP_VERSIONS.includes(asked) ? asked : MCP_VERSIONS[0], capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'kestrel', title: 'Kestrel AI', version: '1.1.0' },
        instructions: 'Kestrel is the athlete\'s running coach. Call get_coach_context first every time. Use get_profile before asking the athlete anything, and set_profile to save what they tell you. Plan changes are checked by fixed guardrails and may be refused with a reason; pass that reason on.' });
    }
    if (method === 'ping') return ok({});
    if (method === 'tools/list') return ok({ tools: toolList });
    if (method === 'prompts/list') return ok({ prompts: [] });
    if (method === 'resources/list') return ok({ resources: [] });
    if (method === 'resources/templates/list') return ok({ resourceTemplates: [] });
    if (method === 'logging/setLevel') return ok({});
    if (method === 'tools/call') {
      const tool = tools.find((t) => t.name === params?.name);
      if (!tool) return note ? null : rpcError(id, -32602, `Unknown tool: ${params?.name}`);
      const args = params?.arguments ?? {};
      const bad = checkArgs(tool.inputSchema, args);
      if (bad) return ok({ content: [{ type: 'text', text: `Invalid arguments: ${bad}.` }], isError: true });
      try {
        const out = await call(tool.name, args);
        return ok({ content: [{ type: 'text', text: JSON.stringify(out ?? { ok: true }) }] });
      } catch (err) {
        if (!isUserError(err)) console.error('kestrel mcp', tool.name, err?.stack || String(err));
        return ok({ content: [{ type: 'text', text: isUserError(err) ? err.message || 'Tool failed' : 'Kestrel hit an error on its side. Try again in a moment.' }], isError: true });
      }
    }
    return note ? null : rpcError(id, -32601, `Method not found: ${method}`);
  }

  if (Array.isArray(rpc)) {
    if (!rpc.length) return reply(400, rpcError(null, -32600, 'Empty batch'));
    if (rpc.length > 20) return reply(400, rpcError(null, -32600, 'Batch too large'));
    const out = (await Promise.all(rpc.map(one))).filter(Boolean);
    return out.length ? json(out) : new Response(null, { status: 202 });
  }
  const out = await one(rpc);
  return out ? json(out, out.error?.code === -32600 ? 400 : 200) : new Response(null, { status: 202 });
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
    return json({ supabaseUrl: env.SUPABASE_URL || '', supabaseKey: env.SUPABASE_KEY || '', platform: PLATFORM_NAME, purposes: PURPOSES, slotEvents: SLOT_EVENTS, tasks: TASKS, kinds: KINDS, defaults: DEFAULTS, labEvents: EVENTS, freeAi: aiEnabled(env), bodyParts: BODY_PARTS, levels: [] });
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
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...CORS, 'Access-Control-Allow-Headers': 'Content-Type, Mcp-Protocol-Version, Mcp-Session-Id' } });
    if (method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST, OPTIONS', ...CORS } });
    const person = await personForToken(db, mcp[1]);
    // 404, not 401: a 401 makes connectors go looking for an OAuth sign-in service, which this link does not use.
    if (!person) return json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unknown Kestrel AI link. Make a new one in Kestrel > You > Settings.' } }, 404);
    return await serveMcp(request, [...WATCH_TOOLS, ...COACH_TOOLS], (name, args) =>
      (WATCH_TOOLS.some((t) => t.name === name) ? callWatchTool(env, person, name, args) : callCoachTool(db, person, name, args)), mcp[1]);
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
  // Try a model from its Lab page without an account: 60 predictions a day per visitor (by a hash of the IP).
  if (path === '/api/lab/try' && method === 'POST') {
    const who = viewer ? `p:${viewer.id}` : `ip:${(await sha256(request.headers.get('CF-Connecting-IP') || 'local')).slice(0, 16)}`;
    const use = await db.prepare('INSERT INTO api_usage (key_id, date, calls) VALUES (?, ?, 1) ON CONFLICT(key_id, date) DO UPDATE SET calls = calls + 1 RETURNING calls').bind(who, todayInTz()).first();
    if (use.calls > 60) throw new BadRequest('That is today\'s 60 free tries. Sign in and make an API key for more.');
    return json(await apiPredict(db, viewer?.id || null, await readJson(request)));
  }
  if (path === '/api/lab/stats' && method === 'GET') {
    const r = await db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(downloads), 0) AS d, COUNT(DISTINCT owner_id) AS o FROM models WHERE visibility = 'public'").first();
    return json({ models: r.n + BUILTIN.length, downloads: r.d, publishers: r.o + 1 });
  }
  // Versions and lineage take the model id as ?id= (built-in ids contain a slash, so they cannot sit in the path).
  if (path === '/api/lab/versions' && method === 'GET') {
    const m = await findModel(db, viewer?.id, str(q.get('id'), 80));
    if (!m) throw new NotFound('Model not found.');
    if (m.builtin) return json({ versions: [{ id: 'current', version: m.version || '', size: pub(m).size, note: 'Ships with Kestrel', created_at: null, current: true }] });
    const { results } = await db.prepare('SELECT id, version, size, note, source_url, created_at FROM model_versions WHERE model_id = ? ORDER BY created_at DESC').bind(m.id).all();
    return json({ versions: results.map((v, i) => ({ ...v, current: i === 0 })) });
  }
  if (path === '/api/lab/lineage' && method === 'GET') {
    const m = await findModel(db, viewer?.id, str(q.get('id'), 80));
    if (!m) throw new NotFound('Model not found.');
    const parent = m.base_model ? await findModel(db, viewer?.id, m.base_model) : null;
    const { results } = await db.prepare(
      `SELECT m.id, m.slug, m.name, m.version, m.kind, m.task, m.license, m.description, m.base_model, m.visibility, m.size, m.downloads, m.owner_id, m.created_at, m.source_url, p.name AS owner
       FROM models m JOIN people p ON p.id = m.owner_id WHERE m.base_model = ? AND (m.visibility = 'public' OR m.owner_id = ?) ORDER BY m.created_at DESC LIMIT 50`
    ).bind(m.id, viewer?.id || '').all();
    return json({ parent: parent ? pub(parent) : null, external_parent: !parent && m.base_model ? m.base_model : '', children: results.map(pub) });
  }
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
    return json({ model: { ...pub(m), readme: m.readme || '', mine: !!viewer && m.owner_id === viewer.id, used_by: await usedBy(db, m.id, m.task), weights_summary: weightsSummary(m) } });
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
  // Sign-up by description (before the age check: it is part of sign-up).
  if (path === '/api/me/parse' && method === 'POST') {
    const out = await parseProfileText(env, db, me, (await readJson(request)).text, today);
    return json({ fields: out });
  }
  if (!me.age_ok) throw new Forbidden('Finish setting up your profile first.');

  // A training plan built with Kestrel AI for yourself (used when you have no team plan, or instead of it).
  if (path === '/api/me/plan') {
    const own = settingsOf(me).personal_plan || null;
    if (method === 'GET') return json({ custom: !!own, spec: own?.spec || null, plans: own?.plans || null, team_plan: !!(await db.prepare('SELECT 1 FROM team_plans tp JOIN team_members tm ON tm.team_id = tp.team_id WHERE tm.person_id = ?').bind(me.id).first()) });
    if (method === 'PUT') {
      const x = expandPlanSpec((await readJson(request)).plan);
      await db.prepare('UPDATE people SET settings = ? WHERE id = ?').bind(JSON.stringify({ ...settingsOf(me), personal_plan: { spec: x.spec, plans: x.plans, updated_at: Date.now() } }), me.id).run();
      return json({ ok: true });
    }
    if (method === 'DELETE') {
      const { personal_plan, ...rest } = settingsOf(me);
      await db.prepare('UPDATE people SET settings = ? WHERE id = ?').bind(JSON.stringify(rest), me.id).run();
      return json({ ok: true });
    }
  }
  if ((path === '/api/me/plan/chat' || path === '/api/me/plan/prompt') && method === 'POST') {
    const own = settingsOf(me).personal_plan?.spec || null;
    const athlete = { class_year: me.class_year, sex: me.sex, prs: me.prs, five_k_time: me.five_k_time, profile: settingsOf(me).profile || {} };
    return json(await planChatRoute(env, db, me, await readJson(request), { team: false, current: own, athlete }, path.endsWith('prompt'), today));
  }
  if (path === '/api/me/plan/preview' && method === 'POST') return json(previewSpec((await readJson(request)).plan));

  if (path === '/api/shoes') {
    if (method === 'GET') return json({ shoes: await shoesView(db, me) });
    if (method === 'PUT') return json({ shoes: await saveShoes(db, me, (await readJson(request)).shoes) });
  }

  // Kestrel Lab, signed in
  if (path === '/api/lab/models' && method === 'POST') return json({ id: await uploadModel(db, me, request) });
  if (path === '/api/lab/fork' && method === 'POST') {
    const m = await findModel(db, me.id, str((await readJson(request)).id, 80));
    if (!m) throw new NotFound('Model not found.');
    const id = await insertModel(db, me, { file: validateModel(modelFile(m)), readme: m.readme || '', base_model: m.id, visibility: 'private', note: `Forked from ${m.name} ${m.version || ''}`.trim() });
    return json({ id });
  }
  if (path === '/api/lab/versions' && method === 'POST') {
    const b = await readJson(request);
    const id = str(b.id, 80);
    await addVersion(db, me, id, validateModel(b.model), { note: b.note, readme: b.readme });
    return json({ ok: true });
  }
  if (path === '/api/lab/import' && method === 'POST') {
    const b = await readJson(request);
    if (!SOURCES.includes(b.source)) throw new BadRequest('source must be github or huggingface.');
    await syncBudget(db, me);
    const got = await importModel({ source: b.source, repo: str(b.repo, 300), token: str(b.token, 300) });
    const mine = got.source_url ? await db.prepare('SELECT id, version FROM models WHERE owner_id = ? AND source_url = ?').bind(me.id, got.source_url).first() : null;
    const preview = { model: { name: got.model.name, version: got.model.version, kind: got.model.kind, task: got.model.task, license: got.model.license, description: got.model.description, size: JSON.stringify(got.model).length },
      readme: got.readme, base_model: got.base_model, source_url: got.source_url, files: got.files, update_of: mine ? { id: mine.id, version: mine.version } : null };
    if (b.dry !== false) return json({ dry: true, ...preview });
    if (mine) { await addVersion(db, me, mine.id, got.model, { note: `Updated from ${got.source === 'github' ? 'GitHub' : 'Hugging Face'}`, source_url: got.source_url, readme: got.readme }); return json({ id: mine.id, updated: true }); }
    return json({ id: await insertModel(db, me, { file: got.model, readme: got.readme, base_model: got.base_model, visibility: b.visibility === 'private' ? 'private' : 'public', source_url: got.source_url, note: `Imported from ${got.source === 'github' ? 'GitHub' : 'Hugging Face'}` }) });
  }
  if (path === '/api/lab/export' && method === 'POST') {
    const b = await readJson(request);
    if (!SOURCES.includes(b.target)) throw new BadRequest('target must be github or huggingface.');
    const m = await findModel(db, me.id, str(b.id, 80));
    if (!m) throw new NotFound('Model not found.');
    await syncBudget(db, me);
    const args = { repo: str(b.repo, 300), token: str(b.token, 300), model: m, readme: m.readme || (m.builtin ? `${m.description}\n\nTrained on: ${m.trained_on || ''}` : ''), message: str(b.message, 200), visibility: m.visibility, origin: new URL(request.url).origin };
    const out = b.target === 'github' ? await exportToGithub(args) : await exportToHuggingface(args);
    return json(out);
  }
  if (path === '/api/lab/workbench' && method === 'POST') {
    const b = await readJson(request);
    const ids = (Array.isArray(b.models) ? b.models : []).map((x) => str(x, 80)).filter(Boolean);
    if (!ids.length) throw new BadRequest('Pick at least one model to test.');
    return json(await workbench(db, me, ids));
  }

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
    if (sub === 'roster' && method === 'GET') return json({ role, members: await teamRoster(db, teamId, me, role) });
    if (mm && method === 'PUT') {
      await saveRosterEntry(db, teamId, me, role, mm[1], await readJson(request));
      return json({ members: await teamRoster(db, teamId, me, role) });
    }
    if (sub.startsWith('plan')) {
      if (sub === 'plan' && method === 'GET') {
        const row = await db.prepare('SELECT data, spec, updated_at FROM team_plans WHERE team_id = ?').bind(teamId).first();
        return json({ plans: row ? JSON.parse(row.data) : null, custom: !!row, spec: row?.spec ? JSON.parse(row.spec) : null, updated_at: row?.updated_at || null, can_edit: isLead(role) });
      }
      if (!isLead(role)) throw new Forbidden('Only the team owner or a captain can change the team plan.');
      if (sub === 'plan/chat' || sub === 'plan/prompt') return json(await planChatRoute(env, db, me, await readJson(request), await teamPlanScope(db, teamId), sub.endsWith('prompt'), today));
      if (sub === 'plan/preview' && method === 'POST') return json(previewSpec((await readJson(request)).plan));
      if (sub === 'plan/levels' && method === 'GET') {
        const row = await db.prepare('SELECT data FROM team_plans WHERE team_id = ?').bind(teamId).first();
        const plans = row ? JSON.parse(row.data) : {};
        return json({ levels: Object.keys(plans).map((r) => ({ level: Number(r), miles: plans[r].weeks[0].miles })), athletes: row ? await teamLevels(db, teamId, today) : [] });
      }
      if (sub === 'plan/weeks' && method === 'GET') return json(await teamWeeks(db, teamId, today));
      if (sub === 'plan/weeks' && method === 'PUT') {
        const skipped = await setTeamWeek(db, teamId, me, today, await readJson(request));
        return json({ ...(await teamWeeks(db, teamId, today)), skipped });
      }
      const lm = sub.match(/^plan\/levels\/(.+)$/);
      if (lm && method === 'PUT') {
        const target = await roleIn(db, teamId, lm[1]);
        if (!target) throw new NotFound('Not on this team.');
        const person = await loadPerson(db, lm[1]);
        if (person.plan_source !== 'team' || person.plan_team_id !== teamId) throw new BadRequest('That athlete does not train from this team’s plan.');
        const to = Number((await readJson(request)).level);
        if (!person.plans[to]) throw new BadRequest('That level is not in the plan.');
        const from = rankOf(person);
        if (to !== from) {
          await setRank(db, person, to, `Set by ${me.name || 'a captain'}.`, 'captain');
          await db.prepare('UPDATE people SET coach_rank = ? WHERE id = ?').bind(to, person.id).run(); // the AI's step limit now counts from the captain's choice
        }
        return json({ athletes: await teamLevels(db, teamId, today) });
      }
      if (sub === 'plan' && method === 'PUT') {
        const b = await readJson(request);
        let plans, spec = null; // null = a hand edit of the cells: keep the AI's brief so it can still be refined
        if (b.plan) { const x = expandPlanSpec(b.plan); plans = x.plans; spec = JSON.stringify(x.spec); }
        else plans = validateTeamPlans(b.plans);
        await db.prepare('INSERT INTO team_plans (team_id, data, spec, updated_by, updated_at) VALUES (?, ?, COALESCE(?, \'\'), ?, ?) ON CONFLICT(team_id) DO UPDATE SET data = excluded.data, spec = COALESCE(?, team_plans.spec), updated_by = excluded.updated_by, updated_at = excluded.updated_at')
          .bind(teamId, JSON.stringify(plans), spec, me.id, Date.now(), spec).run();
        return json({ ok: true });
      }
      if (sub === 'plan' && method === 'DELETE') { await db.prepare('DELETE FROM team_plans WHERE team_id = ?').bind(teamId).run(); return json({ ok: true }); }
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
    if (path === '/api/team/activities') { needTeam(); return json(await teamActivities(db, teamId, me, str(q.get('before'), 80))); }
    if (path === '/api/cohort') { const rep = await cohortReport(db, me.id, str(q.get('goal'), 12)); return json(rep, rep.error ? 400 : 200); }
    if (path === '/api/plan/export') {
      const fitness = await getFitness(db, me.id, today);
      if (!fitness?.zones?.length) throw new BadRequest('Add a race or PR first so Kestrel can set your paces.');
      const days = Math.min(Math.max(Number(q.get('days')) || 14, 1), 28);
      return json({ workouts: await planWorkouts(db, await loadPerson(db, me.id), fitness, today, days) });
    }
    if (path === '/api/plan') { const p = await planView(db, me, Number(q.get('level')) || null); return p ? json(p) : json({ error: 'no_plan' }, 404); }
    if (path === '/api/distance') return json({ configured: false, available: false });
    // Finds any new PR (a stale Fitness State recomputes) before the day shows which run set it.
    if (path === '/api/log') { await getFitness(db, me.id, today).catch(() => null); return json({ ...(await getLog(db, me.id, str(q.get('from'), 10), str(q.get('to'), 10))), five_k_time: await fiveKFor(db, me.id) }); }
    if (path === '/api/intervals/status') return json({ ...(await icuStatus(db, me.id)), ai: aiEnabled(env) });
    if (path === '/api/library') {
      const person = await loadPerson(db, me.id);
      const fitness = await getFitness(db, me.id, today);
      return json({
        ...libraryMeta(), groups: WORKOUT_GROUPS,
        workouts: WORKOUTS.map((w) => ({ ...w, group: workoutGroup(w), personal: personalWorkout(w, fitness?.vo2r ? fitness : null, libraryRank(rankOf(person))) })),
        fitness, five_k_time: await fiveKFor(db, me.id), prs: await getPrs(db, me.id),
      });
    }
    if (path === '/api/courses') {
      const courses = await listCourses(db, me.id);
      return json({ courses, tracked: trackedOf(settingsOf(me), await getPrs(db, me.id)), stats: await courseStats(db, courses.map((c) => c.id)), distances: COURSE_DISTANCES });
    }
    // Records: fitness is recomputed first when it is stale, so any PR a new run set is already in the list.
    if (path === '/api/records') {
      await getFitness(db, me.id, today);
      const prs = await getPrs(db, me.id);
      const courses = await coursesById(db, [...Object.keys(prs).map((k) => parseCourseKey(k)?.id).filter(Boolean), ...trackedOf(settingsOf(me), prs).map((t) => t.course)]);
      return json({ prs, tracked: trackedOf(settingsOf(me), prs), courses: Object.fromEntries([...courses].map(([id, c]) => [id, { id, name: c.name, place: c.place }])) });
    }
    if (path === '/api/runs/track') {
      const r = await getTrack(env, me.id, str(q.get('id'), 80));
      return json(r, r.error === 'not_found' ? 404 : 200);
    }
    if (path === '/api/fitness') return json({ fitness: await getFitness(db, me.id, today), history: await fitnessHistory(db, me.id) });
    if (path === '/api/predict') { try { return json(await racePredictions(env, me.id, today)); } catch (e) { return json({ enabled: false, error: String(e?.message || e) }); } }
    if (path === '/api/kai') return json(await kaiState(db, me.id));
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

  // Your own profile and status (Kestrel paths; any personId in the body is ignored)
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

  // Team calendar (Kestrel paths, scoped to the X-Kestrel-Team team)
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
    const place = await placeFor(db, teamId, b.locationId, b.location);
    const ev = { id, date, title, time: str(b.time, 40), endTime: str(b.endTime, 40), desc: str(b.desc, 2000), type, kind: kindFor(type, b.kind), location: str(b.location, 200) || place?.name || '', locationId: place?.id || '', checklist: str(b.checklist, 1000), results: '', auto: false, createdBy: me.id };
    await db.prepare('INSERT INTO events (id, team_id, date, title, time, end_time, description, type, kind, location, location_id, checklist, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, teamId, date, title, ev.time, ev.endTime, ev.desc, type, ev.kind, ev.location, place?.id || null, ev.checklist, me.id, Date.now()).run();
    return json({ event: ev });
  }
  if (path === '/api/events/update') {
    needTeam();
    const e = await eventIn(db, teamId, b.eventId);
    if (!canEdit(e, me, role)) throw new Forbidden('Only whoever added the event, a captain or the team owner can change it.');
    const title = str(b.title, 200);
    if (!title) throw new BadRequest('Missing title.');
    const type = EVENT_TYPES.includes(b.type) ? b.type : 'practice';
    // The venue link follows the location text: a known place links to it, new text unlinks, a blank field keeps what was there.
    const location = str(b.location, 200);
    const place = await placeFor(db, teamId, b.locationId, location);
    const locationId = place ? place.id : location && location !== e.location ? null : e.location_id;
    await db.prepare('UPDATE events SET title = ?, time = ?, end_time = ?, description = ?, type = ?, kind = ?, location = ?, location_id = ?, checklist = ?, results = ? WHERE id = ?')
      .bind(title, str(b.time, 40), str(b.endTime, 40), str(b.desc, 2000), type, kindFor(type, b.kind), location, locationId, 
        b.checklist !== undefined ? str(b.checklist, 1000) : e.checklist, b.results !== undefined ? str(b.results, 2000) : e.results, e.id).run();
    return json({ ok: true });
  }
  if (path === '/api/events/delete') {
    needTeam();
    const e = await eventIn(db, teamId, b.eventId);
    if (!canEdit(e, me, role)) throw new Forbidden('Only whoever added the event, a captain or the team owner can delete it.');
    await db.prepare('DELETE FROM events WHERE id = ?').bind(e.id).run();
    return json({ ok: true });
  }
  if (path === '/api/locations') {
    needTeam();
    return json({ place: await addPlace(db, teamId, b) });
  }
  if (path === '/api/locations/update' || path === '/api/locations/delete') {
    needTeam();
    if (!isLead(role)) throw new Forbidden('Only the team owner or a captain can change a place.');
    const loc = await placeFor(db, teamId, b.locationId, null);
    if (!loc) throw new NotFound('Place not found.');
    if (path.endsWith('/delete')) { await db.prepare('DELETE FROM locations WHERE id = ?').bind(loc.id).run(); return json({ ok: true }); }
    const name = str(b.name, 120);
    if (!name) throw new BadRequest('Give the place a name.');
    const address = str(b.address, 200);
    const kind = PLACE_KINDS.includes(b.kind) ? b.kind : loc.kind;
    // New coordinates only when the address changed; events keep their link, and their text follows the new name.
    const geo = address !== loc.address ? (address ? await geocode(address) : null) : { lat: loc.lat, lng: loc.lng };
    await db.prepare('UPDATE locations SET name = ?, address = ?, kind = ?, lat = ?, lng = ? WHERE id = ?').bind(name, address, kind, geo?.lat ?? null, geo?.lng ?? null, loc.id).run();
    if (name !== loc.name) await db.prepare('UPDATE events SET location = ? WHERE location_id = ?').bind(name, loc.id).run();
    return json({ ok: true });
  }
  // Kestrel AI reads a pasted or uploaded schedule into a list to confirm; the free model answers here, any other runs in the browser.
  if (path === '/api/schedule/import' || path === '/api/schedule/import/prompt') {
    needTeam();
    const documents = (Array.isArray(b.documents) ? b.documents : []).slice(0, 5)
      .map((d) => ({ name: str(d?.name, 80), text: String(d?.text || '').slice(0, 20000) })).filter((d) => d.text.trim());
    const input = { text: str(b.text, 4000), documents };
    const team = await db.prepare('SELECT name FROM teams WHERE id = ?').bind(teamId).first();
    const { results: places } = await db.prepare('SELECT name, address, kind FROM locations WHERE team_id = ?').bind(teamId).all();
    const scope = { team: team?.name, places };
    if (path.endsWith('/prompt')) return json(scheduleChat(input, scope, today));
    return json(await askSchedule(env, db, me, input, scope, today));
  }
  // Save what the person confirmed from an import: places first, then the events linked to them. Repeats are skipped.
  if (path === '/api/schedule/bulk') {
    needTeam();
    const places = (Array.isArray(b.places) ? b.places : []).slice(0, 30);
    const evs = (Array.isArray(b.events) ? b.events : []).slice(0, 80);
    let addedPlaces = 0, addedEvents = 0, skipped = 0, geocoded = 0;
    for (const p of places) {
      if (!str(p?.name, 120)) continue;
      const had = await placeFor(db, teamId, null, p.name);
      if (had) continue;
      // Looking up coordinates is a free service with a one-a-second limit: only the first few places get one.
      const withGeo = geocoded < 6 && !(Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)));
      if (withGeo) geocoded++;
      const place = withGeo ? await addPlace(db, teamId, p) : await addPlaceNoGeo(db, teamId, p);
      if (place) addedPlaces++;
    }
    for (const x of evs) {
      const date = str(x?.date, 10), title = str(x?.title, 200);
      if (!isDate(date) || !title) { skipped++; continue; }
      const dup = await db.prepare('SELECT 1 FROM events WHERE team_id = ? AND date = ? AND lower(title) = ?').bind(teamId, date, title.toLowerCase()).first();
      if (dup) { skipped++; continue; }
      const type = EVENT_TYPES.includes(x.type) ? x.type : 'practice';
      const place = await placeFor(db, teamId, null, x.location);
      await db.prepare('INSERT INTO events (id, team_id, date, title, time, end_time, description, type, kind, location, location_id, checklist, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind('e_' + crypto.randomUUID(), teamId, date, title, str(x.time, 40), str(x.endTime, 40), str(x.desc, 2000), type, kindFor(type, x.kind), str(x.location, 200) || place?.name || '', place?.id || null, str(x.checklist, 1000), me.id, Date.now()).run();
      addedEvents++;
    }
    return json({ addedPlaces, addedEvents, skipped });
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
    if (p.person_id !== me.id && !isLead(role)) throw new Forbidden('Only the author, a captain or the team owner can delete a post.');
    await db.prepare('DELETE FROM posts WHERE id = ?').bind(str(b.postId, 100)).run();
    return json({ ok: true });
  }
  // Your own training (Kestrel paths)
  if (path === '/api/plan/reset') { await resetPlanDay(db, me.id, str(b.date, 10), b.keep === true); return json(await kaiState(db, me.id)); }
  if (path === '/api/log/session-splits') {
    const reps = (Array.isArray(b.reps) ? b.reps : []).slice(0, 40)
      .map((r) => ({ m: Math.round(Number(r?.m)), s: Math.round(Number(r?.s) * 10) / 10, hr: r?.hr ? Math.round(Number(r.hr)) : null, rest: str(r?.rest, 12) }))
      .filter((r) => r.m >= 50 && r.m <= 20000 && r.s > 0 && r.s < 7200);
    const res = await db.prepare('UPDATE workouts SET laps = ? WHERE person_id = ? AND strava_id = ?').bind(reps.length ? JSON.stringify(reps) : '', me.id, str(b.strava_id, 60)).run();
    if (!res.meta.changes) throw new NotFound('Unknown session.');
    await db.prepare('UPDATE fitness_states SET computed_at = 0 WHERE person_id = ?').bind(me.id).run();
    return json({ ok: true, reps });
  }
  if (path === '/api/log/tag') {
    await setRunTag(db, me.id, str(b.strava_id, 80), b.tag);
    const fitness = await recomputeFitness(db, me.id, today).catch(() => null);
    return json({ ok: true, new_prs: fitness?.new_prs || [] });
  }
  if (path === '/api/log/custom-tag') return json({ custom: b.remove ? await removeCustomTag(db, me.id, b.name) : await addCustomTag(db, me.id, b.name, b.base) });
  if (path === '/api/log/track') {
    const day = await setDayTrack(db, me.id, str(b.date, 10), b.track === true);
    await db.prepare('UPDATE fitness_states SET computed_at = 0 WHERE person_id = ?').bind(me.id).run();
    return json(day);
  }
  if (path === '/api/fitness/refresh') return json({ fitness: await recomputeFitness(db, me.id, today) });
  if (path === '/api/people/prs') return json({ ...(await setPrs(db, me.id, b.prs)), fitness: await recomputeFitness(db, me.id, today) });
  if (path === '/api/courses') return json(await createCourse(db, me.id, { name: b.name, place: b.place, distances: b.distances }));
  if (path === '/api/courses/track') {
    const tracked = await setTracked(db, me.id, b.tracked);
    return json({ tracked, fitness: await recomputeFitness(db, me.id, today) });
  }
  // Pick (or clear) the course a run was on. Its PRs are searched again straight away.
  if (path === '/api/runs/course') {
    const id = str(b.course_id, 40);
    // '' goes back to Kestrel's own guess; 'none' says it was on no known course.
    if (id && id !== 'none' && !(await getCourse(db, id))) throw new BadRequest('That course is not in the list.');
    const run = str(b.strava_id, 80);
    const res = await db.prepare('UPDATE workouts SET course_id = ? WHERE person_id = ? AND strava_id = ?').bind(id, me.id, run).run();
    if (!res.meta.changes) throw new NotFound('Unknown run.');
    await dropAutoPrsFrom(db, me.id, run);
    const fitness = await recomputeFitness(db, me.id, today);
    return json({ ok: true, course_id: id, new_prs: fitness?.new_prs || [], prs: await getPrs(db, me.id), fitness });
  }
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
    // The Kestrel AI link is the login: there is no OAuth. Say so plainly when a connector probes for it.
    if (url.pathname.startsWith('/.well-known/')) return json({ error: 'Kestrel AI uses a private link, not OAuth.' }, 404);
    if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/mcp/')) return env.ASSETS.fetch(request);
    try {
      return await route(request, env, url);
    } catch (err) {
      const cors = url.pathname.startsWith('/api/v1/') ? CORS : {};
      if (err instanceof AuthError) return json({ error: err.message, auth: true }, 401, cors);
      if (err instanceof Forbidden) return json({ error: err.message }, 403, cors);
      if (err instanceof NotFound) return json({ error: err.message }, 404, cors);
      if (err instanceof BadRequest || err instanceof ModelError || err instanceof AiError || err instanceof LogError
        || err instanceof IntervalsError || err instanceof CourseError || err instanceof PlanError || err instanceof CalcError || err instanceof PlanFormatError) return json({ error: err.message }, 400, cors);
      console.error('kestrel', err?.stack || String(err));
      return json({ error: 'Something went wrong on our side.' }, 500, cors);
    }
  },
};
