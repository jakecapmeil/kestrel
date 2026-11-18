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
console.log(`pace: ${cases.length} categories as expected`);
