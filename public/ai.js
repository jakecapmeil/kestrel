// What powers Kestrel AI. Kestrel is the interface; the athlete picks the model.
// The choice and the API keys live on the ACCOUNT (the server keeps keys encrypted and never sends one back), so a model set up
// once works on every browser and app, and the server runs every job on it: chat, plans, the schedule reader, food photos and
// the run summaries written after a watch sync. Browsers only ever learn which providers have a key (has_key, last4).
// Models on the athlete's own computer (Ollama, LM Studio) and custom servers can't be reached from a server, so their
// address stays in this browser (localStorage) and the browser calls them itself; the account remembers that one was chosen.

export const PROVIDERS = {
  kestrel: { label: 'Kestrel (free default)', kind: 'kestrel', needsKey: false },
  openai: { label: 'OpenAI', kind: 'openai', server: true, model: 'gpt-4o-mini', needsKey: true, vision: true, keyUrl: 'https://platform.openai.com/api-keys' },
  anthropic: { label: 'Anthropic (Claude)', kind: 'anthropic', server: true, model: 'claude-haiku-5-5', needsKey: true, vision: true, keyUrl: 'https://console.anthropic.com/settings/keys' },
  gemini: { label: 'Google Gemini (your key)', kind: 'gemini', server: true, model: 'gemini-flash-latest', needsKey: true, vision: true, keyUrl: 'https://aistudio.google.com/apikey' },
  openrouter: { label: 'OpenRouter (hundreds of models)', kind: 'openai', server: true, model: 'openrouter/auto', needsKey: true, vision: true, keyUrl: 'https://openrouter.ai/keys' },
  groq: { label: 'Groq', kind: 'openai', server: true, model: 'llama-3.3-70b-versatile', needsKey: true, vision: false, keyUrl: 'https://console.groq.com/keys' },
  ollama: { label: 'Ollama (local, on this computer)', kind: 'openai', base: 'http://localhost:11434/v1', model: 'llama3.2', needsKey: false, local: true },
  lmstudio: { label: 'LM Studio (local)', kind: 'openai', base: 'http://localhost:1234/v1', model: '', needsKey: false, local: true },
  custom: { label: 'Other OpenAI-compatible server', kind: 'openai', base: '', model: '', needsKey: false },
};

const KEY = 'kestrel.ai';
// OpenAI's reasoning models (o1, o3, o4-mini, gpt-5…) take only the default temperature; sending one is an error.
const REASONING = /^(o\d|gpt-5)/;

// What each Kestrel AI job runs on. '' means the main model.
export const TASKS = {
  chat: { label: 'Kestrel chat and plans', hint: 'Coach chat, plan building and the team schedule reader.' },
  summary: { label: 'Run summaries', hint: 'The short report on each session after it syncs.' },
  food: { label: 'Food photos', hint: 'Estimates portions, calories, carbs, protein and fat from a photo or a description.', vision: true },
};

const isServer = (id) => !!PROVIDERS[id]?.server;
const isBrowser = (id) => !!PROVIDERS[id] && !PROVIDERS[id].server && id !== 'kestrel';

// ---- this browser's own part: addresses of local models, plus any API keys saved here before keys moved to the account.
function readLocal() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || '{}');
    const configs = {}, legacy = {};
    for (const [id, c] of Object.entries(s.configs || {})) {
      if (isBrowser(id)) configs[id] = c;
      else if (isServer(id) && c?.key) legacy[id] = { model: c.model || '', key: c.key };
    }
    for (const [id, c] of Object.entries(s.legacy || {})) if (isServer(id) && c?.key) legacy[id] = c;
    return { configs, legacy };
  } catch {
    return { configs: {}, legacy: {} };
  }
}

// The state the app works from: the account's choice and providers, plus this browser's local models.
// acct: what /api/me returns as `ai` ({ provider, tasks, providers }); null before sign-in.
export function withAccount(local, acct) {
  const configs = { ...local.configs };
  for (const [id, c] of Object.entries(acct?.providers || {})) configs[id] = { model: c.model || '', key: '', has_key: !!c.has_key, last4: c.last4 || '' };
  const tasks = {};
  for (const t of Object.keys(TASKS)) if (acct?.tasks?.[t] && PROVIDERS[acct.tasks[t]]) tasks[t] = acct.tasks[t];
  return { provider: PROVIDERS[acct?.provider] ? acct.provider : 'kestrel', tasks, configs, legacy: local.legacy || {} };
}

export function loadAi() { return withAccount(readLocal(), null); }

// A new state with the account's answer applied (after any change to the choice or a key).
export function applyAccount(state, acct) {
  return withAccount({ configs: Object.fromEntries(Object.entries(state.configs).filter(([id]) => isBrowser(id))), legacy: state.legacy }, acct);
}

// Only this browser's part is saved here; a key never is.
export function saveAi(state) {
  try {
    const configs = Object.fromEntries(Object.entries(state.configs || {}).filter(([id]) => isBrowser(id)));
    localStorage.setItem(KEY, JSON.stringify({ configs, legacy: state.legacy || {} }));
  } catch { /* private mode: settings last this visit only */ }
}

// Keys saved in this browser before they moved to the account, for the ones the account does not have yet.
export function legacyKeys(state) {
  return Object.entries(state.legacy || {}).filter(([id]) => isServer(id) && !state.configs[id]?.has_key).map(([id, c]) => ({ id, ...c }));
}
// Move them to the account (one call each), then forget them here. -> { moved, failed: [message] }
export async function moveLegacyKeys(state, apiFetch) {
  let moved = 0;
  const failed = [];
  let next = state;
  for (const k of legacyKeys(state)) {
    try {
      const acct = await apiFetch(`/api/me/ai/provider/${k.id}`, { method: 'PUT', body: JSON.stringify({ model: k.model, key: k.key }) });
      next = applyAccount(next, acct);
      moved++;
    } catch (err) { failed.push(`${PROVIDERS[k.id].label}: ${err.message}`); }
  }
  // What the account now has is forgotten here; what failed stays so it can be tried again.
  next = { ...next, legacy: Object.fromEntries(Object.entries(state.legacy || {}).filter(([id]) => !next.configs[id]?.has_key)) };
  saveAi(next);
  return { state: next, moved, failed };
}

// The state to call for one job: its own provider when one is set, else the main one.
export function forTask(state, task) {
  const id = state.tasks?.[task];
  return { ...state, provider: id && PROVIDERS[id] ? id : state.provider };
}

// True when the server runs this job: the free default, or a provider whose key is saved on the account.
export function onServer(state) { return state.provider === 'kestrel' || isServer(state.provider); }

// Providers that can actually run: the free default, any with a key on the account, and local / custom ones with an address saved.
export function usable(state) {
  return Object.keys(PROVIDERS).filter((id) => {
    if (id === 'kestrel') return true;
    if (isServer(id)) return !!state.configs[id]?.has_key;
    const c = configFor(state, id);
    return !!(state.configs[id] && c.base && c.model);
  });
}

// The settings for one provider: its defaults overlaid with what was saved.
export function configFor(state, id) {
  const p = PROVIDERS[id];
  const c = state.configs[id] || {};
  return { base: c.base ?? p.base ?? '', model: c.model ?? p.model ?? '', key: c.key ?? '', has_key: !!c.has_key, last4: c.last4 || '' };
}

export function describe(state) {
  const id = state.provider;
  if (id === 'kestrel') return 'Kestrel free';
  const c = configFor(state, id);
  return `${PROVIDERS[id].label.replace(/ \(.*\)$/, '')}${c.model ? ' · ' + c.model : ''}`;
}

// Change the main model and the per-job models on the account. -> the new state.
export async function saveChoice(state, apiFetch, { provider = state.provider, tasks = state.tasks } = {}) {
  const acct = await apiFetch('/api/me/ai/choice', { method: 'PUT', body: JSON.stringify({ provider, tasks }) });
  return applyAccount(state, acct);
}

async function readError(res) {
  const t = await res.text();
  try {
    const j = JSON.parse(t);
    return j.error?.message || j.error || j.message || t;
  } catch {
    return t.slice(0, 300) || res.statusText;
  }
}

function networkHelp(id, base, err) {
  if (PROVIDERS[id].local) {
    return `Could not reach ${base}. Is it running? Ollama must allow this site: quit Ollama, then run OLLAMA_ORIGINS=${location.origin} ollama serve (LM Studio: turn on "Enable CORS" in the server tab).`;
  }
  return `Could not reach ${base} (${err.message}). Check the address, or that this server allows calls from a browser.`;
}

// For a model in this browser (Ollama, LM Studio, a custom server): the call is made here, straight to the address.
// Every other model runs on the server with the key on the account, so it never comes through here.
// messages: [{ role: 'user' | 'assistant', content, images?: [{ mime, data (base64) }] }]  system: string  -> reply text
// Images need a model that can see (a local vision model such as llava).
export async function complete(state, system, messages) {
  const id = state.provider;
  const p = PROVIDERS[id];
  if (!isBrowser(id)) throw new Error(`${p.label} runs on Kestrel's server, not in the browser.`);
  const c = configFor(state, id);
  if (!c.base) throw new Error('Set the server address in AI settings.');
  if (!c.model) throw new Error('Set a model name in AI settings.');
  const base = c.base.replace(/\/+$/, '');
  let res;
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(c.key ? { Authorization: `Bearer ${c.key}` } : {}) },
      body: JSON.stringify({ model: c.model, messages: [{ role: 'system', content: system }, ...messages.map((m) => (m.images?.length ? { role: m.role, content: [{ type: 'text', text: m.content }, ...m.images.map((i) => ({ type: 'image_url', image_url: { url: `data:${i.mime};base64,${i.data}` } }))] } : { role: m.role, content: m.content }))], ...(REASONING.test(c.model.replace(/^.*\//, '')) ? {} : { temperature: 0.5 }) }),
    });
  } catch (err) {
    throw new Error(networkHelp(id, base, err));
  }
  if (!res.ok) throw new Error(`${p.label}: ${await readError(res)}`);
  const data = await res.json();
  // Some local reasoning models wrap their thinking in <think> tags.
  const text = String(data.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  if (!text) throw new Error(`${p.label} returned an empty answer.`);
  return text;
}

// Model names a provider offers. Server providers are asked through the server (it holds the key; a key being typed can
// be passed to check it before it is saved); local ones are asked directly. [] when not available.
export async function listModels(state, id, { apiFetch, key = '' } = {}) {
  const p = PROVIDERS[id];
  if (!p || p.kind === 'kestrel') return [];
  if (isServer(id)) {
    if (!key && !state.configs[id]?.has_key) return [];
    return (await apiFetch('/api/me/ai/models', { method: 'POST', body: JSON.stringify({ provider: id, key }) })).models || [];
  }
  const c = configFor(state, id);
  const base = c.base.replace(/\/+$/, '');
  if (!base) return [];
  let res;
  try { res = await fetch(`${base}/models`, { headers: c.key ? { Authorization: `Bearer ${c.key}` } : {} }); } catch (err) { throw new Error(networkHelp(id, base, err)); }
  if (!res.ok) throw new Error(`${p.label}: ${await readError(res)}`);
  return ((await res.json()).data || []).map((m) => m.id).filter(Boolean).sort();
}
