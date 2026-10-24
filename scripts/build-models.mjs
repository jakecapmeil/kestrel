// Wraps the Hawks model files (src/*.json) as Kestrel model files (kestrel/models/*.json).
// Run from the repo root: node kestrel/scripts/build-models.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const read = (f) => JSON.parse(readFileSync(new URL(`../../src/${f}`, import.meta.url)));
const out = (slug, m) => writeFileSync(new URL(`../models/${slug}.json`, import.meta.url), JSON.stringify({ kestrel: 1, slug, ...m }));

const lite = read('pacemodel.json');
out('hawkspredict-lite', {
  name: 'HawksPredict-Lite', version: lite.version, kind: 'lite-trees', task: 'race', license: 'CC-BY-4.0',
  description: 'Race time with an 80% range from earlier results (distance, time, surface). 150 boosted trees over a weighted-Riegel baseline.',
  trained_on: lite.trained_on,
  weights: { feats: lite.feats, init: lite.init, trees: lite.trees, interval: Object.fromEntries(Object.entries(lite.interval).map(([k, v]) => [k, v.slice(0, 2)])) },
});

const short = read('shortmodel.json');
out('hawkspredict-short', {
  name: 'HawksPredict-Short', version: short.version, kind: 'short-pairs', task: 'short', license: 'Unclear (see card)',
  description: 'Sprints, 400-1000 m and steeplechase from other PRs: one log-log line per event pair, combined by inverse variance.',
  trained_on: short.trained_on,
  weights: { infl: short.infl, events: short.events, extra_sd: short.extra_sd, pairs: short.pairs },
});

const mara = read('marathonmodel.json');
out('hawkspredict-marathon', {
  name: 'HawksPredict-Marathon', version: mara.version, kind: 'marathon-trees', task: 'marathon', license: 'CC-BY-4.0',
  description: 'Marathon time with an 80% range from the last 16 weeks of logged running (needs 15 running days).',
  trained_on: mara.trained_on,
  weights: { feats: mara.feats, init: mara.init, trees: mara.trees, interval: Object.fromEntries(Object.entries(mara.interval).map(([k, v]) => [k, v.slice(0, 2)])) },
});

out('riegel', {
  name: 'Riegel', version: '1981', kind: 'riegel', task: 'race', license: 'CC0-1.0',
  description: 'The classic formula t2 = t1 x (d2/d1)^1.06 from your nearest PR. A simple baseline to compare against.',
  trained_on: 'Riegel, P. S. (1981). Athletic records and human endurance. American Scientist 69(3).',
  weights: { exponent: 1.06, sd: 0.04 },
});
console.log('ok');
