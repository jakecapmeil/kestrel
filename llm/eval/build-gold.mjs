// Builds llm/eval/gold.jsonl from the case files in llm/eval/cases/.
//   node llm/eval/build-gold.mjs
// The reference replies are written by Claude and are EVALUATION ONLY. They must never be used as training data
// (Anthropic's terms restrict training competing models on its outputs); see docs/coach-llm-plan.md.
import { readdirSync, writeFileSync } from 'node:fs';

export async function loadCases() {
  const dir = new URL('./cases/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.mjs')).sort();
  const out = [];
  for (const f of files) {
    const mod = await import(new URL(f, dir));
    for (const c of mod.default) {
      out.push({
        id: c.id, category: c.cat, athlete: c.who, patch: c.patch || {},
        history: c.say.map((t, i) => ({ role: i % 2 === 0 ? 'user' : 'kai', text: t })),
        reference: c.ref, reference_by: 'claude (eval only, never training data)', expect: c.expect || {},
      });
    }
  }
  return out;
}

export const toJsonl = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';

if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = await loadCases();
  writeFileSync(new URL('./gold.jsonl', import.meta.url), toJsonl(rows));
  console.log(`wrote ${rows.length} gold cases`);
}
