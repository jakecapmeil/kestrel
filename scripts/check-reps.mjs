// Rep detection on the session page (public/dayview.js repsOf): which laps are reps, and how they split into sets.
// node scripts/check-reps.mjs
import fs from 'node:fs';
import assert from 'node:assert/strict';
const window = {};
new Function('window', 'document', fs.readFileSync(new URL('../public/dayview.js', import.meta.url), 'utf8'))(window, { getElementById: () => null, querySelector: () => null, addEventListener: () => {} });
const { repsOf } = window.KDay;
const mk = (laps, extra = {}) => ({ category: 'workout', splits: laps.map(([m, s]) => ({ m, s })), ...extra });
const cases = [
  // 2026-11-14: 6 x 1 km then 4 x 200 m in one activity. The 200s used to make the 1 km reps look like a warm-up.
  ['6 x 1 km + 4 x 200 m', mk([[1007, 232.4], [1012, 228.7], [1007, 230], [1012, 221.2], [1010, 226.2], [1007, 221.8], [200, 34.8], [194, 33.8], [191, 31.5], [190, 29]]), '6 × 1000 m + 4 × 200 m', ['6 × 1000 m', '4 × 200 m']],
  ['warm-up, 6 x 800 with lapped jogs, cool-down', mk([[1609, 480], [1609, 470], [800, 160], [200, 80], [800, 158], [200, 82], [800, 159], [200, 85], [800, 157], [200, 83], [800, 156], [200, 84], [800, 155], [1609, 500]]), '6 × 800 m', null],
  ['ladder stays one set', mk([[1609, 330], [1200, 240], [800, 155], [400, 74]]), '1 mi + 1200 m + 800 m + 400 m', null],
  ['hand-typed reps are kept', mk([[1609, 330], [1609, 332], [1609, 329]], { splits_hand: true }), '3 × 1 mi', null],
  ['two sets with jogs between', mk([[1609, 470], [1000, 210], [400, 140], [1000, 208], [400, 150], [1000, 207], [400, 145], [1000, 205], [400, 150], [200, 34], [200, 90], [200, 33], [200, 95], [200, 33], [200, 92], [200, 32], [1609, 480]]), '4 × 1000 m + 4 × 200 m', ['4 × 1000 m', '4 × 200 m']],
];
for (const [name, s, label, sets] of cases) {
  const R = repsOf(s);
  assert.equal(R?.label, label, name);
  assert.deepEqual(R.sets ? R.sets.map((x) => x.label) : null, sets, name + ' (sets)');
}
console.log(`reps: ${cases.length} sessions read as expected`);
