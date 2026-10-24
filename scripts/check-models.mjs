// Kestrel's model engine must give the same numbers as the original HawksPredict code on the built-in files,
// and every built-in file must pass upload validation. reference-cases.json holds fixed inputs and what the
// original code (src/pacemodel.js, src/shortmodel.js, src/marathon.js in github.com/jakecapmeil/hawks) predicted for them.
//   npm run check
import { readFileSync } from 'node:fs';
import { BUILTIN, predictEvent, marathonPredict, validateModel, ModelError } from '../src/models.js';
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

REF.race.forEach((c, i) => same(`race ${i}`, predictEvent(byId['hawkspredict-lite'], c.prs, EVENT.get(c.event), c.sex), c.want));
REF.short.forEach((c, i) => same(`short ${i}`, predictEvent(byId['hawkspredict-short'], c.prs, EVENT.get(c.event), c.sex), c.want));
REF.marathon.forEach((c, i) => same(`marathon ${i}`, marathonPredict(byId['hawkspredict-marathon'].weights, c.days, c.today), c.want));

for (const m of BUILTIN) {
  try { validateModel(m); } catch (e) { fails++; console.log('built-in model fails validation', m.slug, e.message); }
}
const bad = [
  { kestrel: 1, name: 'x', kind: 'python', task: 'race', weights: {} },
  { kestrel: 1, name: 'x', kind: 'riegel', task: 'marathon', weights: { exponent: 1.06, sd: 0.04 } },
  { kestrel: 1, name: 'x', kind: 'riegel', task: 'race', weights: { exponent: 3, sd: 0.04 } },
  // a tree whose child points backwards would loop forever
  { ...byId['hawkspredict-lite'], weights: { ...byId['hawkspredict-lite'].weights, trees: [{ f: [0, -1], t: [1, 0], l: [0, 0], r: [1, 0], v: [0, 0], mgl: [0, 0] }] } },
];
for (const b of bad) {
  try { validateModel(b); fails++; console.log('bad model accepted', b.kind); } catch (e) { if (!(e instanceof ModelError)) { fails++; console.log('wrong error', e); } }
}
console.log(fails ? `FAIL (${fails})` : `ok: ${compared} predictions match the reference and validation holds`);
process.exit(fails ? 1 : 0);
