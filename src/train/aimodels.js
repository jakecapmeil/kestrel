// Which models a runner can pick for each provider. A reviewed list (CURATED) is always offered first; with a key the
// provider's own model list is read live, so a model the key can't use is dropped and a new one shows up on its own.
// Reviewed 2026-11-17 against the providers' model pages:
//   Anthropic: platform.claude.com/docs/en/about-claude/models/overview
//   OpenAI: developers.openai.com/api/docs/models and /deprecations (gpt-4o, gpt-4.1 and gpt-5 families shut down Dec 2026 - Jan 2027)
//   Google: aistudio.google.com/docs/models
import { SERVER_PROVIDERS, baseOf, AiConfigError } from './aiconfig.js';

// note: two or three words, shown beside the name.
export const CURATED = {
  anthropic: [
    { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', note: 'Recommended', vision: true },
    { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', note: 'Most capable', vision: true },
    { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', note: 'Cheapest', vision: true },
    { id: 'claude-fable-5-2', label: 'Claude Fable 5.2', note: 'Top reasoning', vision: true },
  ],
  openai: [
    { id: 'gpt-6.1-terra', label: 'GPT-6.1 Terra', note: 'Recommended', vision: true },
    { id: 'gpt-6-luna', label: 'GPT-6 Luna', note: 'Cheapest', vision: true },
    { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', note: 'Strong', vision: true },
    { id: 'gpt-6-astra', label: 'GPT-6 Astra', note: 'Most capable', vision: true },
  ],
  gemini: [
    { id: 'gemini-flash-latest', label: 'Gemini Flash (latest)', note: 'Recommended', vision: true },
    { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', note: 'Strong', vision: true },
    { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash', note: 'Balanced', vision: true },
    { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', note: 'Cheapest', vision: true },
    { id: 'gemini-4-hydrogen', label: 'Gemini 4 Hydrogen', note: 'Fast', vision: true },
    { id: 'gemini-4-argon', label: 'Gemini 4 Argon', note: 'Strong', vision: true },
    { id: 'gemini-4-carbon', label: 'Gemini 4 Carbon', note: 'Most capable', vision: true },
  ],
  openrouter: [{ id: 'openrouter/auto', label: 'Auto', note: 'Picks per request', vision: true }],
  groq: [{ id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B', note: 'Recommended', vision: false }],
};

const NOT_CHAT = /(embed|image|tts|audio|live|realtime|transcribe|whisper|moderation|dall-e|imagen|veo|robotics|aqa|learnlm|computer-use|deep-research|search|instruct|codex|cyber|rosalind|guard|playai|nano-banana|-exp)/i;

// Newest first: by a version number in the id, then the provider's own creation time.
const versionOf = (id) => {
  const m = String(id).match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : 0;
};
const tier = (id) => (/pro|opus|astra|carbon|sol/i.test(id) ? 3 : /lite|mini|nano|luna|haiku|hydrogen/i.test(id) ? 1 : 2);

async function getJson(url, headers, name, key) {
  let res;
  try { res = await fetch(url, { headers }); } catch { throw new AiConfigError(`Couldn’t reach ${name}.`); }
  if (res.ok) return res.json();
  let msg = '';
  try { const j = await res.json(); msg = j.error?.message || (typeof j.error === 'string' ? j.error : '') || ''; } catch { /* no body */ }
  msg = msg.split(key).join('…').replace(/\s+/g, ' ').slice(0, 140);
  const e = new AiConfigError(res.status === 401 || res.status === 403 ? `${name} rejected that key${msg ? ` (${msg})` : ''}.` : `${name} answered ${res.status}${msg ? `: ${msg}` : ''}.`);
  e.auth = res.status === 401 || res.status === 403;
  throw e;
}

// [{ id, label, created, vision }] the key can use, chat models only.
async function live(env, id, key) {
  const p = SERVER_PROVIDERS[id];
  const base = baseOf(env, id);
  if (p.kind === 'anthropic') {
    const d = await getJson(`${base}/models?limit=1000`, { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, p.label, key);
    return (d.data || []).filter((m) => m.id && !['retired', 'deprecated'].includes(m.lifecycle) && /^claude-/.test(m.id))
      .map((m) => ({ id: m.id, label: m.display_name || m.id, created: Date.parse(m.created_at) || 0, vision: m.capabilities?.image_input?.supported !== false }));
  }
  if (p.kind === 'gemini') {
    const out = [];
    let token = '';
    for (let i = 0; i < 4; i++) {
      const d = await getJson(`${base}/models?pageSize=200${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`, { 'x-goog-api-key': key }, p.label, key);
      for (const m of d.models || []) {
        const mid = String(m.name || '').replace(/^models\//, '');
        if (/^(gemini|gemma)/.test(mid) && (m.supportedGenerationMethods || []).includes('generateContent') && !NOT_CHAT.test(mid)) out.push({ id: mid, label: m.displayName || mid, created: 0, vision: true });
      }
      token = d.nextPageToken || '';
      if (!token) break;
    }
    return out;
  }
  const d = await getJson(`${base}/models`, { Authorization: `Bearer ${key}` }, p.label, key);
  let list = (d.data || []).filter((m) => m.id);
  if (id === 'openai') {
    const ids = new Set(list.map((m) => m.id));
    // Dated snapshots (gpt-x-2026-01-02) are left out when the plain name is there.
    list = list.filter((m) => /^(gpt-|o\d|chatgpt-)/.test(m.id) && !NOT_CHAT.test(m.id) && !(/-\d{4}-\d{2}-\d{2}$|-\d{4}$/.test(m.id) && ids.has(m.id.replace(/-\d{4}(-\d{2}-\d{2})?$/, ''))));
  } else if (id === 'openrouter') {
    list = list.filter((m) => !m.architecture?.output_modalities || m.architecture.output_modalities.includes('text'));
  } else {
    list = list.filter((m) => !NOT_CHAT.test(m.id));
  }
  return list.map((m) => ({ id: m.id, label: m.name || m.id, created: (m.created || 0) * 1000, vision: id === 'groq' ? false : !m.architecture?.input_modalities || m.architecture.input_modalities.includes('image') }));
}

// -> { models: [{ id, label, note?, vision }], live: boolean, error?: string }
// No key: the reviewed list. With a key: the provider's own list, the reviewed models first (only those the key can use).
// A wrong key is an error; any other failure falls back to the reviewed list.
export async function modelList(env, id, key = '') {
  if (!SERVER_PROVIDERS[id]) return { models: [], live: false };
  const curated = CURATED[id] || [];
  if (!key) return { models: curated, live: false };
  let found;
  try { found = await live(env, id, key); } catch (err) {
    if (err.auth) throw err;
    return { models: curated, live: false, error: err.message };
  }
  if (!found.length) return { models: curated, live: false };
  const byId = new Map(found.map((m) => [m.id, m]));
  const first = curated.filter((c) => byId.has(c.id)).map((c) => ({ ...c, vision: byId.get(c.id).vision ?? c.vision }));
  const seen = new Set(first.map((m) => m.id));
  const rest = found.filter((m) => !seen.has(m.id))
    .sort((a, b) => b.created - a.created || versionOf(b.id) - versionOf(a.id) || tier(b.id) - tier(a.id) || a.id.localeCompare(b.id))
    .slice(0, 40).map((m) => ({ id: m.id, label: m.label, vision: m.vision }));
  return { models: [...first, ...rest], live: true };
}
