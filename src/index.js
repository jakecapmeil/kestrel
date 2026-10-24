// Kestrel: an open-source training platform for school running teams.
// Static files come from public/; everything under /api/ is handled here.
// Rules every route follows:
//   - who you are comes from authUser (Supabase), never from the request body;
//   - team data is read only after a membership check (member());
//   - personal data (log, PRs, predictions) is only ever the caller's own;
//   - teammates see each other's name and colour, never email.

import { authUser, AuthError } from './auth.js';
import { EVENTS, EVENT, parseTime, fmtTime } from './events.js';
import { BUILTIN, DEFAULTS, TASKS, KINDS, predictEvent, marathonPredict, validateModel, ModelError, MAX_MODEL_BYTES } from './models.js';
import { SYSTEM, coachContext, chat, spend, cleanMessages, AiError, addDays } from './ai.js';

class BadRequest extends Error {}
class NotFound extends Error {}

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const str = (v, max) => String(v ?? '').trim().slice(0, max);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const COLORS = ['#c8922a', '#2a7fc8', '#c84a2a', '#2aa57a', '#8a5ac8', '#c82a7f', '#5a8a2a', '#2a5ac8'];
const LOG_TYPES = ['easy', 'long', 'workout', 'race', 'recovery', 'cross-train', 'rest'];
const MAX_TEAMS = 10;

// A PR keeps the tenths it was entered with.
const fmtPr = (sec) => fmtTime(sec, sec < 120 || Math.round(sec * 10) % 10 !== 0);
const todayET = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());

function randomId(prefix, bytes = 9) {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return prefix + [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}
// 8 characters, no 0/O/1/I/L, from a crypto source.
function inviteCode() {
  const ABC = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  const a = crypto.getRandomValues(new Uint8Array(8));
  return [...a].map((b) => ABC[b % ABC.length]).join('');
}

async function body(request) {
  try {
    return await request.json();
  } catch {
    throw new BadRequest('Expected a JSON body.');
  }
}

// ---------- users ----------

async function loadUser(db, auth) {
  let row = await db.prepare('SELECT * FROM users WHERE id = ?').bind(auth.id).first();
  if (!row) {
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    await db.prepare('INSERT OR IGNORE INTO users (id, email, name, color, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(auth.id, auth.email, str(auth.name, 60), color, Date.now()).run();
    row = await db.prepare('SELECT * FROM users WHERE id = ?').bind(auth.id).first();
  }
  let settings = {};
  try { settings = JSON.parse(row.settings || '{}'); } catch { /* keep {} */ }
  return { ...row, settings };
}

async function me(db, user) {
  const { results: teams } = await db.prepare(
    `SELECT t.id, t.name, t.school, m.role, (SELECT COUNT(*) FROM team_members x WHERE x.team_id = t.id) AS members
     FROM teams t JOIN team_members m ON m.team_id = t.id WHERE m.user_id = ? ORDER BY m.joined_at`
  ).bind(user.id).all();
  return {
    user: { id: user.id, email: user.email, name: user.name, color: user.color, sex: user.sex, age_ok: !!user.age_ok },
    models: { ...DEFAULTS, ...(user.settings.models || {}) },
    teams,
  };
}

async function updateMe(db, user, b) {
  const name = b.name !== undefined ? str(b.name, 60) : user.name;
  const color = b.color !== undefined && /^#[0-9a-f]{6}$/i.test(b.color) ? b.color : user.color;
  const sex = b.sex !== undefined ? (['', 'f', 'm'].includes(b.sex) ? b.sex : user.sex) : user.sex;
  const ageOk = b.age_ok !== undefined ? (b.age_ok ? 1 : 0) : user.age_ok;
  const settings = { ...user.settings };
  if (b.models && typeof b.models === 'object') {
    const models = { ...(settings.models || {}) };
    for (const [task, id] of Object.entries(b.models)) {
      if (!TASKS[task]) throw new BadRequest(`Unknown task ${task}.`);
      const m = await findModel(db, user, String(id));
      if (!m) throw new BadRequest('That model does not exist or is private.');
      if (m.task !== task) throw new BadRequest(`${m.name} is a ${m.task} model, not ${task}.`);
      models[task] = m.id;
    }
    settings.models = models;
  }
  await db.prepare('UPDATE users SET name = ?, color = ?, sex = ?, age_ok = ?, settings = ? WHERE id = ?')
    .bind(name, color, sex, ageOk, JSON.stringify(settings), user.id).run();
}

// ---------- teams ----------

async function member(db, teamId, userId) {
  const row = await db.prepare('SELECT role FROM team_members WHERE team_id = ? AND user_id = ?').bind(teamId, userId).first();
  if (!row) throw new NotFound('Team not found.');
  return row.role;
}

async function teamView(db, teamId, role) {
  const team = await db.prepare('SELECT id, name, school, invite_code, created_at FROM teams WHERE id = ?').bind(teamId).first();
  const { results: members } = await db.prepare(
    'SELECT u.id, u.name, u.color, m.role FROM team_members m JOIN users u ON u.id = m.user_id WHERE m.team_id = ? ORDER BY m.role DESC, u.name'
  ).bind(teamId).all();
  return { ...team, role, members };
}

async function createTeam(db, user, b) {
  const name = str(b.name, 80);
  if (!name) throw new BadRequest('Give the team a name.');
  const n = await db.prepare('SELECT COUNT(*) AS n FROM team_members WHERE user_id = ?').bind(user.id).first();
  if (n.n >= MAX_TEAMS) throw new BadRequest(`You can be on up to ${MAX_TEAMS} teams.`);
  const id = randomId('t_');
  const now = Date.now();
  await db.batch([
    db.prepare('INSERT INTO teams (id, name, school, invite_code, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(id, name, str(b.school, 120), inviteCode(), user.id, now),
    db.prepare("INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)").bind(id, user.id, now),
  ]);
  return id;
}

async function joinTeam(db, user, code) {
  const c = str(code, 20).toUpperCase().replace(/[^0-9A-Z]/g, '');
  const team = c && await db.prepare('SELECT id FROM teams WHERE invite_code = ?').bind(c).first();
  if (!team) throw new BadRequest('No team has that invite code. Check it with whoever sent it.');
  const n = await db.prepare('SELECT COUNT(*) AS n FROM team_members WHERE user_id = ?').bind(user.id).first();
  const already = await db.prepare('SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?').bind(team.id, user.id).first();
  if (!already && n.n >= MAX_TEAMS) throw new BadRequest(`You can be on up to ${MAX_TEAMS} teams.`);
  await db.prepare("INSERT OR IGNORE INTO team_members (team_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)").bind(team.id, user.id, Date.now()).run();
  return team.id;
}

// Leaving (or being removed). The last member leaving deletes the team; an owner leaving hands it to the longest-standing member.
async function removeMember(db, teamId, userId) {
  await db.prepare('DELETE FROM team_members WHERE team_id = ? AND user_id = ?').bind(teamId, userId).run();
  const owner = await db.prepare("SELECT 1 FROM team_members WHERE team_id = ? AND role = 'owner'").bind(teamId).first();
  if (owner) return;
  const next = await db.prepare('SELECT user_id FROM team_members WHERE team_id = ? ORDER BY joined_at LIMIT 1').bind(teamId).first();
  if (next) await db.prepare("UPDATE team_members SET role = 'owner' WHERE team_id = ? AND user_id = ?").bind(teamId, next.user_id).run();
  else await db.prepare('DELETE FROM teams WHERE id = ?').bind(teamId).run();
}

function eventFields(b) {
  const date = str(b.date, 10);
  const title = str(b.title, 120);
  if (!isDate(date)) throw new BadRequest('Pick a date.');
  if (!title) throw new BadRequest('Give the event a title.');
  const type = ['practice', 'meet', 'other'].includes(b.type) ? b.type : 'practice';
  return { date, title, type, time: str(b.time, 40), location: str(b.location, 160), description: str(b.description, 2000) };
}

async function teamEvents(db, teamId, from, to) {
  const { results: events } = await db.prepare(
    'SELECT id, date, title, type, time, location, description, created_by FROM events WHERE team_id = ? AND date >= ? AND date <= ? ORDER BY date, time LIMIT 500'
  ).bind(teamId, from, to).all();
  if (!events.length) return [];
  const { results: rsvps } = await db.prepare(
    `SELECT r.event_id, r.user_id, r.status FROM rsvps r JOIN events e ON e.id = r.event_id
     WHERE e.team_id = ? AND e.date >= ? AND e.date <= ?`
  ).bind(teamId, from, to).all();
  const by = new Map(events.map((e) => [e.id, { ...e, rsvps: [] }]));
  for (const r of rsvps) by.get(r.event_id)?.rsvps.push({ user_id: r.user_id, status: r.status });
  return [...by.values()];
}

async function eventIn(db, teamId, eventId) {
  const e = await db.prepare('SELECT id, created_by FROM events WHERE id = ? AND team_id = ?').bind(eventId, teamId).first();
  if (!e) throw new NotFound('Event not found.');
  return e;
}

// ---------- training ----------

function dayFields(b) {
  const miles = Number(b.miles ?? 0);
  const minutes = Number(b.minutes ?? 0);
  if (!(miles >= 0 && miles <= 100)) throw new BadRequest('Miles must be 0-100.');
  if (!(minutes >= 0 && minutes <= 1440)) throw new BadRequest('Minutes must be 0-1440.');
  const type = LOG_TYPES.includes(b.type) ? b.type : 'easy';
  const feel = b.feel === null || b.feel === undefined || b.feel === '' ? null : Math.round(Number(b.feel));
  if (feel !== null && !(feel >= 1 && feel <= 10)) throw new BadRequest('Feel is 1-10.');
  return { miles, minutes, type, feel, notes: str(b.notes, 2000) };
}

async function userPrs(db, userId) {
  const { results } = await db.prepare('SELECT event, sec, date FROM prs WHERE user_id = ?').bind(userId).all();
  return results.filter((r) => EVENT.has(r.event)).map((r) => {
    const e = EVENT.get(r.event);
    return { key: e.key, m: e.m, surf: e.surf, steeple: !!e.steeple, sec: r.sec, date: r.date };
  });
}

// ---------- models ----------

const meta = (m) => ({
  id: m.id, name: m.name, version: m.version, kind: m.kind, task: m.task, license: m.license, description: m.description,
  trained_on: m.trained_on, builtin: !!m.builtin, owner: m.owner || 'Kestrel', visibility: m.visibility || 'public', size: m.size ?? JSON.stringify(m.weights).length,
});

async function findModel(db, user, id) {
  const b = BUILTIN.find((m) => m.id === id);
  if (b) return b;
  const row = await db.prepare('SELECT m.*, u.name AS owner FROM models m JOIN users u ON u.id = m.owner_id WHERE m.id = ?').bind(id).first();
  if (!row || (row.visibility !== 'public' && row.owner_id !== user?.id)) return null;
  const file = JSON.parse(row.body);
  return { ...file, id: row.id, owner: row.owner || 'someone', owner_id: row.owner_id, visibility: row.visibility, size: row.size };
}

async function listModels(db, user, task) {
  const { results } = await db.prepare(
    `SELECT m.id, m.name, m.version, m.kind, m.task, m.license, m.description, m.visibility, m.size, m.owner_id, m.created_at, u.name AS owner
     FROM models m JOIN users u ON u.id = m.owner_id
     WHERE (m.visibility = 'public' OR m.owner_id = ?) ${task ? 'AND m.task = ?' : ''} ORDER BY m.created_at DESC LIMIT 200`
  ).bind(...(task ? [user?.id || '', task] : [user?.id || ''])).all();
  return [
    ...BUILTIN.filter((m) => !task || m.task === task).map(meta),
    ...results.map((r) => ({ ...r, owner: r.owner || 'someone', builtin: false, mine: r.owner_id === user?.id, owner_id: undefined })),
  ];
}

async function uploadModel(db, user, request) {
  const raw = await request.text();
  if (raw.length > MAX_MODEL_BYTES + 2000) throw new BadRequest('Model files can be up to 1 MB.');
  let b;
  try { b = JSON.parse(raw); } catch { throw new BadRequest('That is not valid JSON.'); }
  const file = validateModel(b.model ?? b);
  const visibility = b.visibility === 'private' ? 'private' : 'public';
  const text = JSON.stringify(file);
  if (text.length > MAX_MODEL_BYTES) throw new BadRequest('Model files can be up to 1 MB.');
  const n = await db.prepare('SELECT COUNT(*) AS n FROM models WHERE owner_id = ?').bind(user.id).first();
  if (n.n >= 20) throw new BadRequest('You can upload up to 20 models. Delete one first.');
  const id = randomId('m_', 6);
  await db.prepare(
    'INSERT INTO models (id, owner_id, name, version, kind, task, description, license, visibility, body, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, user.id, file.name, file.version, file.kind, file.task, file.description, file.license, visibility, text, text.length, Date.now()).run();
  return id;
}

async function selectedModels(db, user) {
  const picked = { ...DEFAULTS, ...(user.settings.models || {}) };
  const out = {};
  for (const task of Object.keys(TASKS)) {
    out[task] = (await findModel(db, user, picked[task])) || BUILTIN.find((m) => m.id === DEFAULTS[task]);
  }
  return out;
}

async function predictions(db, user, today) {
  const models = await selectedModels(db, user);
  const prs = await userPrs(db, user.id);
  const rows = [];
  for (const ev of EVENTS) {
    const model = models[ev.task];
    const p = prs.length ? predictEvent(model, prs, ev, user.sex) : null;
    const pr = prs.find((x) => x.key === ev.key);
    if (!p && !pr) continue;
    rows.push({
      event: ev.key, label: ev.label, task: ev.task, model: p ? `${model.name} ${model.version}`.trim() : null,
      pr: pr ? fmtPr(pr.sec) : null,
      time: p ? fmtTime(p.sec) : null, lo: p ? fmtTime(p.lo) : null, hi: p ? fmtTime(p.hi) : null,
    });
  }
  const { results: training } = await db.prepare('SELECT date, miles, minutes, type FROM training_days WHERE user_id = ? AND date >= ?').bind(user.id, addDays(today, -112)).all();
  const mm = models.marathon;
  const mp = marathonPredict(mm.weights, training, today);
  const runDays = training.filter((d) => d.miles >= 0.6 && d.minutes > 0 && d.type !== 'cross-train').length;
  return {
    rows,
    marathon: mp
      ? { model: `${mm.name} ${mm.version}`.trim(), time: fmtTime(mp.sec), lo: fmtTime(mp.lo), hi: fmtTime(mp.hi), run_days: mp.run_days }
      : { model: `${mm.name} ${mm.version}`.trim(), needs: `Log 15 running days with miles and minutes in the last 16 weeks (you have ${runDays}).` },
    models: Object.fromEntries(Object.entries(models).map(([t, m]) => [t, { id: m.id, name: m.name, version: m.version }])),
  };
}

// ---------- router ----------

async function api(request, env, url) {
  const db = env.DB;
  const path = url.pathname.replace(/\/+$/, '');
  const method = request.method;
  const parts = path.split('/').slice(2); // after /api

  if (path === '/api/config') {
    return json({ supabaseUrl: env.SUPABASE_URL || '', supabaseKey: env.SUPABASE_KEY || '', events: EVENTS, tasks: TASKS, kinds: KINDS, logTypes: LOG_TYPES, defaultAi: !!(env.GEMINI_API_KEY || env.AI) });
  }

  // Model files are public downloads (open weights); private uploads need their owner.
  if (parts[0] === 'models' && method === 'GET' && parts.length > 1 && url.searchParams.get('download') === '1') {
    let viewer = null;
    try { viewer = await authUser(request, env); } catch { /* anonymous download of public models */ }
    const m = await findModel(db, viewer, parts.slice(1).join('/'));
    if (!m) throw new NotFound('Model not found.');
    const file = { kestrel: 1, name: m.name, version: m.version, kind: m.kind, task: m.task, license: m.license, description: m.description, trained_on: m.trained_on, weights: m.weights };
    return new Response(JSON.stringify(file), { headers: { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="${(m.name + '-' + (m.version || 'model')).replace(/[^\w.-]+/g, '_')}.json"` } });
  }

  const auth = await authUser(request, env);
  const user = await loadUser(db, auth);
  const today = todayET();

  if (path === '/api/me') {
    if (method === 'GET') return json(await me(db, user));
    if (method === 'PUT') { await updateMe(db, user, await body(request)); return json(await me(db, await loadUser(db, auth))); }
    if (method === 'DELETE') {
      const { results } = await db.prepare('SELECT team_id FROM team_members WHERE user_id = ?').bind(user.id).all();
      for (const t of results) await removeMember(db, t.team_id, user.id);
      // Teams this user started live on under their current owner (teams.created_by must point at a real user).
      await db.prepare(
        "UPDATE teams SET created_by = (SELECT user_id FROM team_members WHERE team_id = teams.id AND role = 'owner') WHERE created_by = ?"
      ).bind(user.id).run();
      await db.prepare('DELETE FROM users WHERE id = ?').bind(user.id).run();
      return json({ ok: true });
    }
  }
  if (!user.age_ok && path !== '/api/me') throw new BadRequest('Confirm your age in your profile first.');

  // Teams
  if (path === '/api/teams' && method === 'POST') return json({ id: await createTeam(db, user, await body(request)) });
  if (path === '/api/teams/join' && method === 'POST') return json({ id: await joinTeam(db, user, (await body(request)).code) });
  if (parts[0] === 'teams' && parts[1]) {
    const teamId = parts[1];
    const role = await member(db, teamId, user.id);
    const sub = parts[2];
    const owner = role === 'owner';
    if (!sub) {
      if (method === 'GET') return json(await teamView(db, teamId, role));
      if (method === 'PUT') {
        if (!owner) throw new BadRequest('Only the team owner can rename the team.');
        const b = await body(request);
        const name = str(b.name, 80);
        if (!name) throw new BadRequest('Give the team a name.');
        await db.prepare('UPDATE teams SET name = ?, school = ? WHERE id = ?').bind(name, str(b.school, 120), teamId).run();
        return json(await teamView(db, teamId, role));
      }
    }
    if (sub === 'code' && method === 'POST') {
      if (!owner) throw new BadRequest('Only the team owner can make a new invite code.');
      await db.prepare('UPDATE teams SET invite_code = ? WHERE id = ?').bind(inviteCode(), teamId).run();
      return json(await teamView(db, teamId, role));
    }
    if (sub === 'members' && parts[3] && method === 'DELETE') {
      const target = parts[3];
      if (target !== user.id && !owner) throw new BadRequest('Only the team owner can remove someone.');
      await removeMember(db, teamId, target);
      return json({ ok: true });
    }
    if (sub === 'events') {
      if (!parts[3]) {
        if (method === 'GET') {
          const from = isDate(url.searchParams.get('from')) ? url.searchParams.get('from') : addDays(today, -31);
          const to = isDate(url.searchParams.get('to')) ? url.searchParams.get('to') : addDays(today, 62);
          return json({ events: await teamEvents(db, teamId, from, to) });
        }
        if (method === 'POST') {
          const f = eventFields(await body(request));
          const id = randomId('e_');
          await db.prepare('INSERT INTO events (id, team_id, date, title, type, time, location, description, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .bind(id, teamId, f.date, f.title, f.type, f.time, f.location, f.description, user.id, Date.now()).run();
          return json({ id });
        }
      } else {
        const e = await eventIn(db, teamId, parts[3]);
        if (parts[4] === 'rsvp' && method === 'PUT') {
          const status = (await body(request)).status;
          if (status === 'going' || status === 'not_going') {
            await db.prepare('INSERT INTO rsvps (event_id, user_id, status) VALUES (?, ?, ?) ON CONFLICT(event_id, user_id) DO UPDATE SET status = excluded.status').bind(e.id, user.id, status).run();
          } else {
            await db.prepare('DELETE FROM rsvps WHERE event_id = ? AND user_id = ?').bind(e.id, user.id).run();
          }
          return json({ ok: true });
        }
        if (e.created_by !== user.id && !owner) throw new BadRequest('Only whoever added the event, or the team owner, can change it.');
        if (method === 'PUT') {
          const f = eventFields(await body(request));
          await db.prepare('UPDATE events SET date = ?, title = ?, type = ?, time = ?, location = ?, description = ? WHERE id = ?')
            .bind(f.date, f.title, f.type, f.time, f.location, f.description, e.id).run();
          return json({ ok: true });
        }
        if (method === 'DELETE') { await db.prepare('DELETE FROM events WHERE id = ?').bind(e.id).run(); return json({ ok: true }); }
      }
    }
    if (sub === 'posts') {
      if (!parts[3] && method === 'GET') {
        const { results } = await db.prepare('SELECT id, user_id, body, created_at FROM posts WHERE team_id = ? ORDER BY created_at DESC LIMIT 50').bind(teamId).all();
        return json({ posts: results });
      }
      if (!parts[3] && method === 'POST') {
        const text = str((await body(request)).body, 2000);
        if (!text) throw new BadRequest('Write something first.');
        const id = randomId('p_');
        await db.prepare('INSERT INTO posts (id, team_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)').bind(id, teamId, user.id, text, Date.now()).run();
        return json({ id });
      }
      if (parts[3] && method === 'DELETE') {
        const p = await db.prepare('SELECT user_id FROM posts WHERE id = ? AND team_id = ?').bind(parts[3], teamId).first();
        if (!p) throw new NotFound('Post not found.');
        if (p.user_id !== user.id && !owner) throw new BadRequest('Only the author or the team owner can delete a post.');
        await db.prepare('DELETE FROM posts WHERE id = ?').bind(parts[3]).run();
        return json({ ok: true });
      }
    }
  }

  // Training log (always the caller's own)
  if (path === '/api/log' && method === 'GET') {
    const from = isDate(url.searchParams.get('from')) ? url.searchParams.get('from') : addDays(today, -56);
    const to = isDate(url.searchParams.get('to')) ? url.searchParams.get('to') : today;
    const { results } = await db.prepare('SELECT date, miles, minutes, type, feel, notes FROM training_days WHERE user_id = ? AND date >= ? AND date <= ? ORDER BY date DESC').bind(user.id, from, to).all();
    return json({ days: results, today });
  }
  if (parts[0] === 'log' && parts[1]) {
    const date = parts[1];
    if (!isDate(date)) throw new BadRequest('Bad date.');
    if (method === 'PUT') {
      const f = dayFields(await body(request));
      await db.prepare(
        `INSERT INTO training_days (user_id, date, miles, minutes, type, feel, notes) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, date) DO UPDATE SET miles = excluded.miles, minutes = excluded.minutes, type = excluded.type, feel = excluded.feel, notes = excluded.notes`
      ).bind(user.id, date, f.miles, f.minutes, f.type, f.feel, f.notes).run();
      return json({ ok: true });
    }
    if (method === 'DELETE') { await db.prepare('DELETE FROM training_days WHERE user_id = ? AND date = ?').bind(user.id, date).run(); return json({ ok: true }); }
  }

  // PRs
  if (path === '/api/prs' && method === 'GET') return json({ prs: (await userPrs(db, user.id)).map((p) => ({ event: p.key, time: fmtPr(p.sec), date: p.date })) });
  if (path === '/api/prs' && method === 'PUT') {
    const b = await body(request);
    const ev = EVENT.get(b.event);
    if (!ev) throw new BadRequest('Pick an event.');
    const sec = parseTime(b.time);
    // Rough world-record floor and a generous ceiling, to catch typos.
    const floor = ev.m / 10.5;
    if (!(sec >= floor && sec <= ev.m / 1.2)) throw new BadRequest(`That time does not look right for ${ev.label} (use m:ss, e.g. 5:12.4).`);
    const date = isDate(b.date) ? b.date : '';
    await db.prepare('INSERT INTO prs (user_id, event, sec, date) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, event) DO UPDATE SET sec = excluded.sec, date = excluded.date')
      .bind(user.id, ev.key, sec, date).run();
    return json({ ok: true });
  }
  if (parts[0] === 'prs' && parts[1] && method === 'DELETE') {
    await db.prepare('DELETE FROM prs WHERE user_id = ? AND event = ?').bind(user.id, parts[1]).run();
    return json({ ok: true });
  }
  if (path === '/api/predictions' && method === 'GET') return json(await predictions(db, user, today));

  // Model hub
  if (path === '/api/models' && method === 'GET') {
    const task = TASKS[url.searchParams.get('task')] ? url.searchParams.get('task') : '';
    return json({ models: await listModels(db, user, task) });
  }
  if (path === '/api/models' && method === 'POST') return json({ id: await uploadModel(db, user, request) });
  if (parts[0] === 'models' && parts[1]) {
    const id = parts.slice(1).join('/');
    if (method === 'GET') {
      const m = await findModel(db, user, id);
      if (!m) throw new NotFound('Model not found.');
      return json({ model: { ...meta(m), mine: m.owner_id === user.id } });
    }
    if (method === 'DELETE') {
      const r = await db.prepare('DELETE FROM models WHERE id = ? AND owner_id = ?').bind(id, user.id).run();
      if (!r.meta.changes) throw new NotFound('Model not found.');
      return json({ ok: true });
    }
  }

  // Kestrel AI
  if (path === '/api/ai/context' && method === 'GET') {
    const p = await predictions(db, user, today);
    return json({ system: SYSTEM, context: await coachContext(db, user, today, compactPredictions(p)) });
  }
  if (path === '/api/ai/chat' && method === 'POST') {
    const messages = cleanMessages((await body(request)).messages);
    await spend(db, user.id, today, Number(env.AI_DAILY_LIMIT) || 40);
    const p = await predictions(db, user, today);
    const ctx = await coachContext(db, user, today, compactPredictions(p));
    return json(await chat(env, `${SYSTEM}\n\nATHLETE DATA (JSON):\n${JSON.stringify(ctx)}`, messages));
  }

  throw new NotFound('No such API route.');
}

const compactPredictions = (p) => ({
  events: p.rows.filter((r) => r.time).map((r) => ({ event: r.label, predicted: r.time, range_80: `${r.lo}-${r.hi}`, pr: r.pr || undefined, model: r.model })),
  marathon: p.marathon.time ? { predicted: p.marathon.time, range_80: `${p.marathon.lo}-${p.marathon.hi}`, model: p.marathon.model } : p.marathon.needs,
});

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      return await api(request, env, url);
    } catch (err) {
      if (err instanceof AuthError) return json({ error: err.message, auth: true }, 401);
      if (err instanceof BadRequest || err instanceof ModelError || err instanceof AiError) return json({ error: err.message }, 400);
      if (err instanceof NotFound) return json({ error: err.message }, 404);
      console.error('kestrel', err?.stack || String(err));
      return json({ error: 'Something went wrong on our side.' }, 500);
    }
  },
};
