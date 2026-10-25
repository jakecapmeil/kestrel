// Kestrel Lab: browse, try, download and publish open running models, and get API keys to call them.
// Routes: #/ (directory), #/m/<id> (a model), #/new (publish), #/docs (format + API), #/me (your models and keys).
// Signing in shares the main app's Supabase session (same site), so the Lab needs no sign-in of its own.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

const $ = (id) => document.getElementById(id);
const $lab = $('lab');
const L = { cfg: null, sb: null, token: null, me: null, task: '', q: '' };
const TASK_LABEL = { race: 'Race times', short: 'Sprints & steeple', marathon: 'Marathon' };
const KIND_LABEL = {
  'lite-trees': 'Boosted trees (HawksPredict-Lite format)',
  'short-pairs': 'Event-pair lines (HawksPredict-Short format)',
  'marathon-trees': 'Boosted trees over training (HawksPredict-Marathon format)',
  riegel: 'Riegel formula',
};
const SOURCE = 'https://github.com/jakecapmeil/kestrel/blob/main';

// ---------- helpers

class Raw { constructor(s) { this.s = s; } }
const raw = (s) => new Raw(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => {
    const one = (x) => (x instanceof Raw ? x.s : x === false || x === null || x === undefined ? '' : esc(x));
    out += (Array.isArray(v) ? v.map(one).join('') : one(v)) + strings[i + 1];
  });
  return raw(out);
}
const render = (r) => { $lab.innerHTML = r.s; window.scrollTo(0, 0); };
const HAND_UNDER = '<svg class="k-hand-under" viewBox="0 0 260 14" preserveAspectRatio="none" aria-hidden="true"><path d="M3 8 C 48 3, 112 11, 170 6 S 236 6, 257 4"/><path d="M14 11 C 80 8, 150 12, 250 8"/></svg>';
const title = (text) => html`<h1 class="k-title"><span class="k-u">${text}${raw(HAND_UNDER)}</span></h1>`;
const fmtSize = (n) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n > 1e3 ? `${Math.round(n / 1e3)} KB` : `${n} B`);
function fmtTime(sec) {
  if (!Number.isFinite(sec)) return '–';
  const tenths = sec < 120;
  const r = tenths ? Math.round(sec * 10) / 10 : Math.round(sec);
  const h = Math.floor(r / 3600);
  const m = Math.floor((r % 3600) / 60);
  const s = r % 60;
  const ss = tenths ? s.toFixed(1).padStart(4, '0') : String(Math.floor(s)).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : m ? `${m}:${ss}` : (tenths ? s.toFixed(1) : String(s));
}
let toastTimer;
function toast(msg, bad = false) {
  let t = $('kToast');
  if (!t) { t = document.createElement('div'); t.id = 'kToast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = msg;
  t.className = 'k-toast' + (bad ? ' bad' : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, bad ? 6000 : 3000);
}
async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (L.sb) { const { data } = await L.sb.auth.getSession(); if (data.session) headers.Authorization = `Bearer ${data.session.access_token}`; }
  const res = await fetch(path, { ...opts, headers });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `Request failed (${res.status})`);
  return out;
}
async function attempt(fn, btn) {
  if (btn) btn.disabled = true;
  try { return await fn(); } catch (err) { toast(err.message, true); return undefined; } finally { if (btn) btn.disabled = false; }
}

// A small, safe Markdown: escaped first, then headings, code, bold, links (http/https only), lists.
function md(text) {
  const blocks = String(text || '').split(/\n```[a-z]*\n?/);
  return blocks.map((b, i) => {
    if (i % 2) return `<pre>${esc(b.replace(/\n```$/, ''))}</pre>`;
    return esc(b).split(/\n{2,}/).map((p) => {
      const t = p.trim();
      if (!t) return '';
      const inline = (x) => x.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
        .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener nofollow">$1</a>');
      const h = t.match(/^(#{1,3})\s+(.*)$/);
      if (h) return `<h${h[1].length + 1}>${inline(h[2])}</h${h[1].length + 1}>`;
      if (/^[-*]\s/.test(t)) return `<ul>${t.split('\n').map((l) => `<li>${inline(l.replace(/^[-*]\s+/, ''))}</li>`).join('')}</ul>`;
      return `<p>${inline(t).replace(/\n/g, '<br>')}</p>`;
    }).join('');
  }).join('');
}

function builtinReadme(m) {
  return `${m.description}\n\n**Trained on:** ${m.trained_on}\n\n**Licence:** ${m.license}\n\nThe full model card (accuracy, limits, licence notes) is in [models/README.md](${SOURCE}/models/README.md). Training scripts and experiments: [HawksPredict research](https://github.com/jakecapmeil/hawks/tree/main/research/hawkspredict).`;
}

// ---------- directory / models

async function viewModels() {
  const [list, stats] = await Promise.all([
    attempt(() => api(`/api/lab/models?task=${encodeURIComponent(L.task)}&q=${encodeURIComponent(L.q)}`)),
    attempt(() => api('/api/lab/stats')),
  ]);
  if (!list) return;
  render(html`
  <div class="lab-hero">
    <div>
      <div class="k-kicker">Open running models</div>
      ${title('Model Directory')}
      <p class="k-lede">Browse, try, and download open running models. Each model is a validated JSON file — numbers, never code — that anyone can use for race predictions, training analysis, or fine-tuning.</p>
      <div class="k-row"><a class="k-btn primary" href="#/new">Publish a model</a><a class="k-btn" href="#/docs">Docs &amp; API</a></div>
    </div>
    ${stats ? html`<div class="lab-stats"><div><b>${stats.models}</b><span>models</span></div><div><b>${stats.publishers}</b><span>publishers</span></div><div><b>${stats.downloads}</b><span>downloads</span></div></div>` : ''}
  </div>
  <div class="lab-filters">
    <input class="k-input" id="labQ" placeholder="Search models" value="${L.q}" aria-label="Search models">
    <div class="lab-seg" role="group" aria-label="Task">${[['', 'All'], ...Object.entries(TASK_LABEL)].map(([k, v]) => html`<button type="button" data-task="${k}" class="${k === L.task ? 'on' : ''}">${v}</button>`)}</div>
  </div>
  <div class="lab-grid">${list.models.length ? list.models.map(card) : html`<p class="k-small">No models match.</p>`}</div>`);
  let timer;
  $('labQ').oninput = (e) => { clearTimeout(timer); timer = setTimeout(() => { L.q = e.target.value.trim(); viewModels().then(() => { const q = $('labQ'); q.focus(); q.setSelectionRange(9999, 9999); }); }, 300); };
  $lab.querySelectorAll('[data-task]').forEach((b) => { b.onclick = () => { L.task = b.dataset.task; viewModels(); }; });
}

// ---------- Lab landing / explanation page

async function viewLab() {
  const me = await signedIn();
  render(html`
  <div class="lab-landing">
    <div class="lab-section">
      <h2>Kestrel Lab</h2>
      <p>An open ecosystem for testing, fine-tuning, and exploring AI-driven running insights and coaching algorithms. Think of it as Hugging Face for running models — a place where anyone can publish a race-time predictor, a training-load estimator, or a marathon model, and every Kestrel athlete can use it.</p>
    </div>
    <div class="lab-section">
      <h2>What you can do here</h2>
      <div class="lab-feature-grid">
        <div class="lab-feature">
          <h3>Browse open models</h3>
          <p>Discover race-time predictors, marathon estimators, and training models published by the community. Every model includes a model card, training data provenance, and licence information.</p>
        </div>
        <div class="lab-feature">
          <h3>Try before you use</h3>
          <p>Test any model on your own race times or training data directly in the browser. See predicted times with 80% confidence ranges before committing.</p>
        </div>
        <div class="lab-feature">
          <h3>Publish your own</h3>
          <p>Upload a validated JSON model file (no code — just numbers) and share it with every Kestrel athlete. Set it public or private, add a model card, and specify your data's licence.</p>
        </div>
        <div class="lab-feature">
          <h3>Call from your own app</h3>
          <p>Every model has a REST API endpoint (<code>POST /api/v1/predict</code>) with personal API keys. Use it from your own training log, watch app, or coaching dashboard.</p>
        </div>
      </div>
    </div>
    <div class="lab-section">
      <h2>Model types</h2>
      <p>Kestrel Lab supports four model kinds, each filling a specific task slot:</p>
      <div class="lab-kv" style="margin-top:16px;">
        <dt>Riegel</dt><dd>Exponent-based race time predictor from your nearest PR. Works for race and short distances.</dd>
        <dt>Lite-trees</dt><dd>Gradient-boosted trees over 21 HawksPredict-Lite features. Fine-tune on your own results for race predictions.</dd>
        <dt>Short-pairs</dt><dd>Log-log lines between event pairs. Best for sprints and steeplechase (100-1000 m).</dd>
        <dt>Marathon-trees</dt><dd>Trees over 15 training features from your last 16 weeks. Predicts marathon time from training load.</dd>
      </div>
    </div>
    ${me ? html`<div class="k-row" style="margin-top:32px;"><a class="k-btn primary" href="#/new">Publish your first model →</a><a class="k-btn" href="#/models">Browse models →</a></div>` : html`<div class="k-row" style="margin-top:32px;"><a class="k-btn" href="#/models">Browse models →</a><span style="margin-left:8px;color:var(--ink-soft);font-size:14px;">Sign in to publish your own models.</span></div>`}
  </div>`);
}

function card(m) {
  const initials = (m.owner || 'K').split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2) || 'K';
  const taskChip = m.task ? html`<span class="repo-tag task">${TASK_LABEL[m.task] || m.task}</span>` : '';
  const kindChip = m.kind ? html`<span class="repo-tag kind">${KIND_LABEL[m.kind] || m.kind}</span>` : '';
  const licenseChip = m.license ? html`<span class="repo-tag">${m.license}</span>` : '';
  const builtinChip = m.builtin ? html`<span class="repo-tag">Kestrel</span>` : '';
  const privateChip = m.visibility === 'private' ? html`<span class="repo-tag">Private</span>` : '';
  return html`<a class="lab-card-repo" href="#/m/${encodeURIComponent(m.id)}">
    <div class="repo-header">
      <div class="repo-avatar">${initials}</div>
      <div class="repo-main">
        <div class="repo-name">${m.name} <span class="k-small">${m.version}</span></div>
        <div class="repo-meta">${taskChip}${kindChip}${licenseChip}${builtinChip}${privateChip}</div>
        <p class="repo-desc">${m.description || 'No description provided.'}</p>
      </div>
    </div>
    <div class="repo-footer">
      <div class="repo-stats"><div><b>${m.downloads}</b><br><span class="k-small">downloads</span></div><div><b>${m.used_by || 0}</b><br><span class="k-small">athletes</span></div><div><b>${fmtSize(m.size)}</b><br><span class="k-small">size</span></div></div>
      <span class="k-small">${new Date(m.updated_at || 0).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
    </div>
  </a>`;
}

// ---------- one model

async function viewModel(id, tab = 'card') {
  const r = await attempt(() => api(`/api/lab/models/${encodeURIComponent(id)}`));
  if (!r) { render(html`<p class="k-small">Model not found. <a href="#/">Back to the models</a></p>`); return; }
  const m = r.model;
  const curl = m.task === 'marathon'
    ? `curl -X POST ${location.origin}/api/v1/predict \\\n  -H "Authorization: Bearer kst_YOUR_KEY" -H "Content-Type: application/json" \\\n  -d '{"model":"${m.id}","training":[{"date":"2026-10-01","miles":8,"minutes":64}]}'`
    : `curl -X POST ${location.origin}/api/v1/predict \\\n  -H "Authorization: Bearer kst_YOUR_KEY" -H "Content-Type: application/json" \\\n  -d '{"model":"${m.id}","event":"5000","prs":[{"event":"1600","time":"5:05.3"}]}'`;
  const events = (L.cfg.labEvents || []).filter((e) => (m.task === 'short' ? e.task === 'short' : m.task === 'race' ? e.task === 'race' : false));
  const taskChip = m.task ? html`<span class="lab-chip">${TASK_LABEL[m.task] || m.task}</span>` : '';
  const kindChip = m.kind ? html`<span class="lab-chip">${KIND_LABEL[m.kind] || m.kind}</span>` : '';
  const licenseChip = m.license ? html`<span class="lab-chip">${m.license}</span>` : '';
  const builtinChip = m.builtin ? html`<span class="lab-chip builtin">Kestrel</span>` : '';
  const privateChip = m.visibility === 'private' ? html`<span class="lab-chip private">Private</span>` : '';
  render(html`
  <div class="lab-model-header">
    <div class="lab-breadcrumbs"><a href="#/models">Models</a> / <span>${m.owner}</span></div>
    <h1>${m.name} <span class="k-small">${m.version}</span></h1>
    <div class="lab-model-meta">${taskChip}${kindChip}${licenseChip}${builtinChip}${privateChip}${m.base_model ? html`<span class="lab-chip red">fine-tuned from ${m.base_model}</span>` : ''}</div>
    <div class="lab-model-actions">
      <a class="k-btn k-btn-primary lab-download-btn" href="/api/lab/models/${encodeURIComponent(m.id)}?download=1">⬇ Download weights</a>
      ${!m.builtin ? html`<button class="k-btn" type="button" id="useModelBtn">Use this model</button>` : ''}
    </div>
  </div>
  <div class="lab-page">
    <div>
      <div class="lab-model-tabs" role="tablist">${[['card', 'Model card'], ['try', 'Try it'], ['use', 'Use it']].map(([k, v]) => html`<button type="button" role="tab" data-tab="${k}" class="${k === tab ? 'on' : ''}" aria-selected="${k === tab}">${v}</button>`)}</div>
      ${tab === 'card' ? html`<section class="lab-panel lab-model-readme">${raw(md(m.readme || (m.builtin ? builtinReadme(m) : `${m.description}\n\n**Trained on:** ${m.trained_on || 'not given'}`)))}</section>` : ''}
      ${tab === 'try' ? (m.task === 'marathon'
        ? html`<section class="lab-panel"><h2>Try it</h2><p class="k-small">Marathon models read 16 weeks of training. Sign in to Kestrel and pick this model in You → Settings to see it on your own log, or call it through the API with your training days.</p></section>`
        : html`<section class="lab-panel"><h2>Try it</h2><p class="k-small">Enter one or more results; the model predicts the event you pick, with its 80% range.</p>
          <form id="tryForm">
            <div id="tryPrs">${prRow(0)}</div>
            <button type="button" class="k-link" id="tryAdd">+ another result</button>
            <label class="k-label" for="tryEvent">Predict</label>
            <select class="k-input" id="tryEvent" name="event">${events.map((e) => html`<option value="${e.key}">${e.label}</option>`)}</select>
            <label class="k-label" for="trySex">Sex (optional)</label>
            <select class="k-input" id="trySex" name="sex"><option value="">Not given</option><option value="f">Female</option><option value="m">Male</option></select>
            <div class="k-row"><button class="k-btn primary">Predict</button></div>
          </form>
          <div id="tryOut"></div></section>`) : ''}
      ${tab === 'use' ? html`<section class="lab-panel"><h2>In Kestrel</h2><p class="k-small">Make this the model behind your ${TASK_LABEL[m.task].toLowerCase()} in Fitness. You can switch back any time in You → Settings.</p>
          <button class="k-btn primary" type="button" id="useIt">Use this model</button></section>
        <section class="lab-panel"><h2>From your code</h2><p class="k-small">Make an API key in <a href="#/docs">Docs &amp; API</a>, then:</p><pre class="lab-code">${curl}</pre>
          <p class="k-small">Or download the weights and run them yourself: the evaluator is <a href="${SOURCE}/src/models.js" target="_blank" rel="noopener">src/models.js</a>, no dependencies.</p></section>` : ''}
    </div>
    <aside class="lab-model-sidebar">
      <section class="lab-panel"><h2>Files</h2>
        <p class="k-small">One JSON file: numbers, never code, so it is safe to run anywhere.</p>
        <a class="k-btn wide" href="/api/lab/models/${encodeURIComponent(m.id)}?download=1">Download weights (${fmtSize(m.size)})</a>
        <dl class="lab-kv" style="margin-top:14px">
          <dt>Kind</dt><dd>${m.kind}</dd>
          ${Object.entries(r.model.weights_summary || {}).map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}
          <dt>Used by</dt><dd>${r.model.used_by} athlete${r.model.used_by === 1 ? '' : 's'}</dd>
          <dt>Downloads</dt><dd>${m.downloads}</dd>
          ${m.created_at ? html`<dt>Published</dt><dd>${new Date(m.created_at).toLocaleDateString()}</dd>` : ''}
        </dl>
        <p class="k-small" style="margin-top:12px"><a href="#/new?base=${encodeURIComponent(m.id)}">Fine-tune this model</a></p>
      </section>
      ${r.model.mine ? html`<section class="lab-panel"><h2>Yours</h2><div class="k-row" style="margin:0"><a class="k-btn small" href="#/me">Edit or delete</a></div></section>` : ''}
    </aside>
  </div>`);
  $lab.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => viewModel(id, b.dataset.tab); });
  if ($('useModelBtn')) {
    $('useModelBtn').onclick = () => attempt(async () => {
      if (!(await signedIn())) { location.href = '/'; return; }
      await api('/api/me', { method: 'PUT', body: JSON.stringify({ models: { [m.task]: m.id } }) });
      toast('Model set as default for ' + (TASK_LABEL[m.task] || m.task));
      viewModel(id, 'card');
    });
  }
  if ($('tryForm')) {
    let n = 1;
    $('tryAdd').onclick = () => { if (n < 5) $('tryPrs').insertAdjacentHTML('beforeend', prRow(n++).s); };
    $('tryForm').onsubmit = (e) => {
      e.preventDefault();
      const prs = [...$('tryPrs').querySelectorAll('.lab-prs')].map((row) => ({ event: row.querySelector('select').value, time: row.querySelector('input').value.trim() })).filter((p) => p.time);
      attempt(async () => {
        const out = await api('/api/lab/try', { method: 'POST', body: JSON.stringify({ model: m.id, event: $('tryEvent').value, sex: $('trySex').value, prs }) });
        const ev = (L.cfg.labEvents || []).find((x) => x.key === out.event);
        $('tryOut').innerHTML = out.prediction
          ? html`<div class="lab-result"><span class="k-u">${fmtTime(out.prediction.sec)}${raw(HAND_UNDER)}</span></div><p class="k-small">${ev?.label || out.event}, 80% range ${fmtTime(out.prediction.lo)} to ${fmtTime(out.prediction.hi)}</p>`.s
          : html`<p class="k-small">${out.note}</p>`.s;
      }, e.submitter);
    };
  }
  if ($('useIt')) $('useIt').onclick = (e) => attempt(async () => {
    if (!(await signedIn())) { location.href = '/'; return; }
    await api('/api/me', { method: 'PUT', body: JSON.stringify({ models: { [m.task]: m.id } }) });
    toast(`${m.name} now makes your ${TASK_LABEL[m.task].toLowerCase()} in Kestrel.`);
  }, e.currentTarget);
}

function prRow(i) {
  const evs = (L.cfg.labEvents || []);
  return html`<div class="lab-prs"><div><label class="k-label" for="tp${i}">Result</label><select class="k-input" id="tp${i}">${evs.map((e) => html`<option value="${e.key}" ${e.key === '1600' ? raw('selected') : ''}>${e.label}</option>`)}</select></div>
    <div><label class="k-label" for="tt${i}">Time</label><input class="k-input" id="tt${i}" placeholder="5:05.3" inputmode="decimal"></div><span></span></div>`;
}

// ---------- publish

const README_TEMPLATE = `## What it does
One or two sentences: what it predicts and for whom.

## Training data
Where the results came from, how many athletes, years, and the data's licence.

## How good it is
Error on data the model never saw (for example: mean absolute error in % of race time), and the 80% range coverage.

## Limits
Who it has not been tested on.`;

async function viewNew() {
  if (!(await signedIn())) {
    render(html`${title('Publish a model')}<section class="lab-panel"><p>Sign in to Kestrel to publish. Your models appear under your name.</p><a class="k-btn primary" href="/">Sign in</a></section>`);
    return;
  }
  const base = new URLSearchParams(location.hash.split('?')[1] || '').get('base') || '';
  const all = await attempt(() => api('/api/lab/models'));
  render(html`
  <div class="k-kicker">Publish</div>
  ${title('Publish a model')}
  <div class="lab-page">
    <form id="pubForm" class="lab-panel">
      <h2>Model file</h2>
      <p class="k-small">A Kestrel model is one JSON file of weights (see <a href="#/docs">the format</a>). To fine-tune, download a model, retrain it on your data and upload it here.</p>
      <input type="file" id="pubFile" accept="application/json,.json" required>
      <div id="pubInfo" class="k-small"></div>
      <label class="k-label" for="pubBase">Fine-tuned from (optional)</label>
      <select class="k-input" id="pubBase"><option value="">Nothing: a new model</option>${(all?.models || []).map((m) => html`<option value="${m.id}" ${m.id === base ? raw('selected') : ''}>${m.name} ${m.version} (${m.owner})</option>`)}</select>
      <label class="k-label" for="pubReadme">Model card (Markdown)</label>
      <textarea class="k-input" id="pubReadme" rows="12">${README_TEMPLATE}</textarea>
      <label class="k-check"><input type="checkbox" id="pubPrivate"> Private: only I can see and use it</label>
      <div class="k-row"><button class="k-btn primary">Publish</button></div>
    </form>
    <aside><section class="lab-panel"><h2>Checks</h2><p class="k-small">Kestrel validates every file before it is stored: known kinds only, numbers only, every tree finishes, sizes capped (1 MB). Nothing in a model can run code.</p>
      <p class="k-small">Say where your training data came from and its licence. Don't publish models trained on data you aren't allowed to share, or that could identify athletes.</p></section></aside>
  </div>`);
  let model = null;
  $('pubFile').onchange = async () => {
    const f = $('pubFile').files[0];
    model = null;
    if (!f) return;
    try { model = JSON.parse(await f.text()); } catch { $('pubInfo').textContent = 'That file is not valid JSON.'; return; }
    $('pubInfo').textContent = `${model.name || 'Unnamed'} ${model.version || ''} · ${KIND_LABEL[model.kind] || model.kind} · ${TASK_LABEL[model.task] || model.task} · ${fmtSize(f.size)}`;
  };
  $('pubForm').onsubmit = (e) => {
    e.preventDefault();
    attempt(async () => {
      if (!model) throw new Error('Choose a valid model file.');
      const r = await api('/api/lab/models', { method: 'POST', body: JSON.stringify({ model, readme: $('pubReadme').value, base_model: $('pubBase').value, visibility: $('pubPrivate').checked ? 'private' : 'public' }) });
      toast('Published.');
      location.hash = `#/m/${encodeURIComponent(r.id)}`;
    }, e.submitter);
  };
}

// ---------- docs and keys

async function viewDocs() {
  const me = await signedIn();
  const keys = me ? await attempt(() => api('/api/lab/keys')) : null;
  render(html`
  <div class="k-kicker">Docs</div>
  ${title('Docs & API')}
  <div class="lab-page">
    <div>
      <section class="lab-panel lab-readme">${raw(md(`## The model format
A model is one JSON file:

\`\`\`
{ "kestrel": 1, "name": "My Riegel", "version": "v1",
  "kind": "riegel", "task": "race", "license": "CC0-1.0",
  "description": "Riegel with a steeper exponent for teens",
  "trained_on": "What data, from where, under which licence",
  "weights": { "exponent": 1.08, "sd": 0.05 } }
\`\`\`

**Tasks** are the slots a model fills: \`race\` (800 m and up, track, cross country and road), \`short\` (100-1000 m and steeplechase), \`marathon\` (from 16 weeks of training).

**Kinds**, each with its own evaluator in Kestrel:
- \`riegel\`: an exponent and a log-SD (race or short).
- \`lite-trees\`: gradient-boosted trees over HawksPredict-Lite's 21 features (race). Use this to fine-tune Lite.
- \`short-pairs\`: one log-log line per event pair (short).
- \`marathon-trees\`: trees over 15 training features (marathon).

The full rules (feature lists, tree layout, interval keys) are in [MODELS.md](${SOURCE}/MODELS.md).

## Fine-tuning
1. Download a model from its page. 2. Retrain on your results with the [HawksPredict scripts](https://github.com/jakecapmeil/hawks/tree/main/research/hawkspredict/scripts), keeping the same features. 3. Publish it with "Fine-tuned from" set, a model card, and your data's licence.

## The API
\`GET /api/v1/models?task=race&q=lite\` lists public models (no key).

\`POST /api/v1/predict\` with \`Authorization: Bearer kst_...\`:

\`\`\`
{ "model": "kestrel/hawkspredict-lite", "event": "5000",
  "prs": [{ "event": "1600", "time": "5:05.3" }], "sex": "f" }
\`\`\`

returns \`{ "prediction": { "sec", "lo", "hi", "range": "80%" } }\`. Marathon models take \`"training": [{ "date", "miles", "minutes" }]\` instead of PRs. Event keys: ${(L.cfg.labEvents || []).map((e) => e.key).join(', ')}.

Each key gets 1,000 calls a day. Browsers can call the API directly (CORS is open).`))}</section>
    </div>
    <aside>
      <section class="lab-panel"><h2>Your API keys</h2>
        ${me ? html`
          <div id="keyNew"></div>
          <form id="keyForm" class="k-row" style="margin:0 0 10px"><input class="k-input grow" name="name" placeholder="Key name (e.g. my app)" maxlength="40" aria-label="Key name"><button class="k-btn small primary">New key</button></form>
          <table class="lab-table"><tbody>${(keys?.keys || []).map((k) => html`<tr><td><b>${k.name || 'Key'}</b><div class="k-small">${k.prefix}… · ${k.last_used ? `used ${new Date(k.last_used).toLocaleDateString()}` : 'never used'}</div></td><td style="text-align:right"><button class="k-link danger" type="button" data-delkey="${k.id}">Delete</button></td></tr>`)}</tbody></table>`
          : html`<p class="k-small">Sign in to Kestrel to make API keys.</p><a class="k-btn" href="/">Sign in</a>`}
      </section>
    </aside>
  </div>`);
  if ($('keyForm')) $('keyForm').onsubmit = (e) => {
    e.preventDefault();
    attempt(async () => {
      const r = await api('/api/lab/keys', { method: 'POST', body: JSON.stringify({ name: e.target.name.value }) });
      await viewDocs();
      $('keyNew').innerHTML = html`<p class="k-small k-good">Copy your key now; it won't be shown again.</p><pre class="lab-code">${r.key}</pre>`.s;
    }, e.submitter);
  };
  $lab.querySelectorAll('[data-delkey]').forEach((b) => { b.onclick = () => attempt(async () => { if (!confirm('Delete this key? Apps using it stop working.')) return; await api(`/api/lab/keys/${b.dataset.delkey}`, { method: 'DELETE' }); viewDocs(); }, b); });
}

async function viewMe() {
  const me = await signedIn();
  if (!me) { render(html`${title('Your models')}<section class="lab-panel"><p>Sign in to Kestrel to see the models you've published.</p><a class="k-btn primary" href="/">Sign in</a></section>`); return; }
  const list = await attempt(() => api('/api/lab/models'));
  const mine = (list?.models || []).filter((m) => m.mine);
  render(html`
  <div class="k-kicker">${me.user.name}</div>
  ${title('Your models')}
  ${mine.length ? html`<table class="lab-table"><thead><tr><th>Model</th><th>Task</th><th>Visibility</th><th>Downloads</th><th></th></tr></thead><tbody>
    ${mine.map((m) => html`<tr><td><a href="#/m/${encodeURIComponent(m.id)}"><b>${m.name}</b> ${m.version}</a></td><td>${TASK_LABEL[m.task]}</td>
      <td><button class="k-link" type="button" data-vis="${m.id}" data-to="${m.visibility === 'public' ? 'private' : 'public'}">${m.visibility}</button></td><td>${m.downloads}</td>
      <td style="text-align:right"><button class="k-link" type="button" data-readme="${m.id}">Edit card</button> <button class="k-link danger" type="button" data-del="${m.id}">Delete</button></td></tr>`)}
  </tbody></table>` : html`<p>You haven't published a model yet. <a href="#/new">Publish one</a>.</p>`}`);
  $lab.querySelectorAll('[data-vis]').forEach((b) => { b.onclick = () => attempt(async () => { await api(`/api/lab/models/${b.dataset.vis}`, { method: 'PUT', body: JSON.stringify({ visibility: b.dataset.to }) }); viewMe(); }, b); });
  $lab.querySelectorAll('[data-del]').forEach((b) => { b.onclick = () => attempt(async () => { if (!confirm('Delete this model? Athletes using it go back to the default.')) return; await api(`/api/lab/models/${b.dataset.del}`, { method: 'DELETE' }); viewMe(); }, b); });
  $lab.querySelectorAll('[data-readme]').forEach((b) => {
    b.onclick = () => attempt(async () => {
      const { model } = await api(`/api/lab/models/${b.dataset.readme}`);
      let d = $('labDlg');
      if (!d) { d = document.createElement('dialog'); d.id = 'labDlg'; d.className = 'k-dialog'; document.body.appendChild(d); }
      d.innerHTML = html`<h2>Model card</h2><textarea class="k-input" id="labReadme" rows="16">${model.readme}</textarea>
        <div class="k-row"><button class="k-btn primary" type="button" id="labSave">Save</button><button class="k-link" type="button" id="labClose">Close</button></div>`.s;
      d.showModal();
      $('labClose').onclick = () => d.close();
      $('labSave').onclick = (e) => attempt(async () => { await api(`/api/lab/models/${b.dataset.readme}`, { method: 'PUT', body: JSON.stringify({ readme: $('labReadme').value }) }); d.close(); toast('Saved.'); }, e.currentTarget);
    }, b);
  });
}

// ---------- boot

async function signedIn() {
  if (L.me !== null) return L.me;
  if (!L.sb) return (L.me = false);
  const { data } = await L.sb.auth.getSession();
  if (!data.session) return (L.me = false);
  try { L.me = await api('/api/me'); if (!L.me.user.age_ok) L.me = false; } catch { L.me = false; }
  return L.me;
}

function route() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [path] = h.split('?');
  const nav = path.startsWith('/m/') ? 'home' : path === '/' || path === '/lab' ? 'home' : path === '/models' ? 'home' : path.slice(1);
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === nav));
  if (path.startsWith('/m/')) return viewModel(decodeURIComponent(path.slice(3)));
  if (path === '/new') return viewNew();
  if (path === '/docs') return viewDocs();
  if (path === '/me') return viewMe();
  if (path === '/models') return viewModels();
  return viewLab();
}

async function boot() {
  L.cfg = await fetch('/api/config').then((r) => r.json());
  if (L.cfg.supabaseUrl && L.cfg.supabaseKey) {
    L.sb = createClient(L.cfg.supabaseUrl, L.cfg.supabaseKey, { auth: { flowType: 'pkce', persistSession: true, detectSessionInUrl: false } });
  }
  window.addEventListener('hashchange', route);
  route();
}
boot().catch((err) => { console.error(err); $lab.innerHTML = `<p class="k-small">Kestrel Lab could not start: ${esc(err.message)}</p>`; });
