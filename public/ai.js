// Kestrel AI providers, called from the browser. Kestrel is the interface; the athlete picks what powers it.
// API keys are kept in this browser only (localStorage) and sent straight to the provider, never to Kestrel's server.
// "kestrel" is the exception: it goes to /api/ai/chat, which runs the free default (Gemini, with an open-weight fallback).

export const PROVIDERS = {
  kestrel: { label: 'Kestrel (free default, Gemini)', kind: 'kestrel', needsKey: false },
  openai: { label: 'OpenAI', kind: 'openai', base: 'https://api.openai.com/v1', model: 'gpt-4o-mini', needsKey: true, keyUrl: 'https://platform.openai.com/api-keys' },
  anthropic: { label: 'Anthropic (Claude)', kind: 'anthropic', base: 'https://api.anthropic.com/v1', model: 'claude-haiku-5-5', needsKey: true, keyUrl: 'https://console.anthropic.com/settings/keys' },
  gemini: { label: 'Google Gemini (your key)', kind: 'gemini', base: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-flash-latest', needsKey: true, keyUrl: 'https://aistudio.google.com/apikey' },
  openrouter: { label: 'OpenRouter (hundreds of models)', kind: 'openai', base: 'https://openrouter.ai/api/v1', model: 'openrouter/auto', needsKey: true, keyUrl: 'https://openrouter.ai/keys' },
  groq: { label: 'Groq', kind: 'openai', base: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', needsKey: true, keyUrl: 'https://console.groq.com/keys' },
  ollama: { label: 'Ollama (local, on this computer)', kind: 'openai', base: 'http://localhost:11434/v1', model: 'llama3.2', needsKey: false, local: true },
  lmstudio: { label: 'LM Studio (local)', kind: 'openai', base: 'http://localhost:1234/v1', model: '', needsKey: false, local: true },
  custom: { label: 'Other OpenAI-compatible server', kind: 'openai', base: '', model: '', needsKey: false },
};

const KEY = 'kestrel.ai';

export function loadAi() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { provider: PROVIDERS[s.provider] ? s.provider : 'kestrel', configs: s.configs || {} };
  } catch {
    return { provider: 'kestrel', configs: {} };
  }
}

export function saveAi(state) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode: settings last this visit only */ }
}

// The settings for one provider: its defaults overlaid with what the athlete saved.
export function configFor(state, id) {
  const p = PROVIDERS[id];
  const c = state.configs[id] || {};
  return { base: c.base ?? p.base ?? '', model: c.model ?? p.model ?? '', key: c.key ?? '' };
}

export function describe(state) {
  const id = state.provider;
  if (id === 'kestrel') return 'Kestrel (Gemini)';
  const c = configFor(state, id);
  return `${PROVIDERS[id].label.replace(/ \(.*\)$/, '')}${c.model ? ' · ' + c.model : ''}`;
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
  return `Could not reach ${base} (${err.message}). Check the address, or that this provider allows calls from a browser.`;
}

// messages: [{ role: 'user' | 'assistant', content }]  system: string  -> reply text
export async function complete(state, system, messages, { apiFetch }) {
  const id = state.provider;
  const p = PROVIDERS[id];
  if (p.kind === 'kestrel') {
    const r = await apiFetch('/api/ai/chat', { method: 'POST', body: JSON.stringify({ messages }) });
    return r.text;
  }
  const c = configFor(state, id);
  if (!c.base) throw new Error('Set the server address in AI settings.');
  if (!c.model) throw new Error('Set a model name in AI settings.');
  if (p.needsKey && !c.key) throw new Error(`Add your ${p.label} API key in AI settings.`);
  const base = c.base.replace(/\/+$/, '');
  let res;
  try {
    if (p.kind === 'anthropic') {
      res = await fetch(`${base}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': c.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({ model: c.model, max_tokens: 1500, system, messages }),
      });
    } else if (p.kind === 'gemini') {
      res = await fetch(`${base}/models/${encodeURIComponent(c.model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': c.key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
        }),
      });
    } else {
      res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(c.key ? { Authorization: `Bearer ${c.key}` } : {}) },
        body: JSON.stringify({ model: c.model, messages: [{ role: 'system', content: system }, ...messages], temperature: 0.5 }),
      });
    }
  } catch (err) {
    throw new Error(networkHelp(id, base, err));
  }
  if (!res.ok) throw new Error(`${p.label}: ${await readError(res)}`);
  const data = await res.json();
  let text = '';
  if (p.kind === 'anthropic') text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  else if (p.kind === 'gemini') text = (data.candidates?.[0]?.content?.parts || []).filter((x) => !x.thought).map((x) => x.text || '').join('');
  else text = data.choices?.[0]?.message?.content || '';
  // Some local reasoning models wrap their thinking in <think> tags.
  text = String(text).replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  if (!text) throw new Error(`${p.label} returned an empty answer.`);
  return text;
}

// Model names the server offers (OpenAI-compatible /models, Gemini models list). [] when not available.
export async function listModels(state, id) {
  const p = PROVIDERS[id];
  const c = configFor(state, id);
  const base = c.base.replace(/\/+$/, '');
  if (!base || p.kind === 'kestrel') return [];
  let res;
  try {
    if (p.kind === 'gemini') res = await fetch(`${base}/models?pageSize=200`, { headers: { 'x-goog-api-key': c.key } });
    else if (p.kind === 'anthropic') res = await fetch(`${base}/models?limit=100`, { headers: { 'x-api-key': c.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' } });
    else res = await fetch(`${base}/models`, { headers: c.key ? { Authorization: `Bearer ${c.key}` } : {} });
  } catch (err) {
    throw new Error(networkHelp(id, base, err));
  }
  if (!res.ok) throw new Error(`${p.label}: ${await readError(res)}`);
  const data = await res.json();
  if (p.kind === 'gemini') return (data.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => m.name.replace(/^models\//, ''));
  return (data.data || []).map((m) => m.id).filter(Boolean).sort();
}
