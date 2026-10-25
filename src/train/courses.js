// Courses: named places people race (Van Cortlandt, Franklin Park, ...), and PRs on them.
//
//   A course PR is stored in people.prs under "course:<id>:<metres>" ("course:vc:5000" is the 5K at Van Cortlandt),
//   next to the standard events. A race on a course updates its course PR only: there is no generic XC PR,
//   and a track PR is never touched.
//
//   Built-in courses ship here with GPS bounds, so a run that starts inside one is matched to it; user-added courses
//   live in the courses table and are chosen by hand on the run. Elevation is not stored on a course: it is read off
//   the runs people tagged there (courseStats), so it is real rather than remembered.

import { VC_FACTOR, VC_RE } from './conditions.js';

const MILE = 1609.344;
export const MAX_CUSTOM_COURSES = 25;

// Distances people race on a course, offered when tracking one. Metres.
export const COURSE_DISTANCES = [
  { m: 2000, label: '2K' }, { m: 3000, label: '3K' }, { m: 4000, label: '4K' }, { m: 5000, label: '5K' }, { m: 6000, label: '6K' },
  { m: 8000, label: '8K' }, { m: 10000, label: '10K' },
  { m: Math.round(2 * MILE), label: '2 mi' }, { m: Math.round(2.5 * MILE), label: '2.5 mi' }, { m: Math.round(3 * MILE), label: '3 mi' },
  { m: Math.round(4 * MILE), label: '4 mi' },
];

// Every course below was checked against a published source: a championship or invitational held there, or the
// venue's own page. `geo` is a start-position box [south, north, west, east]: the venue's OpenStreetMap bounds with
// a little margin (Panorama Farms: Cvillepedia's coordinates, +-0.012 degrees). A run that starts inside one is
// matched to that course from its GPS. Add a course here only with a source and a box you have looked at.
// `distances` are the ones raced there (metres): NCAA courses 6K and 8K/10K, high school courses a 5K or 3 miles.
const M3 = 4828;
export const BUILTIN_COURSES = [
  { id: 'vc', name: 'Van Cortlandt Park', place: 'Bronx, NY', distances: [5000, 4023], factor: VC_FACTOR, geo: [40.884, 40.915, -73.909, -73.871] },
  { id: 'franklin-park', name: 'Franklin Park', place: 'Boston, MA', distances: [5000], geo: [42.291, 42.315, -71.109, -71.083] },
  { id: 'sunken-meadow', name: 'Sunken Meadow State Park', place: 'Kings Park, NY', distances: [5000], geo: [40.885, 40.921, -73.289, -73.229] },
  { id: 'bethpage', name: 'Bethpage State Park', place: 'Farmingdale, NY', distances: [5000], geo: [40.732, 40.764, -73.479, -73.431] },
  { id: 'belmont-plateau', name: 'Belmont Plateau', place: 'Philadelphia, PA', distances: [3000, 5000, 8000], geo: [39.9834, 39.9974, -75.2196, -75.2056] },
  { id: 'genesee-valley', name: 'Genesee Valley Park', place: 'Rochester, NY', distances: [M3, 5000], geo: [43.101, 43.131, -77.665, -77.628] },
  { id: 'chenango-valley', name: 'Chenango Valley State Park', place: 'Binghamton, NY', distances: [5000], geo: [42.196, 42.238, -75.851, -75.81] },
  { id: 'holmdel-park', name: 'Holmdel Park', place: 'Holmdel, NJ', distances: [5000], geo: [40.363, 40.386, -74.196, -74.177] },
  { id: 'wickham-park', name: 'Wickham Park', place: 'Manchester, CT', distances: [5000], geo: [41.778, 41.795, -72.587, -72.566] },
  { id: 'covered-bridge', name: 'Covered Bridge Trail (Ponaganset HS)', place: 'Glocester, RI', distances: [5000], geo: [41.855, 41.875, -71.724, -71.705] },
  { id: 'bull-run', name: 'Hereford High School (Bull Run)', place: 'Parkton, MD', distances: [M3], geo: [39.591, 39.607, -76.668, -76.652] },
  { id: 'panorama-farms', name: 'Panorama Farms', place: 'Earlysville, VA', distances: [5000, 6000, 8000, 10000], geo: [38.1105, 38.1345, -78.5067, -78.4827] },
  { id: 'apalachee', name: 'Apalachee Regional Park', place: 'Tallahassee, FL', distances: [6000, 8000, 10000], geo: [30.416, 30.434, -84.162, -84.145] },
  { id: 'percy-warner', name: 'Percy Warner Park', place: 'Nashville, TN', distances: [5000], geo: [36.048, 36.089, -86.907, -86.864] },
  { id: 'gibson', name: 'LaVern Gibson Championship Course', place: 'Terre Haute, IN', distances: [5000, 6000, 8000, 10000], geo: [39.45, 39.464, -87.27, -87.257] },
  { id: 'burke-golf', name: 'Burke Golf Course (Notre Dame)', place: 'Notre Dame, IN', distances: [5000, 8000], geo: [41.692, 41.702, -86.253, -86.242] },
  { id: 'detweiller', name: 'Detweiller Park', place: 'Peoria, IL', distances: [M3], geo: [40.78, 40.8, -89.6, -89.575] },
  { id: 'zimmer', name: 'Thomas Zimmer Championship Course', place: 'Madison, WI', distances: [6000, 8000, 10000], geo: [43.014, 43.025, -89.556, -89.541] },
  { id: 'obetz', name: 'Fortress Obetz', place: 'Obetz, OH', distances: [5000], geo: [39.881, 39.892, -82.95, -82.939] },
  { id: 'gans-creek', name: 'Gans Creek Cross Country Course', place: 'Columbia, MO', distances: [6000, 8000, 10000], geo: [38.88, 38.892, -92.298, -92.285] },
  { id: 'greiner-osu', name: 'Greiner Family Cross Country Course (Oklahoma State)', place: 'Stillwater, OK', distances: [6000, 8000, 10000], geo: [36.13, 36.147, -97.085, -97.071] },
  { id: 'old-settlers', name: 'Old Settlers Park', place: 'Round Rock, TX', distances: [5000], geo: [30.527, 30.549, -97.637, -97.612] },
  { id: 'mt-sac', name: 'Mt. SAC Cross Country Course', place: 'Walnut, CA', distances: [M3, 5000], geo: [34.036, 34.056, -117.852, -117.831] },
  { id: 'woodward-park', name: 'Woodward Park', place: 'Fresno, CA', distances: [5000], geo: [36.858, 36.876, -119.794, -119.777] },
  { id: 'stanford-golf', name: 'Stanford Golf Course', place: 'Stanford, CA', distances: [5000, 6000, 8000], geo: [37.414, 37.433, -122.194, -122.177] },
  { id: 'morley-field', name: 'Morley Field (Balboa Park)', place: 'San Diego, CA', distances: [5000], geo: [32.733, 32.743, -117.146, -117.132] },
  { id: 'glendoveer', name: 'Glendoveer Golf Course', place: 'Portland, OR', distances: [5000], geo: [45.524, 45.536, -122.53, -122.506] },
  { id: 'sun-willows', name: 'Sun Willows Golf Course', place: 'Pasco, WA', distances: [5000], geo: [46.246, 46.258, -119.117, -119.099] },
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

// "XC 5K" was a PR of its own, always raced at Van Cortlandt unless it named another meet. Those become the 5K at
// Van Cortlandt; one that names some other meet has no course to move to, so it stays where it is (it still counts
// toward fitness, it just is not listed).
const isVcXc5k = (v) => !v?.meet || VC_RE.test(v.meet) || /^Found by (Kestrel|Hawks|Kessler)(: Van Cortlandt)?$/i.test(v.meet);

// A PR blob with legacy keys renamed. A key already in the new form wins.
export function normalizePrs(prs) {
  const out = {};
  const vc5k = courseKey('vc', 5000);
  for (const [k, v] of Object.entries(prs || {})) if (!LEGACY[k] && !(k === 'XC 5K' && isVcXc5k(v))) out[k] = v;
  for (const [k, v] of Object.entries(prs || {})) {
    if (LEGACY[k] && !out[LEGACY[k]]) out[LEGACY[k]] = v;
    if (k === 'XC 5K' && isVcXc5k(v) && !out[vc5k]) out[vc5k] = v;
  }
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
  if (mine >= MAX_CUSTOM_COURSES) throw new CourseError(`You have added ${MAX_CUSTOM_COURSES} courses already. Pick one that is already in the list.`);
  let id = `${base}-${Math.random().toString(36).slice(2, 6)}`;
  if (BUILTIN.has(id)) id += 'x';
  await db.prepare('INSERT INTO courses (id, name, place, distances, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, name, place, JSON.stringify(dist.length ? dist : [5000]), personId, Date.now()).run();
  return { course: { id, name, place, distances: dist.length ? dist : [5000], builtin: false, mine: true }, existing: false };
}

// ------------------------------------------------------------------ tracked distances

// The (course, distance) pairs a runner follows: "my 5K at Van Cortlandt". Stored in people.settings.courses.
// Until they choose, Van Cortlandt's two courses show, but only for a runner who already has a PR there (the course
// Kestrel started with). Everyone else starts with none and adds the courses their team races on.
const DEFAULT_TRACKED = [{ course: 'vc', m: 5000 }, { course: 'vc', m: 4023 }];

// prs: the runner's normalized PRs. Leave it out to get the old default for everyone.
export function trackedOf(settings, prs) {
  const raw = settings?.courses;
  if (!Array.isArray(raw)) return !prs || Object.keys(prs).some((k) => k.startsWith('course:vc:')) ? DEFAULT_TRACKED : [];
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
