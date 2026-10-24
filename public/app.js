// Kestrel web app. One page; tabs are #team, #training, #races, #models, #coach, #profile.
// Sign-in is Supabase (Google, or email + password with a confirmation email). Every API call sends the Supabase access token.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import * as AI from '/ai.js';

const REPO_URL = 'https://github.com/jakecapmeil/kestrel';
const SOURCE_URL = `${REPO_URL}/blob/main`;
const $app = document.getElementById('app');
const S = { cfg: null, sb: null, session: null, me: null, teamId: null, tab: 'team', ai: AI.loadAi(), aiCtx: null, showPast: false, modelTask: 'race' };

// ---------- small helpers ----------

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
let fieldN = 0;
// Ties each <label> to the field after it, so screen readers announce it.
function linkLabels(root) {
  root.querySelectorAll('label:not([for])').forEach((l) => {
    const next = l.nextElementSibling;
    const field = next?.matches('input,select,textarea') ? next : next?.querySelector?.('input,select,textarea');
    if (!field || l.querySelector('input')) return;
    field.id ||= `f${++fieldN}`;
    l.htmlFor = field.id;
  });
}
const render = (r, { wide = false } = {}) => { $app.classList.toggle('wide', wide); $app.innerHTML = r.s; linkLabels($app); };

// Red-pen marks over the printed layout (styles in style.css).
const HAND = {
  under: '<svg class="hand-under" viewBox="0 0 260 14" preserveAspectRatio="none" aria-hidden="true"><path d="M3 8 C 48 3, 112 11, 170 6 S 236 6, 257 4"/><path d="M14 11 C 80 8, 150 12, 250 8"/></svg>',
  circle: '<svg class="hand-circle" viewBox="0 0 200 60" preserveAspectRatio="none" aria-hidden="true"><path d="M34 9 C 86 0, 172 3, 193 23 C 206 41, 150 57, 94 56 C 38 55, 3 45, 6 29 C 9 14, 52 5, 124 8"/></svg>',
  arrow: '<svg class="hand-arrow" viewBox="0 0 70 40" aria-hidden="true"><path d="M4 33 C 18 15, 38 8, 62 12"/><path d="M51 4 L63 12 L52 21"/></svg>',
};
// A page title with a hand-drawn underline.
const title = (text) => html`<h1 class="title"><span class="u">${text}${raw(HAND.under)}</span></h1>`;
const circled = (inner) => html`<span class="circled">${inner}${raw(HAND.circle)}</span>`;
// A margin note in red pen, optionally with an arrow pointing left (flip: right).
const note = (text, { arrow = false, flip = false } = {}) => html`<span class="note${flip ? ' flip' : ''}">${arrow && !flip ? raw(HAND.arrow) : ''}${text}${arrow && flip ? raw(HAND.arrow) : ''}</span>`;
const store = {
  get: (k, d = null) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch { /* private mode */ } },
};
let toastTimer;
function toast(msg, bad = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (bad ? ' bad' : '');
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, bad ? 6000 : 3000);
}
const initials = (name) => (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
const dot = (u) => html`<span class="dot" style="background:${u.color}" title="${u.name}">${initials(u.name)}</span>`;
const todayStr = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const niceDate = (d, opts = { weekday: 'short', month: 'short', day: 'numeric' }) => new Date(d + 'T12:00:00Z').toLocaleDateString(undefined, { ...opts, timeZone: 'UTC' });
const weekStart = (d) => addDays(d, -((new Date(d + 'T12:00:00Z').getUTCDay() + 6) % 7));
const evLabel = (k) => S.cfg.events.find((e) => e.key === k)?.label || k;
const form = (el) => Object.fromEntries(new FormData(el).entries());

async function api(path, opts = {}) {
  const { data } = await S.sb.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) } });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(out.error || `Request failed (${res.status})`);
    err.auth = out.auth;
    throw err;
  }
  return out;
}
async function attempt(fn, btn) {
  if (btn) btn.disabled = true;
  try {
    return await fn();
  } catch (err) {
    toast(err.message, true);
    if (err.auth) { await S.sb.auth.signOut(); }
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ---------- boot ----------

async function boot() {
  const m = location.pathname.match(/^\/join\/([A-Za-z0-9-]{4,20})/);
  if (m) { store.set('kestrel.join', m[1].toUpperCase()); history.replaceState(null, '', '/#team'); }
  S.cfg = await fetch('/api/config').then((r) => r.json());
  if (!S.cfg.supabaseUrl || !S.cfg.supabaseKey) {
    render(html`<div class="landing">${landingHero()}<div class="auth"><h2>Almost ready</h2><p class="muted">Sign-in isn't connected on this server yet (SUPABASE_URL and SUPABASE_KEY in wrangler.jsonc).</p></div></div>`, { wide: true });
    return;
  }
  // A password-reset link lands on /?reset=1: show only the new-password form until it is saved.
  const params = new URLSearchParams(location.search);
  S.recovering = params.has('reset');
  const fromLink = params.has('code');
  S.sb = createClient(S.cfg.supabaseUrl, S.cfg.supabaseKey, { auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true } });
  S.sb.auth.onAuthStateChange((event, session) => {
    const had = !!S.session;
    S.session = session;
    if (S.recovering || event === 'PASSWORD_RECOVERY') { if (session) renderNewPassword(); return; }
    if (event === 'SIGNED_OUT') { S.me = null; showChrome(false); renderLanding(); return; }
    if (session && !had) setTimeout(afterSignIn, 0);
  });
  const { data } = await S.sb.auth.getSession();
  if (location.search.includes('code=') || location.search.includes('error')) {
    const err = new URLSearchParams(location.search).get('error_description');
    history.replaceState(null, '', '/' + (location.hash || '#team'));
    if (err) toast(err, true);
  }
  window.addEventListener('hashchange', route);
  if (S.recovering) {
    if (data.session) renderNewPassword();
    else renderLanding('signin', 'That reset link has expired or was opened in another browser. Ask for a new one.');
    return;
  }
  if (data.session) { S.session = data.session; await afterSignIn(); }
  // A confirmation link opened in a different browser confirms the email but cannot sign in here.
  else renderLanding('signin', fromLink ? 'Your email is confirmed. Sign in to continue.' : '');
}

// Supabase reports a session both from getSession and from its auth event; only the first call does the work.
let signingIn = null;
function afterSignIn() {
  if (!signingIn) signingIn = signIn().finally(() => { signingIn = null; });
  return signingIn;
}
async function signIn() {
  if (S.me) return;
  const me = await attempt(() => api('/api/me'));
  if (!me) { renderLanding(); return; }
  S.me = me;
  if (!me.user.age_ok) { renderOnboarding(); return; }
  await finishSetup();
}

async function finishSetup() {
  const code = store.get('kestrel.join');
  if (code) {
    store.del('kestrel.join');
    const r = await attempt(() => api('/api/teams/join', { method: 'POST', body: JSON.stringify({ code }) }));
    if (r) { S.teamId = r.id; await refreshMe(); toast('You joined the team.'); }
  }
  pickTeam();
  showChrome(true);
  route();
}

// The team on screen: the current one if still a member, else the last one picked on this device, else the first.
function pickTeam() {
  const saved = store.get('kestrel.team');
  const ids = S.me.teams.map((t) => t.id);
  if (!ids.includes(S.teamId)) S.teamId = ids.includes(saved) ? saved : ids[0] || null;
}

async function refreshMe() {
  S.me = await api('/api/me');
  pickTeam();
  updateWho();
}

function showChrome(on) {
  document.getElementById('tabs').hidden = !on;
  document.getElementById('who').hidden = !on;
  if (on) updateWho();
}
function updateWho() {
  const w = document.getElementById('who');
  if (!S.me) return;
  w.innerHTML = html`${dot(S.me.user)}<span>${S.me.user.name || 'Profile'}</span>`.s;
  w.onclick = () => { location.hash = '#profile'; };
}

function route() {
  if (!S.me || !S.me.user.age_ok) return;
  S.tab = (location.hash || '#team').slice(1).split('/')[0] || 'team';
  document.querySelectorAll('#tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === S.tab));
  window.scrollTo(0, 0);
  const views = { team: viewTeam, training: viewTraining, races: viewRaces, models: viewModels, coach: viewCoach, profile: viewProfile };
  (views[S.tab] || viewTeam)();
}

// ---------- signed out ----------

function landingHero() {
  return html`<div class="hero">
    <div class="kicker">Open-source training for school running teams</div>
    <h1 class="display">Train together.<br>Race <span class="u">smarter.${raw(HAND.under)}</span></h1>
    <p class="lede">A shared team calendar, your own training log, race-time predictions from open-weight models, and an AI coach you can power with any model.</p>
    <ol class="points">
      <li><span class="n">01</span><b>Your team</b>Anyone can start a school team and invite teammates with a code.</li>
      <li><span class="n">02</span><b>Open models</b>Download the race-time models, fine-tune them, or upload your own.</li>
      <li><span class="n">03</span><b>Any AI</b>Kestrel's free AI, your own API key, or a model running on your own computer.</li>
    </ol>
  </div>`;
}

function renderLanding(mode = 'signin', message = '') {
  showChrome(false);
  const signup = mode === 'signup';
  render(html`<div class="landing">${landingHero()}
  <div class="auth">
    ${note('free & open source')}
    <h2>${signup ? 'Create your account' : 'Sign in'}</h2>
    <button class="wide" id="google"><svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.4-4.1 7-10.1 7-17.6z"/><path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>Continue with Google</button>
    <div class="or">or with email</div>
    <form id="emailForm">
      <div class="field"><label for="em">Email</label><input id="em" name="email" type="email" autocomplete="email" required></div>
      <div class="field"><label for="pw">Password</label><input id="pw" name="password" type="password" minlength="8" autocomplete="${signup ? 'new-password' : 'current-password'}" required></div>
      ${signup ? html`<p class="muted small">We'll email you a link to confirm your address before you can sign in.</p>` : ''}
      ${message ? html`<p class="small" style="color:var(--good)">${message}</p>` : ''}
      <button class="primary wide" type="submit">${signup ? 'Create account' : 'Sign in'}</button>
    </form>
    <div class="row spread" style="margin-top:10px">
      <button class="ghost" id="swap">${signup ? 'Have an account? Sign in' : 'New here? Create an account'}</button>
      ${signup ? '' : html`<button class="ghost" id="forgot">Forgot password?</button>`}
    </div>
    <p class="muted small" style="margin-top:10px">Kestrel is open source: <a href="${REPO_URL}" target="_blank" rel="noopener">read the code</a>.</p>
  </div></div>`, { wide: true });
  document.getElementById('google').onclick = (e) => attempt(async () => {
    const { error } = await S.sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + '/' } });
    if (error) throw error;
  }, e.currentTarget);
  document.getElementById('swap').onclick = () => renderLanding(signup ? 'signin' : 'signup');
  const forgot = document.getElementById('forgot');
  if (forgot) forgot.onclick = () => attempt(async () => {
    const email = document.getElementById('em').value.trim();
    if (!email) throw new Error('Type your email first.');
    const { error } = await S.sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + '/?reset=1' });
    if (error) throw error;
    renderLanding('signin', 'Check your email for a link to set a new password.');
  });
  document.getElementById('emailForm').onsubmit = (e) => {
    e.preventDefault();
    const f = form(e.target);
    attempt(async () => {
      if (signup) {
        const { data, error } = await S.sb.auth.signUp({ email: f.email, password: f.password, options: { emailRedirectTo: location.origin + '/' } });
        if (error) throw error;
        if (!data.session) renderLanding('signin', `Check ${f.email} for a confirmation link, then sign in.`);
      } else {
        const { error } = await S.sb.auth.signInWithPassword({ email: f.email, password: f.password });
        if (error) throw new Error(/confirm/i.test(error.message) ? 'Confirm your email first: open the link we sent you.' : error.message);
      }
    }, e.submitter);
  };
}

function renderNewPassword() {
  showChrome(false);
  render(html`<div class="auth" style="max-width:440px"><h2>Set a new password</h2>
    <form id="np"><div class="field"><label for="np1">New password</label><input id="np1" name="password" type="password" minlength="8" autocomplete="new-password" required></div>
    <button class="primary wide">Save password</button></form></div>`);
  document.getElementById('np').onsubmit = (e) => {
    e.preventDefault();
    attempt(async () => {
      const { error } = await S.sb.auth.updateUser({ password: form(e.target).password });
      if (error) throw error;
      toast('Password saved.');
      S.recovering = false;
      S.me = null;
      await afterSignIn();
    }, e.submitter);
  };
}

function renderOnboarding() {
  showChrome(false);
  const u = S.me.user;
  render(html`<div class="auth" style="max-width:480px;margin-top:12px"><h2>Welcome to Kestrel</h2><p class="muted">A couple of things before you start.</p>
    <form id="ob">
      <div class="field"><label for="obn">Your name (teammates see this)</label><input id="obn" name="name" value="${u.name}" maxlength="60" required></div>
      <div class="field"><label for="obs">Race-time models use sex if you give it (optional)</label>
        <select id="obs" name="sex"><option value="">Prefer not to say</option><option value="f">Female</option><option value="m">Male</option></select></div>
      <label class="check field"><input type="checkbox" name="age" required><span>I am 13 or older. (If you are under 18, check with a parent or guardian that it's OK to use Kestrel.)</span></label>
      <p class="muted small">Teammates see your name only. Your training log, PRs and predictions are private to you.</p>
      <button class="primary wide">Continue</button>
    </form></div>`);
  document.getElementById('ob').onsubmit = (e) => {
    e.preventDefault();
    const f = form(e.target);
    attempt(async () => {
      S.me = await api('/api/me', { method: 'PUT', body: JSON.stringify({ name: f.name, sex: f.sex, age_ok: !!f.age }) });
      await finishSetup();
    }, e.submitter);
  };
}

// ---------- team ----------

function teamStartCards() {
  return html`<section class="card"><h2>Start a team</h2><p class="muted small">Anyone can make a team for their school. You'll get an invite code to share.</p>
    <form id="newTeam"><div class="fields"><div><label for="tn">Team name</label><input id="tn" name="name" placeholder="Varsity Cross Country" maxlength="80" required></div>
    <div><label for="ts">School</label><input id="ts" name="school" placeholder="Lincoln High School" maxlength="120"></div></div>
    <button class="primary" style="margin-top:10px">Create team</button></form></section>
  <section class="card"><h2>Join a team</h2><p class="muted small">Ask a teammate for the invite code or link.</p>
    <form id="joinTeam" class="row"><input name="code" placeholder="Invite code" class="grow mono" style="text-transform:uppercase" maxlength="20" required><button class="primary">Join</button></form></section>`;
}
function wireTeamStart() {
  document.getElementById('newTeam').onsubmit = (e) => {
    e.preventDefault();
    attempt(async () => {
      const r = await api('/api/teams', { method: 'POST', body: JSON.stringify(form(e.target)) });
      S.teamId = r.id;
      store.set('kestrel.team', r.id);
      await refreshMe();
      toast('Team created. Share the invite code with your teammates.');
      viewTeam();
    }, e.submitter);
  };
  document.getElementById('joinTeam').onsubmit = (e) => {
    e.preventDefault();
    attempt(async () => {
      const r = await api('/api/teams/join', { method: 'POST', body: JSON.stringify(form(e.target)) });
      S.teamId = r.id;
      store.set('kestrel.team', r.id);
      await refreshMe();
      toast('You joined the team.');
      viewTeam();
    }, e.submitter);
  };
}

async function viewTeam(opts = {}) {
  if (!S.me.teams.length || opts.adding) {
    render(html`${S.me.teams.length ? html`<button class="ghost" id="back">← Back to my team</button>` : html`${title('Your team')}<p class="lede" style="margin-bottom:22px">Kestrel works around a team calendar. Start one or join yours.</p>`}${teamStartCards()}`);
    wireTeamStart();
    const back = document.getElementById('back');
    if (back) back.onclick = () => viewTeam();
    return;
  }
  const today = todayStr();
  const from = S.showPast ? addDays(today, -60) : today;
  const [team, ev, posts] = await Promise.all([
    attempt(() => api(`/api/teams/${S.teamId}`)),
    attempt(() => api(`/api/teams/${S.teamId}/events?from=${from}&to=${addDays(today, 120)}`)),
    attempt(() => api(`/api/teams/${S.teamId}/posts`)),
  ]);
  if (!team) {
    // The team is gone (left, removed or deleted): reload the list once, then show what is left.
    if (opts.retried) return;
    S.teamId = null;
    await refreshMe();
    return viewTeam({ retried: true });
  }
  const byId = new Map(team.members.map((m) => [m.id, m]));
  const owner = team.role === 'owner';
  const meId = S.me.user.id;
  const link = `${location.origin}/join/${team.invite_code}`;
  const days = new Map();
  for (const e of ev?.events || []) (days.get(e.date) || days.set(e.date, []).get(e.date)).push(e);

  render(html`
  <div class="kicker">${team.school || 'Team'}</div>
  <div class="title-row">
    ${title(team.name)}
    <div class="row" style="margin-bottom:22px">
      ${S.me.teams.length > 1 ? html`<select id="teamPick" aria-label="Switch team" style="width:auto;max-width:220px">${S.me.teams.map((t) => html`<option value="${t.id}" ${t.id === S.teamId ? raw('selected') : ''}>${t.name}</option>`)}</select>` : ''}
      <button class="small" id="addTeam">+ Team</button>
    </div>
  </div>

  <section class="card">
    <div class="row spread"><h2>Calendar</h2><button class="small primary" id="addEvent">+ Event</button></div>
    <form id="eventForm" hidden class="stack" style="margin:10px 0 4px">
      <input type="hidden" name="id">
      <div class="fields">
        <div><label>Date</label><input type="date" name="date" value="${today}" required></div>
        <div><label>Type</label><select name="type"><option value="practice">Practice</option><option value="meet">Meet</option><option value="other">Other</option></select></div>
        <div><label>Time</label><input name="time" placeholder="3:30 pm" maxlength="40"></div>
      </div>
      <div><label>Title</label><input name="title" placeholder="Tempo run / Borough Championships" maxlength="120" required></div>
      <div><label>Where</label><input name="location" placeholder="Track, park, meet address" maxlength="160"></div>
      <div><label>Details</label><textarea name="description" maxlength="2000" placeholder="Workout, bus time, what to bring"></textarea></div>
      <div class="row"><button class="primary">Save event</button><button type="button" id="cancelEvent">Cancel</button><button type="button" class="danger" id="delEvent" hidden>Delete</button></div>
    </form>
    ${days.size ? [...days.entries()].map(([d, list]) => html`
      <div class="day-head">${niceDate(d)}${d === today ? note('today', { arrow: true }) : ''}</div>
      <ul class="list">${list.map((e) => {
        const mine = e.rsvps.find((r) => r.user_id === meId)?.status;
        const going = e.rsvps.filter((r) => r.status === 'going').map((r) => byId.get(r.user_id)).filter(Boolean);
        const canEdit = e.created_by === meId || owner;
        return html`<li class="event" data-id="${e.id}">
          <div><b>${e.title}</b> <span class="chip ${e.type === 'meet' ? 'accent' : ''}">${e.type}</span>
            <div class="meta">${[e.time, e.location].filter(Boolean).join(' · ')}</div>
            ${e.description ? html`<div class="small" style="white-space:pre-wrap;margin-top:4px">${e.description}</div>` : ''}
            ${going.length ? html`<div class="going">${going.map(dot)}<span class="muted small" style="margin-left:4px">${going.length} going</span></div>` : ''}
          </div>
          <div class="row rsvp" style="justify-content:flex-end;align-content:flex-start">
            <button class="small ${mine === 'going' ? 'on' : ''}" data-rsvp="going" aria-pressed="${mine === 'going'}">Going</button>
            <button class="small ${mine === 'not_going' ? 'on' : ''}" data-rsvp="not_going" aria-pressed="${mine === 'not_going'}">Can't</button>
            ${canEdit ? html`<button class="small ghost" data-edit>Edit</button>` : ''}
          </div></li>`;
      })}</ul>`) : html`<p class="muted" style="margin-top:14px">Nothing on the calendar${S.showPast ? '' : ' coming up'}. ${note('add practices & meets with + Event')}</p>`}
    <button class="ghost small" id="past" style="margin-top:8px">${S.showPast ? 'Hide past events' : 'Show past events'}</button>
  </section>

  <section class="card">
    <h2>Team posts</h2>
    <form id="postForm" class="row" style="margin:8px 0 4px"><textarea name="body" class="grow" placeholder="Share an update with the team" maxlength="2000" required></textarea><button class="primary">Post</button></form>
    <ul class="list">${(posts?.posts || []).map((p) => {
      const a = byId.get(p.user_id) || { name: 'Former member', color: '#999' };
      return html`<li><div class="row">${dot(a)}<b class="small">${a.name}</b><span class="muted small">${new Date(p.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
        ${p.user_id === meId || owner ? html`<button class="ghost small danger" data-delpost="${p.id}" style="margin-left:auto">Delete</button>` : ''}</div>
        <div style="white-space:pre-wrap;margin-top:6px">${p.body}</div></li>`;
    })}</ul>
  </section>

  <section class="card">
    <h2>Team</h2>
    <p class="muted small">Invite teammates with this code or link. Anyone with it can join, so share it only with your team.</p>
    <div class="row" style="margin:16px 0 18px;gap:22px">${circled(html`<span class="invite">${team.invite_code}</span>`)}
      <button class="small" id="copyLink">Copy invite link</button>${owner ? html`<button class="small ghost" id="newCode">New code</button>` : ''}</div>
    <ul class="list">${team.members.map((m) => html`<li class="row">${dot(m)}<span class="grow">${m.name || 'Unnamed'}${m.id === meId ? ' (you)' : ''}</span>
      ${m.role === 'owner' ? html`<span class="chip">owner</span>` : ''}
      ${owner && m.id !== meId ? html`<button class="ghost small danger" data-remove="${m.id}">Remove</button>` : ''}</li>`)}</ul>
    <div class="row" style="margin-top:10px">
      ${owner ? html`<button class="small" id="renameTeam">Rename team</button>` : ''}
      <button class="small danger" id="leave">Leave team</button>
    </div>
  </section>`);

  const pick = document.getElementById('teamPick');
  if (pick) pick.onchange = () => { S.teamId = pick.value; store.set('kestrel.team', S.teamId); viewTeam(); };
  document.getElementById('addTeam').onclick = () => viewTeam({ adding: true });
  document.getElementById('past').onclick = () => { S.showPast = !S.showPast; viewTeam(); };
  const ef = document.getElementById('eventForm');
  const openForm = (e) => {
    ef.hidden = false;
    ef.reset();
    ef.elements.id.value = e?.id || '';
    if (e) for (const k of ['date', 'type', 'time', 'title', 'location', 'description']) ef.elements[k].value = e[k] || '';
    const del = ef.querySelector('#delEvent');
    del.hidden = !e;
    del.onclick = () => attempt(async () => { if (!confirm('Delete this event?')) return; await api(`/api/teams/${S.teamId}/events/${e.id}`, { method: 'DELETE' }); viewTeam(); }, del);
    ef.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  document.getElementById('addEvent').onclick = () => openForm(null);
  document.getElementById('cancelEvent').onclick = () => { ef.hidden = true; };
  ef.onsubmit = (e) => {
    e.preventDefault();
    const f = form(ef);
    attempt(async () => {
      if (f.id) await api(`/api/teams/${S.teamId}/events/${f.id}`, { method: 'PUT', body: JSON.stringify(f) });
      else await api(`/api/teams/${S.teamId}/events`, { method: 'POST', body: JSON.stringify(f) });
      S.aiCtx = null;
      viewTeam();
    }, e.submitter);
  };
  $app.querySelectorAll('li.event').forEach((li) => {
    const e = ev.events.find((x) => x.id === li.dataset.id);
    li.querySelectorAll('[data-rsvp]').forEach((b) => {
      b.onclick = () => attempt(async () => {
        const mine = e.rsvps.find((r) => r.user_id === meId)?.status;
        await api(`/api/teams/${S.teamId}/events/${e.id}/rsvp`, { method: 'PUT', body: JSON.stringify({ status: mine === b.dataset.rsvp ? null : b.dataset.rsvp }) });
        viewTeam();
      }, b);
    });
    const edit = li.querySelector('[data-edit]');
    if (edit) edit.onclick = () => openForm(e);
  });
  document.getElementById('postForm').onsubmit = (e) => {
    e.preventDefault();
    attempt(async () => { await api(`/api/teams/${S.teamId}/posts`, { method: 'POST', body: JSON.stringify(form(e.target)) }); viewTeam(); }, e.submitter);
  };
  $app.querySelectorAll('[data-delpost]').forEach((b) => {
    b.onclick = () => attempt(async () => { if (!confirm('Delete this post?')) return; await api(`/api/teams/${S.teamId}/posts/${b.dataset.delpost}`, { method: 'DELETE' }); viewTeam(); }, b);
  });
  document.getElementById('copyLink').onclick = async () => {
    try { await navigator.clipboard.writeText(link); toast('Invite link copied.'); } catch { prompt('Copy this invite link:', link); }
  };
  const nc = document.getElementById('newCode');
  if (nc) nc.onclick = () => attempt(async () => { if (!confirm('Make a new invite code? The old code and link stop working.')) return; await api(`/api/teams/${S.teamId}/code`, { method: 'POST' }); viewTeam(); }, nc);
  const rn = document.getElementById('renameTeam');
  if (rn) rn.onclick = () => attempt(async () => {
    const name = prompt('Team name', team.name);
    if (!name) return;
    const school = prompt('School', team.school) ?? team.school;
    await api(`/api/teams/${S.teamId}`, { method: 'PUT', body: JSON.stringify({ name, school }) });
    await refreshMe();
    viewTeam();
  }, rn);
  $app.querySelectorAll('[data-remove]').forEach((b) => {
    b.onclick = () => attempt(async () => {
      if (!confirm(`Remove ${byId.get(b.dataset.remove)?.name || 'this member'} from the team?`)) return;
      await api(`/api/teams/${S.teamId}/members/${b.dataset.remove}`, { method: 'DELETE' });
      viewTeam();
    }, b);
  });
  document.getElementById('leave').onclick = (e) => attempt(async () => {
    if (!confirm(team.members.length === 1 ? 'You are the last member. Leaving deletes the team and its calendar. Leave?' : 'Leave this team?')) return;
    await api(`/api/teams/${S.teamId}/members/${meId}`, { method: 'DELETE' });
    S.teamId = null;
    await refreshMe();
    viewTeam();
  }, e.currentTarget);
}

// ---------- training ----------

async function viewTraining() {
  const today = todayStr();
  const [log, prs] = await Promise.all([attempt(() => api(`/api/log?from=${addDays(today, -112)}&to=${today}`)), attempt(() => api('/api/prs'))]);
  if (!log) return;
  const days = log.days;
  const weeks = new Map();
  for (const d of days) (weeks.get(weekStart(d.date)) || weeks.set(weekStart(d.date), []).get(weekStart(d.date))).push(d);
  const pace = (d) => (d.miles > 0 && d.minutes > 0 ? (() => { const s = Math.round((d.minutes * 60) / d.miles); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}/mi`; })() : '');
  render(html`
  ${title('Training')}
  <section class="card">
    <h2>Log a day</h2>
    <form id="dayForm">
      <div class="fields">
        <div><label>Date</label><input type="date" name="date" value="${today}" max="${today}" required></div>
        <div><label>Type</label><select name="type">${S.cfg.logTypes.map((t) => html`<option value="${t}">${t}</option>`)}</select></div>
        <div><label>Miles</label><input name="miles" type="number" step="0.01" min="0" max="100" inputmode="decimal"></div>
        <div><label>Minutes</label><input name="minutes" type="number" step="0.1" min="0" max="1440" inputmode="decimal"></div>
        <div><label>Feel (1-10)</label><select name="feel"><option value="">–</option>${[10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((n) => html`<option>${n}</option>`)}</select></div>
      </div>
      <div class="field" style="margin-top:10px"><label>Notes</label><textarea name="notes" maxlength="2000" placeholder="Workout, splits, how it went"></textarea></div>
      <div class="row"><button class="primary">Save</button><button type="button" class="danger" id="delDay" hidden>Delete day</button></div>
    </form>
  </section>
  <section class="card">
    <h2>Last 16 weeks</h2>
    ${weeks.size ? [...weeks.entries()].map(([w, list]) => html`
      <div class="day-head">Week of ${niceDate(w, { month: 'short', day: 'numeric' })} · ${Math.round(list.reduce((s, d) => s + d.miles, 0) * 10) / 10} mi</div>
      <ul class="list">${list.map((d) => html`<li class="row" data-date="${d.date}" style="cursor:pointer">
        <span style="width:92px" class="small">${niceDate(d.date)}</span>
        <span class="chip">${d.type}</span>
        <span class="grow small muted" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${d.notes}</span>
        <span class="num small">${d.miles ? d.miles + ' mi' : ''} ${pace(d) ? html`<span class="muted">${pace(d)}</span>` : ''}</span>
        ${d.feel ? html`<span class="chip">${d.feel}/10</span>` : ''}</li>`)}</ul>`)
      : html`<p class="muted">No days logged yet. Log miles and minutes and Kestrel can estimate a marathon from your training; the AI coach reads your log too.</p>${note('start with today ↑')}`}
  </section>
  <section class="card">
    <h2>Personal bests</h2>
    <p class="muted small">Your PRs power your race-time predictions.</p>
    <form id="prForm" class="fields" style="margin:8px 0 12px">
      <div><label>Event</label><select name="event">${S.cfg.events.map((e) => html`<option value="${e.key}">${e.label}</option>`)}</select></div>
      <div><label>Time</label><input name="time" placeholder="5:12.4" required inputmode="decimal"></div>
      <div><label>Date (optional)</label><input type="date" name="date" max="${today}"></div>
      <div style="align-self:end"><button class="primary wide">Save PR</button></div>
    </form>
    <ul class="list">${(prs?.prs || []).map((p) => html`<li class="row"><span class="grow">${evLabel(p.event)}</span><b class="num mono">${p.time}</b>
      <span class="muted small" style="width:84px;text-align:right">${p.date ? niceDate(p.date, { month: 'short', day: 'numeric', year: '2-digit' }) : ''}</span>
      <button class="ghost small danger" data-delpr="${p.event}" aria-label="Delete ${evLabel(p.event)} PR">✕</button></li>`)}</ul>
  </section>`);

  const df = document.getElementById('dayForm');
  const fill = (date) => {
    const d = days.find((x) => x.date === date);
    df.elements.date.value = date;
    for (const k of ['type', 'miles', 'minutes', 'feel', 'notes']) df.elements[k].value = d ? (d[k] ?? '') : (k === 'type' ? 'easy' : '');
    document.getElementById('delDay').hidden = !d;
  };
  df.elements.date.onchange = () => fill(df.elements.date.value);
  fill(today);
  df.onsubmit = (e) => {
    e.preventDefault();
    const f = form(df);
    attempt(async () => {
      await api(`/api/log/${f.date}`, { method: 'PUT', body: JSON.stringify({ ...f, miles: Number(f.miles || 0), minutes: Number(f.minutes || 0) }) });
      S.aiCtx = null;
      toast('Saved.');
      viewTraining();
    }, e.submitter);
  };
  document.getElementById('delDay').onclick = (e) => attempt(async () => {
    await api(`/api/log/${df.elements.date.value}`, { method: 'DELETE' });
    viewTraining();
  }, e.currentTarget);
  $app.querySelectorAll('li[data-date]').forEach((li) => { li.onclick = () => { fill(li.dataset.date); df.scrollIntoView({ behavior: 'smooth' }); }; });
  document.getElementById('prForm').onsubmit = (e) => {
    e.preventDefault();
    attempt(async () => { await api('/api/prs', { method: 'PUT', body: JSON.stringify(form(e.target)) }); S.aiCtx = null; toast('PR saved.'); viewTraining(); }, e.submitter);
  };
  $app.querySelectorAll('[data-delpr]').forEach((b) => {
    b.onclick = () => attempt(async () => { await api(`/api/prs/${b.dataset.delpr}`, { method: 'DELETE' }); viewTraining(); }, b);
  });
}

// ---------- race times ----------

async function viewRaces() {
  const p = await attempt(() => api('/api/predictions'));
  if (!p) return;
  const predicted = p.rows.filter((r) => r.time);
  render(html`
  ${title('Race times')}
  <p class="muted">What your PRs say you could run now, with an 80% range: 8 times in 10 the real time lands inside it. For an event you have a PR in, the prediction comes from your other results.</p>
  <section class="card">
    ${predicted.length ? html`<div class="table-wrap"><table>
      <thead><tr><th>Event</th><th class="num">PR</th><th class="num">Predicted</th><th class="num">80% range</th></tr></thead>
      <tbody>${p.rows.map((r) => html`<tr><td>${r.label}<div class="model-name">${r.model || ''}</div></td><td class="num">${r.pr || "–"}</td>
        <td class="num pred">${r.time || '–'}</td><td class="num muted">${r.lo ? `${r.lo}–${r.hi}` : ''}</td></tr>`)}</tbody></table></div>`
      : html`<p>Add a PR or two on the <a href="#training">Training</a> tab and Kestrel will predict your other events.</p>${note('two PRs is plenty to start')}`}
  </section>
  <section class="card">
    <h2>Marathon</h2>
    ${p.marathon.time ? html`<div class="big-time"><span class="u">${p.marathon.time}${raw(HAND.under)}</span></div><p class="muted">80% range ${p.marathon.lo}–${p.marathon.hi}, from ${p.marathon.run_days} running days in the last 16 weeks.</p>`
      : html`<p class="muted">${p.marathon.needs}</p>`}
    <p class="muted small">${p.marathon.model}</p>
  </section>
  <section class="card">
    <h2>Models in use</h2>
    <ul class="list">${Object.entries(p.models).map(([task, m]) => html`<li class="row"><span class="grow small">${S.cfg.tasks[task]}</span><span class="chip accent">${m.name} ${m.version}</span></li>`)}</ul>
    <a class="btn small" href="#models" style="margin-top:10px">Change models</a>
  </section>`);
}

// ---------- model hub ----------

const fmtSize = (n) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n > 1e3 ? `${Math.round(n / 1e3)} KB` : `${n} B`);
const KIND_HELP = {
  'lite-trees': 'boosted trees (HawksPredict-Lite format)',
  'short-pairs': 'event-pair lines (HawksPredict-Short format)',
  'marathon-trees': 'boosted trees over training (HawksPredict-Marathon format)',
  riegel: 'Riegel formula',
};

async function viewModels() {
  const task = S.modelTask;
  const r = await attempt(() => api(`/api/models?task=${task}`));
  if (!r) return;
  const inUse = S.me.models[task];
  const kinds = Object.entries(S.cfg.kinds).filter(([, tasks]) => tasks.includes(task)).map(([k]) => k);
  render(html`
  ${title('Model hub')}
  <p class="muted">Every model in Kestrel is open weights. Pick which one makes each prediction, download any of them, fine-tune them on your own data, or upload your own for everyone to try.</p>
  <div class="seg" style="margin:18px 0 8px">${Object.keys(S.cfg.tasks).map((t) => html`<button data-task="${t}" class="${t === task ? 'on' : ''}">${{ race: 'Race times', short: 'Sprints', marathon: 'Marathon' }[t]}</button>`)}</div>
  <p class="small muted">${S.cfg.tasks[task]}</p>
  <section class="card"><h2>Models</h2><ul class="list">${r.models.map((m) => html`<li class="model">
    <div><span class="name">${m.name}</span> <span class="muted">${m.version}</span><div class="small muted">by ${m.owner}${m.visibility === 'private' ? ' · private' : ''}</div></div>
    <div>${m.id === inUse ? circled(note('in use')) : ''}</div>
    <div class="desc">${m.description}</div>
    <div class="row" style="grid-column:1/-1"><span class="chip">${KIND_HELP[m.kind] || m.kind}</span><span class="chip">${m.license || 'no licence given'}</span><span class="chip">${fmtSize(m.size)}</span></div>
    <div class="acts">
      ${m.id !== inUse ? html`<button class="small primary" data-use="${m.id}">Use this model</button>` : ''}
      <a class="btn small" href="/api/models/${m.id}?download=1">Download</a>
      ${m.builtin ? html`<button class="small ghost" data-card="${m.id}">Model card</button>` : ''}
      ${m.mine ? html`<button class="small danger" data-del="${m.id}">Delete</button>` : ''}
    </div></li>`)}</ul></section>

  <section class="card">
    <h2>Upload a model</h2>
    <p class="muted small">A Kestrel model is a JSON file of weights, never code, so it is safe to run for anyone. For this slot the formats are: ${kinds.map((k) => KIND_HELP[k]).join('; ')}.</p>
    <form id="upForm" class="stack">
      <input type="file" name="file" accept="application/json,.json" required>
      <div class="row"><label class="check"><input type="checkbox" name="private"> Only me (private)</label></div>
      <button class="primary">Upload</button>
    </form>
    <details style="margin-top:12px"><summary>How to fine-tune or make your own</summary>
      <div class="small" style="margin-top:8px">
        <p>1. Download a model above. Its <code>weights</code> are the trees or coefficients.</p>
        <p>2. Retrain on your own results with the open training scripts (<a href="https://github.com/jakecapmeil/hawks/tree/main/research/hawkspredict" target="_blank" rel="noopener">research/hawkspredict</a>), or write the numbers yourself.</p>
        <p>3. Keep <code>"kestrel": 1</code>, set <code>name</code>, <code>version</code>, <code>kind</code>, <code>task</code>, <code>license</code> and <code>trained_on</code>, and upload. The simplest model:</p>
        <pre>{ "kestrel": 1, "name": "My Riegel", "version": "v1",
  "kind": "riegel", "task": "${task === 'marathon' ? 'race' : task}", "license": "CC0-1.0",
  "description": "Riegel with a steeper exponent for teens",
  "weights": { "exponent": 1.08, "sd": 0.05 } }</pre>
        <p>Full format: <a href="${SOURCE_URL}/MODELS.md" target="_blank" rel="noopener">MODELS.md</a>.</p>
      </div></details>
  </section>
  <dialog id="cardDlg"></dialog>`);

  $app.querySelectorAll('[data-task]').forEach((b) => { b.onclick = () => { S.modelTask = b.dataset.task; viewModels(); }; });
  $app.querySelectorAll('[data-use]').forEach((b) => {
    b.onclick = () => attempt(async () => {
      S.me = await api('/api/me', { method: 'PUT', body: JSON.stringify({ models: { [task]: b.dataset.use } }) });
      S.aiCtx = null;
      toast('Model switched. Your race times now use it.');
      viewModels();
    }, b);
  });
  $app.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = () => attempt(async () => { if (!confirm('Delete this model?')) return; await api(`/api/models/${b.dataset.del}`, { method: 'DELETE' }); viewModels(); }, b);
  });
  $app.querySelectorAll('[data-card]').forEach((b) => {
    b.onclick = () => attempt(async () => {
      const { model: m } = await api(`/api/models/${b.dataset.card}`);
      const d = document.getElementById('cardDlg');
      d.innerHTML = html`<h2>${m.name} ${m.version}</h2><p>${m.description}</p><p class="small"><b>Trained on:</b> ${m.trained_on}</p>
        <p class="small"><b>Weights licence:</b> ${m.license}</p><p class="small"><b>Format:</b> ${KIND_HELP[m.kind]}, ${fmtSize(m.size)}</p>
        <p class="small"><a href="${SOURCE_URL}/models/README.md" target="_blank" rel="noopener">Full model card</a></p>
        <form method="dialog"><button class="primary">Close</button></form>`.s;
      d.showModal();
    }, b);
  });
  document.getElementById('upForm').onsubmit = (e) => {
    e.preventDefault();
    const file = e.target.elements.file.files[0];
    attempt(async () => {
      if (!file) throw new Error('Choose a JSON file.');
      if (file.size > 1_000_000) throw new Error('Model files can be up to 1 MB.');
      let model;
      try { model = JSON.parse(await file.text()); } catch { throw new Error('That file is not valid JSON.'); }
      await api('/api/models', { method: 'POST', body: JSON.stringify({ model, visibility: e.target.elements.private.checked ? 'private' : 'public' }) });
      toast('Uploaded. Pick “Use this model” to try it.');
      S.modelTask = model.task in S.cfg.tasks ? model.task : task;
      viewModels();
    }, e.submitter);
  };
}

// ---------- coach (Kestrel AI) ----------

const chatKey = () => `kestrel.chat.${S.me.user.id}`;

async function aiSystem() {
  if (!S.aiCtx || Date.now() - S.aiCtx.at > 120000) {
    const r = await api('/api/ai/context');
    S.aiCtx = { at: Date.now(), system: `${r.system}\n\nATHLETE DATA (JSON):\n${JSON.stringify(r.context)}` };
  }
  return S.aiCtx.system;
}

function viewCoach() {
  const msgs = store.get(chatKey(), []);
  const ideas = ['What could I run for a 5K right now?', 'Plan my week around our next meet.', 'Was last week too much mileage?', 'What paces should my easy runs be?'];
  render(html`
  <div class="title-row">${title('Kestrel AI')}${msgs.length ? html`<button class="ghost small" id="clear" style="margin-bottom:22px">Clear chat</button>` : ''}</div>
  <div class="power muted" style="margin:6px 0 14px">Powered by <b style="color:var(--ink)">${AI.describe(S.ai)}</b><button class="small" id="aiSettings">Change</button></div>
  <div class="chat" id="chat">
    ${msgs.length ? msgs.map((m) => html`<div class="msg ${m.role}">${m.content}</div>`)
      : html`<div class="muted">Ask about your training, race times or your team's schedule. Kestrel AI reads your log, PRs, predictions and team calendar.</div>
        <div class="ideas">${ideas.map((q) => html`<button data-idea="${q}">${q}</button>`)}</div>`}
  </div>
  <form class="composer" id="ask"><textarea name="q" class="grow" placeholder="Message Kestrel AI" required></textarea><button class="primary">Send</button></form>
  <dialog id="aiDlg"></dialog>`);
  const chat = document.getElementById('chat');
  const scroll = () => window.scrollTo(0, document.body.scrollHeight);
  scroll();
  const f = document.getElementById('ask');
  const send = async (q) => {
    const list = store.get(chatKey(), []);
    list.push({ role: 'user', content: q });
    store.set(chatKey(), list);
    viewCoach();
    const c = document.getElementById('chat');
    c.insertAdjacentHTML('beforeend', '<div class="msg assistant muted" id="typing">Thinking…</div>');
    scroll();
    const btn = document.querySelector('#ask button');
    btn.disabled = true;
    try {
      const system = S.ai.provider === 'kestrel' ? '' : await aiSystem();
      const text = await AI.complete(S.ai, system, list.slice(-16).map(({ role, content }) => ({ role, content })), { apiFetch: api });
      list.push({ role: 'assistant', content: text });
      store.set(chatKey(), list.slice(-60));
      viewCoach();
    } catch (err) {
      document.getElementById('typing')?.remove();
      c.insertAdjacentHTML('beforeend', html`<div class="msg error">${err.message}</div>`.s);
      btn.disabled = false;
      scroll();
    }
  };
  f.onsubmit = (e) => { e.preventDefault(); const q = f.elements.q.value.trim(); if (q) send(q); };
  f.elements.q.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); f.requestSubmit(); } };
  chat.querySelectorAll('[data-idea]').forEach((b) => { b.onclick = () => send(b.dataset.idea); });
  const clear = document.getElementById('clear');
  if (clear) clear.onclick = () => { store.del(chatKey()); viewCoach(); };
  document.getElementById('aiSettings').onclick = openAiSettings;
}

function openAiSettings() {
  const d = document.getElementById('aiDlg');
  const draw = (id) => {
    const p = AI.PROVIDERS[id];
    const c = AI.configFor(S.ai, id);
    d.innerHTML = html`<h2>What powers Kestrel AI</h2>
      <p class="muted small">Kestrel is the interface. Use the free default, your own API key, or a model running on your own computer.</p>
      <form id="aiForm" class="stack">
        <div><label>Provider</label><select name="provider">${Object.entries(AI.PROVIDERS).map(([k, v]) => html`<option value="${k}" ${k === id ? raw('selected') : ''}>${v.label}</option>`)}</select></div>
        ${p.kind === 'kestrel' ? html`<p class="small muted">Free, with a daily limit. Runs on Google Gemini, with an open-weight Llama model on Cloudflare as backup. Your question and your training data are sent to the model to answer it.</p>` : html`
        <div><label>Server address</label><input name="base" value="${c.base}" placeholder="https://…/v1" required></div>
        <div><label>Model</label><div class="row"><input name="model" class="grow" value="${c.model}" list="modelList" placeholder="model name" required><button type="button" class="small" id="loadModels">List models</button></div><datalist id="modelList"></datalist></div>
        <div><label>API key ${p.needsKey ? '' : '(optional)'}</label><input name="key" type="password" value="${c.key}" autocomplete="off" ${p.needsKey ? raw('required') : ''} placeholder="${p.needsKey ? 'paste your key' : 'not needed for most local servers'}">
          <p class="muted small" style="margin-top:4px">Kept only in this browser and sent straight to ${p.label}, never to Kestrel. ${p.keyUrl ? html`<a href="${p.keyUrl}" target="_blank" rel="noopener">Get a key</a>` : ''}</p></div>
        ${p.local ? html`<p class="small muted">${id === 'ollama'
          ? html`Install <a href="https://ollama.com" target="_blank" rel="noopener">Ollama</a>, run <code>ollama pull ${c.model || 'llama3.2'}</code>, then start it so this site may call it: <code>OLLAMA_ORIGINS=${location.origin} ollama serve</code>`
          : html`In LM Studio, load a model, start the local server and turn on “Enable CORS”.`}</p>` : ''}`}
        <div class="row"><button class="primary">Save</button><button type="button" id="testAi">Test</button><button type="button" id="closeAi" class="ghost">Close</button></div>
        <p class="small" id="aiMsg"></p>
      </form>`.s;
    linkLabels(d);
    const af = d.querySelector('#aiForm');
    // The fields on screen belong to provider `id`, whatever the select now says.
    const collect = () => {
      const v = form(af);
      const next = { provider: v.provider, configs: { ...S.ai.configs } };
      if (id !== 'kestrel') next.configs[id] = { base: (v.base || '').trim(), model: (v.model || '').trim(), key: (v.key || '').trim() };
      return next;
    };
    af.elements.provider.onchange = () => { const next = af.elements.provider.value; S.ai = { ...collect(), provider: S.ai.provider }; draw(next); };
    af.onsubmit = (e) => { e.preventDefault(); S.ai = collect(); AI.saveAi(S.ai); d.close(); viewCoach(); toast(`Kestrel AI now runs on ${AI.describe(S.ai)}.`); };
    d.querySelector('#closeAi').onclick = () => d.close();
    d.querySelector('#testAi').onclick = async (e) => {
      const msg = d.querySelector('#aiMsg');
      e.currentTarget.disabled = true;
      msg.textContent = 'Testing…';
      msg.style.color = '';
      try {
        const st = collect();
        const out = await AI.complete(st, 'Reply in under ten words.', [{ role: 'user', content: 'Say hello to a runner.' }], { apiFetch: api });
        msg.textContent = `Works: “${out.slice(0, 120)}”`;
        msg.style.color = 'var(--good)';
      } catch (err) {
        msg.textContent = err.message;
        msg.style.color = 'var(--bad)';
      } finally {
        e.currentTarget.disabled = false;
      }
    };
    const lm = d.querySelector('#loadModels');
    if (lm) lm.onclick = async () => {
      const msg = d.querySelector('#aiMsg');
      try {
        const names = await AI.listModels(collect(), id);
        d.querySelector('#modelList').innerHTML = names.map((n) => `<option value="${esc(n)}">`).join('');
        msg.textContent = names.length ? `${names.length} models found. Start typing in Model to pick one.` : 'The server did not list any models.';
        msg.style.color = '';
      } catch (err) {
        msg.textContent = err.message;
        msg.style.color = 'var(--bad)';
      }
    };
  };
  draw(S.ai.provider);
  d.showModal();
}

// ---------- profile ----------

function viewProfile() {
  const u = S.me.user;
  render(html`
  ${title('Profile')}
  <section class="card">
    <form id="pf" class="stack">
      <div><label>Name</label><input name="name" value="${u.name}" maxlength="60" required></div>
      <div class="fields">
        <div><label>Colour</label><input type="color" name="color" value="${u.color}" style="height:42px;padding:4px"></div>
        <div><label>Sex (used by race-time models)</label><select name="sex">
          ${[['', 'Prefer not to say'], ['f', 'Female'], ['m', 'Male']].map(([v, l]) => html`<option value="${v}" ${u.sex === v ? raw('selected') : ''}>${l}</option>`)}</select></div>
      </div>
      <p class="muted small">Signed in as ${u.email}</p>
      <div class="row"><button class="primary">Save</button><button type="button" id="signOut">Sign out</button></div>
    </form>
  </section>
  <section class="card">
    <h2>About Kestrel</h2>
    <p class="small">Kestrel is open source (MIT licence). The HawksPredict models are open weights. <a href="${REPO_URL}" target="_blank" rel="noopener">Source code</a> · <a href="#models">Model hub</a></p>
    <p class="small muted">Teammates see your name and colour. Your log, PRs, predictions and AI chats are yours only; AI chats stay in this browser.</p>
  </section>
  <section class="card">
    <h2>Delete my data</h2>
    <p class="small muted">Removes your profile, log, PRs, uploaded models and team memberships from Kestrel.</p>
    <button class="danger" id="delMe">Delete my Kestrel data</button>
  </section>`);
  document.getElementById('pf').onsubmit = (e) => {
    e.preventDefault();
    attempt(async () => { S.me = await api('/api/me', { method: 'PUT', body: JSON.stringify(form(e.target)) }); updateWho(); toast('Saved.'); }, e.submitter);
  };
  document.getElementById('signOut').onclick = () => S.sb.auth.signOut();
  document.getElementById('delMe').onclick = (e) => attempt(async () => {
    if (!confirm('Delete all your Kestrel data? This cannot be undone.')) return;
    await api('/api/me', { method: 'DELETE' });
    store.del(chatKey());
    await S.sb.auth.signOut();
    toast('Your Kestrel data is deleted.');
  }, e.currentTarget);
}

boot().catch((err) => { console.error(err); render(html`<p class="pad center">Kestrel could not start: ${err.message}</p>`); });
