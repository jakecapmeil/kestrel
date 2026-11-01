// What kind of runner the PRs say you are: which PRs are your strongest and where your range sits (sprinter, middle
// distance, distance, long distance), from your own records.
//
// How it's worked out: each PR is hidden in turn and the race model (KestrelPredict-Lite, or -Short for sprints, the 600,
// 1000 and steeple) predicts it from the others. A PR faster than your other PRs predict is a strength: the model was
// trained on what a typical runner with those other marks runs, so beating it means that distance suits you better than
// most. Course PRs count at their flat-course worth. Ultra and marathon leanings can't come from track PRs, so they are
// only suggested from training volume, and say so.
import { BUILTIN, DEFAULTS, predictEvent } from '../models.js';
import { EVENT } from '../events.js';
import { normalizePrs, parseCourseKey, courseLabel, coursesById } from './courses.js';
import { VC_FACTOR, XC_FACTOR } from './conditions.js';
import { parseTime, fmtTime } from './fitness.js';

const MODEL = { race: BUILTIN.find((m) => m.id === DEFAULTS.race), short: BUILTIN.find((m) => m.id === DEFAULTS.short) };
// PRs are stored under the app's names (5K, 2000 SC); the models' events use metres.
const PR_TO_EVENT = { '100': '100', '200': '200', '400': '400', '600': '600', '800': '800', '1000': '1000', '1600': '1600', '3200': '3200', '5K': '5000', '2000 SC': 'S2000', '3000 SC': 'S3000' };

export const BANDS = [
  { key: 'sprint', label: 'Sprinter', range: '100 to 400 m', max: 450 },
  { key: 'middle', label: 'Middle-distance runner', range: '600 m to the mile', max: 1700 },
  { key: 'distance', label: 'Distance runner', range: '3200 m to 10K', max: 12000 },
  { key: 'long', label: 'Long-distance runner', range: 'half marathon and up', max: Infinity },
];
const bandOf = (m) => BANDS.find((b) => m <= b.max);
const pct = (x) => Math.round(x * 1000) / 10;

// prs: the stored PR object; courses: Map of course id -> { name, factor }; fitness: the Fitness State (for mileage and the
// long-run read); sex: '', 'f' or 'm'.
export function assessRunner(prsRaw, courses = new Map(), fitness = null, sex = '') {
  const prs = normalizePrs(prsRaw || {});
  const have = [];
  for (const [k, v] of Object.entries(prs)) {
    const sec = parseTime(v?.time);
    if (!sec) continue;
    const ck = parseCourseKey(k);
    if (ck) {
      if (ck.m < 2000) continue;
      const c = courses.get(ck.id);
      const factor = c?.factor ?? (ck.id === 'vc' ? VC_FACTOR : XC_FACTOR);
      const ev = { key: k, label: courseLabel(c, ck.m), m: ck.m, surf: 'track', task: 'race' };
      have.push({ key: k, m: ck.m, surf: 'track', sec: sec / factor, raw: sec, time: v.time, date: v.date || '', ev, course: c?.name || ck.id });
      continue;
    }
    const ev = EVENT.get(PR_TO_EVENT[k]);
    if (ev) have.push({ key: ev.key, prKey: k, m: ev.m, surf: ev.surf, steeple: !!ev.steeple, sec, raw: sec, time: v.time, date: v.date || '', ev });
  }
  // One race filed twice (a course PR and the flat PR Kestrel once also took from it) counts once, as the course PR.
  const list = have.filter((p) => p.course || !have.some((q) => q.course && q.date === p.date && Math.abs(q.raw - p.raw) < 1));
  // A steeple is its own skill: it is scored, but never decides your range.
  const flatEvents = new Set(list.filter((p) => !p.steeple).map((p) => Math.round(p.m)));
  if (list.length < 2 || flatEvents.size < 2) {
    return { ready: false, prs: list.length, note: 'Add PRs at two or more different distances (a 400 and a 5K, say) and Kestrel will read what kind of runner you are.' };
  }

  // Leave-one-out: how much faster each PR is than what the others predict.
  const rows = [];
  for (const p of list) {
    const model = MODEL[p.ev.task];
    const others = list.filter((q) => q !== p).map((q) => ({ key: q.key, m: q.m, surf: q.surf, steeple: q.steeple, sec: q.sec }));
    const r = model && predictEvent(model, others, p.ev, sex);
    if (!r?.sec) continue;
    rows.push({
      event: p.prKey || p.key, label: p.ev.label, meters: Math.round(p.m), time: p.time, date: p.date, band: bandOf(p.m).key, steeple: !!p.steeple,
      predicted: fmtTime(r.sec * (p.raw / p.sec), { tenths: p.raw < 180 }), edge: r.sec / p.sec - 1,
      ...(p.course ? { course: p.course } : {}),
    });
  }
  if (rows.length < 2) return { ready: false, prs: list.length, note: 'Kestrel could not compare these PRs with each other yet. Add one more at a different distance.' };
  rows.sort((a, b) => b.edge - a.edge);

  // Where the strength sits: the mean edge in each band you have PRs in.
  const bands = BANDS.map((b) => {
    const r = rows.filter((x) => x.band === b.key && !x.steeple);
    return r.length ? { key: b.key, label: b.label, range: b.range, edge: r.reduce((a, x) => a + x.edge, 0) / r.length, prs: r.length } : null;
  }).filter(Boolean);
  const best = [...bands].sort((a, b) => b.edge - a.edge)[0];
  // The lean: shorter vs longer half of your PRs. Positive means your longer PRs are the stronger ones.
  const flat = rows.filter((x) => !x.steeple).sort((a, b) => a.meters - b.meters);
  const half = Math.floor(flat.length / 2);
  const mean = (a) => a.reduce((s, x) => s + x.edge, 0) / Math.max(a.length, 1);
  const lean = flat.length >= 2 ? mean(flat.slice(flat.length - Math.max(half, 1))) - mean(flat.slice(0, Math.max(half, 1))) : 0;
  const spread = Math.max(...rows.map((x) => x.edge)) - Math.min(...rows.map((x) => x.edge));

  let type = best.key;
  let title = best.label;
  const why = [];
  if (bands.length >= 2 && spread < 0.015) {
    type = 'all-round';
    title = 'All-rounder';
    why.push(`Your PRs are within ${pct(spread)}% of what each other predict: no distance stands out, so you can race most of them well.`);
  } else {
    const range = best.range.replace(/ and up$/, '+');
    why.push(best.edge >= 0
      ? `Your ${range} PRs are ${pct(best.edge)}% faster than your other PRs predict${bands.length > 1 ? ', more than any other range you have raced' : ''}.`
      : `Your ${range} PRs hold up best: within ${pct(-best.edge)}% of what your other PRs predict, closer than any other range.`);
  }
  if (Math.abs(lean) >= 0.01) why.push(lean > 0 ? 'Your longer races are relatively stronger than your shorter ones: endurance is your edge.' : 'Your shorter races are relatively stronger than your longer ones: speed is your edge.');

  // Long distance and ultra can only be hinted at from training, never from track PRs.
  const mpw = fitness?.mpw || 0;
  const longest = fitness?.longest_28d || 0;
  let longer = null;
  if (lean > 0.005 || type === 'distance' || type === 'long') {
    if (mpw >= 50 && longest >= 16) longer = { key: 'ultra', text: `With ${Math.round(mpw)} miles a week and a ${longest} mile long run, you have the volume ultra runners build from. Your PRs lean to endurance, so longer races are worth a try.` };
    else if (mpw >= 30 && longest >= 10) longer = { key: 'long', text: `With ${Math.round(mpw)} miles a week and a ${longest} mile long run, the half marathon and marathon are in reach: your PRs get stronger as the races get longer.` };
  }
  if (type === 'distance' && longer?.key === 'ultra') title = 'Long-distance runner';
  if (type === 'middle' && lean > 0.01) title = 'Middle-distance runner, leaning distance';
  if (type === 'middle' && lean < -0.01) title = 'Middle-distance runner, leaning speed';
  if (type === 'distance' && lean < -0.01) title = 'Distance runner with speed';

  const strongest = rows.filter((x) => x.edge > 0).slice(0, 3);
  return {
    ready: true, type, title, why, lean: pct(lean), spread: pct(spread),
    best_events: (strongest.length ? strongest : rows.slice(0, 1)).map((x) => x.label),
    strongest: (strongest.length ? strongest : rows.slice(0, 1)).map((x) => ({ ...x, edge_pct: pct(x.edge) })),
    events: rows.map((x) => ({ ...x, edge_pct: pct(x.edge) })),
    bands: bands.map((b) => ({ ...b, edge_pct: pct(b.edge) })),
    longer,
    basis: `${rows.length} PRs, each compared with what your other PRs predict (KestrelPredict). Course PRs count at their flat-course worth.`,
  };
}

export async function runnerAssessment(db, personId, fitness = null) {
  const row = await db.prepare('SELECT prs, sex FROM people WHERE id = ?').bind(personId).first();
  let prs = {};
  try { prs = JSON.parse(row?.prs || '{}') || {}; } catch { /* none */ }
  const ids = [...new Set(Object.keys(prs).map((k) => parseCourseKey(k)?.id).filter(Boolean))];
  const courses = ids.length ? await coursesById(db, ids) : new Map();
  return assessRunner(prs, courses, fitness, row?.sex || '');
}
