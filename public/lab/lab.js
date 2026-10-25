// Kestrel Lab: browse, try, download and publish open running models, and get API keys to call them.
// Routes: #/ (about), #/models (directory), #/m/<id>/<tab> (a model: card, files, try, api, lineage), #/new (publish),
// #/import (from GitHub or Hugging Face), #/workbench (test models on your own PRs), #/providers (what powers Kestrel AI),
// #/purposes (which model does which job in the app), #/docs (format + API), #/me (your models).
// Signing in shares the main app's Supabase session (same site), so the Lab needs no sign-in of its own.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import * as AI from '/ai.js';

const $ = (id) => document.getElementById(id);
const $lab = $('lab');
const L = { cfg: null, sb: null, token: null, me: null, task: '', q: '' };
// Purposes (the jobs a model can have in the app) come from /api/config; these are the short names.
const TASK_LABEL = { race: 'Race times', short: 'Sprints & steeple', marathon: 'Marathon', course: 'Courses' };
const KIND_LABEL = {
  'lite-trees': 'Boosted trees (KesslerPredict-Lite format)',
  'short-pairs': 'Event-pair lines (KesslerPredict-Short format)',
  'marathon-trees': 'Boosted trees over training (KesslerPredict-Marathon format)',
  riegel: 'Riegel formula',
  vdot: 'Daniels VDOT (oxygen-cost curves)',
  tanda: 'Tanda marathon formula (weekly distance and pace)',
  'course-transfer': 'Course line (flat time to course time)',
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
let lastHash = null;
// A new page eases in and starts at the top; re-rendering the same page (typing in search, say) stays put.
const render = (r) => {
  const fresh = lastHash !== location.hash;
  lastHash = location.hash;
  $lab.classList.toggle('lab-enter', fresh);
  $lab.innerHTML = r.s;
  if (fresh) window.scrollTo(0, 0);
};
const title = (text) => html`<h1 class="k-title">${text}</h1>`;
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
  return `${m.description}\n\n**Trained on:** ${m.trained_on}\n\n**Licence:** ${m.license}\n\nThe full model card (accuracy, limits, licence notes) is in [models/README.md](${SOURCE}/models/README.md). Training scripts and experiments: [KesslerPredict research](https://github.com/jakecapmeil/hawks/tree/main/research/hawkspredict).`;
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
  const feat = (h, t, href) => html`<a class="lab-feature" href="${href}"><h3>${h}</h3><p>${t}</p></a>`;
  render(html`
  <div class="lab-landing">
    <div class="lab-section lab-intro">
      <span class="k-chip accent">${L.cfg.platform}</span>
      <h1 class="k-display lab-display">Models you can read, fork and ship.</h1>
      <p class="k-lede">Kestrel is the simple app: it works out of the box. The Lab is where you choose the models behind it, test them on your own races, and move them to and from GitHub and Hugging Face. Every model is a plain file of numbers, never code.</p>
      <div class="k-row"><a class="k-btn primary" href="#/models">Browse models</a><a class="k-btn" href="#/import">Import from GitHub or Hugging Face</a>${me ? '' : html`<span class="k-small">Sign in to Kestrel to publish and import.</span>`}</div>
    </div>
    <div class="k-browser"><img src="/shots/lab-workbench.jpg" alt="The Workbench comparing two models against a runner's own results" width="2560" height="1600"></div>
    <div class="lab-section">
      <h2>What you can do</h2>
      <div class="lab-feature-grid">
        ${feat('Test before you switch', 'The Workbench hides each of your PRs in turn, asks the model for it, and shows how far off it was. Plan first, then Act.', '#/workbench')}
        ${feat('Fork and fine-tune', 'Fork any model, retrain it on your data and add a new version. Lineage shows what came from what.', '#/models')}
        ${feat('GitHub and Hugging Face', 'Import a kestrel.json from either site, update from source later, or push your model back out with a model card.', '#/import')}
        ${feat('Wire models to jobs', 'Every model declares one purpose: race times, sprints, the marathon, a single course like Van Cortlandt, or coaching. Pick one per job.', '#/purposes')}
        ${feat('Choose what powers the coach', 'Use your own key (OpenAI, Anthropic, Gemini, OpenRouter, Groq) or a model on your own computer.', '#/providers')}
        ${feat('Call it from your code', 'Every model has a REST endpoint. Make an API key and predict from your own app or dashboard.', '#/docs')}
        ${feat('Publish your own', 'Upload a validated JSON file, add a model card and a data licence, and share it with every Kestrel athlete.', '#/new')}
      </div>
    </div>
    <div class="lab-section">
      <h2>Model kinds</h2>
      <dl class="lab-kv">
        <dt>Riegel</dt><dd>Exponent-based race time predictor from your nearest PR. Race and short events.</dd>
        <dt>Lite-trees</dt><dd>Gradient-boosted trees over 21 KesslerPredict-Lite features. The one to fine-tune for race predictions.</dd>
        <dt>Short-pairs</dt><dd>Log-log lines between event pairs, for sprints and steeplechase (100-1000 m).</dd>
        <dt>Marathon-trees</dt><dd>Trees over 15 training features from your last 16 weeks.</dd>
        <dt>VDOT</dt><dd>Daniels' oxygen-cost curves: one result sets a fitness number, which sets every other distance.</dd>
        <dt>Tanda</dt><dd>A marathon formula from weekly distance and training pace, for 2:47 to 3:36 marathoners.</dd>
        <dt>Course-transfer</dt><dd>A line from flat-course time to a course's time, for one course such as Van Cortlandt. Fit it on that course's own races.</dd>
      </dl>
    </div>
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
      <span class="k-small">${m.created_at ? new Date(m.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : ''}</span>
    </div>
  </a>`;
}

// ---------- one model

const MODEL_TABS = [['card', 'Model card'], ['files', 'Files & versions'], ['try', 'Try it'], ['api', 'API'], ['lineage', 'Lineage']];
const shortDate = (t) => (t ? new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '');

function dlg() {
  let d = $('labDlg');
  if (!d) { d = document.createElement('dialog'); d.id = 'labDlg'; d.className = 'k-dialog'; document.body.appendChild(d); }
  d.innerHTML = '';
  return d;
}

async function viewModel(id, tab = 'card') {
  const r = await attempt(() => api(`/api/lab/models/${encodeURIComponent(id)}`));
  if (!r) { render(html`<p class="k-small">Model not found. <a href="#/models">Back to the models</a></p>`); return; }
  if (!MODEL_TABS.some(([k]) => k === tab)) tab = 'card';
  const m = r.model;
  const me = await signedIn();
  const isCourse = m.task === 'course';
  const curl = isCourse
    ? `curl -X POST ${location.origin}/api/v1/predict \\\n  -H "Authorization: Bearer kst_YOUR_KEY" -H "Content-Type: application/json" \\\n  -d '{"model":"${m.id}","flat_sec":1080,"sex":"m"}'`
    : m.task === 'marathon'
    ? `curl -X POST ${location.origin}/api/v1/predict \\\n  -H "Authorization: Bearer kst_YOUR_KEY" -H "Content-Type: application/json" \\\n  -d '{"model":"${m.id}","training":[{"date":"2026-10-01","miles":8,"minutes":64}]}'`
    : `curl -X POST ${location.origin}/api/v1/predict \\\n  -H "Authorization: Bearer kst_YOUR_KEY" -H "Content-Type: application/json" \\\n  -d '{"model":"${m.id}","event":"5000","prs":[{"event":"1600","time":"5:05.3"}]}'`;
  const events = (L.cfg.labEvents || []).filter((e) => (m.task === 'short' ? e.task === 'short' : m.task === 'race' ? e.task === 'race' : false));
  const chips = html`${m.task ? html`<span class="lab-chip">${TASK_LABEL[m.task] || m.task}</span>` : ''}${m.kind ? html`<span class="lab-chip">${KIND_LABEL[m.kind] || m.kind}</span>` : ''}${m.license ? html`<span class="lab-chip">${m.license}</span>` : ''}${m.builtin ? html`<span class="lab-chip builtin">Kestrel</span>` : ''}${m.visibility === 'private' ? html`<span class="lab-chip private">Private</span>` : ''}${m.base_model ? html`<span class="lab-chip red">fine-tuned from ${m.base_model}</span>` : ''}`;
  let body = html``;
  if (tab === 'card') {
    body = html`<section class="lab-panel lab-model-readme">${raw(md(m.readme || (m.builtin ? builtinReadme(m) : `${m.description}\n\n**Trained on:** ${m.trained_on || 'not given'}`)))}</section>`;
  } else if (tab === 'files') {
    body = html`<section class="lab-panel"><h2>Files</h2>
        <table class="lab-table"><tbody>
          <tr><td><b>kestrel.json</b><div class="k-small">The model: numbers, never code</div></td><td>${fmtSize(m.size)}</td><td style="text-align:right"><a class="k-btn small" href="/api/lab/models/${encodeURIComponent(m.id)}?download=1">Download</a></td></tr>
          <tr><td><b>README.md</b><div class="k-small">The model card</div></td><td>${fmtSize((m.readme || '').length)}</td><td style="text-align:right"><button class="k-btn small" type="button" data-tab="card">View</button></td></tr>
        </tbody></table>${m.source_url ? html`<p class="k-small">Imported from <a href="${m.source_url}" target="_blank" rel="noopener nofollow">${m.source_url.replace(/^https:\/\//, '')}</a></p>` : ''}</section>
      <section class="lab-panel"><h2>Versions</h2><div id="verList"><p class="k-small">Loading…</p></div>
        ${m.mine ? html`<form id="verForm"><label class="k-label" for="verFile">Add a version (a kestrel.json of the same kind and task)</label><input type="file" id="verFile" accept="application/json,.json" required>
          <label class="k-label" for="verNote">What changed</label><input class="k-input" id="verNote" maxlength="200" placeholder="Retrained on 2026 results">
          <div class="k-row"><button class="k-btn primary">Add version</button>${m.source_url ? html`<button type="button" class="k-btn" id="verPull">Update from source</button>` : ''}</div></form>` : ''}</section>`;
  } else if (tab === 'try') {
    body = isCourse
      ? html`<section class="lab-panel"><h2>Try it</h2><p class="k-small">Enter what a runner would run on a flat course in good weather. The model says what that is worth on ${m.course ? 'the course it was fitted for' : 'a course'}.</p>
          <form id="courseForm">
            <label class="k-label" for="flatTime">Flat time (a 5K, say)</label><input class="k-input" id="flatTime" placeholder="18:00" inputmode="numeric" required>
            <label class="k-label" for="courseSex">Sex (optional)</label>
            <select class="k-input" id="courseSex"><option value="">Not given</option><option value="f">Female</option><option value="m">Male</option></select>
            <div class="k-row"><button class="k-btn primary">Convert</button></div>
          </form><div id="tryOut"></div></section>`
      : m.task === 'marathon'
      ? html`<section class="lab-panel"><h2>Try it</h2><p class="k-small">Marathon models read 16 weeks of training. Use this model in your account to see it on your own log, or call it through the API with your training days.</p></section>`
      : html`<section class="lab-panel"><h2>Try it</h2><p class="k-small">Enter one or more results; the model predicts the event you pick, with its 80% range.</p>
          <form id="tryForm">
            <div id="tryPrs">${prRow(0)}</div>
            <button type="button" class="k-link" id="tryAdd">+ another result</button>
            <label class="k-label" for="tryEvent">Predict</label>
            <select class="k-input" id="tryEvent" name="event">${events.map((e) => html`<option value="${e.key}">${e.label}</option>`)}</select>
            <label class="k-label" for="trySex">Sex (optional)</label>
            <select class="k-input" id="trySex" name="sex"><option value="">Not given</option><option value="f">Female</option><option value="m">Male</option></select>
            <div class="k-row"><button class="k-btn primary">Predict</button><a class="k-btn" href="#/workbench?m=${encodeURIComponent(m.id)}">Test on my PRs</a></div>
          </form>
          <div id="tryOut"></div></section>`;
  } else if (tab === 'api') {
    body = html`<section class="lab-panel"><h2>From your code</h2><p class="k-small">Make an API key in <a href="#/docs">Docs &amp; API</a>, then:</p><pre class="lab-code">${curl}</pre>
        <p class="k-small">Or download the weights and run them yourself: the evaluator is <a href="${SOURCE}/src/models.js" target="_blank" rel="noopener">src/models.js</a>, no dependencies.</p></section>`;
  } else {
    body = html`<section class="lab-panel"><h2>Lineage</h2><div id="lineage"><p class="k-small">Loading…</p></div></section>`;
  }
  render(html`
  <div class="lab-model-header">
    <div class="lab-breadcrumbs"><a href="#/models">Models</a> / <span>${m.owner}</span></div>
    <h1>${m.name} <span class="k-small">${m.version}</span></h1>
    <div class="lab-model-meta">${chips}</div>
    <div class="lab-model-actions">
      <button class="k-btn primary" type="button" id="useModelBtn">Use in my account</button>
      <button class="k-btn" type="button" id="forkBtn">Fork</button>
      <button class="k-btn" type="button" id="pushBtn">Push to GitHub / Hugging Face</button>
      <a class="k-btn ghost" href="/api/lab/models/${encodeURIComponent(m.id)}?download=1">Download</a>
    </div>
  </div>
  <div class="lab-page">
    <div>
      <div class="lab-model-tabs" role="tablist">${MODEL_TABS.map(([k, v]) => html`<button type="button" role="tab" data-tab="${k}" class="${k === tab ? 'on' : ''}" aria-selected="${k === tab}">${v}</button>`)}</div>
      ${body}
    </div>
    <aside class="lab-model-sidebar">
      <section class="lab-panel"><h2>About</h2>
        <dl class="lab-kv">
          <dt>Kind</dt><dd>${m.kind}</dd>
          ${Object.entries(m.weights_summary || {}).map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}
          <dt>Used by</dt><dd>${m.used_by} athlete${m.used_by === 1 ? '' : 's'}</dd>
          <dt>Downloads</dt><dd>${m.downloads}</dd>
          ${m.created_at ? html`<dt>Published</dt><dd>${shortDate(m.created_at)}</dd>` : ''}
        </dl>
        <p class="k-small" style="margin-top:12px"><a href="#/new?base=${encodeURIComponent(m.id)}">Publish a fine-tuned version</a></p>
      </section>
      ${m.mine ? html`<section class="lab-panel"><h2>Yours</h2><div class="k-row" style="margin:0"><a class="k-btn small" href="#/me">Edit or delete</a></div></section>` : ''}
    </aside>
  </div>`);
  $lab.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { location.hash = `#/m/${encodeURIComponent(id)}/${b.dataset.tab}`; }; });
  const needSignIn = async () => { if (await signedIn()) return true; toast('Sign in to Kestrel first.', true); setTimeout(() => { location.href = '/'; }, 900); return false; };
  $('useModelBtn').onclick = (e) => attempt(async () => {
    if (!(await needSignIn())) return;
    await api('/api/me', { method: 'PUT', body: JSON.stringify({ models: { [m.task]: m.id } }) });
    toast(`${m.name} now makes your ${TASK_LABEL[m.task].toLowerCase()} in Kestrel.`);
  }, e.currentTarget);
  $('forkBtn').onclick = (e) => attempt(async () => {
    if (!(await needSignIn())) return;
    const out = await api('/api/lab/fork', { method: 'POST', body: JSON.stringify({ id: m.id }) });
    toast('Forked. It is private until you publish it.');
    location.hash = `#/m/${encodeURIComponent(out.id)}/files`;
  }, e.currentTarget);
  $('pushBtn').onclick = async () => { if (await needSignIn()) pushDialog(m); };
  if (tab === 'files') {
    attempt(() => api(`/api/lab/versions?id=${encodeURIComponent(m.id)}`)).then((v) => {
      if (!v) return;
      $('verList').innerHTML = html`<table class="lab-table"><thead><tr><th>Version</th><th>What changed</th><th>When</th><th>Size</th></tr></thead><tbody>${v.versions.map((x) => html`<tr><td><b>${x.version || '–'}</b> ${x.current ? html`<span class="lab-chip published">latest</span>` : ''}</td><td>${x.note || ''}${x.source_url ? html` <a href="${x.source_url}" target="_blank" rel="noopener nofollow">source</a>` : ''}</td><td>${shortDate(x.created_at)}</td><td>${fmtSize(x.size)}</td></tr>`)}</tbody></table>`.s;
    });
    if ($('verForm')) $('verForm').onsubmit = (e) => {
      e.preventDefault();
      attempt(async () => {
        let file;
        try { file = JSON.parse(await $('verFile').files[0].text()); } catch { throw new Error('That file is not valid JSON.'); }
        await api('/api/lab/versions', { method: 'POST', body: JSON.stringify({ id: m.id, model: file, note: $('verNote').value }) });
        toast('Version added.');
        viewModel(id, 'files');
      }, e.submitter);
    };
    if ($('verPull')) $('verPull').onclick = (e) => attempt(async () => {
      const src = m.source_url.match(/^https:\/\/(github\.com|huggingface\.co)\/([^/]+\/[^/]+)\/blob\/([^/]+)\/(.+)$/);
      if (!src) throw new Error('This model has no source to update from.');
      await api('/api/lab/import', { method: 'POST', body: JSON.stringify({ source: src[1] === 'github.com' ? 'github' : 'huggingface', repo: `${src[2]}@${src[3]}:${src[4]}`, dry: false }) });
      toast('Updated from source.');
      viewModel(id, 'files');
    }, e.currentTarget);
  }
  if (tab === 'lineage') {
    attempt(() => api(`/api/lab/lineage?id=${encodeURIComponent(m.id)}`)).then((l) => {
      if (!l) return;
      const row = (x, cls = '') => html`<a class="lab-lin ${cls}" href="#/m/${encodeURIComponent(x.id)}/lineage"><b>${x.name}</b> <span class="k-small">${x.version} · ${x.owner}</span></a>`;
      $('lineage').innerHTML = html`<div class="lab-tree">
        ${l.parent ? row(l.parent) : l.external_parent ? html`<div class="lab-lin"><b>${l.external_parent}</b> <span class="k-small">parent, not in the Lab</span></div>` : html`<div class="lab-lin root"><span class="k-small">No parent: an original model</span></div>`}
        <div class="lab-tree-in"><div class="lab-lin now"><b>${m.name}</b> <span class="k-small">${m.version} · this model</span></div>
          <div class="lab-tree-in">${l.children.length ? l.children.map((c) => row(c)) : html`<div class="k-small">No forks or fine-tunes yet.</div>`}</div></div></div>`.s;
    });
  }
  if ($('courseForm')) {
    $('courseForm').onsubmit = (e) => {
      e.preventDefault();
      const parts = $('flatTime').value.trim().split(':').map(Number);
      const flat = parts.some((x) => !Number.isFinite(x)) ? NaN : parts.reduce((a, x) => a * 60 + x, 0);
      attempt(async () => {
        const out = await api('/api/lab/try', { method: 'POST', body: JSON.stringify({ model: m.id, flat_sec: flat, sex: $('courseSex').value }) });
        const p = out.prediction.sec;
        $('tryOut').innerHTML = html`<div class="lab-result">${fmtTime(p)}</div><p class="k-small">${fmtTime(flat)} flat is worth ${fmtTime(p)} on the course (${((p / flat - 1) * 100).toFixed(1)}% slower).</p>`.s;
      }, e.submitter);
    };
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
          ? html`<div class="lab-result">${fmtTime(out.prediction.sec)}</div><p class="k-small">${ev?.label || out.event}, 80% range ${fmtTime(out.prediction.lo)} to ${fmtTime(out.prediction.hi)}</p>`.s
          : html`<p class="k-small">${out.note}</p>`.s;
      }, e.submitter);
    };
  }
}

// Push a model to GitHub or Hugging Face. The token is sent once, used for these calls and forgotten.
function pushDialog(m) {
  const d = dlg();
  let target = 'github';
  const draw = () => {
    d.innerHTML = html`<h2>Push ${m.name}</h2>
      <p class="k-small">Writes two files, <code>kestrel.json</code> and <code>README.md</code>, so anyone can import the model back with the same repository name.</p>
      <div class="lab-seg" role="group" aria-label="Where to">${[['github', 'GitHub'], ['huggingface', 'Hugging Face']].map(([k, v]) => html`<button type="button" data-t="${k}" class="${k === target ? 'on' : ''}">${v}</button>`)}</div>
      <form id="pushForm">
        <label class="k-label" for="pushRepo">Repository</label><input class="k-input" id="pushRepo" placeholder="${target === 'github' ? 'you/kestrel-models' : 'you/my-kestrel-model'}" required>
        <p class="k-small">${target === 'github' ? 'Add @branch to push to a branch, or :folder to put the files in a folder: you/repo@main:models.' : 'Created if it does not exist, as a private repository when this model is private.'}</p>
        <label class="k-label" for="pushTok">${target === 'github' ? 'GitHub token (fine-grained, Contents: read and write)' : 'Hugging Face token (write access)'}</label><input class="k-input" id="pushTok" type="password" autocomplete="off" required>
        <p class="k-small">Used once for this push and never stored.</p>
        <label class="k-label" for="pushMsg">Commit message</label><input class="k-input" id="pushMsg" maxlength="200" placeholder="${esc(`Kestrel Lab: ${m.name} ${m.version || ''}`.trim())}">
        <div class="k-row"><button class="k-btn primary">Push</button><button type="button" class="k-link" id="pushClose">Close</button></div>
        <p class="k-small" id="pushOut"></p>
      </form>`.s;
    d.querySelectorAll('[data-t]').forEach((b) => { b.onclick = () => { target = b.dataset.t; draw(); }; });
    $('pushClose').onclick = () => d.close();
    $('pushForm').onsubmit = (e) => {
      e.preventDefault();
      attempt(async () => {
        const out = await api('/api/lab/export', { method: 'POST', body: JSON.stringify({ id: m.id, target, repo: $('pushRepo').value.trim(), token: $('pushTok').value.trim(), message: $('pushMsg').value.trim() }) });
        $('pushTok').value = '';
        $('pushOut').innerHTML = html`<span class="k-good">Pushed.</span> <a href="${out.url}" target="_blank" rel="noopener">Open ${out.repo}</a>`.s;
      }, e.submitter);
    };
  };
  draw();
  d.showModal();
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
- \`lite-trees\`: gradient-boosted trees over KesslerPredict-Lite's 21 features (race). Use this to fine-tune Lite.
- \`short-pairs\`: one log-log line per event pair (short).
- \`marathon-trees\`: trees over 15 training features (marathon).

The full rules (feature lists, tree layout, interval keys) are in [MODELS.md](${SOURCE}/MODELS.md).

## Fine-tuning
1. Download a model from its page. 2. Retrain on your results with the [KesslerPredict scripts](https://github.com/jakecapmeil/hawks/tree/main/research/hawkspredict/scripts), keeping the same features. 3. Publish it with "Fine-tuned from" set, a model card, and your data's licence.

## The API
\`GET /api/v1/models?task=race&q=lite\` lists public models (no key).

\`POST /api/v1/predict\` with \`Authorization: Bearer kst_...\`:

\`\`\`
{ "model": "kestrel/kesslerpredict-lite", "event": "5000",
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

// ---------- import from GitHub or Hugging Face

const STARTER = { kestrel: 1, name: 'My model', version: 'v1', kind: 'riegel', task: 'race', license: 'CC0-1.0', description: 'What it predicts and for whom', trained_on: 'Where the results came from, and the data licence', weights: { exponent: 1.06, sd: 0.04 } };

async function viewImport() {
  if (!(await signedIn())) {
    render(html`<div class="k-kicker">Import</div>${title('Import a model')}<section class="lab-panel"><p>Sign in to Kestrel to import models from GitHub or Hugging Face.</p><a class="k-btn primary" href="/">Sign in</a></section>`);
    return;
  }
  let source = 'github';
  const draw = () => {
    render(html`
    <div class="k-kicker">Import</div>
    ${title('Import a model')}
    <div class="lab-page">
      <div>
        <form id="impForm" class="lab-panel">
          <h2>From a repository</h2>
          <div class="lab-seg" role="group" aria-label="Source">${[['github', 'GitHub'], ['huggingface', 'Hugging Face']].map(([k, v]) => html`<button type="button" data-src="${k}" class="${k === source ? 'on' : ''}">${v}</button>`)}</div>
          <label class="k-label" for="impRepo">Repository</label>
          <input class="k-input" id="impRepo" placeholder="${source === 'github' ? 'jakecapmeil/kestrel@main:models/riegel.json' : 'owner/model-name'}" autocomplete="off" required>
          <p class="k-small">A name like <code>owner/name</code>, a link, or <code>owner/name@branch:path/kestrel.json</code>. Kestrel reads only <code>kestrel.json</code> and <code>README.md</code>, and never runs anything.</p>
          <details><summary class="k-small">Private repository?</summary>
            <label class="k-label" for="impTok">Access token</label><input class="k-input" id="impTok" type="password" autocomplete="off">
            <p class="k-small">Used for this import only and never stored.</p></details>
          <div class="k-row"><button class="k-btn primary">Preview</button></div>
        </form>
        <div id="impOut"></div>
      </div>
      <aside>
        <section class="lab-panel"><h2>What is checked</h2>
          <p class="k-small">The file goes through the same validation as an upload: known kinds only, numbers only, 1 MB at most. You see the result before anything is saved.</p>
          <p class="k-small">The model card's licence and base model carry over. The repository link is kept, so you can update from source later.</p></section>
        <section class="lab-panel"><h2>No kestrel.json yet?</h2>
          <p class="k-small">Start from a tiny valid file, edit the numbers, and commit it to any repository.</p>
          <button class="k-btn small" type="button" id="impStarter">Download a starter</button></section>
      </aside>
    </div>`);
    $lab.querySelectorAll('[data-src]').forEach((b) => { b.onclick = () => { source = b.dataset.src; const v = $('impRepo').value; draw(); $('impRepo').value = v; }; });
    $('impStarter').onclick = () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(STARTER, null, 2) + '\n'], { type: 'application/json' }));
      a.download = 'kestrel.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    $('impForm').onsubmit = (e) => {
      e.preventDefault();
      attempt(async () => {
        const req = { source, repo: $('impRepo').value.trim(), token: $('impTok').value.trim() };
        const p = await api('/api/lab/import', { method: 'POST', body: JSON.stringify({ ...req, dry: true }) });
        $('impOut').innerHTML = html`<section class="lab-panel"><h2>${p.model.name} <span class="k-small">${p.model.version}</span></h2>
          <div class="lab-model-meta"><span class="lab-chip">${TASK_LABEL[p.model.task] || p.model.task}</span><span class="lab-chip">${KIND_LABEL[p.model.kind] || p.model.kind}</span>${p.model.license ? html`<span class="lab-chip">${p.model.license}</span>` : ''}<span class="lab-chip">${fmtSize(p.model.size)}</span>${p.base_model ? html`<span class="lab-chip red">fine-tuned from ${p.base_model}</span>` : ''}</div>
          <p class="k-small">${p.model.description || 'No description.'}</p>
          <p class="k-small">Read: <code>${p.files.model}</code>${p.files.readme ? html`, <code>${p.files.readme}</code>` : ' (no README.md, so no model card)'}. Valid.</p>
          ${p.update_of ? html`<p class="k-small k-good">You already imported this file as version ${p.update_of.version || '–'}. Importing adds a new version.</p>` : html`<label class="k-check"><input type="checkbox" id="impPrivate"> Private: only I can see and use it</label>`}
          <div class="k-row"><button class="k-btn primary" id="impGo" type="button">${p.update_of ? 'Add as a new version' : 'Import'}</button></div></section>`.s;
        $('impGo').onclick = (ev) => attempt(async () => {
          const out = await api('/api/lab/import', { method: 'POST', body: JSON.stringify({ ...req, dry: false, visibility: $('impPrivate')?.checked ? 'private' : 'public' }) });
          toast(out.updated ? 'Updated.' : 'Imported.');
          location.hash = `#/m/${encodeURIComponent(out.id)}/files`;
        }, ev.currentTarget);
      }, e.submitter);
    };
  };
  draw();
}

// ---------- workbench: test models on your own PRs, then decide

async function viewWorkbench() {
  if (!(await signedIn())) {
    render(html`<div class="k-kicker">Workbench</div>${title('Workbench')}<section class="lab-panel"><p>Sign in to Kestrel to test models on your own race results.</p><a class="k-btn primary" href="/">Sign in</a></section>`);
    return;
  }
  const want = new URLSearchParams(location.hash.split('?')[1] || '').get('m') || '';
  const list = await attempt(() => api('/api/lab/models'));
  if (!list) return;
  const models = list.models.filter((m) => m.task !== 'marathon');
  const picked = new Set(want ? [want] : models.filter((m) => m.builtin).slice(0, 2).map((m) => m.id));
  render(html`
  <div class="k-kicker">Workbench</div>
  ${title('Test models on your results')}
  <div class="lab-page">
    <div>
      <section class="lab-panel"><h2>Plan</h2>
        <p class="k-small">Each model predicts every PR you have from your <i>other</i> PRs, then Kestrel compares that with what you really ran. Nothing is saved or changed.</p>
        <div class="lab-pick">${models.map((m) => html`<label class="k-check"><input type="checkbox" value="${m.id}" ${picked.has(m.id) ? raw('checked') : ''}> <span><b>${m.name}</b> <span class="k-small">${m.version} · ${TASK_LABEL[m.task]} · ${m.owner}</span></span></label>`)}</div>
        <div class="k-row"><button class="k-btn primary" type="button" id="wbRun">Run on my PRs</button></div></section>
      <div id="wbOut"></div>
    </div>
    <aside><section class="lab-panel"><h2>Act</h2>
      <p class="k-small">When a model beats the one you use, press <b>Use this model</b> under its results. That sets it as your default for that task in Kestrel. You can switch back any time.</p>
      <p class="k-small">You need at least two PRs per task. Add them in Kestrel under You.</p></section></aside>
  </div>`);
  $('wbRun').onclick = (e) => attempt(async () => {
    const ids = [...$lab.querySelectorAll('.lab-pick input:checked')].map((i) => i.value).slice(0, 4);
    if (!ids.length) throw new Error('Pick at least one model.');
    const out = await api('/api/lab/workbench', { method: 'POST', body: JSON.stringify({ models: ids }) });
    const pct = (x) => `${x > 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
    $('wbOut').innerHTML = out.results.map((r) => html`<section class="lab-panel"><h2>${r.name} <span class="k-small">${r.version}</span></h2>
      ${r.rows.length ? html`<div class="lab-stats"><div><b>${(r.mae * 100).toFixed(1)}%</b><span>average error</span></div><div><b>${Math.round(r.coverage * 100)}%</b><span>inside the 80% range</span></div><div><b>${r.rows.length}</b><span>results tested</span></div></div>
        <table class="lab-table"><thead><tr><th>Event</th><th>You ran</th><th>Model said</th><th>Off by</th></tr></thead><tbody>${r.rows.map((x) => html`<tr><td>${x.label}</td><td>${fmtTime(x.actual)}</td><td>${fmtTime(x.predicted)} <span class="k-small">(${fmtTime(x.lo)}–${fmtTime(x.hi)})</span></td><td>${pct(x.err)}</td></tr>`)}</tbody></table>
        <div class="k-row"><button class="k-btn small" type="button" data-use="${r.id}" data-task="${r.task}">Use this model</button></div>`
      : html`<p class="k-small">${r.note}</p>`}</section>`.s).join('');
    $lab.querySelectorAll('[data-use]').forEach((b) => { b.onclick = () => attempt(async () => { await api('/api/me', { method: 'PUT', body: JSON.stringify({ models: { [b.dataset.task]: b.dataset.use } }) }); toast('Set as your model in Kestrel.'); }, b); });
  }, e.currentTarget);
}

// ---------- providers: what powers Kestrel AI (the key stays in this browser)

async function viewProviders() {
  let state = AI.loadAi();
  const draw = (id) => {
    const p = AI.PROVIDERS[id];
    const c = AI.configFor(state, id);
    render(html`
    <div class="k-kicker">Providers</div>
    ${title('What powers Kestrel AI')}
    <div class="lab-page">
      <form id="provForm" class="lab-panel">
        <p class="k-small">Kestrel is the coach: the plan rules, your data and the safety checks are the same whatever model you choose. Your key stays in this browser and goes straight to the provider, never to Kestrel.</p>
        <label class="k-label" for="provP">Provider</label>
        <select class="k-input" id="provP" name="provider">${Object.entries(AI.PROVIDERS).map(([k, v]) => html`<option value="${k}" ${k === id ? raw('selected') : ''}>${v.label}</option>`)}</select>
        ${p.kind === 'kestrel' ? html`<p class="k-small">Free, with a daily limit. Runs on Google Gemini, with an open-weight Llama model on Cloudflare as backup.</p>` : html`
        <label class="k-label" for="provB">Server address</label><input class="k-input" id="provB" name="base" value="${c.base}" placeholder="https://…/v1" required>
        <label class="k-label" for="provM">Model</label><div class="k-row" style="margin-top:0"><input class="k-input grow" id="provM" name="model" value="${c.model}" list="provList" placeholder="model name" required><button type="button" class="k-btn small" id="provLs">List models</button></div><datalist id="provList"></datalist>
        <label class="k-label" for="provK">API key ${p.needsKey ? '' : '(optional)'}</label><input class="k-input" id="provK" name="key" type="password" value="${c.key}" autocomplete="off" ${p.needsKey ? raw('required') : ''}>
        <p class="k-small">${p.keyUrl ? html`<a href="${p.keyUrl}" target="_blank" rel="noopener">Get a key</a>` : ''}</p>
        ${p.local ? html`<p class="k-small">${id === 'ollama'
          ? html`Install <a href="https://ollama.com" target="_blank" rel="noopener">Ollama</a>, run <code>ollama pull ${c.model || 'llama3.2'}</code>, then start it so this site may call it: <code>OLLAMA_ORIGINS=${location.origin} ollama serve</code>`
          : html`In LM Studio, load a model, start the local server and turn on "Enable CORS".`}</p>` : ''}`}
        <div class="k-row"><button class="k-btn primary">Save</button><button type="button" class="k-btn" id="provTest">Test</button></div>
        <p class="k-small" id="provMsg"></p>
      </form>
      <aside>
        <section class="lab-panel"><h2>In use now</h2><p><b>${AI.describe(AI.loadAi())}</b></p><p class="k-small">Kestrel's coach and the AI tools in the app use this.</p></section>
        <section class="lab-panel"><h2>Tools (MCP)</h2><p class="k-small">Kestrel also speaks MCP at <code>${location.origin}/mcp/</code>, so Claude, Cursor and other agents can read your plan and log with your sign-in.</p></section>
      </aside>
    </div>`);
    const f = $('provForm');
    const collect = () => {
      const v = Object.fromEntries(new FormData(f).entries());
      const next = { provider: v.provider, configs: { ...state.configs } };
      if (id !== 'kestrel') next.configs[id] = { base: (v.base || '').trim(), model: (v.model || '').trim(), key: (v.key || '').trim() };
      return next;
    };
    $('provP').onchange = () => { const next = $('provP').value; state = { ...collect(), provider: state.provider }; draw(next); };
    f.onsubmit = (e) => { e.preventDefault(); state = collect(); AI.saveAi(state); toast(`Kestrel AI now runs on ${AI.describe(state)}.`); draw(state.provider); };
    $('provTest').onclick = async (e) => {
      const msg = $('provMsg');
      e.currentTarget.disabled = true;
      msg.textContent = 'Testing…';
      msg.className = 'k-small';
      try {
        const apiFetch = async (path, opts) => {
          const q = JSON.parse(opts.body).messages.at(-1).content;
          const r = await api('/api/coach/ask', { method: 'POST', body: JSON.stringify({ history: [{ role: 'user', text: q }] }) });
          return { text: r.answer };
        };
        const out = await AI.complete(collect(), 'Reply in under ten words.', [{ role: 'user', content: 'Say hello to a runner.' }], { apiFetch });
        msg.textContent = `Works: "${out.slice(0, 120)}"`;
        msg.className = 'k-small k-good';
      } catch (err) { msg.textContent = err.message; msg.className = 'k-small k-bad'; } finally { e.currentTarget.disabled = false; }
    };
    if ($('provLs')) $('provLs').onclick = async () => {
      const msg = $('provMsg');
      try {
        const names = await AI.listModels(collect(), id);
        $('provList').innerHTML = names.map((n) => `<option value="${esc(n)}">`).join('');
        msg.textContent = names.length ? `${names.length} models found. Start typing in Model to pick one.` : 'The server did not list any models.';
        msg.className = 'k-small';
      } catch (err) { msg.textContent = err.message; msg.className = 'k-small k-bad'; }
    };
  };
  draw(state.provider);
}

// ---------- purposes

// Every place in Kestrel where a model does a job, what is doing it for you now, and what else could.
// A purpose has one pick; each of its events can override that pick (race:5K, short:600, vc:2.5mi).
async function viewPurposes() {
  const me = await signedIn();
  const [list, mine, cat] = await Promise.all([
    attempt(() => api('/api/lab/models')),
    me ? attempt(() => api('/api/me')) : null,
    me ? attempt(() => api('/api/courses')) : null,
  ]);
  if (!list) return;
  const purposes = L.cfg.purposes || {};
  const picks = { ...(L.cfg.defaults || {}), ...(mine?.models || {}) };
  const eventPicks = mine?.event_models || {};
  const groups = {};
  for (const [key, p] of Object.entries(purposes)) (groups[p.group] ||= []).push([key, p]);
  const byId = Object.fromEntries(list.models.map((m) => [m.id, m]));
  const opt = (m, sel) => html`<option value="${m.id}" ${m.id === sel ? raw('selected') : ''}>${m.name} ${m.version}</option>`;
  // Courses: the ones this athlete follows (plus any with a pick already), each with a model for the course and one per distance.
  const courseSection = (p) => {
    const options = list.models.filter((m) => m.task === 'course');
    const names = Object.fromEntries((cat?.courses || []).map((c) => [c.id, c.name]));
    const rows = new Map();
    for (const t of cat?.tracked || []) { if (!rows.has(t.course)) rows.set(t.course, new Set()); rows.get(t.course).add(t.m); }
    for (const k of Object.keys(eventPicks)) { const m = /^course:([^:]+)(?::(\d+))?$/.exec(k); if (m) { if (!rows.has(m[1])) rows.set(m[1], new Set()); if (m[2]) rows.get(m[1]).add(Number(m[2])); } }
    const pick = (slot, none) => html`<select class="k-input" data-slot="${slot}"><option value="">${none}</option>${options.map((m) => opt(m, eventPicks[slot]))}</select>`;
    const dist = (m) => { const mi = m / 1609.344; return Math.abs(mi * 2 - Math.round(mi * 2)) < 0.03 && m % 1000 ? `${Math.round(mi * 2) / 2} mi` : m % 1000 === 0 ? `${m / 1000}K` : `${m} m`; };
    return html`<div class="lab-purpose"><div><h3>${p.label}</h3>
      <p class="k-small">A course with no model uses its catalogue factor (Van Cortlandt runs 5.5% slower than flat, other cross-country courses 2.5%). Pick a model to replace that for one course, or for one distance on it; a distance beats its course, and a course beats the setting below. ${options.length} course model${options.length === 1 ? '' : 's'}. <a href="#/models?task=course">Browse</a></p></div>
      ${me ? html`<div class="k-row"><label class="k-small">All courses <select class="k-input" data-pick="course"><option value="">Catalogue factors (default)</option>${options.map((m) => opt(m, mine?.models?.course))}</select></label></div>
      <div class="lab-slot-grid lab-course-grid">${[...rows].map(([id, ms]) => html`<fieldset><legend>${names[id] || id}</legend>
        <label>Whole course${pick(`course:${id}`, 'Same as all courses')}</label>
        ${[...ms].sort((a, b) => a - b).map((m) => html`<label>${dist(m)}${pick(`course:${id}:${m}`, 'Same as the course')}</label>`)}</fieldset>`)}</div>
      ${rows.size ? '' : html`<p class="k-small">Follow a course in Kestrel (Records, then Courses) and it shows up here.</p>`}` : html`<p class="k-small">Sign in to Kestrel to choose.</p>`}
      </div>`;
  };
  const row = ([key, p]) => {
    if (key === 'course') return courseSection(p);
    if (p.model === false) {
      return html`<div class="lab-purpose"><div><h3>${p.label}</h3><p class="k-small">Powered by a provider, not a weights file: the free Kestrel model, your own key (OpenAI, Anthropic, Gemini, OpenRouter, Groq) or a model on your own computer. The plan rules and safety checks are the same whatever you choose.</p></div><a class="k-btn small" href="#/providers">Choose a provider</a></div>`;
    }
    const options = list.models.filter((m) => m.task === key);
    const cur = byId[picks[key]];
    const evs = (L.cfg.slotEvents || {})[key] || [];
    const nOver = evs.filter(([e]) => eventPicks[`${key}:${e}`]).length;
    return html`<div class="lab-purpose"><div><h3>${p.label}</h3>
      <p class="k-small">${cur ? html`Now: <a href="#/m/${encodeURIComponent(cur.id)}"><b>${cur.name}</b> ${cur.version}</a>${picks[key] === L.cfg.defaults[key] ? ' (default)' : ''}` : 'Using the default.'} ${options.length} model${options.length === 1 ? '' : 's'} can do this.</p></div>
      <div class="k-row">${me
        ? html`<select class="k-input" data-pick="${key}" aria-label="Model for ${p.label}">${options.map((m) => opt(m, picks[key]))}</select>`
        : html`<span class="k-small">Sign in to Kestrel to choose.</span>`}
        <a class="k-btn small" href="#/models?task=${key}">Browse</a></div>
      ${me && evs.length ? html`<details class="lab-slots"${nOver ? raw(' open') : ''}><summary>Per-event models${nOver ? html` <span class="lab-chip">${nOver} overridden</span>` : ''}</summary>
        <div class="lab-slot-grid">${evs.map(([e, name]) => { const slot = `${key}:${e}`; return html`<label>${name}<select class="k-input" data-slot="${slot}"><option value="">Same as above</option>${options.map((m) => opt(m, eventPicks[slot]))}</select></label>`; })}</div></details>` : ''}
      </div>`;
  };
  const setup = me ? JSON.stringify({ models: picks, event_models: eventPicks }, null, 2) : '';
  render(html`
  <div class="k-kicker">Purposes</div>
  ${title('Which model does which job')}
  <p class="k-lede">${L.cfg.platform} models each declare one purpose, because Kestrel only has so many places a model can plug in. Pick one model for each, then override any single event: the 5K on one model, the 1600 on another, Van Cortlandt's 2.5 mi on a model fitted just for it. A course purpose swaps in a model for that one course, so a Van Cortlandt model never changes your track predictions.</p>
  <div class="lab-page">${Object.entries(groups).map(([g, rows]) => html`<section class="lab-panel"><h2>${g}</h2>${rows.map(row)}</section>`)}
  ${me ? html`<section class="lab-panel"><h2>Your setup as a file</h2>
    <p class="k-small">Everything above as JSON. Copy it to keep or share a setup, or paste one and apply it. Slots are <code>purpose:event</code>; an empty value follows the purpose.</p>
    <textarea class="k-input lab-setup" id="setupJson" rows="10" spellcheck="false" aria-label="Setup JSON">${setup}</textarea>
    <div class="k-row"><button class="k-btn" type="button" id="setupApply">Apply setup</button></div></section>` : ''}</div>`);
  const save = (body, btn) => attempt(async () => {
    await api('/api/me', { method: 'PUT', body: JSON.stringify(body) });
    L.me = null;
    toast('Saved. Fitness recalculates with it.');
    return true;
  }, btn);
  $lab.querySelectorAll('[data-pick]').forEach((sel) => { sel.onchange = () => save({ models: { [sel.dataset.pick]: sel.value } }, sel); });
  $lab.querySelectorAll('[data-slot]').forEach((sel) => { sel.onchange = async () => { if (await save({ event_models: { [sel.dataset.slot]: sel.value } }, sel)) viewPurposes(); }; });
  if ($('setupApply')) {
    $('setupApply').onclick = async (e) => {
      let cfg;
      try { cfg = JSON.parse($('setupJson').value); } catch { toast('That is not valid JSON.', true); return; }
      // Slots missing from the file are cleared, so the file is the whole truth.
      const cleared = Object.fromEntries(Object.keys(eventPicks).map((k) => [k, '']));
      if (await save({ models: cfg.models || {}, event_models: { ...cleared, ...(cfg.event_models || {}) } }, e.currentTarget)) viewPurposes();
    };
  }
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
  const [path, query] = h.split('?');
  if (path === '/models' && query) L.task = new URLSearchParams(query).get('task') || '';
  const nav = path.startsWith('/m/') || path === '/models' ? 'models' : path === '/' ? 'home' : path.slice(1);
  document.querySelectorAll('[data-nav]').forEach((a) => { const on = a.dataset.nav === nav; a.classList.toggle('on', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  if (path.startsWith('/m/')) {
    const rest = path.slice(3).split('/');
    const tab = MODEL_TABS.some(([k]) => k === rest[rest.length - 1]) ? rest.pop() : 'card';
    return viewModel(decodeURIComponent(rest.join('/')), tab);
  }
  if (path === '/new') return viewNew();
  if (path === '/import') return viewImport();
  if (path === '/workbench') return viewWorkbench();
  if (path === '/providers') return viewProviders();
  if (path === '/purposes') return viewPurposes();
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
  // The platform's name lives on the server (PLATFORM_NAME); the static pages carry it too, so keep them in step.
  if (L.cfg.platform) {
    document.title = L.cfg.platform;
    document.querySelectorAll('[data-platform]').forEach((el) => { el.textContent = L.cfg.platform; });
  }
  window.addEventListener('hashchange', route);
  route();
}
boot().catch((err) => { console.error(err); $lab.innerHTML = `<p class="k-small">${L.cfg?.platform || 'Kestrel Lab'} could not start: ${esc(err.message)}</p>`; });
