// Conditions: the heat and hills behind a run, and what they cost. Used for
// a run's difficulty and to credit races and hard runs back to what they'd
// be worth on a flat course in good weather (Fitness States).
//
//   Heat: Mark Hadley's temperature + dew point chart (°F), the usual coaching
//   table: nothing up to 100, about 1% at 120, 3% at 140, 6% at 160, 10% at
//   180. It's for continuous running; reps of a mile or less pay about half.
//   Hills: on a loop each foot climbed costs about 1.5 ft of flat running
//   (Kellogg: ~18 s per 100 ft up at 8:00 pace, about half of it back on the
//   way down).
//   Van Cortlandt: the park's 5K (Cemetery Hill, the Back Hills, gravel and
//   grass) runs about 5.5% slower than a track 5000, about a minute for an
//   18-minute runner (coaches' rule of thumb, and Hawks runners' own VC vs
//   track times). The watch only sees ~150 ft of climbing there, so the
//   course gets its own factor instead of the hill formula.
//   Other cross-country races: 2.5% for grass and turns, plus their hills.

export const VC_FACTOR = 1.055;
export const XC_FACTOR = 1.025;
const HILL_K = 1.5;
const HEAT = [[100, 0], [110, 0.005], [120, 0.01], [130, 0.02], [140, 0.03], [150, 0.045], [160, 0.06], [170, 0.08], [180, 0.1], [200, 0.14]];

// Weather is read for the team's home ground (Bronx/Manhattan).
const HOME = { lat: 40.85, lon: -73.9 };
const DAY = 86400000;

// Van Cortlandt Park's footprint (Bronx), with a little margin. A run's GPS
// start inside it is at the park; outside it never is, whatever the name says.
export function inVanCortlandt(lat, lon) {
  return lat >= 40.884 && lat <= 40.915 && lon >= -73.909 && lon <= -73.871;
}

export const VC_RE = /van\s*cort?land|\bvcp\b|vannie|tortoise\s*(&|and)\s*(the\s*)?hare/i;

// Fraction slower than ideal weather.
export function heatCost(tempF, dewF) {
  if (tempF == null || dewF == null) return 0;
  const sum = tempF + dewF;
  if (sum <= HEAT[0][0]) return 0;
  for (let i = 1; i < HEAT.length; i++) {
    const [x0, y0] = HEAT[i - 1];
    const [x1, y1] = HEAT[i];
    if (sum <= x1) return y0 + ((y1 - y0) * (sum - x0)) / (x1 - x0);
  }
  return HEAT[HEAT.length - 1][1];
}

// Fraction slower than flat ground.
export function hillCost(elevFt, miles) {
  if (!(elevFt > 0 && miles > 0.3)) return 0;
  return Math.min(0.12, (HILL_K * elevFt) / (miles * 5280));
}

const ftPerMile = (w) => (w.elev_gain_ft != null && w.distance_mi > 0.3 ? w.elev_gain_ft / w.distance_mi : null);
const eventText = (e) => [e.title, e.location, e.description, e.loc_name].filter(Boolean).join(' ');

// Where a run was raced: 'vc' (Van Cortlandt), 'xc' (another cross-country
// meet) or '' (road, track, anywhere flat). Meets at the park are often
// labelled "Van Cortlandt Park - Track & Field", so the track and flat runs
// are ruled out first.
export function courseOf(w, events = []) {
  if (w.surface === 'track') return '';
  // A run named after the park is there. Otherwise Hawky's read of it (from
  // the run and the day's calendar) decides, then the rules below.
  // GPS settles it when the watch recorded a position: at the park, or not.
  if (w.gps_vc === 1) return 'vc';
  const notVc = w.gps_vc === 0;
  if (!notVc && VC_RE.test(w.name || '')) return 'vc';
  if (w.course === 'xc' || (w.course === 'vc' && !notVc)) return w.course;
  if (w.course === 'flat') return '';
  const fpm = ftPerMile(w);
  if (fpm != null && fpm < 20) return '';
  const here = events.filter((e) => e.date === w.date);
  if (!notVc && here.some((e) => VC_RE.test(eventText(e)))) return 'vc';
  if (/\bxc\b|cross.?country/i.test(w.name || '')) return 'xc';
  if (here.some((e) => e.type === 'meet') && fpm != null) return 'xc';
  return '';
}

const fmtF = (f) => `${Math.round(f)}°F`;

// What a run's time is worth on a flat course in good weather: divide by factor.
export function conditionsOf(w, events = [], { reps = false } = {}) {
  const course = courseOf(w, events);
  const heat = heatCost(w.temp_f, w.dew_point_f) * (reps ? 0.5 : 1);
  const hill = course === 'vc' || w.surface === 'track' ? 0 : hillCost(w.elev_gain_ft, w.distance_mi);
  const factor = (course === 'vc' ? VC_FACTOR : course === 'xc' ? XC_FACTOR : 1) * (1 + hill) * (1 + heat);
  const parts = [
    course === 'vc' ? 'Van Cortlandt course' : course === 'xc' ? 'cross-country course' : '',
    hill >= 0.005 ? `${Math.round(w.elev_gain_ft)} ft of climbing` : '',
    heat >= 0.005 ? `${fmtF(w.temp_f)}, dew point ${fmtF(w.dew_point_f)}` : '',
  ].filter(Boolean);
  return { course, heat, hill, factor, note: parts.join(', ') };
}

// Difficulty points heat and hills add on top of heart rate (0-3): heat
// dehydrates and climbing and descending load the legs in ways average HR
// doesn't fully show. About +1 for each 3% of heat cost and each 60 ft/mi.
export function conditionsBump(w) {
  const heat = heatCost(w.temp_f, w.dew_point_f);
  const fpm = w.surface === 'track' ? 0 : ftPerMile(w) || 0;
  return Math.max(0, Math.min(3, Math.round(heat / 0.03 + fpm / 60)));
}

// ------------------------------------------------------------------ weather

const addDays = (dateKey, n) => new Date(Date.parse(dateKey + 'T12:00:00Z') + n * DAY).toISOString().slice(0, 10);

async function hourly(base, from, to) {
  const url = `${base}?latitude=${HOME.lat}&longitude=${HOME.lon}&hourly=temperature_2m,dew_point_2m&temperature_unit=fahrenheit`
    + `&timezone=America%2FNew_York&start_date=${from}&end_date=${to}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`open-meteo ${res.status}`);
  const j = await res.json();
  const out = new Map();
  (j?.hourly?.time || []).forEach((t, i) => {
    const temp = j.hourly.temperature_2m?.[i];
    const dew = j.hourly.dew_point_2m?.[i];
    if (Number.isFinite(temp) && Number.isFinite(dew)) out.set(t, { temp_f: Math.round(temp * 10) / 10, dew_point_f: Math.round(dew * 10) / 10 });
  });
  return out;
}

// The hour a run was mostly in: start plus half its length (no start time:
// mid-afternoon, when practice is).
function hourKey(w) {
  const m = String(w.start_local || '').match(/^(\d{1,2}):(\d{2})/);
  let min = m ? Number(m[1]) * 60 + Number(m[2]) + (w.elapsed_sec || w.moving_sec || 0) / 120 : 16 * 60;
  min = Math.min(23 * 60, Math.round(min / 60) * 60);
  return `${w.date}T${String(min / 60).padStart(2, '0')}:00`;
}

// Temperature and dew point for each run ({date, start_local, ...}), in the
// same order; null where there's no reading. At most two requests: the
// archive has everything up to a few days ago, the forecast API the last week.
export async function weatherFor(runs, today) {
  const dates = runs.map((w) => w.date).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '') && d <= today).sort();
  if (!dates.length) return runs.map(() => null);
  const cut = addDays(today, -7);
  const recent = dates.filter((d) => d >= cut);
  // Older runs: the newest two years of them per call.
  const old = dates.filter((d) => d < cut && d >= addDays(dates.filter((x) => x < cut).pop() || cut, -730));
  const hours = new Map();
  const get = async (base, list) => {
    if (!list.length) return;
    try {
      for (const [k, v] of await hourly(base, list[0], list[list.length - 1])) hours.set(k, v);
    } catch (err) {
      console.log('weather lookup failed', err.message);
    }
  };
  await get('https://api.open-meteo.com/v1/forecast', recent);
  await get('https://archive-api.open-meteo.com/v1/archive', old);
  return runs.map((w) => (w.date && w.date <= today ? hours.get(hourKey(w)) || null : null));
}
