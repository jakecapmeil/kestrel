// Workout library. Built from the Kestrel plan menus (Tue/Thu/Sun sessions across
// plans 1-6), Jake's own XC Coach Log and Strava sessions, and standard high school
// distance training (Daniels, Lydiard, Canova-style race-specific work).
//
// Paces are written relative to current 5K race pace so one library fits every
// runner; PACE_ZONES turns a 5K time into actual per-mile paces.
//
// Fields: type, races (what it prepares you for), phase (base, build, peak,
// taper), level (1 beginner - 3 advanced), total_min (warm-up to cool-down),
// work (the hard part), main (the session), wu/cd, rec (recovery), paces,
// purpose, cues, progress (how to make it harder next time), source.

export const WORKOUT_TYPES = {
  easy: 'Easy / recovery',
  long: 'Long run',
  steady: 'Steady / aerobic',
  progression: 'Progression',
  tempo: 'Tempo',
  threshold: 'Threshold / cruise intervals',
  vo2: 'VO2max intervals',
  track: 'Track reps (speed)',
  fartlek: 'Fartlek',
  hills: 'Hills',
  strides: 'Strides / speed development',
  race_specific: 'Race-specific',
  time_trial: 'Time trial / race sim',
};

export const RACES = ['800', '1600', '3200', '5K', 'XC', '10K', 'Half'];
export const PHASES = ['base', 'build', 'peak', 'taper'];

// Multipliers on 5K pace per mile. 5K at 6:15/mi gives threshold ~6:41, which
// matches Jake's 15-min tempo gate (6:45-6:55).
export const PACE_ZONES = [
  { key: 'mile', label: 'Mile pace', factor: 0.92 },
  { key: '3200', label: '3200 pace', factor: 0.965 },
  { key: '5k', label: '5K pace', factor: 1.0 },
  { key: '10k', label: '10K pace', factor: 1.04 },
  { key: 'threshold', label: 'Threshold (comfortably hard, ~1 hr race pace)', factor: 1.07 },
  { key: 'tempo', label: 'Tempo (half-marathon pace)', factor: 1.1 },
  { key: 'steady', label: 'Steady / marathon pace', factor: 1.17 },
  { key: 'easy', label: 'Easy', factor: [1.3, 1.45] },
  { key: 'recovery', label: 'Recovery', factor: [1.45, 1.6] },
];

function fmt(sec) {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// "19:25" (5K time) -> per-mile paces for every zone.
export function pacesFrom5k(time) {
  const m = String(time || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const perMile = (Number(m[1]) * 60 + Number(m[2])) / 3.10686;
  return PACE_ZONES.map((z) => ({
    zone: z.key,
    label: z.label,
    per_mile: Array.isArray(z.factor) ? `${fmt(perMile * z.factor[0])}-${fmt(perMile * z.factor[1])}` : fmt(perMile * z.factor),
    per_400: Array.isArray(z.factor) ? null : fmt((perMile * z.factor) / 4.02336),
  }));
}

const W = (o) => o;

export const WORKOUTS = [
  // ---------------------------------------------------------------- easy
  W({ id: 'easy-30', name: 'Easy 30 + strides', type: 'easy', races: RACES, phase: PHASES, level: 1, total_min: 35,
    main: '30 min easy, then 6x20s strides with full walk-back recovery', work: '6x20s strides', paces: 'Easy: conversational, HR under ~80% max (Jake: under 162). Strides at 5K effort, relaxed, not a sprint.',
    purpose: 'Aerobic base and leg turnover without fatigue. The default day between workouts.',
    cues: 'Time is a ceiling, not a target. If HR drifts up late, slow down rather than finishing on pace.', progress: 'Add 5 min every other week, up to 45-50 min.', source: 'Jake XC Coach Log (Jul 27)' }),
  W({ id: 'recovery-25', name: 'Recovery jog', type: 'easy', races: RACES, phase: PHASES, level: 1, total_min: 25,
    main: '20-30 min very easy, flat, nothing attached', work: 'none', paces: 'Recovery pace, HR under ~72% max. Slower than you think.',
    purpose: 'Blood flow the day after a workout or race. Gets you out the door without adding load.',
    cues: 'Treadmill or soft surface is fine. Stop if anything hurts.', progress: 'Never progress this one.', source: 'Jake XC Coach Log (Jul 28)' }),
  W({ id: 'double-easy', name: 'AM/PM double', type: 'easy', races: ['5K', 'XC', '10K', 'Half'], phase: ['base', 'build'], level: 3, total_min: 75,
    main: 'AM 3 mi easy, PM 6 mi easy with strides', work: 'PM strides', paces: 'Both runs fully easy.',
    purpose: 'Higher weekly mileage without one long beat-up run. Used on the 60 mpw plan.',
    cues: 'Keep the AM run short and boring; the PM run carries the strides.', progress: 'Only add once 50+ mpw feels routine.', source: 'Kestrel plan 6 (Mon/Wed/Thu)' }),

  // ---------------------------------------------------------------- long
  W({ id: 'long-easy', name: 'Easy long run', type: 'long', races: RACES, phase: ['base', 'build', 'peak'], level: 1, total_min: 60,
    main: '50-90 min easy on a flat route, no surges', work: 'the whole run', paces: 'Easy, the same pace band as normal easy days.',
    purpose: 'Builds the aerobic engine, capillaries, and durability. Biggest single driver of XC fitness.',
    cues: 'Start at the slow end of easy. Fuel and water past 75 min. Long run is about 20-25% of weekly miles.', progress: 'Add 5-10 min per week, step back every 3rd-4th week.', source: 'Jake XC Coach Log (Jul 26), Kestrel plans 1-6 (Sun)' }),
  W({ id: 'long-blocks', name: 'Long run with 3x8-10 min', type: 'long', races: ['5K', 'XC', '10K', 'Half'], phase: ['build', 'peak'], level: 2, total_min: 75,
    main: 'Long run with 3x8 min (plans 1-2), 3x9 min (plan 3-4) or 3x10 min (plans 5-6) at 5K+25-30 sec, 2-2:30 jog between', work: '24-30 min', paces: 'Blocks at 5K pace + 25-30 s/mi (close to threshold). Rest of the run easy.',
    purpose: 'Threshold work inside a long run. Teaches you to run strong on tired legs, like the last mile of XC.',
    cues: 'Put the blocks in the middle third, not the end. Blocks should feel controlled.', progress: 'Go 3x8 -> 3x9 -> 3x10 -> 2x15.', source: 'Kestrel plans 1-6 (Sunday long run menu)' }),
  W({ id: 'long-progression', name: 'Progression long run', type: 'long', races: ['3200', '5K', 'XC', '10K', 'Half'], phase: ['build', 'peak'], level: 2, total_min: 70,
    main: 'Long run in thirds: easy, steady, then the last 10-15 min down to threshold (5K-30s is the cap)', work: 'last third', paces: 'Easy -> steady -> threshold.',
    purpose: 'Finishing strength and pacing discipline.',
    cues: 'Each third faster than the last, never the other way round. If you are tired, just jog easy.', progress: 'Lengthen the fast final section.', source: 'Kestrel plans 1-6 (Sunday long run menu)' }),
  W({ id: 'long-hilly', name: 'Hilly long run', type: 'long', races: ['XC', '5K', '10K'], phase: ['base', 'build'], level: 2, total_min: 70,
    main: '60-75 min easy over a rolling route (Prospect Park loop, Van Cortlandt back hills)', work: 'the hills', paces: 'Easy by effort: let pace slow on the climbs.',
    purpose: 'Strength and XC-specific durability without a formal workout.',
    cues: 'Run the hills by effort, not pace. Quick feet on the downhills.', progress: 'Add one more loop of hills.', source: 'Standard XC base' }),
  W({ id: 'long-fast-finish', name: 'Fast-finish long run', type: 'long', races: ['5K', 'XC', '10K', 'Half'], phase: ['peak'], level: 3, total_min: 80,
    main: '60 min easy, then 15 min at tempo, then 5 min easy', work: '15 min', paces: 'Tempo = half-marathon pace.',
    purpose: 'Race-like fatigue late in a run. A big session: use it instead of a workout that week.',
    cues: 'Do not start the fast part unless the first hour was truly easy.', progress: 'Extend fast finish to 20 min.', source: 'Standard' }),

  // ---------------------------------------------------------------- steady / progression
  W({ id: 'steady-40', name: 'Steady state', type: 'steady', races: ['5K', 'XC', '10K', 'Half'], phase: ['base', 'build'], level: 2, total_min: 55,
    main: '10 min easy, 30-40 min steady, 5-10 min easy', work: '30-40 min', paces: 'Steady/marathon pace: faster than easy, well short of tempo.',
    purpose: 'Aerobic strength in base season. Bridges easy running and tempo.',
    cues: 'You should be able to say a sentence. HR around 80-85% max.', progress: 'Add 5 min per week.', source: 'Standard (Lydiard base)' }),
  W({ id: 'prog-thirds', name: '30-min progression', type: 'progression', races: ['1600', '3200', '5K', 'XC'], phase: ['base', 'build', 'peak'], level: 1, total_min: 45,
    main: '10 min easy, 10 min steady, 10 min threshold, 10 min cool-down', work: '20 min', paces: 'Easy -> steady -> threshold.',
    purpose: 'A gentle first workout. Teaches you to run faster without straining.',
    cues: 'Good beginner workout or a first workout back from a break.', progress: 'Make each section 12, then 15 min.', source: 'Standard' }),
  W({ id: 'prog-5k-minus-30', name: 'Progression to 5K-30', type: 'progression', races: ['5K', 'XC'], phase: ['build'], level: 2, total_min: 50,
    main: 'Start easy and drop roughly 10-15 s/mi every mile, finishing at 5K pace minus 30 s for the last half mile', work: 'last 2 miles', paces: 'Easy down to faster than 5K pace for the final stretch.',
    purpose: 'Negative splitting and closing speed.', cues: 'Patience. The first half should feel too easy.', progress: 'Add a mile at the front.', source: 'Kestrel plans 1-2 (Sunday menu)' }),

  // ---------------------------------------------------------------- tempo
  W({ id: 'tempo-15-gate', name: '15-min tempo', type: 'tempo', races: ['3200', '5K', 'XC', '10K'], phase: ['base', 'build'], level: 1, total_min: 40,
    main: '12 min wu, 15 min tempo, 11 min cd', work: '15 min', paces: 'Tempo/threshold (Jake: 6:45-6:55, HR 176-184).',
    purpose: 'First sustained threshold run of a block. Also a fitness check: run it on pace, not faster.',
    cues: 'Faster or longer is a fail, not extra credit. Even pace the whole way.', progress: '20 min, then 2x12 min, then 25 min.', source: 'Jake XC Coach Log (Jul 29 tempo gate)' }),
  W({ id: 'tempo-3mi', name: '3-mile tempo', type: 'tempo', races: ['5K', 'XC', '10K'], phase: ['build'], level: 2, total_min: 50,
    main: '1.5 mi wu, 3 mi tempo, 1.5 mi cd', work: '3 mi', paces: '5K pace + 20 s/mi.',
    purpose: 'Core XC threshold session. Raises the pace you can hold before lactate piles up.',
    cues: 'Mile 3 should be the same pace as mile 1. Find a flat loop or the track.', progress: 'Go to 4 mi, then 2x2.5 mi.', source: 'Kestrel plans 1-2 (Tuesday menu)' }),
  W({ id: 'tempo-20', name: '20-min tempo', type: 'tempo', races: ['3200', '5K', 'XC', '10K'], phase: ['build', 'peak'], level: 2, total_min: 50,
    main: '15 min wu, 20 min tempo, 10 min cd + 4 strides', work: '20 min', paces: 'Threshold.',
    purpose: 'Classic Daniels tempo. The bread and butter of distance training.', cues: 'Comfortably hard: you could hold it for close to an hour in a race.', progress: '25 min, then 2x15.', source: 'Standard (Daniels T-pace)' }),
  W({ id: 'tempo-4mi', name: '4-mile tempo', type: 'tempo', races: ['XC', '10K', 'Half'], phase: ['build', 'peak'], level: 3, total_min: 60,
    main: '2 mi wu, 4 mi tempo, 2 mi cd', work: '4 mi', paces: 'Half-marathon pace (5K + ~30 s/mi).', purpose: 'Long threshold for 50-60 mpw runners.',
    cues: 'Slightly slower than a 3-mile tempo.', progress: '5 mi, or 2x3 mi with 2 min.', source: 'Standard' }),
  W({ id: 'tempo-broken', name: 'Broken tempo 2x2 mi', type: 'tempo', races: ['5K', 'XC', '10K'], phase: ['build', 'peak'], level: 2, total_min: 55,
    main: '2 mi wu, 2x2 mi at tempo with 2 min jog, 2 mi cd', work: '4 mi', paces: 'Threshold, second rep 5 s/mi faster if it feels good.',
    purpose: 'More threshold volume than a straight tempo with less strain.', cues: 'The jog is a jog, not a stop.', progress: '3x2 mi.', source: 'Standard' }),

  // ---------------------------------------------------------------- threshold / cruise
  W({ id: 'cruise-mile-4', name: '4x mile at 5K, 200 jog', type: 'threshold', races: ['3200', '5K', 'XC'], phase: ['build', 'peak'], level: 2, total_min: 55,
    main: '2 mi wu, 4x1 mile with 200m jog, 2 mi cd', work: '4 mi', paces: '5K pace (plans 3-5). Newer runners: threshold.',
    purpose: 'The signature Kestrel Tuesday session. Race-pace endurance with short rest.', cues: 'All four within 5 seconds of each other. Rep 1 should feel easy.',
    progress: '5x mile (plan 6), or cut rest to 60s standing.', source: 'Kestrel plans 3-5 (Tuesday menu)' }),
  W({ id: 'cruise-mile-5', name: '5x mile at 5K, 200 jog', type: 'threshold', races: ['5K', 'XC', '10K'], phase: ['peak'], level: 3, total_min: 65,
    main: '2 mi wu, 5x1 mile with 200m jog, 2 mi cd', work: '5 mi', paces: '5K pace.', purpose: 'Big race-pace volume for 60 mpw runners.',
    cues: 'Hold form in reps 4-5. If rep 5 is 10+ s slower, stop at 4 next time.', progress: 'Run 1-2 s faster per rep.', source: 'Kestrel plan 6 (Tuesday menu)' }),
  W({ id: 'cruise-3mile', name: '3x mile at 5K', type: 'threshold', races: ['1600', '3200', '5K', 'XC'], phase: ['build'], level: 1, total_min: 45,
    main: '1.5 mi wu, 3x1 mile with 200 jog or 90s standing, 1.5 mi cd', work: '3 mi', paces: '5K pace.', purpose: 'First mile-rep session for 30-35 mpw runners.',
    cues: 'Learn what 5K pace feels like.', progress: '4x mile.', source: 'Kestrel plans 1-2 (Tuesday menu)' }),
  W({ id: 'cruise-k-6', name: '6x1K at 5K+15', type: 'threshold', races: ['5K', 'XC', '10K'], phase: ['build'], level: 2, total_min: 50,
    main: '2 mi wu, 6x1K at 5K+15 s/mi with 90s rest, 2 mi cd', work: '6K', paces: '5K pace + 15 s/mi.', purpose: 'Threshold-plus work with lots of volume. Thursday "medium" day.',
    cues: 'Should feel medium, not hard. You are saving the real effort for Tuesday.', progress: '8x1K (plan 6).', source: 'Kestrel plans 3-5 (Thursday menu)' }),
  W({ id: 'cruise-k-8', name: '8x1K at 5K+15', type: 'threshold', races: ['5K', 'XC', '10K'], phase: ['build', 'peak'], level: 3, total_min: 60,
    main: '2 mi wu, 8x1K at 5K+15 s/mi with 90s rest, 2 mi cd', work: '8K', paces: '5K pace + 15 s/mi.', purpose: 'Big medium-day volume for 60 mpw.',
    cues: 'Even splits. Stay relaxed in the shoulders.', progress: 'Cut rest to 60s.', source: 'Kestrel plan 6 (Thursday menu)' }),
  W({ id: 'cruise-2k-3', name: '3x2K at 5K, 2 min', type: 'threshold', races: ['5K', 'XC', '10K'], phase: ['peak'], level: 3, total_min: 55,
    main: '2 mi wu, 3x2K at 5K pace with 2 min rest, 2 mi cd', work: '6K', paces: '5K pace.', purpose: 'Long race-pace reps: as close to the race as practice gets.',
    cues: 'The middle 800 of each rep is where focus slips.', progress: '4x2K (plan 6).', source: 'Kestrel plans 3-5 (Tuesday menu)' }),
  W({ id: 'cruise-2k-4', name: '4x2K at 5K, 2 min', type: 'threshold', races: ['5K', 'XC', '10K'], phase: ['peak'], level: 3, total_min: 65,
    main: '2 mi wu, 4x2K at 5K pace with 2 min rest, 2 mi cd', work: '8K', paces: '5K pace.', purpose: 'The toughest race-pace session on the Kestrel menu.',
    cues: 'Only after a full block of mile repeats.', progress: 'This is the top of the ladder.', source: 'Kestrel plan 6 (Tuesday menu)' }),
  W({ id: 'threshold-10x400', name: '10x400 threshold', type: 'threshold', races: ['1600', '3200', '5K'], phase: ['base', 'build'], level: 1, total_min: 45,
    main: '15 min wu, 10x400 at threshold with 45s rest, 10 min cd', work: '4K', paces: 'Threshold.', purpose: 'Threshold volume in small bites, good for younger runners or track season.',
    cues: 'These should feel too easy. That is the point.', progress: '12-15x400, or 6x800.', source: 'Standard (Norwegian-style sub-threshold)' }),
  W({ id: 'threshold-double', name: 'Double threshold (AM 5x6 min / PM 10x1K)', type: 'threshold', races: ['5K', 'XC', '10K'], phase: ['build'], level: 3, total_min: 110,
    main: 'AM: 5x6 min at threshold, 1 min rest. PM: 10x1K at threshold, 1 min rest.', work: '30 min + 10K', paces: 'Just under threshold, controlled.',
    purpose: 'Norwegian method: lots of threshold time without the damage of VO2 work.', cues: 'Advanced only, 55+ mpw. Must stay controlled, never a race.',
    progress: 'Do not progress in high school; use sparingly.', source: 'Standard (Norwegian double threshold)' }),

  // ---------------------------------------------------------------- VO2max
  W({ id: 'vo2-800-6', name: '6x800 at 5K', type: 'vo2', races: ['1600', '3200', '5K', 'XC'], phase: ['build', 'peak'], level: 1, total_min: 45,
    main: '1.5 mi wu, 6x800 at 5K pace with 200 jog or 90s standing, 1.5 mi cd', work: '3 mi', paces: '5K pace.', purpose: 'Classic VO2 workout. Raises your aerobic ceiling.',
    cues: 'Same split every rep. Last two should be the hardest but not the fastest.', progress: '8x800, or 5x1K.', source: 'Kestrel plans 1-2 (Tuesday menu)' }),
  W({ id: 'vo2-k-5', name: '5x1K at 5K', type: 'vo2', races: ['3200', '5K', 'XC'], phase: ['build', 'peak'], level: 2, total_min: 50,
    main: '1.5 mi wu, 5x1K at 5K pace with 200 jog or 90s standing, 1.5 mi cd', work: '5K', paces: '5K pace.', purpose: 'A full 5K of race-pace work.',
    cues: 'Rep 3 is where you decide the workout.', progress: '6x1K faster than 5K (plans 3-5).', source: 'Kestrel plans 1-2 (Tuesday menu)' }),
  W({ id: 'vo2-k-fast', name: '6-7x1K faster than 5K', type: 'vo2', races: ['3200', '5K', 'XC'], phase: ['peak'], level: 3, total_min: 55,
    main: '2 mi wu, 6x1K (plans 3-5) or 7x1K (plan 6) at 3200-5K pace with 200 jog, 2 mi cd', work: '6-7K', paces: 'Between 3200 and 5K pace.',
    purpose: 'Pushes your top-end aerobic speed. Makes 5K pace feel easier.', cues: 'Fast, not frantic. Stay tall when it hurts.', progress: 'Cut the jog to 150m.', source: 'Kestrel plans 3-6 (Tuesday menu)' }),
  W({ id: 'vo2-3on1off', name: '6-8x(3 min on, 1 min off)', type: 'vo2', races: ['3200', '5K', 'XC'], phase: ['build'], level: 1, total_min: 45,
    main: '15 min wu, 6x3 min hard / 1 min easy (plans 1-2), 8x2:30/1 (plans 3-5) or 8x3/1 (plan 6), 10 min cd', work: '18-24 min', paces: '5K effort on the on, easy jog on the off. Great on grass.',
    purpose: 'Time-based VO2 work. Works on any terrain, perfect for XC courses.', cues: 'Keep the 1 min a real jog, not a walk.', progress: 'Add one rep, or shorten the off to 45s.', source: 'Kestrel plans 1-6 (Thursday menu)' }),
  W({ id: 'vo2-1200', name: '4x1200 at 5K, 3 min', type: 'vo2', races: ['3200', '5K', 'XC'], phase: ['peak'], level: 2, total_min: 50,
    main: '2 mi wu, 4x1200 at 5K pace with 3 min jog, 2 mi cd', work: '4.8K', paces: '5K pace.', purpose: 'Longer VO2 reps, very race-specific for 5K/XC.',
    cues: 'Lap 2 of each rep is the hard one: stay on pace.', progress: '5x1200.', source: 'Standard' }),
  W({ id: 'vo2-ladder', name: 'Ladder 400-800-1200-800-400', type: 'vo2', races: ['1600', '3200', '5K'], phase: ['build'], level: 2, total_min: 45,
    main: '15 min wu, 400-800-1200-800-400 with half-distance jog, 10 min cd', work: '3.6K', paces: '400s at 3200 pace, 800s/1200 at 5K pace.',
    purpose: 'Variety VO2 session with a fast finish.', cues: 'The last 400 is the fastest rep of the day.', progress: 'Add a 1600 at the top.', source: 'Standard' }),

  // ---------------------------------------------------------------- track
  W({ id: 'track-400-6', name: '6x400 at 5K + 4x200', type: 'track', races: ['800', '1600', '3200', '5K'], phase: ['build'], level: 1, total_min: 40,
    main: '1.5 mi wu, 6x400 at 5K pace with 200 jog, then 4x200 at mile pace with 200 jog, 1.5 mi cd', work: '2.4K + 800', paces: '5K pace, then mile pace.',
    purpose: 'Turnover plus race-pace rhythm. Thursday medium day for plans 1-2.', cues: 'The 200s are quick but smooth, not a sprint.', progress: '12x400 (plans 3-5).', source: 'Kestrel plans 1-2 (Thursday menu)' }),
  W({ id: 'track-400-12', name: '12x400 at 5K, 200 jog', type: 'track', races: ['1600', '3200', '5K', 'XC'], phase: ['build', 'peak'], level: 2, total_min: 50,
    main: '2 mi wu, 12x400 at 5K pace with 200 jog, 2 mi cd', work: '4.8K', paces: '5K pace.', purpose: 'Rhythm and volume at race pace.',
    cues: 'Lock in a split, e.g. 93-94 s for 6:15 5K pace.', progress: '16x400 (plan 6).', source: 'Kestrel plans 3-5 (Thursday menu)' }),
  W({ id: 'track-400-16', name: '16x400 at 5K, 200 jog', type: 'track', races: ['3200', '5K', 'XC'], phase: ['peak'], level: 3, total_min: 60,
    main: '2 mi wu, 16x400 at 5K pace with 200 jog, 2 mi cd', work: '6.4K', paces: '5K pace.', purpose: 'High-volume race-pace reps for 60 mpw runners.',
    cues: 'Count in sets of 4 to stay sharp mentally.', progress: 'Top of the ladder.', source: 'Kestrel plan 6 (Thursday menu)' }),
  W({ id: 'track-mile-sim', name: '4x400 at mile pace, full rest', type: 'track', races: ['800', '1600'], phase: ['peak', 'taper'], level: 2, total_min: 40,
    main: '2 mi wu + drills, 4x400 at goal mile pace with 3-4 min walk/jog, 1.5 mi cd', work: '1600', paces: 'Goal mile pace.', purpose: 'Teaches goal mile rhythm with full recovery.',
    cues: 'Hit the split exactly. Practice the lap-3 focus.', progress: '2x(3x400) or 600-400-200.', source: 'Standard' }),
  W({ id: 'track-200s', name: '10x200 at mile pace', type: 'track', races: ['800', '1600', '3200'], phase: ['build', 'peak', 'taper'], level: 1, total_min: 35,
    main: '15 min wu + drills, 10x200 at mile pace with 200 jog, 10 min cd', work: '2K', paces: 'Mile pace.', purpose: 'Speed and form without big fatigue. Good second workout in race weeks.',
    cues: 'Relaxed face and hands. Faster feet, not longer strides.', progress: '12-16x200, or 8x300.', source: 'Standard' }),
  W({ id: 'track-600s', name: '5x600 at 3200 pace', type: 'track', races: ['1600', '3200'], phase: ['peak'], level: 2, total_min: 45,
    main: '2 mi wu, 5x600 at 3200 pace with 400 jog, 1.5 mi cd', work: '3K', paces: '3200 pace.', purpose: '2-mile specific speed endurance.',
    cues: 'Hold the last 200 of each rep.', progress: 'Cut jog to 200.', source: 'Standard' }),
  W({ id: 'track-800-fast', name: '3x800 at mile-3200 pace, full rest', type: 'track', races: ['800', '1600', '3200'], phase: ['peak'], level: 3, total_min: 45,
    main: '2 mi wu + drills, 3x800 between mile and 3200 pace with 4-5 min rest, 1.5 mi cd', work: '2.4K', paces: 'Mile-3200 pace.', purpose: 'Lactate tolerance for track races.',
    cues: 'Hard session: never the week before a big XC race.', progress: '4x800.', source: 'Standard' }),
  W({ id: 'track-300s', name: '2 sets of 4x300', type: 'track', races: ['800', '1600'], phase: ['peak', 'taper'], level: 2, total_min: 40,
    main: '2 mi wu + drills, 2 sets of 4x300 at mile pace or faster, 100 walk between reps, 5 min between sets, 1.5 mi cd', work: '2.4K', paces: 'Mile pace to 800 pace.',
    purpose: 'Speed endurance for milers and 800 runners.', cues: 'Stay tall, drive arms on the curve.', progress: 'Make set 2 faster.', source: 'Standard' }),

  // ---------------------------------------------------------------- fartlek
  W({ id: 'fartlek-6x1', name: '6x1 min on / 1 min easy', type: 'fartlek', races: ['1600', '3200', '5K', 'XC'], phase: ['base'], level: 1, total_min: 32,
    main: '10 min wu, 6x(1 min on, 1 min easy), 10 min cd', work: '6 min', paces: 'On: about 5K effort. Off: easy jog.',
    purpose: 'First quality session back from a break. Wakes up the legs without strain.',
    cues: 'Only do it if your recent easy runs have actually been easy by HR.', progress: '8x1, then 4x(2 on/2 off).', source: 'Jake XC Coach Log (Jul 22)' }),
  W({ id: 'fartlek-light', name: 'Light fartlek 4x(1 hard / 2 float)', type: 'fartlek', races: ['1600', '3200', '5K', 'XC'], phase: ['base', 'build'], level: 1, total_min: 30,
    main: '1 mi wu, 4x(1 min at 5K-mile effort / 2 min float), 1 mi cd', work: '4 min', paces: 'Jake: 1 min @ 6:30, float 8:30-9:00.',
    purpose: 'Gentle intensity re-entry with a float (steady, not walking) recovery.',
    cues: 'Stick to the prescribed rep length. Jake ran 2 min reps instead: great split, wrong dose.', progress: '6x(1/2), then 5x(2/2).', source: 'Jake XC Coach Log (Jul 24)' }),
  W({ id: 'fartlek-mona', name: 'Mona fartlek (20 min)', type: 'fartlek', races: ['3200', '5K', 'XC', '10K'], phase: ['build', 'peak'], level: 2, total_min: 45,
    main: '15 min wu, then 2x90s, 4x60s, 4x30s, 4x15s on, each followed by the same time float, 10 min cd', work: '20 min', paces: 'On at 5K pace or faster (shorter = faster); float at steady, not jog.',
    purpose: 'Famous Steve Moneghetti session. Builds the ability to surge and recover while still moving.',
    cues: 'The float is the workout: keep it honest.', progress: 'Run it on hills or grass.', source: 'Standard (Moneghetti)' }),
  W({ id: 'fartlek-pyramid', name: 'Pyramid fartlek 1-2-3-4-3-2-1', type: 'fartlek', races: ['3200', '5K', 'XC'], phase: ['build'], level: 2, total_min: 50,
    main: '15 min wu, 1-2-3-4-3-2-1 min on with half the time easy jog, 10 min cd', work: '16 min', paces: '1-2 min at 3200-5K effort, 3-4 min at 5K-10K effort.',
    purpose: 'Varied pace awareness. Good on an XC course.', cues: 'Come down the pyramid faster than you went up.', progress: 'Add a 5 min at the top.', source: 'Standard' }),
  W({ id: 'fartlek-xc-surge', name: 'XC surge fartlek', type: 'fartlek', races: ['XC'], phase: ['peak'], level: 2, total_min: 45,
    main: '15 min wu, 20 min at steady with a 30s surge every 2:30 (8 surges), 10 min cd', work: '20 min', paces: 'Steady base, surges at mile effort.',
    purpose: 'Simulates the pace changes of an XC race: passing, hills, the start.', cues: 'Go back to steady right after each surge; do not slow to a jog.',
    progress: 'Make the base pace closer to threshold.', source: 'Standard XC' }),
  W({ id: 'fartlek-minutes', name: '10x1 min on / 1 min off', type: 'fartlek', races: ['1600', '3200', '5K', 'XC'], phase: ['base', 'build'], level: 1, total_min: 40,
    main: '10 min wu, 10x(1 min on / 1 min jog), 10 min cd', work: '10 min', paces: '3200-5K effort.', purpose: 'Simple, flexible VO2 intro.',
    cues: 'Use it on vacation or when there is no track.', progress: '12x, or 8x(90s/60s).', source: 'Standard' }),

  // ---------------------------------------------------------------- hills
  W({ id: 'hills-12', name: '12x hill, jog down', type: 'hills', races: ['1600', '3200', '5K', 'XC'], phase: ['base', 'build'], level: 1, total_min: 45,
    main: '1.5 mi wu, 12x hill repeat (60-75s up) with jog-down recovery, 1.5 mi cd', work: '12-15 min', paces: 'Hard by effort (about 5K effort), not pace.',
    purpose: 'Strength and power. Builds XC hill confidence and protects against injury.', cues: 'Drive knees and arms, stay on the balls of your feet, crest the top running.',
    progress: 'Add 2 reps, or a longer hill.', source: 'Kestrel plans 1-2 (Thursday menu)' }),
  W({ id: 'hills-short-sprints', name: '8x10s hill sprints', type: 'hills', races: RACES, phase: ['base', 'build', 'peak'], level: 1, total_min: 35,
    main: 'Easy run with 8x10s all-out on a steep hill at the end, full walk-down recovery (2 min)', work: '80 s', paces: 'Max effort, but short enough it never gets anaerobic.',
    purpose: 'Neuromuscular power and tendon strength. Almost zero fatigue cost.', cues: 'Start with 4. Steep hill, perfect form.', progress: 'Up to 10x12s.', source: 'Standard (Brad Hudson)' }),
  W({ id: 'hills-long', name: '6x2 min hill', type: 'hills', races: ['5K', 'XC', '10K'], phase: ['build'], level: 2, total_min: 50,
    main: '2 mi wu, 6x2 min up a long gradual hill at threshold-5K effort, jog down, 2 mi cd', work: '12 min', paces: 'Threshold to 5K effort.', purpose: 'Aerobic strength on hills. XC-specific.',
    cues: 'Even effort to the top. Run the downhill quick and relaxed.', progress: '8x2 min.', source: 'Standard XC' }),
  W({ id: 'hills-circuit', name: 'Hill circuit (up hard, over the top)', type: 'hills', races: ['XC'], phase: ['peak'], level: 2, total_min: 50,
    main: '2 mi wu, 6-8x(hill at 5K effort + 200m at 5K pace past the crest), easy jog back, 2 mi cd', work: '15 min', paces: '5K effort.',
    purpose: 'Practicing the XC move that wins races: pushing over the top of a hill.', cues: 'Most runners ease off at the crest. You do not.', progress: 'Extend past the crest to 300m.', source: 'Standard XC' }),

  // ---------------------------------------------------------------- strides / speed
  W({ id: 'strides-6x20', name: '6x20s strides, walk back', type: 'strides', races: RACES, phase: PHASES, level: 1, total_min: 8,
    main: 'After an easy run: 6x20s strides with 60-75s walk-back recovery', work: '2 min', paces: 'Jake: ~6:15/mi in weeks 1-2, ~5:50 week 3, ~5:25 week 4, ~5:00 week 5.',
    purpose: 'Keeps speed and form sharp all season with almost no cost.', cues: 'Walk back, do not jog: full recovery is the point.', progress: 'Pace drops a little each week, never the volume.', source: 'Jake XC Coach Log (Jul 27)' }),
  W({ id: 'strides-flys', name: '4x30m flys', type: 'strides', races: ['800', '1600', '3200'], phase: ['peak', 'taper'], level: 2, total_min: 25,
    main: 'Drills, then 4x(30m build + 30m fast + 30m float), full recovery', work: '2 min', paces: 'Near top speed in the middle 30m.', purpose: 'Top-end speed for track season kicks.',
    cues: 'Relaxed speed. Tension is slow.', progress: '6x.', source: 'Standard' }),
  W({ id: 'drills-form', name: 'Drill and form session', type: 'strides', races: RACES, phase: ['base', 'build'], level: 1, total_min: 20,
    main: 'A-skips, B-skips, high knees, butt kicks, carioca, straight-leg bounds (2x20m each), then 4 strides', work: 'drills', paces: 'Quality over speed.',
    purpose: 'Coordination, posture and efficiency.', cues: 'Do these before every workout as part of the warm-up.', progress: 'Add bounding and single-leg hops.', source: 'Standard' }),

  // ---------------------------------------------------------------- race specific
  W({ id: 'race-5k-broken', name: 'Broken 5K (2K-1600-800-400)', type: 'race_specific', races: ['5K', 'XC'], phase: ['peak'], level: 3, total_min: 55,
    main: '2 mi wu, 2K - 1600 - 800 - 400 at goal 5K pace with 90s rest, 2 mi cd', work: '4.8K', paces: 'Goal 5K pace, last 400 faster.', purpose: 'A rehearsal of your goal race split into pieces.',
    cues: 'If you can run this on pace with 90s rest, the goal is realistic.', progress: 'Cut rests to 60s.', source: 'Standard' }),
  W({ id: 'race-xc-change', name: 'XC change-of-pace 3x(1K tempo + 400 fast)', type: 'race_specific', races: ['XC', '5K'], phase: ['peak'], level: 3, total_min: 55,
    main: '2 mi wu, 3x(1K at threshold straight into 400 at 3200 pace), 3 min jog between sets, 2 mi cd', work: '4.2K', paces: 'Threshold into 3200 pace with no break.',
    purpose: 'Teaches you to throw in a surge while already tired: race tactics.', cues: 'The 400 is where races are won.', progress: '4 sets.', source: 'Standard XC' }),
  W({ id: 'race-mile-cut', name: 'Cutdown 1200-800-400', type: 'race_specific', races: ['1600', '3200'], phase: ['peak'], level: 2, total_min: 45,
    main: '2 mi wu + drills, 1200 at 3200 pace, 800 at mile pace, 400 faster than mile pace, 3-4 min rest, 1.5 mi cd', work: '2.4K', paces: '3200 -> mile -> faster.',
    purpose: 'Closing speed for track distance races.', cues: 'Run the 400 like the last lap of a race.', progress: 'Do it twice with 8 min between.', source: 'Standard' }),
  W({ id: 'race-10k-tempo-reps', name: '3x2 mi at 10K pace', type: 'race_specific', races: ['10K', 'Half'], phase: ['peak'], level: 3, total_min: 75,
    main: '2 mi wu, 3x2 mi at 10K pace with 3 min jog, 2 mi cd', work: '6 mi', paces: '10K pace.', purpose: 'Specific endurance for longer races.',
    cues: 'Patience in rep 1.', progress: '2x3 mi.', source: 'Standard' }),
  W({ id: 'race-half-mp', name: '2x4 mi at half pace', type: 'race_specific', races: ['Half'], phase: ['peak'], level: 3, total_min: 90,
    main: '2 mi wu, 2x4 mi at goal half-marathon pace with 1 mi easy, 2 mi cd', work: '8 mi', paces: 'Goal half pace (about tempo).', purpose: 'Half-marathon rehearsal.',
    cues: 'Practice fueling on the easy mile.', progress: '10 mi continuous at goal pace 3 weeks out.', source: 'Standard' }),
  W({ id: 'race-week-opener', name: 'Pre-race opener', type: 'race_specific', races: RACES, phase: ['taper'], level: 1, total_min: 30,
    main: '15-20 min easy, 4x200 at race pace with full recovery, 4 strides', work: '800', paces: 'Race pace, smooth.', purpose: 'Day-before-or-2-days-out sharpener: wakes the legs up without tiring them.',
    cues: 'Should leave you feeling fresh and a little restless.', progress: 'None.', source: 'Standard (shakeout + strides)' }),
  W({ id: 'race-week-light', name: 'Race-week workout (lighter)', type: 'race_specific', races: ['5K', 'XC'], phase: ['taper'], level: 1, total_min: 40,
    main: '1.5 mi wu, 2 mi of work (e.g. 4x800 or 3x1K at 5K pace), 1.5 mi cd', work: '2 mi', paces: '5K pace, no faster.', purpose: 'Matches the Kestrel race-week "5 (2 WO)" day: sharp but short.',
    cues: 'Finish feeling like you could do two more.', progress: 'None: taper is about less.', source: 'Kestrel plans 1-6 (race-week Thursday)' }),
  W({ id: 'shakeout', name: 'Shakeout', type: 'easy', races: RACES, phase: ['taper'], level: 1, total_min: 20,
    main: '2-3 mi very easy with 2-4 strides', work: 'strides', paces: 'Easy.', purpose: 'Day before or morning of a race. Loosens up, settles nerves.',
    cues: 'Optional on Friday for plans 5-6. Short and boring is perfect.', progress: 'None.', source: 'Kestrel plans 5-6 (Friday shakeout)' }),

  // ---------------------------------------------------------------- time trials
  W({ id: 'tt-mile', name: 'Mile time trial', type: 'time_trial', races: ['800', '1600', '3200'], phase: ['build', 'peak'], level: 2, total_min: 40,
    main: '2 mi wu + drills + 4 strides, 1 mile all-out, 1.5 mi cd', work: '1 mi', paces: 'All out, even laps.', purpose: 'Fitness check and pace-calculator input.',
    cues: 'Lap 3 decides it.', progress: 'Repeat every 4-6 weeks.', source: 'Standard' }),
  W({ id: 'tt-3k', name: '3K / 2-mile time trial', type: 'time_trial', races: ['3200', '5K', 'XC'], phase: ['build'], level: 2, total_min: 45,
    main: '2 mi wu + strides, 3K or 2 mi at hard race effort, 2 mi cd', work: '2 mi', paces: 'Race effort.', purpose: 'Sets 5K training paces when there has been no recent race.',
    cues: 'Use the result to update your 5K pace (3200 time x ~1.65).', progress: 'Repeat mid-season.', source: 'Standard' }),
  W({ id: 'tt-5k-sim', name: '5K course rehearsal', type: 'time_trial', races: ['5K', 'XC'], phase: ['peak'], level: 3, total_min: 55,
    main: '2 mi wu, 2 mi on the actual race course at goal pace, 2 min rest, 1 mi at goal pace, 2 mi cd', work: '3 mi', paces: 'Goal 5K pace.',
    purpose: 'Learn the course (Van Cortlandt hills, the flats) at race pace.', cues: 'Note where to push and where to hold on.', progress: 'Do it 10-14 days before the big race.', source: 'Standard XC' }),

  // ---------------------------------------------------------------- Jake's own sessions (from his Strava, Oct 2025 - May 2026)
  W({ id: 'jake-2to1-tempo', name: '2:1 tempo (5x 2 min tempo / 1 min surge)', type: 'tempo', races: ['1600', '3200', '5K', 'XC'], phase: ['base', 'build'], level: 2, total_min: 40,
    main: '1 mi wu + strides, then 15 min continuous: 5x(2 min at tempo, 1 min surge at 5K-3200 pace) with no rest, 1 mi cd', work: '15 min', paces: 'Jake (Mar 1 2026): 2 min at ~6:50/mi, 1 min at ~5:30-6:00/mi.',
    purpose: 'Tempo with built-in surges. Teaches you to lift the pace and settle back without dropping to a jog.',
    cues: 'Settle back to tempo, not to easy, after each surge. The last rep is the test.', progress: '6 sets, or 3 min tempo / 1 min surge.', source: "Jake's Strava (Mar 1 2026)" }),
  W({ id: 'jake-3to1-fartlek', name: '3:1 fartlek (6x 3 min steady / 1 min hard)', type: 'fartlek', races: ['3200', '5K', 'XC'], phase: ['base', 'build'], level: 2, total_min: 45,
    main: '1.5 mi wu, then 6x(3 min steady, 1 min hard) continuous, 0.75 mi cd', work: '24 min', paces: 'Jake (Mar 22 2026): 3 min at ~7:00/mi, 1 min at ~5:00-5:30/mi.',
    purpose: 'Aerobic strength with surges. Great on a hilly loop for XC.', cues: 'Surges on uphills are allowed: run them by effort.', progress: 'Make the steady part closer to tempo.', source: "Jake's Strava (Mar 22 2026)" }),
  W({ id: 'jake-mile-800-800', name: 'Mile - 800 - 800', type: 'vo2', races: ['1600', '3200', '5K'], phase: ['build'], level: 2, total_min: 40,
    main: '1 mi wu, 1 mile at 5K pace, 800 at 3200 pace, 800 at 3200 pace, 3-4 min jog between, 1 mi cd', work: '2 mi', paces: 'Jake (Feb 27 2026): 6:00, 2:40, 2:40.',
    purpose: 'Short season-opener session: a 5K-pace mile, then faster 800s on tired legs.', cues: 'Hold the 800s even with each other.', progress: 'Mile - 800 - 800 - 400.', source: "Jake's Strava (Feb 27 2026)" }),
  W({ id: 'jake-mile-tempo-800s', name: 'Mile tempo + 3x800', type: 'threshold', races: ['1600', '3200', '5K', 'XC'], phase: ['build', 'peak'], level: 2, total_min: 45,
    main: '0.5 mi wu, 1 mile at threshold, 3 min jog, 3x800 at 3200-5K pace with 2-3 min jog, 4x75m strides, cd', work: '1 mi + 2400', paces: 'Jake (Oct 29 2025): mile 6:39, 800s at ~2:45-2:50 (5:40/mi).',
    purpose: 'Combo session: threshold to pre-load fatigue, then faster reps.', cues: 'Do not race the mile. The 800s are the point.', progress: '4x800.', source: "Jake's Strava (Oct 29 2025)" }),
  W({ id: 'jake-800s-600s', name: '4x800 + 2x600', type: 'vo2', races: ['1600', '3200', '5K', 'XC'], phase: ['peak'], level: 2, total_min: 50,
    main: '1.5 mi wu, 4x800 with 400 jog, then 2x600 with 400 jog, cd', work: '4400m', paces: 'Jake (Nov 18 2025): 800s at 2:42-2:53, 600s at 2:45 (~5:40/mi).',
    purpose: 'Late-season VO2 volume.', cues: 'The 600s should match 800 pace, not slow down.', progress: '5x800 + 2x600.', source: "Jake's Strava (Nov 18 2025)" }),
  W({ id: 'jake-6x400', name: '6x400 at ~1:12, 200 jog', type: 'track', races: ['800', '1600', '3200'], phase: ['build', 'peak'], level: 1, total_min: 35,
    main: '1-1.5 mi wu + strides, 6x400 with 200 jog (optionally + 1x200), 4-5 strides, cd', work: '2400m', paces: 'Jake (Mar-Apr 2026): 1:09-1:17, target ~1:15 (mile pace + 1-2 s).',
    purpose: 'The staple track-season session: mile-pace rhythm.', cues: 'Hit the target, not faster: faster than coach wants costs you the later reps.', progress: '8x400, or cut jog to 100.', source: "Jake's Strava (Mar 29, Apr 12, Apr 23 2026)" }),
  W({ id: 'jake-200s', name: '6-8x200 at 30-32', type: 'track', races: ['800', '1600'], phase: ['build', 'peak', 'taper'], level: 1, total_min: 35,
    main: '1-1.5 mi wu, 6-8x200 with 200 jog, finish with a 300, cd', work: '1.6K', paces: 'Jake (Apr 2026): 200s in 30-34 s, 300 in 47 s.',
    purpose: 'Speed and turnover for 800/1600 racing.', cues: 'Relaxed and quick. Same time on every rep.', progress: '10x200, or 4x300.', source: "Jake's Strava (Apr 16, Apr 30 2026)" }),
  W({ id: 'jake-steady-cutdown', name: '2 mi steady + 800-600-300-300', type: 'race_specific', races: ['1600', '3200'], phase: ['peak'], level: 2, total_min: 50,
    main: '1 mi wu, 2 mi steady, then 800, 600, 2x300 cutting down, strides, cd', work: '2 mi + 2000m', paces: 'Jake (Apr 15 2026): miles 7:42/7:38, 600 2:04, 300s ~1:00.',
    purpose: 'Strength into speed: aerobic miles then a cutdown on tired legs.', cues: 'Each rep faster than the last.', progress: 'Add a 400 at the end.', source: "Jake's Strava (Apr 15 2026)" }),
  W({ id: 'jake-3x800', name: '3x800 at ~2:50', type: 'vo2', races: ['1600', '3200', '5K'], phase: ['build', 'peak'], level: 1, total_min: 40,
    main: '2 mi wu, 3x800 with 2-3 min jog, strides, cd', work: '2400m', paces: 'Jake (May 2026): 2:33-2:53.',
    purpose: 'Short VO2 session for track season.', cues: 'Even splits. Back off if you start coughing hard.', progress: '4x800.', source: "Jake's Strava (May 5, May 11 2026)" }),
  W({ id: 'jake-800s-200s', name: '2x800 + 4x200', type: 'race_specific', races: ['800', '1600'], phase: ['peak', 'taper'], level: 2, total_min: 45,
    main: '0.5 mi wu, 2x800 at goal 1600 pace with 3 min rest, 4x200 at 800 pace, 2 mi easy', work: '2400m', paces: 'Jake (May 7 2026): 800s 2:27-2:28 (~4:55/mi), 200s 27-29 s.',
    purpose: 'Mile race prep: goal pace then speed.', cues: 'Smooth through 600 of each 800.', progress: '3x800.', source: "Jake's Strava (May 7 2026)" }),
  W({ id: 'jake-mixed-200-400', name: '800, then 200-200-200-400-200-200', type: 'track', races: ['800', '1600'], phase: ['peak'], level: 2, total_min: 55,
    main: '2 mi easy, 800 at 3200 pace, then 200-200-200-400-200-200 with 200 jog, 2 mi easy', work: '2000m', paces: 'Jake (May 12 2026): 800 2:51, 200s 33-34, 400 1:07.',
    purpose: 'Mixed speed set with a fast 400 in the middle.', cues: 'The 400 should be the fastest pace of the day.', progress: 'Make it 2 sets.', source: "Jake's Strava (May 12 2026)" }),
  W({ id: 'jake-hill-35s', name: '8-12x35s hill', type: 'hills', races: ['800', '1600', '3200', '5K', 'XC'], phase: ['base'], level: 1, total_min: 35,
    main: '1-1.5 mi wu, 8-12x35 s up a steady hill with walk/jog-down, cd', work: '5-7 min', paces: 'Hard by effort; HR climbs from ~130 to ~160 over the set.',
    purpose: 'Winter base strength and power when there is no track.', cues: 'Same effort every rep, tall posture, drive arms.', progress: 'Add 2 reps every week.', source: "Jake's Strava (Nov 20, Dec 4 2025, Feb 10, Mar 5 2026)" }),
  W({ id: 'jake-steady-5', name: '5 mi steady + strides', type: 'steady', races: ['3200', '5K', 'XC'], phase: ['base', 'build'], level: 2, total_min: 50,
    main: '5 miles steady, then 4x100 strides', work: '5 mi', paces: 'Jake (Mar-Apr 2026): ~7:40-7:57/mi, HR 170-174.',
    purpose: 'Aerobic strength in track season.', cues: 'Jake ran these at HR 170+: they should be closer to 160 to stay steady, not tempo.', progress: '6 miles.', source: "Jake's Strava (Mar 25, Apr 22 2026)" }),
  W({ id: 'jake-progression-4', name: '4 mi progression', type: 'progression', races: ['3200', '5K', 'XC'], phase: ['build'], level: 2, total_min: 30,
    main: '4 miles getting faster each mile, last mile at threshold', work: '4 mi', paces: 'Jake (Apr 19 2026): ~7:30 down to ~6:45/mi.',
    purpose: 'A short, sharp aerobic session.', cues: 'Start slower than you want.', progress: '5 miles.', source: "Jake's Strava (Apr 19 2026)" }),
];

export function findWorkouts({ type, race, phase, level, max_min, min_min, q } = {}) {
  const query = String(q || '').toLowerCase();
  return WORKOUTS.filter((w) =>
    (!type || w.type === type)
    && (!race || w.races.includes(race))
    && (!phase || w.phase.includes(phase))
    && (!level || w.level <= level)
    && (!max_min || w.total_min <= max_min)
    && (!min_min || w.total_min >= min_min)
    && (!query || `${w.name} ${w.main} ${w.purpose} ${w.source}`.toLowerCase().includes(query)));
}

// ------------------------------------------------------------------ parsing

const MILE_M = 1609.344;
const toSec = (s) => {
  const p = String(s).split(':').map(Number);
  return p.some((x) => !Number.isFinite(x)) ? null : p.reduce((a, x) => a * 60 + x, 0);
};

// Work reps out of a splits line: "800m 2:45 (5:32/mi, 178); 1 mi 5:40" or
// "800 2:45, 800 2:44". Plain times with no distance ("6:47, 6:33") can't be
// turned into paces, so they give nothing.
export function parseReps(text) {
  const out = [];
  const re = /(\d+(?:\.\d+)?)\s*(m|k|km|mi|mile)?\s+(\d{1,2}:\d{2}(?:\.\d)?|\d{2,3}(?:\.\d)?\s*s)\b/gi;
  for (const m of String(text || '').matchAll(re)) {
    const n = Number(m[1]);
    const unit = (m[2] || '').toLowerCase();
    const meters = unit === 'k' || unit === 'km' ? n * 1000 : unit === 'mi' || unit === 'mile' ? n * MILE_M : n;
    const s = m[3].includes(':') ? toSec(m[3]) : Number(m[3].replace(/s/i, ''));
    if (meters >= 100 && meters <= 10000 && s > 10) out.push({ m: Math.round(meters), s });
  }
  return out;
}

// Zone a phrase refers to: "5K pace + 15 s/mi", "3200-5K pace", "threshold",
// "goal mile pace", "half-marathon pace". Returns { keys, offset } or null.
const ZONE_WORDS = [
  [/half[- ]?marathon|goal half|\btempo\b/, 'tempo'],
  [/threshold/, 'threshold'],
  [/\bsteady\b|marathon/, 'steady'],
  [/\b10k\b/, '10k'],
  [/\b5k\b/, '5k'],
  [/\b3200\b|\b2 ?mile\b|\b3k\b/, '3200'],
  [/\bmile\b|\b1600\b|\b1500\b/, 'mile'],
  [/\b800\b/, '800'],
  [/\b400\b/, '400'],
  [/\beasy\b|\bfloat\b|\bjog\b/, 'easy'],
];

export function zoneOf(text) {
  const t = String(text || '').toLowerCase();
  const between = t.match(/(?:between\s+)?(mile|1600|3200|5k|10k)\s*(?:-|and|to)\s*(mile|1600|3200|5k|10k)\s*(?:pace|effort)/);
  const norm = (k) => (k === '1600' ? 'mile' : k);
  const offset = (() => {
    const o = t.match(/([+-])\s*(\d{1,2})(?:-(\d{1,2}))?\s*(?:s|sec)/);
    if (!o) return 0;
    const v = o[3] ? (Number(o[2]) + Number(o[3])) / 2 : Number(o[2]);
    return o[1] === '-' ? -v : v;
  })();
  if (between) return { keys: [norm(between[1]), norm(between[2])], offset };
  const at = t.match(/(?:at|@)\s+([^,;()]+)/);
  const faster = /faster than/.test(t) && !offset ? -5 : 0;
  // The zone named first wins ("5K pace (plans 3-5). Newer runners: threshold").
  for (const scope of [at?.[1], t]) {
    if (!scope) continue;
    let best = null;
    for (const [re, key] of ZONE_WORDS) {
      // A distance word is only a zone when "pace" or "effort" follows it,
      // or when it's what the reps are run "at" ("12x400 at 5k").
      const bare = scope === at?.[1];
      const full = ['10k', '5k', '3200', 'mile', '800', '400'].includes(key) && !bare ? new RegExp(`(?:${re.source})[^,;]{0,12}(pace|effort)`) : re;
      const m = scope.match(full);
      if (m && (!best || m.index < best.index)) best = { index: m.index, key };
    }
    if (best) return { keys: [best.key], offset: offset + faster };
  }
  return null;
}

// Each work segment of a session: "6x800 at 5K pace" -> { reps: 6, m: 800 }.
export function segmentsOf(main) {
  const flat = String(main || '').replace(/\(([^)]*)\)/g, (_, inner) => '(' + inner.replace(/,/g, ' /') + ')');
  const out = [];
  for (let clause of flat.split(/[,;]|\bthen\b|\binto\b/i)) {
    clause = clause.split(/\bwith\b|\bfull\b/i)[0].trim();
    if (!clause || /\b(wu|cd|warm|cool|drills|walk)\b/i.test(clause) && !/\d+\s*x/i.test(clause)) continue;
    // Ladders: "400-800-1200-800-400 ..." or "2K - 1600 - 800 - 400 at ...".
    const ladder = clause.match(/^(\d+(?:\.\d+)?k?\s*(?:-\s*\d+(?:\.\d+)?k?\s*){2,})/i);
    if (ladder) {
      const rest = clause.slice(ladder[0].length);
      for (const part of [...new Set(ladder[1].split('-').map((x) => x.trim().toLowerCase()))]) {
        const m = part.endsWith('k') ? Number(part.slice(0, -1)) * 1000 : Number(part);
        if (m >= 100) out.push({ text: `${part} ${rest}`.trim(), reps: 1, m });
      }
      continue;
    }
    const reps = clause.match(/(\d+)\s*x\s*\(?\s*(\d+(?:\.\d+)?)\s*(k\b|m\b|mi\b|mile|miles|min|s\b|sec)?/i)
      || (() => { const u = clause.match(/(\d+)\s*x\s*(mile|k)\b/i); return u ? [u[0], u[1], '1', u[2]] : null; })()
      || (() => { const t = clause.match(/^(\d+)\s*\(\s*(\d+):(\d{2})\s*min/i) || clause.match(/^(\d+)\s*\(\s*(\d+)\s*(min)/i); return t ? (t[3] && /^\d{2}$/.test(t[3]) ? [t[0], t[1], String(Number(t[2]) * 60 + Number(t[3])), 's'] : [t[0], t[1], t[2], 'min']) : null; })();
    const single = clause.match(/^(?:am:|pm:)?\s*(\d+(?:\.\d+)?)(?:\s*-\s*\d+(?:\.\d+)?)?\s*(k\b|m\b|mi\b|mile|miles|min)?\b/i);
    const hit = reps ? { n: Number(reps[1]), v: Number(reps[2]), u: (reps[3] || '').toLowerCase() } : single ? { n: 1, v: Number(single[1]), u: (single[2] || '').toLowerCase() } : null;
    if (!hit) continue;
    let m = null, sec = null;
    if (hit.u === 'min') sec = hit.v * 60;
    else if (hit.u === 's' || hit.u === 'sec') sec = hit.v;
    else if (hit.u === 'k') m = hit.v * 1000;
    else if (hit.u.startsWith('mi')) m = hit.v * MILE_M;
    else if (hit.v >= 100) m = hit.v;
    else continue;
    // "6x(1 min on / 1 min easy)": only the part before the slash is work.
    if (m && m < 150) continue; // strides
    out.push({ text: clause.split(' /')[0], reps: hit.n, m, sec });
  }
  return out;
}

// Which picker tile a workout belongs to.
export function workoutGroup(w) {
  if (['tempo', 'threshold', 'progression', 'steady'].includes(w.type)) return 'tempo';
  if (w.type === 'fartlek') return 'fartlek';
  if (['easy', 'long', 'strides'].includes(w.type)) return 'aerobic';
  const segs = segmentsOf(w.main).filter((s) => s.reps > 1 || s.m);
  const longest = Math.max(0, ...segs.map((s) => s.m || (s.sec ? s.sec * 4 : 0)));
  if (w.type === 'time_trial') return 'race';
  return longest >= 750 ? 'long' : 'short';
}

export const WORKOUT_GROUPS = {
  tempo: 'Tempo',
  short: 'Short intervals',
  long: 'Long intervals',
  fartlek: 'Fartlek',
  aerobic: 'Easy / long',
  race: 'Time trials',
};

// The runner's own targets for a library workout, from their Fitness States:
// [{ text: "6 x 800m", zone: "5K pace", per_mile: "5:46", per_rep: "2:52" }].
export function workoutTargets(w, fitness) {
  if (!fitness?.zones?.length) return [];
  const zoneSec = (key) => {
    const z = fitness.zones.find((x) => x.key === key);
    return z ? (Array.isArray(z.sec) ? (z.sec[0] + z.sec[1]) / 2 : z.sec) : null;
  };
  const labelOf = (key) => fitness.zones.find((x) => x.key === key)?.label || key;
  // Hill reps are run by effort, not pace.
  if (w.type === 'hills') return [];
  const TYPE_ZONE = { vo2: '5k', track: 'mile', threshold: 'threshold', tempo: 'tempo', fartlek: '5k', race_specific: '5k', steady: 'steady', progression: 'threshold' };
  const fallback = zoneOf(w.paces) || (TYPE_ZONE[w.type] ? { keys: [TYPE_ZONE[w.type]], offset: 0 } : null);
  const out = [];
  const pacesFor = (m) => String(w.paces).split(/[,;]/).find((c) => m && new RegExp(`\\b${m}s?\\b`).test(c));
  for (const seg of segmentsOf(w.main)) {
    const z = zoneOf(seg.text) || zoneOf(pacesFor(seg.m)) || (seg.reps > 1 || seg.m ? fallback : null);
    if (!z || z.keys[0] === 'easy') continue;
    const secs = z.keys.map(zoneSec).filter(Boolean);
    if (!secs.length) continue;
    const pace = secs.reduce((a, b) => a + b, 0) / secs.length + z.offset;
    const fmt = (s) => { const r = Math.round(s * 10) / 10; const m = Math.floor(r / 60); const ss = r - m * 60; return m ? `${m}:${(s < 120 ? ss.toFixed(1) : String(Math.round(ss))).padStart(s < 120 ? 4 : 2, '0')}` : r.toFixed(1); };
    const miles = seg.m / MILE_M;
    const dist = seg.m ? (seg.m % 1000 === 0 && seg.m >= 1000 ? `${seg.m / 1000}K` : miles >= 0.99 && Math.abs(miles - Math.round(miles)) < 0.01 ? (Math.round(miles) === 1 ? '1 mile' : `${Math.round(miles)} mi`) : `${Math.round(seg.m)}m`) : seg.sec >= 60 ? `${seg.sec / 60} min` : `${seg.sec}s`;
    out.push({
      text: seg.reps > 1 ? `${seg.reps} x ${dist}` : dist,
      zone: z.keys.map(labelOf).join(' - ').replace(/ pace - /, ' - ') + (z.offset ? ` ${z.offset > 0 ? '+' : ''}${z.offset}s/mi` : ''),
      per_mile: fmt(pace),
      per_rep: seg.m ? fmt((pace / MILE_M) * seg.m) : `~${Math.round((seg.sec / pace) * MILE_M / 10) * 10}m`,
    });
  }
  return out;
}

// ------------------------------------------------------------------ track

// On the track, distances are what the lines say, not what GPS says: reps
// snap to the nearest 100 m, a mile is 1600 m, mileage is in eighths (one
// eighth = 200 m) and there is no elevation.
export const TRACK_MILE_M = 1600;
export const snap100 = (m) => Math.max(100, Math.round(m / 100) * 100);
export const trackMiles = (mi) => Math.round(mi * 8) / 8;
export const trackMilesFromMeters = (m) => Math.round((m / TRACK_MILE_M) * 8) / 8;

// A watch session that was run on a track: "track" in the name or sport,
// or flat work reps that sit on 100 m marks (not mile/km auto-laps).
export function looksLikeTrack({ name = '', type = '', elevFtPerMile = 0, laps = [] }) {
  if (/track/i.test(type) || /\btrack\b|\boval\b|\d+\s*x\s*[2-8]00\b/i.test(name)) return true;
  if (laps.length < 3 || elevFtPerMile > 20) return false;
  const autoLaps = laps.every((l) => Math.abs(l.m - 1609) < 25 || Math.abs(l.m - 1000) < 20);
  if (autoLaps) return false;
  const onMarks = laps.filter((l) => l.m >= 150 && Math.abs(l.m - snap100(l.m)) <= Math.max(12, l.m * 0.035));
  return onMarks.length / laps.length >= 0.8;
}

// ------------------------------------------------------------------ personal

// "3x8 min (plans 1-2), 3x9 min (plan 3-4) or 3x10 min (plans 5-6)" -> the
// variant for this runner's plan level (1-6), so each workout reads as
// written for them.
export function resolveVariants(text, rank) {
  const s = String(text || '');
  const alts = [...s.matchAll(/([^,;()]+?)\s*\(plans?\s*(\d)(?:\s*-\s*(\d))?\)/gi)];
  if (alts.length < 2 || !rank) return s.replace(/\s*\(plans?\s*\d(?:\s*-\s*\d)?\)/gi, '');
  const inRange = (m) => rank >= Number(m[2]) && rank <= Number(m[3] || m[2]);
  const pick = alts.find(inRange) || (rank < Number(alts[0][2]) ? alts[0] : alts[alts.length - 1]);
  const core = (m) => m[1].replace(/^\s*(or|and)\s+/i, '').trim();
  const first = core(alts[0]).match(/^(.*?)(\d+\s*x.*)$/i);
  const prefix = first ? first[1] : '';
  const start = alts[0].index + (alts[0][0].length - alts[0][0].trimStart().length);
  const last = alts[alts.length - 1];
  const chosen = pick === alts[0] && first ? first[2] : core(pick);
  return s.slice(0, start) + prefix + chosen + s.slice(last.index + last[0].length);
}

// "5K pace (plans 3-5). Newer runners: threshold." -> the zone for this level.
function resolvePaces(text, rank) {
  const s = String(text || '');
  const m = s.match(/\(plans?\s*(\d)(?:\s*-\s*(\d))?\)/i);
  const newer = s.match(/newer runners?:\s*([^.;]+)/i);
  if (m && newer && rank && rank < Number(m[1])) return newer[1];
  return s.replace(/\s*\(plans?\s*\d(?:\s*-\s*\d)?\)/gi, '').replace(/newer runners?:[^.;]*[.;]?/i, '');
}

const ZONE_NAME = { tempo: 'tempo (half-marathon) effort', threshold: 'threshold effort', steady: 'steady effort', '10k': '10K pace', '5k': '5K pace', '3200': '3200 pace', mile: 'mile pace', '800': '800 pace', '400': '400 pace', cv: 'critical velocity' };

function fmtGoal(sec) {
  const r = Math.round(sec * 10) / 10;
  const m = Math.floor(r / 60);
  const ss = r - m * 60;
  if (!m) return `${ss.toFixed(1)}s`;
  return `${m}:${(sec < 150 ? ss.toFixed(1).padStart(4, '0') : String(Math.round(ss)).padStart(2, '0'))}`;
}

// A library workout written out for one runner: the session in words, each
// set as a table of goal splits (from their Fitness States), recovery, and
// the warm-up / cool-down. Paces themselves live on the Fitness page.
export function personalWorkout(w, fitness, rank) {
  const main = resolveVariants(w.main, rank);
  const paces = resolvePaces(w.paces, rank);
  const zoneSec = (key) => {
    const z = fitness?.zones?.find((x) => x.key === key);
    return z ? (Array.isArray(z.sec) ? (z.sec[0] + z.sec[1]) / 2 : z.sec) : null;
  };
  const TYPE_ZONE = { vo2: '5k', track: 'mile', threshold: 'threshold', tempo: 'tempo', fartlek: '5k', race_specific: '5k', steady: 'steady', progression: 'threshold' };
  const fallback = (w.type === 'time_trial' ? null : zoneOf(paces)) || (TYPE_ZONE[w.type] ? { keys: [TYPE_ZONE[w.type]], offset: 0 } : null);
  const flat = main.replace(/\(([^)]*)\)/g, (_, inner) => '(' + inner.replace(/,/g, ' /') + ')');
  const clauses = flat.split(/[,;]|\bthen\b/i).map((c) => c.trim()).filter(Boolean);
  const wu = clauses.find((c) => /\b(wu|warm)/i.test(c) && !/\d+\s*x/i.test(c));
  const cd = clauses.find((c) => /\b(cd|cool)/i.test(c) && !/\d+\s*x/i.test(c)) || (/\bcd\b/i.test(main) ? 'cool-down' : null);
  const tidy = (c) => c && c.replace(/\b(wu|cd)\b/gi, '').replace(/\s+/g, ' ').replace(/^\+\s*/, '').trim();

  const sections = [];
  if (w.type !== 'hills') {
    for (const clause of clauses) {
      if (clause === wu || clause === cd) continue;
      let body = clause.split(/\bwith\b/i)[0];
      let rest = (clause.match(/\bwith\s+([^,;]+)/i) || [])[1]?.trim() || '';
      // "Long run with 3x8 min at ...": here "with" introduces the reps.
      if (!segmentsOf(body).length && /\bwith\s+\d+\s*x/i.test(clause)) { body = clause.split(/\bwith\b/i)[1]; rest = ''; }
      // Ladders ("400-800-1200-800-400 at ...", "2K - 1600 - 800 - 400") list every rep in order.
      const ladder = body.match(/^\s*(\d+(?:\.\d+)?k?\s*(?:-\s*\d+(?:\.\d+)?k?\s*){2,})/i);
      if (ladder) {
        const reps = ladder[1].split('-').map((x) => x.trim().toLowerCase()).map((x) => (x.endsWith('k') ? Number(x.slice(0, -1)) * 1000 : Number(x))).filter((m) => m >= 100);
        const zFor = (m) => zoneOf(body.slice(ladder[0].length)) || zoneOf(String(paces).split(/[,;]/).find((c) => new RegExp(`\\b${m}s?\\b`).test(c))) || fallback;
        const rows = reps.map((m, i) => {
          const z = zFor(m);
          const secs = z ? z.keys.map(zoneSec).filter(Boolean) : [];
          const pace = secs.length ? secs.reduce((a, b) => a + b, 0) / secs.length + z.offset : null;
          return { n: i + 1, what: m % 1000 === 0 && m >= 1000 ? `${m / 1000}K` : `${m}m`, goal: pace ? fmtGoal((pace / MILE_M) * m) : '' };
        });
        const z0 = zFor(reps[0]);
        sections.push({ label: reps.map((m) => (m % 1000 === 0 && m >= 1000 ? `${m / 1000}K` : m)).join('-'), zone: z0 ? z0.keys.map((k) => ZONE_NAME[k] || k).join(' to ') : '', rest, kind: 'distance', rows });
        continue;
      }
      const seg = segmentsOf(body)[0] || (() => {
        // "8x2:30/1" and "8x3/1": time reps written as on/off minutes.
        const t = body.match(/(\d+)\s*x\s*(\d+)(?::(\d{2}))?\s*\/\s*(\d+)/);
        return t ? { text: body, reps: Number(t[1]), m: null, sec: Number(t[2]) * 60 + Number(t[3] || 0), off: Number(t[4]) * 60 } : null;
      })();
      if (!seg) continue;
      // Only the work part sets the pace: "6x(1 min on / 1 min easy)" is a 5K-effort set.
      const work = body.split(/\s\/\s|\//)[0];
      // Time trials: the goal is the runner's own race estimate for that distance.
      const ttKey = w.type === 'time_trial' && seg.m ? (seg.m <= 1700 ? 'mile' : seg.m <= 3300 ? '3200' : seg.m <= 5100 ? '5k' : null) : null;
      const z = zoneOf(work) || (ttKey ? { keys: [ttKey], offset: 0 } : null) || (seg.reps > 1 || seg.m ? fallback : null);
      if (!z || z.keys[0] === 'easy') continue;
      const secs = z.keys.map(zoneSec).filter(Boolean);
      const pace = secs.length ? secs.reduce((a, b) => a + b, 0) / secs.length + z.offset : null;
      const zone = z.keys.map((k) => ZONE_NAME[k] || k).join(' to ').replace(/ pace to /, '-') + (z.offset ? ` ${z.offset > 0 ? '+' : ''}${z.offset}s/mi` : '');
      const miles = seg.m ? seg.m / MILE_M : null;
      const dist = seg.m ? (seg.m % 1000 === 0 && seg.m >= 1000 ? `${seg.m / 1000}K` : miles >= 0.99 && Math.abs(miles - Math.round(miles)) < 0.01 ? (Math.round(miles) === 1 ? '1 mile' : `${Math.round(miles)} mi`) : `${Math.round(seg.m)}m`) : seg.sec >= 60 ? `${Math.round((seg.sec / 60) * 10) / 10} min` : `${seg.sec}s`;
      const n = Math.min(seg.reps, 20);
      const covered = pace && !seg.m ? (seg.sec / pace) * MILE_M : 0;
      const goal = pace ? (seg.m ? fmtGoal((pace / MILE_M) * seg.m) : covered > 1600 ? `~${Math.round((covered / MILE_M) * 10) / 10} mi` : `~${Math.round(covered / 10) * 10}m`) : '';
      sections.push({
        label: seg.reps > 1 ? `${seg.reps} x ${dist}` : dist,
        zone,
        rest: rest || (seg.off ? `${seg.off / 60} min easy` : ''),
        kind: seg.m ? 'distance' : 'time',
        rows: Array.from({ length: n }, (_, i) => ({ n: i + 1, what: dist, goal })),
      });
    }
  }

  const parts = [];
  if (!sections.length) parts.push(`${main.charAt(0).toUpperCase()}${main.slice(1)}.`);
  else {
    if (wu && tidy(wu)) parts.push(`Warm up: ${tidy(wu)} easy.`);
    parts.push(`Main set: ${sections.map((x) => `${x.label} at ${x.zone}${x.rest ? `, ${x.rest} between` : ''}`).join('; then ')}.`);
    if (cd) parts.push(tidy(cd) && cd !== 'cool-down' ? `Cool down: ${tidy(cd)} easy.` : 'Cool down easy.');
  }
  return { session: parts.join(' '), main, sections };
}
