// GPS routes. A run's route is fetched from intervals.icu the first time someone opens it, downsampled to a few
// hundred points and cached in run_tracks, so syncing stays light. Only the runner can read their own routes:
// they are never part of a team view (a route shows where someone lives, and many athletes are minors).
// Runs that came through the Claude connectors carry no GPS, so they have no route.
import { credentials, IntervalsError } from './intervals.js';

const MAX_POINTS = 400;
const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;

function metres(a, b) {
  const dLat = rad(b[0] - a[0]);
  const dLon = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// intervals.icu sends latlng as two parallel arrays (data = latitudes, data2 = longitudes), or as pairs.
function pairsOf(st) {
  const a = st?.data;
  const b = st?.data2;
  if (Array.isArray(a) && Array.isArray(b)) return a.map((lat, i) => [lat, b[i]]);
  return Array.isArray(a) ? a.map((p) => (Array.isArray(p) ? [p[0], p[1]] : [null, null])) : [];
}

export function buildTrack(streams) {
  const list = Array.isArray(streams) ? streams : streams?.streams || [];
  const by = (type) => list.find((x) => x?.type === type);
  const ll = pairsOf(by('latlng'));
  const alt = by('altitude')?.data || by('fixed_altitude')?.data || [];
  const time = by('time')?.data || [];
  const raw = [];
  ll.forEach((p, i) => {
    if (Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) > 0.01 && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180) {
      raw.push([p[0], p[1], Number.isFinite(alt[i]) ? alt[i] : null, Number.isFinite(time[i]) ? time[i] : null]);
    }
  });
  if (raw.length < 5) return null;
  const step = Math.max(1, Math.ceil(raw.length / MAX_POINTS));
  const pts = raw.filter((_, i) => i % step === 0 || i === raw.length - 1)
    .map(([lat, lon, a, t]) => [Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5, a == null ? null : Math.round(a * 10) / 10, t]);
  return { pts };
}

// Distance, climb and the box around the route, from the stored points.
export function trackStats(pts) {
  let dist = 0;
  let gain = 0;
  let loss = 0;
  let lastAlt = null;
  const b = { s: 90, n: -90, w: 180, e: -180 };
  pts.forEach((p, i) => {
    if (i) dist += metres(pts[i - 1], p);
    if (p[2] != null) {
      // A little hysteresis: a watch's altitude jitters by a metre or two.
      if (lastAlt == null) lastAlt = p[2];
      else if (Math.abs(p[2] - lastAlt) >= 2) { if (p[2] > lastAlt) gain += p[2] - lastAlt; else loss += lastAlt - p[2]; lastAlt = p[2]; }
    }
    b.s = Math.min(b.s, p[0]); b.n = Math.max(b.n, p[0]); b.w = Math.min(b.w, p[1]); b.e = Math.max(b.e, p[1]);
  });
  const alts = pts.map((p) => p[2]).filter((a) => a != null);
  return {
    distance_m: Math.round(dist), gain_m: Math.round(gain), loss_m: Math.round(loss),
    min_alt_m: alts.length ? Math.min(...alts) : null, max_alt_m: alts.length ? Math.max(...alts) : null,
    bounds: b,
  };
}

// The route of one of the runner's runs. Null when the run has no GPS (a connector run, or an indoor one).
export async function getTrack(env, personId, stravaId) {
  const db = env.DB;
  const run = await db.prepare('SELECT strava_id FROM workouts WHERE person_id = ? AND strava_id = ?').bind(personId, stravaId).first();
  if (!run) return { error: 'not_found' };
  const cached = await db.prepare('SELECT points FROM run_tracks WHERE person_id = ? AND strava_id = ?').bind(personId, stravaId).first();
  let pts = null;
  if (cached) {
    try { pts = JSON.parse(cached.points).pts; } catch { /* refetch */ }
  }
  if (!pts) {
    if (!stravaId.startsWith('intervals:')) return { error: 'no_gps', note: 'This run came through a connector, which does not send GPS. Runs synced from a watch through intervals.icu have a route.' };
    let creds;
    try { creds = await credentials(env, personId); } catch (e) { return { error: 'no_gps', note: e instanceof IntervalsError ? e.message : 'Connect your watch to see routes.' }; }
    const res = await fetch(`${creds.base}/activity/${encodeURIComponent(stravaId.slice('intervals:'.length))}/streams?types=latlng,altitude,time`, {
      headers: { Authorization: 'Basic ' + btoa('API_KEY:' + creds.key), Accept: 'application/json' },
    });
    if (res.status === 404) return { error: 'no_gps', note: 'intervals.icu has no GPS for this run.' };
    if (!res.ok) return { error: 'unavailable', note: `intervals.icu answered ${res.status}. Try again in a minute.` };
    const built = buildTrack(await res.json());
    if (!built) return { error: 'no_gps', note: 'This run has no GPS points (a treadmill or track run, or the watch had no signal).' };
    pts = built.pts;
    await db.prepare('INSERT OR REPLACE INTO run_tracks (person_id, strava_id, points, created_at) VALUES (?, ?, ?, ?)')
      .bind(personId, stravaId, JSON.stringify({ pts }), Date.now()).run();
  }
  return { pts, stats: trackStats(pts) };
}
