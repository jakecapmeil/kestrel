# Kestrel

Open-source training for school running teams. Live at **https://kestrel.jakecapmeil.workers.dev**.

- **Teams.** Anyone can start a team for their school and invite teammates with a code or link. Each team gets a shared calendar (practices and meets, with RSVPs) and a post feed.
- **Your training.** A private daily log (miles, minutes, type, how it felt, notes) and your PRs.
- **Race times from open-weight models.** Your PRs predict every other event, from 100 m to the half marathon, each with an 80% range. Sixteen weeks of logged running predict a marathon.
- **Model hub.** Every model is a JSON file of weights. Download them, fine-tune them, upload your own (public or private), and choose which model makes each prediction. See [MODELS.md](MODELS.md) and the [model cards](models/README.md).
- **Kestrel AI, powered by whatever you choose.** The coach chat reads your log, PRs, predictions and team calendar. It runs on Kestrel's free default (Gemini, falling back to an open-weight Llama on Cloudflare), on your own API key (OpenAI, Anthropic, Gemini, OpenRouter, Groq), or on a model on your own computer (Ollama, LM Studio, any OpenAI-compatible server).

## Privacy

- Sign-in is handled by Supabase: Google, or email and password with a confirmation email. Kestrel stores your Supabase user id, email, name and colour.
- Teammates see your name and colour only. Your log, PRs, predictions and chats are never shown to anyone else, and every API route checks this on the server.
- Teams aren't listed or searchable. You can only join with the invite code, and the owner can make a new code at any time.
- API keys for your own AI provider stay in your browser and go straight to that provider. They never reach Kestrel's server. Chat history also stays in your browser.
- Users must confirm they are 13 or older. Profile → Delete my Kestrel data removes everything about you.

## How it is built

| Part | What |
|---|---|
| `src/index.js` | Cloudflare Worker: the whole API. Identity comes only from the Supabase token (`src/auth.js`). |
| `src/models.js` | Model engine: one evaluator per model kind, plus upload validation. |
| `src/ai.js` | Kestrel AI system prompt, athlete context, and the free default provider. |
| `public/` | The web app. Plain HTML, CSS and JS modules with no build step. `public/ai.js` holds the browser-side providers. |
| `migrations/` | Cloudflare D1 (SQLite) schema. |
| `models/` | The built-in open-weight models and their cards. |
| `scripts/` | `check-models.mjs` (the engine matches the original HawksPredict code on `reference-cases.json` and rejects bad files) and `auth-stub.mjs` (a local stand-in for Supabase sign-in). |

## Run your own

1. Make a Supabase project. Turn on Email (with "Confirm email") and Google under Authentication → Providers. Under URL Configuration, set the Site URL to your Kestrel address.
2. Put the project URL and publishable key in `wrangler.jsonc` (`SUPABASE_URL`, `SUPABASE_KEY`).
3. Create the database and deploy:

```bash
npm install
npx wrangler d1 create kestrel_db        # put the id in wrangler.jsonc
npm run migrate:remote
npm run deploy
npx wrangler secret put GEMINI_API_KEY   # optional: free default AI
```

To develop locally without Supabase, run `npm run auth-stub` and `npm run migrate:local`, then `npx wrangler dev --port 8788 --var SUPABASE_URL:http://localhost:8799 --var SUPABASE_KEY:stub`. Any email signs in with the password `password`. `npm run check` tests the model engine.

## Licence

Code: MIT ([LICENSE](LICENSE)). Model weights: see [models/README.md](models/README.md). Lite and Marathon are CC BY 4.0; Short's licence is unclear because of one of its training sources.

Kestrel grew out of [Hawks](https://github.com/jakecapmeil/hawks), a team calendar and training app for one high school cross-country team. The HawksPredict research (datasets, experiments, training scripts) lives there under [research/hawkspredict](https://github.com/jakecapmeil/hawks/tree/main/research/hawkspredict).
