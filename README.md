# Kestrel

Free, open-source AI running coaching for school teams. Live at **https://kestrel.jakecapmeil.workers.dev**.

Running apps charge for adaptive training plans and AI coaching. Kestrel makes those open: the coach, the plans, the race models and the code. It keeps a whole team on one calendar, and it lets anyone publish running models for everyone else to use.

## What it does

**For an athlete**
- **A plan that adapts.** Six plan levels by weekly mileage. The AI coach moves single days when you can't make them, eases off when readiness, soreness or illness say so, and moves you up a level after three steady weeks. Every change is checked by fixed guardrails: no big jumps, no back-to-back hard days, and the week stays within 10% of the plan.
- **Kestrel AI, powered by whatever you choose.** Chat with your coach about your plan, log, fitness and next meet. It runs on the free default (Gemini, with an open-weight Llama model as backup), on your own API key (OpenAI, Anthropic, Gemini, OpenRouter, Groq), or on a model on your own computer (Ollama, LM Studio). Every model gets the same prompt and the same guardrails. Your own Claude can also connect over MCP.
- **Training log and watch sync.** Garmin and COROS sync through intervals.icu. Each run gets a difficulty from pace and heart rate, credited for heat and hills, plus training load and how well it matched the plan. The log also keeps splits, feel and sleep.
- **Fitness States.** Race estimates from 100 m to the marathon, each with an 80% range, plus race VO2max, pace zones and a fitness/fatigue/form score. Includes a heat-and-hills calculator, a taper builder, and "runners like you" (a comparison with 14,000 real marathoners).
- **Workouts library.** Sessions written for your level, with rep targets from your own paces. You can send the next 14 days of your plan to your watch.
- **Health, private.** Readiness, health status and a body map that only you and your coach see.

**For a team**
- Anyone can start a team for their school. Others join with an invite code or link.
- Team calendar: practices (easy, workout, long run), meets and other events, with RSVPs, availability, day notes, posts, a meets list with forecasts, places, and a private calendar feed for your phone.
- The owner and any **captains** they name manage the calendar (including a weekly practice rhythm), edit the roster (number, grade, age, events) and build the **team training plan** with Kestrel AI: describe the season, refine it in chat, save. It scales to nine mileage levels so each athlete's coach starts them on the level that fits their fitness. Nothing is preloaded.
- Anyone can build their own plan the same way (Training → Plan).
- **Team mileage:** weekly totals and bars for the whole team. Names appear on the leaderboard only for athletes who choose to share.
- There is no coach view of anyone's training, and teammates never see each other's health, log or contact details.

**Kestrel Lab** (`/lab`): the model side.
- A directory of open running models, each with a model card, downloads, usage counts, and "try it" on your own times.
- Publish a new model or a fine-tuned one, public or private. Models are JSON files of numbers, never code, and every file is validated.
- Every athlete chooses which model makes each of their predictions.
- A developer API (`/api/v1/predict`) with personal API keys.
- See [MODELS.md](MODELS.md) and the [model cards](models/README.md).

## Privacy and safety

- Sign-in is by Supabase: Google, or email and password with a confirmation email. Users confirm they are 13 or older.
- Identity comes only from the sign-in. Team data is read only after a membership check. The API ignores any person id sent by the browser.
- API keys for your own AI provider stay in your browser. Intervals.icu keys are encrypted at rest (AES-GCM).
- The coach never diagnoses, and it sends lasting pain to a coach, parent or doctor. Plan changes always pass the guardrails, whichever model suggested them.
- GPS routes are fetched from intervals.icu only when you open a run, cached for you alone, and never shown to teammates. Deleting your data removes them.
- You → Settings → **Delete my Kestrel data** removes everything about you. Terms, privacy and a health notice are at `/legal`.

## How it is built

| Part | What |
|---|---|
| `src/index.js` | Cloudflare Worker: the API and the rules above. |
| `src/train/` | The training engine from [Kessler Calendar](https://github.com/jakecapmeil/hawks): plans, coach, log, fitness, workouts, watch sync, plan push, calculators. |
| `docs/model-research.md` | Which models are on Kestrel, which to add next, and how purposes and courses work. |
| `src/models.js` | Kestrel Lab's model engine (purposes, courses, one evaluator per model kind, plus upload validation) and the adapters the fitness engine calls. |
| `public/index.html` | The app (the Kessler views). `public/kestrel.js` adds sign-in, teams, the AI choice and settings; `public/kestrel.css` is the design. |
| `src/train/courses.js` | Courses and course PRs. 48 built-in courses (each checked against a published source, with GPS start bounds so a run is matched to its course); courses people add live in the `courses` table, are shared, and are chosen by hand on the run. |
| `public/records.js` | You → Records (PRs that update themselves, the courses you follow), the course picker, and a run's route (flat, elevation, and 3D terrain through MapLibre with OpenStreetMap and AWS terrain tiles). |
| `public/lab/` | Kestrel Lab. |
| `migrations/` | Cloudflare D1 (SQLite) schema. |
| `models/` | The built-in open-weight models and their cards. |
| `scripts/` | `check-models.mjs` (the engine matches the original KesslerPredict code and rejects bad files) and `auth-stub.mjs` (a local stand-in for Supabase sign-in). |

## Run your own

1. Make a Supabase project. Turn on Email (with "Confirm email") and Google under Authentication → Providers. Set the Site URL to your Kestrel address.
2. Put the project URL and publishable key in `wrangler.jsonc` (`SUPABASE_URL`, `SUPABASE_KEY`).
3. Create the database, set the secrets, and deploy:

```bash
npm install
npx wrangler d1 create kestrel_db        # put the id in wrangler.jsonc
npm run migrate:remote
openssl rand -hex 32 | npx wrangler secret put KESTREL_SECRET   # encrypts watch keys
npx wrangler secret put GEMINI_API_KEY   # optional: the free default AI
npm run deploy
```

To develop locally without Supabase:
- Run `npm run auth-stub` and `npm run migrate:local`.
- Start the server with `npx wrangler dev --port 8788 --var SUPABASE_URL:http://localhost:8799 --var SUPABASE_KEY:stub`.
- Sign in with any email and the password `password`.

## Origin, AI use and credits

Kestrel started as a calendar for the Hunter Kessler running team, so everyone could say whether they were coming to practice, and grew feature by feature into a training platform for any team. It is an entry in the 2026 Congressional App Challenge. How AI tools were used to build it is disclosed in [AI_USAGE.md](AI_USAGE.md); the libraries, services and datasets it builds on are in [THIRD_PARTY.md](THIRD_PARTY.md).

## Licence

- **Code:** MIT ([LICENSE](LICENSE)).
- **Model weights:** see [models/README.md](models/README.md). Lite and Marathon are CC BY 4.0; Short's licence is unclear because of one of its training sources.
- **Body map:** body-muscles (Apache-2.0, `public/vendor/body-muscles/`).

Kestrel grew out of [Kessler Calendar](https://github.com/jakecapmeil/hawks), a team calendar and coaching app built for one high school cross-country team. The KesslerPredict research (datasets, experiments, training scripts) is in that repository, under [research/hawkspredict](https://github.com/jakecapmeil/hawks/tree/main/research/hawkspredict).
