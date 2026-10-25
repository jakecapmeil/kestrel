// Shoes (You > Records): mileage per pair, counted from your runs, with a nudge before a pair is done.
// Runs after records.js, whose render() it follows. Uses $, escapeHtml from the main script.
(function(){
  const esc = (s)=> escapeHtml(String(s ?? ''));
  let shoes = [];
  const LABEL = { ok:'', soon:'Nearly done', replace:'Time to replace', retired:'Retired' };

  async function call(method, body){
    const res = await fetch('/api/shoes', { method, headers:{ 'Content-Type':'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json();
    if(!res.ok) throw new Error(data.error || 'Request failed');
    return data.shoes;
  }
  const save = async (list)=> { try{ shoes = await call('PUT', { shoes:list }); draw(); }catch(e){ alert(e.message); } };
  const plain = (s)=> ({ id:s.id, name:s.name, since:s.since, start_mi:s.start_mi, limit_mi:s.limit_mi, retired:s.retired });

  function draw(){
    const el = $('shoeList');
    if(!el) return;
    el.innerHTML = shoes.length ? shoes.map(s=>{
      const pct = Math.min(100, Math.round(s.miles / s.limit_mi * 100));
      return `<div class="list-row shoe-row" data-id="${esc(s.id)}">
        <div style="flex:1;min-width:0;">
          <div class="list-title">${esc(s.name)} ${LABEL[s.status] ? `<span class="badge ${s.status === 'replace' ? 'bad' : ''}">${LABEL[s.status]}</span>` : ''}</div>
          <div class="hint">${s.miles} of ${s.limit_mi} mi${s.status === 'retired' ? '' : ` · ${s.left} left`}${s.since ? ` · since ${esc(s.since)}` : ''}</div>
          <div class="import-bar show"><i style="width:${pct}%;${s.status === 'replace' ? 'background:var(--pain,#c0392b)' : ''}"></i></div>
        </div>
        ${s.retired ? '' : '<button type="button" class="ghost" data-retire>Retire</button>'}
        <button type="button" class="ghost" data-del>Delete</button>
      </div>`;
    }).join('') : '<div class="hint">No shoes yet. Add a pair and Kestrel will count its miles.</div>';
    el.querySelectorAll('.shoe-row').forEach(row=>{
      const id = row.dataset.id;
      row.querySelector('[data-del]').onclick = ()=> { if(confirm('Delete these shoes?')) save(shoes.filter(s=> s.id !== id).map(plain)); };
      const r = row.querySelector('[data-retire]');
      if(r) r.onclick = ()=> save(shoes.map(s=> ({ ...plain(s), retired: s.id === id ? new Date().toISOString().slice(0,10) : s.retired })));
    });
  }

  async function load(){
    try{ shoes = await call('GET'); draw(); }catch(e){ $('shoeList').innerHTML = '<div class="hint">Couldn’t load your shoes.</div>'; }
  }

  function add(){
    const name = prompt('Which shoes? (e.g. Nike Pegasus 41)');
    if(!name) return;
    const limit = Number(prompt('Replace after how many miles?', '400')) || 400;
    const start = Number(prompt('Miles already on them (0 if new)', '0')) || 0;
    save([...shoes.map(plain), { name, limit_mi: limit, start_mi: start, since: new Date().toISOString().slice(0,10) }]);
  }

  const btn = $('shoeAdd'); if(btn) btn.onclick = add;
  const orig = window.kRecords && window.kRecords.render;
  if(orig) window.kRecords.render = async function(){ const r = await orig.apply(this, arguments); load(); return r; };
  window.kShoes = { load };
})();
