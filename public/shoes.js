// Shoes (You > Records): each pair, the kinds of run it is for, and its miles. Kestrel credits every run to one pair:
// the one picked on the run, else the pair for that kind of run (easy, long, workout, race, warm-up/cool-down), else a
// pair set for "any run". Also the shoe picker on a session (window.kShoes.pickerHtml / wirePicker, used by dayview.js).
// Runs after records.js, whose render() it follows. Uses $, escapeHtml from the main script.
(function(){
  const esc = (s)=> escapeHtml(String(s ?? ''));
  let shoes = [], unassigned = null;
  const LABEL = { ok:'', soon:'Nearly done', replace:'Time to replace', retired:'Retired' };
  const USES = [['easy','Easy & recovery'], ['long','Long runs'], ['workout','Workouts'], ['race','Races'], ['warmup','Warm-up, cool-down, shakeouts']];
  const USE_SHORT = { easy:'Easy', long:'Long', workout:'Workouts', race:'Races', warmup:'WU/CD' };
  const today = ()=>{ const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

  async function call(method, path, body){
    const res = await fetch(path, { method, headers:{ 'Content-Type':'application/json' }, body: body ? JSON.stringify(body) : undefined, cache:'no-store' });
    const data = await res.json().catch(()=> ({}));
    if(!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }
  const plain = (s)=> ({ id:s.id, name:s.name, since:s.since, start_mi:s.start_mi, limit_mi:s.limit_mi, retired:s.retired, uses:s.uses || [] });
  async function save(list){
    try{ const d = await call('PUT', '/api/shoes', { shoes:list }); shoes = d.shoes; unassigned = d.unassigned; draw(); return true; }
    catch(e){ alert(e.message); return false; }
  }

  function draw(){
    const el = $('shoeList');
    if(!el) return;
    const active = shoes.filter((s)=> !s.retired), old = shoes.filter((s)=> s.retired);
    const row = (s)=>{
      const pct = Math.min(100, Math.round(s.miles / s.limit_mi * 100));
      const uses = s.uses?.length ? s.uses.map((u)=> USE_SHORT[u]).join(' · ') : 'Any run';
      return `<div class="list-row shoe-row" data-id="${esc(s.id)}">
        <div style="flex:1;min-width:0;">
          <div class="list-title">${esc(s.name)} ${LABEL[s.status] ? `<span class="badge ${s.status === 'replace' ? 'bad' : ''}">${LABEL[s.status]}</span>` : ''}</div>
          <div class="hint">${s.miles} of ${s.limit_mi} mi${s.status === 'retired' ? '' : ` · ${s.left} left`} · ${s.runs || 0} run${s.runs === 1 ? '' : 's'}${s.since ? ` · since ${esc(s.since)}` : ''}</div>
          <div class="hint">For: ${esc(uses)}</div>
          <div class="import-bar show"><i style="width:${pct}%;${s.status === 'replace' ? 'background:var(--pain,#c0392b)' : ''}"></i></div>
        </div>
        <button type="button" class="ghost" data-edit>Edit</button>
      </div>`;
    };
    // Kinds of run no active pair covers, so the runner knows where miles go uncounted.
    const covered = new Set(active.flatMap((s)=> s.uses?.length ? s.uses : USES.map(([k])=> k)));
    const gaps = active.length ? USES.filter(([k])=> !covered.has(k)).map(([, l])=> l.toLowerCase()) : [];
    // Two pairs for the same kind of run: the first listed gets those runs unless one is picked on the run.
    const shared = USES.map(([k, l])=> [l, active.filter((s)=> s.uses?.includes(k))]).filter(([, p])=> p.length > 1);
    el.innerHTML = shoes.length ? `${active.map(row).join('')}
      ${shared.map(([l, p])=> `<div class="hint" style="margin-top:8px;">${esc(p.map((s)=> s.name).join(' and '))} are both for ${esc(l.toLowerCase())}. Those runs count toward ${esc(p[0].name)} unless you pick the other pair on the run.</div>`).join('')}
      ${gaps.length ? `<div class="hint" style="margin-top:8px;">No pair is set for ${esc(gaps.join(', '))}. Those runs aren’t counted unless you pick shoes on the run.</div>` : ''}
      ${unassigned?.runs ? `<div class="hint" style="margin-top:4px;">${unassigned.miles} mi from ${unassigned.runs} run${unassigned.runs === 1 ? '' : 's'} in the last 60 days aren’t on any pair.</div>` : ''}
      ${old.length ? `<details style="margin-top:8px;"><summary class="hint">Retired (${old.length})</summary>${old.map(row).join('')}</details>` : ''}`
      : '<div class="hint">No shoes yet. Add a pair, say which runs it’s for (easy days, workouts, races…), and Kestrel counts its miles from your runs.</div>';
    el.querySelectorAll('.shoe-row').forEach((r)=>{ r.querySelector('[data-edit]').onclick = ()=> edit(shoes.find((s)=> s.id === r.dataset.id)); });
  }

  async function load(){
    try{ const d = await call('GET', '/api/shoes'); shoes = d.shoes; unassigned = d.unassigned; draw(); }
    catch(e){ const el = $('shoeList'); if(el) el.innerHTML = '<div class="hint">Couldn’t load your shoes.</div>'; }
  }

  // ------------------------------------------------------------ the add / edit form
  function modal(title, html){
    let o = $('shoeModal');
    if(!o){
      o = document.createElement('div');
      o.className = 'modal-overlay'; o.id = 'shoeModal';
      o.innerHTML = `<div class="modal-box" role="dialog" aria-modal="true" aria-labelledby="shoeModalTitle"><div class="modal-head"><h3 id="shoeModalTitle"></h3><button class="ghost" type="button" id="shoeModalClose" aria-label="Close">✕</button></div><div class="modal-list stack" id="shoeModalBody"></div></div>`;
      document.body.appendChild(o);
      o.addEventListener('click', (e)=>{ if(e.target === o) close(); });
      $('shoeModalClose').onclick = close;
    }
    $('shoeModalTitle').textContent = title;
    $('shoeModalBody').innerHTML = html;
    o.classList.add('show');
    return $('shoeModalBody');
  }
  const close = ()=> $('shoeModal')?.classList.remove('show');

  function edit(s){
    // A new pair takes the kinds of run no other active pair covers yet.
    const taken = new Set(shoes.filter((x)=> !x.retired && x.uses?.length).flatMap((x)=> x.uses));
    const x = s ? { ...s } : { name:'', since: today(), start_mi: 0, limit_mi: 400, uses: USES.map(([k])=> k).filter((k)=> !taken.has(k)) };
    const box = modal(s ? 'Edit shoes' : 'Add shoes', `<form id="shoeForm" class="stack">
        <label class="field"><span>Shoes</span><input name="name" maxlength="60" required value="${esc(x.name)}" placeholder="e.g. Nike Pegasus 41"></label>
        <fieldset class="field" style="border:0;padding:0;margin:0;"><span>Used for</span>
          ${USES.map(([k, l])=> `<label class="check-row"><input type="checkbox" name="uses" value="${k}" ${x.uses?.includes(k) ? 'checked' : ''}><span>${l}</span></label>`).join('')}
          <span class="hint">Runs of these kinds count toward this pair automatically. Leave all unticked to count any run no other pair covers. You can change the shoes on any single run.</span>
        </fieldset>
        <div class="field-grid">
          <label class="field"><span>Started using</span><input name="since" type="date" value="${esc(x.since || '')}"></label>
          <label class="field"><span>Miles already on them</span><input name="start_mi" type="number" min="0" max="3000" step="0.1" value="${esc(x.start_mi || 0)}"></label>
        </div>
        <label class="field"><span>Replace after (miles)</span><input name="limit_mi" type="number" min="50" max="1500" value="${esc(x.limit_mi || 400)}"></label>
        <div class="cluster"><button type="submit">${s ? 'Save' : 'Add shoes'}</button>
          ${s ? `${s.retired ? '<button type="button" class="ghost" data-unretire>Bring back</button>' : '<button type="button" class="ghost" data-retire>Retire</button>'}<button type="button" class="ghost" data-del>Delete</button>` : ''}</div>
      </form>`);
    const others = ()=> shoes.filter((o)=> o.id !== s?.id).map(plain);
    box.querySelector('#shoeForm').onsubmit = async (e)=>{
      e.preventDefault();
      const f = new FormData(e.target);
      const next = { ...(s ? plain(s) : {}), name: f.get('name'), since: f.get('since'), start_mi: Number(f.get('start_mi')) || 0, limit_mi: Number(f.get('limit_mi')) || 400, uses: f.getAll('uses') };
      const list = s ? shoes.map((o)=> o.id === s.id ? next : plain(o)) : [...shoes.map(plain), next];
      if(await save(list)) close();
    };
    const del = box.querySelector('[data-del]');
    if(del) del.onclick = async ()=>{ if(confirm(`Delete ${s.name}? Its miles are no longer counted.`) && await save(others())) close(); };
    const ret = box.querySelector('[data-retire]');
    if(ret) ret.onclick = async ()=>{ if(await save(shoes.map((o)=> o.id === s.id ? { ...plain(o), retired: today() } : plain(o)))) close(); };
    const back = box.querySelector('[data-unretire]');
    if(back) back.onclick = async ()=>{ if(await save(shoes.map((o)=> o.id === s.id ? { ...plain(o), retired: '' } : plain(o)))) close(); };
  }

  // ------------------------------------------------------------ the picker on a session (dayview.js)
  // acts: [{ id, label }] the session's running activities. Draws into el once the assignments load.
  async function picker(el, acts){
    if(!el || !acts.length) return;
    let d;
    try{ d = await call('GET', '/api/shoes/runs?ids=' + encodeURIComponent(acts.map((a)=> a.id).join(','))); }catch(e){ return; }
    if(!el.isConnected) return;
    if(!d.shoes.length){ el.innerHTML = `<div class="kd-eb">Shoes</div><p class="kv-hint">Add your shoes in You → Records and Kestrel counts their miles from your runs.</p>`; el.hidden = false; return; }
    const opts = (r)=> `<option value="auto">${r?.auto && r.shoe_id ? `Auto: ${esc(d.shoes.find((s)=> s.id === r.shoe_id)?.name || '')}` : 'Auto' + (r?.auto ? ' (none set)' : '')}</option>
      ${d.shoes.filter((s)=> !s.retired || s.id === r?.shoe_id).map((s)=> `<option value="${esc(s.id)}" ${r && !r.auto && r.shoe_id === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
      <option value="" ${r && !r.auto && !r.shoe_id ? 'selected' : ''}>No shoes (don’t count)</option>`;
    el.innerHTML = `<div class="kd-eb">Shoes</div>${acts.map((a)=> `<label class="field" style="margin-top:6px;"><span>${esc(a.label)}</span><select data-run="${esc(a.id)}">${opts(d.runs[a.id])}</select></label>`).join('')}`;
    el.hidden = false;
    el.querySelectorAll('select[data-run]').forEach((sel)=>{ sel.onchange = async ()=>{
      sel.disabled = true;
      try{ await call('PUT', '/api/shoes/run', { workout_id: sel.dataset.run, shoe_id: sel.value === 'auto' ? null : sel.value }); picker(el, acts); load(); }
      catch(e){ alert(e.message); sel.disabled = false; }
    }; });
  }

  const btn = $('shoeAdd'); if(btn) btn.onclick = ()=> edit(null);
  const orig = window.kRecords && window.kRecords.render;
  if(orig) window.kRecords.render = async function(){ const r = await orig.apply(this, arguments); load(); return r; };
  window.kShoes = { load, picker };
})();
