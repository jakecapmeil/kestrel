// Kestrel AI. Kestrel is the interface; what powers it is the user's choice:
//   - "Kestrel (default)": this file. Gemini free tier, falling back to an open-weight model on Workers AI.
//   - Their own key (OpenAI, Anthropic, Gemini, OpenRouter, Groq, ...) or a local model (Ollama, LM Studio):
//     called straight from the browser (public/ai.js). Keys never reach this server.
// Every provider gets the same system prompt and data, from coachContext.

import { EVENTS, fmtTime } from './events.js';

export class AiError extends Error {}

const GEMINI_MODELS = ['gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];
const WORKERS_AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const COOLDOWN_MS = 60 * 1000;
const cooling = new Map();

export const SYSTEM = `You are Kestrel AI, the running coach inside Kestrel, an open-source training app for high school and club runners. You are talking with one athlete.

Be specific, warm and brief (under 150 words unless they ask for a plan). Base every answer on the athlete's data below: their profile, PRs, race predictions (with the model that made each one and its 80% range), their training log and their teams' upcoming calendar. Paces and goal times you give must come from their PRs or predictions; say which. If the data does not answer the question, say what they could log to get an answer.

Training advice: keep easy days easy, two easy days between hard sessions, raise weekly mileage by no more than about 10% a week, and back off when they say they are tired, sore or sick. Never add mileage to make up for a missed day.

Safety: many athletes are minors. Never give medical diagnoses or advice about medication, weight loss or diets; for pain that lasts or gets worse, tell them to talk to their coach, a parent or a doctor. Do not ask for personal contact details.`;

// The athlete's own data plus their teams' calendars (names only; no other member's data).
export async function coachContext(db, user, today, predictions) {
  const from = addDays(today, -56);
  const [log, prs, teams] = await Promise.all([
    db.prepare('SELECT date, miles, minutes, type, feel, notes FROM training_days WHERE user_id = ? AND date >= ? ORDER BY date').bind(user.id, from).all(),
    db.prepare('SELECT event, sec, date FROM prs WHERE user_id = ?').bind(user.id).all(),
    db.prepare('SELECT t.id, t.name, t.school FROM teams t JOIN team_members m ON m.team_id = t.id WHERE m.user_id = ?').bind(user.id).all(),
  ]);
  const label = new Map(EVENTS.map((e) => [e.key, e.label]));
  const calendars = [];
  for (const t of teams.results) {
    const { results } = await db.prepare('SELECT date, title, type, time, location FROM events WHERE team_id = ? AND date >= ? AND date <= ? ORDER BY date LIMIT 30')
      .bind(t.id, today, addDays(today, 28)).all();
    calendars.push({ team: t.name, school: t.school, upcoming: results });
  }
  const weeks = {};
  for (const d of log.results) {
    const wk = weekStart(d.date);
    weeks[wk] = Math.round(((weeks[wk] || 0) + d.miles) * 10) / 10;
  }
  return {
    today,
    athlete: { name: user.name || 'Athlete', sex: user.sex || 'not given' },
    prs: prs.results.map((p) => ({ event: label.get(p.event) || p.event, time: fmtTime(p.sec), date: p.date || undefined })),
    predictions,
    weekly_miles: weeks,
    log_last_8_weeks: log.results.map((d) => ({ ...d, notes: d.notes ? d.notes.slice(0, 200) : undefined, feel: d.feel ?? undefined })),
    teams: calendars,
  };
}

export async function spend(db, userId, today, limit) {
  const row = await db.prepare(
    `INSERT INTO ai_usage (user_id, date, calls) VALUES (?, ?, 1)
     ON CONFLICT(user_id, date) DO UPDATE SET calls = calls + 1 RETURNING calls`
  ).bind(userId, today).first();
  if (row.calls > limit) throw new AiError(`You have used today's ${limit} free Kestrel AI messages. Add your own API key or a local model in AI settings, or try tomorrow.`);
}

// messages: [{ role: 'user' | 'assistant', content }]  -> { text, model }
export async function chat(env, system, messages) {
  const now = Date.now();
  const ready = GEMINI_MODELS.filter((m) => (cooling.get(m) || 0) <= now);
  const order = [...ready, ...GEMINI_MODELS.filter((m) => !ready.includes(m))];
  for (const model of env.GEMINI_API_KEY ? order : []) {
    const r = await gemini(env, model, system, messages);
    if (r.retry) { cooling.set(model, Date.now() + COOLDOWN_MS); continue; }
    return { text: r.text, model };
  }
  if (env.AI) {
    try {
      const out = await env.AI.run(WORKERS_AI_MODEL, { messages: [{ role: 'system', content: system }, ...messages], max_tokens: 1200, temperature: 0.5 });
      if (out?.response) return { text: String(out.response).trim(), model: WORKERS_AI_MODEL };
    } catch (err) {
      console.error('workers-ai', String(err).slice(0, 300));
    }
  }
  throw new AiError('Kestrel AI is busy. Try again in a minute, or use your own key or a local model.');
}

async function gemini(env, model, system, messages) {
  let res;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
        generationConfig: { temperature: 0.5, maxOutputTokens: 5000 },
      }),
    });
  } catch {
    return { retry: true };
  }
  if ([429, 404, 500, 503, 529].includes(res.status)) return { retry: true };
  if (!res.ok) {
    console.error('gemini', model, res.status, (await res.text()).slice(0, 300));
    return { retry: true };
  }
  const data = await res.json();
  const text = (data.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('').trim();
  return text ? { text } : { retry: true };
}

// Chat history from the browser: last 16 turns, alternating, ending with the athlete.
export function cleanMessages(raw) {
  const msgs = (Array.isArray(raw) ? raw : []).slice(-16)
    .map((m) => ({ role: m?.role === 'assistant' ? 'assistant' : 'user', content: String(m?.content || '').trim().slice(0, 4000) }))
    .filter((m) => m.content);
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') throw new AiError('Ask a question first.');
  return msgs;
}

const DAY = 86400000;
export const addDays = (date, n) => new Date(Date.parse(date + 'T12:00:00Z') + n * DAY).toISOString().slice(0, 10);
const weekStart = (date) => {
  const d = new Date(Date.parse(date + 'T12:00:00Z'));
  return addDays(date, -((d.getUTCDay() + 6) % 7));
};
