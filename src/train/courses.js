// Courses: named places people race (Van Cortlandt, Franklin Park, ...), and PRs on them.
//
//   A course PR is stored in people.prs under "course:<id>:<metres>" ("course:vc:5000" is the 5K at Van Cortlandt),
//   next to the standard events. A race on a course updates its course PR and, for a 5K, the generic "XC 5K" too.
//   It never touches a track PR.
//
//   Built-in courses ship here, user-added ones live in the courses table. Only a course with `geo` is matched
//   from GPS; every other course is chosen by hand on the run (or from the calendar event) because Kestrel does
//   not guess where a park is. Elevation is not stored on a course: it is read off the runs people tagged there
//   (courseStats), so it is real rather than remembered.

import { VC_FACTOR } from './conditions.js';

const MILE = 1609.344;
export const MAX_CUSTOM_COURSES = 25;

// Distances people race on a course, offered when tracking one. Metres.
export const COURSE_DISTANCES = [
  { m: 2000, label: '2K' }, { m: 3000, label: '3K' }, { m: 4000, label: '4K' }, { m: 5000, label: '5K' }, { m: 6000, label: '6K' },
  { m: 8000, label: '8K' }, { m: 10000, label: '10K' },
  { m: Math.round(2 * MILE), label: '2 mi' }, { m: Math.round(2.5 * MILE), label: '2.5 mi' }, { m: Math.round(3 * MILE), label: '3 mi' },
  { m: Math.round(4 * MILE), label: '4 mi' },
];

// `geo` is a start-position box [south, north, west, east]. Add one only when the bounds are verified.
export const BUILTIN_COURSES = [
  { id: 'vc', name: 'Van Cortlandt Park', place: 'Bronx, NY', distances: [5000, 4023], factor: VC_FACTOR, geo: [40.884, 40.915, -73.909, -73.871] },
  { id: 'franklin-park', name: 'Franklin Park', place: 'Boston, MA', distances: [5000] },
  { id: 'sunken-meadow', name: 'Sunken Meadow State Park', place: 'Kings Park, NY', distances: [5000] },
  { id: 'bethpage', name: 'Bethpage State Park', place: 'Farmingdale, NY', distances: [5000] },
  { id: 'belmont-plateau', name: 'Belmont Plateau', place: 'Philadelphia, PA', distances: [5000] },
  { id: 'genesee-valley', name: 'Genesee Valley Park', place: 'Rochester, NY', distances: [5000] },
  { id: 'panorama-farms', name: 'Panorama Farms', place: 'Earlysville, VA', distances: [5000, 8000] },
  { id: 'burke-golf', name: 'Burke Memorial Golf Course', place: 'South Bend, IN', distances: [6000, 10000] },
  { id: 'gibson', name: 'LaVern Gibson Championship Course', place: 'Terre Haute, IN', distances: [5000, 6000, 8000, 10000] },
  { id: 'mt-sac', name: 'Mt. SAC Cross Country Course', place: 'Walnut, CA', distances: [5000] },
  { id: 'woodward-park', name: 'Woodward Park', place: 'Fresno, CA', distances: [5000] },
  { id: 'stanford-golf', name: 'Stanford Golf Course', place: 'Stanford, CA', distances: [5000, 8000] },
  { id: 'portland-meadows', name: 'Portland Meadows', place: 'Portland, OR', distances: [5000] },
].map((c) => ({ ...c, builtin: true }));

const BUILTIN = new Map(BUILTIN_COURSES.map((c) => [c.id, c]));

// ------------------------------------------------------------------ keys

// "course:vc:5000" -> { id: 'vc', m: 5000 }; anything else -> null.
export function parseCourseKey(key) {
  const m = /^course:([a-z0-9-]{1,40}):(\d{3,6})$/.exec(String(key || ''));
  return m ? { id: m[1], m: Number(m[2]) } : null;
}
export const courseKey = (id, m) => `course:${id}:${Math.round(m)}`;

// PR keys that predate courses: the 2.5 mile PR was Van Cortlandt's.
const LEGACY = { 'VC 2.5 mi': courseKey('vc', Math.round(2.5 * MILE)) };

// A PR blob with legacy keys renamed. A key already in the new form wins.
export function normalizePrs(prs) {
  const out = {};
  for (const [k, v] of Object.entries(prs || {})) if (!LEGACY[k]) out[k] = v;
  for (const [k, v] of Object.entries(prs || {})) if (LEGACY[k] && !out[LEGACY[k]]) out[LEGACY[k]] = v;
  return out;
}

export const labelOfDistance = (m) => {
  const hit = COURSE_DISTANCES.find((d) => d.m === Math.round(m));
  if (hit) return hit.label;
  return m >= 1000 ? `${Math.round(m / 100) / 10}K` : `${Math.round(m)} m`;
};

export function courseLabel(course, m) {
  return `${labelOfDistance(m)} at ${course?.name || 'a course'}`;
}

// ------------------------------------------------------------------ geo

// The course a run's GPS start is in. Only courses with verified bounds can match.
export function courseAt(lat, lon) {
  for (const c of BUILTIN_COURSES) {
    if (!c.geo) continue;
    const [s, n, w, e] = c.geo;
    if (lat >= s && lat <= n && lon >= w && lon <= e) return c.id;
  }
  return '';
}

// ------------------------------------------------------------------ storage

const parseDistances = (raw) => {
  try {
    const a = JSON.parse(raw || '[]');
    return Array.isArray(a) ? a.map(Number).filter((n) => Number.isFinite(n) && n >= 100 && n <= 100000).map(Math.round) : [];
  } catch { return []; }
};

const shape = (r) => ({ id: r.id, name: r.name, place: r.place, distances: parseDistances(r.distances), builtin: false, mine: !!r.mine });

// Built-in courses plus everything people added. `me` marks the ones you added (so you can see them first).
export async function listCourses(db, personId) {
  const { results } = await db.prepare(
    'SELECT id, name, place, distances, created_by = ? AS mine FROM courses ORDER BY name COLLATE NOCASE LIMIT 500'
  ).bind(personId).all();
  return [...BUILTIN_COURSES.map((c) => ({ ...c, geo: undefined, has_gps: !!c.geo })), ...results.map(shape)];
}

// One course by id, built-in or added. Null when it does not exist.
export async function getCourse(db, id) {
  if (BUILTIN.has(id)) return BUILTIN.get(id);
  const r = await db.prepare('SELECT id, name, place, distances FROM courses WHERE id = ?').bind(id).first();
  return r ? shape(r) : null;
}

// id -> course for the ids given (what a person's PRs and runs refer to).
export async function coursesById(db, ids) {
  const out = new Map();
  const custom = [];
  for (const id of new Set(ids)) {
    if (BUILTIN.has(id)) out.set(id, BUILTIN.get(id));
    else if (/^[a-z0-9-]{1,40}$/.test(id)) custom.push(id);
  }
  for (let i = 0; i < custom.length; i += 90) {
    const chunk = custom.slice(i, i + 90);
    const { results } = await db.prepare(`SELECT id, name, place, distances FROM courses WHERE id IN (${chunk.map(() => '?').join(',')})`).bind(...chunk).all();
    for (const r of results) out.set(r.id, shape(r));
  }
  return out;
}

const slug = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);

export class CourseError extends Error {}

// Adds a course. A course with the same name and place already in the catalogue is returned instead of duplicated.
export async function createCourse(db, personId, { name, place, distances }) {
  name = String(name ?? '').trim().replace(/\s+/g, ' ').slice(0, 80);
  place = String(place ?? '').trim().replace(/\s+/g, ' ').slice(0, 80);
  if (name.length < 3) throw new CourseError('Give the course a name (at least 3 letters).');
  const base = slug(name);
  if (!base) throw new CourseError('Course names need letters or numbers.');
  const dist = [...new Set((Array.isArray(distances) ? distances : []).map(Number).filter((n) => Number.isFinite(n) && n >= 400 && n <= 50000).map(Math.round))].slice(0, 6);
  const same = BUILTIN_COURSES.find((c) => slug(c.name) === base)
    || await db.prepare('SELECT id, name, place, distances FROM courses WHERE lower(name) = lower(?) AND lower(place) = lower(?)').bind(name, place).first();
  if (same) return { course: same.builtin ? same : shape(same), existing: true };
  const mine = (await db.prepare('SELECT COUNT(*) AS n FROM courses WHERE created_by = ?').bind(personId).first())?.n || 0;
  if (mine >= MAX_CUSTOM_COURSES) throw new CourseError(`You have added ${MAX_CUSTOM_COURSES} courses already. Pick one that is there, or ask for one to be removed.`);
  let id = `${base}-${Math.random().toString(36).slice(2, 6)}`;
  if (BUILTIN.has(id)) id += 'x';
  await db.prepare('INSERT INTO courses (id, name, place, distances, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, name, place, JSON.stringify(dist.length ? dist : [5000]), personId, Date.now()).run();
  return { course: { id, name, place, distances: dist.length ? dist : [5000], builtin: false, mine: true }, existing: false };
}

// ------------------------------------------------------------------ tracked distances

// The (course, distance) pairs a runner follows: "my 5K at Van Cortlandt". Stored in people.settings.courses.
// Until they choose, Van Cortlandt's two courses show (what Kestrel always showed).
const DEFAULT_TRACKED = [{ course: 'vc', m: 5000 }, { course: 'vc', m: 4023 }];

export function trackedOf(settings) {
  const raw = settings?.courses;
  if (!Array.isArray(raw)) return DEFAULT_TRACKED;
  return raw.filter((t) => t && typeof t.course === 'string' && Number.isFinite(t.m)).map((t) => ({ course: t.course, m: Math.round(t.m) })).slice(0, 20);
}

export async function setTracked(db, personId, list) {
  const clean = [];
  for (const t of Array.isArray(list) ? list : []) {
    const m = Math.round(Number(t?.m));
    const id = String(t?.course ?? '');
    if (!Number.isFinite(m) || m < 400 || m > 50000) throw new CourseError('Distances run from 400 m to 50 km.');
    if (clean.some((c) => c.course === id && c.m === m)) continue;
    if (!(await getCourse(db, id))) throw new CourseError('That course is not in the list.');
    clean.push({ course: id, m });
  }
  if (clean.length > 20) throw new CourseError('Follow at most 20 courses.');
  const row = await db.prepare('SELECT settings FROM people WHERE id = ?').bind(personId).first();
  if (!row) throw new CourseError('Unknown person');
  let s = {};
  try { s = JSON.parse(row.settings || '{}') || {}; } catch { /* start fresh */ }
  s.courses = clean;
  await db.prepare('UPDATE people SET settings = ? WHERE id = ?').bind(JSON.stringify(s), personId).run();
  return clean;
}

// ------------------------------------------------------------------ elevation, from the runs

// What runs on a course show, across everyone who tagged one there: median climb per mile and the number of
// runs. Only given once three or more runs agree; below that it is one person's watch, not the course.
export async function courseStats(db, ids) {
  const out = {};
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    const { results } = await db.prepare(
      `SELECT course_id, elev_gain_ft, distance_mi FROM workouts
       WHERE course_id IN (${chunk.map(() => '?').join(',')}) AND elev_gain_ft IS NOT NULL AND distance_mi BETWEEN 1.2 AND 7`
    ).bind(...chunk).all();
    const by = {};
    for (const r of results) (by[r.course_id] ||= []).push(r.elev_gain_ft / r.distance_mi);
    for (const [id, a] of Object.entries(by)) {
      if (a.length < 3) continue;
      a.sort((x, y) => x - y);
      out[id] = { runs: a.length, climb_ft_per_mi: Math.round(a[Math.floor(a.length / 2)]) };
    }
  }
  return out;
}
