// Kestrel's tools as modules: which ones a runner sees, and the menu where they choose (You → Settings → Customize Kestrel).
// The list itself (ids, groups, what each owns, the runner-type presets, the suggestion) lives on the server in
// src/train/modules.js and arrives with /api/me as window.KESTREL.me.modules; what the runner turned off is
// me.prefs.modules_off. Turning a tool off only hides it. Core screens (Today, Plan, the log, You) are never in the list.
//
// How the rest of the app uses this:
//   kMods.has('fuel')            a tool is on (always true for guests and before the list arrives)
//   kMods.route(tab, view)       where a request for tab/view should land if that screen is hidden (navGo, renderNav)
//   kMods.tabAllowed(tab)        whether a whole tab shows (Body and Team disappear when everything in them is off)
//   [data-mod="id"]              static markup hidden by apply() when that tool is off
//   kMods.need('coach')          a guard for anything that jumps to a hidden tool: offers to turn it back on
// Runs after the main script, which owns NAV, $, escapeHtml, isRealPerson, navGo and renderNav.
(function(){
  const esc = (s)=> escapeHtml(String(s ?? ''));
  const me = ()=> window.KESTREL?.me || null;
  const meta = ()=> me()?.modules || null;
  const real = ()=> typeof isRealPerson === 'function' && isRealPerson();
  const offNow = ()=> new Set(me()?.prefs?.modules_off || []);

  // ---------------------------------------------------------------- what is on
  let owners = null, ownersOf = null;
  function ownerMap(){
    const m = meta(); if(!m) return {};
    if(ownersOf !== m){ ownersOf = m; owners = {}; m.list.forEach(x=> x.views.forEach(v=> { owners[v] = x.id; })); }
    return owners;
  }
  const has = (id)=> !real() || !offNow().has(id);
  const segsOf = (tab)=> NAV[tab]?.segs || [];
  const keyOf = (tab, view)=> segsOf(tab).length ? `${tab}/${view}` : tab;
  // Core screens have no owner, so they are always allowed.
  const allowed = (tab, view)=>{ const o = ownerMap()[keyOf(tab, view)]; return !o || has(o); };
  const viewsOf = (tab)=> segsOf(tab).filter(([v])=> allowed(tab, v));
  const tabAllowed = (tab)=> segsOf(tab).length ? viewsOf(tab).length > 0 : allowed(tab);
  // A hidden screen sends you to the first one still on in its tab, or to Today when the whole tab is off.
  function route(tab, view){
    if(!tabAllowed(tab)) return ['today', undefined];
    if(segsOf(tab).length && !allowed(tab, view)) return [tab, viewsOf(tab)[0][0]];
    return [tab, view];
  }
  // Static markup with data-mod="id": the Record button, the Lab link, the team picker, the shoe list.
  function apply(){
    document.querySelectorAll('[data-mod]').forEach((el)=>{ el.hidden = !has(el.dataset.mod); });
  }

  // ---------------------------------------------------------------- saving
  async function put(patch){
    const res = await fetch('/api/me/prefs', { method:'PUT', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(patch) });
    const d = await res.json().catch(()=> ({}));
    if(!res.ok) throw new Error(d.error || 'That didn’t save. Try again.');
    if(me()){ me().prefs = d.prefs; if(d.modules) me().modules = d.modules; }
    window.kTrack?.reset?.();
    return d;
  }
  // Redraws whatever is on screen. A hidden screen redirects (renderNav), and Today, the nav and Settings all refresh.
  async function refresh(){
    apply();
    await window.kestrelReload?.();
    window.renderNav?.();
  }
  async function save(off, extra = {}){
    await put({ modules_off: off, modules_seen: true, ...extra });
    await refresh();
  }
  async function markSeen(){
    if(me()?.prefs?.modules_seen) return;
    try{ await put({ modules_seen: true }); }catch(e){ /* asked again next time */ }
  }

  // Anything that jumps to a hidden tool (an Ask Kestrel AI button, a stale link) calls this first.
  async function need(id){
    if(has(id)) return true;
    const m = meta()?.list.find((x)=> x.id === id);
    if(!confirm(`${m?.label || 'That tool'} is turned off. Turn it back on?`)) return false;
    try{ await save([...offNow()].filter((x)=> x !== id)); return true; }catch(e){ alert(e.message); return false; }
  }

  // ---------------------------------------------------------------- the menu
  let host = null, pending = null;
  function overlay(){
    if(host) return host;
    host = document.createElement('div');
    // modal-lock keeps the app's global Escape handler out: this menu settles its own promise (and marks the welcome seen) when it closes.
    host.className = 'modal-overlay modal-lock'; host.id = 'kmModal';
    host.innerHTML = `<div class="modal-box km-box" role="dialog" aria-modal="true" aria-labelledby="kmTitle">
      <div class="modal-head"><h3 id="kmTitle">Customize Kestrel</h3><button class="ghost" type="button" id="kmClose" aria-label="Close">✕</button></div>
      <div class="modal-list km-body" id="kmBody"></div>
      <div class="km-foot" id="kmFoot"></div></div>`;
    document.body.appendChild(host);
    return host;
  }

  // opts.welcome: the first look, right after setup. Starts from Kestrel's suggestion (nothing is hidden until they
  // confirm), and closing it without choosing keeps everything on. Resolves when the menu closes.
  function open(opts = {}){
    if(pending) return pending;
    const m = meta();
    if(!real() || !m){ alert('Sign in as yourself first, then you can choose your tools.'); return Promise.resolve(false); }
    const el = overlay();
    const welcome = !!opts.welcome;
    const suggested = m.presets.find((p)=> p.id === m.suggested);
    let off = new Set(welcome && suggested ? suggested.off : offNow());
    const same = (a, b)=> a.length === b.size && a.every((id)=> b.has(id));
    const current = ()=> m.presets.find((p)=> same(p.off, off))?.id || '';
    return pending = new Promise((done)=>{
      const close = (saved)=>{ el.classList.remove('show'); el.removeEventListener('click', backdrop); document.removeEventListener('keydown', esc_); pending = null; done(saved); };
      const backdrop = (e)=>{ if(e.target === el) dismiss(); };
      const esc_ = (e)=>{ if(e.key === 'Escape' && el.classList.contains('show')) dismiss(); };
      const dismiss = async ()=>{ if(welcome) await markSeen(); close(false); };

      const draw = ()=>{
        const now = current();
        const active = m.presets.find((p)=> p.id === now);
        // "Everything" is only the fallback when Kestrel can't tell, so it isn't offered as a suggestion.
        const hint = suggested && suggested.id !== 'everything' ? suggested : null;
        const body = $('kmBody'), keep = body.scrollTop;
        body.innerHTML = `<p class="hint km-intro">${welcome && suggested ? `From what you told Kestrel, <b>${esc(suggested.label)}</b> looks like you. Change anything you like.` : 'Show the tools you use and hide the rest.'} Hiding a tool only hides it: nothing is deleted, and your plan, team and what teammates see stay as they are.</p>
          <div class="chip-scroll km-presets" role="radiogroup" aria-label="Start from a kind of runner">${m.presets.map((p)=> `<button type="button" class="chip ${p.id === now ? 'on' : ''}" role="radio" aria-checked="${p.id === now}" data-preset="${esc(p.id)}">${esc(p.label)}</button>`).join('')}</div>
          <p class="hint km-who">${esc(active ? active.who : 'Your own mix of tools.')}${hint && hint.id !== now ? ` Suggested for you: <b>${esc(hint.label)}</b>.` : ''}</p>
          ${m.groups.map((g)=> `<section class="km-group"><h4>${esc(g.label)}</h4>${m.list.filter((x)=> x.group === g.key).map((x)=> `<label class="km-row">
            <span class="km-text"><b>${esc(x.label)}</b><small>${esc(x.blurb)}</small>${off.has(x.id) ? `<small class="km-hides">Hides: ${esc(x.off)}</small>` : ''}</span>
            <input type="checkbox" class="km-sw" role="switch" data-mod-id="${esc(x.id)}" ${off.has(x.id) ? '' : 'checked'} aria-label="${esc(x.label)}"></label>`).join('')}</section>`).join('')}
          <p class="hint km-core">Always on: ${m.core.map((c)=> esc(c.label)).join(', ')}.</p>`;
        body.scrollTop = keep;
        body.querySelectorAll('[data-preset]').forEach((b)=> b.onclick = ()=>{ off = new Set(m.presets.find((p)=> p.id === b.dataset.preset).off); draw(); });
        body.querySelectorAll('[data-mod-id]').forEach((c)=> c.onchange = ()=>{ if(c.checked) off.delete(c.dataset.modId); else off.add(c.dataset.modId); draw(); });
        $('kmFoot').innerHTML = `<span class="km-count">${m.list.length - off.size} of ${m.list.length} tools on</span>${welcome ? '<button type="button" class="ghost" id="kmAll">Show everything</button>' : '<button type="button" class="ghost" id="kmCancel">Cancel</button>'}<button type="button" id="kmSave">${welcome ? 'Looks good' : 'Save'}</button>`;
        if($('kmCancel')) $('kmCancel').onclick = dismiss;
        if($('kmAll')) $('kmAll').onclick = async (e)=>{ e.target.disabled = true; try{ await save([]); close(true); }catch(err){ alert(err.message); e.target.disabled = false; } };
        $('kmSave').onclick = async (e)=>{ e.target.disabled = true; try{ await save([...off]); close(true); }catch(err){ alert(err.message); e.target.disabled = false; } };
      };
      $('kmClose').onclick = dismiss;
      el.addEventListener('click', backdrop);
      document.addEventListener('keydown', esc_);
      draw();
      el.classList.add('show');
      $('kmBody').scrollTop = 0;
    });
  }

  // ---------------------------------------------------------------- where it shows up
  function summary(){
    const m = meta(); if(!m) return '';
    const off = offNow();
    if(!off.size) return `All ${m.list.length} tools are on.`;
    const p = m.presets.find((x)=> x.off.length === off.size && x.off.every((id)=> off.has(id)));
    return `${m.list.length - off.size} of ${m.list.length} tools are on${p ? ` (${p.label})` : ''}.`;
  }
  // You → Settings: the permanent home of the menu, and the way back to anything turned off.
  function settingsCard(el){
    if(!el) return;
    if(!real() || !meta()){ el.innerHTML = '<div class="card-title">Customize Kestrel</div><div class="hint">Sign in as yourself to choose your tools.</div>'; return; }
    el.innerHTML = `<div class="card-title">Customize Kestrel</div>
      <div class="hint">Pick the tools you use and hide the rest, by kind of runner or one at a time. ${esc(summary())}</div>
      <div class="km-actions"><button type="button" id="kmOpen">Choose your tools</button></div>`;
    $('kmOpen').onclick = ()=> open();
  }
  // Today: shown once to a runner who has never looked at the menu. "Not now" is remembered on the account.
  function nudgeHtml(){
    const m = meta();
    if(!real() || !m || me()?.prefs?.modules_seen) return '';
    const s = m.presets.find((p)=> p.id === m.suggested);
    return `<div class="card kv-card kv-nudge"><div class="kv-ct">Make Kestrel fit you</div>
      <div class="kv-hint">Kestrel has a lot of tools. Hide the ones you don’t use${s && s.id !== 'everything' ? `; “${esc(s.label)}” looks like a good start for you` : ''}.</div>
      <div class="kv-btns"><button type="button" data-a="kmOpen">Choose my tools</button><button type="button" data-a="kmLater">Not now</button></div></div>`;
  }

  window.kMods = { has, allowed, route, tabAllowed, viewsOf, apply, need, open, welcome: ()=> open({ welcome:true }), settingsCard, nudgeHtml, markSeen, summary };
})();
