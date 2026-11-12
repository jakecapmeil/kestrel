// Supporter perks. Donations happen on an outside platform (Open Collective, HCB, GitHub Sponsors), which doesn't tell
// Kestrel who gave, so the maintainer emails each donor a code (scripts/supporter-code.mjs). A code is signed with
// SUPPORTER_SECRET (its own Worker secret, not the one that encrypts watch keys): KS-<tier>-<nonce>-<signature>.
// Each code works for one account (the supporter_codes table). Perks are cosmetic only; no feature is ever behind a donation.

export class SupportError extends Error {}

export const TIERS = { s: 'supporter', c: 'champion' }; // champion: $100+, merch is sent by hand
export const ACCENTS = {
  kestrel: { label: 'Kestrel red', light: '#d6361c', dark: '#ff6b4a' },
  ember: { label: 'Ember', light: '#c2410c', dark: '#fb923c' },
  ocean: { label: 'Ocean', light: '#0369a1', dark: '#38bdf8' },
  forest: { label: 'Forest', light: '#15803d', dark: '#4ade80' },
  violet: { label: 'Violet', light: '#6d28d9', dark: '#a78bfa' },
  gold: { label: 'Gold', light: '#a16207', dark: '#facc15' },
  rose: { label: 'Rose', light: '#be185d', dark: '#f472b6' },
};

async function sign(secret, text) {
  if (!secret) throw new SupportError('Supporter codes aren’t set up on this server yet.');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('supporter:' + text)));
  return [...sig.slice(0, 6)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

export async function mintCode(secret, tier, nonce) {
  const t = Object.keys(TIERS).find((k) => TIERS[k] === tier || k === tier);
  if (!t) throw new SupportError('Unknown tier');
  return `KS-${t.toUpperCase()}-${nonce}-${await sign(secret, `${t}-${nonce}`)}`;
}

export async function redeemCode(secret, raw) {
  const code = String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
  const m = code.match(/^KS-([SC])-([A-Z0-9]{4,12})-([0-9A-F]{12})$/);
  if (!m) throw new SupportError('That doesn’t look like a supporter code (KS-…). Check the email it came in.');
  const t = m[1].toLowerCase();
  if (await sign(secret, `${t}-${m[2]}`) !== m[3]) throw new SupportError('That code isn’t valid. Check it was copied in full.');
  return { tier: TIERS[t], code: `KS-${m[1]}-${m[2]}`, since: Date.now() };
}

export function cleanAppearance(raw, supporter) {
  const accent = String(raw?.accent || 'kestrel');
  if (!ACCENTS[accent]) throw new SupportError('Pick one of the colours.');
  if (accent !== 'kestrel' && !supporter) throw new SupportError('Colour themes are a thank-you for supporters.');
  return { accent };
}
