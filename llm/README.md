# Kestrel coach models (llm/)

Work toward open-weight coaching models (Lite, Standard, Pro) that sit under Kestrel's existing prompt, tools and guardrails. The full plan and a log of what has been done is in [docs/coach-llm-plan.md](../docs/coach-llm-plan.md).

## The coach eval (`llm/eval/`)

100 gold cases that use the **production prompt template**: they call the real `coachChat()` from `src/train/gemini.js`. The contexts are hand-built for eight invented athletes (`archetypes.mjs`) in the shape of `coachContext()` in `src/index.js`, trimmed to what the prompt uses, so a few field shapes (the 14-day log, `this_week`, health) are approximations rather than live output. Pace zones come from the real `pacesFrom5k()` and the library from the real `WORKOUTS`.

| File | What it is |
|---|---|
| `cases/*.mjs` | The cases, by category: pain, fuel, illness, replan, log, level, numbers, workout, howto, noplan, safety, race. |
| `gold.jsonl` | The cases as JSON lines (build output; `check-gold.mjs` fails if it is stale). |
| `score.mjs` | `scoreReply(record, context, reply)`: automatic checks for any model's reply. |
| `guardrails.mjs` | A pure copy of the plan-change and level-change rules in `src/train/kai.js`. Keep the two in step. |
| `prompt.mjs` | `promptFor(record)` returns `{ system, prompt, schema }` to send to a model under test. |
| `check-gold.mjs` | Run by `npm run check`: every reference passes its checks and the guardrails, and the scorer catches bad replies. |

A case checks behaviour, not exact wording: which of `log`, `body`, `health_status`, `plan_change` and `level_change` must or may be set (anything else is a failure: "never save anything they didn't say"), required body-part marks, required or forbidden phrases, an answer under 150 words, banned wording (diagnosis, medication, diet or weight advice, level numbers, a greeting opener), whether a coach, parent or doctor is named, and whether Kestrel's own guardrails would accept the plan change. `expect.rubric` is a one-line instruction for a judge model, to be used with a judge from a different model family than the one under test.

Rebuild after editing a case: `node llm/eval/build-gold.mjs`, then `npm run check`.

### Important: the reference replies are evaluation only

The reference replies were drafted by Claude. They are there to prove that each case can be passed and that the checks are consistent. **They must not be used as training data** (Anthropic's terms restrict training competing models on Claude's output). Training data comes from an open-weight teacher and human-written examples. Each record says `reference_by`.

### Running a model on the eval

Not built yet (phase 1 of the plan). The shape: for each record, `promptFor(record)` gives the system prompt and user prompt; send them to the model with the JSON schema; parse the reply; call `scoreReply(record, contextFor(record), reply)`; the pass rate, the safety-category pass rate and the tool-validity rate are the numbers a Lab card reports in its `eval` block.

## Not in git

`llm/data/`, `llm/runs/`, `llm/models/`, `*.gguf`, `*.safetensors` and `*.bin` are ignored: datasets, run output and weights are large and regenerable.
