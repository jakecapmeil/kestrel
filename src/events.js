// The events Kestrel knows: PRs are stored under these keys and predictions are made for them.
// task says which model slot predicts the event: 'short' (sprints, 400-1000, steeple) or 'race'.

const MILE = 1609.344;

export const EVENTS = [
  { key: '100', label: '100 m', m: 100, surf: 'track', task: 'short' },
  { key: '200', label: '200 m', m: 200, surf: 'track', task: 'short' },
  { key: '400', label: '400 m', m: 400, surf: 'track', task: 'short' },
  { key: '600', label: '600 m', m: 600, surf: 'track', task: 'short' },
  { key: '800', label: '800 m', m: 800, surf: 'track', task: 'race' },
  { key: '1000', label: '1000 m', m: 1000, surf: 'track', task: 'short' },
  { key: '1500', label: '1500 m', m: 1500, surf: 'track', task: 'race' },
  { key: '1600', label: '1600 m', m: 1600, surf: 'track', task: 'race' },
  { key: 'mile', label: 'Mile', m: MILE, surf: 'track', task: 'race' },
  { key: '3000', label: '3000 m', m: 3000, surf: 'track', task: 'race' },
  { key: '3200', label: '3200 m', m: 3200, surf: 'track', task: 'race' },
  { key: '5000', label: '5000 m', m: 5000, surf: 'track', task: 'race' },
  { key: '10000', label: '10,000 m', m: 10000, surf: 'track', task: 'race' },
  { key: 'S2000', label: '2000 m steeple', m: 2000, surf: 'track', task: 'short', steeple: true },
  { key: 'S3000', label: '3000 m steeple', m: 3000, surf: 'track', task: 'short', steeple: true },
  { key: 'xc4k', label: 'XC 4K', m: 4000, surf: 'xc', task: 'race' },
  { key: 'xc5k', label: 'XC 5K', m: 5000, surf: 'xc', task: 'race' },
  { key: 'xc3mi', label: 'XC 3 mi', m: 3 * MILE, surf: 'xc', task: 'race' },
  { key: 'xc6k', label: 'XC 6K', m: 6000, surf: 'xc', task: 'race' },
  { key: 'xc8k', label: 'XC 8K', m: 8000, surf: 'xc', task: 'race' },
  { key: 'road5k', label: 'Road 5K', m: 5000, surf: 'road', task: 'race' },
  { key: 'road10k', label: 'Road 10K', m: 10000, surf: 'road', task: 'race' },
  { key: 'half', label: 'Half marathon', m: 21097.5, surf: 'road', task: 'race' },
];

export const EVENT = new Map(EVENTS.map((e) => [e.key, e]));

// "4:35.2", "16:02", "1:05:30" or plain seconds -> seconds (NaN when unreadable)
export function parseTime(s) {
  const t = String(s ?? '').trim();
  if (!/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(t)) return NaN;
  return t.split(':').reduce((acc, part) => acc * 60 + Number(part), 0);
}

export function fmtTime(sec, tenths = sec < 120) {
  if (!Number.isFinite(sec)) return '';
  const r = tenths ? Math.round(sec * 10) / 10 : Math.round(sec);
  const h = Math.floor(r / 3600);
  const m = Math.floor((r % 3600) / 60);
  const s = r % 60;
  const ss = tenths ? s.toFixed(1).padStart(4, '0') : String(Math.floor(s)).padStart(2, '0');
  if (h) return `${h}:${String(m).padStart(2, '0')}:${ss}`;
  return m ? `${m}:${ss}` : (tenths ? s.toFixed(1) : String(s));
}
