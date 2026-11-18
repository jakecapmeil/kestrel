// Kestrel's tools as modules. A runner turns the ones they don't use off (You → Settings → Customize Kestrel) and the
// app stops showing them. Turning a module off only hides it: nothing is deleted, nobody leaves a team, and the
// guardrails, run summaries and sharing settings keep working exactly as before.
//
// This file is the one list. The server validates a runner's choices against it, and ships it to the app with /api/me
// so the nav, the menu and the coach all read the same thing. What is stored is the list of modules that are OFF
// (prefs.modules_off), so a tool added later is on for everyone until they choose otherwise.
//
// Three kinds of thing:
//   core      Today, Plan, the training log, Profile and settings. Always on; the app is not usable without them.
//   modules   Everything else, in four groups. Each owns the nav views (tab/view keys from NAV in public/index.html)
//             and the loose buttons it controls, so hiding it takes all of that with it.
//   presets   Starting points by kind of runner. A preset is just a list of modules to turn off; the menu shows them
//             as chips and the runner can still flip any single tool afterwards.

export const GROUPS = [
  { key: 'training', label: 'Training' },
  { key: 'body', label: 'Body' },
  { key: 'racing', label: 'Racing and team' },
  { key: 'devices', label: 'Watch, phone and Lab' },
];

// Always on. `views` are NAV keys: `tab/view`, or just `tab` when the tab has no views of its own.
export const CORE = [
  { id: 'today', label: 'Today', views: ['today'] },
  { id: 'plan', label: 'Plan', views: ['run/plan'] },
  { id: 'log', label: 'Training log', views: ['calendar/log'] },
  { id: 'you', label: 'Profile and settings', views: ['you/profile', 'you/integrations', 'you/settings'] },
];

// blurb: what it is. off: what turning it off hides (and what it leaves alone), in the runner's words.
export const MODULES = [
  { id: 'coach', group: 'training', label: 'Kestrel AI coach',
    blurb: 'Chat about your plan, log and next race. It moves days when life gets in the way.',
    off: 'The Coach view, the Ask Kestrel AI buttons and Today’s check-in box. Plan guardrails and run summaries keep working.',
    views: ['run/kai'] },
  { id: 'workouts', group: 'training', label: 'Workout library',
    blurb: 'Sessions written for your level, with rep targets from your own paces. Send them to your watch.',
    off: 'The Workouts view.',
    views: ['run/library'] },
  { id: 'fitness', group: 'training', label: 'Fitness and race estimates',
    blurb: 'Race times from 100 m to the marathon, VO2max, pace zones, a taper builder, and a heat and hills calculator.',
    off: 'The Fitness view. Your PRs and estimates are still worked out behind the scenes.',
    views: ['run/fitness'] },
  { id: 'goals', group: 'training', label: 'Goals',
    blurb: 'A race time, weekly miles or a habit, tracked against your training.',
    off: 'The Goals view. Goals you already set are kept.',
    views: ['run/goals'] },

  { id: 'recovery', group: 'body', label: 'Recovery and body map',
    blurb: 'Readiness, health status and a body map of what is sore. Only you and your coach see it.',
    off: 'The check-in on Today and the Recovery view. Health status you set still guides plan changes.',
    views: ['body/recovery'] },
  { id: 'xtrain', group: 'body', label: 'Cross-training',
    blurb: 'Bike, pool, strength and the rest, counted in your load.',
    off: 'The Cross-train view and its tile on Today. Sessions from your watch still count.',
    views: ['body/xtrain'] },
  { id: 'fuel', group: 'body', label: 'Fuel',
    blurb: 'Log food against carbohydrate and protein targets scaled to the day’s training.',
    off: 'The Fuel view and its tile on Today.',
    views: ['body/food'] },
  { id: 'shoes', group: 'body', label: 'Shoes',
    blurb: 'Track the miles on each pair, by kind of run.',
    off: 'The shoe list in Profile.',
    views: [] },

  { id: 'records', group: 'racing', label: 'Records',
    blurb: 'PRs that update themselves, and the courses you follow.',
    off: 'The Records view. PRs still feed your race estimates.',
    views: ['you/records'] },
  { id: 'team', group: 'racing', label: 'Team',
    blurb: 'The team calendar, feed, meets, roster and team plan.',
    off: 'The Team tab and the team schedule. You stay on your team, and what teammates can see does not change.',
    views: ['calendar/team', 'team/feed', 'team/meets', 'team/training', 'team/roster'] },

  { id: 'sync', group: 'devices', label: 'Watch sync',
    blurb: 'Garmin, COROS and others send your runs in through intervals.icu.',
    off: 'The sync button in the header. Runs already synced stay, and You → Integrate still works.',
    views: [] },
  { id: 'record', group: 'devices', label: 'Record a run',
    blurb: 'Record a run with your phone’s GPS.',
    off: 'The Record button and the Start run buttons.',
    views: ['record'] },
  { id: 'lab', group: 'devices', label: 'Kestrel Lab',
    blurb: 'The directory of open running models, and the link to it.',
    off: 'The Lab link in the header. The models behind your estimates do not change.',
    views: [] },
];

export const MODULE_IDS = MODULES.map((m) => m.id);
const KNOWN = new Set(MODULE_IDS);

// Runner types. `on` is the training side only: watch sync vs phone recording follows from the watch the runner has
// (deviceModules), and a team's owner or captain always keeps Team.
export const PRESETS = [
  { id: 'starter', label: 'Just getting started', who: 'New to running, or building the habit.',
    on: ['coach', 'goals', 'recovery'] },
  { id: 'team', label: 'School or club team', who: 'High school, college and club runners training with a team.',
    on: ['team', 'coach', 'workouts', 'fitness', 'goals', 'recovery', 'records'] },
  { id: 'distance', label: 'Half or full marathon', who: 'Adults training for the long races: long-run fueling, shoe miles, steady volume.',
    on: ['coach', 'workouts', 'fitness', 'goals', 'recovery', 'xtrain', 'fuel', 'shoes', 'records'] },
  { id: 'comeback', label: 'Coming back', who: 'Returning from an injury or a long break.',
    on: ['coach', 'goals', 'recovery', 'xtrain'] },
  { id: 'everything', label: 'Everything', who: 'Every tool on, the way Kestrel has always looked.',
    on: MODULE_IDS },
];

// A watch (anything but none) means runs arrive by sync; no watch means the phone records them.
export function deviceModules(profile) {
  const w = String(profile?.watch || '');
  return w && w !== 'none' ? ['sync'] : ['record'];
}

// The modules a preset turns on for this runner.
export function presetOn(preset, { profile = {}, lead = false } = {}) {
  if (preset.id === 'everything') return [...MODULE_IDS];
  const on = new Set([...preset.on, ...deviceModules(profile)]);
  if (lead) on.add('team');
  return MODULE_IDS.filter((id) => on.has(id));
}
export const offFrom = (on) => MODULE_IDS.filter((id) => !on.includes(id));

const SCHOOL = ['Middle school', 'Freshman', 'Sophomore', 'Junior', 'Senior', 'College'];

// Which preset to suggest, from what the runner already told Kestrel at setup.
export function suggestPreset({ profile = {}, user = {}, teams = [], year = new Date().getFullYear() } = {}) {
  const age = profile.birth_year ? year - Number(profile.birth_year) : null;
  const miles = profile.weekly_miles == null || profile.weekly_miles === '' ? null : Number(profile.weekly_miles);
  const onTeam = teams.length > 0;
  const young = (age != null && age <= 22) || SCHOOL.includes(user.class_year);
  if (profile.goal === 'comeback') return 'comeback';
  if (onTeam && (young || profile.goal === 'team')) return 'team';
  if (/half|marathon/i.test(profile.goal_event || '')) return 'distance';
  if (profile.experience === 'new' || (miles != null && miles < 12)) return 'starter';
  if (onTeam) return 'team';
  if ((age != null && age >= 30) || (miles != null && miles >= 30)) return 'distance';
  return 'everything';
}

// Before this existed a runner could hide Run views. Those choices carry over until they save their modules.
const LEGACY_TAB = { library: 'workouts', fitness: 'fitness', goals: 'goals', kai: 'coach' };
export function legacyOff(trainTabs) {
  if (!Array.isArray(trainTabs)) return [];
  return Object.entries(LEGACY_TAB).filter(([tab]) => !trainTabs.includes(tab)).map(([, id]) => id);
}

// Only known modules survive, so a core tool can never be switched off from outside.
export const cleanOff = (v) => [...new Set((Array.isArray(v) ? v : []).map(String))].filter((id) => KNOWN.has(id));

// The runner's off-list from their saved prefs (or the legacy Run-view choices).
export function offOf(prefs) {
  return Array.isArray(prefs?.modules_off) ? cleanOff(prefs.modules_off) : legacyOff(prefs?.train_tabs);
}

// What the app and the coach get: the registry, the presets worked out for this runner, and the suggestion.
export function moduleMeta({ profile = {}, user = {}, teams = [] } = {}) {
  const lead = teams.some((t) => t.role === 'owner' || t.role === 'captain');
  return {
    groups: GROUPS,
    core: CORE,
    list: MODULES,
    presets: PRESETS.map((p) => ({ id: p.id, label: p.label, who: p.who, off: offFrom(presetOn(p, { profile, lead })) })),
    suggested: suggestPreset({ profile, user, teams }),
  };
}

// For the coach: the names of the tools this runner has hidden, so it doesn't send them to a screen they can't see.
export function hiddenTools(prefs) {
  const off = new Set(offOf(prefs));
  return MODULES.filter((m) => off.has(m.id)).map((m) => m.label);
}
