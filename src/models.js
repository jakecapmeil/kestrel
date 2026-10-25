// Kestrel model engine. A model is a JSON file: { kestrel: 1, name, version, kind, task, license, description, trained_on, weights }.
// Models are data, never code: each kind has one evaluator here, and uploads are checked by validateModel before they are stored.
//
// Kinds (and the task slot each fills):
//   lite-trees      race      HawksPredict-Lite format: boosted trees over a log-seconds residual on a weighted-Riegel baseline.
//   short-pairs     short     HawksPredict-Short format: log-log lines between event pairs, inverse-variance combined.
//   marathon-trees  marathon  HawksPredict-Marathon format: boosted trees over 16 weeks of training features.
//   riegel          race | short   t2 = t1 * (d2/d1)^exponent from the nearest PR, with a log-SD for the range.
//
// The evaluators are the Hawks ones (src/pacemodel.js, src/shortmodel.js, src/marathon.js) with the model passed in;
// scripts/check-models.mjs proves they give the same numbers on the built-in files.

import LITE from '../models/hawkspredict-lite.json' with { type: 'json' };
import SHORT from '../models/hawkspredict-short.json' with { type: 'json' };
import MARATHON from '../models/hawkspredict-marathon.json' with { type: 'json' };
import RIEGEL from '../models/riegel.json' with { type: 'json' };
import VDOT from '../models/vdot.json' with { type: 'json' };
import TANDA from '../models/tanda-2011.json' with { type: 'json' };
import VC_FLAT from '../models/vc-flat-factor.json' with { type: 'json' };

// The platform's name, in one place. Server text uses it directly; /api/config hands it to the browser.
export const PLATFORM_NAME = 'Kestrel Lab';

export const BUILTIN = [LITE, SHORT, MARATHON, RIEGEL, VDOT, TANDA, VC_FLAT].map((m) => ({ ...m, id: `kestrel/${m.slug}`, builtin: true }));

// Courses that can have their own models. Add one here, name it in conditions.js (courseOf), and ship a default
// `course-transfer` model for it; athletes can then pick a model per course.
export const COURSES = {
  vc: { label: 'Van Cortlandt Park', blurb: 'The Bronx cross-country course: Cemetery Hill, the Back Hills, gravel and grass.' },
};

// PURPOSES are the places in the app where a model does a job. A published model declares exactly one (its `task`),
// and an athlete picks one model per purpose. `model: false` purposes are not weight files: coaching is powered by
// a provider (free Gemini, your own key, or a local model) chosen in Providers, never stored with a model.
export const PURPOSES = {
  race: { group: 'Predict', label: 'Race times, 800 m and up (track, cross country, road)', model: true },
  short: { group: 'Predict', label: 'Sprints, 400-1000 m and steeplechase', model: true },
  marathon: { group: 'Predict', label: 'Marathon from your last 16 weeks of training', model: true },
  ...Object.fromEntries(Object.entries(COURSES).map(([k, c]) => [k, { group: 'Course', label: `${c.label}: what a flat-course time is worth here`, model: true, course: k }])),
  coach: { group: 'Coach', label: 'Coaching chat and run reports', model: false },
};
// The purposes a weights file can fill.
export const TASKS = Object.fromEntries(Object.entries(PURPOSES).filter(([, p]) => p.model).map(([k, p]) => [k, p.label]));
export const DEFAULTS = {
  race: 'kestrel/hawkspredict-lite', short: 'kestrel/hawkspredict-short', marathon: 'kestrel/hawkspredict-marathon',
  vc: 'kestrel/vc-flat-factor',
};
export const KINDS = {
  'lite-trees': ['race'], 'short-pairs': ['short'], 'marathon-trees': ['marathon'], riegel: ['race', 'short'],
  vdot: ['race'], tanda: ['marathon'], 'course-transfer': Object.keys(COURSES),
};
export const LITE_FEATS = LITE.weights.feats;
export const MARATHON_FEATS = MARATHON.weights.feats;

const Z80 = 1.2816;
const KM_PER_MI = 1.609344;

// ---------- lite-trees ----------

const K = 1.06;
const REFS = [400, 800, 1500, 3000, 5000, 6000, 8000, 21097.5];
const LREFS = REFS.map(Math.log);
const SURF = { xc: 0, track: 1, indoor: 2, road: 3 };

const bucketOf = (m) => {
  let best = 0;
  for (let i = 1; i < REFS.length; i++) if (Math.abs(LREFS[i] - Math.log(m)) < Math.abs(LREFS[best] - Math.log(m))) best = i;
  return best;
};

export function liteFeatures(results, target) {
  const f = {};
  for (const k of LITE_FEATS) f[k] = NaN;
  const lt = Math.log(target.m);
  f.log_d = lt;
  f.surf = SURF[target.surf] ?? 0;
  f.male = target.male ? 1 : 0;
  f.n_results = results.length;
  if (!results.length) return f;
  const bk = results.map((r) => bucketOf(r.m));
  const buckets = [...new Set(bk)].sort((a, b) => a - b);
  const preds = [];
  const ws = [];
  for (const b of buckets) {
    const ref = REFS[b];
    let adj = Infinity;
    results.forEach((r, i) => { if (bk[i] === b) adj = Math.min(adj, r.sec * Math.pow(ref / r.m, K)); });
    const p = Math.log(adj * Math.pow(target.m / ref, K));
    f['p' + Math.trunc(ref)] = p;
    preds.push(p);
    ws.push(1 / (0.15 + Math.abs(Math.log(target.m / ref))));
  }
  let sw = 0;
  let sp = 0;
  let near = 0;
  preds.forEach((p, i) => { sw += ws[i]; sp += p * ws[i]; if (ws[i] > ws[near]) near = i; });
  f.base = sp / sw;
  f.base_near = preds[near];
  f.base_best = Math.min(...preds);
  const xs = [];
  const ys = [];
  for (const b of buckets) {
    let j = -1;
    results.forEach((r, i) => { if (bk[i] === b && (j < 0 || r.sec < results[j].sec)) j = i; });
    xs.push(Math.log(results[j].m));
    ys.push(Math.log(results[j].sec));
  }
  f.n_buckets = xs.length;
  if (xs.length >= 2) {
    const span = Math.max(...xs) - Math.min(...xs);
    f.span = span;
    if (span >= 0.4) {
      const xm = xs.reduce((a, b) => a + b, 0) / xs.length;
      const ym = ys.reduce((a, b) => a + b, 0) / ys.length;
      let sxy = 0;
      let sxx = 0;
      xs.forEach((x, i) => { sxy += (x - xm) * (ys[i] - ym); sxx += (x - xm) * (x - xm); });
      const k = Math.min(Math.max(sxy / sxx, 0.95), 1.25);
      f.k_ind = k;
      let i = 0;
      xs.forEach((x, n) => { if (Math.abs(x - lt) < Math.abs(xs[i] - lt)) i = n; });
      f.base_slope = ys[i] + k * (lt - xs[i]);
    }
  }
  let ns = 0;
  let bs = Infinity;
  for (const r of results) {
    if (r.surf !== target.surf) continue;
    ns++;
    bs = Math.min(bs, Math.log(r.sec) + K * (lt - Math.log(r.m)));
  }
  f.n_samesurf = ns;
  if (ns) f.best_samesurf = bs;
  return f;
}

// Sum of the trees' leaves for feature vector x (feature lookup by index).
function treesSum(w, x) {
  let s = w.init;
  for (const t of w.trees) {
    let n = 0;
    while (t.f[n] >= 0) {
      const v = x[t.f[n]];
      const left = Number.isNaN(v) ? t.mgl[n] === 1 : v <= t.t[n];
      n = left ? t.l[n] : t.r[n];
    }
    s += t.v[n];
  }
  return s;
}

const distGroup = (m) => (m <= 1700 ? 0 : m <= 4100 ? 1 : m <= 7000 ? 2 : 3);

function liteOne(w, results, target) {
  const f = liteFeatures(results, target);
  if (!Number.isFinite(f.base)) return null;
  const logSec = f.base + treesSum(w, w.feats.map((k) => f[k]));
  const key = `${Math.min(f.n_buckets || 0, 3)}|${distGroup(target.m)}`;
  const [q10, q90] = w.interval[key] || w.interval['1|0'];
  return { sec: Math.exp(logSec), lo: Math.exp(logSec + q10), hi: Math.exp(logSec + q90) };
}

// ---------- short-pairs ----------

// A result of m metres as a short-model source (event key + seconds), or null.
function shortSource(w, m, sec) {
  if (Math.abs(m - 1600) / 1600 < 0.01 && w.events['1609']) return { ev: '1609', sec: sec * Math.pow(1609.344 / 1600, 1.06) };
  if (Math.abs(m - 3200) / 3200 < 0.01 && w.events['3000']) return { ev: '3000', sec: sec * Math.pow(3000 / 3200, 1.06) };
  for (const [ev, meters] of Object.entries(w.events)) {
    if (ev.startsWith('S')) continue;
    if (Math.abs(m - meters) / meters < 0.015) return { ev, sec };
  }
  return null;
}

function shortMu(w, pairs, sources, target, male) {
  const tm = w.events[target];
  const near = sources
    .filter((s) => s.ev !== target && pairs.has(`${s.ev}>${target}`))
    .sort((a, b) => Math.abs(Math.log(w.events[a.ev] / tm)) - Math.abs(Math.log(w.events[b.ev] / tm)))
    .slice(0, 3);
  if (!near.length) return null;
  let sw = 0;
  let sp = 0;
  for (const s of near) {
    const p = pairs.get(`${s.ev}>${target}`);
    const wt = 1 / (p.sd * p.sd);
    sw += wt;
    sp += wt * (p.a + p.b * Math.log(s.sec) + p.c * male);
  }
  const first = near[0];
  const srcSd = (first.extra || 0) * Math.abs(pairs.get(`${first.ev}>${target}`).b);
  const sd = Math.sqrt((Math.sqrt(1 / sw) * w.infl) ** 2 + srcSd ** 2);
  return { mu: sp / sw, sd };
}

function shortPredict(w, sources, target, sex) {
  const pairs = new Map(w.pairs.map((p) => [`${p.s}>${p.t}`, p]));
  const extra = w.extra_sd?.[target] || 0;
  const one = (male) => shortMu(w, pairs, sources, target, male);
  let mu;
  let sd;
  if (sex) {
    const r = one(sex === 'm' ? 1 : 0);
    if (!r) return null;
    mu = r.mu;
    sd = Math.sqrt(r.sd ** 2 + extra * extra);
  } else {
    // Sex not given: run both and average; the gap between them widens the range.
    const a = one(0);
    const b = one(1);
    if (!a || !b) return null;
    mu = (a.mu + b.mu) / 2;
    sd = Math.sqrt(((a.sd + b.sd) / 2) ** 2 + ((a.mu - b.mu) / 2) ** 2 + extra * extra);
  }
  return { sec: Math.exp(mu), lo: Math.exp(mu - Z80 * sd), hi: Math.exp(mu + Z80 * sd) };
}

// Short-model key for a Kestrel event (null when the model has no such event).
function shortKey(w, ev) {
  if (ev.steeple) return w.events[ev.key] ? ev.key : null;
  const s = shortSource(w, ev.m, 1);
  return s && Math.abs(w.events[s.ev] - ev.m) / ev.m < 0.015 ? s.ev : null;
}

// ---------- marathon-trees ----------

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};
const quantile = (a, q) => {
  const s = [...a].sort((x, y) => x - y);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  return lo + 1 < s.length ? s[lo] + (s[lo + 1] - s[lo]) * (pos - lo) : s[lo];
};

// days: [{ off (days before today, 1..112), km, min }]
export function marathonFeatures(days) {
  const MARA = 42.195;
  const run = days.filter((d) => d.km >= 1.0);
  if (run.length < 15) return null;
  const pace = run.map((d) => d.min / d.km);
  const wk = new Array(16).fill(0);
  for (const d of days) wk[Math.floor((d.off - 1) / 7)] += d.km;
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const eff = run.map((d, i) => d.km >= 8 && d.km <= 25 && pace[i] > 2.6 && pace[i] < 8);
  const riegel = run.map((d) => d.min * Math.pow(MARA / d.km, 1.06));
  const bestOf = (flags) => {
    let best = Infinity;
    run.forEach((d, i) => { if (flags(d, i) && riegel[i] < best) best = riegel[i]; });
    return best === Infinity ? NaN : Math.log(best * 60);
  };
  const longIdx = run.map((d, i) => (d.km >= 16 ? i : -1)).filter((i) => i >= 0);
  return {
    wk_mean: sum(wk) / 16,
    wk_max: Math.max(...wk),
    wk_last6: sum(wk.slice(0, 6)) / 6,
    longest: Math.max(...run.map((d) => d.km)),
    long_n: run.filter((d) => d.km >= 25).length,
    long16_n: longIdx.length,
    runs_wk: run.length / 16,
    weeks_active: wk.filter((x) => x > 0).length,
    pace_med: median(pace),
    pace_p10: quantile(pace, 0.1),
    pace_long: longIdx.length ? median(longIdx.map((i) => pace[i])) : NaN,
    best_riegel: bestOf((d, i) => eff[i]),
    n_eff: eff.filter(Boolean).length,
    best_recent: bestOf((d, i) => eff[i] && d.off <= 42),
    vol_trend: (sum(wk.slice(0, 6)) / 6) / Math.max(sum(wk.slice(6)) / 10, 1.0),
  };
}

const dayNumber = (key) => Math.floor(Date.parse(key + 'T12:00:00Z') / 86400000);

// training: [{ date, miles, minutes }]
export function marathonPredict(w, training, today) {
  const t0 = dayNumber(today);
  const byDay = new Map();
  for (const d of training) {
    if (!(d.miles > 0 && d.minutes > 0) || d.type === 'cross-train') continue;
    const off = t0 - dayNumber(d.date);
    if (off < 1 || off > 112) continue;
    const e = byDay.get(off) || { off, km: 0, min: 0 };
    e.km += d.miles * KM_PER_MI;
    e.min += d.minutes;
    byDay.set(off, e);
  }
  const f = marathonFeatures([...byDay.values()]);
  if (!f) return null;
  const g = Number.isNaN(f.best_riegel) ? 'g0' : f.wk_mean < 40 ? 'g1' : f.wk_mean < 70 ? 'g2' : 'g3';
  const iv = w.interval[g] || w.interval.g1;
  const mu = treesSum(w, w.feats.map((k) => f[k]));
  return { sec: Math.exp(mu), lo: Math.exp(mu + iv[0]), hi: Math.exp(mu + iv[1]), feats: f, run_days: [...byDay.values()].filter((d) => d.km >= 1).length };
}

// ---------- riegel ----------

function riegelPredict(w, results, target) {
  let best = null;
  for (const r of results) {
    const d = Math.abs(Math.log(target.m / r.m));
    if (!best || d < best.d) best = { r, d };
  }
  if (!best) return null;
  const mu = Math.log(best.r.sec) + w.exponent * Math.log(target.m / best.r.m);
  const sd = w.sd * (1 + best.d);
  return { sec: Math.exp(mu), lo: Math.exp(mu - Z80 * sd), hi: Math.exp(mu + Z80 * sd) };
}

// ---------- vdot ----------

// Daniels & Gilbert (1979): oxygen cost of running at v m/min, and the fraction of VO2max a runner holds for t minutes.
const vo2At = (v) => -4.6 + 0.182258 * v + 0.000104 * v * v;
const pctAt = (t) => 0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t);
const vdotOf = (m, sec) => vo2At(m / (sec / 60)) / pctAt(sec / 60);

// Seconds for `m` metres at a given VDOT: vdotOf falls as time grows, so bisect.
function vdotTime(vdot, m) {
  let lo = 60 * 0.5;
  let hi = 60 * 600;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (vdotOf(m, mid) > vdot) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

function vdotPredict(w, results, target) {
  let best = null;
  for (const r of results) {
    const d = Math.abs(Math.log(target.m / r.m));
    if (!best || d < best.d) best = { r, d };
  }
  if (!best) return null;
  const mu = Math.log(vdotTime(vdotOf(best.r.m, best.r.sec), target.m));
  const sd = w.sd * (1 + best.d);
  return { sec: Math.exp(mu), lo: Math.exp(mu - Z80 * sd), hi: Math.exp(mu + Z80 * sd) };
}

// ---------- tanda ----------

// Tanda (2011): marathon pace (s/km) = a + b e^(-c K) + d P, from K = mean weekly km and P = mean training pace
// (s/km) over the 8 weeks before the race. Fitted on 22 runners at 2:47-3:36, so it answers nothing outside that.
export function tandaPredict(w, training, today) {
  const t0 = dayNumber(today);
  let km = 0;
  let min = 0;
  let longest = 0;
  const days = new Set();
  for (const d of training) {
    if (!(d.miles > 0 && d.minutes > 0) || d.type === 'cross-train') continue;
    const off = t0 - dayNumber(d.date);
    if (off < 1 || off > w.weeks * 7) continue;
    km += d.miles * KM_PER_MI;
    min += d.minutes;
    longest = Math.max(longest, d.miles * KM_PER_MI);
    days.add(off);
  }
  if (days.size < w.min_days) return null;
  const K = km / w.weeks;
  const P = (min * 60) / km;
  const sec = (w.a + w.b * Math.exp(-w.c * K) + w.d * P) * 42.195;
  if (sec < w.range_sec[0] || sec > w.range_sec[1]) return null;
  return { sec, lo: sec - Z80 * w.see_sec, hi: sec + Z80 * w.see_sec, feats: { wk_mean: K, longest }, run_days: days.size, tanda: { km_per_week: K, pace_s_per_km: P } };
}

// ---------- course-transfer ----------

// ln t_course = a + b ln t_flat + c male. toFlat undoes it. sex '' uses c/2.
const courseLine = (w, sex) => ({ a: w.a, b: w.b, c: w.c * (sex === 'm' ? 1 : sex === 'f' ? 0 : 0.5) });
export function toCourse(w, flatSec, sex = '') {
  const l = courseLine(w, sex);
  return Math.exp(l.a + l.b * Math.log(flatSec) + l.c);
}
export function toFlat(w, courseSec, sex = '') {
  const l = courseLine(w, sex);
  return Math.exp((Math.log(courseSec) - l.a - l.c) / l.b);
}

// ---------- one entry point ----------

// prs: [{ m, sec, surf, key }] the athlete's PRs; ev: an EVENTS entry; sex: '', 'f' or 'm'.
export function predictEvent(model, prs, ev, sex) {
  const w = model.weights;
  const others = prs.filter((p) => p.key !== ev.key);
  if (!others.length) return null;
  if (model.kind === 'riegel') return riegelPredict(w, others, ev);
  if (model.kind === 'vdot') return vdotPredict(w, others.filter((p) => !p.steeple), ev);
  if (model.kind === 'lite-trees') {
    const results = others.filter((p) => !p.steeple);
    if (!results.length) return null;
    if (sex) return liteOne(w, results, { m: ev.m, surf: ev.surf, male: sex === 'm' });
    // Sex not given: geometric mean of both, the wider range.
    const a = liteOne(w, results, { m: ev.m, surf: ev.surf, male: 0 });
    const b = liteOne(w, results, { m: ev.m, surf: ev.surf, male: 1 });
    if (!a || !b) return null;
    return { sec: Math.sqrt(a.sec * b.sec), lo: Math.min(a.lo, b.lo), hi: Math.max(a.hi, b.hi) };
  }
  if (model.kind === 'short-pairs') {
    const target = shortKey(w, ev);
    if (!target) return null;
    const sources = others.filter((p) => !p.steeple && p.surf !== 'xc' && p.surf !== 'road').map((p) => shortSource(w, p.m, p.sec)).filter(Boolean);
    return shortPredict(w, sources, target, sex);
  }
  return null;
}

// ---------- upload validation ----------

export class ModelError extends Error {}
export const MAX_MODEL_BYTES = 1_000_000;

const num = (x) => typeof x === 'number' && Number.isFinite(x);
const int = (x, lo, hi) => Number.isInteger(x) && x >= lo && x < hi;
const text = (x, max) => typeof x === 'string' && x.length <= max;

function checkTrees(w, feats) {
  if (!Array.isArray(w.feats) || w.feats.length !== feats.length || w.feats.some((f, i) => f !== feats[i])) {
    throw new ModelError(`weights.feats must be exactly the built-in feature list: ${feats.join(', ')}`);
  }
  if (!num(w.init)) throw new ModelError('weights.init must be a number');
  if (!Array.isArray(w.trees) || !w.trees.length || w.trees.length > 2000) throw new ModelError('weights.trees must be 1-2000 trees');
  for (const [i, t] of w.trees.entries()) {
    const n = t?.f?.length;
    if (!int(n, 1, 4097)) throw new ModelError(`tree ${i}: 1-4096 nodes`);
    for (const k of ['t', 'l', 'r', 'v', 'mgl']) if (!Array.isArray(t[k]) || t[k].length !== n) throw new ModelError(`tree ${i}: ${k} must have ${n} entries`);
    for (let j = 0; j < n; j++) {
      if (!int(t.f[j], -1, feats.length)) throw new ModelError(`tree ${i} node ${j}: bad feature index`);
      if (!num(t.v[j]) || !num(t.t[j])) throw new ModelError(`tree ${i} node ${j}: values must be numbers`);
      if (t.f[j] >= 0) {
        // Children always come after their parent, so every walk ends.
        if (!int(t.l[j], j + 1, n) || !int(t.r[j], j + 1, n)) throw new ModelError(`tree ${i} node ${j}: children must point forward`);
        if (t.mgl[j] !== 0 && t.mgl[j] !== 1) throw new ModelError(`tree ${i} node ${j}: mgl must be 0 or 1`);
      }
    }
  }
  if (!w.interval || typeof w.interval !== 'object') throw new ModelError('weights.interval is required');
  for (const [k, v] of Object.entries(w.interval)) {
    if (!Array.isArray(v) || !num(v[0]) || !num(v[1]) || v[0] > 0 || v[1] < 0) throw new ModelError(`interval ${k}: [low offset <= 0, high offset >= 0]`);
  }
}

// Returns the cleaned model (only known fields kept) or throws ModelError.
export function validateModel(m) {
  if (!m || typeof m !== 'object' || m.kestrel !== 1) throw new ModelError('Not a Kestrel model file (needs "kestrel": 1)');
  if (!text(m.name, 60) || !m.name.trim()) throw new ModelError('name: 1-60 characters');
  if (!KINDS[m.kind]) throw new ModelError(`kind must be one of: ${Object.keys(KINDS).join(', ')}`);
  if (!KINDS[m.kind].includes(m.task)) throw new ModelError(`a ${m.kind} model can only be used for: ${KINDS[m.kind].join(', ')}`);
  for (const k of ['version', 'license']) if (m[k] !== undefined && !text(m[k], 60)) throw new ModelError(`${k}: up to 60 characters`);
  for (const k of ['description', 'trained_on']) if (m[k] !== undefined && !text(m[k], 2000)) throw new ModelError(`${k}: up to 2000 characters`);
  const w = m.weights;
  if (!w || typeof w !== 'object') throw new ModelError('weights is required');
  if (m.kind === 'lite-trees') checkTrees(w, LITE_FEATS);
  if (m.kind === 'marathon-trees') checkTrees(w, MARATHON_FEATS);
  if (m.kind === 'vdot') {
    if (!num(w.sd) || w.sd <= 0 || w.sd > 0.5) throw new ModelError('weights.sd must be above 0 and at most 0.5');
  }
  if (m.kind === 'tanda') {
    for (const k of ['a', 'b', 'c', 'd', 'see_sec']) if (!num(w[k])) throw new ModelError(`weights.${k} must be a number`);
    if (w.c <= 0 || w.see_sec <= 0 || w.see_sec > 3600) throw new ModelError('weights.c and weights.see_sec must be above 0 (see_sec at most 3600)');
    if (!int(w.weeks, 1, 17)) throw new ModelError('weights.weeks: 1-16');
    if (!int(w.min_days, 1, 113)) throw new ModelError('weights.min_days: 1-112');
    if (!Array.isArray(w.range_sec) || w.range_sec.length !== 2 || !w.range_sec.every(num) || w.range_sec[0] <= 0 || w.range_sec[0] >= w.range_sec[1]) throw new ModelError('weights.range_sec: [shortest, longest] marathon seconds the model is valid for');
  }
  if (m.kind === 'course-transfer') {
    if (![w.a, w.b, w.c].every(num)) throw new ModelError('weights.a, b and c must be numbers');
    if (w.b < 0.5 || w.b > 1.5) throw new ModelError('weights.b must be 0.5-1.5');
    if (Math.abs(w.a) > 2 || Math.abs(w.c) > 0.5) throw new ModelError('weights.a must be within +-2 and weights.c within +-0.5');
    // A course is never faster than the flat: refuse a line that makes a slow runner's course time shorter than the flat time.
    if (toCourse(w, 600, 'm') < 600 * 0.9 || toCourse(w, 1800, 'f') > 1800 * 1.5) throw new ModelError('That line gives implausible course times (outside 0.9x-1.5x the flat time)');
  }
  if (m.kind === 'riegel') {
    if (!num(w.exponent) || w.exponent < 0.9 || w.exponent > 1.3) throw new ModelError('weights.exponent must be 0.9-1.3');
    if (!num(w.sd) || w.sd <= 0 || w.sd > 0.5) throw new ModelError('weights.sd must be above 0 and at most 0.5');
  }
  if (m.kind === 'short-pairs') {
    if (!num(w.infl) || w.infl <= 0 || w.infl > 5) throw new ModelError('weights.infl must be above 0 and at most 5');
    if (!w.events || typeof w.events !== 'object' || Object.keys(w.events).length > 40) throw new ModelError('weights.events: up to 40 events');
    for (const [k, v] of Object.entries(w.events)) if (!text(k, 10) || !num(v) || v <= 0 || v > 50000) throw new ModelError(`event ${k}: metres must be 1-50000`);
    if (!Array.isArray(w.pairs) || !w.pairs.length || w.pairs.length > 2000) throw new ModelError('weights.pairs: 1-2000 pairs');
    for (const p of w.pairs) {
      if (!(p.s in w.events) || !(p.t in w.events)) throw new ModelError('every pair needs s and t from weights.events');
      if (![p.a, p.b, p.c, p.sd].every(num) || p.sd <= 0) throw new ModelError(`pair ${p.s}>${p.t}: a, b, c, sd must be numbers, sd above 0`);
    }
    if (w.extra_sd !== undefined) for (const v of Object.values(w.extra_sd)) if (!num(v) || v < 0) throw new ModelError('extra_sd values must be numbers >= 0');
  }
  return {
    kestrel: 1, name: m.name.trim(), version: m.version || '', kind: m.kind, task: m.task,
    license: m.license || '', description: m.description || '', trained_on: m.trained_on || '', weights: w,
  };
}

// ---------- adapters for the training engine (train/fitness.js) ----------
// The fitness engine calls race models the way it called HawksPredict. modelSet() returns those calls
// for whichever models an athlete picked in Kestrel Lab, so any published model of the right task can
// stand in for HawksPredict-Lite, -Short or -Marathon.

// The built-in Short model's events, used for event keys whatever model is picked.
export const SHORT_METERS = SHORT.weights.events;
const BY_ID = new Map(BUILTIN.map((m) => [m.id, m]));

// A short-model event key for a result of m metres (1600 and 3200 are scaled to the mile and 3000).
function shortSourceIn(events, m, sec) {
  if (Math.abs(m - 1600) / 1600 < 0.01 && events['1609']) return { ev: '1609', sec: sec * Math.pow(1609.344 / 1600, 1.06) };
  if (Math.abs(m - 3200) / 3200 < 0.01 && events['3000']) return { ev: '3000', sec: sec * Math.pow(3000 / 3200, 1.06) };
  for (const [ev, meters] of Object.entries(events)) {
    if (ev.startsWith('S')) continue;
    if (Math.abs(m - meters) / meters < 0.015) return { ev, sec };
  }
  return null;
}

export function modelSet(picked = {}, sex = '') {
  const race = picked.race || BY_ID.get(DEFAULTS.race);
  const short = picked.short || BY_ID.get(DEFAULTS.short);
  const marathon = picked.marathon || BY_ID.get(DEFAULTS.marathon);
  const courses = Object.fromEntries(Object.keys(COURSES).map((k) => [k, picked[k] || BY_ID.get(DEFAULTS[k])]));
  const shortEvents = short.kind === 'short-pairs' ? short.weights.events : SHORT_METERS;
  const label = (m) => ({ name: m.name, version: m.version || '' });

  // results: [{ m, sec, surf }]  target: { m, surf } -> { sec, lo, hi, buckets } | null
  function raceAny(results, target) {
    const clean = (results || []).filter((r) => r && r.m > 0 && r.sec > 0);
    if (!clean.length) return null;
    if (race.kind === 'riegel') { const r = riegelPredict(race.weights, clean, target); return r && { ...r, buckets: 1 }; }
    if (race.kind === 'vdot') { const r = vdotPredict(race.weights, clean, target); return r && { ...r, buckets: 1 }; }
    const one = (male) => liteOne(race.weights, clean, { ...target, male });
    const buckets = liteFeatures(clean, target).n_buckets;
    if (sex) { const r = one(sex === 'm' ? 1 : 0); return r && { ...r, buckets }; }
    const a = one(0);
    const b = one(1);
    if (!a || !b) return null;
    return { sec: Math.sqrt(a.sec * b.sec), lo: Math.min(a.lo, b.lo), hi: Math.max(a.hi, b.hi), buckets };
  }

  // sources: [{ ev, sec, extra }]  target: short event key -> { sec, lo, hi, sd, n } | null
  function shortAny(sources, target) {
    if (short.kind === 'riegel') {
      const tm = SHORT_METERS[target];
      if (!tm) return null;
      const res = sources.filter((s) => SHORT_METERS[s.ev] && !s.ev.startsWith('S')).map((s) => ({ m: SHORT_METERS[s.ev], sec: s.sec }));
      const r = riegelPredict(short.weights, res, { m: tm });
      return r && { ...r, sd: Math.log(r.hi / r.lo) / (2 * Z80), n: 1 };
    }
    if (!short.weights.events[target]) return null;
    const r = shortPredict(short.weights, sources.filter((s) => short.weights.events[s.ev]), target, sex);
    return r && { ...r, sd: Math.log(r.hi / r.lo) / (2 * Z80), n: Math.min(3, sources.length) };
  }

  // workouts: [{ date, distance_mi, moving_sec, category }]
  function marathonFrom(workouts, today) {
    const training = (workouts || []).filter((w) => w.category !== 'crosstrain')
      .map((w) => ({ date: w.date, miles: w.distance_mi, minutes: (w.moving_sec || 0) / 60 }));
    return marathon.kind === 'tanda' ? tandaPredict(marathon.weights, training, today) : marathonPredict(marathon.weights, training, today);
  }

  // What a flat-course time is worth on a course, and back. A course without a model is the flat time.
  const toCourseSec = (course, flatSec) => (courses[course] ? toCourse(courses[course].weights, flatSec, sex) : flatSec);
  const toFlatSec = (course, courseSec) => (courses[course] ? toFlat(courses[course].weights, courseSec, sex) : courseSec);

  return {
    raceAny, shortAny, marathon: marathonFrom,
    shortSource: (m, sec) => shortSourceIn(shortEvents, m, sec),
    toCourse: toCourseSec, toFlat: toFlatSec,
    // The time ratio course/flat for a run of this many seconds (conditionsOf multiplies by it).
    courseFactor: (course, courseSec) => courseSec / toFlatSec(course, courseSec),
    info: { race: label(race), short: label(short), marathon: label(marathon), ...Object.fromEntries(Object.keys(courses).map((k) => [k, label(courses[k])])) },
    ids: { race: race.id, short: short.id, marathon: marathon.id, ...Object.fromEntries(Object.entries(courses).map(([k, m]) => [k, m.id])) },
  };
}

// The models an athlete picked (people.settings.models), resolved to model files. Private models count only
// for their owner; a model that was deleted falls back to the default.
export async function pickedModels(db, personId, settingsJson) {
  let picked = {};
  try { picked = JSON.parse(settingsJson || '{}').models || {}; } catch { /* defaults */ }
  const out = {};
  for (const task of Object.keys(TASKS)) {
    const id = picked[task];
    if (!id || id === DEFAULTS[task]) continue;
    if (BY_ID.has(id)) { if (BY_ID.get(id).task === task) out[task] = BY_ID.get(id); continue; }
    const row = await db.prepare("SELECT body, task FROM models WHERE id = ? AND (visibility = 'public' OR owner_id = ?)").bind(id, personId).first();
    if (row && row.task === task) { try { out[task] = { ...JSON.parse(row.body), id }; } catch { /* default */ } }
  }
  return out;
}
