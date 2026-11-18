// The module registry (src/train/modules.js): every screen in the app belongs to a core area or a module, presets and the
// suggestion behave, a runner can never switch off a core area, and the app's own references to modules are real ones.
// node scripts/check-modules.mjs
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  CORE, MODULES, MODULE_IDS, PRESETS, GROUPS, presetOn, offFrom, deviceModules, suggestPreset, legacyOff, cleanOff, offOf, moduleMeta, hiddenTools,
} from '../src/train/modules.js';
import { prefsOf, cleanPrefs } from '../src/train/tracking.js';

// ---- the nav in public/index.html: every tab/view is owned by exactly one core area or module
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const navSrc = html.match(/const NAV = (\{[\s\S]*?\n\});/)?.[1];
assert.ok(navSrc, 'found `const NAV = {...}` in public/index.html');
const NAV = new Function(`return ${navSrc}`)();
const navKeys = Object.entries(NAV).flatMap(([tab, { segs }]) => (segs.length ? segs.map(([v]) => `${tab}/${v}`) : [tab]));

const owner = new Map();
for (const area of [...CORE, ...MODULES]) {
  for (const v of area.views) {
    assert.ok(navKeys.includes(v), `${area.id} owns ${v}, which is not in NAV`);
    assert.ok(!owner.has(v), `${v} is owned by both ${owner.get(v)} and ${area.id}`);
    owner.set(v, area.id);
  }
}
for (const k of navKeys) assert.ok(owner.has(k), `NAV view ${k} belongs to no core area or module`);

// A tab with no core view can disappear altogether (Body, Team, Record). The others must always have somewhere to land.
const coreIds = new Set(CORE.map((c) => c.id));
for (const [tab, { segs }] of Object.entries(NAV)) {
  const keys = segs.length ? segs.map(([v]) => `${tab}/${v}`) : [tab];
  const gone = keys.every((k) => !coreIds.has(owner.get(k)));
  if (['today', 'run', 'calendar', 'you'].includes(tab)) assert.ok(!gone, `${tab} has no core view, so it could vanish`);
}

// ---- the registry itself
assert.equal(new Set(MODULE_IDS).size, MODULE_IDS.length, 'module ids are unique');
for (const m of MODULES) {
  assert.ok(GROUPS.some((g) => g.key === m.group), `${m.id}: unknown group ${m.group}`);
  assert.ok(m.label && m.blurb && m.off, `${m.id}: label, blurb and off are all written`);
  assert.ok(!coreIds.has(m.id), `${m.id} is both core and a module`);
}
assert.deepEqual(MODULE_IDS.filter((id) => coreIds.has(id)), [], 'no module shares an id with a core area');

// ---- presets
assert.equal(new Set(PRESETS.map((p) => p.id)).size, PRESETS.length, 'preset ids are unique');
for (const p of PRESETS) for (const id of p.on) assert.ok(MODULE_IDS.includes(id), `preset ${p.id} turns on unknown module ${id}`);
assert.deepEqual(offFrom(presetOn(PRESETS.find((p) => p.id === 'everything'))), [], 'Everything leaves nothing off');
// Sync and phone recording follow the watch, not the runner type.
assert.deepEqual(deviceModules({ watch: 'garmin' }), ['sync']);
assert.deepEqual(deviceModules({ watch: 'none' }), ['record']);
assert.deepEqual(deviceModules({}), ['record']);
const distance = PRESETS.find((p) => p.id === 'distance');
assert.ok(presetOn(distance, { profile: { watch: 'garmin' } }).includes('sync'));
assert.ok(!presetOn(distance, { profile: { watch: 'garmin' } }).includes('record'));
assert.ok(presetOn(PRESETS.find((p) => p.id === 'starter'), { profile: { watch: 'none' } }).includes('record'));
// A team's owner or captain keeps Team whatever preset they pick; everyone else on the starter preset doesn't get it.
const starter = PRESETS.find((p) => p.id === 'starter');
assert.ok(presetOn(starter, { lead: true }).includes('team'));
assert.ok(!presetOn(starter, { lead: false }).includes('team'));

// The two runners the menu is mostly for: a high school team runner and a 40-year-old marathoner.
const hs = presetOn(PRESETS.find((p) => p.id === 'team'), { profile: { watch: 'garmin' } });
const marathoner = presetOn(distance, { profile: { watch: 'garmin' } });
for (const id of ['team', 'records', 'workouts']) assert.ok(hs.includes(id), `team runner keeps ${id}`);
for (const id of ['fuel', 'shoes', 'xtrain']) assert.ok(!hs.includes(id), `team runner doesn't need ${id} by default`);
for (const id of ['fuel', 'shoes', 'xtrain', 'fitness', 'sync']) assert.ok(marathoner.includes(id), `marathoner keeps ${id}`);
assert.ok(!marathoner.includes('team'), 'a solo marathoner has no Team tab');

// ---- suggestion
const cases = [
  ['junior on a team', { profile: { birth_year: 2009, weekly_miles: 25, watch: 'garmin' }, user: { class_year: 'Junior' }, teams: [{ role: 'member' }] }, 'team'],
  ['40-year-old training for a marathon', { profile: { birth_year: 1986, goal_event: 'Marathon', weekly_miles: 40, experience: '3plus' }, user: { class_year: 'Adult' } }, 'distance'],
  ['half marathon goal', { profile: { birth_year: 1995, goal_event: 'Half marathon', weekly_miles: 20 }, user: {} }, 'distance'],
  ['new runner', { profile: { birth_year: 1990, experience: 'new', weekly_miles: 5 }, user: {} }, 'starter'],
  ['low mileage, not new', { profile: { birth_year: 1990, experience: '1to3', weekly_miles: 8 }, user: {} }, 'starter'],
  ['coming back from injury, even on a team', { profile: { goal: 'comeback', birth_year: 2008 }, user: { class_year: 'Senior' }, teams: [{ role: 'member' }] }, 'comeback'],
  ['adult in a club', { profile: { birth_year: 1985, weekly_miles: 20, experience: '3plus' }, user: { class_year: 'Adult' }, teams: [{ role: 'member' }] }, 'team'],
  ['experienced adult, no goal race', { profile: { birth_year: 1980, weekly_miles: 35, experience: '3plus' }, user: {} }, 'distance'],
  ['nothing known', { profile: {}, user: {} }, 'everything'],
];
for (const [name, input, want] of cases) assert.equal(suggestPreset({ ...input, year: 2026 }), want, name);

// ---- what is stored
assert.deepEqual(cleanOff(['fuel', 'today', 'plan', 'nope', 'fuel', 7, 'team']), ['fuel', 'team'], 'unknown and core ids are dropped');
assert.deepEqual(cleanOff('fuel'), [], 'not a list');
assert.deepEqual(legacyOff(['plan', 'kai', 'fitness']), ['workouts', 'goals'], 'hidden Run views carry over');
assert.deepEqual(legacyOff(undefined), []);
assert.deepEqual(legacyOff(['plan', 'log', 'goals', 'library', 'fitness', 'kai']), [], 'nothing hidden, nothing off');

// Nothing saved: everything is on. Hidden Run views come through; once modules are saved they win.
assert.deepEqual(prefsOf({}).modules_off, []);
assert.equal(prefsOf({}).modules_seen, false);
assert.deepEqual(prefsOf({ prefs: { train_tabs: ['plan', 'kai'] } }).modules_off, ['workouts', 'fitness', 'goals']);
assert.deepEqual(prefsOf({ prefs: { train_tabs: ['plan', 'kai'], modules_off: ['fuel'] } }).modules_off, ['fuel']);
assert.deepEqual(offOf({ modules_off: [] }), [], 'saved as nothing off beats the legacy tabs');
const saved = cleanPrefs({ modules_off: ['fuel', 'plan', 'team', 'bogus'], modules_seen: 1 }, prefsOf({}));
assert.deepEqual(saved.modules_off, ['fuel', 'team']);
assert.equal(saved.modules_seen, true);
assert.deepEqual(cleanPrefs({ xt_sports: ['Climbing'] }, saved).modules_off, ['fuel', 'team'], 'other saves leave modules alone');

// ---- the coach hears about hidden tools by name
assert.deepEqual(hiddenTools({ modules_off: ['fuel', 'team'] }), ['Fuel', 'Team']);
assert.deepEqual(hiddenTools({}), []);

// ---- the meta the app receives
const meta = moduleMeta({ profile: { watch: 'garmin', birth_year: 1986, goal_event: 'Marathon' }, user: {}, teams: [] });
assert.equal(meta.suggested, 'distance');
assert.deepEqual(meta.presets.map((p) => p.id), PRESETS.map((p) => p.id));
for (const p of meta.presets) for (const id of p.off) assert.ok(MODULE_IDS.includes(id), `preset ${p.id} turns off unknown ${id}`);
assert.ok(moduleMeta({ teams: [{ role: 'owner' }] }).presets.find((p) => p.id === 'starter').off.every((id) => id !== 'team'), 'an owner keeps Team on every preset');

// ---- the app only names modules that exist (kMods.has('x'), kMods.need('x'), modOn('x'), data-mod="x")
const dir = new URL('../public/', import.meta.url);
let refs = 0;
// (modules.js is the runtime itself; its header comment shows the patterns with a placeholder id.)
for (const f of ['index.html', ...readdirSync(dir).filter((n) => n.endsWith('.js') && n !== 'modules.js')]) {
  const src = readFileSync(new URL(f, dir), 'utf8');
  for (const m of src.matchAll(/(?:kMods\.(?:has|need)\(|modOn\(|data-mod=)\s*['"]([a-z]+)['"]/g)) {
    refs++;
    assert.ok(MODULE_IDS.includes(m[1]), `${f} names module "${m[1]}", which is not in the registry`);
  }
}
console.log(`modules: ${MODULES.length} modules, ${PRESETS.length} presets, ${navKeys.length} nav views covered, ${refs} references in the app`);
