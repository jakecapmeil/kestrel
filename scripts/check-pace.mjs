// The pace check on a run's category (src/train/grade.js checkedCategory): pace decides "workout" both ways.
// node scripts/check-pace.mjs
import assert from 'node:assert/strict';
import { checkedCategory } from '../src/train/grade.js';

const ctx = { vo2r: 61.4, maxHr: 196 }; // a 4:51 miler
const lap = (m, s, hr) => ({ m, s, hr });
const cases = [
  // 2026-11-17: 1.49 mi at 5:52 average, short pieces with standing rest, labeled easy. No lap is fast for long
  // enough, but the whole run is tempo pace for over a mile.
  ['1.5 mi at 5:52 is a workout', { category: 'easy', distance_mi: 1.49, moving_sec: 524, avg_hr: 149, elev_gain_ft: 8,
    laps: [lap(99, 26, 120), lap(104, 25, 140), lap(98, 22, 123), lap(304, 73, 151), lap(305, 73, 151), lap(297, 67, 141), lap(281, 74, 159), lap(308, 72, 157), lap(272, 61, 152), lap(108, 20, 140), lap(107, 20, 156), lap(115, 20, 148)] }, 'workout'],
  ['the same run with no laps', { category: 'easy', distance_mi: 1.49, moving_sec: 524, avg_hr: 149, laps: [] }, 'workout'],
  ['a warm-up at 7:55 stays easy', { category: 'easy', distance_mi: 1.95, moving_sec: 926, avg_hr: 142, laps: [] }, 'easy'],
  ['1.1 mi at 6:12 (steady, not tempo) stays easy', { category: 'easy', distance_mi: 1.11, moving_sec: 413, avg_hr: 137, laps: [] }, 'easy'],
  ['a half mile at 5:52 is too short to count', { category: 'easy', distance_mi: 0.5, moving_sec: 176, avg_hr: 140, laps: [] }, 'easy'],
  // A tempo with the watch's own mile laps: every lap is fast, so it reads as a tempo stretch, not a whole-run pace.
  ['3 mi at 5:55 with auto mile laps is a workout', { category: 'easy', distance_mi: 3, moving_sec: 3 * 355, avg_hr: 165,
    laps: [lap(1609, 355, 160), lap(1609, 354, 166), lap(1609, 356, 170)] }, 'workout'],
  ['6 mi easy with one quick last mile stays easy', { category: 'easy', distance_mi: 6, moving_sec: 5 * 480 + 370, avg_hr: 150,
    laps: [...Array.from({ length: 5 }, () => lap(1609, 480, 145)), lap(1609, 370, 170)] }, 'easy'],
  ['a long run stays long', { category: 'long', distance_mi: 9, moving_sec: 9 * 360, avg_hr: 160, laps: [] }, 'long'],
  ['a "workout" at easy pace is easy', { category: 'workout', distance_mi: 5, moving_sec: 5 * 480, avg_hr: 140,
    laps: Array.from({ length: 5 }, () => lap(1609, 480, 140)) }, 'easy'],
];
for (const [name, w, want] of cases) assert.equal(checkedCategory(w, ctx).category, want, name);

// 2026-11-24: 3 x (600 m + 200 m) saved as its own activity, GPS read 0.87 mi in 6:43 and the sync called it recovery.
// The runner typed the real laps. Typed laps are what was run, so they make it a workout even at the GPS distance.
const typed = [lap(600, 102.9, 145), lap(200, 31.5, 148), lap(600, 99, 140), lap(200, 30.7, 137), lap(600, 97.4, 151), lap(200, 29, 167)];
const nov24 = { category: 'recovery', distance_mi: 0.87, moving_sec: 403, avg_hr: 144, elev_gain_ft: 12, laps: typed, name: 'New York Running' };
const ctx2 = { vo2r: 61.7, maxHr: 206 };
const typedCases = [
  ['typed 600/200 reps on a "recovery" run make it a workout', nov24, { handLaps: true }, 'workout'],
  ['the same laps from the watch leave it recovery (laps alone never say workout)', nov24, {}, 'recovery'],
  ['typed reps at the corrected 1.49 mi make it a workout', { ...nov24, distance_mi: 1.49, moving_sec: 391 }, { handLaps: true }, 'workout'],
  ['a recovery run averaging interval pace is a workout, typed or not', { ...nov24, distance_mi: 1.49, moving_sec: 391 }, {}, 'workout'],
  ['a shakeout with typed even easy miles stays a shakeout', { category: 'shakeout', distance_mi: 2, moving_sec: 960, avg_hr: 130, laps: [lap(1609, 480, 128), lap(1609, 480, 132)] }, { handLaps: true }, 'shakeout'],
  ['typed mile laps at recovery pace stay recovery', { category: 'recovery', distance_mi: 3, moving_sec: 1590, avg_hr: 130, laps: Array.from({ length: 3 }, () => lap(1609, 530, 130)) }, { handLaps: true }, 'recovery'],
];
for (const [name, w, opts, want] of typedCases) assert.equal(checkedCategory({ ...w, laps: JSON.stringify(w.laps) }, ctx2, opts).category, want, name);
console.log(`pace: ${cases.length + typedCases.length} categories as expected`);
