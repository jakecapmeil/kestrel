// Checks for what powers Kestrel AI: the account's keys and choice (train/aiconfig.js) and the paths a job takes
// (train/gemini.js). Real SQL on an in-memory SQLite, a scripted fetch for the providers. Run: node scripts/check-ai.mjs
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { accountAi, setChoice, saveProvider, removeProvider, modelFor, decryptKey, AiConfigError } from '../src/train/aiconfig.js';
import { askCoach, reportSessions, askFood, testOwn, AiError } from '../src/train/gemini.js';
import { modelList, CURATED } from '../src/train/aimodels.js';

let failed = 0;
const ok = (cond, msg) => { if (!cond) { failed++; console.error('FAIL', msg); } };
const rejects = async (fn, re, msg) => { try { await fn(); ok(false, `${msg}: did not throw`); } catch (e) { ok(re.test(e.message), `${msg}: "${e.message}"`); return e.message; } return ''; };

// A D1-shaped wrapper over node:sqlite.
const sql = new DatabaseSync(':memory:');
sql.exec(readFileSync(new URL('../migrations/0013_ai_account.sql', import.meta.url), 'utf8'));
sql.exec('CREATE TABLE ai_usage (person_id TEXT NOT NULL, date TEXT NOT NULL, calls INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (person_id, date))');
const db = {
  prepare(q) {
    const st = sql.prepare(q);
    let args = [];
    const o = {
      bind: (...a) => { args = a; return o; },
      first: async () => st.get(...args) ?? null,
      all: async () => ({ results: st.all(...args) }),
      run: async () => { st.run(...args); return {}; },
    };
    return o;
  },
};
const usage = (id) => sql.prepare('SELECT calls FROM ai_usage WHERE person_id = ?').get(id)?.calls || 0;

// Scripted providers.
const calls = [];
let script = () => ({ status: 500, body: {} });
globalThis.fetch = async (url, init = {}) => {
  const body = init.body ? JSON.parse(init.body) : null;
  calls.push({ url: String(url), headers: init.headers || {}, body });
  const r = script(String(url), body, init) || { status: 500, body: {} };
  return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
};
const geminiOk = (obj) => ({ status: 200, body: { candidates: [{ content: { parts: [{ text: typeof obj === 'string' ? obj : JSON.stringify(obj) }] }, finishReason: 'STOP' }] } });

const env = { KESTREL_SECRET: 'test-secret-for-ai-keys', GEMINI_API_KEY: 'free-gemini-key', GEMINI_API_BASE: 'http://gemini.test', ANTHROPIC_API_BASE: 'http://anthropic.test/v1', OPENAI_API_BASE: 'http://openai.test/v1', GROQ_API_BASE: 'http://groq.test/v1' };
const person = { id: 'p_one', first_name: 'Sam', name: 'Sam', settings: '{}' };
const other = { id: 'p_two', settings: '{}' };
const today = '2026-11-17';
const ctx = { plan: {}, fitness_projections: {} };
const ask = (p = person, e = env) => askCoach(e, db, p, [{ role: 'user', text: 'How was my week?' }], ctx, today, []);
const KEY = 'sk-ant-test-1234567890abcdef';

// ---- keys and choice live on the account, encrypted, and are never returned
await saveProvider(env, db, person.id, 'anthropic', { model: 'claude-haiku-5-5', key: KEY });
const acct = await accountAi(db, person.id);
ok(acct.providers.anthropic?.has_key && acct.providers.anthropic.last4 === 'cdef', 'account shows has_key and last4');
ok(!JSON.stringify(acct).includes(KEY), 'the key is never in what a browser gets');
const stored = sql.prepare('SELECT key_enc FROM ai_keys WHERE person_id = ?').get(person.id).key_enc;
ok(stored && !stored.includes(KEY) && !Buffer.from(stored.split('.')[1], 'base64').includes(KEY), 'the key is encrypted at rest');
ok(await decryptKey(env, stored, person.id) === KEY, 'the key decrypts for its own account');
await rejects(() => decryptKey(env, stored, other.id), /could not be read/, "a stored key can't be moved to another account");
await rejects(() => saveProvider({}, db, other.id, 'anthropic', { key: KEY }), /KESTREL_SECRET/, 'no secret, no saving');
await rejects(() => saveProvider(env, db, other.id, 'anthropic', { key: 'short' }), /does not look like an API key/, 'junk keys are refused');
await rejects(() => saveProvider(env, db, other.id, 'ollama', { key: KEY }), /runs in your browser/, 'local providers are not stored on the server');
await saveProvider(env, db, person.id, 'anthropic', { model: 'claude-sonnet-5-5' });
ok((await accountAi(db, person.id)).providers.anthropic.model === 'claude-sonnet-5-5' && (await accountAi(db, person.id)).providers.anthropic.last4 === 'cdef', 'changing the model keeps the key');
await rejects(() => setChoice(db, other.id, { provider: 'anthropic' }), /key first/, "can't choose a provider with no key");
await rejects(() => setChoice(db, other.id, { provider: 'nope' }), /Unknown provider/, 'unknown provider');
ok((await modelFor(env, db, other.id, 'chat')).mode === 'free', 'no choice means the free default');

// ---- a job on the runner's own Anthropic key: called from the server, not charged, errors say what happened
await setChoice(db, person.id, { provider: 'anthropic', tasks: { food: 'kestrel' } });
script = (url, body) => url === 'http://anthropic.test/v1/messages' ? { status: 200, body: { content: [{ type: 'text', text: JSON.stringify({ answer: 'Solid week.' }) }], stop_reason: 'end_turn' } } : null;
let out = await ask();
let c = calls.at(-1);
ok(out.answer === 'Solid week.', 'own Anthropic answer comes back');
ok(c.url === 'http://anthropic.test/v1/messages' && c.headers['x-api-key'] === KEY && c.headers['anthropic-version'], 'calls Anthropic with the saved key');
ok(!('anthropic-dangerous-direct-browser-access' in c.headers), 'no browser header: it is a server call');
ok(c.body.model === 'claude-sonnet-5-5' && c.body.max_tokens >= 900, "uses the saved model and the job's own token budget");
ok(c.body.tools?.[0]?.name === 'kestrel_reply' && c.body.tools[0].input_schema?.properties?.answer && !c.body.tool_choice, 'Claude is given a reply tool (not forced), carrying the schema');
ok(c.body.max_tokens >= 900 + 4096, 'room is left for thinking');
ok(usage(person.id) === 0, 'own-model calls do not spend the free daily calls');

script = () => ({ status: 401, body: { error: { message: `invalid x-api-key ${KEY}` } } });
let msg = await rejects(() => ask(), /Anthropic \(Claude\) rejected your API key/, 'a refused key says so');
ok(!msg.includes(KEY), 'an error never repeats the key');
script = () => ({ status: 404, body: { error: { message: 'model: claude-x' } } });
await rejects(() => ask(), /doesn’t know the model/, 'an unknown model says so');
script = () => ({ status: 529, body: { error: { message: 'Overloaded' } } });
await rejects(() => ask(), /having trouble/, 'an overloaded provider says so, and nothing falls back to the free default');
ok(calls.every((x) => !x.url.includes('gemini.test')), 'an own-model failure never reaches the free default');
script = () => ({ status: 200, body: { content: [{ type: 'text', text: '{"answer":"cut' }], stop_reason: 'max_tokens' } });
await rejects(() => ask(), /ran out of room/, 'a cut-off answer says so');
// Claude answers through the tool, in prose, or declines
script = () => ({ status: 200, body: { content: [{ type: 'thinking', thinking: '' }, { type: 'tool_use', id: 't1', name: 'kestrel_reply', input: { answer: 'Try 12 x 200 m at 3K pace.', plan_change: { date: '2026-11-18', type: 'Workout', reason: 'Speed day' } } }], stop_reason: 'tool_use' } });
out = await ask();
ok(out.answer === 'Try 12 x 200 m at 3K pace.' && out.plan_change?.type === 'Workout', 'the tool call is the reply, including its other fields');
script = () => ({ status: 200, body: { content: [{ type: 'text', text: "Here's a good session:\n\n- 12 x 200 m at 3K pace\n- 200 m jog between" }], stop_reason: 'end_turn' } });
out = await ask();
ok(/12 x 200 m/.test(out.answer), 'a plain-text answer is accepted as the answer, not an error');
script = () => ({ status: 200, body: { content: [{ type: 'text', text: '{"answer": "oops' }], stop_reason: 'end_turn' } });
await rejects(() => ask(), /couldn’t read/, 'broken JSON is still an error, not shown as the answer');
script = () => ({ status: 200, body: { content: [], stop_reason: 'refusal' } });
await rejects(() => ask(), /declined/, 'a refusal says so');
script = () => ({ status: 200, body: { content: [{ type: 'tool_use', id: 't1', name: 'kestrel_reply', input: { answer: 'cut' } }], stop_reason: 'max_tokens' } });
await rejects(() => ask(), /ran out of room/, 'a tool call cut off by max_tokens is not used');
script = (url) => url.startsWith('http://gemini.test') ? geminiOk({ meal: 'toast' }) : null;
const foodOut = await askFood(env, db, person, { system: 's', prompt: 'p' }, [], today);
ok(String(foodOut).includes('toast'), 'per-job override: food stays on the free default');
const afterFood = usage(person.id);
ok(afterFood === 1, 'the free food answer cost one call');
ok(calls.at(-1).url.startsWith('http://gemini.test'), 'the food job went to the free default, not Anthropic');
script = (url) => url.startsWith('http://anthropic.test') ? { status: 200, body: { content: [{ type: 'text', text: 'Hello, runner!' }], stop_reason: 'end_turn' } } : null;
ok(await testOwn(env, db, person, 'anthropic') === 'Hello, runner!', 'the Test button makes one small call');

// ---- OpenAI-compatible own providers: image jobs need a model that sees
await saveProvider(env, db, person.id, 'groq', { key: 'gsk_test_1234567890' });
await setChoice(db, person.id, { provider: 'groq' });
await rejects(() => askFood(env, db, person, { system: 's', prompt: 'p' }, [{ mime: 'image/jpeg', data: 'AAA' }], today), /can’t read photos/, 'a text-only model refuses photos');
script = () => ({ status: 200, body: { choices: [{ message: { content: '{"answer":"ok"}' }, finish_reason: 'stop' }] } });
await ask();
c = calls.at(-1);
ok(c.url === 'http://groq.test/v1/chat/completions' && c.headers.Authorization === 'Bearer gsk_test_1234567890' && c.body.max_tokens >= 900 && !c.body.max_completion_tokens, 'Groq gets Bearer auth and max_tokens');
await removeProvider(db, person.id, 'groq');
ok((await accountAi(db, person.id)).provider === 'kestrel', 'removing the chosen provider goes back to the free default');

// ---- a job set to a model in the browser can't run on the server, and run summaries are left to the app
await setChoice(db, person.id, { provider: 'ollama' });
ok((await modelFor(env, db, person.id, 'summary')).mode === 'browser', 'a local model is a browser job');
await rejects(() => ask(), /runs in your browser/, 'the server refuses a browser job with a clear message');
await setChoice(db, person.id, { provider: 'kestrel' });

// ---- the free default: Gemini refusing the chat schema, running out of room, a refused key
const asks = [];
script = (url, body) => {
  if (!url.startsWith('http://gemini.test')) return null;
  asks.push({ url, body });
  if (body.generationConfig.responseSchema) return { status: 400, body: { error: { message: 'Schema is too complex' } } };
  return geminiOk({ answer: 'Fine.' });
};
out = await ask();
ok(out.answer === 'Fine.', 'a refused response schema is retried with the schema in the prompt');
ok(asks.length === 2 && asks[1].body.systemInstruction.parts[0].text.includes('JSON Schema') && !asks[1].body.generationConfig.responseSchema, 'the retry carries the schema in the prompt');
ok(usage(person.id) === afterFood + 1, 'a free answer costs one call');

asks.length = 0;
script = (url, body) => {
  asks.push(url);
  if (asks.length === 1) return { status: 200, body: { candidates: [{ content: { parts: [{ text: '{"answer":"cu' }] }, finishReason: 'MAX_TOKENS' }] } };
  return geminiOk({ answer: 'Second model.' });
};
out = await ask();
ok(out.answer === 'Second model.' && asks.length === 2 && asks[0] !== asks[1], 'a cut-off answer moves on to the next model');

// every Gemini model refused: Workers AI answers, first strictly, then without strict JSON mode
let ai = [];
const env2 = { ...env, AI: { run: async (m, o) => { ai.push(!!o.response_format); if (o.response_format) throw new Error('schema too complex'); return { response: '{"answer":"From Llama."}' }; } } };
script = () => ({ status: 403, body: { error: { message: 'API key not valid' } } });
const before = usage(person.id);
out = await ask(person, env2);
ok(out.answer === 'From Llama.' && ai.join() === 'true,false', 'Workers AI: a refused strict schema is retried without it');
ok(usage(person.id) === before + 1, 'that answer costs one free call');

// nothing works: the error says so, and costs nothing
const before2 = usage(person.id);
script = () => ({ status: 403, body: {} });
const msg2 = await rejects(() => ask(person, { ...env, AI: { run: async () => { throw new Error('down'); } } }), /The AI request failed \(/, 'a total failure names what failed');
ok(usage(person.id) === before2, 'a failed call is not charged');

// the daily cap: counted per person, on success only, AI_DAILY_LIMIT honoured
script = () => geminiOk({ answer: 'ok' });
const capEnv = { ...env, AI_DAILY_LIMIT: '2' };
await ask(other, capEnv); await ask(other, capEnv);
await rejects(() => ask(other, capEnv), /used today's 2 free/, 'the free cap stops the third call');

// summaries have their own count, so a busy sync can't use up the chat
script = () => geminiOk({ sessions: [{ key: 'k', main_id: '1', report: 'A fine run.', activities: [{ id: '1', category: 'easy', course: 'flat' }] }], days: [] });
const sess = [{ key: 'k', date: today, activities: [{ id: '1', name: 'Run', miles: 5, minutes: 40 }] }];
const chatBefore = usage(other.id);
const rep = await reportSessions(capEnv, db, other, sess, { rubric: 'r', maxHr: 190, today });
ok(rep?.sessions?.[0]?.report === 'A fine run.', 'summaries run on the free default');
ok(usage(other.id) === chatBefore && usage(`${other.id}#sync`) === 1, 'summaries are counted apart from chat');
ok(await reportSessions({ ...capEnv, GEMINI_API_KEY: '', AI: undefined }, db, { id: 'p_three', settings: '{}' }, sess, { rubric: 'r', maxHr: 190, today }) === null, 'no AI on the server: summaries quietly skip');

// ---- model lists: a reviewed list with no key, the provider's live list with one
ok((await modelList(env, 'anthropic')).models.map((m) => m.id).join() === CURATED.anthropic.map((m) => m.id).join(), 'no key: the reviewed Anthropic list');
ok(CURATED.openai.some((m) => m.id === 'gpt-6-luna') && !JSON.stringify(CURATED).includes('gpt-4o'), 'the reviewed OpenAI list has no retiring gpt-4o models');
script = (url) => {
  if (url.startsWith('http://anthropic.test/v1/models')) return { status: 200, body: { data: [
    { id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', created_at: '2026-09-21T00:00:00Z', lifecycle: 'active', capabilities: { image_input: { supported: true } } },
    { id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5', created_at: '2026-09-28T00:00:00Z', lifecycle: 'active' },
    { id: 'claude-opus-4-1', display_name: 'Claude Opus 4.1', created_at: '2025-08-05T00:00:00Z', lifecycle: 'retired' },
    { id: 'claude-sonnet-5', display_name: 'Claude Sonnet 5', created_at: '2026-06-01T00:00:00Z', lifecycle: 'active' }] } };
  if (url.startsWith('http://openai.test/v1/models')) return { status: 200, body: { data: [
    { id: 'gpt-6-luna', created: 1790000000 }, { id: 'gpt-6-luna-2026-10-01', created: 1790000001 }, { id: 'gpt-6.1-terra', created: 1791000000 },
    { id: 'text-embedding-4', created: 1 }, { id: 'gpt-realtime-2.1', created: 2 }, { id: 'whisper-1', created: 3 }, { id: 'gpt-5.6-sol', created: 1780000000 }, { id: 'gpt-image-2.6-sunburst', created: 4 }] } };
  if (url.startsWith('http://gemini.test/v1beta/models')) return { status: 200, body: { models: [
    { name: 'models/gemini-3.8-flash', displayName: 'Gemini 3.8 Flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-embedding-2', supportedGenerationMethods: ['embedContent'] },
    { name: 'models/gemini-3.8-flash-tts', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3-flash-preview', supportedGenerationMethods: ['generateContent'] }] } };
  return null;
};
let ml = await modelList(env, 'anthropic', 'k1');
ok(ml.live && ml.models.map((m) => m.id).join() === 'claude-sonnet-5-5,claude-opus-5-5,claude-sonnet-5', 'Anthropic: reviewed models the key can use first, retired ones dropped, newer extras after');
ml = await modelList(env, 'openai', 'k1');
ok(ml.models.map((m) => m.id).join() === 'gpt-6.1-terra,gpt-6-luna,gpt-5.6-sol', `OpenAI: chat models only, dated snapshots folded into their name (${ml.models.map((m) => m.id)})`);
ml = await modelList(env, 'gemini', 'k1');
ok(ml.models.map((m) => m.id).join() === 'gemini-3.8-flash,gemini-3-flash-preview', `Gemini: generateContent chat models only (${ml.models.map((m) => m.id)})`);
script = () => ({ status: 401, body: { error: { message: 'bad key' } } });
await rejects(() => modelList(env, 'anthropic', 'k1'), /rejected that key/, 'a wrong key is reported');
script = () => ({ status: 500, body: {} });
ml = await modelList(env, 'anthropic', 'k1');
ok(!ml.live && ml.models.length === CURATED.anthropic.length && ml.error, 'a provider outage falls back to the reviewed list');

if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
console.log('AI checks passed');
