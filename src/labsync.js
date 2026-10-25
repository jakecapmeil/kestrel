// Kestrel Lab <-> GitHub and Hugging Face. A Kestrel model is a JSON file of numbers, so moving one is moving two files:
// kestrel.json and README.md. Nothing fetched here is ever run; imports go through validateModel like an upload.
//
// The Worker builds every URL itself from a parsed owner/repo, so a user cannot point it at another host:
//   GitHub:       GET/PUT https://api.github.com/repos/{owner}/{repo}/contents/{path}
//   Hugging Face: GET    https://huggingface.co/{owner}/{repo}/resolve/{rev}/{path}   (follows a redirect to the CDN)
//                 POST   https://huggingface.co/api/repos/create
//                 POST   https://huggingface.co/api/models/{owner}/{repo}/commit/{rev}   (application/x-ndjson)
// The Hugging Face shapes were checked against https://huggingface.co/.well-known/openapi.json.
// Tokens come in the request, are used once and are never stored or logged.

import { ModelError, validateModel, MAX_MODEL_BYTES } from './models.js';

const UA = 'Kestrel-Lab (https://github.com/jakecapmeil/kestrel)';
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const REF = /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,99}$/;
const FILE = /^(?!\/)(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9._\/ -]{1,200}$/;
const HOSTS = { 'github.com': 'github', 'www.github.com': 'github', 'huggingface.co': 'huggingface', 'hf.co': 'huggingface' };
export const SOURCES = ['github', 'huggingface'];

export class SyncError extends ModelError {}

const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');

// "owner/name", "owner/name@ref", "owner/name@ref:dir/file.json" or a repo / tree / blob URL on either site.
// Returns { source, repo, ref, dir, file } where dir is a folder ('' for the repo root) and file is a given .json path or ''.
export function parseSource(input, source) {
  let text = String(input || '').trim();
  let ref = '';
  let path = '';
  if (/^https?:\/\//i.test(text)) {
    let u;
    try { u = new URL(text); } catch { throw new SyncError('That is not a valid link.'); }
    const found = HOSTS[u.hostname.toLowerCase()];
    if (!found) throw new SyncError('Only github.com and huggingface.co links work here.');
    source = found;
    const parts = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (parts.length < 2) throw new SyncError('Give a repository, like owner/name.');
    text = `${parts[0]}/${parts[1]}`;
    if ((parts[2] === 'tree' || parts[2] === 'blob') && parts[3]) { ref = parts[3]; path = parts.slice(4).join('/'); }
  } else {
    const m = text.match(/^([^@:]+)(?:@([^:]+))?(?::(.+))?$/);
    if (!m) throw new SyncError('Use owner/name, optionally owner/name@branch.');
    text = m[1]; ref = m[2] || ''; path = m[3] || '';
  }
  if (!SOURCES.includes(source)) throw new SyncError('Choose GitHub or Hugging Face.');
  const [owner, name, extra] = text.split('/');
  if (extra !== undefined || !owner || !name || !NAME.test(owner) || !NAME.test(name)) throw new SyncError('Use owner/name, like jakecapmeil/kestrel.');
  if (ref && !REF.test(ref)) throw new SyncError('That branch or tag name is not valid.');
  if (path && !FILE.test(path)) throw new SyncError('That path is not valid.');
  let dir = path;
  let file = '';
  if (/\.json$/i.test(path)) { file = path; dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''; }
  return { source, repo: `${owner}/${name}`, ref, dir: dir.replace(/\/$/, ''), file };
}

const sourceUrl = (s, path) => (s.source === 'github'
  ? `https://github.com/${s.repo}/blob/${s.ref || 'HEAD'}/${encPath(path)}`
  : `https://huggingface.co/${s.repo}/blob/${s.ref || 'main'}/${encPath(path)}`);

async function readCapped(res, max) {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > max) { reader.cancel().catch(() => {}); throw new SyncError('That file is over 1 MB, the size limit for Kestrel models.'); }
    chunks.push(value);
  }
  const all = new Uint8Array(n);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.length; }
  return new TextDecoder().decode(all);
}

// One file from a repo, or null when it is not there.
async function getFile(s, path, token) {
  const headers = { 'User-Agent': UA };
  if (token) headers.Authorization = `Bearer ${token}`;
  let url;
  if (s.source === 'github') {
    url = `https://api.github.com/repos/${s.repo}/contents/${encPath(path)}${s.ref ? `?ref=${encodeURIComponent(s.ref)}` : ''}`;
    headers.Accept = 'application/vnd.github.raw+json';
    headers['X-GitHub-Api-Version'] = '2022-11-28';
  } else {
    url = `https://huggingface.co/${s.repo}/resolve/${encodeURIComponent(s.ref || 'main')}/${encPath(path)}`;
  }
  const res = await fetch(url, { headers, redirect: 'follow' });
  if (res.status === 404) return null;
  if (res.status === 401 || res.status === 403) {
    const limited = s.source === 'github' && res.headers.get('x-ratelimit-remaining') === '0';
    throw new SyncError(limited ? 'GitHub is limiting requests right now. Add a token or try again later.' : `${s.source === 'github' ? 'GitHub' : 'Hugging Face'} would not show that repository. If it is private${s.source === 'huggingface' ? ' or gated' : ''}, add an access token.`);
  }
  if (!res.ok) throw new SyncError(`${s.source === 'github' ? 'GitHub' : 'Hugging Face'} answered ${res.status}.`);
  return readCapped(res, MAX_MODEL_BYTES + 20000);
}

// Flat YAML front matter, the part of a Hugging Face model card Kestrel reads: key: value and key: then "- item" lines.
export function splitFrontMatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/.exec(String(text || ''));
  if (!m) return { meta: {}, body: String(text || '') };
  const meta = {};
  let key = null;
  const unq = (v) => v.trim().replace(/^(['"])(.*)\1$/, '$2');
  for (const line of m[1].split(/\r?\n/)) {
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && key) { (meta[key] = Array.isArray(meta[key]) ? meta[key] : []).push(unq(item[1])); continue; }
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    key = kv[1];
    meta[key] = kv[2] ? unq(kv[2]) : [];
  }
  return { meta, body: m[2] };
}
const first = (v) => (Array.isArray(v) ? v[0] : v) || '';

// Reads kestrel.json (+ README.md) and returns what the Lab would publish, without storing anything.
export async function importModel({ source, repo, token = '' }) {
  const s = parseSource(repo, source);
  const modelPath = s.file || (s.dir ? `${s.dir}/kestrel.json` : 'kestrel.json');
  const readmePath = (modelPath.includes('/') ? modelPath.slice(0, modelPath.lastIndexOf('/') + 1) : '') + 'README.md';
  const text = await getFile(s, modelPath, token);
  if (text === null) {
    throw new SyncError(`No ${modelPath} in ${s.repo}${s.ref ? ` on ${s.ref}` : ''}. A Kestrel model repo has a kestrel.json at its root (or give owner/name@branch:path/to/file.json).`);
  }
  let file;
  try { file = JSON.parse(text); } catch { throw new SyncError(`${modelPath} is not valid JSON.`); }
  const card = await getFile(s, readmePath, token).catch(() => null);
  const { meta, body } = splitFrontMatter(card || '');
  if (file && typeof file === 'object' && !file.license && meta.license) file.license = String(first(meta.license)).slice(0, 60);
  const model = validateModel(file);
  const base = String(first(meta.base_model)).slice(0, 80);
  return {
    model, readme: body.trim().slice(0, 20000), base_model: base, source_url: sourceUrl(s, modelPath),
    source: s.source, repo: s.repo, ref: s.ref, files: { model: modelPath, readme: card === null ? null : readmePath },
  };
}

// ---------- export

export function modelFile(m) {
  return { kestrel: 1, name: m.name, version: m.version || '', kind: m.kind, task: m.task, license: m.license || '', description: m.description || '', trained_on: m.trained_on || '', weights: m.weights };
}

const HF_LICENSES = new Set(['apache-2.0', 'mit', 'cc0-1.0', 'cc-by-4.0', 'cc-by-sa-4.0', 'cc-by-nc-4.0', 'cc-by-nc-sa-4.0', 'cc-by-nd-4.0', 'cc-by-3.0', 'cc-by-sa-3.0', 'odc-by', 'odbl', 'pddl', 'unlicense', 'bsd-2-clause', 'bsd-3-clause', 'gpl-3.0', 'lgpl-3.0', 'agpl-3.0', 'mpl-2.0', 'isc']);
export function hfLicense(license) {
  const id = String(license || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (!id) return {};
  return HF_LICENSES.has(id) ? { license: id } : { license: 'other', license_name: String(license).trim().slice(0, 60) };
}

export function buildReadme(m, readme, { huggingface = false, origin = '' } = {}) {
  const body = (readme || '').trim() || `# ${m.name}\n\n${m.description || 'A Kestrel running model.'}`;
  const tail = `\n\n---\nA [Kestrel Lab](${origin || 'https://kestrel.jakecapmeil.workers.dev'}/lab) model: ${m.kind}, for ${m.task}. The weights are numbers, never code. Import it into Kestrel from this repository.\n`;
  if (!huggingface) return body + tail;
  const lic = hfLicense(m.license);
  const lines = ['---'];
  if (lic.license) lines.push(`license: ${lic.license}`);
  if (lic.license_name) lines.push(`license_name: ${JSON.stringify(lic.license_name)}`);
  lines.push('tags:', '  - kestrel', '  - running', `  - ${m.task}`, '---', '');
  return lines.join('\n') + body + tail;
}

const b64 = (text) => {
  const bytes = new TextEncoder().encode(text);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

async function githubPut(s, path, content, message, token) {
  const base = `https://api.github.com/repos/${s.repo}/contents/${encPath(path)}`;
  const headers = { 'User-Agent': UA, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', Authorization: `Bearer ${token}` };
  const cur = await fetch(base + (s.ref ? `?ref=${encodeURIComponent(s.ref)}` : ''), { headers });
  if (cur.status === 401 || cur.status === 403) throw new SyncError('GitHub refused that token. It needs write access to the repository (Contents: read and write).');
  if (cur.status !== 200 && cur.status !== 404) throw new SyncError(`GitHub answered ${cur.status}. Check the repository name.`);
  const sha = cur.status === 200 ? (await cur.json()).sha : undefined;
  const res = await fetch(base, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ message, content: b64(content), ...(sha ? { sha } : {}), ...(s.ref ? { branch: s.ref } : {}) }) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new SyncError(`GitHub: ${out.message || res.status}`);
  return out.content?.html_url || `https://github.com/${s.repo}`;
}

// The two files go one after the other: GitHub's docs say parallel writes to one repo conflict.
export async function exportToGithub({ repo, token, model, readme, message, origin }) {
  const s = parseSource(repo, 'github');
  if (!token) throw new SyncError('Pushing to GitHub needs an access token with write access.');
  const dir = s.dir ? `${s.dir}/` : '';
  const msg = message || `Kestrel Lab: ${model.name} ${model.version || ''}`.trim();
  const url = await githubPut(s, `${dir}kestrel.json`, JSON.stringify(modelFile(model), null, 2) + '\n', msg, token);
  await githubPut(s, `${dir}README.md`, buildReadme(model, readme, { origin }), msg, token);
  return { url: s.dir ? url : `https://github.com/${s.repo}`, repo: s.repo };
}

export async function exportToHuggingface({ repo, token, model, readme, message, visibility, origin }) {
  const s = parseSource(repo, 'huggingface');
  if (!token) throw new SyncError('Pushing to Hugging Face needs an access token with write permission.');
  const [owner, name] = s.repo.split('/');
  const headers = { 'User-Agent': UA, Authorization: `Bearer ${token}` };
  const made = await fetch('https://huggingface.co/api/repos/create', {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'model', name, organization: owner, private: visibility === 'private' }),
  });
  if (made.status === 401 || made.status === 403) throw new SyncError('Hugging Face refused that token. It needs write permission for that namespace.');
  if (!made.ok && made.status !== 409) throw new SyncError(`Hugging Face answered ${made.status} creating the repository.`);
  const dir = s.dir ? `${s.dir}/` : '';
  const line = (key, value) => JSON.stringify({ key, value });
  const body = [
    line('header', { summary: message || `Kestrel Lab: ${model.name} ${model.version || ''}`.trim() }),
    line('file', { path: `${dir}kestrel.json`, content: JSON.stringify(modelFile(model), null, 2) + '\n', encoding: 'utf-8' }),
    line('file', { path: `${dir}README.md`, content: buildReadme(model, readme, { huggingface: true, origin }), encoding: 'utf-8' }),
  ].join('\n');
  const res = await fetch(`https://huggingface.co/api/models/${owner}/${name}/commit/${encodeURIComponent(s.ref || 'main')}`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/x-ndjson' }, body,
  });
  if (!res.ok) {
    const out = await res.json().catch(() => ({}));
    throw new SyncError(`Hugging Face: ${out.error || res.status}`);
  }
  return { url: `https://huggingface.co/${s.repo}`, repo: s.repo };
}
