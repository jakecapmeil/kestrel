// The Hunter Kessler training plan, and the nine mileage levels every other plan is scaled to: levels by weekly miles (15 to 60), each with three
// week shapes (no race, race week, taper) and a menu of sessions. A team owner can publish their own plan
// in the same format (team_plans); athletes on that team start from it. Which level an athlete is on is
// their plan_rank, set at sign-up from their weekly miles and moved by the AI coach's level gates.
const BASE_PLANS = {"1":{"weeks":[{"miles":30,"name":"No race"},{"miles":25,"name":"Race week"},{"miles":20,"name":"Taper"}],"days":[{"day":"Monday","cells":[{"type":"Easy","miles":"5","shoes":"Vomero","notes":""},{"type":"Off","miles":"0","shoes":"","notes":"Cross train"},{"type":"Off","miles":"0","shoes":"","notes":"Cross train"}]},{"day":"Tuesday","cells":[{"type":"Workout","miles":"6 (3 WO)","shoes":"Rebel","notes":"1.5 WU 1.5 CD"},{"type":"Workout","miles":"6 (3 WO)","shoes":"Rebel","notes":"1.5 WU 1.5 CD"},{"type":"Workout","miles":"6 (3 WO)","shoes":"Rebel","notes":"1.5 WU 1.5 CD"}]},{"day":"Wednesday","cells":[{"type":"Off","miles":"0","shoes":"","notes":"Cross train"},{"type":"Easy","miles":"4","shoes":"Vomero","notes":""},{"type":"Easy","miles":"4","shoes":"Vomero","notes":""}]},{"day":"Thursday","cells":[{"type":"Easy","miles":"5","shoes":"Vomero","notes":"Strides"},{"type":"Workout","miles":"5 (2 WO)","shoes":"Rebel","notes":"1.5 WU 1.5 CD"},{"type":"Easy","miles":"4","shoes":"Vomero","notes":"Strides"}]},{"day":"Friday","cells":[{"type":"Workout","miles":"6 (3 WO)","shoes":"Rebel","notes":"1.5 WU 1.5 CD"},{"type":"Off","miles":"0","shoes":"","notes":"Rest"},{"type":"Off","miles":"0","shoes":"","notes":"Rest"}]},{"day":"Saturday","cells":[{"type":"Off","miles":"0","shoes":"","notes":"Rest"},{"type":"Race","miles":"6 (3 Race)","shoes":"Spikes, Vomero","notes":"1.5 WU, 1.5 CD"},{"type":"Race","miles":"6 (3 Race)","shoes":"Spikes, Vomero","notes":"1.5 WU, 1.5 CD"}]},{"day":"Sunday","cells":[{"type":"LR","miles":"8","shoes":"Vomero","notes":"Strides"},{"type":"Easy","miles":"4","shoes":"Vomero","notes":"Strides"},{"type":"Off","miles":"0","shoes":"","notes":"Cross train/rest"}]}],"ref":{"shoes":"Vomero (easy runs) Rebel (workouts) Spikes (race)","core":"Core at least 2 times a week (Monday, Wednesday)","gym":"","sessions":[{"title":"Tuesday workouts","desc":"Hard, race pace","items":["6x800 or 5xk at 5k pace, 200 jog rest or 90 seconds standing rest","3xmile at 5k pace","3 mile tempo at 5k + 20 seconds pace"]},{"title":"Thursday workouts","desc":"Medium, steady + speed","items":["6(3min on, 1min off)","6x400 at 5k with 200 jog rest, 4x200","12xhill, jog down recovery"]},{"title":"Sunday long run","desc":"Medium, steady","items":["3x8 min at 5k+30 seconds pace, 2 min jog recovery","Progression, easy down to 5k-30 seconds pace","If tired, just jog easy"]}]}},"2":{"weeks":[{"miles":35,"name":"No race"},{"miles":30,"name":"Race week"},{"miles":25,"name":"Taper"}],"days":[{"day":"Monday","cells":[{"type":"Easy","miles":"4","shoes":"1080","notes":""},{"type":"Easy","miles":"5","shoes":"1080","notes":""},{"type":"Easy","miles":"5","shoes":"1080","notes":""}]},{"day":"Tuesday","cells":[{"type":"Workout","miles":"6 (3 WO)","shoes":"Rebel","notes":"1.5 WU 1.5 CD"},{"type":"Workout","miles":"6 (3 WO)","shoes":"Rebel","notes":"1.5 WU 1.5 CD"},{"type":"Workout","miles":"6 (3 WO)","shoes":"Rebel","notes":"1.5 WU 1.5 CD"}]},{"day":"Wednesday","cells":[{"type":"Easy","miles":"5","shoes":"1080","notes":""},{"type":"Easy","miles":"4","shoes":"1080","notes":""},{"type":"Easy","miles":"4","shoes":"1080","notes":""}]},{"day":"Thursday","cells":[{"type":"Easy","miles":"6","shoes":"1080","notes":"Strides"},{"type":"Workout","miles":"5 (2 WO)","shoes":"Rebel","notes":"1.5 WU 1.5 CD"},{"type":"Easy","miles":"4","shoes":"1080","notes":"Strides"}]},{"day":"Friday","cells":[{"type":"Workout","miles":"6 (3 WO)","shoes":"Rebel","notes":"1.5 WU 1.5 CD"},{"type":"Off","miles":"0","shoes":"","notes":"Rest"},{"type":"Off","miles":"0","shoes":"","notes":"Rest"}]},{"day":"Saturday","cells":[{"type":"Off","miles":"0","shoes":"","notes":"Rest"},{"type":"Race","miles":"6 (3 Race)","shoes":"Spikes, 1080","notes":"1.5 WU, 1.5 CD"},{"type":"Race","miles":"6 (3 Race)","shoes":"Spikes, 1080","notes":"1.5 WU, 1.5 CD"}]},{"day":"Sunday","cells":[{"type":"LR","miles":"8","shoes":"1080","notes":"Strides"},{"type":"Easy","miles":"4","shoes":"1080","notes":"Strides"},{"type":"Easy","miles":"0","shoes":"1080","notes":""}]}],"ref":{"shoes":"1080 (easy runs) Rebel (workouts) Spikes (race)","core":"Core at least 2 times a week (Monday, Wednesday)","gym":"Gym once a week (Tuesday, Saturday, Sunday)","sessions":[{"title":"Tuesday workouts","desc":"Hard, race pace","items":["6x800 or 5xk at 5k pace, 200 jog rest or 90 seconds standing rest","3xmile at 5k pace","3 mile tempo at 5k + 20 seconds pace"]},{"title":"Thursday workouts","desc":"Medium, steady + speed","items":["6(3min on, 1min off)","6x400 at 5k with 200 jog rest, 4x200","12xhill, jog down recovery"]},{"title":"Sunday long run","desc":"Medium, steady","items":["3x8 min at 5k+30 seconds pace, 2 min jog recovery","Progression, easy down to 5k-30 seconds pace","If tired, just jog easy"]}]}},"3":{"weeks":[{"miles":40,"name":"No race"},{"miles":35,"name":"Race week"},{"miles":30,"name":"Taper"}],"days":[{"day":"Monday","cells":[{"type":"Easy","miles":"6","shoes":"1080","notes":""},{"type":"Easy","miles":"5","shoes":"1080","notes":""},{"type":"Easy","miles":"4","shoes":"1080","notes":""}]},{"day":"Tuesday","cells":[{"type":"Workout","miles":"7 (4 WO)","shoes":"Rebel","notes":"1.5 WU 1.5 CD"},{"type":"Workout","miles":"7 (4 WO)","shoes":"Rebel","notes":"1.5 WU 1.5 CD"},{"type":"Workout","miles":"6 (3 WO)","shoes":"Rebel","notes":"1.5 WU 1.5 CD"}]},{"day":"Wednesday","cells":[{"type":"Easy","miles":"5","shoes":"1080","notes":""},{"type":"Easy","miles":"5","shoes":"1080","notes":""},{"type":"Easy","miles":"4","shoes":"1080","notes":""}]},{"day":"Thursday","cells":[{"type":"Easy","miles":"6","shoes":"1080","notes":"Strides"},{"type":"Workout","miles":"6 (3 WO)","shoes":"Rebel","notes":"1.5 WU 1.5 CD"},{"type":"Easy","miles":"4","shoes":"1080","notes":"Strides"}]},{"day":"Friday","cells":[{"type":"Workout","miles":"7 (4 WO)","shoes":"Rebel","notes":"1.5 WU 1.5 CD"},{"type":"Off","miles":"0","shoes":"","notes":"Rest"},{"type":"Off","miles":"0","shoes":"","notes":"Rest"}]},{"day":"Saturday","cells":[{"type":"Off","miles":"0","shoes":"","notes":"Rest"},{"type":"Race","miles":"6 (3 Race)","shoes":"Spikes, 1080","notes":"1.5 WU, 1.5 CD"},{"type":"Race","miles":"6 (3 Race)","shoes":"Spikes, 1080","notes":"1.5 WU, 1.5 CD"}]},{"day":"Sunday","cells":[{"type":"LR","miles":"9","shoes":"1080","notes":"Strides"},{"type":"Easy","miles":"6","shoes":"1080","notes":"Strides"},{"type":"Easy","miles":"6","shoes":"1080","notes":"Strides"}]}],"ref":{"shoes":"1080 (easy runs) Rebel (workouts) Spikes (race)","core":"Core at least 2 times a week (Monday, Wednesday)","gym":"Gym once a week (Tuesday, Saturday, Sunday)","sessions":[{"title":"Tuesday workouts","desc":"Hard, race pace","items":["4xmile with 200 jog rest at 5k","6xk at faster than 5k with 200 jog rest","3x2k at 5k pace, 2min rest"]},{"title":"Thursday workouts","desc":"Medium, steady + speed","items":["8(2:30 min on, 1 min off)","12x400 at 5k with 200 jog rest","6xk at 5k +15 seconds pace, 90 seconds rest"]},{"title":"Sunday long run","desc":"Medium, steady","items":["3x9 min at 5k+25 seconds, 2 min jog recovery","Progression","If tired, just jog easy"]}]}},"4":{"weeks":[{"miles":45,"name":"No race"},{"miles":40,"name":"Race week"},{"miles":35,"name":"Taper"}],"days":[{"day":"Monday","cells":[{"type":"Easy","miles":"6","shoes":"1080","notes":""},{"type":"Easy","miles":"6","shoes":"1080","notes":""},{"type":"Easy","miles":"6","shoes":"1080","notes":""}]},{"day":"Tuesday","cells":[{"type":"Workout","miles":"8 (4 WO)","shoes":"Rebel","notes":"2 WU 2 CD"},{"type":"Workout","miles":"8 (4 WO)","shoes":"Rebel","notes":"2 WU 2 CD"},{"type":"Workout","miles":"6 (3 WO)","shoes":"Rebel","notes":"1.5 WU 1.5 CD"}]},{"day":"Wednesday","cells":[{"type":"Easy","miles":"6","shoes":"1080","notes":""},{"type":"Easy","miles":"6","shoes":"1080","notes":""},{"type":"Easy","miles":"6","shoes":"1080","notes":""}]},{"day":"Thursday","cells":[{"type":"Easy","miles":"7","shoes":"1080","notes":"Strides"},{"type":"Workout","miles":"7 (3 WO)","shoes":"Rebel","notes":"1.5 WU 1.5 CD"},{"type":"Easy","miles":"5","shoes":"1080","notes":"Strides"}]},{"day":"Friday","cells":[{"type":"Workout","miles":"8 (4 WO)","shoes":"Rebel","notes":"2 WU 2 CD"},{"type":"Off","miles":"0","shoes":"","notes":"Rest"},{"type":"Off","miles":"0","shoes":"","notes":"Rest"}]},{"day":"Saturday","cells":[{"type":"Off","miles":"0","shoes":"","notes":"Rest"},{"type":"Race","miles":"6 (3 Race)","shoes":"Spikes, 1080","notes":"1.5 WU, 1.5 CD"},{"type":"Race","miles":"6 (3 Race)","shoes":"Spikes, 1080","notes":"1.5 WU, 1.5 CD"}]},{"day":"Sunday","cells":[{"type":"LR","miles":"10","shoes":"1080","notes":"Strides"},{"type":"Easy","miles":"7","shoes":"1080","notes":"Strides"},{"type":"Easy","miles":"6","shoes":"1080","notes":"Strides"}]}],"ref":{"shoes":"1080 (easy runs) Vaporflies (workouts) Pegasus (Wu/cd) Spikes (race)","core":"Core at least 2 times a week (Monday, Wednesday)","gym":"Gym once a week (Tuesday, Saturday, Sunday)","sessions":[{"title":"Tuesday workouts","desc":"Hard, race pace","items":["4xmile with 200 jog rest at 5k","6xk at faster than 5k with 200 jog rest","3x2k at 5k pace, 2min rest"]},{"title":"Thursday workouts","desc":"Medium, steady + speed","items":["8(2:30 min on, 1 min off)","12x400 at 5k with 200 jog rest","6xk at 5k +15 seconds pace, 90 seconds rest"]},{"title":"Sunday long run","desc":"Medium, steady","items":["3x9 min at 5k+25 seconds, 2 min jog recovery","Progression","If tired, just jog easy"]}]}},"5":{"weeks":[{"miles":50,"name":"No race"},{"miles":45,"name":"Race week"},{"miles":40,"name":"Taper"}],"days":[{"day":"Monday","cells":[{"type":"Easy","miles":"7","shoes":"Vomero+","notes":""},{"type":"Easy","miles":"7","shoes":"Vomero+","notes":"Strides"},{"type":"Easy","miles":"6","shoes":"Vomero+","notes":"Strides"}]},{"day":"Tuesday","cells":[{"type":"Workout","miles":"8 (4 WO)","shoes":"Peg + Vap","notes":"2 WU 2 CD"},{"type":"Workout","miles":"8 (4 WO)","shoes":"Peg + Vap","notes":"2 WU 2 CD"},{"type":"Workout","miles":"7 (3 WO)","shoes":"Peg + Vap","notes":"2 WU 2 CD"}]},{"day":"Wednesday","cells":[{"type":"Easy","miles":"7","shoes":"Vomero+","notes":""},{"type":"Easy","miles":"6","shoes":"Vomero+","notes":""},{"type":"Easy","miles":"6","shoes":"Vomero+","notes":""}]},{"day":"Thursday","cells":[{"type":"Easy","miles":"7","shoes":"Vomero+","notes":"Strides"},{"type":"Workout","miles":"7 (3 WO)","shoes":"Peg + Vap","notes":"2 WU 2 CD"},{"type":"Easy","miles":"6","shoes":"Vomero+","notes":"Strides"}]},{"day":"Friday","cells":[{"type":"Workout","miles":"8 (4 WO)","shoes":"Peg + Vap","notes":"2 WU 2 CD"},{"type":"Shakeout","miles":"2","shoes":"Pegasus","notes":"Optional"},{"type":"Shakeout","miles":"2","shoes":"Pegasus","notes":"Optional"}]},{"day":"Saturday","cells":[{"type":"Shakeout","miles":"2","shoes":"Pegasus","notes":"Optional"},{"type":"Race","miles":"9 (3 R, 2WO)","shoes":"Spikes, Peg","notes":"2 WU, 2 CD"},{"type":"Race","miles":"7 (3 Race)","shoes":"Spikes, Peg","notes":"2 WU, 2 CD"}]},{"day":"Sunday","cells":[{"type":"LR","miles":"11","shoes":"Vomero+","notes":"Strides"},{"type":"Easy","miles":"6","shoes":"Vomero+","notes":"Strides"},{"type":"Easy","miles":"6","shoes":"Vomero+","notes":"Strides"}]}],"ref":{"shoes":"Vomero+ (easy runs) Vaporfly (workouts) Pegasus(WU/CD/Shakeout) Spikes (race)","core":"Core at least 3 times a week (Monday, Wednesday)","gym":"Gym once a week (Tuesday, Saturday, Sunday)","sessions":[{"title":"Tuesday workouts","desc":"Hard, race pace","items":["4xmile with 200 jog rest at 5k","6xk at faster than 5k with 200 jog rest","3x2k at 5k pace, 2min rest"]},{"title":"Thursday workouts","desc":"Medium, steady + speed","items":["8(2:30 min on, 1 min off)","12x400 at 5k with 200 jog rest","6xk at 5k +15 seconds pace, 90 seconds rest"]},{"title":"Sunday long run","desc":"Medium, steady","items":["3x10 min at 5k+25 seconds, 2:30 min jog recovery","Progression","If tired, just jog easy"]}]}},"6":{"weeks":[{"miles":60,"name":"No race"},{"miles":55,"name":"Race week"},{"miles":50,"name":"Taper"}],"days":[{"day":"Monday","cells":[{"type":"Easy","miles":"9 (3AM, 6PM)","shoes":"Pegasus, Rebel","notes":"PM strides"},{"type":"Easy","miles":"9 (3AM, 6PM)","shoes":"Pegasus, Rebel","notes":"PM strides"},{"type":"Easy","miles":"9 (3AM, 6PM)","shoes":"Pegasus, Rebel","notes":"PM strides"}]},{"day":"Tuesday","cells":[{"type":"Workout","miles":"9 (5 WO)","shoes":"Peg + Vap","notes":"2 WU 2 CD"},{"type":"Workout","miles":"8 (4 WO)","shoes":"Peg + Vap","notes":"2 WU 2 CD"},{"type":"Workout","miles":"8 (4 WO)","shoes":"Peg + Vap","notes":"2 WU 2 CD"}]},{"day":"Wednesday","cells":[{"type":"Easy","miles":"9 (3AM, 6PM)","shoes":"Rebel, Vomero+","notes":""},{"type":"Easy","miles":"9 (3AM, 6PM)","shoes":"Rebel, Vomero+","notes":""},{"type":"Easy","miles":"6","shoes":"Vomero+","notes":""}]},{"day":"Thursday","cells":[{"type":"Easy","miles":"9 (3AM, 6PM)","shoes":"Peg, Vomero+","notes":"PM Strides"},{"type":"Workout","miles":"7 (3 WO)","shoes":"Peg + Vap","notes":"2 WU 2 CD"},{"type":"Easy","miles":"7","shoes":"Vomero+","notes":"Strides"}]},{"day":"Friday","cells":[{"type":"Workout","miles":"9 (5 WO)","shoes":"Peg + Rebel","notes":"2 WU 2 CD"},{"type":"Shakeout","miles":"3","shoes":"Pegasus","notes":"Stride"},{"type":"Shakeout","miles":"3","shoes":"Pegasus","notes":"Stride"}]},{"day":"Saturday","cells":[{"type":"Shakeout","miles":"3","shoes":"Pegasus","notes":""},{"type":"Race","miles":"9 (3 R, 2WO)","shoes":"Spikes, Peg","notes":"2 WU, 2 CD"},{"type":"Race","miles":"7 (3 Race)","shoes":"Spikes, Peg","notes":"2 WU, 2 CD"}]},{"day":"Sunday","cells":[{"type":"LR","miles":"12","shoes":"Vomero+","notes":"Strides"},{"type":"Easy","miles":"10","shoes":"Vomero+","notes":"Strides"},{"type":"Easy","miles":"10","shoes":"Vomero+","notes":"Strides"}]}],"ref":{"shoes":"Vomero+ (easy runs) Rebel (WO/easy) Vaporfly (workouts) Pegasus(WU/CD/Shakeout) Spikes (race)","core":"Core at least 3 times a week (Monday, Wednesday, Friday)","gym":"Gym 1-2 times a week (Tuesday, Saturday, Sunday)","sessions":[{"title":"Tuesday workouts","desc":"Hard, race pace","items":["5xmile with 200 jog rest at 5k","7xk at faster than 5k with 200 jog rest","4x2k at 5k pace, 2min rest"]},{"title":"Thursday workouts","desc":"Medium, steady + speed","items":["8(3 min on, 1 min off)","16x400 at 5k with 200 jog rest","8xk at 5k +15 seconds pace, 90 seconds rest"]},{"title":"Sunday long run","desc":"Medium, steady","items":["3x10 min at 5k+25 seconds, 2:30 min jog recovery","Progression","If tired, just jog easy"]}]}}};

// Three gentler levels below the 30-mile plan, for newer and younger runners: level 1 of the base plans with every
// distance scaled (miles to the half mile; warm-up and cool-down too), the same week shapes and workout menu.
function scaled(plan, miles) {
  const f = miles / plan.weeks[0].miles;
  const half = (x) => Math.max(0.5, Math.round(x * f * 2) / 2);
  const nums = (t) => String(t).replace(/\d+(\.\d+)?/g, (n) => (Number(n) === 0 ? '0' : String(half(Number(n)))));
  const copy = JSON.parse(JSON.stringify(plan));
  copy.weeks = copy.weeks.map((w) => ({ ...w, miles: Math.round(w.miles * f) }));
  copy.days.forEach((d) => d.cells.forEach((c) => { c.miles = nums(c.miles); c.notes = c.notes.replace(/(\d+(\.\d+)?)(\s*(WU|CD))/g, (m, n, _d, rest) => `${half(Number(n))}${rest}`); }));
  copy.ref = { ...copy.ref, core: 'Core twice a week', sessions: copy.ref.sessions.map((x) => ({ ...x, desc: `${x.desc}. Newer runners: fewer reps, same paces.` })) };
  return copy;
}

// Levels 1-9: 15, 20, 25, 30, 35, 40, 45, 50 and 60 miles a week.
export const PLANS = {
  1: scaled(BASE_PLANS[1], 15), 2: scaled(BASE_PLANS[1], 20), 3: scaled(BASE_PLANS[1], 25),
  ...Object.fromEntries(Object.entries(BASE_PLANS).map(([r, p]) => [Number(r) + 3, p])),
};
export const RANKS = Object.keys(PLANS).map(Number).sort((a, b) => a - b);
export const TOP_RANK = RANKS[RANKS.length - 1];
export const DEFAULT_RANK = 1;
// The workout library names its variants by the original six levels ("plans 3-5"); this maps a level onto them.
export const libraryRank = (rank) => Math.max(1, Number(rank) - 3);

// The plan levels an athlete trains from: their own plan or their team's. There is no default: the built-in PLANS
// below are the Hunter Kessler plan (seeded into that team's team_plans) and the scale every AI-built plan uses.
export const plansOf = (person) => person?.plans || {};
export const hasPlan = (person) => Object.keys(plansOf(person)).length > 0;

export function rankOf(person) {
  const plans = plansOf(person);
  return plans[person?.plan_rank] ? Number(person.plan_rank) : DEFAULT_RANK;
}

export const milesOfRank = (person, rank) => plansOf(person)[rank]?.weeks[0].miles ?? null;

// The level whose no-race week is closest to (and not far above) what someone runs now.
export function rankForMiles(mpw, plans = PLANS) {
  const m = Number(mpw);
  if (!(m > 0)) return DEFAULT_RANK;
  let best = DEFAULT_RANK;
  for (const r of RANKS) if (plans[r] && plans[r].weeks[0].miles <= m * 1.1) best = r;
  return best;
}

export class PlanFormatError extends Error {}
const TYPES = ['Easy', 'Recovery', 'Workout', 'LR', 'Long run', 'Race', 'Shakeout', 'Cross-train', 'Off'];
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const txt = (v, max) => String(v ?? '').slice(0, max);

// A team plan template, checked and cleaned. Same shape as PLANS: { "1": { weeks, days, ref }, ... "6": ... }.
export function validateTeamPlans(raw) {
  if (!raw || typeof raw !== 'object') throw new PlanFormatError(`The plan must be an object with levels ${RANKS[0]}-${TOP_RANK}.`);
  const out = {};
  for (const r of RANKS) {
    const p = raw[r];
    if (!p) throw new PlanFormatError(`Level ${r} is missing.`);
    if (!Array.isArray(p.weeks) || p.weeks.length !== 3) throw new PlanFormatError(`Level ${r}: weeks must be [no race, race week, taper].`);
    const weeks = p.weeks.map((w, i) => {
      const miles = Number(w?.miles);
      if (!(miles > 0 && miles <= 150)) throw new PlanFormatError(`Level ${r}, week ${i + 1}: miles must be 1-150.`);
      return { miles, name: txt(w?.name || ['No race', 'Race week', 'Taper'][i], 30) };
    });
    if (!Array.isArray(p.days) || p.days.length !== 7) throw new PlanFormatError(`Level ${r}: days must list Monday to Sunday.`);
    const days = p.days.map((d, i) => {
      if (d?.day !== DAYS[i]) throw new PlanFormatError(`Level ${r}: day ${i + 1} must be ${DAYS[i]}.`);
      if (!Array.isArray(d.cells) || d.cells.length !== 3) throw new PlanFormatError(`Level ${r}, ${d.day}: three cells (one per week shape).`);
      return {
        day: d.day,
        cells: d.cells.map((c) => {
          if (!TYPES.includes(c?.type)) throw new PlanFormatError(`Level ${r}, ${d.day}: type must be one of ${TYPES.join(', ')}.`);
          return { type: c.type, miles: txt(c.miles, 30), shoes: txt(c.shoes, 60), notes: txt(c.notes, 120) };
        }),
      };
    });
    const ref = p.ref || {};
    const sessions = (Array.isArray(ref.sessions) ? ref.sessions : []).slice(0, 6).map((x) => ({
      title: txt(x?.title, 60), desc: txt(x?.desc, 120), items: (Array.isArray(x?.items) ? x.items : []).slice(0, 8).map((i) => txt(i, 200)),
    }));
    out[r] = { weeks, days, ref: { shoes: txt(ref.shoes, 200), core: txt(ref.core, 200), gym: txt(ref.gym, 200), sessions } };
  }
  return out;
}

// ---- Plans written by a person or a team captain with Kestrel AI -----------------------------------------------
// The AI does not write 54 cells. It writes one week shape (what each day is and what share of the week's miles it
// gets) for a normal week, a race week and a taper, plus a workout menu. expandPlanSpec turns that into all nine
// levels, scaled to each level's weekly miles, so every athlete lands on the level that fits their fitness.
const SPEC_DAY = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: TYPES },
    share: { type: 'number', description: 'Share of the weekly miles for this day, 0 to 1. Rest and cross-train days are 0. Shares in a week should add to about 1.' },
    notes: { type: 'string', description: 'Short: what the day is (e.g. "Strides", "Tempo 20 min", "1.5 WU 1.5 CD")' },
  },
  required: ['type', 'share'],
};
const SPEC_WEEK = { type: 'array', description: 'Exactly 7 days, Monday first.', items: SPEC_DAY };
export const PLAN_SPEC_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    summary: { type: 'string', description: 'Two sentences on the plan idea.' },
    normal_week: SPEC_WEEK, race_week: SPEC_WEEK, taper_week: SPEC_WEEK,
    race_week_factor: { type: 'number', description: 'Race week miles as a share of a normal week, 0.5 to 1.' },
    taper_factor: { type: 'number', description: 'Taper week miles as a share of a normal week, 0.4 to 1.' },
    core: { type: 'string' }, gym: { type: 'string' },
    sessions: { type: 'array', description: 'Workout menus (up to 4): for example Tuesday workouts, Thursday workouts, long run.', items: { type: 'object', properties: { title: { type: 'string' }, desc: { type: 'string' }, items: { type: 'array', items: { type: 'string' } } }, required: ['title', 'items'] } },
  },
  required: ['name', 'normal_week', 'race_week', 'taper_week'],
};

const LEVEL_MILES = Object.fromEntries(Object.entries(PLANS).map(([r, p]) => [r, p.weeks[0].miles]));
const halfMile = (x) => Math.round(x * 2) / 2;
const clamp = (n, lo, hi, d) => (Number.isFinite(Number(n)) ? Math.min(hi, Math.max(lo, Number(n))) : d);

function cleanWeek(week, label) {
  if (!Array.isArray(week) || week.length !== 7) throw new PlanFormatError(`${label} must list 7 days, Monday first.`);
  const days = week.map((d, i) => {
    const type = TYPES.includes(d?.type) ? d.type : d?.type === 'Long Run' ? 'LR' : null;
    if (!type) throw new PlanFormatError(`${label}, ${DAYS[i]}: day type must be one of ${TYPES.join(', ')}.`);
    const rest = type === 'Off' || type === 'Cross-train';
    return { type, share: rest ? 0 : Math.max(0, Number(d.share) || 0), notes: txt(d.notes, 100) };
  });
  const total = days.reduce((a, d) => a + d.share, 0);
  if (!(total > 0)) throw new PlanFormatError(`${label} has no running days.`);
  return days.map((d) => ({ ...d, share: d.share / total }));
}

// spec -> { plans (levels 1-9, validated), spec (cleaned) }
export function expandPlanSpec(raw) {
  if (!raw || typeof raw !== 'object') throw new PlanFormatError('The plan is empty.');
  const normal = cleanWeek(raw.normal_week, 'Normal week');
  const race = cleanWeek(raw.race_week, 'Race week');
  const taper = cleanWeek(raw.taper_week, 'Taper week');
  const factors = [1, clamp(raw.race_week_factor, 0.5, 1, 0.85), clamp(raw.taper_factor, 0.4, 1, 0.7)];
  const shapes = [normal, race, taper];
  const spec = {
    name: txt(raw.name, 80) || 'Training plan', summary: txt(raw.summary, 400),
    normal_week: normal.map(({ type, share, notes }) => ({ type, share: Math.round(share * 1000) / 1000, notes })),
    race_week: race.map(({ type, share, notes }) => ({ type, share: Math.round(share * 1000) / 1000, notes })),
    taper_week: taper.map(({ type, share, notes }) => ({ type, share: Math.round(share * 1000) / 1000, notes })),
    race_week_factor: factors[1], taper_factor: factors[2],
    core: txt(raw.core, 200), gym: txt(raw.gym, 200),
    sessions: (Array.isArray(raw.sessions) ? raw.sessions : []).slice(0, 4).map((x) => ({ title: txt(x?.title, 60), desc: txt(x?.desc, 120), items: (Array.isArray(x?.items) ? x.items : []).slice(0, 8).map((i) => txt(i, 200)) })),
  };
  const plans = {};
  for (const r of RANKS) {
    const base = LEVEL_MILES[r];
    plans[r] = {
      weeks: [0, 1, 2].map((i) => ({ miles: Math.round(base * factors[i]), name: ['No race', 'Race week', 'Taper'][i] })),
      days: DAYS.map((day, di) => ({
        day,
        cells: shapes.map((shape, wi) => {
          const d = shape[di];
          if (d.share === 0) return { type: d.type, miles: '0', shoes: '', notes: d.notes };
          const mi = Math.max(1, halfMile(base * factors[wi] * d.share));
          return { type: d.type, miles: String(mi), shoes: '', notes: d.notes };
        }),
      })),
      ref: { shoes: '', core: spec.core, gym: spec.gym, sessions: spec.sessions },
    };
  }
  return { plans: validateTeamPlans(plans), spec };
}
