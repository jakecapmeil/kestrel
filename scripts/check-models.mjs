// Kestrel's model engine must give the same numbers as the Hawks modules on the built-in files,
// and every built-in file must pass upload validation. Run from the repo root: node kestrel/scripts/check-models.mjs
import { predictRace } from '../../src/pacemodel.js';
import { predictShortAny, shortSource } from '../../src/shortmodel.js';
import { predictMarathon } from '../../src/marathon.js';
import { BUILTIN, predictEvent, marathonPredict, validateModel, ModelError } from '../src/models.js';
import { EVENT } from '../src/events.js';

const byId = Object.fromEntries(BUILTIN.map((m) => [m.slug, m]));
let fails = 0;
const close = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
const same = (label, a, b) => {
  if (!a && !b) return;
  if (!a || !b || !close(a.sec, b.sec) || !close(a.lo, b.lo) || !close(a.hi, b.hi)) { fails++; if (fails < 10) console.log('MISMATCH', label, a, b); }
};

let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const keys = ['800', '1600', '3200', '5000', 'xc5k', 'xc3mi', '1500', 'mile', '400', '200', '100', '600'];

for (let i = 0; i < 300; i++) {
  const n = 1 + Math.floor(rnd() * 3);
  const speed = 4 + rnd() * 2.5; // m/s at 1600
  const prs = [];
  for (let j = 0; j < n; j++) {
    const ev = EVENT.get(keys[Math.floor(rnd() * keys.length)]);
    if (prs.some((p) => p.key === ev.key)) continue;
    const sec = (ev.m / speed) * Math.pow(ev.m / 1600, 0.06) * (0.97 + rnd() * 0.06);
    prs.push({ key: ev.key, m: ev.m, sec, surf: ev.surf });
  }
  const sex = ['', 'f', 'm'][i % 3];
  // Lite
  const target = EVENT.get(['3200', '5000', 'xc5k', '800', 'half'][i % 5]);
  const others = prs.filter((p) => p.key !== target.key);
  if (others.length) {
    const want = sex
      ? predictRace(others, { m: target.m, surf: target.surf, male: sex === 'm' ? 1 : 0 })
      : (() => { const a = predictRace(others, { m: target.m, surf: target.surf, male: 0 }); const b = predictRace(others, { m: target.m, surf: target.surf, male: 1 });
          return a && b ? { sec: Math.sqrt(a.sec * b.sec), lo: Math.min(a.lo, b.lo), hi: Math.max(a.hi, b.hi) } : null; })();
    same(`lite ${i}`, predictEvent(byId['hawkspredict-lite'], prs, target, sex), want);
  }
  // Short (sex unknown is the Hawks path)
  const st = EVENT.get(['100', '200', '600', '1000', '400'][i % 5]);
  const srcs = prs.filter((p) => p.key !== st.key && p.surf === 'track').map((p) => shortSource(p.m, p.sec)).filter(Boolean);
  same(`short ${i}`, predictEvent(byId['hawkspredict-short'], prs, st, ''), srcs.length ? predictShortAny(srcs, st.key) : null);
}

// Marathon
for (let i = 0; i < 100; i++) {
  const days = [];
  const today = '2026-10-24';
  for (let d = 1; d <= 112; d++) {
    if (rnd() < 0.35) continue;
    const miles = 3 + rnd() * (d % 7 === 0 ? 15 : 7);
    days.push({ date: new Date(Date.parse(today + 'T12:00:00Z') - d * 86400000).toISOString().slice(0, 10), miles, minutes: miles * (7 + rnd() * 3) });
  }
  const want = predictMarathon(days.map((d) => ({ date: d.date, distance_mi: d.miles, moving_sec: d.minutes * 60, category: 'easy' })), today);
  const got = marathonPredict(byId['hawkspredict-marathon'].weights, days, today);
  same(`marathon ${i}`, got, want);
}

for (const m of BUILTIN) {
  try { validateModel(m); } catch (e) { fails++; console.log('builtin fails validation', m.slug, e.message); }
}
const bad = [
  { kestrel: 1, name: 'x', kind: 'python', task: 'race', weights: {} },
  { kestrel: 1, name: 'x', kind: 'riegel', task: 'marathon', weights: { exponent: 1.06, sd: 0.04 } },
  { kestrel: 1, name: 'x', kind: 'riegel', task: 'race', weights: { exponent: 3, sd: 0.04 } },
  { ...byId['hawkspredict-lite'], weights: { ...byId['hawkspredict-lite'].weights, trees: [{ f: [0, -1], t: [1, 0], l: [0, 0], r: [1, 0], v: [0, 0], mgl: [0, 0] }] } },
];
for (const b of bad) {
  try { validateModel(b); fails++; console.log('bad model accepted', b.kind); } catch (e) { if (!(e instanceof ModelError)) { fails++; console.log('wrong error', e); } }
}
console.log(fails ? `FAIL (${fails})` : 'ok: models match Hawks and validation holds');
process.exit(fails ? 1 : 0);
