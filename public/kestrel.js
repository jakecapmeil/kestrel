// Kestrel around the Kessler app: sign-in (Supabase), onboarding, teams (switch, start, join, manage), which model
// powers Kestrel AI, and which Kestrel Lab models make race predictions. The app itself (index.html's main script)
// starts through window.kesslerInit once someone is signed in; every API call it makes carries the sign-in and the
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
      ${signup ? html`<p class="k-small">We'll email you a link to confirm your address before you can sign in. By creating an account you agree to the <a href="/legal#terms" target="_blank" rel="noopener">Terms</a> and <a href="/legal#privacy" target="_blank" rel="noopener">Privacy Policy</a>. You must be 13 or older.</p>` : ''}
      ${message ? html`<p class="k-small k-good">${message}</p>` : ''}
      <button class="k-btn primary wide" type="submit">${signup ? 'Create account' : 'Sign in'}</button>
    </form>
    <div class="k-row spread">
      <button class="k-link" type="button" id="kSwap">${signup ? 'Have an account? Sign in' : 'New here? Create an account'}</button>
      ${signup ? '' : html`<button class="k-link" type="button" id="kForgot">Forgot password?</button>`}
    </div>
    <p class="k-small">Kestrel is open source: <a href="${REPO_URL}" target="_blank" rel="noopener">read the code</a>. <a href="/legal" target="_blank" rel="noopener">Terms, privacy and safety</a>. Building running models? <a href="/lab">Kestrel Lab</a>.</p>
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
      <label class="k-check"><input type="checkbox" name="age" ${d.age ? 'checked' : ''} required><span>I am 13 or older. If I'm under 18, a parent or guardian knows I'm using Kestrel. I agree to the <a href="/legal#terms" target="_blank" rel="noopener">Terms</a> and <a href="/legal#privacy" target="_blank" rel="noopener">Privacy Policy</a>, and I understand Kestrel is not medical advice.</span></label>
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
  openPlanBuilder({ team: false, current: null, onSaved: () => window.kesslerReload() });
}

// Shows the app, starting it the first time and reloading it on a team switch.
async function start() {
  openApp();
  renderHeader();
  if (!K.started) {
    K.started = true;
    await window.kesslerInit();
  } else {
    await window.kesslerReload();
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
    await window.kesslerReload();
  };
  $('kAddTeam').onclick = () => renderTeamStart(true);
  const w = $('kWho');
  const u = K.me.user;
  w.innerHTML = html`<span class="k-avatar" style="background:${u.color}">${(u.name || 'You').trim().slice(0, 1).toUpperCase()}</span><span class="k-who-name">${u.name || 'You'}</span>`.s;
  w.setAttribute('aria-label', `${u.name || 'You'}: profile`);
  w.onclick = () => window.kesslerSetPage('you', 'profile');
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
      ${lead ? html`<button class="k-btn small" type="button" id="kAdmin">Manage calendar</button><button class="k-btn small" type="button" id="kPlanEdit">Training plan${team.has_plan ? ' (custom)' : ''}</button>` : ''}${owner ? html`<button class="k-btn small" type="button" id="kRename">Rename</button>` : ''}
      <button class="k-link danger" type="button" id="kLeave">Leave team</button>
    </div>`.s;
  $('kCopyInvite').onclick = async () => { try { await navigator.clipboard.writeText(link); toast('Invite link copied.'); } catch { prompt('Copy this invite link:', link); } };
  if ($('kNewCode')) $('kNewCode').onclick = (e) => attempt(async () => { if (!confirm('Make a new invite code? The old code and link stop working.')) return; await api(`/api/teams/${K.teamId}/code`, { method: 'POST' }); window.kestrelRenderTeamCard(el); }, e.currentTarget);
  if ($('kAdmin')) $('kAdmin').onclick = () => window.openTeamAdmin();
  if ($('kPlanEdit')) $('kPlanEdit').onclick = () => window.kesslerSetPage('team', 'training');
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
    await refreshMe(); renderHeader(); await window.kesslerReload();
  }, e.currentTarget);
};

// ---------- Team tab: roster

const isLead = () => K.role === 'owner' || K.role === 'captain';

window.kestrelRenderRoster = async (el) => {
  if (!el || !K.teamId) return;
  const [r, mi] = await Promise.all([
    attempt(() => api(`/api/teams/${K.teamId}/roster`)),
    api('/api/team').catch(() => null),
  ]);
  if (!r) return;
  const miles = new Map((mi?.athletes || []).map((a) => [a.id, a]));
  const me = K.me.user.id;
  const lead = r.role === 'owner' || r.role === 'captain';
  const owner = r.role === 'owner';
  el.innerHTML = html`<section class="card">
      <div class="section-head"><div>
        <div class="card-title">Roster</div>
        <div class="hint">${r.members.length} on the team. Everyone sees name, number, grade and events. ${lead ? 'Age is shown only to you and the person.' : 'Your age is shown only to you, the owner and captains.'}</div>
      </div></div>
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
      ${r.members.length < 2 ? html`<p class="k-small">Invite teammates with the code on the Miles tab.</p>` : ''}
    </section>`.s;
  el.querySelectorAll('[data-edit]').forEach((b) => {
    b.onclick = () => editRosterEntry(r.members.find((m) => m.id === b.dataset.edit), { lead, owner }, () => window.kestrelRenderRoster(el));
  });
};

function editRosterEntry(m, perms, done) {
  const d = dialog();
  const self = m.id === K.me.user.id;
  d.innerHTML = html`<h2>${self ? 'Your roster details' : m.name}</h2>
    <form id="kRosterForm">
      <div><label class="k-label" for="kRJersey">Jersey number</label><input class="k-input" id="kRJersey" name="jersey" maxlength="6" value="${m.jersey}" inputmode="numeric"></div>
      <div><label class="k-label" for="kRAge">Age</label><input class="k-input" id="kRAge" name="age" type="number" min="8" max="99" value="${m.age ?? ''}"><p class="k-small">Optional. Only you, the owner and captains see it.</p></div>
      <div><label class="k-label" for="kREvents">Events</label><input class="k-input" id="kREvents" name="events" maxlength="80" value="${m.events}" placeholder="e.g. 800, 1600, 4x400"></div>
      ${perms.owner && m.role !== 'owner' ? html`<label class="k-check"><input type="checkbox" name="leader" ${m.role === 'captain' ? 'checked' : ''}><span>Team captain. Captains can edit the roster, manage the calendar and build the team training plan.</span></label>` : ''}
      <div class="k-row"><button class="k-btn primary" type="submit">Save</button><button class="k-link" type="button" id="kRClose">Cancel</button></div>
    </form>`.s;
  d.showModal();
  $('kRClose').onclick = () => d.close();
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

window.kestrelRenderTeamTraining = async (el) => {
  if (!el || !K.teamId) return;
  const r = await attempt(() => api(`/api/teams/${K.teamId}/plan`));
  if (!r) return;
  const lead = isLead();
  el.innerHTML = html`<section class="card">
      <div class="section-head"><div>
        <div class="card-title">Team training plan</div>
        <div class="hint">${r.custom ? (r.spec?.name || 'Custom plan') : 'No team plan yet.'}</div>
      </div></div>
      ${r.custom
        ? html`<p class="k-small">${r.spec?.summary || 'Your captains built this plan.'}</p><p class="k-small">Every athlete trains from the level that fits their current mileage and fitness, and their own Kestrel AI coach adapts it day to day. Athletes who built a personal plan keep using theirs.</p>`
        : html`<p class="k-small">Nothing is preloaded. ${lead ? 'Talk it through with Kestrel AI: tell it your season, how many days you run, workout days and race days, or attach the plan you use now (PDF, Word, Excel, CSV). Refine it until it is right. It scales to every runner on the roster.' : 'Your captain or coach can build one. Until then you can build your own in Train → Plan.'}</p>`}
      ${lead ? html`<div class="k-row"><button class="k-btn primary" type="button" id="kPlanBuild">${r.custom ? 'Refine with Kestrel AI' : 'Build with Kestrel AI'}</button>${r.custom ? html`<button class="k-btn" type="button" id="kPlanJsonBtn">Edit as JSON</button><button class="k-link danger" type="button" id="kPlanReset">Remove team plan</button>` : ''}</div>` : ''}
      ${r.custom && r.spec ? planTable(r.spec) : ''}
      <p class="k-small">Plans are general guidance, not medical advice, and are not checked by Kestrel for any one runner.</p>
    </section>`.s;
  if ($('kPlanBuild')) $('kPlanBuild').onclick = () => openPlanBuilder({ team: true, current: r.spec, onSaved: () => window.kestrelRenderTeamTraining(el) });
  if ($('kPlanJsonBtn')) $('kPlanJsonBtn').onclick = () => openPlanJson(r, () => window.kestrelRenderTeamTraining(el));
  if ($('kPlanReset')) $('kPlanReset').onclick = (e) => attempt(async () => {
    if (!confirm('Remove the team plan? Everyone on the team goes back to having no plan until they build their own.')) return;
    await api(`/api/teams/${K.teamId}/plan`, { method: 'DELETE' });
    await window.kesslerReload();
    window.kestrelRenderTeamTraining(el);
  }, e.currentTarget);
};

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

// The old editor, for leaders who want to write every cell by hand.
function openPlanJson(r, done) {
  const d = dialog();
  d.innerHTML = html`<h2>Edit plan as JSON</h2>
    <p class="k-small">Nine levels by weekly miles. Each level has three weeks (no race, race week, taper), seven days with a type, miles, shoes and notes, and a menu of workouts. Saving this replaces what the AI built.</p>
    <textarea class="k-input mono" id="kPlanJson" rows="18" spellcheck="false">${JSON.stringify(r.plans, null, 1)}</textarea>
    <div class="k-row"><button class="k-btn primary" type="button" id="kPlanSave">Save</button><button class="k-link" type="button" id="kPlanClose">Close</button></div>`.s;
  d.showModal();
  $('kPlanClose').onclick = () => d.close();
  $('kPlanSave').onclick = (e) => attempt(async () => {
    let plans;
    try { plans = JSON.parse($('kPlanJson').value); } catch { throw new Error('That is not valid JSON.'); }
    await api(`/api/teams/${K.teamId}/plan`, { method: 'PUT', body: JSON.stringify({ plans }) });
    d.close(); toast('Team plan saved.');
    await window.kesslerReload(); done();
  }, e.currentTarget);
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

function openPlanBuilder({ team, current, onSaved }) {
  const base = team ? `/api/teams/${K.teamId}/plan` : '/api/me/plan';
  const st = { turns: [], plan: current || null, preview: null, busy: false, docs: [], week: 'normal' };
  const d = dialog();
  d.classList.add('k-wide');
  d.innerHTML = html`<h2>${team ? 'Build the team training plan' : 'Build your training plan'}</h2>
    <p class="k-small">${team ? 'Describe the season and refine it with Kestrel AI. The plan scales to every runner on the roster, so each athlete lands on the level that fits their fitness.' : 'Describe your goals and your week. Kestrel AI drafts a plan, you refine it, and your coach adapts it to how you feel.'} Powered by ${AI.describe(K.ai)}. <a href="/lab#/providers" target="_blank" rel="noopener">Change</a></p>
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
    await api(base, { method: 'PUT', body: JSON.stringify({ plan: st.plan }) });
    d.close();
    toast(team ? 'Team plan saved. Everyone trains from it now.' : 'Plan saved. Your coach uses it from today.');
    await window.kesslerReload();
    if (onSaved) onSaved();
  }, e.currentTarget);
}

// -> { answer, plan?, preview? }. Free Kestrel AI answers on the server; any other model is called from the browser.
async function planAsk(base, turns, current, documents = []) {
  const history = turns.map((t) => ({ role: t.role === 'user' ? 'user' : 'kai', text: t.text }));
  if (K.ai.provider === 'kestrel') return await api(`${base}/chat`, { method: 'POST', body: JSON.stringify({ history, current, documents }) });
  const chat = await api(`${base}/prompt`, { method: 'POST', body: JSON.stringify({ history, current, documents }) });
  const system = `${chat.system}\n\nReply with ONLY a JSON object (no prose around it) matching this JSON Schema. "answer" is what the person reads; include "plan" only when you are giving or changing the plan.\n${JSON.stringify(chat.schema)}`;
  const text = await AI.complete(K.ai, system, [{ role: 'user', content: chat.prompt }], { apiFetch: api });
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
    await window.kesslerReload();
    window.kestrelRenderPersonalPlan(el);
  }, e.currentTarget);
};

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
    ai.innerHTML = html`<p class="k-small">Kestrel is the coach. It works out of the box on a free model. To use your own key, or a model on your own computer, set it up in Kestrel Lab. Your key stays in this browser.</p>
      <div class="k-row spread"><span>Powered by <b>${AI.describe(K.ai)}</b></span><a class="k-btn small" href="/lab#/providers">Customise in Lab</a></div>
      <p class="k-small">AI can be wrong. It is not a doctor or a certified coach.</p>`.s;
  }
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
        <li>Your training log, health, body map, predictions and GPS routes are only yours and your AI coach's.</li>
        <li>Team owners and captains can edit the roster and plan, but cannot see your training or health.</li>
      </ul>
      <label class="k-check"><input type="checkbox" id="kShareMiles" ${shared ? 'checked' : ''}><span>Show my weekly miles on my teams' mileage boards</span></label>`.s;
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
