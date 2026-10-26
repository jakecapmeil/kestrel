// Kestrel's model engine must give the same numbers as the original KestrelPredict code on the built-in files,
// and every built-in file must pass upload validation. reference-cases.json holds fixed inputs and what the
// original code (src/pacemodel.js, src/shortmodel.js, src/marathon.js in github.com/jakecapmeil/hawks) predicted for them.
//   npm run check
import { readFileSync } from 'node:fs';
import { BUILTIN, predictEvent, marathonPredict, tandaPredict, toCourse, toFlat, modelSet, validateModel, ModelError } from '../src/models.js';
import { VC_FACTOR } from '../src/train/conditions.js';
import { EVENT } from '../src/events.js';

const REF = JSON.parse(readFileSync(new URL('./reference-cases.json', import.meta.url)));
const byId = Object.fromEntries(BUILTIN.map((m) => [m.slug, m]));
let fails = 0;
let compared = 0;
const close = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
const same = (label, got, want) => {
  compared++;
  if (!got && !want) return;
  if (!got || !want || !close(got.sec, want.sec) || !close(got.lo, want.lo) || !close(got.hi, want.hi)) {
    fails++;
    if (fails < 10) console.log('MISMATCH', label, got, want);
  }
};

REF.race.forEach((c, i) => same(`race ${i}`, predictEvent(byId['kestrelpredict-lite'], c.prs, EVENT.get(c.event), c.sex), c.want));
REF.short.forEach((c, i) => same(`short ${i}`, predictEvent(byId['kestrelpredict-short'], c.prs, EVENT.get(c.event), c.sex), c.want));
REF.marathon.forEach((c, i) => same(`marathon ${i}`, marathonPredict(byId['kestrelpredict-marathon'].weights, c.days, c.today), c.want));

// VDOT: Daniels' published table row for VDOT 50 (5K 19:57, 10K 41:21, half 1:31:35, marathon 3:10:49).
// The table rounds the VDOT, so allow 0.15%.
{
  const prs = [{ key: '5000', m: 5000, sec: 19 * 60 + 57, surf: 'track' }];
  for (const [key, m, want] of [['10000', 10000, 41 * 60 + 21], ['half', 21097.5, 91 * 60 + 35], ['mar', 42195, 3 * 3600 + 10 * 60 + 49]]) {
    compared++;
    const got = predictEvent(byId.vdot, prs, { key, m, surf: 'track' }, '');
    if (!got || Math.abs(got.sec / want - 1) > 0.0015) { fails++; console.log('VDOT table mismatch', key, got?.sec, want); }
  }
}
// Tanda: pace = 17.1 + 140 e^(-0.0053 K) + 0.55 P, worked by hand for 60 km a week at 5:00/km, plus its limits.
{
  const today = '2026-10-25';
  const day = (i) => ({ date: new Date(Date.parse(today + 'T12:00:00Z') - i * 864e5).toISOString().slice(0, 10), miles: 60 / 8 / 1.609344 / 6 * 7, minutes: (60 / 8 / 6 * 7) * 5 });
  const days = [];
  for (let i = 1; i <= 56; i++) if (i % 7 !== 0) days.push(day(i));
  const got = tandaPredict(byId['tanda-2011'].weights, days, today);
  const km = days.length * (60 / 8 / 6 * 7);
  const want = (17.1 + 140 * Math.exp(-0.0053 * (km / 8)) + 0.55 * 300) * 42.195;
  compared++;
  if (!got || Math.abs(got.sec - want) > 0.5) { fails++; console.log('Tanda mismatch', got?.sec, want); }
  compared++;
  if (tandaPredict(byId['tanda-2011'].weights, days.slice(0, 5), today)) { fails++; console.log('Tanda answered from 5 days'); }
  compared++;
  if (tandaPredict(byId['tanda-2011'].weights, days.map((d) => ({ ...d, minutes: d.minutes * 3 })), today)) { fails++; console.log('Tanda answered outside 2:47-3:36'); }
}
// Courses: the default Van Cortlandt model is today's flat 5.5% factor, and the conversion round-trips.
{
  const w = byId['vc-flat-factor'].weights;
  for (const sec of [780, 1080, 1500]) {
    compared += 2;
    if (Math.abs(toCourse(w, sec) / sec - VC_FACTOR) > 1e-12) { fails++; console.log('VC default is not x1.055', sec); }
    if (Math.abs(toFlat(w, toCourse(w, sec, 'm'), 'm') / sec - 1) > 1e-12) { fails++; console.log('course round trip', sec); }
  }
  // A course with no model keeps its catalogue factor; the model-based factor is only used once one is picked.
  compared += 2;
  if (Math.abs(modelSet().courseFactor('vc', 1080, 5000, VC_FACTOR) - VC_FACTOR) > 1e-12) { fails++; console.log('no-model course factor'); }
  if (Math.abs(modelSet().toFlat('franklin-park', 1000, 5000, 1.025) - 1000 / 1.025) > 1e-9) { fails++; console.log('no-model toFlat'); }
}

// Slots: a per-event pick overrides its purpose for that event only, and nothing else moves.
{
  const results = [{ m: 1600, sec: 300, surf: 'track' }, { m: 3200, sec: 650, surf: 'track' }];
  const plain = modelSet({}, 'm');
  const line = (a) => ({ ...byId['vc-flat-factor'], weights: { a, b: 1, c: 0 } });
  const mixed = modelSet({ $slots: { 'race:5K': byId.vdot, 'course:vc': line(0.1), 'course:vc:4023': line(0.2), 'course:franklin-park': line(0.3) } }, 'm');
  const at = (set, m, key) => set.raceAny(results, { m, surf: 'track' }, key);
  const ratio = (set, id, m) => set.toCourse(id, 1000, m, 1.025) / 1000;
  compared += 8;
  if (at(plain, 5000, '5K').sec === at(mixed, 5000, '5K').sec) { fails++; console.log('race:5K override had no effect'); }
  if (at(plain, 800, '800').sec !== at(mixed, 800, '800').sec) { fails++; console.log('race:5K override moved the 800'); }
  const want = (id, m, r) => { if (Math.abs(ratio(mixed, id, m) - r) > 1e-9) { fails++; console.log('course slot', id, m, ratio(mixed, id, m), r); } };
  want('vc', 5000, Math.exp(0.1));            // the course slot
  want('vc', 4023, Math.exp(0.2));            // a distance slot beats the course slot
  want('vc', 4010, Math.exp(0.2));            // a GPS distance within 3% still finds it
  want('franklin-park', 5000, Math.exp(0.3)); // another course, its own slot
  want('sunken-meadow', 5000, 1.025);         // an unpicked course keeps its catalogue factor
  if (Math.abs(ratio(plain, 'vc', 5000) - 1.025) > 1e-12) { fails++; console.log('unpicked vc moved'); }
}

for (const m of BUILTIN) {
  try { validateModel(m); } catch (e) { fails++; console.log('built-in model fails validation', m.slug, e.message); }
}
const bad = [
  { kestrel: 1, name: 'x', kind: 'python', task: 'race', weights: {} },
  { kestrel: 1, name: 'x', kind: 'riegel', task: 'marathon', weights: { exponent: 1.06, sd: 0.04 } },
  { kestrel: 1, name: 'x', kind: 'riegel', task: 'race', weights: { exponent: 3, sd: 0.04 } },
  // a tree whose child points backwards would loop forever
  { ...byId['kestrelpredict-lite'], weights: { ...byId['kestrelpredict-lite'].weights, trees: [{ f: [0, -1], t: [1, 0], l: [0, 0], r: [1, 0], v: [0, 0], mgl: [0, 0] }] } },
  { kestrel: 1, name: 'x', kind: 'vdot', task: 'marathon', weights: { sd: 0.04 } },
  { kestrel: 1, name: 'x', kind: 'vdot', task: 'race', weights: { sd: 0 } },
  { ...byId['tanda-2011'], weights: { ...byId['tanda-2011'].weights, range_sec: [13000, 10000] } },
  { ...byId['tanda-2011'], task: 'race' },
  { ...byId['vc-flat-factor'], weights: { a: 0, b: 3, c: 0 } },
  { ...byId['vc-flat-factor'], weights: { a: 1.5, b: 1, c: 0 } },
  { ...byId['vc-flat-factor'], task: 'race' },
  { ...byId['vc-flat-factor'], course: 'Van Cortlandt!' },
];
for (const b of bad) {
  try { validateModel(b); fails++; console.log('bad model accepted', b.kind); } catch (e) { if (!(e instanceof ModelError)) { fails++; console.log('wrong error', e); } }
}
console.log(fails ? `FAIL (${fails})` : `ok: ${compared} predictions match the reference and validation holds`);
process.exit(fails ? 1 : 0);
