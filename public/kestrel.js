// Kestrel around the Hawks app: sign-in (Supabase), onboarding, teams (switch, start, join, manage), which model
// powers Kestrel AI, and which Kestrel Lab models make race predictions. The app itself (index.html's main script)
// starts through window.hawksInit once someone is signed in; every API call it makes carries the sign-in and the
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

function renderLanding(mode = 'signin', message = '') {
  const signup = mode === 'signup';
  gate(html`<header class="k-top"><a class="k-brand" href="/"><img src="/kestrel.svg" alt="" width="44" height="44"><span class="k-top-word">kestrel</span></a><a class="k-btn small ghost" href="/lab">Kestrel Lab</a></header><div class="k-landing">${hero()}
  <div class="k-auth">
    <span class="k-chip accent k-auth-chip">free &amp; open source</span>
    <h2>${signup ? 'Create your account' : 'Sign in'}</h2>
    <button class="k-btn wide" id="kGoogle" type="button"><svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.4-4.1 7-10.1 7-17.6z"/><path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>Continue with Google</button>
    <div class="k-or">or with email</div>
    <form id="kEmailForm">
      <label class="k-label" for="kEm">Email</label><input class="k-input" id="kEm" name="email" type="email" autocomplete="email" required>
      <label class="k-label" for="kPw">Password</label><input class="k-input" id="kPw" name="password" type="password" minlength="8" autocomplete="${signup ? 'new-password' : 'current-password'}" required>
      ${signup ? html`<p class="k-small">We'll email you a link to confirm your address before you can sign in.</p>` : ''}
      ${message ? html`<p class="k-small k-good">${message}</p>` : ''}
      <button class="k-btn primary wide" type="submit">${signup ? 'Create account' : 'Sign in'}</button>
    </form>
    <div class="k-row spread">
      <button class="k-link" type="button" id="kSwap">${signup ? 'Have an account? Sign in' : 'New here? Create an account'}</button>
      ${signup ? '' : html`<button class="k-link" type="button" id="kForgot">Forgot password?</button>`}
    </div>
    <p class="k-small">Kestrel is open source: <a href="${REPO_URL}" target="_blank" rel="noopener">read the code</a>. Building running models? <a href="/lab">Kestrel Lab</a>.</p>
  </div></div>${showcase()}`);
  $('kGoogle').onclick = (e) => attempt(async () => {
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

const OB_STEPS = ['About you', 'Body', 'Running', 'Personal records', 'Goals'];
const OB_YEAR = new Date().getFullYear();

function renderOnboarding(step = 0, d = K.ob || (K.ob = { units: 'mi', age: false })) {
  K.ob = d;
  const u = K.me.user;
  const metric = d.units === 'km';
  const sel = (name, opts, cur) => html`<select class="k-input" name="${name}">${opts.map(([v, l]) => html`<option value="${v}" ${String(cur ?? '') === v ? 'selected' : ''}>${l}</option>`)}</select>`;
  const field = (label, inner, hint = '') => html`<label class="k-label">${label}</label>${inner}${hint ? html`<p class="k-small">${hint}</p>` : ''}`;
  const num = (name, ph, extra = '') => html`<input class="k-input" name="${name}" type="number" inputmode="decimal" step="any" placeholder="${ph}" value="${d[name] ?? ''}" ${extra}>`;
  const time = (name, ph) => html`<input class="k-input mono" name="${name}" placeholder="${ph}" value="${d[name] ?? ''}" maxlength="10" inputmode="numeric" pattern="[0-9:.]*">`;
  const panels = [
    () => html`
      ${K.cfg?.freeAi ? html`<div class="k-ai-fill"><label class="k-label" for="kObAi">Short on time? Describe yourself and let Kestrel AI fill this in.</label>
        <textarea class="k-input" id="kObAi" rows="3" maxlength="2000" placeholder="e.g. I'm 5'10, 150 lb, run about 30 miles a week with a Garmin. 5K PR 19:38, mile 5:10. Want to run 18:30 at the Oct 25 5K."></textarea>
        <button class="k-btn small" type="button" id="kObAiGo">Fill in with AI</button>
        <p class="k-small">You can check and change everything before you finish. Or fill it in by hand below.</p></div><hr class="k-rule">` : ''}
      ${field('Your name (teammates see this)', html`<input class="k-input" name="name" value="${d.name ?? u.name}" maxlength="60" required>`)}
      ${field('Year you were born', num('birth_year', 'e.g. 2008', `min="1930" max="${OB_YEAR - 8}" required`), 'Used for heart-rate zones and age-graded comparisons.')}
      ${field('Sex (race models use it if you give it)', sel('sex', [['', 'Prefer not to say'], ['f', 'Female'], ['m', 'Male']], d.sex))}
      ${field('Grade', sel('class_year', [['', 'Not set'], ...['Middle school', 'Freshman', 'Sophomore', 'Junior', 'Senior', 'College', 'Adult'].map((x) => [x, x])], d.class_year))}
      ${field('Units', sel('units', [['mi', 'Miles, feet and pounds'], ['km', 'Kilometres and kilograms']], d.units))}`,
    () => html`
      ${metric
        ? field('Height (cm)', num('height_cm', 'e.g. 172', 'min="100" max="230"'))
        : field('Height', html`<div class="k-row2">${num('ft', 'ft', 'min="3" max="7"')}${num('in', 'in', 'min="0" max="11.9"')}</div>`)}
      ${field(metric ? 'Weight (kg)' : 'Weight (lb)', num('weight', metric ? 'e.g. 62' : 'e.g. 135', 'min="50" max="500"'), 'Optional. Used for calorie and pace estimates. Only you see it.')}
      ${field('Resting heart rate (bpm)', num('resting_hr', 'e.g. 52', 'min="30" max="120"'), 'Optional. Your watch shows this.')}
      ${field('Max heart rate (bpm)', num('max_hr', 'e.g. 195', 'min="120" max="230"'), 'Optional. Leave blank and we estimate it from your age.')}`,
    () => html`
      ${field('How long have you been running?', sel('experience', [['', 'Choose one'], ['new', 'Just starting'], ['under1', 'Under a year'], ['1to3', '1 to 3 years'], ['3plus', 'More than 3 years']], d.experience))}
      ${field('Miles you run in a typical week right now', num('weekly_miles', 'e.g. 25', 'min="0" max="150" required'), 'We start your plan on the level that fits.')}
      ${field('Longest run in the last month (miles)', num('longest_run_mi', 'e.g. 8', 'min="0" max="100"'))}
      ${field('Days a week you want to run', sel('days_per_week', [['', 'Choose one'], ...[3, 4, 5, 6, 7].map((n) => [String(n), `${n} days`])], d.days_per_week))}
      ${field('What do you train with?', sel('watch', [['', 'Choose one'], ['garmin', 'Garmin'], ['coros', 'COROS'], ['apple', 'Apple Watch'], ['strava', 'Strava only'], ['other', 'Something else'], ['none', 'Nothing yet']], d.watch), 'You can connect it in You → Settings.')}
      ${field('Injuries or limits we should know about', html`<textarea class="k-input" name="injuries" maxlength="300" rows="2" placeholder="e.g. shin splints last spring">${d.injuries ?? ''}</textarea>`)}`,
    () => html`<p class="k-small">Add the ones you have, skip the rest. Times look like 58.4, 2:15 or 19:38.</p>
      ${field('800 m', time('pr800', 'e.g. 2:20'))}
      ${field('1600 m (mile)', time('pr1600', 'e.g. 5:15'))}
      ${field('3200 m (2 mile)', time('pr3200', 'e.g. 11:30'))}
      ${field('5K', time('pr5K', 'e.g. 19:38'), 'Your best or current 5K sets all your training paces.')}`,
    () => html`
      ${field('What are you here for?', sel('goal', [['', 'Choose one'], ['race', 'Run a specific race'], ['faster', 'Get faster'], ['distance', 'Build up distance'], ['fitness', 'Stay fit and healthy'], ['weight', 'Lose weight'], ['team', 'Train with my team']], d.goal))}
      ${field('Target event (if you have one)', sel('goal_event', [['', 'None yet'], ...['800', '1600', '3200', '5K', '10K', 'Half marathon', 'Marathon'].map((x) => [x, x])], d.goal_event))}
      ${field('Goal time', time('goal_time', 'e.g. 18:30'))}
      ${field('Race date', html`<input class="k-input" name="goal_date" type="date" value="${d.goal_date ?? ''}">`)}
      <label class="k-check"><input type="checkbox" name="age" ${d.age ? 'checked' : ''} required><span>I am 13 or older. If I'm under 18, a parent or guardian knows I'm using Kestrel.</span></label>
      <p class="k-small">Teammates see your name, colour, availability and RSVPs. Your training log, health, body map and predictions are only yours.</p>`,
  ];
  const last = step === OB_STEPS.length - 1;
  gate(html`<div class="k-auth narrow"><div class="k-steps" aria-label="Step ${step + 1} of ${OB_STEPS.length}">${OB_STEPS.map((n, i) => html`<i class="${i < step ? 'done' : i === step ? 'on' : ''}"></i>`)}</div>
    <div class="k-kicker">Step ${step + 1} of ${OB_STEPS.length}</div>
    <h2>${step === 0 ? 'Welcome to Kestrel' : OB_STEPS[step]}</h2>
    <p class="k-small">${['Let’s set up your profile so your coach can build the right plan.', 'Helps with pace, effort and heart-rate zones. All of it is private.', 'Where you are today, so the plan starts at the right level.', 'Your coach uses these to predict your races.', 'Tell us what you’re working towards.'][step]}</p>
    <form id="kOb" novalidate>${panels[step]()}
      <div class="k-nav">${step ? html`<button class="k-btn ghost" type="button" id="kObBack">Back</button>` : ''}<button class="k-btn primary" style="flex:1">${last ? 'Finish' : 'Continue'}</button></div>
    </form></div>`);
  const grab = () => {
    const f = form($('kOb'));
    for (const [k, v] of Object.entries(f)) d[k] = v;
    if (step === 4) d.age = !!f.age;
  };
  if ($('kObAiGo')) $('kObAiGo').onclick = (e) => attempt(async () => {
    const text = $('kObAi').value;
    grab();
    const { fields: x } = await api('/api/me/parse', { method: 'POST', body: JSON.stringify({ text }) });
    let n = 0;
    const put = (k, v) => { if (v !== undefined && v !== null && v !== '') { d[k] = String(v); n++; } };
    if (x.height_cm) {
      if (metric) put('height_cm', Math.round(x.height_cm));
      else { const inch = x.height_cm / 2.54; d.ft = String(Math.floor(inch / 12)); d.in = String(Math.round(inch % 12)); n++; }
    }
    if (x.weight_kg) put('weight', metric ? Math.round(x.weight_kg) : Math.round(x.weight_kg / 0.4536));
    for (const k of ['birth_year', 'sex', 'experience', 'weekly_miles', 'longest_run_mi', 'days_per_week', 'resting_hr', 'max_hr', 'watch', 'injuries', 'goal', 'goal_event', 'goal_time', 'goal_date']) put(k, x[k]);
    for (const [ev, t] of Object.entries(x.prs || {})) put('pr' + ev, t);
    if (!n) { toast('I couldn’t find anything to fill in. Add a few details and try again.', true); return; }
    toast(`Filled in ${n} ${n === 1 ? 'field' : 'fields'}. Check each step, then finish.`);
    renderOnboarding(step, d);
  }, e.currentTarget);
  if ($('kObBack')) $('kObBack').onclick = () => { grab(); renderOnboarding(step - 1, d); };
  $('kOb').onsubmit = (e) => {
    e.preventDefault();
    if (!e.target.checkValidity()) { e.target.reportValidity(); return; }
    grab();
    if (!last) { renderOnboarding(step + 1, d); return; }
    if (!d.age) { toast('Please confirm your age to continue.', true); return; }
    const n = (v) => (v === '' || v == null ? undefined : Number(v));
    const height_cm = metric ? n(d.height_cm) : (d.ft || d.in) ? Math.round((Number(d.ft || 0) * 12 + Number(d.in || 0)) * 2.54) : undefined;
    const weight_kg = d.weight ? (metric ? Number(d.weight) : Math.round(Number(d.weight) * 0.4536 * 10) / 10) : undefined;
    const prs = {};
    for (const ev of ['800', '1600', '3200', '5K']) if (d['pr' + ev]) prs[ev] = { time: d['pr' + ev].trim() };
    attempt(async () => {
      K.me = await api('/api/me', { method: 'PUT', body: JSON.stringify({
        name: d.name, sex: d.sex || '', class_year: d.class_year || '', weekly_miles: n(d.weekly_miles), age_ok: true,
        profile: { height_cm, weight_kg, birth_year: n(d.birth_year), units: d.units, experience: d.experience, longest_run_mi: n(d.longest_run_mi),
          days_per_week: n(d.days_per_week), goal: d.goal, goal_event: d.goal_event, goal_time: d.goal_time, goal_date: d.goal_date,
          injuries: d.injuries, resting_hr: n(d.resting_hr), max_hr: n(d.max_hr), watch: d.watch },
        prs,
      }) });
      K.ob = null;
      await finishSetup();
    }, e.submitter);
  };
}

function renderTeamStart(back = false) {
  gate(html`<div class="k-start">
    ${back ? html`<button class="k-link" type="button" id="kBack">← Back to Kestrel</button>` : ''}
    <div class="k-kicker">Teams</div>
    <h1 class="k-title">Your team</h1>
    <p class="k-lede">Kestrel works around a team calendar. Start one for your school, or join yours with the code a teammate sends you.</p>
    <div class="k-two">
      <section class="k-panel"><h2>Start a team</h2><p class="k-small">You'll get an invite code to share. As the owner you manage the calendar and the team's training plan; you never see anyone's training.</p>
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
  start();
}

// Shows the app, starting it the first time and reloading it on a team switch.
async function start() {
  openApp();
  renderHeader();
  if (!K.started) {
    K.started = true;
    await window.hawksInit();
  } else {
    await window.hawksReload();
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
    await window.hawksReload();
  };
  $('kAddTeam').onclick = () => renderTeamStart(true);
  const w = $('kWho');
  const u = K.me.user;
  w.innerHTML = html`<span class="k-avatar" style="background:${u.color}">${(u.name || 'You').trim().slice(0, 1).toUpperCase()}</span><span class="k-who-name">${u.name || 'You'}</span>`.s;
  w.setAttribute('aria-label', `${u.name || 'You'}: profile`);
  w.onclick = () => window.hawksSetPage('you', 'profile');
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
  const link = `${location.origin}/join/${team.invite_code}`;
  if ($('teamTitle')) $('teamTitle').textContent = team.name;
  el.innerHTML = html`
    ${team.school ? html`<div class="k-small">${team.school}</div>` : ''}
    <div class="k-invite"><span class="k-code">${team.invite_code}</span>
      <button class="k-btn small" type="button" id="kCopyInvite">Copy invite link</button>
      ${owner ? html`<button class="k-link" type="button" id="kNewCode">New code</button>` : ''}</div>
    <p class="k-small">Anyone with the code can join, so share it only with your team.</p>
    <div class="k-members">${team.members.map((m) => html`<div class="k-member"><span class="dot" style="background:${m.color}"></span><span class="grow">${m.name || 'Unnamed'}${m.id === K.me.user.id ? ' (you)' : ''}</span>
      ${m.role === 'owner' ? html`<span class="badge">owner</span>` : ''}
      ${owner && m.id !== K.me.user.id ? html`<button class="k-link danger" type="button" data-remove="${m.id}">Remove</button>` : ''}</div>`)}</div>
    <div class="k-row">
      ${owner ? html`<button class="k-btn small" type="button" id="kAdmin">Manage calendar</button><button class="k-btn small" type="button" id="kPlanEdit">Team plan${team.has_plan ? ' (custom)' : ''}</button><button class="k-btn small" type="button" id="kRename">Rename</button>` : ''}
      <button class="k-link danger" type="button" id="kLeave">Leave team</button>
    </div>`.s;
  $('kCopyInvite').onclick = async () => { try { await navigator.clipboard.writeText(link); toast('Invite link copied.'); } catch { prompt('Copy this invite link:', link); } };
  if ($('kNewCode')) $('kNewCode').onclick = (e) => attempt(async () => { if (!confirm('Make a new invite code? The old code and link stop working.')) return; await api(`/api/teams/${K.teamId}/code`, { method: 'POST' }); window.kestrelRenderTeamCard(el); }, e.currentTarget);
  if ($('kAdmin')) $('kAdmin').onclick = () => window.openTeamAdmin();
  if ($('kPlanEdit')) $('kPlanEdit').onclick = () => openPlanEditor();
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
    await refreshMe(); renderHeader(); await window.hawksReload();
  }, e.currentTarget);
};

// The team's training plan (owner): Kestrel's built-in levels as a starting point, edited as JSON.
function openPlanEditor() {
  const d = dialog();
  attempt(async () => {
    const r = await api(`/api/teams/${K.teamId}/plan`);
    d.innerHTML = html`<h2>Team training plan</h2>
      <p class="k-small">Six levels by weekly miles; each athlete's AI coach starts them on the level that fits and moves them up when they're ready. Each level has three weeks (no race, race week, taper), seven days with a type, miles, shoes and notes, and a menu of workouts. ${r.custom ? 'This team uses its own plan.' : "This team uses Kestrel's built-in plan."}</p>
      <textarea class="k-input mono" id="kPlanJson" rows="18" spellcheck="false">${JSON.stringify(r.plans, null, 1)}</textarea>
      <div class="k-row"><button class="k-btn primary" type="button" id="kPlanSave">Save team plan</button>${r.custom ? html`<button class="k-btn" type="button" id="kPlanReset">Use Kestrel's plan</button>` : ''}<button class="k-link" type="button" id="kPlanClose">Close</button></div>`.s;
    d.showModal();
    $('kPlanClose').onclick = () => d.close();
    $('kPlanSave').onclick = (e) => attempt(async () => {
      let plans;
      try { plans = JSON.parse($('kPlanJson').value); } catch { throw new Error('That is not valid JSON.'); }
      await api(`/api/teams/${K.teamId}/plan`, { method: 'PUT', body: JSON.stringify({ plans }) });
      d.close(); toast('Team plan saved. Everyone on the team trains from it now.');
      await window.hawksReload();
    }, e.currentTarget);
    if ($('kPlanReset')) $('kPlanReset').onclick = (e) => attempt(async () => { await api(`/api/teams/${K.teamId}/plan`, { method: 'DELETE' }); d.close(); await window.hawksReload(); }, e.currentTarget);
  });
}

function dialog() {
  let d = $('kDialog');
  if (!d) { d = document.createElement('dialog'); d.id = 'kDialog'; d.className = 'k-dialog'; document.body.appendChild(d); }
  d.innerHTML = '';
  return d;
}

// ---------- You > Settings: Kestrel AI, race models, account

window.kestrelRenderSettings = async () => {
  const ai = $('kAiBody');
  if (ai) {
    ai.innerHTML = html`<p class="k-small">Kestrel is the coach. It works out of the box on a free model. To use your own key, or a model on your own computer, set it up in Kestrel Lab.</p>
      <div class="k-row spread"><span>Powered by <b>${AI.describe(K.ai)}</b></span><a class="k-btn small" href="/lab#/providers">Customise in Lab</a></div>`.s;
  }
  const mb = $('kModelsBody');
  if (mb) {
    const labels = { race: 'Race times (800 m and up)', short: 'Sprints and steeple', marathon: 'Marathon' };
    const lists = await attempt(() => Promise.all(Object.keys(labels).map((t) => api(`/api/models?task=${t}`))));
    if (!lists) return;
    const nameOf = (t, i) => { const m = lists[i].models.find((x) => x.id === K.me.models[t]); return m ? `${m.name} ${m.version}${m.builtin ? '' : ` · by ${m.owner}`}` : 'Kestrel default'; };
    mb.innerHTML = html`<p class="k-small">Every prediction in Fitness comes from an open model. Kestrel picks a good one for each. To compare models on your own results, switch, fork or publish one, open Kestrel Lab.</p>
      ${Object.keys(labels).map((t, i) => html`<div class="k-row spread"><div><div class="k-small" style="margin:0">${labels[t]}</div><b>${nameOf(t, i)}</b></div><a class="k-btn small" href="/lab#/m/${encodeURIComponent(K.me.models[t])}">Open in Lab</a></div>`)}
      <div class="k-row"><a class="k-btn small primary" href="/lab#/workbench">Test models on my PRs</a><a class="k-btn small" href="/lab#/models">Browse models</a></div>`.s;
  }
  const acct = $('kAccountBody');
  if (acct) {
    acct.innerHTML = html`<p class="k-small">Signed in as ${K.me.user.email}</p>
      <div class="k-row"><button class="k-btn small" type="button" id="kSignOut">Sign out</button><button class="k-link danger" type="button" id="kDelete">Delete my Kestrel data</button></div>
      <p class="k-small">Kestrel is open source (MIT). <a href="${REPO_URL}" target="_blank" rel="noopener">Source code</a> · <a href="/lab">Kestrel Lab</a></p>`.s;
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

window.kestrelRenderPower = (el) => {
  if (!el) return;
  el.innerHTML = html`<span>Powered by <b>${AI.describe(K.ai)}</b></span> <a class="k-link" href="/lab#/providers">Customise in Lab</a>`.s;
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
    if (K.ai.provider === 'kestrel') return await api('/api/coach/ask', { method: 'POST', body: JSON.stringify({ history: turns }) });
    const chat = await api('/api/coach/prompt', { method: 'POST', body: JSON.stringify({ history: turns }) });
    const system = `${chat.system}\n\nReply with ONLY a JSON object (no prose around it) matching this JSON Schema. "answer" is what the athlete reads; fill the other fields only when the rules above say to.\n${JSON.stringify(chat.schema)}`;
    const text = await AI.complete(K.ai, system, [{ role: 'user', content: chat.prompt }], { apiFetch: api });
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
  const fromLink = params.has('code');
  K.sb = createClient(K.cfg.supabaseUrl, K.cfg.supabaseKey, { auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true } });
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
  else renderLanding('signin', fromLink ? 'Your email is confirmed. Sign in to continue.' : '');
}

boot().catch((err) => { console.error(err); gate(html`<p class="k-small">Kestrel could not start: ${err.message}</p>`); });
