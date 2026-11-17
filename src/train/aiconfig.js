// What powers Kestrel AI for one account. The choice (a main provider and an optional override per job) and the
// athlete's API keys live here, in D1, so they follow the athlete to every browser and app and so the server can run
// every job (chat, plans, schedule, food photos, and run summaries after a sync) on the athlete's own model.
//
// Keys are AES-GCM encrypted at rest with a key derived from KESTREL_SECRET (its own derivation, separate from the
// intervals.icu one), and are only ever decrypted to make the athlete's own call. A browser gets has_key and the last
// four characters, never the key.
//
// Local models (Ollama, LM Studio) and custom addresses can't be reached from a server, so they stay in the browser:
// the account remembers only that they were chosen.

export class AiConfigError extends Error {}

// Providers the server calls itself. Fixed addresses: a stored key is only ever sent to the provider's own host.
export const SERVER_PROVIDERS = {
  anthropic: { label: 'Anthropic (Claude)', kind: 'anthropic', base: 'https://api.anthropic.com/v1', model: 'claude-sonnet-5-5', vision: true },
  openai: { label: 'OpenAI', kind: 'openai', base: 'https://api.openai.com/v1', model: 'gpt-6.1-terra', vision: true },
  gemini: { label: 'Google Gemini', kind: 'gemini', base: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-flash-latest', vision: true },
  openrouter: { label: 'OpenRouter', kind: 'openai', base: 'https://openrouter.ai/api/v1', model: 'openrouter/auto', vision: true },
  groq: { label: 'Groq', kind: 'openai', base: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', vision: false },
};
// Chosen on the account but run in the browser.
const BROWSER_PROVIDERS = ['ollama', 'lmstudio', 'custom'];
export const TASK_IDS = ['chat', 'summary', 'food'];
const CHOICES = ['kestrel', ...Object.keys(SERVER_PROVIDERS), ...BROWSER_PROVIDERS];

// A provider's address. <ID>_API_BASE overrides it for local testing only (GEMINI_API_BASE is the host, as in gemini.js).
export function baseOf(env, id) {
  if (id === 'gemini' && env?.GEMINI_API_BASE) return `${env.GEMINI_API_BASE}/v1beta`;
  return env?.[`${id.toUpperCase()}_API_BASE`] || SERVER_PROVIDERS[id].base;
}

// ------------------------------------------------------------------ crypto

async function aesKey(env) {
  if (!env.KESTREL_SECRET) throw new AiConfigError('Saving an API key is not set up on this server yet (KESTREL_SECRET).');
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.KESTREL_SECRET), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('kestrel-ai'), info: new TextEncoder().encode('ai-key-v1') },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function encryptKey(env, text, personId) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  // The person's id is authenticated with the key, so a stored blob can't be moved to another account's row.
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(personId) }, await aesKey(env), new TextEncoder().encode(text));
  return `${b64(iv)}.${b64(ct)}`;
}

export async function decryptKey(env, blob, personId) {
  const [iv, ct] = String(blob || '').split('.');
  if (!iv || !ct) throw new AiConfigError('No key is saved for this provider.');
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv), additionalData: new TextEncoder().encode(personId) }, await aesKey(env), unb64(ct));
    return new TextDecoder().decode(pt);
  } catch {
    throw new AiConfigError('Your saved API key could not be read. Enter it again in You → Integrate.');
  }
}

// ------------------------------------------------------------------ the account's settings

const clip = (v, n) => String(v ?? '').trim().slice(0, n);
const parse = (s) => { try { const o = JSON.parse(s || '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch { return {}; } };

function cleanModel(v) {
  const m = clip(v, 120);
  if (m && !/^[\w.:/@+-]+$/.test(m)) throw new AiConfigError('That model name has characters a model name does not use.');
  return m;
}
function cleanKey(v) {
  const k = String(v ?? '').replace(/\s+/g, '');
  if (k.length < 8 || k.length > 400 || !/^[\w.:~+/=-]+$/.test(k)) throw new AiConfigError('That does not look like an API key. Paste the whole key from the provider.');
  return k;
}

// -> { provider, tasks, providers: { id: { model, has_key, last4 } } }. Safe to send to the browser.
export async function accountAi(db, personId) {
  const choice = await db.prepare('SELECT provider, tasks FROM ai_choice WHERE person_id = ?').bind(personId).first();
  const { results } = await db.prepare('SELECT provider, model, last4, key_enc FROM ai_keys WHERE person_id = ?').bind(personId).all();
  const providers = {};
  for (const r of results || []) if (SERVER_PROVIDERS[r.provider]) providers[r.provider] = { model: r.model, has_key: !!r.key_enc, last4: r.last4 };
  const tasks = {};
  for (const [t, id] of Object.entries(parse(choice?.tasks))) if (TASK_IDS.includes(t) && CHOICES.includes(id)) tasks[t] = id;
  return { provider: CHOICES.includes(choice?.provider) ? choice.provider : 'kestrel', tasks, providers, saved: !!choice };
}

// Set the main provider and the per-job overrides. A provider with no key can't be chosen (browser providers excepted).
export async function setChoice(db, personId, { provider, tasks }) {
  const acct = await accountAi(db, personId);
  const ready = (id) => id === 'kestrel' || BROWSER_PROVIDERS.includes(id) || !!acct.providers[id]?.has_key;
  const main = clip(provider, 20) || 'kestrel';
  if (!CHOICES.includes(main)) throw new AiConfigError('Unknown provider.');
  if (!ready(main)) throw new AiConfigError(`Add your ${SERVER_PROVIDERS[main].label} API key first.`);
  const per = {};
  for (const [t, id] of Object.entries(tasks && typeof tasks === 'object' ? tasks : {})) {
    if (!TASK_IDS.includes(t) || !id || id === main) continue;
    if (!CHOICES.includes(id)) throw new AiConfigError('Unknown provider.');
    if (!ready(id)) throw new AiConfigError(`Add your ${SERVER_PROVIDERS[id].label} API key first.`);
    per[t] = id;
  }
  await db.prepare(
    `INSERT INTO ai_choice (person_id, provider, tasks, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(person_id) DO UPDATE SET provider = excluded.provider, tasks = excluded.tasks, updated_at = excluded.updated_at`
  ).bind(personId, main, JSON.stringify(per), Date.now()).run();
}

// Save a provider's model and/or key. No key in the call keeps the saved one; a first save needs one.
export async function saveProvider(env, db, personId, id, { model, key }) {
  const p = SERVER_PROVIDERS[id];
  if (!p) throw new AiConfigError('That provider runs in your browser; its settings stay there.');
  const row = await db.prepare('SELECT key_enc, last4, model FROM ai_keys WHERE person_id = ? AND provider = ?').bind(personId, id).first();
  const mdl = cleanModel(model) || row?.model || p.model;
  if (key === undefined || key === null || String(key).trim() === '') {
    if (!row?.key_enc) throw new AiConfigError(`Paste your ${p.label} API key.`);
    await db.prepare('UPDATE ai_keys SET model = ?, updated_at = ? WHERE person_id = ? AND provider = ?').bind(mdl, Date.now(), personId, id).run();
    return;
  }
  const k = cleanKey(key);
  await db.prepare(
    `INSERT INTO ai_keys (person_id, provider, model, key_enc, last4, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(person_id, provider) DO UPDATE SET model = excluded.model, key_enc = excluded.key_enc, last4 = excluded.last4, updated_at = excluded.updated_at`
  ).bind(personId, id, mdl, await encryptKey(env, k, personId), k.slice(-4), Date.now()).run();
}

// Forget a provider's key. Anything that was set to run on it goes back to the free default.
export async function removeProvider(db, personId, id) {
  await db.prepare('DELETE FROM ai_keys WHERE person_id = ? AND provider = ?').bind(personId, id).run();
  const acct = await accountAi(db, personId);
  if (!acct.saved) return;
  const tasks = Object.fromEntries(Object.entries(acct.tasks).filter(([, v]) => v !== id));
  await db.prepare('UPDATE ai_choice SET provider = ?, tasks = ?, updated_at = ? WHERE person_id = ?')
    .bind(acct.provider === id ? 'kestrel' : acct.provider, JSON.stringify(tasks), Date.now(), personId).run();
}

export async function removeAll(db, personId) {
  await db.prepare('DELETE FROM ai_keys WHERE person_id = ?').bind(personId).run();
  await db.prepare('DELETE FROM ai_choice WHERE person_id = ?').bind(personId).run();
}

// ------------------------------------------------------------------ which model runs a job

// -> { mode: 'free' } | { mode: 'browser', id } | { mode: 'missing', id, label } | { mode: 'own', id, kind, base, model, key, label, vision }
// 'own' needs the decrypted key; this is the only place it is decrypted for a job.
export async function modelFor(env, db, personId, task, only = '') {
  const acct = await accountAi(db, personId);
  const id = only || acct.tasks[task] || acct.provider;
  if (id === 'kestrel') return { mode: 'free' };
  if (BROWSER_PROVIDERS.includes(id)) return { mode: 'browser', id };
  const p = SERVER_PROVIDERS[id];
  const row = await db.prepare('SELECT key_enc, model FROM ai_keys WHERE person_id = ? AND provider = ?').bind(personId, id).first();
  if (!row?.key_enc) return { mode: 'missing', id, label: p.label };
  return { mode: 'own', id, kind: p.kind, base: baseOf(env, id), model: row.model || p.model, key: await decryptKey(env, row.key_enc, personId), label: p.label, vision: p.vision };
}

// The key of one provider, for listing its models from the settings page.
export async function keyFor(env, db, personId, id) {
  const row = await db.prepare('SELECT key_enc FROM ai_keys WHERE person_id = ? AND provider = ?').bind(personId, id).first();
  return row?.key_enc ? decryptKey(env, row.key_enc, personId) : '';
}

