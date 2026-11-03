// A pure copy of the rules applyPlanChange() and changeLevel() enforce in src/train/kai.js, for checking gold replies
// without a database. Keep it in step with kai.js: if a rule there changes, change it here and re-run `npm run check`.
// Only the days in the context's current plan week are known, so a gold plan_change must fall inside that week.
const HARD = new Set(['Workout', 'Race']);
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const round1 = (n) => Math.round(n * 10) / 10;
const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);

export function normType(t) {
  const s = String(t || '').trim().toLowerCase();
  if (s === 'lr' || s.startsWith('long')) return 'Long run';
  if (s.startsWith('work')) return 'Workout';
  if (s.startsWith('race')) return 'Race';
  if (s.startsWith('shake')) return 'Shakeout';
  if (s.startsWith('cross')) return 'Cross-train';
  if (s.startsWith('recov')) return 'Recovery';
  if (s === 'off' || s === 'rest') return 'Off';
  return 'Easy';
}

// Returns null when Kestrel would accept the change, else the reason it would refuse.
export function checkPlanChange(ctx, raw) {
  const today = ctx.today;
  const date = String(raw?.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < today || date > addDays(today, 13)) return 'The coach can change days from today to two weeks out.';
  const wk = ctx.plan?.week;
  if (!ctx.has_plan || !wk) return 'No plan yet.';
  const day = wk.days.find((d) => d.date === date);
  if (!day) return 'test setup: the gold plan_change date must fall inside the context plan week';
  const type = normType(raw?.type);
  const base = day.base;
  const miles = type === 'Off' || type === 'Cross-train' ? 0 : Math.round(Number(raw?.miles) * 10) / 10;
  if (type !== 'Off' && type !== 'Cross-train' && !(miles > 0 && miles <= 30)) return 'Give the day a distance in miles.';
  if (base && base.miles > 0 && miles > Math.min(base.miles * 1.2, base.miles + 2) + 0.05) {
    return `That's more than the plan allows for ${DOW[new Date(date + 'T12:00:00Z').getUTCDay()]} (${base.type} ${base.miles} mi): at most ${round1(Math.min(base.miles * 1.2, base.miles + 2))} mi.`;
  }
  if ((!base || base.miles === 0) && (miles > 4 || HARD.has(type) || type === 'Long run')) return 'A rest day can only become an easy jog of 4 miles or less.';
  if (HARD.has(type)) {
    const around = wk.days.filter((d) => d.date === addDays(date, -1) || d.date === addDays(date, 1));
    if (around.some((d) => HARD.has(d.type))) return 'No hard days back to back: move the other workout first, or make this one easy.';
  }
  const total = wk.days.reduce((a, d) => a + (d.date === date ? miles : d.miles), 0);
  const cap = wk.planned_miles * 1.1;
  if (total > cap + 0.05) return `That would put the week at ${round1(total)} mi, over the plan's limit (${round1(cap)} mi).`;
  return null;
}

export function checkLevelChange(ctx, change) {
  const level = ctx.plan?.level;
  if (!level) return 'No plan yet.';
  if (change.direction === 'up') {
    if (level.team) return 'Your captain decides when you move up a level.';
    if (!level.ready) return 'Not ready to level up yet.';
    return null;
  }
  if (change.direction === 'down') return null;
  return 'direction must be up or down';
}
