// Fit a course model from your own races: how much slower a course is than the flat, per runner.
//   node scripts/fit-course.mjs races.csv "Van Cortlandt 5K" vc > my-vc-model.json
// races.csv has a header row and one line per runner: flat_sec,course_sec,sex
//   flat_sec    what they ran (or were worth) on a flat course, in good weather: a track or road 5K from the same month
//   course_sec  what they ran on the course
//   sex         m or f (optional; leave out to fit one line for everyone)
// It fits ln(course) = a + b ln(flat) + c male by least squares, validates the result as a Kestrel model, and prints it.
// Upload the file in the Lab under the course's purpose. With fewer than 30 rows the fit is a sketch: say so in the model's trained_on.
import { readFileSync } from 'node:fs';
import { validateModel } from '../src/models.js';

const [file, name = 'My course model', course = 'vc'] = process.argv.slice(2);
if (!file) { console.error('usage: node scripts/fit-course.mjs races.csv "Model name" vc > model.json'); process.exit(2); }
const rows = readFileSync(file, 'utf8').trim().split(/\r?\n/).slice(1).map((l) => l.split(',').map((x) => x.trim()))
  .map(([f, c, sex]) => ({ x: Math.log(Number(f)), y: Math.log(Number(c)), male: sex === 'm' ? 1 : 0, known: sex === 'm' || sex === 'f' }))
  .filter((r) => Number.isFinite(r.x) && Number.isFinite(r.y));
if (rows.length < 5) { console.error(`Need at least 5 usable rows, found ${rows.length}.`); process.exit(1); }

// Normal equations for y = a + b x + c male (c dropped when sex is missing or constant).
const useC = rows.every((r) => r.known) && rows.some((r) => r.male) && rows.some((r) => !r.male);
const cols = (r) => (useC ? [1, r.x, r.male] : [1, r.x]);
const k = useC ? 3 : 2;
const A = Array.from({ length: k }, () => new Array(k + 1).fill(0));
for (const r of rows) { const v = cols(r); for (let i = 0; i < k; i++) { for (let j = 0; j < k; j++) A[i][j] += v[i] * v[j]; A[i][k] += v[i] * r.y; } }
for (let i = 0; i < k; i++) { // Gauss-Jordan
  const p = A.findIndex((row, j) => j >= i && Math.abs(row[i]) > 1e-12);
  if (p < 0) { console.error('The rows are all the same distance or time; nothing to fit.'); process.exit(1); }
  [A[i], A[p]] = [A[p], A[i]];
  const d = A[i][i];
  for (let j = i; j <= k; j++) A[i][j] /= d;
  for (let r = 0; r < k; r++) if (r !== i) { const f = A[r][i]; for (let j = i; j <= k; j++) A[r][j] -= f * A[i][j]; }
}
const [a, b, c = 0] = A.map((row) => row[k]);
const resid = rows.map((r) => r.y - (a + b * r.x + c * r.male));
const sd = Math.sqrt(resid.reduce((s, e) => s + e * e, 0) / Math.max(1, rows.length - k));
const model = validateModel({
  kestrel: 1, name, version: 'fit-' + new Date().toISOString().slice(0, 10), kind: 'course-transfer', task: course, license: 'CC0-1.0',
  description: `Least-squares line from ${rows.length} runners: course time = flat time x ${(Math.exp(a + b * Math.log(1080)) / 1080).toFixed(3)} at an 18:00 flat 5K. Residual SD ${(sd * 100).toFixed(1)}%.`,
  trained_on: `${rows.length} paired flat/course results. Describe where they came from and their licence here before you publish.`,
  weights: { a, b, c, sd, n: rows.length },
});
console.log(JSON.stringify(model, null, 2));
