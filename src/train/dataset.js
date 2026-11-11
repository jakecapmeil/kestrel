// Data sharing for Kestrel's models. Off unless the runner turns it on in You → Settings.
//   kestrel: Kestrel may use their anonymized training to test and improve its models. Never published.
//   open:    the same anonymized records may also go into the Kestrel open dataset (published under CC BY 4.0).
// Anonymized means: a random pseudonym instead of any id, no name, email, team, school, notes, AI text, GPS route,
// course or start time, ages as bands, dates shifted by a per-runner random number of whole weeks (weekdays stay right),
// and weather and climbing rounded. See docs/data-sharing.md.

export const SHARE_CHOICES = ['none', 'kestrel', 'open'];
export const SHARE_VERSION = 1;

export class ShareError extends Error {}

export function shareOf(settings) {
  const d = settings?.data_share;
  return d && SHARE_CHOICES.includes(d.choice) ? d : { choice: 'none', at: null, version: SHARE_VERSION };
}

// Adults only for the open dataset: once published it can't be taken back, so a minor can't agree to it alone.
export function ageOf(profile, now = new Date()) {
  const y = Number(profile?.birth_year);
  return Number.isFinite(y) && y > 1900 ? now.getFullYear() - y : null;
}

export function cleanShare(choice, profile) {
  if (!SHARE_CHOICES.includes(choice)) throw new ShareError('Pick one of the options.');
  if (choice === 'open') {
    const age = ageOf(profile);
    if (age == null) throw new ShareError('Add the year you were born (You → Runner profile) first. The open dataset is for runners 18 and over.');
    if (age < 18) throw new ShareError('The open dataset is for runners 18 and over. You can still share with Kestrel only.');
  }
  return { choice, at: Date.now(), version: SHARE_VERSION };
}

async function hmac(secret, text) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret || 'kestrel-dev'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)));
}

const band = (age) => age == null ? null : age < 14 ? '13' : age < 16 ? '14-15' : age < 18 ? '16-17' : age < 23 ? '18-22' : age < 30 ? '23-29' : age < 40 ? '30-39' : age < 50 ? '40-49' : age < 60 ? '50-59' : '60+';
const round = (v, step) => v == null ? null : Math.round(v / step) * step;
const shift = (date, days) => { const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };

// One runner's anonymized record. person: the people row; workouts: their rows from the workouts table.
export async function anonymize(env, person, workouts, settings) {
  const h = await hmac(env.KESTREL_SECRET, 'dataset:' + person.id);
  const runner = 'r_' + [...h.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
  // Between 4 and 160 weeks back, the same for every run of this runner.
  const offset = -7 * (4 + ((h[8] << 8 | h[9]) % 157));
  const p = settings?.profile || {};
  return {
    runner,
    age_band: band(ageOf(p)),
    sex: person.sex || null,
    experience: p.experience || null,
    runs: workouts.map((w) => {
      let laps = [];
      try { laps = JSON.parse(w.laps || '[]'); } catch { /* none */ }
      return {
        date: shift(w.date, offset),
        category: w.category, surface: w.surface || null,
        miles: w.distance_mi != null ? Math.round(w.distance_mi * 100) / 100 : null,
        moving_sec: w.moving_sec ?? null, avg_hr: w.avg_hr ?? null, max_hr: w.max_hr ?? null, cadence: w.avg_cadence ?? null,
        elev_ft: round(w.elev_gain_ft, 10), temp_f: round(w.temp_f, 5), effort: w.effort ?? null, load: w.load ?? null,
        laps: Array.isArray(laps) ? laps.slice(0, 40).map((l) => ({ m: Math.round(l.m), s: l.s, hr: l.hr ?? null })) : [],
      };
    }),
  };
}

// Every consenting runner's records, one JSON object per line. scope 'open' = open-dataset consent only.
export async function exportDataset(env, scope) {
  const want = scope === 'open' ? ['open'] : ['kestrel', 'open'];
  const { results } = await env.DB.prepare(
    `SELECT id, sex, settings FROM people WHERE json_extract(settings, '$.data_share.choice') IN (${want.map(() => '?').join(',')})`
  ).bind(...want).all();
  const lines = [];
  for (const person of results) {
    let settings = {};
    try { settings = JSON.parse(person.settings || '{}'); } catch { continue; }
    if (scope === 'open' && (ageOf(settings.profile) ?? 0) < 18) continue;
    const { results: ws } = await env.DB.prepare(
      'SELECT date, category, surface, distance_mi, moving_sec, avg_hr, max_hr, avg_cadence, elev_gain_ft, temp_f, effort, load, laps FROM workouts WHERE person_id = ? ORDER BY date'
    ).bind(person.id).all();
    lines.push(JSON.stringify(await anonymize(env, person, ws, settings)));
  }
  return lines.join('\n') + (lines.length ? '\n' : '');
}
