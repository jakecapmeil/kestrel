// Run summaries, the cheap way: the server works out what a run MEANS against the runner's own paces and heart rate
// (grade.js already turns pace into a share of race VO2max and a zone), and writes it down as a few plain facts.
//   - Easy, recovery and shakeout runs with nothing unusual get a short written note from those facts, with no AI call.
//   - Everything else (workouts, races, long runs, anything unusual) goes to the model, which gets the facts instead of
//     raw laps and writes the note and picks the coaching point.
//   - A model's note is checked: every number in it must be in the facts it was given. If one isn't, or the model
//     fails, the note below is used instead, so a run always gets a report.
// Pure functions, no I/O, so they are easy to test (scripts/check-runfacts.mjs).

const MILE = 1609.344;
const pace = (sec) => {
  if (!(sec > 0) || !Number.isFinite(sec)) return null;
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const r1 = (n) => Math.round(n * 10) / 10;
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const hash = (s) => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const pick = (list, seed) => list[hash(seed) % list.length];

const ZONE_WORD = { recovery: 'recovery pace', easy: 'easy pace', steady: 'steady pace', tempo: 'tempo pace', threshold: 'threshold pace', interval: 'interval pace' };
const HARD = new Set(['tempo', 'threshold', 'interval']);
const RACE_WORDS = /race|meet|xc|5k|champ|invitational|time trial/i;

// What the model is told to follow when it writes run summaries. Shorter than the coaching rubric: plan match, load and
// difficulty math are done elsewhere and have nothing to do with writing a note.
export const SUMMARY_RUBRIC = `You write the note on each training session; Kestrel has already done the math. Each activity carries "facts": numbers and findings the server computed from the runner's own paces and heart rate. Use them as given. Do not redo the arithmetic, and never state a number (pace, heart rate, distance, count) that is not in the data.

CATEGORY, one per activity:
- easy: steady conversational run, avg HR under ~80% of max
- recovery: very easy and short (usually under 4 mi)
- long: the longest run of the week, 8+ mi, mostly easy effort
- workout: reps, tempo, hills, fartlek or progression: laps that swing between fast and slow, or a steady run at tempo pace. Warm-up and cool-down inside the activity still count as the workout.
- race: a meet or time trial (a meet in the calendar that day, or one continuous near-max effort with no rep breaks)
- shakeout: short (2-3 mi) easy run the day before or the morning of a race
- crosstrain: anything that isn't a run
PACE DECIDES: facts.pace_zone is the run against the runner's own paces. A run at recovery or easy pace with no fast laps is NOT a workout, however many laps it has (watches lap every mile by themselves). Never call auto-laps "repeats". Strides don't make a workout. rule_category and workout_by_pace are Kestrel's verdict: change it only with a clear reason in the facts.

THE NOTE (2-4 sentences on the session's main activity; leave warm-up and cool-down notes out): what the session was, how the pace and heart rate compared to the runner's own zones (use the findings), and ONE coaching point: pacing, a fade, heart rate drift, too fast on an easy day, or a strong workout. If heat or hills explain a slow pace or a high heart rate, say so. Be honest but encouraging, like a good high school XC coach. No medical advice; pain that lasts goes to their coach or a doctor.

TRACK: a session on a track (facts.on_track, or reps on 200/400/800/1600 marks on flat ground) reports its reps as 200/400/800/1200/1600 m.`;

// ---------------------------------------------------------------- facts

// One activity. x: { id, name, type, category (Kestrel's rule label), miles, sec (moving seconds), avg_hr, max_hr,
// elev_ft, laps: [{ m, s, hr }], paceInfo (paceStructure() result), track, gps (1 | 0 | null), note }, ctx: { maxHr, vo2r }.
export function activityFacts(x, { maxHr }) {
  const p = x.paceInfo || {};
  const miles = r1(x.miles || 0);
  const runSec = x.miles > 0.2 && x.sec > 0 ? x.sec / x.miles : null;
  const hrPct = x.avg_hr && maxHr ? Math.round((x.avg_hr / maxHr) * 100) : null;
  const run = x.category !== 'crosstrain';
  const f = {
    id: String(x.id), name: x.name || '', type: x.type || '', rule_category: x.category,
    miles, minutes: Math.round((x.sec || 0) / 60), pace: run ? pace(runSec) : null,
    avg_hr: x.avg_hr ? Math.round(x.avg_hr) : null, hr_pct_of_max: hrPct,
    pace_zone: run ? p.run_zone || null : null, pace_pct_of_race_vo2max: run && p.run_pct != null ? Math.round(p.run_pct * 100) : null,
    workout_by_pace: p.known ? !!p.workout : null,
    elev_ft: x.elev_ft != null ? Math.round(x.elev_ft) : null,
    on_track: x.track || undefined, gps_at_van_cortlandt: x.gps == null ? undefined : !!x.gps, athlete_note: x.note || null,
    findings: [], flags: [],
  };
  if (!run) return f;

  // The whole run against the runner's own zones (added first below, unless it is a rep session: its average includes the jogs).
  const headline = f.pace && f.pace_zone ? `Run pace ${f.pace}/mi is ${ZONE_WORD[f.pace_zone]} for this runner (${f.pace_pct_of_race_vo2max}% of race VO2max).` : '';
  if (f.avg_hr) f.findings.push(`Heart rate averaged ${f.avg_hr}${hrPct != null ? ` (${hrPct}% of max)` : ''}.`);

  // The fast laps of a workout: how many, how fast, how even, whether the runner faded or the heart rate climbed.
  let work = (p.work || []).filter((l) => l?.m > 0 && l?.s > 0);
  // No pace fitness to tell the fast laps by (a new runner), but the run was labelled a workout or race: its laps are the work.
  let lapWord = 'fast lap';
  if (work.length < 2 && ['workout', 'race'].includes(x.category)) {
    const all = (x.laps || []).filter((l) => l?.m >= 250 && l?.s > 0);
    if (all.length >= 2) { work = all; lapWord = 'lap'; }
  }
  if (work.length >= 2) {
    const secPerMile = (l) => (l.s / l.m) * MILE;
    const paces = work.map(secPerMile);
    const totalM = work.reduce((a, l) => a + l.m, 0), totalS = work.reduce((a, l) => a + l.s, 0);
    const avgM = Math.round(totalM / work.length / 50) * 50;
    const avgPace = (totalS / totalM) * MILE;
    const fade = Math.round(paces[paces.length - 1] - paces[0]);
    const spread = Math.round(Math.max(...paces) - Math.min(...paces));
    const hrs = work.map((l) => l.hr).filter(Boolean);
    f.reps = { n: work.length, avg_m: avgM, avg_pace: pace(avgPace), zone: p.rep_zone || null, pct_of_race_vo2max: p.rep_pct != null ? Math.round(p.rep_pct * 100) : null, fade_s_per_mile: fade, spread_s_per_mile: spread, first_hr: hrs[0] ?? null, last_hr: hrs.length ? hrs[hrs.length - 1] : null };
    f.findings.push(`${work.length} ${lapWord}s averaging ${avgM} m at ${pace(avgPace)}/mi${p.rep_zone ? `, ${ZONE_WORD[p.rep_zone]} for this runner (${f.reps.pct_of_race_vo2max}% of race VO2max)` : ''}.`);
    if (fade >= 5) { f.findings.push(`The last ${lapWord} was ${fade} s/mi slower than the first.`); f.flags.push('fade'); }
    else if (fade <= -5) f.findings.push(`The ${lapWord}s got quicker: the last was ${-fade} s/mi faster than the first.`);
    else if (spread <= 6) f.findings.push(spread === 0 ? `The ${lapWord}s were all the same pace.` : `The ${lapWord}s were even (within ${spread} s/mi of each other).`);
    if (hrs.length >= 3 && hrs[hrs.length - 1] - hrs[0] >= 8) { f.findings.push(`Heart rate rose from ${hrs[0]} to ${hrs[hrs.length - 1]} bpm across the ${lapWord}s.`); f.flags.push('hr_drift'); }
  } else if (p.kind === 'tempo' || p.kind === 'steady') {
    f.findings.push('Most of the run was at tempo pace or quicker.');
  } else {
    // A steady run: first half against second half, from the watch's own laps (needs a few real laps).
    const laps = (x.laps || []).filter((l) => l?.m >= 800 && l?.s > 0);
    if (laps.length >= 4) {
      const half = Math.floor(laps.length / 2);
      const avg = (a) => (a.reduce((s, l) => s + l.s, 0) / a.reduce((s, l) => s + l.m, 0)) * MILE;
      const d = Math.round(avg(laps.slice(laps.length - half)) - avg(laps.slice(0, half)));
      f.halves = { diff_s_per_mile: d };
      if (d >= 10) { f.findings.push(`The second half was ${d} s/mi slower than the first.`); f.flags.push('fade'); }
      else if (d <= -10) f.findings.push(`The second half was ${-d} s/mi faster than the first (a negative split).`);
      else f.findings.push('Pace held steady from start to finish.');
    }
  }

  if (headline && !f.reps) f.findings.unshift(headline);

  const perMile = x.miles > 0.5 && x.elev_ft != null ? x.elev_ft / x.miles : 0;
  if (perMile >= 60) f.findings.push(`It was hilly: ${Math.round(x.elev_ft)} ft of climbing (${Math.round(perMile)} ft per mile).`);

  // Things that deserve a closer look than a canned note: they send the run to the model.
  const easyDay = ['easy', 'recovery', 'shakeout', 'long'].includes(x.category);
  if (easyDay && f.pace_zone && HARD.has(f.pace_zone) && !(f.reps || p.kind)) f.flags.push('fast_for_easy');
  else if (['recovery', 'shakeout'].includes(x.category) && f.pace_zone === 'steady') f.flags.push('fast_for_easy');
  if (easyDay && hrPct != null && hrPct >= 83 && (!f.pace_zone || ['recovery', 'easy'].includes(f.pace_zone))) {
    f.findings.push(`Heart rate was high for an easy pace (${hrPct}% of max); heat or tiredness can do that.`);
    f.flags.push('hr_high_for_pace');
  }
  return f;
}

// Does this session need the model? Routine easy runs don't. sess: { date, facts: [...], main_id }.
export function needsModel(sess, { meetDates = new Set(), hasBody = false } = {}) {
  if (meetDates.has(sess.date) || hasBody) return true;
  return sess.facts.some((f) => {
    if (f.rule_category === 'crosstrain') return false;
    if (['workout', 'race', 'long'].includes(f.rule_category) || f.reps || f.flags.length) return true;
    if (f.workout_by_pace || f.athlete_note || RACE_WORDS.test(f.name)) return true;
    return false;
  });
}

// ---------------------------------------------------------------- written notes

const HR_WORD = (pct) => (pct < 65 ? 'very relaxed' : pct < 72 ? 'relaxed' : pct < 78 ? 'comfortably aerobic' : 'at the top of easy');
const KIND = { easy: 'Easy run', recovery: 'Recovery run', shakeout: 'Shakeout', long: 'Long run', workout: 'Workout', race: 'Race' };
const wordsOf = (type) => String(type || 'Cross-training').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();

function totals(sess) {
  const miles = r1(sess.facts.reduce((a, f) => a + (f.miles || 0), 0));
  return { miles, parts: sess.facts.length };
}
const mainOf = (sess) => sess.facts.find((f) => f.id === String(sess.main_id)) || sess.facts[0];
// The main part's pace stands for the session, except for a workout or race with a warm-up and cool-down: "5 mi at
// 4:30/mi" would be the reps' pace over the whole day's miles (the reps' own paces follow in the findings).
const paceOf = (m, parts) => (m.pace && !(parts > 1 && ['workout', 'race'].includes(m.rule_category)) ? ` at ${m.pace}/mi` : '');

// The note for one session, from the facts. Never invents: every number comes from them.
export function templateReport(sess) {
  const m = mainOf(sess);
  if (!m) return '';
  const { miles, parts } = totals(sess);
  if (m.rule_category === 'crosstrain') return `${cap(wordsOf(m.type))} for ${m.minutes} min${m.avg_hr ? `, heart rate averaging ${m.avg_hr}` : ''}. Cross-training counts toward your week and rests your legs from the pounding of running.`;
  const kind = KIND[m.rule_category] || 'Run';
  const head = `${kind}, ${miles} mi${parts > 1 ? ` in ${parts} parts` : ''}${paceOf(m, parts)}.`;
  // Workouts, races and long runs (or a flagged run when the model was unavailable): lead with the findings.
  if (['workout', 'race', 'long'].includes(m.rule_category) || m.reps || m.flags.length) {
    const lines = m.findings.filter((s) => !s.startsWith('Heart rate averaged') || !m.reps).slice(0, 4);
    return [head, ...lines].join(' ');
  }
  const zone = m.pace_zone ? pick({
    recovery: ['That is a gentle recovery pace for you.', 'Very relaxed pace for you.'],
    easy: ['Right in your easy zone.', 'Squarely easy pace for you.', 'Easy pace for you, which is the point of the day.'],
    steady: ['That is a touch quicker than easy pace for you.'],
  }[m.pace_zone] || ['At a pace that suits your fitness.'], m.id) : '';
  const hr = m.avg_hr ? `Heart rate averaged ${m.avg_hr}${m.hr_pct_of_max != null ? ` (${m.hr_pct_of_max}% of max), ${HR_WORD(m.hr_pct_of_max)}` : ''}.` : '';
  const tip = {
    easy: ['Keep most of your miles at this effort and save the hard running for workout days.', 'Easy days like this are what make the hard days possible.'],
    recovery: ['Recovery days work best when they stay this easy.', 'Keep it this gentle and the legs come back fresher.'],
    shakeout: ['Short and loose is exactly right before a race.', 'A shakeout should leave you feeling fresher, and a run this short does.'],
  }[m.rule_category] || [''];
  return [head, zone, hr, pick(tip, `${m.id}t`)].filter(Boolean).join(' ');
}

// One line for a day, from its sessions.
export function templateDayLine(sessions) {
  const parts = sessions.map((s) => {
    const m = mainOf(s);
    if (!m) return '';
    if (m.rule_category === 'crosstrain') return `${wordsOf(m.type)} for ${m.minutes} min`;
    const { miles, parts } = totals(s);
    return `${(KIND[m.rule_category] || 'Run').toLowerCase()}, ${miles} mi${paceOf(m, parts)}`;
  }).filter(Boolean);
  if (!parts.length) return '';
  const text = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `${cap(text)}.`;
}

// ---------------------------------------------------------------- the check on a model's note

const collect = (v, out) => {
  if (typeof v === 'number' && Number.isFinite(v)) out.push(v);
  else if (typeof v === 'string') for (const t of numbersIn(v)) out.push(t);
  else if (Array.isArray(v)) v.forEach((x) => collect(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => collect(x, out));
};
// Numbers in a text: "5:52" is 352 seconds, and plain numbers keep their value. Dates and times are skipped
// (the note shouldn't need them, and the facts carry no clock times).
function numbersIn(text) {
  const out = [];
  const rest = String(text).replace(/(\d{1,2}):(\d{2})(?!\d)/g, (_, a, b) => { out.push(Number(a) * 60 + Number(b)); return ' '; });
  for (const m of rest.matchAll(/\d+(?:\.\d+)?/g)) out.push(Number(m[0]));
  return out;
}

// Numbers the model may use: every number in the facts it was given, and the rounded forms of them.
export function allowedNumbers(...factSets) {
  const nums = [];
  factSets.flat().forEach((f) => collect(f, nums));
  return nums;
}

// Numbers in `text` that are not in the facts (small counts up to 12 are always fine: "two reps", "the last 3").
export function ungroundedNumbers(text, allowed) {
  const bad = [];
  for (const n of numbersIn(text)) {
    if (Number.isInteger(n) && n <= 12) continue;
    const tol = Math.max(0.06, Math.abs(n) * 0.01);
    if (allowed.some((a) => Math.abs(a - n) <= tol)) continue;
    // m:ss paces are exact seconds: allow a second either way for rounding.
    if (n >= 60 && allowed.some((a) => Math.abs(a - n) <= 1)) continue;
    bad.push(n);
  }
  return bad;
}
