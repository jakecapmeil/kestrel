# Kestrel coach LLMs: plan and log

Goal: three open-weight coaching models (Lite, Standard, Pro) that run on a laptop or desktop, plus one cheap hosted model funded by donations and grants. They sit under the same prompt, tools and guardrails as today's coach; fine-tuning improves the model's coaching voice, tool use and safety, not running science (the engine already supplies that).

Last updated: 2026-11-03.

## Decisions so far (from Jake)

- An open-weight teacher model is fine for training data. No Claude, GPT or Gemini output goes into training data.
- Claude drafts the first 100 gold coaching examples. Because of the rule above, **they are the held-out evaluation set, not training data** (evaluating with Claude-written data is fine; training on it is not). Training data comes from an open-weight teacher and from human-written examples.
- Lab changes (a home for open-weight LLMs) come before tuning.
- A 1 TB drive will be connected later. No model downloads or installs happen until it is.
- Later, Opus will try editing the tuned weights (an experiment, gated by the eval; see phase 5).

## Constraints

- **Copyright.** Daniels, Lydiard, Pfitzinger and Seiler's books are copyrighted. No verbatim excerpts in training data. We write original paraphrases of ideas, each with a citation, drawn mainly from open-access (CC BY) papers. The [Open Training Project](https://aphd.pages.dev/open-training-project/) may be usable; its license is unchecked.
- **Teacher license.** Check the teacher model's license before generating (Llama 3.3 requires attribution; Qwen/DeepSeek/GLM terms vary).
- **Minors.** Many athletes are under 18. Safety (pain, RED-S and under-fueling, illness, no diagnosis, no weight-loss advice, prompt injection) is the part that must pass at ~100%.
- **Hardware.** This laptop is an M2 with 16 GB RAM and about 17 GB free disk. Fine for a 1.7-4B QLoRA run with short sequences once the drive is attached; bigger tiers use rented GPUs.
- **Base models:** names below are *to verify on Hugging Face* before use. Web results about current models were low quality and contradictory.

## Phases

### 0. Evals first (built; model runner still to do)
`llm/eval/` holds a gold evaluation set built with the production prompt template (the real `coachChat()`) and hand-built contexts in production's shape; a few field shapes are approximations. Each case carries *checks*, not a single reference answer: fields that must or must not be set, banned phrases, required phrases, and a rubric line for a judge. A reference reply (Claude-written, eval-only) is included and must itself pass the checks and the guardrails. `check-gold.mjs` runs in `npm run check`.

### 1. Baseline
Score off-the-shelf open models (the Llama 3.3 70B already used as a fallback, plus small Qwen/Llama/Gemma-class models) with the eval. We fine-tune only for the gaps.

### 2. Knowledge base
Ranked by trust: (1) gold examples from coaches who consent (CC BY); (2) our own principles written from open-access papers (polarized training, critical speed, tapering, the IOC RED-S consensus, youth load), each with a citation; (3) Kestrel's own docs: README, MODELS.md, the `SITE_GUIDE` and rubric in `src/train/gemini.js`; (4) engine rules.

### 3. Training data
Sample athlete states, let the engine decide the plan change, have an open-weight teacher write the reply and tool JSON with the relevant principles in its prompt. Filter rows that fail the schema, guardrails or banned phrases; dedupe; human-review 10%. Target 3-6k supervised examples and 1-2k preference pairs. Split by scenario; the gold set is never trained on.

### 4. Tuning
`mlx-lm` QLoRA for Lite on the laptop (base picked after the baseline, roughly 1.7-4B). Preference tuning and the Standard (~30B MoE) and Pro (70B-class) tiers on rented GPUs. Export GGUF for Ollama and LM Studio; publish to Hugging Face with a model card.

### 5. Opus weight-editing experiment
Based on MIT CSAIL's [Weight-Space Programming](https://rikiyat.github.io/blog/weight-space-programming/) blog post (Nov 2, 2026): author-reported, not peer reviewed, tested on a 0.8B model with a different editor model. Run it as a gated experiment: copy the tuned checkpoint, keep an edit only if a **dev** set improves and the safety suite does not regress, never touch the test set until the end, log every edit, never overwrite the tuned checkpoint.

### 6. Kestrel Lab: open-weight LLMs (built, not deployed)
A new Lab model kind, `llm`, for open-weight language models. A Lab upload is a 1 MB JSON file, so an `llm` entry is a **card that points at weights hosted elsewhere** (Hugging Face or Ollama). It holds tier, parameters, quantization, base model, RAM needed, license, an allowlisted link, an Ollama tag, eval scores, training-data statement and safety notes. It is **not a predictor**: it cannot be picked for a race purpose, tried, benchmarked or called through the prediction API. The UI is a "Language models" page with tier badges, a "fits a 16 GB Mac" hint, a copyable `ollama run` command, and a "Use as my coach" button that fills the browser's local-provider settings. Links must be https on huggingface.co or ollama.com; Ollama tags are strictly validated because anyone can publish a card.

### 7. Hosting for everyone
Start with per-token hosting of the Standard model behind an OpenAI-compatible provider entry, gated by a Worker secret, keeping the daily cap. Rough cost: $0.05-0.30 per active user per month; dedicated GPUs only pay off past ~20k users. Bring-your-own-key and local models stay as the free overflow. Apply for cloud credits and open-source grants with the eval results as evidence.

## Rough costs (estimates, not quotes)

| Item | Cost |
|---|---|
| LoRA run, 4B / 30B MoE / 70B-class | ~$20-100 / $100-400 / $500-1,500 |
| All three tiers incl. iteration and data generation | ~$3-10k |
| Hosting, 10k active users | ~$300-700 per month per-token, ~$3-4k dedicated |
| Hosting, 100k / 1M users | ~$8-12k / ~$60-100k per month |

## Steps done

- 2026-11-03: researched coaching sources, fine-tuning recipes and hosting costs; confirmed this laptop's limits (M2, 16 GB, ~17 GB free; no MLX or Ollama installed).
- 2026-11-03: read the coach prompt and tool schema (`src/train/gemini.js`), plan guardrails (`src/train/kai.js`), context builder (`coachContext` in `src/index.js`) and the Lab (`src/models.js`, `public/lab/lab.js`).
- 2026-11-03: wrote this plan.
- 2026-11-03: **Phase 0 built.** `llm/eval/`: eight athlete archetypes, a context builder shaped like `coachContext()`, a pure copy of the plan guardrails, a scorer with banned-wording and guardrail checks, and 100 gold cases (pain 12, fuel 10, illness 6, replan 12, log 8, level 6, numbers 8, workout 6, howto 12, noplan 4, safety 8, race 8). Every case builds its prompt through the real `coachChat()` with a hand-built context. The reference replies were drafted by Claude, so they are **eval-only**. `check-gold.mjs` runs in `npm run check` and includes negative self-tests (the scorer must catch diagnosis, medication, diet talk, level numbers, a greeting opener, unrequested saves, bad body-part ids, over-length answers and plan changes Kestrel would refuse).
- 2026-11-03: **Phase 6 built (Lab).** New model kind `llm` (task `coach`) in `src/models.js`: a card that points at weights on Hugging Face or Ollama, validated strictly (https huggingface.co links only, strict Ollama tag, required licence and training-data statement, unknown fields dropped). No migration needed: `models.kind` and `task` are plain text. Language-model cards are kept out of the predictor directory, refused by `/api/lab/try`, `/api/v1/predict` and the Workbench, and cannot be picked for a purpose. Lab UI: a Language models filter, a card page (what it needs, Ollama commands, eval table, safety, "Use as my coach", which only writes the browser's local provider setting), a landing tile and docs. Tests added to `scripts/check-models.mjs` (1 good card, 22 hostile ones, and `coach` not in `TASKS`). Checked in the browser against a local server with a seeded card: page renders with no console errors, the filter and the coach button work, and the default directory and prediction API exclude the card. Not deployed; nothing committed.
- 2026-11-03: calibrated the scorer after review: medication and diet wording is flagged only when a sentence *advises* it (a refusal like "I can't advise on ibuprofen" passes), a diagnosis disclaimer ("I can't say whether it's shin splints") passes, and "as your coach" no longer counts as a referral. Self-tests now check that good answers pass, not only that bad ones fail. Confirmed every Lab write path (upload, fork, new version, import, update from source) stores a `validateModel` result.
- Not yet done: baseline of off-the-shelf models, the knowledge base, training data, any tuning (waiting for the 1 TB drive), the Opus weight-edit experiment, hosting. A harness that runs a model on the eval is the next piece.

## Sources

- SFT then DPO, schema-validated tool calls, judge bias checks: [synthetic data guide](https://futureagi.com/blog/synthetic-data-fine-tuning-llms/), [tool-calling eval paper](https://arxiv.org/pdf/2605.22564)
- Open training knowledge: [Open Training Project](https://aphd.pages.dev/open-training-project/)
- H100 prices: [Thunder Compute](https://thundercompute.com/blog/nvidia-h100-pricing), [Jarvislabs](https://jarvislabs.ai/blog/h100-price)
- Open-weight landscape (low quality, verify): [comparison](https://wavect.io/blog/open-weight-llm-comparison-2026.md)
- Weight editing: [MIT CSAIL blog post](https://rikiyat.github.io/blog/weight-space-programming/)
