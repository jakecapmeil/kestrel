// Kestrel around the Kestrel app: sign-in (Supabase), onboarding, teams (switch, start, join, manage), which model
// powers Kestrel AI, and which Kestrel Lab models make race predictions. The app itself (index.html's main script)
// starts through window.kestrelInit once someone is signed in; every API call it makes carries the sign-in and the
// team on screen through window.KESTREL.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import * as AI from '/ai.js';

const REPO_URL = 'https://github.com/jakecapmeil/kestrel';
const $ = (id) => document.getElementById(id);
const K = (window.KESTREL = {
  me: null, teams: [], teamId: null, role: null, levels: [], cfg: null, sb: null, started: false,
  ai: AI.loadAi(),
  get aiProvider() { return this.ai.provider; },
  getToken: async () => (await K.sb?.auth.getSession())?.data.session?.access_token || null,
  onAuthError: () => { if (K.me) { K.me = null; K.sb?.auth.signOut(); } },
});

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
const store = {
  get: (k, d = null) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch { /* private mode */ } },
};
const form = (el) => Object.fromEntries(new FormData(el).entries());

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
  const res = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `Request failed (${res.status})`);
  return out;
}
async function attempt(fn, btn) {
  if (btn) btn.disabled = true;
  try { return await fn(); } catch (err) { toast(err.message, true); return undefined; } finally { if (btn) btn.disabled = false; }
}

// ---------- the gate: everything before the app (landing, sign-in, onboarding, first team)

function gate(content) {
  $('kApp').hidden = true;
  $('kGate').hidden = false;
  $('kGate').innerHTML = content.s;
  window.scrollTo(0, 0);
}
function openApp() {
  $('kGate').hidden = true;
  $('kGate').innerHTML = '';
  $('kApp').hidden = false;
}

const HAWK_PATH = 'M5 17c4-1 7-4 9-8 1 3 3 5 6 5l7-3c-2 4-5 6-9 7l-3 6-2-5c-3 0-6-1-8-2z';

function hero() {
  return html`<div class="k-hero">
    <svg class="k-watermark" viewBox="0 0 32 32" aria-hidden="true"><path d="${HAWK_PATH}" fill="none" stroke="currentColor" stroke-opacity=".22" stroke-width=".3" stroke-linejoin="round"/><circle cx="20.5" cy="12.6" r=".75" fill="var(--accent)"/></svg>
    <div class="k-kicker">Open-source AI running coaching</div>
    <h1 class="k-display">Train together.<br>Race <span class="k-accent-text">smarter.</span></h1>
    <p class="k-lede">The coaching that running apps charge for, free and open source. Kestrel builds your plan, changes it day to day, predicts your races, and keeps your whole team on one calendar.</p>
  </div>`;
}

function showcase() {
  const phone = (src, alt, title, text) => html`<figure class="k-shot"><div class="k-phone"><img src="${src}" alt="${alt}" width="780" height="1688" loading="lazy"></div><figcaption><b>${title}</b>${text}</figcaption></figure>`;
  return html`<section class="k-showcase" aria-label="What Kestrel does">
    <h2 class="k-section-title">Everything the team needs,<br>in your pocket.</h2>
    <div class="k-shots">
      ${phone('/shots/phone-schedule.jpg', 'The team calendar for October with practices and a meet marked', 'One calendar', 'Practices, meets and who is coming, for the whole team.')}
      ${phone('/shots/phone-day.jpg', 'A meet day with the bus time, location and who is coming', 'One tap to RSVP', 'See the bus time and who is in, without a group text.')}
      ${phone('/shots/phone-train.jpg', "Today's workout and the week ahead in a training plan", 'A coach that adapts', 'Plans by weekly mileage that move with how you feel. Tell it you cannot make a day and it adjusts.')}
    </div>
    <div class="k-lablead">
      <div class="k-lablead-copy">
        <span class="k-chip ink">Kestrel Lab</span>
        <h2 class="k-section-title">Kestrel is simple.<br>The Lab is yours.</h2>
        <p class="k-lede">Kestrel works out of the box. Open the Lab to choose the models behind your predictions, test them on your own races, fork and fine-tune them, and move them to and from GitHub and Hugging Face. Models are plain files of numbers, never code.</p>
        <ul class="k-checks"><li>Test any model on your own PRs before you switch</li><li>Import from and push to GitHub or Hugging Face</li><li>Bring your own AI key, or run a model on your laptop</li></ul>
        <a class="k-btn primary" href="/lab">Open Kestrel Lab</a>
      </div>
      <div class="k-browser"><img src="/shots/lab-model.jpg" alt="A model page in Kestrel Lab with Fork, Push and version tabs" width="2560" height="1600" loading="lazy"></div>
    </div>
    <footer class="k-foot"><img src="/kestrel.svg" alt="" width="28" height="28"><span>kestrel</span><span class="k-small">Free and open source (MIT). <a href="${REPO_URL}" target="_blank" rel="noopener">Read the code</a></span></footer>
  </section>`;
}

// The iOS, Android and Mac apps load this site in a web view. Google blocks its sign-in inside embedded web views, so in the
// apps "Continue with Google" opens the system browser, and the site there hands the sign-in code back to the app through
// kestrel://auth-callback (see googleInApp). `?app` in the address previews the app look in a normal browser.
const SHELL = !!(window.Capacitor?.isNativePlatform?.() || /KestrelDesktop/.test(navigator.userAgent));
const NATIVE = !!(window.Capacitor?.isNativePlatform?.() || /KestrelDesktop/.test(navigator.userAgent) || new URLSearchParams(location.search).has('app'));
if (NATIVE) document.documentElement.classList.add('k-native');

const GOOGLE_ICON = raw('<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.4-4.1 7-10.1 7-17.6z"/><path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>');

function emailFields(signup, message) {
  return html`<label class="k-label" for="kEm">Email</label><input class="k-input" id="kEm" name="email" type="email" autocomplete="email" autocapitalize="off" required>
    <label class="k-label" for="kPw">Password</label><input class="k-input" id="kPw" name="password" type="password" minlength="8" autocomplete="${signup ? 'new-password' : 'current-password'}" required>
    ${signup ? html`<p class="k-small">We'll email you a link to confirm your address before you can sign in. By creating an account you agree to the <a href="/legal#terms" target="_blank" rel="noopener">Terms</a> and <a href="/legal#privacy" target="_blank" rel="noopener">Privacy Policy</a>. You must be 13 or older.</p>` : ''}
    ${message ? html`<p class="k-small k-good" role="status">${message}</p>` : ''}`;
}

// In the apps: sign in with Google in the system browser. The code comes back as kestrel://auth-callback?code=...
// (iOS and Android through Capacitor's App plugin, the Mac through the app's own protocol handler) and is exchanged here,
// where the PKCE verifier was stored.
async function googleInApp() {
  // redirectTo is the site's plain address (already allowed in Supabase). The system browser first loads our own /?appauth=start
  // page, which marks that browser as "signing in for the app" and then goes on to Google; when it comes back with the code,
  // the mark tells the site to pass the code to the app instead of treating it as a website sign-in.
  const { data, error } = await K.sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + '/', skipBrowserRedirect: true } });
  if (error) throw error;
  const url = location.origin + '/?appauth=start&to=' + encodeURIComponent(data.url);
  const browser = window.Capacitor?.Plugins?.Browser;
  if (browser) await browser.open({ url }); else window.open(url, '_blank');
}
// The sign-in client is made during boot; a code that arrives before then waits for it.
let sbReady; const sbReadyP = new Promise((r) => { sbReady = r; });
window.kestrelAuthCallback = async (url) => {
  try {
    const u = new URL(url);
    if (u.searchParams.get('error_description')) throw new Error(u.searchParams.get('error_description'));
    const code = u.searchParams.get('code');
    if (!code) return;
    if (!K.sb) await sbReadyP;
    const { error } = await K.sb.auth.exchangeCodeForSession(code);
    if (error) throw error;
  } catch (e) { toast(e.message, true); }
  try { await window.Capacitor?.Plugins?.Browser?.close?.(); } catch {}
};
window.Capacitor?.Plugins?.App?.addListener?.('appUrlOpen', (e) => { if (/^kestrel:\/\/auth-callback/.test(e.url)) window.kestrelAuthCallback(e.url); });

// Google, the sign-in/sign-up swap, forgot password and the email form: shared by the website and the app.
function wireAuth(signup) {
  if ($('kGoogle')) $('kGoogle').onclick = (e) => attempt(async () => {
    if (SHELL) return googleInApp();
    const { error } = await K.sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + '/' } });
    if (error) throw error;
  }, e.currentTarget);
  $('kSwap').onclick = () => renderLanding(signup ? 'signin' : 'signup');
  const forgot = $('kForgot');
  if (forgot) forgot.onclick = () => attempt(async () => {
    const email = $('kEm').value.trim();
    if (!email) throw new Error('Type your email first.');
    const { error } = await K.sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + '/?reset=1' });
    if (error) throw error;
    renderLanding('signin', 'Check your email for a link to set a new password.');
  });
  $('kEmailForm').onsubmit = (e) => {
    e.preventDefault();
    const f = form(e.target);
    attempt(async () => {
      if (signup) {
        const { data, error } = await K.sb.auth.signUp({ email: f.email, password: f.password, options: { emailRedirectTo: location.origin + '/' } });
        if (error) throw error;
        if (!data.session) renderLanding('signin', `Check ${f.email} for a confirmation link, then sign in.`);
      } else {
        const { error } = await K.sb.auth.signInWithPassword({ email: f.email, password: f.password });
        if (error) throw new Error(/confirm/i.test(error.message) ? 'Confirm your email first: open the link we sent you.' : error.message);
      }
    }, e.submitter);
  };
}

// mode: 'signin' | 'signup', or (apps only) 'welcome', the first screen.
function renderLanding(mode, message = '') {
  if (NATIVE) return renderAppStart(mode || (message ? 'signin' : 'welcome'), message);
  const signup = mode === 'signup';
  gate(html`<header class="k-top"><a class="k-brand" href="/"><img src="/kestrel.svg" alt="" width="44" height="44"><span class="k-top-word">kestrel</span></a><a class="k-btn small ghost" href="/lab">Kestrel Lab</a></header><div class="k-landing">${hero()}
  <div class="k-auth">
    <span class="k-chip accent k-auth-chip">free &amp; open source</span>
    <h2>${signup ? 'Create your account' : 'Sign in'}</h2>
    <button class="k-btn wide" id="kGoogle" type="button">${GOOGLE_ICON}Continue with Google</button>
    <div class="k-or">or with email</div>
    <form id="kEmailForm">
      ${emailFields(signup, message)}
      <button class="k-btn primary wide" type="submit">${signup ? 'Create account' : 'Sign in'}</button>
    </form>
    <div class="k-row spread">
      <button class="k-link" type="button" id="kSwap">${signup ? 'Have an account? Sign in' : 'New here? Create an account'}</button>
      ${signup ? '' : html`<button class="k-link" type="button" id="kForgot">Forgot password?</button>`}
    </div>
    <p class="k-small">Kestrel is open source: <a href="${REPO_URL}" target="_blank" rel="noopener">read the code</a>. <a href="/legal" target="_blank" rel="noopener">Terms, privacy and safety</a>. Building running models? <a href="/lab">Kestrel Lab</a>.</p>
  </div></div>${showcase()}`);
  wireAuth(signup);
}

// ---------- the apps' start: a welcome screen, then a full-screen sign-in. No site header, marketing or footer.

const APP_MARK = raw(`<svg viewBox="0 0 32 32" aria-hidden="true"><path d="${HAWK_PATH}" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/><circle cx="20.5" cy="12.6" r="1" fill="var(--accent)"/></svg>`);
const CHEVRON = raw('<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>');

function appCards() {
  const week = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const reps = [62, 70, 66, 74, 68, 78, 72, 84];
  return html`
  <article class="ka-card">
    <div class="ka-art ka-week" aria-hidden="true">${week.map((d, i) => html`<span class="${i === 2 ? 'on' : i < 2 ? 'done' : ''}"><b>${d}</b><i></i></span>`)}</div>
    <h2>A plan that listens</h2>
    <p>Tell Kestrel how you feel or that you can't run Thursday. Your week moves with you.</p>
  </article>
  <article class="ka-card">
    <div class="ka-art ka-team" aria-hidden="true"><span>AK</span><span>JM</span><span>RS</span><span>TL</span><em>+12 going</em></div>
    <h2>Your whole team</h2>
    <p>Practices, meets, the bus time and who's coming, on one calendar.</p>
  </article>
  <article class="ka-card">
    <div class="ka-art ka-reps" aria-hidden="true">${reps.map((h) => html`<i style="height:${h}%"></i>`)}</div>
    <h2>Every rep, explained</h2>
    <p>Sync your watch and see each session split into reps, with a summary from your coach.</p>
  </article>`;
}

function renderAppStart(mode, message) {
  if (mode === 'welcome') {
    gate(html`<div class="ka-screen"><div class="ka ka-welcome">
      <div class="ka-hello">
        <div class="ka-mark">${APP_MARK}</div>
        <div class="ka-word">kestrel</div>
        <p class="ka-tag">Your running coach and your team, in one place.</p>
      </div>
      <div class="ka-cards" id="kaCards">${appCards()}</div>
      <div class="ka-dots" role="tablist" aria-label="About Kestrel">${[0, 1, 2].map((i) => html`<button type="button" role="tab" aria-label="Card ${i + 1} of 3" aria-selected="${String(i === 0)}" data-i="${i}"></button>`)}</div>
      <div class="ka-actions">
        <button class="k-btn primary wide" type="button" id="kaNew">Get started</button>
        <button class="k-btn wide ka-quiet" type="button" id="kaHave">I have an account</button>
      </div>
      <p class="ka-fine">Free and open source</p>
    </div></div>`);
    const cards = $('kaCards');
    const dots = [...document.querySelectorAll('.ka-dots button')];
    const step = () => cards.children[1].offsetLeft - cards.children[0].offsetLeft;
    cards.addEventListener('scroll', () => {
      const i = Math.round(cards.scrollLeft / step());
      dots.forEach((d, j) => d.setAttribute('aria-selected', String(i === j)));
    }, { passive: true });
    dots.forEach((d) => { d.onclick = () => cards.scrollTo({ left: step() * Number(d.dataset.i), behavior: 'smooth' }); });
    $('kaNew').onclick = () => renderAppStart('signup', '');
    $('kaHave').onclick = () => renderAppStart('signin', '');
    return;
  }
  const signup = mode === 'signup';
  gate(html`<div class="ka-screen"><form class="ka ka-form" id="kEmailForm">
    <div class="ka-bar"><button class="ka-back" type="button" id="kaBack" aria-label="Back">${CHEVRON}</button><div class="ka-mark small">${APP_MARK}</div><span></span></div>
    <h1 class="ka-title">${signup ? 'Create your account' : 'Welcome back'}</h1>
    <p class="ka-sub">${signup ? 'Free for every runner and every team.' : 'Sign in to pick up where you left off.'}</p>
    <button class="k-btn wide" id="kGoogle" type="button">${GOOGLE_ICON}Continue with Google</button>
    <div class="k-or">or with email</div>
    ${emailFields(signup, message)}
    ${signup ? '' : html`<button class="k-link ka-forgot" type="button" id="kForgot">Forgot password?</button>`}
    <div class="ka-bottom">
      <button class="k-btn primary wide" type="submit">${signup ? 'Create account' : 'Sign in'}</button>
      <button class="k-link" type="button" id="kSwap">${signup ? 'I already have an account' : 'New to Kestrel? Create an account'}</button>
    </div>
  </form></div>`);
  $('kaBack').onclick = () => renderAppStart('welcome', '');
  wireAuth(signup);
}

function renderNewPassword() {
  gate(html`<div class="k-auth narrow"><h2>Set a new password</h2>
    <form id="kNp"><label class="k-label" for="kNp1">New password</label><input class="k-input" id="kNp1" name="password" type="password" minlength="8" autocomplete="new-password" required>
    <button class="k-btn primary wide">Save password</button></form></div>`);
  $('kNp').onsubmit = (e) => {
    e.preventDefault();
    attempt(async () => {
      const { error } = await K.sb.auth.updateUser({ password: form(e.target).password });
      if (error) throw error;
      toast('Password saved.');
      K.recovering = false;
      await afterSignIn();
    }, e.submitter);
  };
}

// The runner intake: who you are, where your running is, what you're working towards and why, the rest of your
// training and how you like to be coached. The answers live in settings.profile and feed the plan builder and the
// coach; a race goal also becomes a tracked goal (Train > Goals). Editing later (You > Profile) reopens the same steps.
const OB_STEPS = [
  { key: 'about', title: 'About you', sub: 'Let’s set up your profile so your coach can build the right plan.' },
  { key: 'body', title: 'Body', sub: 'Helps with pace, effort, fueling and heart-rate zones. All of it is private.' },
  { key: 'running', title: 'Your running', sub: 'Where you are today, so the plan starts at the right level.' },
  { key: 'week', title: 'Your week', sub: 'Your plan fits around your life, not the other way round.' },
  { key: 'prs', title: 'Personal records', sub: 'Your coach uses these to predict your races and set your paces.' },
  { key: 'goals', title: 'Your goal', sub: 'What are you working towards? Kestrel tracks your progress in Train → Goals.' },
  { key: 'coach', title: 'Your coach', sub: 'The rest of your training, fueling, and how you like to be coached.' },
];
const OB_YEAR = new Date().getFullYear();
const DAYS = [['', 'No preference'], ['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']];
const XT = [['bike', 'Cycling'], ['swim', 'Swimming'], ['strength', 'Strength'], ['mobility', 'Yoga or mobility'], ['elliptical', 'Elliptical'], ['pool_run', 'Pool running'], ['row', 'Rowing'], ['sport', 'Another sport']];
const GOAL_EVENTS = ['800', '1600', '3200', '5K', '10K', 'Half marathon', 'Marathon'];
const EVENT_M = { '800': 800, '1600': 1609.344, '3200': 3218.688, '5K': 5000, '10K': 10000, 'Half marathon': 21097.5, Marathon: 42195 };
const GOAL_PICKS = [['Sub-3 marathon', 'Marathon', '2:59:59'], ['Sub-4 marathon', 'Marathon', '3:59:59'], ['Sub-1:30 half', 'Half marathon', '1:29:59'], ['Sub-20 5K', '5K', '19:59'], ['Sub-5 mile', '1600', '4:59']];
const secOf = (t) => { const p = String(t || '').trim().split(':').map(Number); return p.length && p.every((n) => Number.isFinite(n)) ? p.reduce((a, n) => a * 60 + n, 0) : 0; };
const clockOf = (s) => { s = Math.round(s); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// The saved profile as form values (for editing it later).
function obFromProfile() {
  const p = K.me.profile || {};
  const u = K.me.user;
  const metric = p.units === 'km';
  const d = { ...p, name: u.name, sex: u.sex, class_year: u.class_year, units: p.units || 'mi', age: true };
  if (p.height_cm && !metric) { const inch = p.height_cm / 2.54; d.ft = String(Math.floor(inch / 12)); d.in = String(Math.round(inch % 12)); }
  if (p.weight_kg) d.weight = String(metric ? p.weight_kg : Math.round(p.weight_kg / 0.4536));
  d.xtrain = p.xtrain || [];
  return d;
}

function renderOnboarding(step = 0, d = K.ob || (K.ob = { units: 'mi', age: false, xtrain: [] }), edit = false) {
  K.ob = d;
  const u = K.me.user;
  const metric = d.units === 'km';
  const steps = edit ? OB_STEPS.filter((s) => s.key !== 'prs') : OB_STEPS;
  const S = steps[step];
  const sel = (name, opts, cur) => html`<select class="k-input" name="${name}">${opts.map(([v, l]) => html`<option value="${v}" ${String(cur ?? '') === v ? 'selected' : ''}>${l}</option>`)}</select>`;
  const field = (label, inner, hint = '') => html`<label class="k-label">${label}</label>${inner}${hint ? html`<p class="k-small">${hint}</p>` : ''}`;
  const num = (name, ph, extra = '') => html`<input class="k-input" name="${name}" type="number" inputmode="decimal" step="any" placeholder="${ph}" value="${d[name] ?? ''}" ${raw(extra)}>`;
  const cell = (label, inner) => html`<div>${field(label, inner)}</div>`;
  const time = (name, ph) => html`<input class="k-input mono" name="${name}" placeholder="${ph}" value="${d[name] ?? ''}" maxlength="10" inputmode="numeric" pattern="[0-9:.]*">`;
  const text = (name, ph, n = 300) => html`<textarea class="k-input" name="${name}" maxlength="${n}" rows="2" placeholder="${ph}">${d[name] ?? ''}</textarea>`;
  const panels = {
    about: () => html`
      ${K.cfg?.freeAi && !edit ? html`<div class="k-ai-fill"><label class="k-label" for="kObAi">Short on time? Describe yourself and let Kestrel AI fill this in.</label>
        <textarea class="k-input" id="kObAi" rows="3" maxlength="2000" placeholder="e.g. I'm 5'10, 150 lb, run about 40 miles a week with a Garmin, long run Sundays. Half PR 1:31, 5K 19:38. I want to break 3 hours at the Boston Marathon on April 20 because my dad never did."></textarea>
        <button class="k-btn small" type="button" id="kObAiGo">Fill in with AI</button>
        <p class="k-small">You can check and change everything before you finish. Or fill it in by hand below.</p></div>` : ''}
      ${field('Your name (teammates see this)', html`<input class="k-input" name="name" value="${d.name ?? u.name}" maxlength="60" required>`)}
      ${field('Year you were born', num('birth_year', 'e.g. 2008', `min="1930" max="${OB_YEAR - 8}" required`), 'Used for heart-rate zones and age-graded comparisons.')}
      ${field('Sex (race models use it if you give it)', sel('sex', [['', 'Prefer not to say'], ['f', 'Female'], ['m', 'Male']], d.sex))}
      ${field('Grade', sel('class_year', [['', 'Not set'], ...['Middle school', 'Freshman', 'Sophomore', 'Junior', 'Senior', 'College', 'Adult'].map((x) => [x, x])], d.class_year))}
      ${field('Units', sel('units', [['mi', 'Miles, feet and pounds'], ['km', 'Kilometres and kilograms']], d.units))}`,
    body: () => html`
      ${metric
        ? field('Height (cm)', num('height_cm', 'e.g. 172', 'min="100" max="230"'))
        : field('Height', html`<div class="k-row2">${num('ft', 'ft', 'min="3" max="7"')}${num('in', 'in', 'min="0" max="11.9"')}</div>`)}
      ${field(metric ? 'Weight (kg)' : 'Weight (lb)', num('weight', metric ? 'e.g. 62' : 'e.g. 135', metric ? 'min="25" max="220"' : 'min="55" max="485"'), 'Optional. Sets your fueling targets (Train → Fuel). Only you see it.')}
      ${field('Resting heart rate (bpm)', num('resting_hr', 'e.g. 52', 'min="30" max="120"'), 'Optional. Your watch shows this.')}
      ${field('Max heart rate (bpm)', num('max_hr', 'e.g. 195', 'min="120" max="230"'), 'Optional. Leave blank and we estimate it from your age.')}`,
    running: () => html`
      ${field('How long have you been running?', sel('experience', [['', 'Choose one'], ['new', 'Just starting'], ['under1', 'Under a year'], ['1to3', '1 to 3 years'], ['3plus', 'More than 3 years']], d.experience))}
      ${field('Miles you run in a typical week right now', num('weekly_miles', 'e.g. 25', 'min="0" max="150" required'), 'Be honest, not hopeful: the plan starts here and builds safely.')}
      ${field('Longest run in the last month (miles)', num('longest_run_mi', 'e.g. 8', 'min="0" max="100"'))}
      ${field('What do you run with?', sel('watch', [['', 'Choose one'], ['garmin', 'Garmin'], ['coros', 'COROS'], ['apple', 'Apple Watch'], ['suunto', 'Suunto'], ['polar', 'Polar'], ['wahoo', 'Wahoo'], ['strava', 'Strava only'], ['other', 'Something else'], ['none', 'Nothing yet']], d.watch), 'Right after setup we walk you through connecting it.')}
      ${field('Injuries or limits we should know about', text('injuries', 'e.g. shin splints last spring, a sore left Achilles'))}`,
    week: () => html`
      ${field('Days a week you want to run', sel('days_per_week', [['', 'Choose one'], ...[3, 4, 5, 6, 7].map((n) => [String(n), `${n} days`])], d.days_per_week))}
      ${field('Best day for your long run', sel('long_run_day', DAYS, d.long_run_day))}
      ${field('A day you can never run', sel('rest_day', DAYS.map(([v, l]) => [v, v ? l : 'Any day works']), d.rest_day))}
      ${field('When do you usually run?', sel('run_time', [['', 'Choose one'], ['morning', 'Mornings'], ['midday', 'Middle of the day'], ['evening', 'Afternoons or evenings'], ['varies', 'It changes']], d.run_time))}
      ${field('Workouts you love (or hate)', text('likes', 'e.g. love hills and long runs, hate the track', 200))}`,
    prs: () => html`<p class="k-small">Add the ones you have, skip the rest. Times look like 58.4, 2:15 or 19:38. Longer races go in You → Records after setup.</p>
      ${field('800 m', time('pr800', 'e.g. 2:20'))}
      ${field('1600 m (mile)', time('pr1600', 'e.g. 5:15'))}
      ${field('3200 m (2 mile)', time('pr3200', 'e.g. 11:30'))}
      ${field('5K', time('pr5K', 'e.g. 19:38'), 'Your best or current 5K sets all your training paces.')}`,
    goals: () => {
      const sec = secOf(d.goal_time); const m = EVENT_M[d.goal_event];
      return html`
      ${field('What are you here for?', sel('goal', [['', 'Choose one'], ['race', 'Run a specific race'], ['faster', 'Get faster'], ['distance', 'Build up distance'], ['fitness', 'Stay fit and healthy'], ['comeback', 'Come back from injury or a break'], ['team', 'Train with my team']], d.goal))}
      <label class="k-label">Pick a common goal, or set your own</label>
      <div class="k-chips">${GOAL_PICKS.map(([l, ev, t], i) => html`<button type="button" class="k-chip ${d.goal_event === ev && d.goal_time === t ? 'on' : ''}" data-pick="${i}">${l}</button>`)}</div>
      <div class="k-row2">${cell('Race distance', sel('goal_event', [['', 'None yet'], ...GOAL_EVENTS.map((x) => [x, x])], d.goal_event))}${cell('Goal time', time('goal_time', 'e.g. 2:59:59'))}</div>
      <p class="k-small" id="kObPace">${m && sec ? `That’s ${clockOf(sec / (m / 1609.344))}/mi (${clockOf(sec / (m / 1000))}/km) the whole way.` : ''}</p>
      <div class="k-row2">${cell('Race name', html`<input class="k-input" name="goal_race_name" maxlength="80" placeholder="e.g. Boston" value="${d.goal_race_name ?? ''}">`)}${cell('Race date', html`<input class="k-input" name="goal_date" type="date" value="${d.goal_date ?? ''}">`)}</div>
      ${field('Why does this goal matter to you?', text('why', 'e.g. My dad never broke 3 hours. I want to do it for both of us.'), 'Your coach brings this up when training gets hard.')}
      ${field('What has gotten in the way before?', text('blockers', 'e.g. I get hurt when I add miles fast; school gets busy in March'))}
      ${field('A bigger goal, a year or more away', html`<input class="k-input" name="long_goal" maxlength="200" placeholder="e.g. Run Boston, break 17 in the 5K" value="${d.long_goal ?? ''}">`)}`;
    },
    coach: () => html`
      <label class="k-label">Other training you do</label>
      <div class="k-chips">${XT.map(([v, l]) => html`<label class="k-chip k-tick"><input type="checkbox" name="xtrain" value="${v}" ${(d.xtrain || []).includes(v) ? 'checked' : ''}><span>${l}</span></label>`)}</div>
      <p class="k-small">Log it in Train → Cross-train; your coach counts it in your load.</p>
      ${field('How do you eat?', sel('diet', [['', 'Prefer not to say'], ['none', 'Anything'], ['vegetarian', 'Vegetarian'], ['vegan', 'Vegan'], ['gluten_free', 'Gluten-free'], ['other', 'Something else']], d.diet))}
      ${field('Anything about fueling we should know?', html`<input class="k-input" name="fuel_notes" maxlength="200" placeholder="e.g. Gels upset my stomach; nut allergy" value="${d.fuel_notes ?? ''}">`)}
      ${field('How should your coach talk to you?', sel('coach_tone', [['', 'Whatever works'], ['encouraging', 'Encouraging and positive'], ['direct', 'Straight to the point'], ['detailed', 'The details and the why']], d.coach_tone))}
      ${edit ? '' : html`<label class="k-check"><input type="checkbox" name="age" ${d.age ? 'checked' : ''} required><span>I am 13 or older. If I'm under 18, a parent or guardian knows I'm using Kestrel. I agree to the <a href="/legal#terms" target="_blank" rel="noopener">Terms</a> and <a href="/legal#privacy" target="_blank" rel="noopener">Privacy Policy</a>, and I understand Kestrel is not medical advice.</span></label>
      <p class="k-small">Teammates see your name, colour, availability and RSVPs, plus your miles and recent activities unless you turn those off in You → Profile. Your health, goals, food log and predictions are only yours.</p>`}`,
  };
  const last = step === steps.length - 1;
  gate(html`<div class="k-auth narrow"><div class="k-steps" aria-label="Step ${step + 1} of ${steps.length}">${steps.map((n, i) => html`<i class="${i < step ? 'done' : i === step ? 'on' : ''}"></i>`)}</div>
    <div class="k-kicker">${edit ? 'Runner profile · ' : ''}Step ${step + 1} of ${steps.length}</div>
    <h2>${step === 0 && !edit ? 'Welcome to Kestrel' : S.title}</h2>
    <p class="k-small">${S.sub}</p>
    <form id="kOb" novalidate>${panels[S.key]()}
      <div class="k-nav">${step ? html`<button class="k-btn ghost" type="button" id="kObBack">Back</button>` : edit ? html`<button class="k-btn ghost" type="button" id="kObCancel">Cancel</button>` : ''}<button class="k-btn primary" style="flex:1">${last ? (edit ? 'Save' : 'Finish') : 'Continue'}</button></div>
      ${edit && !last ? html`<button class="k-link" type="button" id="kObSaveNow" style="margin-top:10px">Save and close</button>` : ''}
    </form></div>`);
  const grab = () => {
    const el = $('kOb');
    const f = form(el);
    for (const [k, v] of Object.entries(f)) d[k] = v;
    if (S.key === 'coach') { d.xtrain = [...el.querySelectorAll('[name=xtrain]:checked')].map((c) => c.value); if (!edit) d.age = !!f.age; }
  };
  if ($('kObAiGo')) $('kObAiGo').onclick = (e) => attempt(async () => {
    const text = $('kObAi').value;
    grab();
    const { fields: x } = await api('/api/me/parse', { method: 'POST', body: JSON.stringify({ text }) });
    let n = 0;
    const put = (k, v) => { if (v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length)) { d[k] = Array.isArray(v) ? v : String(v); n++; } };
    if (x.height_cm) {
      if (metric) put('height_cm', Math.round(x.height_cm));
      else { const inch = x.height_cm / 2.54; d.ft = String(Math.floor(inch / 12)); d.in = String(Math.round(inch % 12)); n++; }
    }
    if (x.weight_kg) put('weight', metric ? Math.round(x.weight_kg) : Math.round(x.weight_kg / 0.4536));
    for (const k of ['birth_year', 'sex', 'experience', 'weekly_miles', 'longest_run_mi', 'days_per_week', 'resting_hr', 'max_hr', 'watch', 'injuries', 'goal', 'goal_event', 'goal_time', 'goal_date', 'goal_race_name', 'why', 'long_goal', 'long_run_day', 'xtrain']) put(k, x[k]);
    for (const [ev, t] of Object.entries(x.prs || {})) put('pr' + ev, t);
    if (!n) { toast('I couldn’t find anything to fill in. Add a few details and try again.', true); return; }
    toast(`Filled in ${n} ${n === 1 ? 'field' : 'fields'}. Check each step, then finish.`);
    renderOnboarding(step, d, edit);
  }, e.currentTarget);
  document.querySelectorAll('#kOb [data-pick]').forEach((b) => { b.onclick = () => { grab(); const [, ev, t] = GOAL_PICKS[+b.dataset.pick]; d.goal = 'race'; d.goal_event = ev; d.goal_time = t; renderOnboarding(step, d, edit); }; });
  const paceEl = $('kObPace');
  if (paceEl) $('kOb').oninput = () => {
    const f = form($('kOb')); const sec = secOf(f.goal_time); const m = EVENT_M[f.goal_event];
    paceEl.textContent = m && sec ? `That’s ${clockOf(sec / (m / 1609.344))}/mi (${clockOf(sec / (m / 1000))}/km) the whole way.` : '';
  };
  if ($('kObBack')) $('kObBack').onclick = () => { grab(); renderOnboarding(step - 1, d, edit); };
  if ($('kObCancel')) $('kObCancel').onclick = () => { K.ob = null; openApp(); };
  const save = () => {
    // Blanks are null, not left out, so clearing a field in Edit runner profile clears it on the server too.
    const n = (v) => (v === '' || v == null ? null : Number(v));
    const height_cm = metric ? n(d.height_cm) : (d.ft || d.in) ? Math.round((Number(d.ft || 0) * 12 + Number(d.in || 0)) * 2.54) : null;
    const weight_kg = d.weight ? (metric ? Number(d.weight) : Math.round(Number(d.weight) * 0.4536 * 10) / 10) : null;
    const prs = {};
    for (const ev of ['800', '1600', '3200', '5K']) if (d['pr' + ev]) prs[ev] = { time: d['pr' + ev].trim() };
    const keep = ['units', 'experience', 'goal', 'goal_event', 'goal_time', 'goal_date', 'goal_race_name', 'injuries', 'watch', 'why', 'blockers', 'long_goal', 'long_run_day', 'rest_day', 'run_time', 'likes', 'diet', 'fuel_notes', 'coach_tone'];
    const profile = { height_cm, weight_kg, weekly_miles: n(d.weekly_miles), birth_year: n(d.birth_year), longest_run_mi: n(d.longest_run_mi), days_per_week: n(d.days_per_week), resting_hr: n(d.resting_hr), max_hr: n(d.max_hr), xtrain: d.xtrain || [] };
    for (const k of keep) profile[k] = d[k] ?? '';
    return api('/api/me', { method: 'PUT', body: JSON.stringify({
      name: d.name, sex: d.sex || '', class_year: d.class_year || '', weekly_miles: n(d.weekly_miles) ?? undefined, ...(edit ? {} : { age_ok: true }), profile, ...(edit ? {} : { prs }),
    }) });
  };
  const finishEdit = async () => {
    K.me = await save();
    await api('/api/me/goal-from-profile', { method: 'POST', body: '{}' }).catch(() => null);
    K.ob = null;
    toast('Runner profile saved.');
    openApp();
    await window.kestrelReload();
  };
  if ($('kObSaveNow')) $('kObSaveNow').onclick = (e) => { grab(); attempt(finishEdit, e.currentTarget); };
  $('kOb').onsubmit = (e) => {
    e.preventDefault();
    if (!e.target.checkValidity()) { e.target.reportValidity(); return; }
    grab();
    if (!last) { renderOnboarding(step + 1, d, edit); return; }
    if (edit) { attempt(finishEdit, e.submitter); return; }
    if (!d.age) { toast('Please confirm your age to continue.', true); return; }
    attempt(async () => {
      K.me = await save();
      const watch = d.watch;
      K.ob = null;
      await api('/api/me/goal-from-profile', { method: 'POST', body: '{}' }).catch(() => null);
      if (watch && watch !== 'none') { renderWatchSetup(watch, false); return; }
      await finishSetup();
    }, e.submitter);
  };
}

// You > Profile: edit the intake later, starting at a step (1 = Body, for "Add your weight").
window.kestrelEditRunner = (step = 0) => { renderOnboarding(step, obFromProfile(), true); };

// ---------- connecting a watch through intervals.icu

const BRAND = { garmin: 'Garmin', coros: 'COROS', suunto: 'Suunto', polar: 'Polar', wahoo: 'Wahoo' };
const ARROW = raw('<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" style="vertical-align:-2px"><path d="M7 17 17 7M9 7h8v8" fill="none" stroke="currentColor" stroke-width="2"/></svg>');

// How the pieces fit: the watch brand sends runs to intervals.icu officially, Kestrel reads them with the runner's own
// API key (encrypted at rest), and writes the plan back as workouts named "Kestrel:" that the watch picks up.
const FLOW = raw(`<div class="k-flow" aria-label="Your watch sends runs to intervals.icu; Kestrel reads them there and sends your plan back">
  <div class="k-flow-n"><b>Your watch</b><span>records the run</span></div>
  <div class="k-flow-a" aria-hidden="true"><i><em>runs →</em><u>↓ runs</u></i><i><em>← plan</em><u>↑ plan</u></i></div>
  <div class="k-flow-n mid"><b>intervals.icu</b><span>free, official link</span></div>
  <div class="k-flow-a" aria-hidden="true"><i><em>runs →</em><u>↓ runs</u></i><i><em>← plan</em><u>↑ plan</u></i></div>
  <div class="k-flow-n k"><b>Kestrel</b><span>coach, log, fitness</span></div></div>`);

// One step of the checklist. Ticking it is just for the runner (kept on this device) so they can leave and come back.
function wstep(watch, n, title, body, link) {
  const done = (store.get('kestrel.wsteps.' + watch) || []).includes(n);
  return html`<li class="k-wstep ${done ? 'done' : ''}" data-step="${n}">
    <button type="button" class="k-wtick" data-tick="${n}" aria-pressed="${done}" aria-label="${done ? 'Done' : 'Mark as done'}: ${title}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7"/></svg></button>
    <div><b>${title}</b><div class="k-wbody">${body}</div>${link ? html`<a class="k-wlink" href="${link[0]}" target="_blank" rel="noopener">${link[1]} ${ARROW}</a>` : ''}</div></li>`;
}

// The steps for one kind of watch.
function watchSteps(watch) {
  const brand = BRAND[watch];
  const account = (n) => wstep(watch, n, 'Make a free intervals.icu account', 'Sign up with your email or Google. Kestrel never sees your intervals.icu password.', ['https://intervals.icu', 'Open intervals.icu']);
  const keys = (n) => wstep(watch, n, 'Copy your Athlete ID and API key', html`In intervals.icu open <b>Settings</b> and scroll to the very bottom, to <b>Developer Settings</b>. Copy the <b>Athlete ID</b> (like <code>i123456</code>) and the <b>API key</b>. No key yet? Tap <b>Generate</b>. The key works like a password: paste it only into the box below.`, ['https://intervals.icu/settings', 'Open Settings']);
  if (brand) return html`<ol class="k-wsteps">${account(1)}
    ${wstep(watch, 2, `Link your ${brand}`, html`In intervals.icu go to <b>Settings → Connections</b>, tap <b>${brand}</b> and sign in. ${watch === 'garmin' ? html`Allow <b>both</b> Garmin permissions (activities, and training/workouts) so your plan reaches your watch.` : 'Allow it to share activities and workouts.'} On the same card, choose to <b>download older activities</b> so your history comes across.`, ['https://intervals.icu/settings', 'Open Connections'])}
    ${keys(3)}</ol>`;
  if (watch === 'apple') return html`<ol class="k-wsteps">${account(1)}
    ${wstep(watch, 2, 'Send Apple Watch runs to intervals.icu', html`Apple Health can’t talk to intervals.icu on its own, so an iPhone app does it. <b>HealthFit</b> or <b>RunGap</b>: install one, connect it to intervals.icu, and turn on automatic upload for runs and cross-training.`)}
    ${keys(3)}</ol>`;
  if (watch === 'strava') return html`<div class="k-note"><b>Strava on its own won’t work.</b> Strava doesn’t let intervals.icu pass your runs on to other apps, so Kestrel would get nothing. Whatever sends your runs to Strava (Garmin, COROS, Suunto, Polar, Wahoo, or HealthFit on Apple Watch) can almost always send them to intervals.icu too: pick it above. Or log runs by hand, or record with your phone on the Record button.</div>`;
  return html`<div class="k-note">Most watches can send runs to intervals.icu (its Settings → Connections lists them). If yours can, link it there, then follow these steps. If not, log runs by hand or record them with your phone.</div><ol class="k-wsteps">${account(1)}${keys(2)}</ol>`;
}

function renderWatchSetup(watch, fromApp) {
  const brands = [['garmin', 'Garmin'], ['coros', 'COROS'], ['apple', 'Apple Watch'], ['suunto', 'Suunto'], ['polar', 'Polar'], ['wahoo', 'Wahoo'], ['strava', 'Strava'], ['other', 'Other']];
  const canConnect = watch !== 'strava';
  gate(html`<div class="k-auth narrow k-watch">
    <div class="k-kicker">${fromApp ? 'Watch sync' : 'Last step'}</div>
    <h2>Connect your watch</h2>
    <p class="k-small">About 5 minutes, once. After that every run (and ride, swim or lift) lands in Kestrel by itself, and your plan shows up on your watch.</p>
    ${FLOW}
    <details class="k-help k-why"><summary>Why go through intervals.icu?</summary>
      <p>Garmin, COROS and the other watch makers only open their data to approved companies, and approval costs money a free app doesn’t have. intervals.icu is a free training site that every major watch already sends runs to officially. Kestrel reads your runs from there with a key you give it, so Kestrel stays free and you stay in control: delete the key in intervals.icu, or tap Disconnect in Kestrel, and the link is gone.</p>
      <p><b>What Kestrel reads:</b> your activities, laps, heart rate, GPS route (only shown to you) and wellness (sleep, resting HR, HRV). <b>What it writes:</b> only planned workouts named “Kestrel:”. Your key is stored encrypted.</p></details>
    <div class="k-kicker k-wq">Which watch do you use?</div>
    <div class="k-chips" role="radiogroup" aria-label="Your watch">${brands.map(([v, l]) => html`<button type="button" class="k-chip ${v === watch ? 'on' : ''}" data-watch="${v}" role="radio" aria-checked="${v === watch}">${l}</button>`)}</div>
    ${watchSteps(watch)}
    ${canConnect ? html`<form id="kWForm" class="k-wform">
      <div class="k-wform-h"><b>Paste them here</b><span class="k-small">Kestrel checks them straight away.</span></div>
      <label class="k-label" for="kWId">Athlete ID</label><input class="k-input mono" id="kWId" name="id" placeholder="i123456 (or paste your intervals.icu link)" autocomplete="off" autocapitalize="off" spellcheck="false" inputmode="text" required>
      <label class="k-label" for="kWKey">API key</label><input class="k-input mono" id="kWKey" name="key" type="password" placeholder="Paste key" autocomplete="off" required>
      <p class="k-small" id="kWMsg" role="status"></p>
      <button class="k-btn primary wide">Connect</button>
    </form>` : ''}
    <details class="k-help"><summary>Something not working?</summary><ul class="k-list">
      <li><b>“Athlete ID looks like i123456”</b>: copy it from Developer Settings at the bottom of intervals.icu Settings. You can also paste the link to your intervals.icu page.</li>
      <li><b>“Not authorised” or 403</b>: the key was copied short or regenerated since. Copy it again from Developer Settings.</li>
      <li><b>Connected but no runs?</b> Check intervals.icu shows your runs first. If it doesn’t, unlink and relink your watch there (for Garmin, also remove intervals.icu in Garmin Connect → Settings → Connected Apps, then connect again from intervals.icu).</li>
      <li><b>Plan not on your watch?</b> In intervals.icu → Settings → Connections, turn on uploading planned workouts to your watch, then tap Sync in Kestrel.</li>
      <li><b>How often does it sync?</b> Kestrel checks for new runs on its own through the day. Tap Sync at the top of the app to check now.</li>
    </ul></details>
    <div class="k-nav"><button class="k-btn ghost" type="button" id="kWSkip" style="flex:1">${fromApp ? 'Back to Kestrel' : 'I’ll do this later'}</button></div>
    ${fromApp ? '' : html`<p class="k-small">You can connect any time in You → Watch and data.</p>`}
  </div>`);
  document.querySelectorAll('[data-watch]').forEach((b) => { b.onclick = () => renderWatchSetup(b.dataset.watch, fromApp); });
  document.querySelectorAll('[data-tick]').forEach((b) => { b.onclick = () => {
    const k = 'kestrel.wsteps.' + watch, n = +b.dataset.tick, cur = store.get(k) || [];
    const next = cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n];
    store.set(k, next);
    const li = b.closest('.k-wstep'), on = next.includes(n);
    li.classList.toggle('done', on); b.setAttribute('aria-pressed', String(on));
  }; });
  const done = async () => { if (fromApp) { openApp(); await window.kestrelReload(); } else await finishSetup(); };
  $('kWSkip').onclick = () => attempt(done);
  if (!canConnect) return;
  // Digits only, or a pasted link: turn it into the ID intervals.icu means.
  $('kWId').oninput = (e) => { const v = e.target.value.trim(), m = v.match(/athlete\/(i?\d{1,12})/i); if (m) e.target.value = /^i/i.test(m[1]) ? m[1] : 'i' + m[1]; else if (/^\d+$/.test(v)) e.target.value = 'i' + v; };
  $('kWForm').onsubmit = (e) => {
    e.preventDefault();
    const f = form(e.target);
    const msg = $('kWMsg');
    msg.className = 'k-small'; msg.textContent = 'Checking with intervals.icu…';
    attempt(async () => {
      try {
        const r = await api('/api/intervals/connect', { method: 'POST', body: JSON.stringify({ athleteId: f.id.trim(), apiKey: f.key.trim() }) });
        msg.textContent = `Connected${r.name ? ` to ${r.name}` : ''}. Pulling in your recent runs…`;
        const s = await api('/api/intervals/sync', { method: 'POST', body: '{}' }).catch(() => null);
        api('/api/intervals/import', { method: 'POST', body: '{}' }).catch(() => null);
        msg.className = 'k-small k-good';
        msg.textContent = `Connected.${s?.imported != null ? ` ${s.imported} recent ${s.imported === 1 ? 'activity' : 'activities'} in.` : ''} Your older history keeps importing in the background.${s?.note ? ' ' + s.note : ''}`;
        store.del('kestrel.wsteps.' + watch);
        toast('Watch connected.');
        setTimeout(() => attempt(done), 1600);
      } catch (err) { msg.className = 'k-small k-bad'; msg.textContent = err.message; }
    }, e.submitter);
  };
}
window.kestrelWatchSetup = (watch) => renderWatchSetup(watch || K.me?.profile?.watch || 'garmin', true);

function renderTeamStart(back = false) {
  gate(html`<div class="k-start">
    ${back ? html`<button class="k-link" type="button" id="kBack">← Back to Kestrel</button>` : ''}
    <div class="k-kicker">Teams</div>
    <h1 class="k-title">Your team</h1>
    <p class="k-lede">Kestrel works around a team calendar. Start one for your school, or join yours with the code a teammate sends you.</p>
    <div class="k-two">
      <section class="k-panel"><h2>Start a team</h2><p class="k-small">You'll get an invite code to share. As the owner you manage the calendar, name captains and, with them, build the team's training plan; you never see anyone's training.</p>
        <form id="kNewTeam">
          <label class="k-label" for="kTn">Team name</label><input class="k-input" id="kTn" name="name" placeholder="Varsity Cross Country" maxlength="80" required>
          <label class="k-label" for="kTs">School</label><input class="k-input" id="kTs" name="school" placeholder="Lincoln High School" maxlength="120">
          <button class="k-btn primary">Create team</button>
        </form></section>
      <section class="k-panel"><h2>Join a team</h2><p class="k-small">Ask a teammate for the invite code or link.</p>
        <form id="kJoin"><label class="k-label" for="kJc">Invite code</label><input class="k-input mono" id="kJc" name="code" maxlength="20" required style="text-transform:uppercase">
          <button class="k-btn primary">Join</button></form></section>
    </div>
    ${back ? '' : html`<p class="k-small">Training on your own? <button class="k-link" type="button" id="kSolo">Skip for now</button>: your coach, log and race predictions work without a team.</p>`}
  </div>`);
  const done = async (id, msg) => { K.teamId = id; store.set('kestrel.team', id); await refreshMe(); toast(msg); start(); };
  $('kNewTeam').onsubmit = (e) => { e.preventDefault(); attempt(async () => { const r = await api('/api/teams', { method: 'POST', body: JSON.stringify(form(e.target)) }); await done(r.id, 'Team created. Share the invite code from the Team tab.'); }, e.submitter); };
  $('kJoin').onsubmit = (e) => { e.preventDefault(); attempt(async () => { const r = await api('/api/teams/join', { method: 'POST', body: JSON.stringify(form(e.target)) }); await done(r.id, 'You joined the team.'); }, e.submitter); };
  if ($('kSolo')) $('kSolo').onclick = () => { store.set('kestrel.solo', true); start(); };
  if ($('kBack')) $('kBack').onclick = () => openApp();
}

// ---------- signed in

async function refreshMe() {
  K.me = await api('/api/me');
  K.teams = K.me.teams;
  const ids = K.teams.map((t) => t.id);
  const saved = store.get('kestrel.team');
  if (!ids.includes(K.teamId)) K.teamId = ids.includes(saved) ? saved : ids[0] || null;
  K.role = K.teams.find((t) => t.id === K.teamId)?.role || null;
}

let signingIn = null;
function afterSignIn() {
  if (!signingIn) signingIn = (async () => {
    if (K.me) return;
    const me = await attempt(() => api('/api/me'));
    if (!me) { renderLanding(); return; }
    K.me = me;
    if (!me.user.age_ok) { renderOnboarding(); return; }
    await finishSetup();
  })().finally(() => { signingIn = null; });
  return signingIn;
}

async function finishSetup() {
  const code = store.get('kestrel.join');
  if (code) {
    store.del('kestrel.join');
    const r = await attempt(() => api('/api/teams/join', { method: 'POST', body: JSON.stringify({ code }) }));
    if (r) { K.teamId = r.id; store.set('kestrel.team', r.id); toast('You joined the team.'); }
  }
  await refreshMe();
  if (!K.teams.length && !store.get('kestrel.solo')) { renderTeamStart(); return; }
  await start();
  offerPlan();
}

// A new account has no training plan. Offer to build one with Kestrel AI the first time, once.
async function offerPlan() {
  if (store.get(`kestrel.planOffered.${K.me.user.id}`)) return;
  const r = await api('/api/me/plan').catch(() => null);
  if (!r || r.custom || r.team_plan) return;
  store.set(`kestrel.planOffered.${K.me.user.id}`, true);
  openPlanBuilder({ team: false, current: null, onSaved: () => window.kestrelReload() });
}

// Shows the app, starting it the first time and reloading it on a team switch.
async function start() {
  openApp();
  applyAccent();
  renderHeader();
  if (!K.started) {
    K.started = true;
    await window.kestrelInit();
  } else {
    await window.kestrelReload();
  }
}

function renderHeader() {
  const t = $('kTeam');
  t.innerHTML = html`${K.teams.length
    ? html`<select id="kTeamPick" aria-label="Team">${K.teams.map((x) => html`<option value="${x.id}" ${x.id === K.teamId ? raw('selected') : ''}>${x.name}</option>`)}</select>`
    : html`<span class="k-small">No team</span>`}<button type="button" class="k-btn small" id="kAddTeam">+ Team</button>`.s;
  const pick = $('kTeamPick');
  if (pick) pick.onchange = async () => {
    K.teamId = pick.value;
    K.role = K.teams.find((x) => x.id === K.teamId)?.role || null;
    store.set('kestrel.team', K.teamId);
    await window.kestrelReload();
  };
  $('kAddTeam').onclick = () => renderTeamStart(true);
  const w = $('kWho');
  const u = K.me.user;
  w.innerHTML = html`<span class="k-avatar" style="background:${u.color}">${(u.name || 'You').trim().slice(0, 1).toUpperCase()}</span><span class="k-who-name">${u.name || 'You'}</span>`.s;
  w.setAttribute('aria-label', `${u.name || 'You'}: profile`);
  w.onclick = () => window.kestrelSetPage('you', 'profile');
}

// Profile save (You > Profile)
window.kestrelSaveProfile = async (fields) => {
  const me = await attempt(() => api('/api/me', { method: 'PUT', body: JSON.stringify(fields) }));
  if (!me) return null;
  K.me = me;
  renderHeader();
  return me;
};

// ---------- Team tab: the team card (members, invite, owner tools)

window.kestrelRenderTeamCard = async (el) => {
  if (!el) return;
  if (!K.teamId) {
    el.innerHTML = html`<p class="k-small">You're not on a team yet.</p><button class="k-btn primary" type="button" id="kTcStart">Start or join a team</button>`.s;
    $('kTcStart').onclick = () => renderTeamStart(true);
    return;
  }
  const team = await attempt(() => api(`/api/teams/${K.teamId}`));
  if (!team) return;
  const owner = team.role === 'owner';
  const lead = owner || team.role === 'captain';
  const link = `${location.origin}/join/${team.invite_code}`;
  if ($('teamTitle')) $('teamTitle').textContent = team.name;
  el.innerHTML = html`
    ${team.school ? html`<div class="k-small">${team.school}</div>` : ''}
    <div class="k-invite"><span class="k-code">${team.invite_code}</span>
      <button class="k-btn small" type="button" id="kCopyInvite">Copy invite link</button>
      ${owner ? html`<button class="k-link" type="button" id="kNewCode">New code</button>` : ''}</div>
    <p class="k-small">Anyone with the code can join, so share it only with your team.</p>
    <div class="k-members">${team.members.map((m) => html`<div class="k-member"><span class="dot" style="background:${m.color}"></span><span class="grow">${m.name || 'Unnamed'}${m.id === K.me.user.id ? ' (you)' : ''}</span>
      ${m.role === 'owner' ? html`<span class="badge">owner</span>` : m.role === 'captain' ? html`<span class="badge">captain</span>` : ''}
      ${owner && m.id !== K.me.user.id ? html`<button class="k-link danger" type="button" data-remove="${m.id}">Remove</button>` : ''}</div>`)}</div>
    <div class="k-row">
      ${lead ? html`<button class="k-btn small" type="button" id="kAdmin">Manage calendar</button><button class="k-btn small" type="button" id="kPlanEdit">Team plan${team.has_plan ? ' (custom)' : ''}</button>` : ''}${owner ? html`<button class="k-btn small" type="button" id="kRename">Rename</button>` : ''}
      <button class="k-link danger" type="button" id="kLeave">Leave team</button>
    </div>`.s;
  $('kCopyInvite').onclick = async () => { try { await navigator.clipboard.writeText(link); toast('Invite link copied.'); } catch { prompt('Copy this invite link:', link); } };
  if ($('kNewCode')) $('kNewCode').onclick = (e) => attempt(async () => { if (!confirm('Make a new invite code? The old code and link stop working.')) return; await api(`/api/teams/${K.teamId}/code`, { method: 'POST' }); window.kestrelRenderTeamCard(el); }, e.currentTarget);
  if ($('kAdmin')) $('kAdmin').onclick = () => window.openTeamAdmin();
  if ($('kPlanEdit')) $('kPlanEdit').onclick = () => window.kestrelSetPage('team', 'training');
  if ($('kRename')) $('kRename').onclick = (e) => attempt(async () => {
    const name = prompt('Team name', team.name);
    if (!name) return;
    const school = prompt('School', team.school) ?? team.school;
    await api(`/api/teams/${K.teamId}`, { method: 'PUT', body: JSON.stringify({ name, school }) });
    await refreshMe(); renderHeader(); window.kestrelRenderTeamCard(el);
  }, e.currentTarget);
  el.querySelectorAll('[data-remove]').forEach((b) => {
    b.onclick = () => attempt(async () => {
      if (!confirm('Remove them from the team?')) return;
      await api(`/api/teams/${K.teamId}/members/${b.dataset.remove}`, { method: 'DELETE' });
      window.kestrelRenderTeamCard(el);
    }, b);
  });
  $('kLeave').onclick = (e) => attempt(async () => {
    if (!confirm(team.members.length === 1 ? 'You are the last member. Leaving deletes the team and its calendar. Leave?' : 'Leave this team?')) return;
    await api(`/api/teams/${K.teamId}/members/${K.me.user.id}`, { method: 'DELETE' });
    K.teamId = null; store.del('kestrel.team');
    await refreshMe(); renderHeader(); await window.kestrelReload();
  }, e.currentTarget);
};

// ---------- Team tab: activities (a feed of teammates' recent runs, newest first, back through their history)

const ACT_LABEL = { easy: 'Easy run', recovery: 'Recovery run', long: 'Long run', workout: 'Workout', race: 'Race', shakeout: 'Shakeout', crosstrain: 'Cross-training', intervals: 'Intervals', tempo: 'Tempo', threshold: 'Threshold' };
const actDay = (d) => {
  const day = new Date(d + 'T12:00:00');
  const diff = Math.round((new Date().setHours(12, 0, 0, 0) - day) / 86400000);
  return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : day.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: diff > 300 ? 'numeric' : undefined });
};
const actTime = (m) => (m == null ? '' : m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m} min`);

function activityCard(a) {
  const kind = a.label || ACT_LABEL[a.category] || 'Run';
  const stats = [
    a.miles ? [String(a.miles), 'mi'] : null, a.minutes ? [actTime(a.minutes), 'time'] : null, a.pace ? [a.pace, '/mi'] : null,
    a.avg_hr ? [String(a.avg_hr), 'bpm'] : null, a.elev_ft && !a.track ? [String(a.elev_ft), 'ft up'] : null,
  ].filter(Boolean);
  const mine = a.person.id === K.me.user.id;
  return html`<article class="k-act">
    <header><span class="dot" style="background:${a.person.color}"></span><b>${a.person.name || 'Unnamed'}${mine ? ' (you)' : ''}</b><span class="k-small">${actDay(a.date)}${a.start ? ' · ' + a.start : ''}</span></header>
    <div class="k-act-title">${a.title || kind}</div>
    <div class="k-act-meta"><span class="badge ${a.category === 'workout' || a.category === 'race' ? 'tone-race' : ''}">${kind}</span>${a.manual ? html` <span class="k-small">Logged by hand</span>` : ''}${a.parts > 1 ? html` <span class="k-small">${a.parts} activities in one session</span>` : ''}${a.private ? html` <span class="k-small">Only you can see this. Turn on activity sharing in You → Profile.</span>` : ''}</div>
    <div class="k-act-stats">${stats.map(([v, l]) => html`<span><b>${v}</b><small>${l}</small></span>`)}</div>
  </article>`;
}

const actsShown = { team: null, html: '' };
window.kestrelRenderActivities = async (el) => {
  if (!el || !K.teamId) return;
  const teamId = K.teamId;
  el.innerHTML = html`<section class="card">
      <div class="section-head"><div>
        <div class="card-title">Activities</div>
        <div class="hint">Recent runs from teammates who share them, newest first, going back through their training. Turn yours off in You → Profile.</div>
      </div></div>
      <div class="k-acts" id="kActs">${raw(actsShown.team === teamId ? actsShown.html : html`<p class="k-small">Loading…</p>`.s)}</div>
      <div class="k-row"><button class="k-btn" type="button" id="kActsMore" hidden>Load older activities</button></div>
    </section>`.s;
  const list = $('kActs'), more = $('kActsMore');
  let next = null, first = true;
  const load = async () => {
    const out = await attempt(() => api('/api/team/activities' + (next ? '?before=' + encodeURIComponent(next) : '')), more);
    if (K.teamId !== teamId || !list.isConnected) return;
    if (!out) { if (first && actsShown.team !== teamId) list.innerHTML = html`<p class="k-small">Couldn’t load activities. Check your connection.</p>`.s; return; }
    // The first page replaces the last one shown in a single swap (shown meanwhile, so a redraw never empties the list).
    const cards = out.activities.map((a) => activityCard(a).s).join('');
    if (first) {
      list.innerHTML = out.activities.length ? cards : html`<p class="k-small">No activities yet. They appear when teammates connect a watch or log their runs.</p>`.s;
      actsShown.team = teamId; actsShown.html = list.innerHTML;
    } else list.insertAdjacentHTML('beforeend', cards);
    first = false;
    next = out.next;
    more.hidden = !next;
  };
  more.onclick = load;
  await load();
};

// ---------- Team tab: roster

const isLead = () => K.role === 'owner' || K.role === 'captain';

window.kestrelRenderRoster = async (el) => {
  if (!el || !K.teamId) return;
  const teamId = K.teamId;
  const [r, mi] = await Promise.all([
    attempt(() => api(`/api/teams/${teamId}/roster`)),
    api('/api/team').catch(() => null),
  ]);
  if (!r || K.teamId !== teamId || !el.isConnected) return;
  const miles = new Map((mi?.athletes || []).map((a) => [a.id, a]));
  const me = K.me.user.id;
  const lead = r.role === 'owner' || r.role === 'captain';
  const owner = r.role === 'owner';
  const again = () => window.kestrelRenderRoster(el);
  el.innerHTML = html`<section class="card">
      <div class="section-head k-roster-head"><div>
        <div class="card-title">Roster</div>
        <div class="hint">${r.members.length} on the team. Everyone sees name, number, grade and events. ${lead ? 'Age is shown only to you and the person.' : 'Your age is shown only to you, the owner and captains.'}</div>
      </div><button class="k-btn small primary k-add" type="button" id="kRosterAdd">${raw(ICON_ADD)}<span>${lead ? 'Add athletes' : 'Invite'}</span></button></div>
      <div class="k-table" role="table" aria-label="Team roster">
        <div class="k-tr k-th" role="row"><span role="columnheader">#</span><span role="columnheader">Name</span><span role="columnheader">Grade</span><span role="columnheader">Age</span><span role="columnheader">Events</span><span role="columnheader">Week</span><span></span></div>
        ${r.members.map((m) => html`<div class="k-tr" role="row">
          <span class="k-num">${m.jersey || '–'}</span>
          <span class="k-name"><span class="dot" style="background:${m.color}"></span><span>${m.name || 'Unnamed'}${m.id === me ? ' (you)' : ''}</span>${m.role === 'owner' ? html`<span class="badge">owner</span>` : m.role === 'captain' ? html`<span class="badge">captain</span>` : ''}</span>
          <span>${m.class_year || '–'}</span>
          <span>${m.age ?? '–'}</span>
          <span class="k-ev">${m.events || '–'}</span>
          <span class="num">${miles.has(m.id) ? miles.get(m.id).this_week : html`<small title="Not sharing miles">·</small>`}</span>
          <span>${lead || m.id === me ? html`<button class="k-link" type="button" data-edit="${m.id}">Edit</button>` : ''}</span>
        </div>`)}
      </div>
      ${r.members.length < 2 ? html`<div class="k-roster-empty"><p class="k-small">It’s just you so far. Send teammates the invite link and they join as soon as they sign in.</p><button class="k-btn small" type="button" id="kRosterAdd2">Invite teammates</button></div>` : ''}
    </section>`.s;
  $('kRosterAdd').onclick = () => openInvite(again);
  if ($('kRosterAdd2')) $('kRosterAdd2').onclick = () => openInvite(again);
  el.querySelectorAll('[data-edit]').forEach((b) => {
    b.onclick = () => editRosterEntry(r.members.find((m) => m.id === b.dataset.edit), { lead, owner }, again);
  });
};

const ICON_ADD = '<svg class="k-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';

// Adding athletes: everyone has their own Kestrel account, so a teammate is added by sending them the team's invite.
// They open the link (or type the code under + Team), sign in, and land on the roster.
async function openInvite(done) {
  const team = await attempt(() => api(`/api/teams/${K.teamId}`));
  if (!team) return;
  const owner = team.role === 'owner';
  const d = dialog();
  const paint = (t) => {
    const link = `${location.origin}/join/${t.invite_code}`;
    const msg = `Join ${t.name} on Kestrel: ${link}`;
    d.innerHTML = html`<h2>Add athletes</h2>
      <p class="k-small">Send this link to your teammates. When they open it and sign in, they join ${t.name} and show up on the roster.</p>
      <div class="k-invite-box">
        <div class="k-invite-code"><span class="k-small">Invite code</span><span class="k-code" id="kInvCode">${t.invite_code}</span></div>
        <div class="k-invite-link"><input class="k-input" id="kInvLink" readonly value="${link}" aria-label="Invite link"><button class="k-btn primary" type="button" id="kInvCopy" autofocus>Copy link</button></div>
      </div>
      <div class="k-invite-share">
        ${typeof navigator.share === 'function' ? html`<button class="k-btn" type="button" id="kInvShare">Share…</button>` : ''}
        <a class="k-btn" href="${'sms:?&body=' + encodeURIComponent(msg)}">Text</a>
        <a class="k-btn" href="${'mailto:?subject=' + encodeURIComponent(`Join ${t.name} on Kestrel`) + '&body=' + encodeURIComponent(msg)}">Email</a>
      </div>
      <p class="k-small">They can also tap <b>+ Team</b> and type the code. Anyone with it can join, so share it only with your team.${owner ? ' Make a new code if it gets out: the old one stops working.' : ''}</p>
      <div class="k-row k-dialog-foot">${owner ? html`<button class="k-link" type="button" id="kInvNew">Make a new code</button>` : ''}<button class="k-btn" type="button" id="kInvClose">Done</button></div>`.s;
    $('kInvClose').onclick = () => d.close();
    $('kInvLink').onfocus = (e) => e.target.select();
    $('kInvCopy').onclick = async (e) => {
      try { await navigator.clipboard.writeText(link); } catch { $('kInvLink').select(); document.execCommand?.('copy'); }
      const b = e.currentTarget; b.textContent = 'Copied'; setTimeout(() => { if (b.isConnected) b.textContent = 'Copy link'; }, 1600);
    };
    if ($('kInvShare')) $('kInvShare').onclick = () => navigator.share({ title: `Join ${t.name} on Kestrel`, text: `Join ${t.name} on Kestrel`, url: link }).catch(() => {});
    if ($('kInvNew')) $('kInvNew').onclick = (e) => attempt(async () => {
      if (!confirm('Make a new invite code? The old code and link stop working.')) return;
      paint(await api(`/api/teams/${K.teamId}/code`, { method: 'POST' }));
      toast('New invite code made.');
    }, e.currentTarget);
  };
  paint(team);
  d.onclose = () => { d.onclose = null; done?.(); };
  if (!d.open) d.showModal();
}

function editRosterEntry(m, perms, done) {
  const d = dialog();
  const self = m.id === K.me.user.id;
  d.innerHTML = html`<h2>${self ? 'Your roster details' : m.name}</h2>
    <form id="kRosterForm">
      <div><label class="k-label" for="kRJersey">Jersey number</label><input class="k-input" id="kRJersey" name="jersey" maxlength="6" value="${m.jersey}" inputmode="numeric"></div>
      <div><label class="k-label" for="kRAge">Age</label><input class="k-input" id="kRAge" name="age" type="number" min="8" max="99" value="${m.age ?? ''}"><p class="k-small">Optional. Only you, the owner and captains see it.</p></div>
      <div><label class="k-label" for="kREvents">Events</label><input class="k-input" id="kREvents" name="events" maxlength="80" value="${m.events}" placeholder="e.g. 800, 1600, 4x400"></div>
      ${perms.owner && m.role !== 'owner' ? html`<label class="k-check"><input type="checkbox" name="leader" ${m.role === 'captain' ? 'checked' : ''}><span>Team captain. Captains can edit the roster, manage the calendar and build the team training plan.</span></label>` : ''}
      <div class="k-row k-dialog-foot">${self ? html`<button class="k-link danger" type="button" id="kRLeave">Leave team</button>` : perms.owner ? html`<button class="k-link danger" type="button" id="kRRemove">Remove from team</button>` : ''}<button class="k-btn" type="button" id="kRClose">Cancel</button><button class="k-btn primary" type="submit">Save</button></div>
    </form>`.s;
  d.onclose = null;
  d.showModal();
  $('kRClose').onclick = () => d.close();
  if ($('kRRemove')) $('kRRemove').onclick = (e) => attempt(async () => {
    if (!confirm(`Remove ${m.name || 'them'} from the team? They can rejoin with the invite code.`)) return;
    await api(`/api/teams/${K.teamId}/members/${m.id}`, { method: 'DELETE' });
    d.close(); toast(`${m.name || 'They'} left the roster.`); done();
  }, e.currentTarget);
  if ($('kRLeave')) $('kRLeave').onclick = (e) => attempt(async () => {
    const n = (await api(`/api/teams/${K.teamId}/roster`)).members.length;
    if (!confirm(n === 1 ? 'You are the last member. Leaving deletes the team and its calendar. Leave?' : 'Leave this team?')) return;
    await api(`/api/teams/${K.teamId}/members/${K.me.user.id}`, { method: 'DELETE' });
    d.close();
    K.teamId = null; store.del('kestrel.team');
    await refreshMe(); renderHeader(); await window.kestrelReload();
  }, e.currentTarget);
  $('kRosterForm').onsubmit = (e) => {
    e.preventDefault();
    const f = e.target;
    const body = { jersey: f.jersey.value.trim(), age: f.age.value, events: f.events.value.trim() };
    if (f.leader) body.leader = f.leader.checked;
    attempt(async () => {
      await api(`/api/teams/${K.teamId}/members/${m.id}`, { method: 'PUT', body: JSON.stringify(body) });
      d.close(); await refreshMe(); renderHeader(); done();
    });
  };
}

// ---------- Team tab: training plan (owner and captains build it with Kestrel AI)

// Everything is fetched first and swapped in at once, so a refresh never empties the page (no flash, no scroll jump).
window.kestrelRenderTeamTraining = async (el) => {
  if (!el || !K.teamId) return;
  const teamId = K.teamId;
  const r = await attempt(() => api(`/api/teams/${teamId}/plan`));
  if (!r) return;
  const lead = isLead();
  // Your own plan marks your level on the table; any reload clears it, so it is fetched alongside.
  const [lv, wk] = await Promise.all([
    lead && r.custom ? attempt(() => api(`/api/teams/${teamId}/plan/levels`)) : null,
    lead && r.custom ? attempt(() => api(`/api/teams/${teamId}/plan/weeks`)) : null,
    r.custom ? window.kestrelLoadKai?.().catch(() => null) : null,
  ]);
  if (K.teamId !== teamId || !el.isConnected) return;
  const again = () => window.kestrelRenderTeamTraining(el);
  el.innerHTML = html`<section class="card">
      <div class="section-head"><div>
        <div class="card-title">Team plan</div>
        <div class="hint">${r.custom ? (r.spec?.name || 'Custom plan') : 'No team plan yet.'}</div>
      </div></div>
      ${r.custom
        ? html`${r.spec?.summary ? html`<p class="k-small">${r.spec.summary}</p>` : ''}<p class="k-small">Each row is a level, by weekly miles. Every athlete trains from the level you put them on, and their own Kestrel AI coach adapts it day to day.${lead ? ' Tap a number to change that day.' : ' Tap a number to see that day.'}</p>`
        : html`<p class="k-small">Nothing is preloaded. ${lead ? 'Talk it through with Kestrel AI: tell it your season, how many days you run, workout days and race days, or attach the plan you use now (PDF, Word, Excel, CSV). Refine it until it is right. It scales to every runner on the roster.' : 'Your captain or coach can build one. Until then you can build your own in Train → Plan.'}</p>`}
      ${lead ? html`<div class="k-toolbar"><button class="k-btn primary" type="button" id="kPlanBuild">${r.custom ? 'Refine with Kestrel AI' : 'Build with Kestrel AI'}</button>${r.custom ? html`<span class="k-toolbar-slot" id="kPlanTools"></span><button class="k-link danger k-toolbar-end" type="button" id="kPlanReset">Remove team plan</button>` : ''}</div>` : ''}
      ${r.custom ? html`<div id="kPlanGrid"></div>` : ''}
      <p class="k-small">Plans are general guidance, not medical advice, and are not checked by Kestrel for any one runner.</p>
    </section>
    ${lv ? html`<section class="card" id="kLevels"></section><section class="card" id="kWeekTypes"></section>` : ''}`.s;
  if ($('kPlanBuild')) $('kPlanBuild').onclick = () => openPlanBuilder({ team: true, current: r.spec || (r.plans && specFromPlans(r.plans)), replacesEdits: r.custom, onSaved: again });
  if ($('kPlanReset')) $('kPlanReset').onclick = (e) => attempt(async () => {
    if (!confirm('Remove the team plan? Everyone on the team goes back to having no plan until they build their own.')) return;
    await api(`/api/teams/${K.teamId}/plan`, { method: 'DELETE' });
    await window.kestrelReload({ keepScreen: true });
    again();
  }, e.currentTarget);
  if (r.custom) renderPlanGrid($('kPlanGrid'), r.plans, lead, async (plans, levelMap) => {
    await api(`/api/teams/${K.teamId}/plan`, { method: 'PUT', body: JSON.stringify({ plans, level_map: levelMap || null }) });
    await window.kestrelReload({ keepScreen: true });
    toast('Plan saved.');
    again();
  }, lv?.athletes || []);
  if (lv) renderLevels($('kLevels'), lv);
  if (wk && $('kWeekTypes')) renderWeekTypes($('kWeekTypes'), wk);
  else if ($('kWeekTypes')) $('kWeekTypes').remove();
};

// What kind of week each athlete is on: normal, race week or taper. Automatic means race week when a meet is on the
// calendar that week; a captain's choice replaces that for one athlete or the whole team, this week or up to three ahead.
const WEEK_LABEL = { normal: 'Normal', race: 'Race week', taper: 'Taper' };
let weekPick = 0;
function renderWeekTypes(el, wk) {
  const i = Math.min(weekPick, wk.weeks.length - 1);
  const day = (w) => new Date(w + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const label = (w, n) => (n === 0 ? 'This week' : day(w));
  const full = (w, n) => `${n === 0 ? 'This week' : n === 1 ? 'Next week' : 'In ' + n + ' weeks'}, week of ${day(w)}`;
  const eligible = wk.athletes.filter((a) => !a.locked);
  const opts = (cur, auto) => html`<option value="auto" ${cur === 'auto' ? 'selected' : ''}>Automatic (${WEEK_LABEL[auto]})</option>${['normal', 'race', 'taper'].map((k) => html`<option value="${k}" ${cur === k ? 'selected' : ''}>${WEEK_LABEL[k]}</option>`)}`;
  el.innerHTML = html`<div class="section-head"><div>
      <div class="card-title">Week type</div>
      <div class="hint">Choose what each athlete is doing that week. Their days follow the plan's normal, race-week or taper column. Automatic means race week when a meet is on the calendar.</div>
    </div></div>
    <div class="seg seg-sm k-weekpick" role="tablist" aria-label="Week">${wk.weeks.map((w, n) => html`<button type="button" class="seg-btn ${n === i ? 'active' : ''}" role="tab" aria-selected="${String(n === i)}" data-wk="${n}" title="${full(w, n)}" aria-label="${full(w, n)}">${label(w, n)}</button>`)}</div>
    ${eligible.length ? html`<div class="k-lvl"><span class="k-lname"><b>Everyone</b><small>${eligible.length} on the team plan</small></span>
      <select class="k-input" id="kWeekAll" aria-label="Set everyone's week type"><option value="">Set everyone to…</option><option value="auto">Automatic</option>${['normal', 'race', 'taper'].map((k) => html`<option value="${k}">${WEEK_LABEL[k]}</option>`)}</select></div>` : ''}
    <div class="k-lvls">${wk.athletes.map((a) => { const c = a.weeks[i]; return html`<div class="k-lvl">
      <span class="k-lname"><b>${a.name || 'Unnamed'}</b>${a.class_year ? html`<small>${a.class_year}</small>` : ''}</span>
      ${a.locked
        ? html`<span class="k-small" style="margin:0">${a.locked}</span>`
        : html`<select class="k-input" data-who="${a.id}" aria-label="Week type for ${a.name}">${opts(c.set ? c.kind : 'auto', c.auto)}</select>`}
    </div>`; })}</div>
    ${wk.athletes.length ? '' : html`<p class="k-small">No one has joined the team yet.</p>`}`.s;
  const save = (body, ctl) => attempt(async () => {
    const out = await api(`/api/teams/${K.teamId}/plan/weeks`, { method: 'PUT', body: JSON.stringify({ week_of: wk.weeks[i], ...body }) });
    toast('Week type saved.');
    renderWeekTypes(el, out);
    await window.kestrelReload?.({ keepScreen: true });
  }, ctl);
  el.querySelectorAll('[data-wk]').forEach((b) => { b.onclick = () => { weekPick = Number(b.dataset.wk); renderWeekTypes(el, wk); }; });
  el.querySelectorAll('select[data-who]').forEach((sel) => { sel.onchange = () => save({ person_id: sel.dataset.who, kind: sel.value }, sel); });
  if ($('kWeekAll')) $('kWeekAll').onchange = (e) => { if (e.target.value) save({ person_ids: 'all', kind: e.target.value }, e.target); };
}


// Who is on which level. Kestrel AI recommends a move up when an athlete has earned it; the captain decides.
function renderLevels(el, lv) {
  const rows = lv.athletes;
  el.innerHTML = html`<div class="section-head"><div>
      <div class="card-title">Who’s on what</div>
      <div class="hint">Pick each athlete’s level. Kestrel AI flags runners who are ready to move up, but only you move them.</div>
    </div></div>
    <div class="k-lvls">${rows.map((a) => html`<div class="k-lvl">
      <span class="k-lname"><b>${a.name || 'Unnamed'}</b>${a.class_year ? html`<small>${a.class_year}</small>` : ''}</span>
      ${a.locked
        ? html`<span class="k-small" style="margin:0">${a.locked}</span>`
        : html`<select class="k-input" data-who="${a.id}" aria-label="Level for ${a.name}">${lv.levels.map((l) => html`<option value="${l.level}" ${l.level === a.level ? 'selected' : ''}>${l.miles} mi a week</option>`)}</select>`}
      ${a.recommend ? html`<span class="k-rec"><span class="badge tone-race">Kestrel AI: ready for ${a.recommend.miles} mi</span> <button class="k-btn small" type="button" data-up="${a.id}" data-to="${a.recommend.to}">Move up</button></span>` : ''}
    </div>`)}</div>
    ${rows.length ? '' : html`<p class="k-small">No one has joined the team yet.</p>`}`.s;
  const move = (id, level, btn) => attempt(async () => {
    const out = await api(`/api/teams/${K.teamId}/plan/levels/${id}`, { method: 'PUT', body: JSON.stringify({ level }) });
    toast('Level changed.');
    renderLevels(el, { ...lv, athletes: out.athletes });
    // Your own level feeds your plan everywhere else, and moves the "you" mark on the table.
    if (id === K.me.user.id) { await window.kestrelReload({ keepScreen: true }); const host = el.closest('#kvTeamPlan, #teamTrainView'); if (host) window.kestrelRenderTeamTraining(host); }
  }, btn);
  el.querySelectorAll('select[data-who]').forEach((sel) => { sel.onchange = () => move(sel.dataset.who, Number(sel.value), sel); });
  el.querySelectorAll('[data-up]').forEach((b) => { b.onclick = () => move(b.dataset.up, Number(b.dataset.to), b); });
}

// ---------- the plan as a table: a row per level, Monday to Sunday across, one number per day

const TYPE_LABEL = { LR: 'Long run', 'Cross-train': 'Cross-train', Off: 'Rest' };
const TYPE_CLASS = { Easy: 'easy', Recovery: 'easy', Shakeout: 'easy', Workout: 'wo', LR: 'lr', 'Long run': 'lr', Race: 'race', 'Cross-train': 'rest', Off: 'rest' };
const PLAN_TYPES = ['Easy', 'Recovery', 'Workout', 'LR', 'Race', 'Shakeout', 'Cross-train', 'Off'];
const WEEKS = [['No race', 'Standard'], ['Race week', 'Race week'], ['Taper', 'Taper']];
const FULL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const numOf = (c) => parseFloat(c.miles) || 0;
const fmtMi = (n) => String(Math.round(n * 10) / 10);

function dayLine(day, c) {
  const t = TYPE_LABEL[c.type] || c.type;
  return c.type === 'Off' ? `${day}: rest${c.notes ? ` (${c.notes})` : ''}` : `${day}: ${c.miles ? c.miles + ' mi ' : ''}${t.toLowerCase()}${c.notes ? `. ${c.notes}` : ''}`;
}

const planOpen = { team: null, set: new Set() };
function renderPlanGrid(el, plans, lead, save, athletes = []) {
  const levels = Object.keys(plans).map(Number).sort((a, b) => a - b);
  // The level this athlete trains from is marked and starts open.
  const myMiles = window.kestrelMyLevelMiles?.();
  const mine = levels.find((l) => myMiles && Number(plans[l].weeks[0].miles) === Number(myMiles));
  // Which levels are open survives a redraw (a save, a refresh) for the same team.
  if (planOpen.team !== K.teamId) { planOpen.team = K.teamId; planOpen.set = new Set(mine ? [mine] : []); }
  const open = planOpen.set;
  const paint = () => {
    const cellsOf = (lvl, wi) => plans[lvl].days.map((d, di) => {
      const c = d.cells[wi];
      const n = numOf(c);
      const rest = c.type === 'Off' || c.type === 'Cross-train';
      const tip = dayLine(FULL_DAYS[di], c);
      return html`<button type="button" class="k-pc ${TYPE_CLASS[c.type] || ''}" data-l="${lvl}" data-w="${wi}" data-d="${di}" title="${tip}" aria-label="${tip}">${rest && !n ? '·' : fmtMi(n)}</button>`;
    });
    const total = (lvl, wi) => fmtMi(plans[lvl].days.reduce((a, d) => a + numOf(d.cells[wi]), 0));
    // The captain's edit buttons sit in the plan's toolbar when there is one, else above the table.
    const tools = lead ? html`<button class="k-btn" type="button" id="kLvlEdit">Edit levels</button><button class="k-btn" type="button" id="kRefEdit">Edit workouts and notes</button>` : '';
    const slot = $('kPlanTools');
    if (slot) slot.innerHTML = tools.s ?? tools;
    el.innerHTML = html`${lead && !slot ? html`<div class="k-toolbar">${tools}</div>` : ''}${mine ? html`<p class="k-small k-mine-note">You train from the <b>${plans[mine].weeks[0].miles} mi</b> level, marked below. Tap any day for the workout.</p>` : ''}<div class="k-pgrid" role="table" aria-label="Team training plan by level">
      <div class="k-pr k-ph" role="row"><span>Level</span>${DAYS7.map((d) => html`<span role="columnheader">${d}</span>`)}<span>Total</span></div>
      ${levels.map((lvl) => html`<div class="k-pr ${lvl === mine ? 'mine' : ''}" role="row"><button type="button" class="k-plvl" data-open="${lvl}" aria-expanded="${String(open.has(lvl))}"><i>${open.has(lvl) ? '▾' : '▸'}</i>${plans[lvl].weeks[0].miles}<small>${lvl === mine ? 'mi · you' : 'mi'}</small></button>${cellsOf(lvl, 0)}<span class="k-ptot">${total(lvl, 0)}</span></div>
        ${open.has(lvl) ? [1, 2].map((wi) => html`<div class="k-pr sub" role="row"><span class="k-pwk">${WEEKS[wi][1]}</span>${cellsOf(lvl, wi)}<span class="k-ptot">${total(lvl, wi)}</span></div>`) : ''}`)}
    </div>
    <div class="k-pleg"><span class="easy">Easy</span><span class="wo">Workout</span><span class="lr">Long run</span><span class="race">Race</span><span class="rest">Rest · cross-train</span> <small>Miles per day. Race week and Taper are under each level.</small></div>`.s;
    el.querySelectorAll('[data-open]').forEach((b) => { b.onclick = () => { const l = Number(b.dataset.open); open.has(l) ? open.delete(l) : open.add(l); paint(); }; });
    el.querySelectorAll('.k-pc').forEach((b) => { b.onclick = () => openCell(Number(b.dataset.l), Number(b.dataset.w), Number(b.dataset.d)); });
    if ($('kLvlEdit')) $('kLvlEdit').onclick = editLevels;
    if ($('kRefEdit')) $('kRefEdit').onclick = editRef;
  };
  // Miles text like "6 (3 WO)": every number scaled by f to the half mile. A 0 (a rest day) stays 0.
  const NUM = /\d+(?:\.\d+)?/g;
  const halfMi = (x) => Math.max(0.5, Math.round(x * 2) / 2);
  const scaleMiles = (txt, f) => String(txt).replace(NUM, (n) => (Number(n) === 0 ? '0' : fmtMi(halfMi(Number(n) * f))));
  // Two cells with the same shape ("6 (3 WO)" and "7 (4 WO)"): each number is fn(a, b), else null.
  const blend = (ta, tb, fn) => {
    const a = String(ta).match(NUM) || [], b = String(tb).match(NUM) || [];
    if (!a.length || String(ta).replace(NUM, '#') !== String(tb).replace(NUM, '#')) return null;
    const out = a.map((x, i) => (Number(x) === 0 && Number(b[i]) === 0 ? 0 : fn(Number(x), Number(b[i]))));
    if (out.some((x) => !(x >= 0))) return null;
    let i = 0;
    return String(ta).replace(NUM, () => { const x = out[i++]; return x === 0 ? '0' : fmtMi(halfMi(x)); });
  };
  // A level's weekly miles changed by k: its race week and taper follow, and so does every day, rounded to half miles
  // so each week still adds up to k times what it did. Blank fields (a new level not filled in yet) are left blank.
  const scaleLevel = (p, k) => {
    if (!(k > 0) || k === 1) return;
    p.weeks.forEach((w, wi) => { if (wi && w.miles !== '') w.miles = Math.max(1, Math.round(Number(w.miles) * k)); });
    for (let wi = 0; wi < 3; wi++) {
      const cells = p.days.map((day) => day.cells[wi]).filter((c) => c.miles !== '' && c.type !== 'Off' && c.type !== 'Cross-train' && numOf(c) > 0);
      const plain = cells.filter((c) => /^\s*\d+(\.\d+)?\s*$/.test(c.miles));
      cells.filter((c) => !plain.includes(c)).forEach((c) => { c.miles = scaleMiles(c.miles, k); });
      const goal = Math.round(plain.reduce((a, c) => a + numOf(c), 0) * k * 2) / 2;
      const rawMi = plain.map((c) => Math.max(0.5, numOf(c) * k));
      const out = rawMi.map((x) => Math.max(0.5, Math.floor(x * 2) / 2));
      const order = rawMi.map((x, i) => [x * 2 - Math.floor(x * 2), i]).sort((a, b) => b[0] - a[0]);
      for (let j = 0; out.reduce((a, x) => a + x, 0) < goal - 0.01 && j < order.length; j++) out[order[j][1]] += 0.5;
      plain.forEach((c, i) => { c.miles = fmtMi(out[i]); });
    }
  };
  // A new level's numbers, from the levels around it. Between two levels: halfway, day by day. Above the top or below
  // the bottom: the step between the last two levels, continued (4, 4.5, 5 -> 5.5). A day whose two neighbours differ
  // in kind or shape, or a plan with one level, scales the nearer level instead.
  const suggestLevel = (lo, hi, lo2, hi2) => {
    const near = lo || hi, far = lo && hi ? hi : lo ? lo2 : hi2;
    const fn = lo && hi ? (x, y) => (x + y) / 2 : (x, y) => 2 * x - y;
    const s = JSON.parse(JSON.stringify(near));
    s.weeks = near.weeks.map((w, wi) => {
      const a = Number(w.miles), b = far ? Number(far.weeks[wi].miles) : NaN;
      let mi = far ? Math.round(fn(a, b)) : Math.round(a * (lo ? 1.15 : 0.85));
      if (!(mi >= 1) || (!(lo && hi) && mi === a)) mi = Math.max(1, Math.round(a * (lo ? 1.15 : 0.85)));
      return { ...w, miles: mi };
    });
    s.days.forEach((day, di) => day.cells.forEach((c, wi) => {
      const k = s.weeks[wi].miles / (Number(near.weeks[wi].miles) || s.weeks[wi].miles);
      const o = far?.days[di].cells[wi];
      c.miles = (o && o.type === c.type && blend(c.miles, o.miles, fn)) || scaleMiles(c.miles, k);
    }));
    return s;
  };

  // Level mileage, laid out like a Google Form: a card per level, lightest first. Hover between two cards (or above the
  // first, below the last) for "+ New level". Every number on a new level is suggested from its neighbours and shown
  // faint until it is taken: Tab or a click takes one, Fill all takes the lot, and Save takes any still left.
  // Removing a level that athletes are on asks where they go. Levels renumber on save; the server moves athletes with them.
  const editLevels = () => {
    const d = dialog();
    // Everything lives in a box inside the shared dialog, so its listeners go when another dialog replaces it.
    d.innerHTML = '<div class="k-lvlx"></div>';
    const box = d.firstChild;
    const onLevel = (from) => athletes.filter((a) => !a.locked && Number(a.level) === from).length;
    const copy = (x) => JSON.parse(JSON.stringify(x));
    const blankOf = (p) => { const b = copy(p); b.weeks.forEach((w) => { w.miles = ''; }); b.days.forEach((day) => day.cells.forEach((c) => { c.miles = ''; })); return b; };
    const get = (p, key) => (key[0] === 'w' ? p.weeks[+key[1]].miles : p.days[+key.slice(1, key.indexOf('-'))].cells[+key.slice(key.indexOf('-') + 1)].miles);
    const put = (p, key, v) => { if (key[0] === 'w') p.weeks[+key[1]].miles = v; else p.days[+key.slice(1, key.indexOf('-'))].cells[+key.slice(key.indexOf('-') + 1)].miles = v; };
    const KEYS = [0, 1, 2].flatMap((wi) => ['w' + wi, ...DAYS7.map((_, di) => `d${di}-${wi}`)]);
    // What a card would save: its own numbers, with suggestions in any blanks.
    const eff = (c) => { if (!c.sugg) return c.plan; const p = copy(c.plan); KEYS.forEach((k) => { if (String(get(p, k)) === '') put(p, k, get(c.sugg, k)); }); return p; };
    const cards = levels.map((l) => ({ from: l, plan: copy(plans[l]) }));
    const gone = []; // levels removed that athletes are on: { from, miles, n, to } where `to` is a card
    const more = new Set(); // cards with race week and taper shown
    const MAX = 15;
    const suggestAt = (i) => suggestLevel(cards[i - 1] && eff(cards[i - 1]), cards[i] && eff(cards[i]), cards[i - 2] && eff(cards[i - 2]), cards[i + 1] && eff(cards[i + 1]));
    const daySum = (p, wi) => fmtMi(p.days.reduce((a, day) => a + numOf(day.cells[wi]), 0));

    const field = (c, ci, key, label, cls = '') => {
      const v = String(get(c.plan, key)), s = c.sugg ? String(get(c.sugg, key)) : '';
      return html`<label class="k-lf ${cls} ${s && v === '' ? 'ghost' : ''}"><span>${label}</span><input class="k-input" data-c="${ci}" data-k="${key}" value="${v}" placeholder="${s}" autocomplete="off" spellcheck="false" aria-label="Level ${ci + 1} ${key[0] === 'w' ? WEEKS[+key[1]][1] + ' weekly miles' : FULL_DAYS[+key.slice(1, key.indexOf('-'))] + ', ' + WEEKS[+key.slice(key.indexOf('-') + 1)][1]}"></label>`;
    };
    const week = (c, ci, wi) => html`<div class="k-lc-days">${DAYS7.map((dn, di) => field(c, ci, `d${di}-${wi}`, dn, TYPE_CLASS[(c.sugg || c.plan).days[di].cells[wi].type] || ''))}</div>`;
    const insert = (i) => (cards.length < MAX ? html`<button type="button" class="k-ins ${i === 0 || i === cards.length ? 'edge' : ''}" data-ins="${i}" aria-label="Add a level here, about ${suggestAt(i).weeks[0].miles} miles a week"><span data-hint="about ${suggestAt(i).weeks[0].miles} mi">+ New level</span></button>` : '');
    const headText = (c) => {
      const n = c.from ? onLevel(c.from) : 0, now = Number(eff(c).weeks[0].miles);
      return `${c.from ? (Number(plans[c.from].weeks[0].miles) !== now ? `was ${plans[c.from].weeks[0].miles} mi` : '') : 'New'}${n ? ` · ${n} ${n === 1 ? 'athlete' : 'athletes'}` : ''}`;
    };
    // ci < 0: the faint preview shown while hovering "+ New level".
    const card = (c, ci) => {
      const p = eff(c), preview = ci < 0;
      return html`<section class="k-lc ${c.sugg ? 'new' : ''}" data-card="${ci}">
        <div class="k-lc-head"><b>${preview ? 'New level' : `Level ${ci + 1}`}</b><small>${preview ? 'Suggested. Click + New level to add it.' : headText(c)}</small>
          ${c.sugg && !preview ? html`<button type="button" class="k-link" data-fill="${ci}">Fill all</button>` : ''}
          ${preview ? '' : html`<button type="button" class="k-lc-del" data-del="${ci}" aria-label="Remove level ${ci + 1}" title="Remove level" ${cards.length < 2 ? 'disabled' : ''}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg></button>`}</div>
        <div class="k-lc-main">${field(c, ci, 'w0', 'Weekly miles', 'k-lw')}${week(c, ci, 0)}</div>
        <p class="k-small k-lc-sum" data-sum="${ci}">Days add up to ${daySum(p, 0)} mi</p>
        <details data-more="${ci}" ${more.has(c) ? 'open' : ''}><summary class="k-small">Race week and taper</summary>
          ${[1, 2].map((wi) => html`<div class="k-lc-main sub">${field(c, ci, 'w' + wi, WEEKS[wi][1], 'k-lw')}${week(c, ci, wi)}</div>`)}
        </details>
      </section>`;
    };
    const draw = (focus) => {
      const top = d.scrollTop;
      box.innerHTML = html`<h2>Levels</h2><p class="k-small">One card per level, lightest first. Changing a level's weekly miles scales its days, race week and taper with it. Hover between levels to add one: its numbers are suggested from the levels around it. Press Tab or click a faint number to take it.</p>
        <form id="kLvlForm" class="k-lcs" novalidate>
          ${insert(0)}${cards.map((c, ci) => html`${card(c, ci)}${insert(ci + 1)}`)}
          ${gone.length ? html`<div class="k-lc-gone"><b class="k-small">Athletes on removed levels</b>${gone.map((g, gi) => html`<div class="k-lvl"><span class="k-lname"><b>${g.miles} mi level</b><small>${g.n} ${g.n === 1 ? 'athlete' : 'athletes'}</small></span>
            <select class="k-input" data-gone="${gi}" aria-label="Move athletes on the ${g.miles} mi level to">${cards.map((c, ci) => html`<option value="${ci}" ${g.to === c ? 'selected' : ''}>Level ${ci + 1} · ${eff(c).weeks[0].miles} mi</option>`)}</select></div>`)}</div>` : ''}
          <p class="k-small" id="kLvlWarn" role="status"></p>
          <div class="k-row"><button class="k-btn primary" type="submit">Save levels</button><button class="k-link" type="button" id="kLvlClose">Cancel</button></div>
        </form>`.s;
      d.scrollTop = top;
      if (focus) box.querySelector(focus)?.focus();
    };
    // Hovering "+ New level" shows the level it would add, faint, in place. It is only a picture: clicking adds it.
    const unpreview = () => box.querySelectorAll('.k-lc.preview').forEach((x) => x.remove());
    box.addEventListener('pointerover', (e) => {
      const ins = e.target.closest?.('[data-ins]');
      if (!ins || ins.nextElementSibling?.classList.contains('preview')) return;
      unpreview();
      const sugg = suggestAt(Number(ins.dataset.ins));
      ins.firstElementChild.dataset.hint = `about ${sugg.weeks[0].miles} mi`; // the levels around it may have changed
      ins.setAttribute('aria-label', `Add a level here, about ${sugg.weeks[0].miles} miles a week`);
      const tmp = document.createElement('div');
      tmp.innerHTML = card({ from: null, plan: blankOf(sugg), sugg }, -1).s;
      const pv = tmp.firstElementChild;
      pv.classList.add('preview');
      pv.setAttribute('aria-hidden', 'true');
      pv.querySelectorAll('input, button, details').forEach((x) => { x.tabIndex = -1; if (x.tagName !== 'DETAILS') x.disabled = true; });
      ins.after(pv);
    });
    box.addEventListener('pointerout', (e) => { const ins = e.target.closest?.('[data-ins]'); if (ins && !ins.contains(e.relatedTarget)) unpreview(); });
    const cardOf = (el) => cards[Number(el.dataset.c)];
    const take = (inp) => { if (inp.value === '' && inp.placeholder) { inp.value = inp.placeholder; put(cardOf(inp).plan, inp.dataset.k, inp.placeholder); inp.closest('.k-lf').classList.remove('ghost'); refresh(inp); } };
    const refresh = (inp) => { const ci = Number(inp.dataset.c), s = d.querySelector(`[data-sum="${ci}"]`); if (s) s.textContent = `Days add up to ${daySum(eff(cards[ci]), 0)} mi`; };
    // Put a card's numbers back into its inputs without redrawing, so focus (and a click in progress) survives.
    const syncCard = (ci) => {
      const c = cards[ci];
      box.querySelectorAll(`input[data-c="${ci}"]`).forEach((i) => {
        const v = String(get(c.plan, i.dataset.k)), ph = c.sugg ? String(get(c.sugg, i.dataset.k)) : '';
        if (i.value !== v) i.value = v;
        i.placeholder = ph;
        i.closest('.k-lf').classList.toggle('ghost', v === '' && !!ph);
      });
      const head = box.querySelector(`[data-card="${ci}"] .k-lc-head small`);
      if (head) head.textContent = headText(c);
      refresh({ dataset: { c: ci } });
    };
    const nearestCard = (miles) => cards.reduce((b, c) => (Math.abs(eff(c).weeks[0].miles - miles) < Math.abs(eff(b).weeks[0].miles - miles) ? c : b), cards[0]);

    box.oninput = (e) => {
      const inp = e.target.closest('input[data-k]'); if (!inp) return;
      put(cardOf(inp).plan, inp.dataset.k, inp.value);
      inp.closest('.k-lf').classList.toggle('ghost', inp.value === '' && !!inp.placeholder);
      refresh(inp);
    };
    box.onkeydown = (e) => { const inp = e.target.closest?.('input[data-k]'); if (inp && e.key === 'Tab' && !e.shiftKey) take(inp); };
    box.addEventListener('focusin', (e) => { const inp = e.target.closest?.('input[data-k="w0"]'); if (inp) inp.dataset.was = String(get(eff(cardOf(inp)), 'w0')); });
    box.onchange = (e) => {
      const inp = e.target.closest('input[data-k="w0"]');
      if (inp) {
        // A level's weekly miles: scale the rest of the level (and a new level's suggestions) to match.
        const c = cardOf(inp), was = Number(inp.dataset.was), now = Number(inp.value);
        if (was > 0 && now > 0 && now !== was) { scaleLevel(c.plan, now / was); if (c.sugg) { scaleLevel(c.sugg, now / was); c.sugg.weeks[0].miles = now; } inp.dataset.was = String(now); syncCard(Number(inp.dataset.c)); }
        return;
      }
      const sel = e.target.closest('select[data-gone]');
      if (sel) gone[Number(sel.dataset.gone)].to = cards[Number(sel.value)];
    };
    box.addEventListener('toggle', (e) => { const det = e.target.closest?.('details[data-more]'); if (det) { const c = cards[Number(det.dataset.more)]; det.open ? more.add(c) : more.delete(c); } }, true);
    box.onclick = (e) => {
      const t = e.target;
      const inp = t.closest('input[data-k]');
      if (inp) { take(inp); return; }
      const ins = t.closest('[data-ins]');
      if (ins) {
        const i = Number(ins.dataset.ins), sugg = suggestAt(i);
        cards.splice(i, 0, { from: null, plan: blankOf(sugg), sugg });
        draw(`input[data-c="${i}"][data-k="w0"]`);
        return;
      }
      const del = t.closest('[data-del]');
      if (del) {
        const c = cards[Number(del.dataset.del)];
        if (cards.length < 2) return;
        cards.splice(cards.indexOf(c), 1);
        more.delete(c);
        const n = c.from ? onLevel(c.from) : 0;
        if (n) { const miles = Number(plans[c.from].weeks[0].miles); gone.push({ from: c.from, miles, n, to: nearestCard(miles) }); }
        gone.forEach((g) => { if (!cards.includes(g.to)) g.to = nearestCard(g.miles); });
        draw();
        return;
      }
      const fill = t.closest('[data-fill]');
      if (fill) { const c = cards[Number(fill.dataset.fill)]; KEYS.forEach((k) => { if (String(get(c.plan, k)) === '') put(c.plan, k, get(c.sugg, k)); }); draw(); return; }
      if (t.id === 'kLvlClose') d.close();
    };
    box.onsubmit = (e) => {
      e.preventDefault();
      const warn = (m) => { $('kLvlWarn').textContent = m; };
      const out = cards.map(eff).map(copy);
      for (const [i, p] of out.entries()) {
        for (const [wi, w] of p.weeks.entries()) {
          w.miles = Number(w.miles);
          if (!(w.miles >= 1 && w.miles <= 150)) return warn(`Level ${i + 1}: ${WEEKS[wi][1].toLowerCase()} needs 1 to 150 miles.`);
        }
        if (p.days.some((day) => day.cells.some((c) => String(c.miles).trim() === ''))) return warn(`Level ${i + 1} has a day with no miles. Put 0 for a rest day.`);
      }
      if (out.some((p, i) => i && p.weeks[0].miles <= out[i - 1].weeks[0].miles)) return warn('Each level needs more weekly miles than the one above it.');
      const next = Object.fromEntries(out.map((p, i) => [i + 1, p]));
      const map = {};
      cards.forEach((c, i) => { if (c.from) map[c.from] = i + 1; });
      gone.forEach((g) => { map[g.from] = cards.indexOf(g.to) + 1; });
      attempt(async () => { await save(next, map); planOpen.set = new Set(); d.close(); }, e.submitter);
    };
    draw();
    d.showModal();
  };
  // The workout menu, core and gym notes that come with the plan: for every level, or one level.
  const editRef = () => {
    const same = levels.every((l) => JSON.stringify(plans[l].ref || {}) === JSON.stringify(plans[levels[0]].ref || {}));
    let pick = same ? 'all' : String(mine || levels[0]);
    const d = dialog();
    const draw = () => {
      const ref = plans[pick === 'all' ? levels[0] : Number(pick)].ref || {};
      const ss = [...(ref.sessions || []), { title: '', desc: '', items: [] }].slice(0, 6);
      d.innerHTML = html`<h2>Workouts and notes</h2>
        <form id="kRefForm">
          <div><label class="k-label" for="kRefLvl">For</label><select class="k-input" id="kRefLvl"><option value="all" ${pick === 'all' ? 'selected' : ''}>Every level</option>${levels.map((l, i) => html`<option value="${l}" ${pick === String(l) ? 'selected' : ''}>Level ${i + 1} (${plans[l].weeks[0].miles} mi)</option>`)}</select>${same ? '' : html`<p class="k-small">Levels have different notes now; saving for every level replaces them all.</p>`}</div>
          ${ss.map((x, i) => html`<fieldset class="k-refset"><legend class="k-small"><b>${x.title ? `Workout menu ${i + 1}` : 'Add a workout menu'}</b></legend>
            <input class="k-input" name="t${i}" maxlength="60" value="${x.title}" placeholder="e.g. Tuesday workouts">
            <input class="k-input" name="d${i}" maxlength="120" value="${x.desc}" placeholder="e.g. Hard, race pace">
            <textarea class="k-input" name="i${i}" rows="3" placeholder="One workout a line, e.g. 6x800 at 5k pace, 200 jog">${(x.items || []).join('\n')}</textarea></fieldset>`)}
          <div><label class="k-label" for="kRefCore">Core</label><input class="k-input" id="kRefCore" name="core" maxlength="200" value="${ref.core || ''}"></div>
          <div><label class="k-label" for="kRefGym">Gym</label><input class="k-input" id="kRefGym" name="gym" maxlength="200" value="${ref.gym || ''}"></div>
          <div class="k-row"><button class="k-btn primary" type="submit">Save</button><button class="k-link" type="button" id="kRefClose">Cancel</button></div>
        </form>`.s;
      $('kRefClose').onclick = () => d.close();
      $('kRefLvl').onchange = (e) => { pick = e.target.value; draw(); };
      $('kRefForm').onsubmit = (e) => {
        e.preventDefault();
        const f = form(e.target);
        const sessions = ss.map((_, i) => ({ title: (f['t' + i] || '').trim(), desc: (f['d' + i] || '').trim(), items: (f['i' + i] || '').split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 8) })).filter((x) => x.title || x.items.length);
        const next = JSON.parse(JSON.stringify(plans));
        for (const l of pick === 'all' ? levels : [Number(pick)]) next[l].ref = { ...(next[l].ref || {}), sessions, core: (f.core || '').trim(), gym: (f.gym || '').trim() };
        attempt(async () => { await save(next); d.close(); });
      };
    };
    draw();
    d.showModal();
  };
  // Tap a day: read it (everyone) or change it (captains and the owner).
  const openCell = (lvl, wi, di) => {
    const c = plans[lvl].days[di].cells[wi];
    const d = dialog();
    const head = `${FULL_DAYS[di]} · ${WEEKS[wi][1].toLowerCase()} · ${plans[lvl].weeks[0].miles} mi level`;
    if (!lead) {
      d.innerHTML = html`<h2>${FULL_DAYS[di]}</h2><p class="k-small">${head}</p><p><b>${TYPE_LABEL[c.type] || c.type}</b>${c.miles && c.type !== 'Off' ? ` · ${c.miles} mi` : ''}</p>${c.notes ? html`<p class="k-small">${c.notes}</p>` : ''}${c.shoes ? html`<p class="k-small">Shoes: ${c.shoes}</p>` : ''}<div class="k-row"><button class="k-link" type="button" id="kCellClose">Close</button></div>`.s;
      d.showModal(); $('kCellClose').onclick = () => d.close();
      return;
    }
    d.innerHTML = html`<h2>${FULL_DAYS[di]}</h2><p class="k-small">${head}</p>
      <form id="kCellForm">
        <div><label class="k-label" for="kCellType">What the day is</label><select class="k-input" id="kCellType">${PLAN_TYPES.map((t) => html`<option value="${t}" ${t === c.type ? 'selected' : ''}>${TYPE_LABEL[t] || t}</option>`)}</select></div>
        <div><label class="k-label" for="kCellMi">Miles</label><input class="k-input" id="kCellMi" value="${c.miles}" maxlength="30" inputmode="decimal"><p class="k-small">A number, or a number with the workout part, like 6 (3 WO).</p></div>
        <div><label class="k-label" for="kCellNotes">Notes</label><input class="k-input" id="kCellNotes" value="${c.notes}" maxlength="120" placeholder="e.g. 1.5 WU 1.5 CD, strides"></div>
        <p class="k-small" id="kCellWarn" role="status"></p>
        <div class="k-row"><button class="k-btn primary" type="submit">Save</button><button class="k-link" type="button" id="kCellClose">Cancel</button></div>
      </form>`.s;
    d.showModal();
    $('kCellClose').onclick = () => d.close();
    const warn = () => {
      const t = $('kCellType').value, mi = parseFloat($('kCellMi').value) || 0;
      const hard = (x) => x === 'Workout' || x === 'Race';
      const cells = plans[lvl].days.map((x) => x.cells[wi]);
      const type = (i) => (i === di ? t : cells[i].type);
      const msgs = [];
      if (hard(t) && ((di > 0 && hard(type(di - 1))) || (di < 6 && hard(type(di + 1))))) msgs.push('Two hard days in a row. Most plans put an easy or rest day between.');
      const week = cells.reduce((a, x, i) => a + (i === di ? mi : numOf(x)), 0);
      if ((t === 'LR') && week > 0 && mi / week > 0.35) msgs.push('That long run is over about a third of the week. About 25-30% is the usual ceiling.');
      $('kCellWarn').textContent = msgs.join(' ');
    };
    ['kCellType', 'kCellMi'].forEach((id) => { $(id).oninput = warn; });
    warn();
    $('kCellForm').onsubmit = (e) => {
      e.preventDefault();
      const next = JSON.parse(JSON.stringify(plans));
      const cell = next[lvl].days[di].cells[wi];
      cell.type = $('kCellType').value; cell.miles = $('kCellMi').value.trim() || '0'; cell.notes = $('kCellNotes').value.trim();
      attempt(async () => { await save(next); d.close(); });
    };
  };
  paint();
}

// A short brief for the AI, made from a plan that was typed in or imported rather than built with Kestrel AI.
// It reads the plan's middle level and turns each day's miles into a share of the week.
function specFromPlans(plans) {
  const keys = Object.keys(plans).map(Number).sort((a, b) => a - b);
  const lvl = plans[keys.find((k) => plans[k].weeks[0].miles >= 30) ?? keys[keys.length - 1]];
  const week = (wi) => {
    const mi = lvl.days.map((d) => numOf(d.cells[wi])), tot = mi.reduce((a, b) => a + b, 0) || 1;
    return lvl.days.map((d, i) => ({ type: d.cells[wi].type, share: Math.round((mi[i] / tot) * 1000) / 1000, notes: d.cells[wi].notes }));
  };
  const f = (i) => Math.round((lvl.weeks[i].miles / lvl.weeks[0].miles) * 100) / 100;
  return { name: 'Current team plan', summary: '', normal_week: week(0), race_week: week(1), taper_week: week(2), race_week_factor: f(1), taper_factor: f(2), core: lvl.ref?.core || '', gym: lvl.ref?.gym || '', sessions: lvl.ref?.sessions || [] };
}

const DAYS7 = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
function planTable(spec) {
  const week = (w) => html`<div class="k-planweek">${w.map((d, i) => html`<div class="k-planday ${d.type === 'Off' || d.type === 'Cross-train' ? 'rest' : ''}"><b>${DAYS7[i]}</b><span>${d.type}</span><small>${d.share ? Math.round(d.share * 100) + '%' : ''}</small>${d.notes ? html`<small>${d.notes}</small>` : ''}</div>`)}</div>`;
  return html`<div class="k-plan">
    <div class="k-small"><b>Normal week</b></div>${week(spec.normal_week)}
    <div class="k-small"><b>Race week</b> (${Math.round(spec.race_week_factor * 100)}% of the miles)</div>${week(spec.race_week)}
    <div class="k-small"><b>Taper</b> (${Math.round(spec.taper_factor * 100)}% of the miles)</div>${week(spec.taper_week)}
    ${spec.sessions?.length ? html`<div class="k-small"><b>Workouts</b></div>${spec.sessions.map((x) => html`<details class="k-sess"><summary>${x.title}${x.desc ? ' · ' + x.desc : ''}</summary><ul>${x.items.map((i) => html`<li>${i}</li>`)}</ul></details>`)}` : ''}
  </div>`;
}

// ---------- Plan builder: talk to Kestrel AI, see the plan, refine, save. For a team (captains) or for yourself.

const PLAN_STARTS = [
  'Cross country season, 5 days a week, workouts Tuesday and Thursday, meets on Saturday',
  'Track season with two quality days and a long run on Sunday',
  'Off-season base building, easy running only',
];

const PLAN_STARTS_ME = [
  'Build me a plan from my profile and goals',
  'I am training for a 5K in 8 weeks and can run 5 days a week',
  'I want to build mileage safely, easy running mostly',
];

// Text out of an uploaded file, in the browser. Libraries load only when that file type is used.
const loadScript = (src) => new Promise((ok, no) => {
  if (document.querySelector(`script[src="${src}"]`)) return ok();
  const el = document.createElement('script');
  el.src = src; el.onload = ok; el.onerror = () => no(new Error('could not load the file reader; check your connection'));
  document.head.appendChild(el);
});
async function extractText(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (['txt', 'md', 'csv', 'tsv', 'json'].includes(ext) || file.type.startsWith('text/')) return await file.text();
  const buf = await file.arrayBuffer();
  if (ext === 'pdf') {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
    let out = '';
    for (let i = 1; i <= Math.min(pdf.numPages, 30); i++) {
      const page = await (await pdf.getPage(i)).getTextContent();
      out += page.items.map((x) => x.str).join(' ') + '\n';
    }
    return out;
  }
  if (ext === 'docx') {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js');
    return (await window.mammoth.extractRawText({ arrayBuffer: buf })).value;
  }
  if (ext === 'xlsx' || ext === 'xls') {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
    const wb = window.XLSX.read(buf, { type: 'array' });
    return wb.SheetNames.slice(0, 6).map((n) => `## ${n}\n${window.XLSX.utils.sheet_to_csv(wb.Sheets[n])}`).join('\n\n');
  }
  throw new Error('unsupported file type (use PDF, Word, Excel, CSV or text)');
}

function openPlanBuilder({ team, current, onSaved, replacesEdits }) {
  const base = team ? `/api/teams/${K.teamId}/plan` : '/api/me/plan';
  const st = { turns: [], plan: current || null, preview: null, busy: false, docs: [], week: 'normal' };
  const d = dialog();
  d.classList.add('k-wide');
  d.innerHTML = html`<h2>${team ? 'Build the team training plan' : 'Build your training plan'}</h2>
    <p class="k-small">${team ? 'Describe the season and refine it with Kestrel AI. The plan scales to every runner on the roster, so each athlete lands on the level that fits their fitness.' : 'Describe your goals and your week. Kestrel AI drafts a plan, you refine it, and your coach adapts it to how you feel.'} Powered by ${AI.describe(AI.forTask(K.ai, 'chat'))}. <a href="/lab#/providers" target="_blank" rel="noopener">Change</a></p>
    <div class="k-builder">
      <div class="k-chat" id="kPbChat" aria-live="polite"></div>
      <div class="k-pbpreview" id="kPbPreview"></div>
    </div>
    <div class="k-chips" id="kPbChips"></div>
    <div class="k-drop" id="kPbDrop"><input type="file" id="kPbFile" multiple hidden accept=".txt,.md,.csv,.tsv,.json,.pdf,.docx,.xlsx,.xls">
      <button class="k-btn small" type="button" id="kPbAttach">Attach files</button>
      <span class="k-small" id="kPbDocs">Have a plan already? Drop in a PDF, Word, Excel, CSV or text file and Kestrel AI will learn from it.</span></div>
    <form class="k-row" id="kPbForm"><input class="k-input grow" id="kPbInput" maxlength="1000" placeholder="${st.plan ? 'What should change?' : 'Describe the plan you want'}" autocomplete="off"><button class="k-btn primary" type="submit" id="kPbSend">Send</button></form>
    <p class="k-small" id="kPbMsg" role="status"></p>
    <div class="k-row"><button class="k-btn primary" type="button" id="kPbSave" disabled>${team ? 'Use this plan for the team' : 'Use this plan'}</button><button class="k-link" type="button" id="kPbClose">Close</button></div>
    <p class="k-small">AI plans can be wrong. They are general guidance, not medical advice. Check the plan and listen to your body, your coach and your doctor.</p>`.s;
  d.showModal();
  d.addEventListener('close', () => d.classList.remove('k-wide'), { once: true });
  const chat = $('kPbChat');
  const paint = () => {
    chat.innerHTML = (st.turns.length ? st.turns : [{ role: 'kai', text: st.plan ? 'Here is the current plan. Tell me what to change.' : 'What kind of plan do you want? Season, days a week, workout days, race days, anything to avoid.' }])
      .map((t) => `<div class="k-bubble ${t.role}">${esc(t.text).replace(/\n/g, '<br>')}</div>`).join('') + (st.busy ? '<div class="k-bubble kai">Thinking…</div>' : '');
    chat.scrollTop = chat.scrollHeight;
    $('kPbDocs').innerHTML = st.docs.length ? st.docs.map((x, i) => `<span class="k-chip doc">${esc(x.name)}${x.truncated ? ' (shortened)' : ''} <button type="button" data-rm="${i}" aria-label="Remove ${esc(x.name)}">×</button></span>`).join(' ') : 'Have a plan already? Drop in a PDF, Word, Excel, CSV or text file and Kestrel AI will learn from it.';
    $('kPbDocs').querySelectorAll('[data-rm]').forEach((b) => { b.onclick = () => { st.docs.splice(Number(b.dataset.rm), 1); paint(); }; });
    $('kPbChips').innerHTML = st.turns.length ? '' : (team ? PLAN_STARTS : PLAN_STARTS_ME).map((x, i) => `<button type="button" class="k-chip" data-i="${i}">${esc(x)}</button>`).join('');
    $('kPbChips').querySelectorAll('[data-i]').forEach((b) => { b.onclick = () => { $('kPbInput').value = (team ? PLAN_STARTS : PLAN_STARTS_ME)[b.dataset.i]; $('kPbInput').focus(); }; });
    const pv = $('kPbPreview');
    if (!st.preview && !st.plan) { pv.innerHTML = '<p class="k-small">Your plan will show here.</p>'; }
    else if (st.preview) {
      const lv = st.preview.levels;
      const cur = Number(pv.dataset.level) || lv[Math.min(3, lv.length - 1)].level;
      const L = lv.find((x) => x.level === cur) || lv[0];
      const wk = st.week;
      pv.innerHTML = `<b>${esc(st.preview.spec.name)}</b><p class="k-small">${esc(st.preview.spec.summary)}</p>
        <div class="seg seg-sm" role="tablist">${[['normal', 'Normal'], ['race', 'Race week'], ['taper', 'Taper']].map(([k, l]) => `<button type="button" class="seg-btn ${wk === k ? 'active' : ''}" data-wk="${k}">${l}</button>`).join('')}</div>
        <label class="k-label" for="kPbLevel">Level (weekly miles)</label>
        <select class="k-input" id="kPbLevel">${lv.map((x) => `<option value="${x.level}" ${x.level === L.level ? 'selected' : ''}>${x.miles} miles a week</option>`).join('')}</select>
        <div class="k-pbweek">${L.weeks[wk].map((w) => `<div><b>${w.day.slice(0, 3)}</b><span>${esc(w.type)}</span><span>${w.miles ? w.miles + ' mi' : ''}</span><small>${esc(w.notes)}</small></div>`).join('')}</div>
        <p class="k-small">${team ? 'Each athlete is placed on the level that matches their fitness.' : 'You start on the level that matches your fitness and move up as you get fitter.'}</p>`;
      $('kPbLevel').onchange = (e) => { pv.dataset.level = e.target.value; paint(); };
      pv.querySelectorAll('[data-wk]').forEach((b) => { b.onclick = () => { st.week = b.dataset.wk; paint(); }; });
    } else {
      pv.innerHTML = planTable(st.plan).s;
    }
    $('kPbSave').disabled = !(st.preview || st.plan) || st.busy;
  };
  paint();
  if (st.plan) attempt(async () => { st.preview = (await api(`${base}/preview`, { method: 'POST', body: JSON.stringify({ plan: st.plan }) })); paint(); });

  $('kPbClose').onclick = () => d.close();
  const addFiles = async (files) => {
    for (const f of files) {
      if (st.docs.length >= 5) { $('kPbMsg').textContent = 'Up to 5 files at a time.'; break; }
      if (f.size > 15 * 1024 * 1024) { $('kPbMsg').textContent = `${f.name} is over 15 MB.`; continue; }
      $('kPbMsg').textContent = `Reading ${f.name}…`;
      try {
        let text = await extractText(f);
        text = text.replace(/\u0000/g, '').trim();
        if (!text) throw new Error('no readable text (scanned images are not supported yet)');
        const truncated = text.length > 12000;
        st.docs.push({ name: f.name, text: text.slice(0, 12000), truncated });
        $('kPbMsg').textContent = '';
        if (!$('kPbInput').value) $('kPbInput').value = 'Use the attached file to build our plan.';
      } catch (err) { $('kPbMsg').textContent = `Could not read ${f.name}: ${err.message}`; }
    }
    paint();
  };
  $('kPbAttach').onclick = () => $('kPbFile').click();
  $('kPbFile').onchange = (e) => { addFiles([...e.target.files]); e.target.value = ''; };
  const drop = $('kPbDrop');
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); addFiles([...e.dataTransfer.files]); };
  $('kPbForm').onsubmit = async (e) => {
    e.preventDefault();
    const text = $('kPbInput').value.trim();
    if (!text || st.busy) return;
    $('kPbInput').value = '';
    st.turns.push({ role: 'user', text });
    st.busy = true; $('kPbMsg').textContent = ''; paint();
    try {
      const out = await planAsk(base, st.turns, st.plan, st.docs.map(({ name, text }) => ({ name, text })));
      st.turns.push({ role: 'kai', text: out.answer || 'Done.' });
      if (out.plan) { st.plan = out.plan; st.preview = out.preview || st.preview; }
    } catch (err) {
      st.turns.pop(); $('kPbInput').value = text;
      $('kPbMsg').textContent = err.message;
    }
    st.busy = false; paint();
  };
  $('kPbSave').onclick = (e) => attempt(async () => {
    if (replacesEdits && !confirm('This rebuilds the whole table from the new plan, replacing any changes you made by hand. Continue?')) return;
    await api(base, { method: 'PUT', body: JSON.stringify({ plan: st.plan }) });
    d.close();
    toast(team ? 'Team plan saved. Everyone trains from it now.' : 'Plan saved. Your coach uses it from today.');
    await window.kestrelReload(team && onSaved ? { keepScreen: true } : undefined);
    if (onSaved) onSaved();
  }, e.currentTarget);
}

// -> { answer, plan?, preview? }. Free Kestrel AI answers on the server; any other model is called from the browser.
async function planAsk(base, turns, current, documents = []) {
  const history = turns.map((t) => ({ role: t.role === 'user' ? 'user' : 'kai', text: t.text }));
  const ai = AI.forTask(K.ai, 'chat');
  if (ai.provider === 'kestrel') return await api(`${base}/chat`, { method: 'POST', body: JSON.stringify({ history, current, documents }) });
  const chat = await api(`${base}/prompt`, { method: 'POST', body: JSON.stringify({ history, current, documents }) });
  const system = `${chat.system}\n\nReply with ONLY a JSON object (no prose around it) matching this JSON Schema. "answer" is what the person reads; include "plan" only when you are giving or changing the plan.\n${JSON.stringify(chat.schema)}`;
  const text = await AI.complete(ai, system, [{ role: 'user', content: chat.prompt }], { apiFetch: api });
  const out = parseLoose(text) || { answer: text };
  const res = { answer: typeof out.answer === 'string' && out.answer.trim() ? out.answer : String(text) };
  if (out.plan) {
    try { const preview = await api(`${base}/preview`, { method: 'POST', body: JSON.stringify({ plan: out.plan }) }); res.plan = preview.spec; res.preview = preview; }
    catch (err) { res.answer += `\n\n(I could not use that plan: ${err.message} Ask me to fix it.)`; }
  }
  return res;
}

// Your own plan (Training > Plan): shown when there is no team plan, or to swap it for one of your own.
window.kestrelRenderPersonalPlan = async (el) => {
  if (!el) return;
  const r = await api('/api/me/plan').catch(() => null);
  if (!r) { el.innerHTML = ''; return; }
  if (r.team_plan && !r.custom) { el.innerHTML = ''; return; }
  el.innerHTML = html`<section class="card">
      <div class="card-title">${r.custom ? 'Your plan' : 'Set up your training plan'}</div>
      ${r.custom
        ? html`<p class="k-small"><b>${r.spec?.name || 'Custom plan'}</b>. ${r.spec?.summary || ''} Your coach adapts it each day.</p>`
        : html`<p class="k-small">You do not have a plan yet. Tell Kestrel AI your goals, how many days you can run and what race you are working toward, and it will build one with you. You can refine it any time, or attach a plan you already have.</p>`}
      <div class="k-row"><button class="k-btn primary" type="button" id="kMyPlanBuild">${r.custom ? 'Refine with Kestrel AI' : 'Build with Kestrel AI'}</button>${r.custom ? html`<button class="k-link danger" type="button" id="kMyPlanReset">${r.team_plan ? 'Go back to the team plan' : 'Remove my plan'}</button>` : ''}</div>
    </section>`.s;
  $('kMyPlanBuild').onclick = () => openPlanBuilder({ team: false, current: r.spec, onSaved: () => window.kestrelRenderPersonalPlan(el) });
  if ($('kMyPlanReset')) $('kMyPlanReset').onclick = (e) => attempt(async () => {
    if (!confirm('Remove your own plan?')) return;
    await api('/api/me/plan', { method: 'DELETE' });
    await window.kestrelReload();
    window.kestrelRenderPersonalPlan(el);
  }, e.currentTarget);
};

// ---------- Schedule: add a meet or a place by hand (+), or have Kestrel AI read a schedule

const PLACE_KIND_LABEL = { meet: 'Meet venue', practice: 'Practice' };
const isLeadRole = () => ['owner', 'captain'].includes(K.role);
const localToday = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`; };

// A practice, meet or other event: add one, or (passing `event`) change or delete it. Whoever added it, a captain or the owner can edit.
const EV_TYPES = [['practice', 'Practice'], ['meet', 'Meet'], ['other', 'Other']];
const EV_KINDS = [['', 'Not set'], ['easy', 'Easy'], ['workout', 'Workout'], ['long_run', 'Long run']];
window.kestrelEventForm = ({ event = null, type = 'practice', date, places = [] } = {}) => {
  const ev = event || {};
  const t = ev.type || type;
  const d = dialog();
  d.innerHTML = html`<h2>${event ? `Edit ${t === 'meet' ? 'meet' : t === 'practice' ? 'practice' : 'event'}` : 'Add to the schedule'}</h2>
    <form id="kEvForm" class="k-stack">
      <label class="k-label" for="kEvTitle">Name</label><input class="k-input" id="kEvTitle" name="title" maxlength="200" required value="${ev.title || ''}" placeholder="${t === 'meet' ? 'e.g. County Invitational' : 'e.g. Practice'}">
      <div class="k-row">
        <div class="grow"><label class="k-label" for="kEvDate">Date</label><input class="k-input" id="kEvDate" name="date" type="date" required value="${ev.date || date || localToday()}"></div>
        <div class="grow"><label class="k-label" for="kEvType">Type</label><select class="k-input" id="kEvType" name="type">${EV_TYPES.map(([v, l]) => html`<option value="${v}" ${v === t ? 'selected' : ''}>${l}</option>`)}</select></div>
      </div>
      <div id="kEvKindRow" ${t === 'practice' ? '' : 'hidden'}><label class="k-label" for="kEvKind">Practice</label><select class="k-input" id="kEvKind" name="kind">${EV_KINDS.map(([v, l]) => html`<option value="${v}" ${v === (ev.kind || '') ? 'selected' : ''}>${l}</option>`)}</select></div>
      <div class="k-row">
        <div class="grow"><label class="k-label" for="kEvTime">Start time</label><input class="k-input" id="kEvTime" name="time" maxlength="40" value="${ev.time || ''}" placeholder="e.g. 4:00 PM"></div>
        <div class="grow"><label class="k-label" for="kEvEnd">End time</label><input class="k-input" id="kEvEnd" name="endTime" maxlength="40" value="${ev.endTime || ''}" placeholder="optional"></div>
      </div>
      <label class="k-label" for="kEvPlace">Place</label><input class="k-input" id="kEvPlace" name="location" list="kEvPlaces" maxlength="200" value="${ev.location || ''}" placeholder="A saved place, or any name or address">
      <datalist id="kEvPlaces">${places.map((p) => html`<option value="${p.name}">`)}</datalist>
      <label class="k-label" for="kEvBring">What to bring</label><input class="k-input" id="kEvBring" name="checklist" maxlength="1000" value="${ev.checklist || ''}" placeholder="e.g. spikes, singlet, water">
      <label class="k-label" for="kEvDesc">Details</label><textarea class="k-input" id="kEvDesc" name="desc" maxlength="2000" rows="2" placeholder="Who is expected, bus time, notes">${ev.desc || ''}</textarea>
      ${event ? html`<div id="kEvResRow" ${t === 'meet' ? '' : 'hidden'}><label class="k-label" for="kEvRes">Results</label><textarea class="k-input" id="kEvRes" name="results" maxlength="2000" rows="2" placeholder="Placings and times, after the meet">${ev.results || ''}</textarea></div>` : ''}
      <div class="k-row k-dialog-foot">${event ? html`<button class="k-link danger" type="button" id="kEvDel">Delete</button>` : ''}<button class="k-btn" type="button" id="kEvClose">Cancel</button><button class="k-btn primary" type="submit">${event ? 'Save' : 'Add'}</button></div>
    </form>`.s;
  d.showModal();
  const typeSel = $('kEvType');
  typeSel.onchange = () => { $('kEvKindRow').hidden = typeSel.value !== 'practice'; if ($('kEvResRow')) $('kEvResRow').hidden = typeSel.value !== 'meet'; };
  $('kEvClose').onclick = () => d.close();
  $('kEvForm').onsubmit = (e) => { e.preventDefault(); attempt(async () => {
    const f = form(e.currentTarget);
    if (f.type !== 'practice') f.kind = '';
    if (event && f.date !== ev.date && Object.keys(ev.rsvps || {}).length && !confirm('Moving it to another day clears the RSVPs so everyone answers again. Move it?')) return;
    if (event) await api('/api/events/update', { method: 'POST', body: JSON.stringify({ ...f, eventId: ev.id, results: f.results ?? ev.results }) });
    else await api('/api/events', { method: 'POST', body: JSON.stringify(f) });
    d.close(); toast(event ? 'Saved.' : 'Added to the schedule.');
    await window.kestrelReload();
  }, e.submitter); };
  if (event) $('kEvDel').onclick = (e) => attempt(async () => {
    if (!confirm(`Delete ${ev.title}? Everyone's RSVPs to it go too.`)) return;
    await api('/api/events/delete', { method: 'POST', body: JSON.stringify({ eventId: ev.id }) });
    d.close(); toast('Deleted.');
    await window.kestrelReload();
  }, e.currentTarget);
};
window.kestrelAddEvent = (o = {}) => window.kestrelEventForm({ type: 'meet', ...o });

// Owner and captains: a week of practices in one go (Monday to Friday), or take a filled-in week back off.
const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const WEEK_KINDS = [['easy', 'Easy'], ['workout', 'Workout'], ['long_run', 'Long run'], ['off', 'No practice']];
window.kestrelPracticeWeek = ({ places = [] } = {}) => {
  const n = new Date(); n.setDate(n.getDate() - ((n.getDay() + 6) % 7) + (n.getDay() === 0 || n.getDay() === 6 ? 7 : 0));
  const monday = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
  const rhythm = ['easy', 'workout', 'easy', 'workout', 'easy'];
  const d = dialog();
  d.innerHTML = html`<h2>Add a week of practices</h2>
    <form id="kPwForm" class="k-stack">
      <p class="k-small">Fills Monday to Friday. Days that already have one of these practices are skipped, and nothing anyone added by hand changes.</p>
      <label class="k-label" for="kPwWeek">Week of</label><input class="k-input" id="kPwWeek" name="weekStart" type="date" required value="${monday}">
      <div class="k-pw-days">${WEEK_DAYS.map((day, i) => html`<label class="k-pw-day"><span>${day}</span><select class="k-input" name="k${i}" aria-label="${day}">${WEEK_KINDS.map(([v, l]) => html`<option value="${v}" ${v === rhythm[i] ? 'selected' : ''}>${l}</option>`)}</select></label>`)}</div>
      <div class="k-row">
        <div class="grow"><label class="k-label" for="kPwTime">Start time</label><input class="k-input" id="kPwTime" name="time" maxlength="40" value="4:00 PM"></div>
        <div class="grow"><label class="k-label" for="kPwEnd">End time</label><input class="k-input" id="kPwEnd" name="endTime" maxlength="40" placeholder="optional"></div>
      </div>
      <label class="k-label" for="kPwPlace">Place</label><input class="k-input" id="kPwPlace" name="location" list="kPwPlaces" maxlength="200" placeholder="optional">
      <datalist id="kPwPlaces">${places.map((p) => html`<option value="${p.name}">`)}</datalist>
      <div class="k-row k-dialog-foot"><button class="k-link danger" type="button" id="kPwClear">Take this week's off</button><button class="k-btn" type="button" id="kPwClose">Cancel</button><button class="k-btn primary" type="submit">Add practices</button></div>
    </form>`.s;
  d.showModal();
  $('kPwClose').onclick = () => d.close();
  $('kPwForm').onsubmit = (e) => { e.preventDefault(); attempt(async () => {
    const f = form(e.currentTarget);
    const r = await api('/api/schedule/week', { method: 'POST', body: JSON.stringify({ weekStart: f.weekStart, time: f.time, endTime: f.endTime, location: f.location, kinds: WEEK_DAYS.map((_, i) => f['k' + i]) }) });
    d.close(); toast(r.added.length ? `Added ${r.added.length} ${r.added.length === 1 ? 'practice' : 'practices'}.` : 'That week already has its practices.');
    await window.kestrelReload();
  }, e.submitter); };
  $('kPwClear').onclick = (e) => attempt(async () => {
    const week = $('kPwWeek').value;
    if (!confirm('Remove the practices added this way that week? Ones someone edited, and anything added by hand, stay.')) return;
    const r = await api('/api/schedule/week', { method: 'POST', body: JSON.stringify({ weekStart: week, clear: true }) });
    d.close(); toast(r.removed ? `Removed ${r.removed} ${r.removed === 1 ? 'practice' : 'practices'}.` : 'Nothing to remove that week.');
    await window.kestrelReload();
  }, e.currentTarget);
};

// A place from the Places tab. Passing `place` edits it (captains and the owner), with a delete.
window.kestrelPlaceForm = (place = null) => {
  const d = dialog();
  d.innerHTML = html`<h2>${place ? 'Edit place' : 'Add a place'}</h2>
    <form id="kPlForm" class="k-stack">
      <label class="k-label" for="kPlName">Name</label><input class="k-input" id="kPlName" name="name" maxlength="120" required value="${place?.name || ''}" placeholder="e.g. Memorial Park">
      <label class="k-label" for="kPlAddr">Address</label><input class="k-input" id="kPlAddr" name="address" maxlength="200" value="${place?.address || ''}" placeholder="Street address, or town and state">
      <p class="k-small">The address gives the map link and the weather forecast on meet cards.</p>
      <label class="k-label" for="kPlKind">What it is</label><select class="k-input" id="kPlKind" name="kind">${Object.entries(PLACE_KIND_LABEL).map(([v, l]) => html`<option value="${v}" ${v === (place?.kind || 'practice') ? 'selected' : ''}>${l}</option>`)}</select>
      <div class="k-row"><button class="k-btn primary" type="submit">${place ? 'Save' : 'Add place'}</button><button class="k-btn" type="button" id="kPlClose">Cancel</button>${place ? html`<button class="k-link danger" type="button" id="kPlDel">Delete</button>` : ''}</div>
    </form>`.s;
  d.showModal();
  $('kPlClose').onclick = () => d.close();
  $('kPlForm').onsubmit = (e) => { e.preventDefault(); attempt(async () => {
    const f = form(e.currentTarget);
    await api(place ? '/api/locations/update' : '/api/locations', { method: 'POST', body: JSON.stringify({ ...f, locationId: place?.id }) });
    d.close(); toast(place ? 'Place saved.' : 'Place added.');
    await window.kestrelReload();
  }, e.submitter); };
  if (place) $('kPlDel').onclick = (e) => attempt(async () => {
    if (!confirm(`Delete ${place.name}? Events there stay on the calendar.`)) return;
    await api('/api/locations/delete', { method: 'POST', body: JSON.stringify({ locationId: place.id }) });
    d.close(); toast('Place deleted.');
    await window.kestrelReload();
  }, e.currentTarget);
};

// -> { answer, events, places }. The free Kestrel AI answers on the server; any other model is called from the browser.
async function scheduleAsk(text, documents) {
  const body = JSON.stringify({ text, documents });
  const ai = AI.forTask(K.ai, 'chat');
  if (ai.provider === 'kestrel') return await api('/api/schedule/import', { method: 'POST', body });
  const chat = await api('/api/schedule/import/prompt', { method: 'POST', body });
  const system = `${chat.system}\n\nReply with ONLY a JSON object (no prose around it) matching this JSON Schema.\n${JSON.stringify(chat.schema)}`;
  const out = await AI.complete(ai, system, [{ role: 'user', content: chat.prompt }], { apiFetch: api });
  const obj = parseLoose(out) || {};
  return { answer: typeof obj.answer === 'string' ? obj.answer : '', events: Array.isArray(obj.events) ? obj.events : [], places: Array.isArray(obj.places) ? obj.places : [] };
}

// Describe the schedule or attach a file; Kestrel AI turns it into events and places, and nothing is saved until the list is confirmed.
window.kestrelScheduleAi = ({ places = [] } = {}) => {
  const st = { docs: [], busy: false, found: null };
  const d = dialog();
  d.classList.add('k-wide');
  d.innerHTML = html`<h2>Add to the schedule with Kestrel AI</h2>
    <p class="k-small">Paste your season schedule, describe it in a few sentences ("practice Mon/Wed/Fri 3:30 at the track until Nov 15, county meet Oct 12 at Memorial Park"), or attach a PDF, Word, Excel, CSV or text file. You check the list before anything is added.</p>
    <textarea class="k-input" id="kSaText" rows="4" maxlength="4000" placeholder="Describe or paste the schedule"></textarea>
    <div class="k-drop" id="kSaDrop"><input type="file" id="kSaFile" multiple hidden accept=".txt,.md,.csv,.tsv,.json,.pdf,.docx,.xlsx,.xls">
      <button class="k-btn small" type="button" id="kSaAttach">Attach files</button><span class="k-small" id="kSaDocs">No file attached.</span></div>
    <div class="k-row"><button class="k-btn primary" type="button" id="kSaRead">Read the schedule</button><button class="k-btn" type="button" id="kSaClose">Close</button></div>
    <p class="k-small" id="kSaMsg" role="status"></p>
    <div id="kSaFound"></div>`.s;
  d.showModal();
  $('kSaClose').onclick = () => d.close();
  const known = new Set(places.map((p) => p.name.trim().toLowerCase()));
  const paint = () => {
    $('kSaDocs').textContent = st.docs.length ? st.docs.map((x) => x.name + (x.truncated ? ' (first part only)' : '')).join(', ') : 'No file attached.';
    $('kSaRead').disabled = st.busy;
    const f = st.found;
    if (!f) { $('kSaFound').innerHTML = ''; return; }
    const evRows = f.events.map((e, i) => html`<label class="k-check"><input type="checkbox" data-ev="${i}" checked><span><b>${e.title}</b> · ${e.date}${e.time ? ' · ' + e.time : ''}${e.location ? ' · ' + e.location : ''} <small>(${e.type})</small></span></label>`);
    const plRows = f.places.filter((p) => !known.has(String(p.name).trim().toLowerCase())).map((p, i) => html`<label class="k-check"><input type="checkbox" data-pl="${i}" checked><span><b>${p.name}</b>${p.address ? ' · ' + p.address : ''} <small>(${PLACE_KIND_LABEL[p.kind] || 'Practice'})</small></span></label>`);
    f.newPlaces = f.places.filter((p) => !known.has(String(p.name).trim().toLowerCase()));
    $('kSaFound').innerHTML = html`${f.answer ? html`<p>${f.answer}</p>` : ''}
      ${evRows.length ? html`<h3>Events (${evRows.length})</h3>${evRows}` : ''}
      ${plRows.length ? html`<h3>New places (${plRows.length})</h3>${plRows}` : ''}
      ${evRows.length || plRows.length ? html`<div class="k-row"><button class="k-btn primary" type="button" id="kSaAdd">Add checked items</button></div>` : html`<p class="k-small">Nothing to add yet. Say more, or attach the file again.</p>`}`.s;
    if ($('kSaAdd')) $('kSaAdd').onclick = (e) => attempt(async () => {
      const events = f.events.filter((_, i) => d.querySelector(`[data-ev="${i}"]`)?.checked).map((x) => ({ date: x.date, title: x.title, type: x.type, time: x.time, endTime: x.end_time, location: x.location, checklist: x.bring, desc: x.notes }));
      const pls = f.newPlaces.filter((_, i) => d.querySelector(`[data-pl="${i}"]`)?.checked);
      // An unchecked place leaves its events with the venue name only, unlinked.
      const out = await api('/api/schedule/bulk', { method: 'POST', body: JSON.stringify({ events, places: pls }) });
      d.close();
      toast(`Added ${out.addedEvents} event${out.addedEvents === 1 ? '' : 's'}${out.addedPlaces ? ` and ${out.addedPlaces} place${out.addedPlaces === 1 ? '' : 's'}` : ''}${out.skipped ? `. Skipped ${out.skipped} already on the calendar.` : '.'}`);
      await window.kestrelReload();
    }, e.currentTarget);
  };
  paint();
  const addFiles = async (files) => {
    for (const f of files) {
      if (st.docs.length >= 5) { $('kSaMsg').textContent = 'Up to 5 files at a time.'; break; }
      if (f.size > 15 * 1024 * 1024) { $('kSaMsg').textContent = `${f.name} is over 15 MB.`; continue; }
      $('kSaMsg').textContent = `Reading ${f.name}…`;
      try {
        const text = (await extractText(f)).replace(/\u0000/g, '').trim();
        if (!text) throw new Error('no readable text (scanned images are not supported yet)');
        st.docs.push({ name: f.name, text: text.slice(0, 20000), truncated: text.length > 20000 });
        $('kSaMsg').textContent = '';
      } catch (err) { $('kSaMsg').textContent = `Could not read ${f.name}: ${err.message}`; }
    }
    paint();
  };
  $('kSaAttach').onclick = () => $('kSaFile').click();
  $('kSaFile').onchange = (e) => { addFiles([...e.target.files]); e.target.value = ''; };
  const drop = $('kSaDrop');
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); addFiles([...e.dataTransfer.files]); };
  $('kSaRead').onclick = async () => {
    const text = $('kSaText').value.trim();
    if (!text && !st.docs.length) { $('kSaMsg').textContent = 'Describe the schedule or attach a file first.'; return; }
    st.busy = true; st.found = null; $('kSaMsg').textContent = 'Reading…'; paint();
    try {
      const out = await scheduleAsk(text, st.docs.map(({ name, text }) => ({ name, text })));
      // Drop rows the server would refuse, so the list only shows what can be saved.
      st.found = { answer: out.answer || '', places: (out.places || []).filter((p) => p?.name), events: (out.events || []).filter((e) => e?.title && /^\d{4}-\d{2}-\d{2}$/.test(e.date || '')).slice(0, 80) };
      $('kSaMsg').textContent = '';
    } catch (err) { $('kSaMsg').textContent = err.message; }
    st.busy = false; paint();
  };
};

function dialog() {
  let d = $('kDialog');
  if (!d) { d = document.createElement('dialog'); d.id = 'kDialog'; d.className = 'k-dialog'; document.body.appendChild(d); }
  d.innerHTML = '';
  return d;
}

// ---------- Support Kestrel: donations happen elsewhere; a code from the thank-you email unlocks cosmetic perks

// A supporter's accent colour, on every page. Only the accent changes; the rest of the design stays put.
function applyAccent() {
  const a = K.cfg?.accents?.[K.me?.appearance?.accent], root = document.documentElement;
  if (!a || K.me?.appearance?.accent === 'kestrel' || !K.me?.supporter) { ['--accent', '--accent-hover', '--hawk-eye', '--accent-ink', '--accent-subtle'].forEach((v) => root.style.removeProperty(v)); return; }
  const dark = root.dataset.theme === 'dark' || (root.dataset.theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  const c = dark ? a.dark : a.light;
  root.style.setProperty('--accent', c); root.style.setProperty('--accent-hover', c); root.style.setProperty('--hawk-eye', c);
  root.style.setProperty('--accent-ink', dark ? `color-mix(in srgb, ${c} 75%, white)` : `color-mix(in srgb, ${c} 80%, black)`);
  root.style.setProperty('--accent-subtle', `color-mix(in srgb, ${c} ${dark ? 22 : 14}%, var(--surface))`);
}
try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyAccent()); } catch { /* old browsers */ }
function renderSupportCard(el) {
  const d = K.cfg?.donate || {}, sup = K.me?.supporter, acc = K.me?.appearance?.accent || 'kestrel';
  const links = [d.main && ['Donate', d.main, 'primary'], d.alt && ['Other ways to give', d.alt, ''], d.campaign && ['Current campaign', d.campaign, '']].filter(Boolean);
  el.innerHTML = html`<p class="k-small">Kestrel is free and open source, with no ads and nothing sold. The servers and the AI cost a little for every runner; donations keep it free for school teams. Every donation gets a thank-you email with a supporter code.</p>
    <ul class="k-perks"><li><b>Any amount</b><span>App colour themes, and the next cosmetic thank-yous as they’re added.</span></li><li><b>$100 or more</b><span>All of that, plus Kestrel merch, sent to you.</span></li></ul>
    ${links.length ? html`<div class="k-row">${links.map(([l, u, c]) => html`<a class="k-btn small ${c}" href="${u}" target="_blank" rel="noopener">${l}</a>`)}</div>` : html`<p class="k-small"><i>Donations open soon.</i></p>`}
    ${sup ? html`<div class="k-supported"><b>${sup.tier === 'champion' ? 'Champion supporter' : 'Supporter'}</b> since ${new Date(sup.since).toLocaleDateString()}. Thank you.</div>` : html`<form id="kSupForm" class="k-row"><input class="k-input mono" id="kSupCode" placeholder="KS-…" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="Supporter code" style="flex:1;min-width:0"><button class="k-btn small">Redeem</button></form>`}
    <div class="k-accents" role="radiogroup" aria-label="App colour">${Object.entries(K.cfg?.accents || {}).map(([k, a]) => html`<button type="button" class="k-accent ${k === acc ? 'on' : ''}" data-accent="${k}" role="radio" aria-checked="${k === acc}" ${!sup && k !== 'kestrel' ? 'disabled' : ''} style="--sw:${a.light};--sw2:${a.dark}" title="${a.label}"><i></i><span>${a.label}</span></button>`)}</div>
    ${sup ? '' : html`<p class="k-small">Colours unlock with a supporter code.</p>`}`.s;
  $('kSupForm')?.addEventListener('submit', (e) => { e.preventDefault(); attempt(async () => {
    try { const r = await api('/api/me/supporter', { method: 'POST', body: JSON.stringify({ code: $('kSupCode').value }) }); K.me.supporter = r.supporter; toast('Thank you for supporting Kestrel.'); renderSupportCard(el); }
    catch (err) { toast(err.message, true); }
  }, e.submitter); });
  el.querySelectorAll('[data-accent]').forEach((b) => { b.onclick = () => attempt(async () => {
    const r = await api('/api/me/appearance', { method: 'PUT', body: JSON.stringify({ accent: b.dataset.accent }) });
    K.me.appearance = r.appearance; applyAccent(); renderSupportCard(el);
  }); });
}
window.kestrelApplyAccent = applyAccent;

// ---------- Helping Kestrel's models: anonymized training, only with the runner's yes

const SHARE_OPTS = [
  ['none', 'Don’t share', 'Your training stays in your account and nowhere else.'],
  ['kestrel', 'Share with Kestrel only', 'Kestrel uses your anonymized runs to test and improve its race models, plan levels and coach. Never published or sold.'],
  ['open', 'Add to the Kestrel open dataset', 'The same anonymized runs may also be published in Kestrel’s open dataset (CC BY 4.0), so anyone can build better running models. 18 and over.'],
];
function renderShareCard(el, onDone) {
  const cur = K.me?.data_share?.choice || 'none';
  const age = K.me?.profile?.birth_year ? new Date().getFullYear() - K.me.profile.birth_year : null;
  el.innerHTML = html`<p class="k-small">Kestrel’s models get better with more real training behind them. If you want to help, choose how. You can change this any time.</p>
    <div class="k-share" role="radiogroup" aria-label="Share your training">${SHARE_OPTS.map(([v, l, d]) => {
      const off = v === 'open' && (age == null || age < 18);
      return html`<label class="k-shareopt ${v === cur ? 'on' : ''} ${off ? 'dis' : ''}"><input type="radio" name="kShare" value="${v}" ${v === cur ? 'checked' : ''} ${off ? 'disabled' : ''}><span><b>${l}</b><small>${off ? (age == null ? 'Add the year you were born in your runner profile to choose this. 18 and over.' : 'For runners 18 and over.') : d}</small></span></label>`; })}</div>
    <details class="k-help"><summary>What “anonymized” means</summary><ul class="k-list">
      <li><b>Shared:</b> each run’s type, distance, time, heart rate, cadence, laps, difficulty and load; your age band (like 16-17), sex if you gave it, and how long you’ve run.</li>
      <li><b>Never shared:</b> your name, email, team or school, GPS routes, courses, start times, notes, health and body map, Kestrel AI’s messages, or anything you typed.</li>
      <li>You get a random code instead of an id, and every date is moved by the same secret number of weeks, so runs can’t be matched to a calendar.</li>
      <li>Turning sharing off stops anything new from being used. Kestrel-only data is removed from its working copies; records already published in an open dataset release can’t be recalled.</li>
      <li>Full details: <a href="/legal#data" target="_blank" rel="noopener">Privacy → Data for Kestrel’s models</a>.</li></ul></details>
    <p class="k-small" id="kShareMsg" role="status">${K.me?.data_share?.at ? `Chosen ${new Date(K.me.data_share.at).toLocaleDateString()}.` : ''}</p>`.s;
  el.querySelectorAll('input[name=kShare]').forEach((r) => { r.onchange = () => attempt(async () => {
    const out = await api('/api/me/data-sharing', { method: 'PUT', body: JSON.stringify({ choice: r.value }) }).catch((err) => { toast(err.message, true); return null; });
    if (!out) { renderShareCard(el, onDone); return; }
    K.me.data_share = out.data_share;
    toast(r.value === 'none' ? 'Your training isn’t shared.' : r.value === 'kestrel' ? 'Thanks. Kestrel can learn from your anonymized runs.' : 'Thanks. Your anonymized runs can join the open dataset.');
    renderShareCard(el, onDone);
    onDone?.(r.value);
  }); });
}
window.kestrelShareCard = renderShareCard;
window.kestrelMe = () => K.me;

// Own-model helpers for the screens: a session's report, and food estimates. Free Kestrel AI runs on the server.
window.kestrelAiTask = (task) => { const a = AI.forTask(K.ai, task); return { provider: a.provider, own: a.provider !== 'kestrel', serverOwn: task === 'summary' && K.me?.ai_tasks?.summary === 'own', label: a.provider === 'kestrel' ? freeName() : AI.describe(a), vision: a.provider !== 'kestrel' || !!K.cfg?.freeVision }; };
function freeName() { return `Kestrel free (${K.cfg?.freeModel || 'free model'})`; }
// Run summaries: the choice is stored explicitly here and on the server, so it never drifts with the main model.
async function setSummary(v) {
  K.ai = { ...K.ai, tasks: { ...(K.ai.tasks || {}), summary: v } };
  AI.saveAi(K.ai);
  const r = await api('/api/me/ai-tasks', { method: 'PUT', body: JSON.stringify({ summary: v === 'kestrel' ? 'kestrel' : 'own' }) });
  if (K.me) K.me.ai_tasks = r.ai_tasks;
}
window.kestrelSetSummary = setSummary;
window.kestrelWriteReport = async (key) => {
  const ai = AI.forTask(K.ai, 'summary');
  if (ai.provider === 'kestrel') throw new Error('Run summaries are on Kestrel free: they are written when your runs sync.');
  const chat = await api('/api/ai/session/prompt', { method: 'POST', body: JSON.stringify({ key }) });
  const text = await AI.complete(ai, chat.system, [{ role: 'user', content: chat.prompt }], { apiFetch: api });
  return (await api('/api/ai/session/save', { method: 'POST', body: JSON.stringify({ key, main_id: chat.main_id, report: text }) })).report;
};
window.kestrelFoodEstimate = async ({ images = [], text = '', meal = '' }) => {
  const ai = AI.forTask(K.ai, 'food');
  if (ai.provider === 'kestrel') return await api('/api/ai/food', { method: 'POST', body: JSON.stringify({ images, text, meal }) });
  const chat = await api('/api/ai/food/prompt', { method: 'POST', body: JSON.stringify({ text, meal, photos: images.length }) });
  const out = await AI.complete(ai, chat.system, [{ role: 'user', content: chat.prompt, images }], { apiFetch: api });
  return await api('/api/ai/food/check', { method: 'POST', body: JSON.stringify({ out: parseLoose(out) || {} }) });
};

// ---------- You > Settings: Kestrel AI, race models, account

window.kestrelRenderSettings = async () => {
  const ai = $('kAiBody');
  if (ai) {
    // One choice per job. The list is the free default plus every model set up in Kestrel Lab.
    const ids = AI.usable(K.ai);
    const nameOf = (id) => id === 'kestrel' ? freeName() : AI.describe({ ...K.ai, provider: id });
    ai.innerHTML = html`<p class="k-small">Kestrel works out of the box on a free model. Pick what runs each job: the free default, or a model you set up in Kestrel Lab (your own key, or a model on your own computer). Keys stay in this browser.</p>
      <div class="k-tasks">${Object.entries(AI.TASKS).map(([t, info]) => html`<label class="k-task"><span><b>${info.label}</b><small>${info.hint}</small></span>
        <select class="k-input" data-task="${t}">${ids.map((id) => html`<option value="${id}" ${AI.forTask(K.ai, t).provider === id ? 'selected' : ''}>${nameOf(id)}</option>`)}</select></label>`)}</div>
      <div class="k-row spread"><span class="k-small" style="margin:0">Add a model: your own key, Ollama or LM Studio.</span><a class="k-btn small" href="/lab#/providers">Set up in Lab</a></div>
      <details class="k-help"><summary>Which should I pick?</summary><ul class="k-list">
        <li><b>Kestrel free</b> costs nothing and needs no setup. Here it runs on ${K.cfg?.freeModel === 'Gemini' ? 'Google Gemini’s free tier, which allows Google to use what is sent to improve its products' : 'open-weight models on Cloudflare'}; Kestrel sends what each job needs (your first name, training, profile details, and what you type or photograph), never your email.${K.cfg?.freeVision ? '' : ' It can’t read food photos yet: describe food in words, or pick a model that sees images.'}</li>
        <li><b>Your own key</b> (Anthropic, OpenAI, Gemini paid, OpenRouter) keeps your data out of free-tier training and is usually a little sharper. You pay the provider directly; a month of chat is typically cents.</li>
        <li><b>A local model</b> (Ollama, LM Studio) keeps everything on your computer. Food photos need one that can see images, like llava or qwen2.5-vl.</li>
        <li>Whatever you pick, Kestrel’s guardrails check every plan change, and every model follows the Kestrel ethos.</li></ul></details>
      <div class="k-row spread"><span class="k-small" style="margin:0">Every model follows the Kestrel ethos, plus your own.</span><button type="button" class="k-btn small" id="kEthosLink">Ethos</button></div>
      <p class="k-small">AI can be wrong. It is not a doctor or a certified coach.</p>`.s;
    $('kEthosLink').onclick = () => window.navGo?.('run', 'ethos');
    ai.querySelectorAll('[data-task]').forEach((sel) => { sel.onchange = () => attempt(async () => {
      const t = sel.dataset.task, v = sel.value;
      // Run summaries are written on the server unless they run on the runner's own model.
      if (t === 'summary') await setSummary(v);
      else { K.ai = { ...K.ai, tasks: { ...(K.ai.tasks || {}), [t]: v === K.ai.provider ? undefined : v } }; if (K.ai.tasks[t] === undefined) delete K.ai.tasks[t]; AI.saveAi(K.ai); }
      toast(`${AI.TASKS[t].label}: ${nameOf(v)}.`);
    }); });
  }
  const ds = $('kShareBody');
  if (ds) renderShareCard(ds);
  const sp = $('kSupportBody');
  if (sp) renderSupportCard(sp);
  const mb = $('kModelsBody');
  if (mb) {
    const labels = { race: 'Race times (800 m and up)', short: 'Sprints and steeple', marathon: 'Marathon' };
    const lists = await attempt(() => Promise.all(Object.keys(labels).map((t) => api(`/api/models?task=${t}`))));
    if (lists) {
      const nameOf = (t, i) => { const m = lists[i].models.find((x) => x.id === K.me.models[t]); return m ? `${m.name} ${m.version}${m.builtin ? '' : ` · by ${m.owner}`}` : 'Kestrel default'; };
      mb.innerHTML = html`<p class="k-small">Every prediction in Fitness comes from an open model. Kestrel picks a good one for each. To compare models on your own results, switch, fork or publish one, open Kestrel Lab.</p>
        ${Object.keys(labels).map((t, i) => html`<div class="k-row spread"><div><div class="k-small" style="margin:0">${labels[t]}</div><b>${nameOf(t, i)}</b></div><a class="k-btn small" href="/lab#/m/${encodeURIComponent(K.me.models[t])}">Open in Lab</a></div>`)}
        <div class="k-row"><a class="k-btn small primary" href="/lab#/workbench">Test models on my PRs</a><a class="k-btn small" href="/lab#/models">Browse models</a></div>`.s;
    }
  }
  const priv = $('kPrivacyBody');
  if (priv) {
    const shared = !!K.me.user.share_miles;
    priv.innerHTML = html`<ul class="k-list">
        <li>Teammates see your name, colour, availability, RSVPs, and roster details (number, grade, events).</li>
        <li>Teammates who share can see each other's recent activities (distance, time, pace, heart rate). Your health, body map, predictions, GPS routes and coach notes are only yours and your AI coach's.</li>
        <li>Team owners and captains can edit the roster and plan, but cannot see your training or health.</li>
      </ul>
      <label class="k-check"><input type="checkbox" id="kShareMiles" ${shared ? 'checked' : ''}><span>Show my weekly miles on my teams' mileage boards</span></label>
      <label class="k-check"><input type="checkbox" id="kShareActs" ${K.me.user.share_activities ? 'checked' : ''}><span>Show my recent activities to my teammates, like Strava</span></label>`.s;
    $('kShareActs').onchange = (e) => attempt(async () => { await window.kestrelSaveProfile({ share_activities: e.target.checked }); toast(e.target.checked ? 'Teammates can see your activities.' : 'Your activities are hidden from teammates.'); });
    $('kShareMiles').onchange = (e) => attempt(async () => { await window.kestrelSaveProfile({ share_miles: e.target.checked }); toast(e.target.checked ? 'Your miles are on the board.' : 'Your miles are hidden. Team totals still count them.'); });
  }
  const acct = $('kAccountBody');
  if (acct) {
    acct.innerHTML = html`<p class="k-small">Signed in as ${K.me.user.email}</p>
      <div class="k-row"><button class="k-btn small" type="button" id="kSignOut">Sign out</button><button class="k-link danger" type="button" id="kDelete">Delete my Kestrel data</button></div>
      <p class="k-small">Kestrel is open source (MIT). <a href="${REPO_URL}" target="_blank" rel="noopener">Source code</a> · <a href="/lab">Kestrel Lab</a> · <a href="/legal" target="_blank" rel="noopener">Terms and privacy</a></p>`.s;
    $('kSignOut').onclick = () => K.sb.auth.signOut();
    $('kDelete').onclick = (e) => attempt(async () => {
      if (!confirm('Delete everything about you in Kestrel: your log, plan, PRs, models, and team memberships? This cannot be undone.')) return;
      await api('/api/me', { method: 'DELETE' });
      store.del(`kestrel.chat.${K.me.user.id}`);
      await K.sb.auth.signOut();
      toast('Your Kestrel data is deleted.');
    }, e.currentTarget);
  }
};

// The model picker above the chat: any provider that can run (the free default, or one with a key saved in Lab), then
// that provider's models, listed live from its API. The choice is the chat job's model (Lab → AI per job shows it too).
const modelCache = {};
const CHAT_MODEL = {
  // Only models that chat: OpenAI's list also has embeddings, speech, images and moderation.
  openai: (id) => /^(gpt-|o\d|chatgpt-)/.test(id) && !/(embed|audio|tts|transcribe|realtime|image|search|moderation|instruct|dall-e|whisper|codex)/.test(id),
  anthropic: (id) => /^claude-/.test(id),
};
// Shown when the provider's list can't be read (no network, or a key without list access).
const FALLBACK_MODELS = { anthropic: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'] };
async function modelsFor(id) {
  if (modelCache[id]) return modelCache[id];
  let list = [];
  try { list = await AI.listModels(K.ai, id); } catch { list = []; }
  list = list.filter(CHAT_MODEL[id] || (() => true));
  if (!list.length) list = FALLBACK_MODELS[id] || [];
  return (modelCache[id] = list);
}
window.kestrelChatModel = () => AI.describe(AI.forTask(K.ai, 'chat'));
window.kestrelRenderPower = async (el) => {
  if (!el) return;
  const cur = AI.forTask(K.ai, 'chat');
  const ids = AI.usable(K.ai);
  const model = cur.provider === 'kestrel' ? '' : AI.configFor(K.ai, cur.provider).model;
  const name = (id) => AI.PROVIDERS[id].label.replace(/ \(.*\)$/, '');
  el.innerHTML = html`<label class="k-pick"><span>Model</span><select class="k-input k-sm" id="kChatProv" aria-label="Who powers Kestrel AI chat">${ids.map((id) => html`<option value="${id}" ${id === cur.provider ? 'selected' : ''}>${id === 'kestrel' ? 'Kestrel free' : name(id)}</option>`)}</select></label>
    ${cur.provider === 'kestrel' ? '' : html`<select class="k-input k-sm" id="kChatModel" aria-label="Model"><option value="${model}">${model || 'Choose a model'}</option></select>`}
    <a class="k-link" href="/lab#/providers">${ids.length > 1 ? 'Keys' : 'Add an API key'}</a>`.s;
  const set = (provider, mdl) => {
    const tasks = { ...(K.ai.tasks || {}) };
    if (provider === K.ai.provider) delete tasks.chat; else tasks.chat = provider;
    const configs = { ...K.ai.configs };
    if (mdl && provider !== 'kestrel') configs[provider] = { ...(configs[provider] || {}), model: mdl };
    K.ai = { ...K.ai, tasks, configs };
    AI.saveAi(K.ai);
    window.kestrelRenderPower(el);
  };
  $('kChatProv').onchange = (e) => set(e.target.value);
  const sel = $('kChatModel');
  if (sel) {
    const list = await modelsFor(cur.provider);
    if (!sel.isConnected || !list.length) return;
    const all = [...new Set([model, ...list].filter(Boolean))];
    sel.innerHTML = html`${model ? '' : html`<option value="">Choose a model</option>`}${all.map((m) => html`<option value="${m}" ${m === model ? 'selected' : ''}>${m}</option>`)}`.s;
    sel.onchange = () => set(cur.provider, sel.value);
  }
};

// ---------- Kestrel AI: the coach chat with whatever model the athlete picked

function parseLoose(text) {
  const t = String(text || '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  try { return JSON.parse(t); } catch { /* try the outermost braces */ }
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch { /* not JSON */ } }
  return null;
}

// turns: [{ role: 'user' | 'kai', text }] -> { answer, saved, refused } or { error }
window.kestrelAsk = async (turns) => {
  try {
    const ai = AI.forTask(K.ai, 'chat');
    if (ai.provider === 'kestrel') return await api('/api/coach/ask', { method: 'POST', body: JSON.stringify({ history: turns }) });
    const chat = await api('/api/coach/prompt', { method: 'POST', body: JSON.stringify({ history: turns }) });
    const system = `${chat.system}\n\nReply with ONLY a JSON object (no prose around it) matching this JSON Schema. "answer" is what the athlete reads; fill the other fields only when the rules above say to.\n${JSON.stringify(chat.schema)}`;
    const text = await AI.complete(ai, system, [{ role: 'user', content: chat.prompt }], { apiFetch: api });
    const out = parseLoose(text) || { answer: text };
    if (typeof out.answer !== 'string' || !out.answer.trim()) out.answer = typeof text === 'string' ? text : 'The model returned nothing.';
    const applied = await api('/api/coach/apply', { method: 'POST', body: JSON.stringify({ out }) });
    return { answer: out.answer, ...applied };
  } catch (err) {
    return { error: err.message };
  }
};

// ---------- boot

async function boot() {
  const m = location.pathname.match(/^\/join\/([A-Za-z0-9-]{4,20})/);
  if (m) { store.set('kestrel.join', m[1].toUpperCase()); history.replaceState(null, '', '/'); }
  K.cfg = await fetch('/api/config').then((r) => r.json());
  K.levels = K.cfg.levels || [];
  if (!K.cfg.supabaseUrl || !K.cfg.supabaseKey) {
    gate(html`<div class="k-landing">${hero()}<div class="k-auth"><h2>Almost ready</h2><p class="k-small">Sign-in isn't connected on this server yet (SUPABASE_URL and SUPABASE_KEY in wrangler.jsonc).</p></div></div>`);
    return;
  }
  const params = new URLSearchParams(location.search);
  K.recovering = params.has('reset');
  // Google sign-in started in an app runs in the system browser and finishes here: first mark the browser and go on to Google,
  // then, when Google sends the code back, pass it to the app.
  if (!SHELL) {
    // The mark is { t, port }: when the sign-in started, and the Mac app's loopback port (none on iOS, Android or older
    // Mac apps, which take the kestrel:// link instead). Older marks were just the time.
    const MARK = 'k-appauth';
    let mark = null;
    try { const raw = localStorage.getItem(MARK) || ''; mark = raw.startsWith('{') ? JSON.parse(raw) : raw ? { t: Number(raw) } : null; } catch {}
    const marked = !!mark && Date.now() - Number(mark.t || 0) < 10 * 60e3;
    const portOf = (v) => { const n = Number(v); return Number.isInteger(n) && n >= 1024 && n <= 65535 ? n : 0; };
    const to = params.get('to') || '';
    if (params.get('appauth') === 'start' && to.startsWith(K.cfg.supabaseUrl + '/auth/v1/authorize')) {
      try { localStorage.setItem(MARK, JSON.stringify({ t: Date.now(), port: portOf(params.get('port')) })); } catch {}
      gate(html`<div class="k-landing"><div class="k-auth"><h2>Continuing with Google…</h2></div></div>`);
      location.replace(to);
      return;
    }
    if (marked && (params.has('code') || params.has('error'))) {
      try { localStorage.removeItem(MARK); } catch {}
      const back = 'kestrel://auth-callback' + location.search;
      const port = portOf(mark.port);
      gate(html`<div class="k-landing"><div class="k-auth"><h2>Opening Kestrel…</h2><p class="k-small">If the app doesn’t open, tap the button.</p><a class="k-btn primary wide" href="${back}">Open Kestrel</a></div></div>`);
      location.replace(port ? `http://127.0.0.1:${port}/auth-callback${location.search}` : back);
      return;
    }
  }
  const fromLink = params.has('code');
  K.sb = createClient(K.cfg.supabaseUrl, K.cfg.supabaseKey, { auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true } });
  sbReady();
  K.sb.auth.onAuthStateChange((event, session) => {
    if (K.recovering || event === 'PASSWORD_RECOVERY') { if (session) renderNewPassword(); return; }
    // The app holds the signed-out person's data in memory; a fresh page is the clean way out.
    if (event === 'SIGNED_OUT') { if (K.started) { location.replace('/'); return; } K.me = null; renderLanding(); return; }
    if (session && !K.me) setTimeout(afterSignIn, 0);
  });
  const { data } = await K.sb.auth.getSession();
  if (location.search) {
    const err = params.get('error_description');
    history.replaceState(null, '', '/' + location.hash);
    if (err) toast(err, true);
  }
  if (K.recovering) {
    if (data.session) renderNewPassword();
    else renderLanding('signin', 'That reset link has expired or was opened in another browser. Ask for a new one.');
    return;
  }
  if (data.session) await afterSignIn();
  else renderLanding(fromLink ? 'signin' : undefined, fromLink ? 'Your email is confirmed. Sign in to continue.' : '');
}

boot().catch((err) => { console.error(err); gate(html`<p class="k-small">Kestrel could not start: ${err.message}</p>`); });
