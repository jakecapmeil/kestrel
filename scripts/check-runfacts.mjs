// Checks for the run-summary pipeline (train/runfacts.js and summarizeRuns in train/intervals.js): routine runs are
// written from the facts with no AI call, the rest go to the model with facts instead of raw laps, a model note with a
// number that isn't in the facts is replaced, and a failed model still leaves every run with a report.
// Run: node --no-warnings scripts/check-runfacts.mjs
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { paceStructure } from '../src/train/grade.js';
import { COACH_RUBRIC } from '../src/train/coach.js';
import { activityFacts, needsModel, templateReport, templateDayLine, setLabel, SUMMARY_RUBRIC, allowedNumbers, ungroundedNumbers } from '../src/train/runfacts.js';
import { summarizeRuns } from '../src/train/intervals.js';

let failed = 0;
const ok = (c, m) => { if (!c) { failed++; console.error('FAIL', m); } };
const MILE = 1609.344, maxHr = 195, vo2r = 55;
const secPer = (m, pace) => Math.round((m / MILE) * pace);

// A synced run, shaped like importRange's `runs` entries.
function run({ id, date = '2026-11-10', start = '07:00', name = 'Morning Run', miles, pace, hr = 142, maxhr = 160, laps = [], category = 'easy', desc = '', gps = null, elev = 30 }) {
  const moving = Math.round(miles * pace);
  const a = { id, type: 'Run', name, distance: miles * MILE, moving_time: moving, elapsed_time: moving + 60, average_heartrate: hr, max_heartrate: maxhr, total_elevation_gain: elev / 3.281, description: desc };
  const pi = paceStructure({ distance_mi: miles, moving_sec: moving, avg_hr: hr, laps, elev_gain_ft: elev, name }, { vo2r });
  return { a, date, start, laps, pace: pi, track: false, gps, category };
}
const reps = (n, m, pace, hrs = []) => Array.from({ length: n }, (_, i) => [{ m, s: secPer(m, typeof pace === 'function' ? pace(i) : pace), hr: hrs[i] ?? null }, { m: 400, s: secPer(400, 520), hr: null }]).flat();
const factsOf = (r) => activityFacts({ id: r.a.id, name: r.a.name, type: r.a.type, category: r.category, miles: r.a.distance / MILE, sec: r.a.moving_time, avg_hr: r.a.average_heartrate, max_hr: r.a.max_heartrate, elev_ft: r.a.total_elevation_gain * 3.281, laps: r.laps, paceInfo: r.pace, note: r.a.description }, { maxHr });
const sessOf = (r, extra = {}) => ({ key: `${r.date}#0`, date: r.date, main_id: String(r.a.id), facts: [factsOf(r)], ...extra });

// ---- an ordinary easy run: written from the facts, no model
const easy = run({ id: 1, miles: 5.2, pace: 521, hr: 142 });
const sEasy = sessOf(easy);
ok(!needsModel(sEasy), 'a routine easy run does not need the model');
const t = templateReport(sEasy);
ok(/5\.2 mi/.test(t) && /8:41\/mi/.test(t) && /easy/i.test(t), `easy note names distance, pace and zone: ${t}`);
ok(/142/.test(t) && /73% of max/.test(t), 'easy note has the heart rate against max');
ok(t.split(/(?<=\.)\s/).length >= 3 && t.split(/(?<=\.)\s/).length <= 4, 'easy note is 3-4 sentences');
ok(!ungroundedNumbers(t, allowedNumbers(sEasy.facts)).length, 'a written note only uses numbers from its facts');
ok(/Easy run, 5\.2 mi at 8:41\/mi\./.test(templateDayLine([sEasy])), 'one-line day summary');

// ---- facts for a workout: reps against the runner's own paces, fade and heart rate climb
const wk = run({ id: 2, miles: 7, pace: 480, hr: 168, name: 'Tuesday', category: 'workout', laps: reps(6, 800, (i) => 352 + i * 2, [166, 169, 172, 175, 178, 181]) });
const fw = factsOf(wk);
ok(fw.reps?.n === 6 && fw.reps.avg_m === 800 && /^5:5\d$/.test(fw.reps.avg_pace), `workout facts: ${JSON.stringify(fw.reps)}`);
ok(fw.reps.zone && fw.reps.pct_of_race_vo2max > 80, 'reps are placed in a zone with a percent of race VO2max');
ok(fw.findings.some((s) => /heart rate rose from 166 to 181/i.test(s)), 'heart rate climb is a finding');
ok(fw.findings.some((s) => /last fast lap was 10 s\/mi slower/i.test(s)), 'fade is a finding');
ok(fw.flags.includes('fade') && needsModel(sessOf(wk)), 'a workout goes to the model');
ok(/Workout, 7 mi/.test(templateReport(sessOf(wk))) && /fast laps/.test(templateReport(sessOf(wk))), 'a workout still gets a written note if the model is unavailable');
const even = factsOf(run({ id: 3, miles: 7, pace: 480, name: 'Tempo', category: 'workout', laps: reps(5, 1000, 360) }));
ok(even.findings.some((s) => /even|same pace/.test(s)), 'even reps are called even');

// ---- 2026-11-24: 3 x (600 m + 200 m) the runner typed (the watch read 0.87 mi indoors). The 200s are reps, not
// strides or jogs, and the set is named, not averaged into "400s".
const typed24 = [[600, 102.9, 145], [200, 31.5, 148], [600, 99, 140], [200, 30.7, 137], [600, 97.4, 151], [200, 29, 167]].map(([m, s, hr]) => ({ m, s, hr, rest: '', f: 2 }));
const pi24 = paceStructure({ distance_mi: 1.49, moving_sec: 403, avg_hr: 144, laps: typed24, elev_gain_ft: 12 }, { vo2r: 61.7 });
ok(pi24.kind === 'reps' && pi24.fast_laps === 6 && pi24.fast_m === 2400, `typed 600s and 200s are six reps: ${JSON.stringify({ kind: pi24.kind, n: pi24.fast_laps, m: pi24.fast_m })}`);
const watch24 = paceStructure({ distance_mi: 1.49, moving_sec: 403, avg_hr: 144, laps: typed24.map(({ f, ...l }) => l), elev_gain_ft: 12 }, { vo2r: 61.7 });
ok(watch24.fast_laps === 3, "a watch's 200 m laps still aren't counted (strides, lap-button laps)");
const f24 = activityFacts({ id: 24, name: 'New York Running', type: 'Run', category: 'workout', miles: 1.49, sec: 403, avg_hr: 144, max_hr: 175, elev_ft: 12, laps: typed24, paceInfo: pi24 }, { maxHr: 206 });
ok(f24.reps?.n === 6 && f24.reps.set === '3 × (600 m + 200 m)', `the set is named: ${JSON.stringify(f24.reps)}`);
ok(f24.findings.some((s) => s.startsWith('3 × (600 m + 200 m): 6 fast laps at 4:22/mi on average')), `finding names the set: ${f24.findings[0]}`);
ok(!ungroundedNumbers('Your 3 × (600 m + 200 m) averaged 4:22/mi.', allowedNumbers([f24])).length, "the set's numbers are the model's to use");
ok(f24.findings.some((s) => s === 'The 600 m reps got quicker: the last was 15 s/mi faster than the first.'), `fade compares the 600s: ${f24.findings.join(' | ')}`);
for (const [laps, want] of [
  [[[1000, 220], [1000, 221], [1000, 219], [200, 34], [200, 33]], '3 × 1000 m + 2 × 200 m'],
  [[[400, 75], [400, 76], [400, 74]], null],
  [[[1609, 330], [1200, 240], [800, 155], [400, 74]], null],
  [[[800, 150], [400, 72], [800, 151], [400, 71]], '2 × (800 m + 400 m)'],
  [[[1609, 330], [400, 70], [1609, 332], [400, 71]], '2 × (1 mi + 400 m)'],
]) {
  const got = setLabel(laps.map(([m, s]) => ({ m, s })));
  ok(got === want, `set label ${JSON.stringify(laps.map((l) => l[0]))}: ${got}`);
}

// ---- what sends a run to the model
const hot = run({ id: 4, miles: 4, pace: 530, hr: 172 });
ok(needsModel(sessOf(hot)) && factsOf(hot).flags.includes('hr_high_for_pace'), 'high heart rate on an easy pace goes to the model');
ok(needsModel(sessOf(easy), { meetDates: new Set([easy.date]) }), 'a meet day goes to the model');
ok(needsModel(sessOf(easy), { hasBody: true }), 'a marked sore part goes to the model');
ok(needsModel(sessOf(run({ id: 5, miles: 5, pace: 521, desc: 'legs dead today' }))), "the runner's own note goes to the model");
ok(needsModel(sessOf(run({ id: 6, miles: 9, pace: 540, category: 'long' }))), 'a long run goes to the model');
ok(!needsModel({ date: easy.date, main_id: '7', facts: [activityFacts({ id: 7, name: 'Ride', type: 'Ride', category: 'crosstrain', miles: 10, sec: 2700, avg_hr: 120 }, { maxHr })] }), 'cross-training does not');

// ---- the check on a model's note
const allowed = allowedNumbers([fw]);
ok(!ungroundedNumbers('Six 800s averaging 5:5' + fw.reps.avg_pace.slice(-1) + '/mi, heart rate climbing from 166 to 181.', allowed).length, 'numbers from the facts pass');
ok(ungroundedNumbers('Held 5:40 pace through the reps.', allowed).length === 1, 'an invented pace is caught');
ok(ungroundedNumbers('Heart rate hit 190 on the last rep.', allowed).length === 1, 'an invented heart rate is caught');
ok(!ungroundedNumbers('The last 3 reps were the quickest.', allowed).length, 'small counts are fine');

// ---- tokens: facts instead of raw laps, and a rubric without the plan-match and load math
const oldAct = { id: '2', start: wk.start, name: wk.a.name, type: 'Run', rule_category: 'workout', elev_ft: 30, miles: 7, minutes: 56, pace: '8:00', avg_hr: 168, max_hr: 181, laps: '800m 2:55 (5:52/mi, 166); 400m 2:10 (8:40/mi); 800m 2:55 (5:52/mi, 169); 400m 2:10 (8:40/mi); 800m 2:56 (5:53/mi, 172); 400m 2:10 (8:40/mi); 800m 2:56 (5:54/mi, 175); 400m 2:10 (8:40/mi); 800m 2:57 (5:55/mi, 178); 400m 2:10 (8:40/mi); 800m 2:57 (5:55/mi, 181); 400m 2:10 (8:40/mi)', pace_zone: 'threshold', fast_laps: 6, fast_lap_zone: 'threshold', workout_by_pace: true };
const oldChars = COACH_RUBRIC.length + JSON.stringify(oldAct).length;
const newChars = SUMMARY_RUBRIC.length + JSON.stringify(fw).length;
console.log(`prompt for one workout: ${oldChars} chars before, ${newChars} chars now (${Math.round((1 - newChars / oldChars) * 100)}% less)`);
ok(newChars < oldChars * 0.7, 'the facts prompt is much smaller than raw laps plus the coaching rubric');

// ---- the whole step, on a real SQL database and a scripted model
const sql = new DatabaseSync(':memory:');
sql.exec(readFileSync(new URL('../migrations/0013_ai_account.sql', import.meta.url), 'utf8'));
sql.exec(`CREATE TABLE ai_usage (person_id TEXT NOT NULL, date TEXT NOT NULL, calls INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (person_id, date));
CREATE TABLE people (id TEXT PRIMARY KEY, health_status TEXT, training_status TEXT);
CREATE TABLE body_marks (person_id TEXT, part TEXT, status TEXT);
CREATE TABLE team_members (team_id TEXT, person_id TEXT);
CREATE TABLE locations (id TEXT, name TEXT);
CREATE TABLE events (team_id TEXT, date TEXT, type TEXT, title TEXT, location TEXT, location_id TEXT);
INSERT INTO people VALUES ('p1', 'healthy', 'running');`);
const db = { prepare(q) { const st = sql.prepare(q); let args = []; const o = { bind: (...a) => { args = a; return o; }, first: async () => st.get(...args) ?? null, all: async () => ({ results: st.all(...args) }), run: async () => { st.run(...args); return {}; } }; return o; } };
const person = { id: 'p1', first_name: 'Sam', settings: '{}' };
const env = { GEMINI_API_KEY: 'k', GEMINI_API_BASE: 'http://gemini.test' };
const calls = [];
let reply = null;
globalThis.fetch = async (url, init) => { calls.push(JSON.parse(init.body)); return reply ? new Response(JSON.stringify(reply()), { status: 200 }) : new Response('{}', { status: 500 }); };
const model = (obj) => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] }, finishReason: 'STOP' }] });
const step = (runs) => summarizeRuns(env, db, person, runs, { maxHr, today: '2026-11-10', recentFrom: '2026-11-01' });

// only easy runs: no model call at all, a report and a day line for each
let r = await step([easy, run({ id: 8, date: '2026-11-11', miles: 3, pace: 560, hr: 128, category: 'recovery' })]);
ok(calls.length === 0, 'easy runs make no model call');
ok(r.ai.sessions.length === 2 && r.ai.sessions.every((s) => s.report.length > 40), 'every easy run gets a note');
ok(r.ai.days.length === 2 && r.counts.model === 0 && r.counts.written === 2, 'and a day line');

// a workout: one call, with facts and no raw laps; the model's note is kept when its numbers check out
reply = () => model({ sessions: [{ key: '2026-11-10#0', main_id: '2', report: 'Six 800s at 5:55 on average, a strong threshold session, but heart rate climbed from 166 to 181. Start the last reps a touch easier.', activities: [{ id: '2', category: 'workout', course: 'flat' }] }], days: [{ date: '2026-11-10', line: 'Solid six 800s at threshold.' }] });
r = await step([wk]);
ok(calls.length === 1, 'a workout makes one model call');
const sent = calls[0].contents[0].parts.at(-1).text;
ok(/"findings"/.test(sent) && !/800m 2:55/.test(sent), 'the model gets facts, not raw laps');
ok(r.ai.sessions[0].report.startsWith('Six 800s'), "the model's note is kept when its numbers are in the facts");
ok(r.counts.model === 1 && r.counts.replaced === 0, 'counted as a model note');

// the model invents a pace: its note is replaced by the written one
reply = () => model({ sessions: [{ key: '2026-11-10#0', main_id: '2', report: 'You held 5:40 pace through every rep, which is faster than your threshold.', activities: [] }], days: [{ date: '2026-11-10', line: 'Great day.' }] });
r = await step([wk]);
ok(/Workout, 7 mi/.test(r.ai.sessions[0].report) && r.counts.replaced === 1, 'a note with an invented number is replaced by the written one');

// the model is down: every run still gets a report, and the note says why
reply = null;
r = await step([wk, { ...easy, start: '16:00' }]);
ok(r.ai.sessions.length === 2 && r.ai.sessions.every((s) => s.report), 'a failed model still leaves every run with a report');
ok(/wrote the notes itself/.test(r.aiNote), 'and the sync note says the notes were written without it');

// a day mixing an easy run and a workout goes whole to the model
reply = () => model({ sessions: [], days: [] });
calls.length = 0;
r = await step([run({ id: 9, date: '2026-11-12', start: '06:30', miles: 3, pace: 540, hr: 130 }), run({ id: 10, date: '2026-11-12', start: '16:00', miles: 6, pace: 480, hr: 165, category: 'workout', laps: reps(6, 800, 352) })]);
const sentText = calls[0].contents[0].parts.at(-1).text;
ok(JSON.parse(sentText.slice(sentText.indexOf('[{')))[0] && JSON.parse(sentText.slice(sentText.indexOf('[{'))).length === 2, 'a day with a workout goes to the model whole, easy run included');
ok(r.ai.sessions.length === 2 && r.ai.sessions.every((s) => s.report), 'and each session still has a note');

if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
console.log('run-summary checks passed');
