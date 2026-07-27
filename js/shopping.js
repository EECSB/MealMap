"use strict";
/* ============================================================
   SHOPPING LIST  —  buy what's missing; see what you can cook
   ============================================================ */
const shopList = document.getElementById('shopList');
const shopInput = document.getElementById('shopInput');
const availList = document.getElementById('availList');
const mealAvailFilter = document.getElementById('mealAvailFilter');

function mealAvail(m){
  const ings = m.ingredients||[];
  const missing = ings.filter(i=>!inPantry(i));
  return { total:ings.length, have:ings.length-missing.length, missing, ready: ings.length>0 && missing.length===0 };
}
function shopHas(name){ const n=name.trim().toLowerCase(); return shopping.some(s=>(s.name||'').trim().toLowerCase()===n); }
function addShoppingItem(name){
  const v=(name||'').trim(); if(!v || shopHas(v)) return false;
  shopping.push({id:uid(), name:v, done:false}); return true;
}
function renderShopping(){
  renderShopList(); renderAvail();
  // Both setLang() and setUnits() come through here, so an open share panel
  // follows them instead of holding a list in the language or units you just
  // switched away from.
  if(shareOverlay && shareOverlay.classList.contains('open')) renderShare();
}

/* ---------- combining quantities ----------
   Two meals both needing garlic should give one shopping line, not two. Only
   amounts that are genuinely addable are added: same measurement family, or the
   exact same unit word. Anything the parser is unsure about is left alone and
   listed separately — a wrong total is worse than two lines. */
const SUM_UNITS = {
  g:{base:'g',f:1}, gram:{base:'g',f:1}, grams:{base:'g',f:1}, mg:{base:'g',f:0.001},
  dag:{base:'g',f:10}, dkg:{base:'g',f:10}, kg:{base:'g',f:1000},
  ml:{base:'ml',f:1}, cl:{base:'ml',f:10}, dl:{base:'ml',f:100}, l:{base:'ml',f:1000},
  oz:{base:'oz',f:1}, lb:{base:'oz',f:16}, lbs:{base:'oz',f:16}
};
const MEASURE_WORDS = /^(cup|tbsp|tsp|tablespoon|teaspoon|clove|slice|can|jar|pack|packet|bunch|handful|piece|sprig|stick|head|pinch)$/;
/* Measure words in the other six languages, folded and mapped onto the English
   name so "2 žlici" and "2 tbsp" are the same unit and can actually be added.
   Inflected forms are spelled out: Slovenian declines these and stemWord() only
   knows English plurals. Both the folded word and its stem are looked up, which
   covers the Romance plurals (colheres → colhere). */
const UNIT_ALIASES = {
  // sl
  zlica:'tbsp', zlici:'tbsp', zlice:'tbsp', zlic:'tbsp',
  zlicka:'tsp', zlicki:'tsp', zlicke:'tsp', zlick:'tsp',
  /* Slovenian has a dual, so a feminine measure runs žlica / žlici / žlice / žlic
     — and "2 pločevinki" (dual) is exactly how a recipe writes two tins. All four
     forms are listed for each; missing the dual is the easy mistake. */
  skodelica:'cup', skodelici:'cup', skodelice:'cup', skodelic:'cup',
  scepec:'pinch', scepca:'pinch',
  strok:'clove', stroka:'clove', stroki:'clove', strokov:'clove',
  plocevinka:'can', plocevinki:'can', plocevinke:'can', plocevink:'can',
  vrecka:'packet', vrecki:'packet', vrecke:'packet', vreck:'packet',
  rezina:'slice', rezini:'slice', rezine:'slice', rezin:'slice', sop:'bunch',
  // de
  /* German and Italian plurals do not end in -s, so stemWord() cannot reach them
     from the singular and both forms have to be listed. */
  el:'tbsp', essloffel:'tbsp', tl:'tsp', teeloffel:'tsp', tasse:'cup', tassen:'cup',
  prise:'pinch', prisen:'pinch', zehe:'clove', zehen:'clove', dose:'can', dosen:'can',
  packung:'packet', packungen:'packet', bund:'bunch', scheibe:'slice', scheiben:'slice',
  // es
  cucharada:'tbsp', cucharadita:'tsp', taza:'cup', pizca:'pinch', diente:'clove',
  lata:'can', paquete:'packet', manojo:'bunch', rebanada:'slice', rodaja:'slice',
  // fr
  cuillere:'tbsp', cuilleree:'tbsp', pincee:'pinch', gousse:'clove',
  boite:'can', sachet:'packet', botte:'bunch', tranche:'slice',
  // it
  cucchiaio:'tbsp', cucchiai:'tbsp', cucchiaino:'tsp', cucchiaini:'tsp',
  tazza:'cup', tazze:'cup', pizzico:'pinch', pizzichi:'pinch',
  spicchio:'clove', spicchi:'clove', barattolo:'can', barattoli:'can',
  bustina:'packet', bustine:'packet', mazzo:'bunch', mazzi:'bunch', fetta:'slice', fette:'slice',
  // pt
  colher:'tbsp', colheres:'tbsp', xicara:'cup', pitada:'pinch', dente:'clove',
  pacote:'packet', maco:'bunch', fatia:'slice'
};
function unitAlias(word){
  const raw = foldText(word), st = stemWord(raw);
  return UNIT_ALIASES[st] || UNIT_ALIASES[raw] || st;
}
/* "1 1/2 kg potatoes" -> {qty:1.5, unit:'kg', unitText:'kg', rest:'potatoes'};
   null when there is no leading amount.
   `unit` is the canonical name used for adding up; `unitText` is what the line
   actually said, so a summed Slovenian line can still read "pločevinke" rather
   than being rewritten into English. */
function parseQty(line){
  const s = deVulgar(String(line||'')).trim();
  // \p{L}, not [a-zA-Z]: with the ASCII class "3 pločevinke breskev" matched only
  // "plo" and the rest of the word was glued back on as " čevinke", quietly
  // corrupting both the shopping line and its signature.
  const m = s.match(/^(\d+\s+\d+\s*\/\s*\d+|\d+\s*\/\s*\d+|\d+(?:[.,]\d+)?)\s*(\p{L}{1,12}\.?)?\s*(.*)$/u);
  if(!m) return null;
  const qty = num(m[1]);
  if(!isFinite(qty)) return null;
  const unitText = (m[2]||'').replace(/\.$/,'');
  // Singularise so "1 cup" and "2 cups" are the same unit.
  let unit = unitText ? unitAlias(unitText) : '', rest = m[3]||'';
  // A bare word after the number is a unit only if it is one we know; otherwise
  // it is the ingredient itself ("2 eggs" -> qty 2, no unit, rest "eggs").
  if(unit && !SUM_UNITS[unit] && !MEASURE_WORDS.test(unit)){
    rest = unitText + (rest ? ' ' + rest : '');
    unit = '';
  }
  rest = rest.trim();
  if(!rest) return null;                       // "500 g" alone tells us nothing
  // unitText is set only when the line's own word differs from the canonical, so
  // English lines carry nothing extra and keep their existing behaviour exactly.
  const spelledOut = unit && stemWord(foldText(unitText)) !== unit;
  return { qty, unit, unitText: spelledOut ? unitText : '', rest };
}
function fmtQty(x){ const r = Math.round(x*100)/100; return String(r); }
/* Units are singularised for comparison, so a total has to be put back into the
   plural: "5 clove garlic" -> "5 cloves garlic". Only spelled-out counting words
   take a plural — "4 tbsp" and "500 g" must stay as they are. */
const COUNT_UNITS = ['cup','clove','slice','can','jar','pack','packet','bunch','handful',
                     'piece','sprig','stick','head','pinch','tablespoon','teaspoon'];
function pluralUnit(unit, qty){
  if(qty <= 1 || !COUNT_UNITS.includes(unit)) return unit;
  return unit + (/(ch|sh|s|x|z)$/.test(unit) ? 'es' : 's');
}
// Adds two parsed amounts, or returns null when they are not comparable.
function addQty(a, b){
  if(a.unit === b.unit) return { qty:a.qty+b.qty, unit:a.unit };
  const ua = SUM_UNITS[a.unit], ub = SUM_UNITS[b.unit];
  if(!ua || !ub || ua.base !== ub.base) return null;
  return { qty:a.qty*ua.f + b.qty*ub.f, unit:ua.base };
}
// Scale a total back to a comfortable unit (1200 g -> 1.2 kg).
function tidyQty(q){
  let {qty, unit} = q;
  if(unit==='g'  && qty>=1000) return { qty:qty/1000, unit:'kg' };
  if(unit==='ml' && qty>=1000) return { qty:qty/1000, unit:'l'  };
  if(unit==='oz' && qty>=16)   return { qty:qty/16,   unit:'lb' };
  return q;
}
/* Groups ingredient lines that mean the same thing and adds their amounts.
   Returns the lines to put on the list. A group whose amounts cannot be added
   is returned as its separate original lines rather than guessed at. */
function combineIngredients(lines){
  const groups = new Map();
  lines.forEach(line=>{
    const p = parseQty(line);
    const key = ingSignature(p ? p.rest : line) || String(line).trim().toLowerCase();
    if(!groups.has(key)) groups.set(key, { total:null, summable:true, rest:p?p.rest:'', topQty:-Infinity, n:0, texts:[] });
    const g = groups.get(key);
    g.n++;                                   // counts contributions, including identical ones:
    if(!g.texts.includes(line)) g.texts.push(line);   // two meals each wanting "1 slice bread" need 2
    if(!g.summable) return;
    if(!p){ g.summable = false; return; }              // a line with no amount
    // Keep the wording from the largest amount, so 1 onion + 2 onions reads
    // "3 onions" rather than "3 onion".
    if(!g.total || p.qty > g.topQty){ g.rest = p.rest; g.topQty = p.qty; g.unitText = p.unitText; g.unitCanon = p.unit; }
    if(!g.total){ g.total = { qty:p.qty, unit:p.unit }; return; }
    const sum = addQty(g.total, p);
    if(!sum){ g.summable = false; return; }            // e.g. cloves + heads
    g.total = sum;
  });
  const out = [];
  groups.forEach(g=>{
    if(g.summable && g.total && g.n > 1){
      const q = tidyQty(g.total);
      // as in scaleIngredient: keep the wording of the largest contributor unless
      // the unit family changed under it
      const unit = (g.unitText && q.unit === g.unitCanon) ? g.unitText : pluralUnit(q.unit, q.qty);
      out.push((fmtQty(q.qty) + (unit ? ' ' + unit : '') + ' ' + g.rest).trim());
    } else {
      g.texts.forEach(txt=>out.push(txt));             // single item, or not addable
    }
  });
  return out;
}

/* ---------- build the list from a week of the meal plan ----------
   Walks the seven days of the chosen week, collects every scheduled meal's
   ingredients, drops what the pantry already covers, and adds the rest. */
function daysBetween(from, to){
  const keys = [], d = new Date(from);
  d.setHours(0,0,0,0);
  const end = new Date(to); end.setHours(0,0,0,0);
  // a runaway range would be a hang, not a feature — two years is plenty
  for(let i=0; d<=end && i<800; i++){ keys.push(dateKey(d)); d.setDate(d.getDate()+1); }
  return keys;
}
/* Turns the picker value into a list of day keys.
   w0/w1 = Monday-first weeks (matching the calendar), d7/d14 = rolling windows
   from today, m0/m1 = calendar months, custom = the two date inputs. */
function planRangeKeys(which){
  const today = new Date(); today.setHours(0,0,0,0);
  if(which==='custom'){
    const a = document.getElementById('shopFrom').value, b = document.getElementById('shopTo').value;
    if(!a || !b) return null;                                  // caller reports the problem
    let from = parseKey(a), to = parseKey(b);
    if(to < from){ const t = from; from = to; to = t; }         // tolerate a reversed range
    return daysBetween(from, to);
  }
  if(which==='d7' || which==='d14'){
    const to = new Date(today); to.setDate(to.getDate() + (which==='d7'?6:13));
    return daysBetween(today, to);
  }
  if(which==='m0' || which==='m1'){
    const off = which==='m1' ? 1 : 0;
    const from = new Date(today.getFullYear(), today.getMonth()+off, 1);
    const to   = new Date(today.getFullYear(), today.getMonth()+off+1, 0);   // day 0 = last of previous
    return daysBetween(from, to);
  }
  const from = new Date(today);
  from.setDate(from.getDate() - ((from.getDay()+6)%7) + (which==='w1'?7:0));  // back to Monday
  const to = new Date(from); to.setDate(to.getDate()+6);
  return daysBetween(from, to);
}
function addFromPlan(which){
  const fb = document.getElementById('shopFeedback');
  const days = planRangeKeys(which);
  if(!days){ fb.textContent = t('range_need_dates'); return; }
  /* One contribution per *cooking session*, which is not the same as per meal
     and not the same as per day:
       - a batch is cooked once however many days it spans, so it counts once;
       - the same meal on two unrelated days is cooked twice, so it counts twice
         and the amounts get summed below.
     This used to dedupe by meal id, which quietly under-bought whenever you
     planned to cook something twice in the same range. */
  const sessions = [];
  const countedBatches = new Set();
  days.forEach(k => (schedule[k]||[]).forEach(s=>{
    if(!s.mealId) return;
    if(s.batchId){
      if(countedBatches.has(s.batchId)) return;
      countedBatches.add(s.batchId);
    }
    sessions.push(s.mealId);
  }));
  const meals = sessions.map(byId).filter(Boolean);
  if(!meals.length){ fb.textContent = t('shop_plan_none'); return; }

  // Collect everything the pantry does not already cover, then add up the
  // amounts so garlic from three meals becomes one line, not three.
  const wanted = [];
  meals.forEach(m => (m.ingredients||[]).forEach(ing=>{ if(!inPantry(ing)) wanted.push(ing); }));

  // Skip anything already on the list, comparing by canonical signature so
  // "2 cloves garlic" and "3 cloves garlic" count as the same item.
  const onList = new Set(shopping.map(s=>{ const p=parseQty(s.name); return ingSignature(p?p.rest:s.name); }).filter(Boolean));
  let added = 0;
  combineIngredients(wanted).forEach(line=>{
    const p = parseQty(line);
    const sig = ingSignature(p ? p.rest : line);
    if(sig && onList.has(sig)) return;
    if(sig) onList.add(sig);
    if(addShoppingItem(line)) added++;
  });
  if(added){ save(STORE.shopping); renderShopping(); }
  fb.textContent = added ? t('shop_plan_added', {n:added}) : t('shop_plan_nothing');
}

function renderShopList(){
  if(shopping.length===0){
    shopList.innerHTML = `<div class="empty" style="padding:38px 16px"><div class="big">🛒</div><h3>${esc(t('shop_empty_title'))}</h3><p>${esc(t('shop_empty_sub'))}</p></div>`;
    return;
  }
  const sorted = shopping.slice().sort((a,b)=> (a.done?1:0)-(b.done?1:0));
  shopList.innerHTML = sorted.map(s=>`
    <div class="shop-item ${s.done?'done':''}" data-id="${s.id}">
      <button class="shop-check" data-action="toggle">${s.done?'✓':''}</button>
      <span class="shop-name">${esc(convUnits(s.name))}</span>
      <button class="shop-del" data-action="remove" title="✕">×</button>
    </div>`).join('');
}
function renderAvail(){
  if(menu.length===0){
    availList.innerHTML = `<div class="empty"><div class="big">🍽️</div><h3>${esc(t('avail_none_title'))}</h3><p>${esc(t('avail_none_sub'))}</p></div>`;
    return;
  }
  let list = menu.map(m=>({m, a:mealAvail(m)}));
  if(mealAvailFilter.value==='ready') list = list.filter(x=>x.a.ready);
  list.sort((x,y)=> (x.a.missing.length - y.a.missing.length) || x.m.name.localeCompare(y.m.name, LOCALE[lang]));
  if(list.length===0){
    availList.innerHTML = `<div class="empty"><div class="big">🛒</div><h3>${esc(t('avail_ready_none'))}</h3><p>${esc(t('avail_none_sub'))}</p></div>`;
    return;
  }
  availList.innerHTML = list.map(({m,a})=>{
    let sub, addBtn='';
    if(a.total===0){ sub = `<span class="have-badge">${esc(t('avail_no_ings'))}</span>`; }
    else if(a.ready){ sub = `<span class="have-badge ready">${esc(t('avail_ready'))}</span>`; }
    else {
      sub = `<span class="have-badge">${esc(t('avail_have',{have:a.have,total:a.total}))}</span>` +
            a.missing.map(i=>`<span class="miss-chip" data-action="add-one" data-ing="${esc(i)}">+ ${esc(convUnits(i))}</span>`).join('');
      addBtn = `<button class="avail-add" data-action="add-missing" data-id="${m.id}">${esc(t('avail_add_missing',{n:a.missing.length}))}</button>`;
    }
    return `<div class="avail-card ${a.ready?'ready':''}" data-id="${m.id}">
      <span class="avail-emoji" data-action="open">${esc(m.emoji||'🍽️')}</span>
      <div class="avail-info" data-action="open">
        <div class="avail-name">${esc(m.name)}</div>
        <div class="avail-sub">${sub}</div>
      </div>
      ${addBtn}
    </div>`;
  }).join('');
}

availList.addEventListener('click', e=>{
  const card = e.target.closest('.avail-card'); if(!card) return;
  const id = card.dataset.id;
  const act = e.target.closest('[data-action]'); if(!act) return;
  const a = act.dataset.action;
  if(a==='open') openRecipe(id);
  else if(a==='add-one'){ if(addShoppingItem(act.dataset.ing)){ save(STORE.shopping); renderShopping(); } }
  else if(a==='add-missing'){ const m=byId(id); if(m){ let n=0; mealAvail(m).missing.forEach(i=>{ if(addShoppingItem(i)) n++; }); if(n){ save(STORE.shopping); renderShopping(); } } }
});
shopList.addEventListener('click', e=>{
  const item = e.target.closest('.shop-item'); if(!item) return;
  const id = item.dataset.id;
  const act = e.target.closest('[data-action]'); if(!act) return;
  if(act.dataset.action==='toggle'){ const s=shopping.find(x=>x.id===id); if(s){ s.done=!s.done; save(STORE.shopping); renderShopList(); } }
  else if(act.dataset.action==='remove'){ shopping = shopping.filter(x=>x.id!==id); save(STORE.shopping); renderShopList(); }
});
function shopAdd(){ if(addShoppingItem(shopInput.value)){ shopInput.value=''; save(STORE.shopping); renderShopList(); } shopInput.focus(); }
document.getElementById('shopAddBtn').addEventListener('click', shopAdd);
shopInput.addEventListener('keydown', e=>{ if(e.key==='Enter') shopAdd(); });
document.getElementById('shopClearBtn').addEventListener('click', ()=>{ const n=shopping.length; shopping = shopping.filter(s=>!s.done); if(shopping.length!==n){ save(STORE.shopping); renderShopList(); } });
document.getElementById('shopLowBtn').addEventListener('click', ()=>{ let n=0; pantry.filter(p=>p.low).forEach(p=>{ if(addShoppingItem(p.name)) n++; }); if(n){ save(STORE.shopping); renderShopList(); } });   // reads pantry, writes shopping
document.getElementById('shopPlanBtn').addEventListener('click', ()=>{
  addFromPlan(document.getElementById('shopPlanWeek').value);
});
document.getElementById('shopPlanWeek').addEventListener('change', e=>{
  document.getElementById('shopFeedback').textContent = '';
  const custom = e.target.value === 'custom';
  document.getElementById('shopRange').hidden = !custom;
  if(custom && !document.getElementById('shopFrom').value){
    // seed with today → +6 days so the pickers are never empty
    const a = new Date(), b = new Date(); b.setDate(b.getDate()+6);
    document.getElementById('shopFrom').value = dateKey(a);
    document.getElementById('shopTo').value   = dateKey(b);
  }
});
mealAvailFilter.addEventListener('change', renderAvail);

/* ============================================================
   SHARING THE LIST  —  getting it off this machine and into a pocket
   ------------------------------------------------------------
   "Share the shopping list" means something different depending on where you
   are standing, so there are five ways out and they all carry the same text:

     - Copy        the universal one; pastes into anything.
     - Send to…    the OS share sheet (navigator.share). On a phone this is the
                   real answer — WhatsApp, Messages, Notes, one tap. It does
                   not exist on most desktops, so the button hides itself
                   rather than sitting there dead.
     - Email       a mailto: link. There is no back end and there is not going
                   to be one, so the app cannot *send* mail. It hands a filled-in
                   message to the user's own mail app and they press send —
                   which also means nothing leaves the device unless they do.
                   The address is remembered so "to myself" is one click; it is
                   kept in this browser only and is not in the export.
     - Text file   a .txt download. No length limit, works offline, works from
                   file://. The fallback when anything else is too small.
     - QR code     drawn here, offline (js/qr.js). Point the other phone's
                   camera at the screen and the list is on it: no account, no
                   network, nothing typed, and nothing sent to anybody's server.

   The text is built from what is *on screen* — the same order renderShopList()
   uses and through convUnits() — so a list read in imperial does not arrive on
   the phone in metric. renderShopping() refreshes this panel while it is open,
   which is what makes the language and unit toggles carry over for free.
   ============================================================ */
const shareOverlay = document.getElementById('shareOverlay');
const shareDone = document.getElementById('shareDone');
const shareEmailInput = document.getElementById('shareEmail');

function shareIncludeDone(){ return !!(shareDone && shareDone.checked); }
/* Ticked items keep a ✓ instead of a dash, rather than getting their own
   section: it survives being pasted into any notes app, and the sort already
   puts them at the end. */
function shopListText(includeDone){
  const lines = shopping.slice()
    .sort((a,b)=>(a.done?1:0)-(b.done?1:0))
    .filter(s=>includeDone || !s.done)
    .map(s=>(s.done?'✓ ':'- ') + convUnits(s.name));
  if(!lines.length) return '';
  const when = new Date().toLocaleDateString(LOCALE[lang], {day:'numeric', month:'long', year:'numeric'});
  return t('brand_title') + ' — ' + t('shop_list_title') + ' · ' + when + '\n\n' + lines.join('\n');
}
function shareStatus(msg, kind){
  const el = document.getElementById('shareStatus');
  if(!el) return;
  el.textContent = msg || '';
  el.className = 'ai-status' + (kind ? ' ' + kind : '');
}
function renderShare(){
  const text = shopListText(shareIncludeDone());
  const empty = !text;
  document.getElementById('sharePreview').textContent = text;
  // Two different kinds of nothing: an empty list, and a list where everything
  // is already ticked off and the box above is unticked. Saying "empty" for the
  // second one would be a lie with the answer sitting right above it.
  const hint = document.getElementById('shareEmpty');
  hint.hidden = !empty;
  hint.textContent = empty ? t(shopping.length ? 'share_all_done' : 'share_empty') : '';
  ['shareCopyBtn','shareSendBtn','shareTxtBtn','shareEmailBtn'].forEach(id=>{
    const b = document.getElementById(id); if(b) b.disabled = empty;
  });

  const box = document.getElementById('shareQrBox'), note = document.getElementById('shareQrNote');
  const qr = empty ? null : qrEncode(text);
  box.innerHTML = qr ? qrSvg(qr, t('share_qr_title')) : '';
  box.hidden = !qr;
  // A list past the QR ceiling is not an error — it is a big shop. Say which
  // way out to take instead of drawing something too fine to scan.
  note.textContent = empty ? '' : (qr ? t('share_qr_note') : t('share_qr_long'));

  // mailto: has no standard length limit, and the practical one is whatever the
  // mail app decides. Long lists usually survive; some clients truncate them.
  const long = !empty && encodeURIComponent(text).length > 1800;
  document.getElementById('shareEmailLong').hidden = !long;
  shareStatus('');
}
function openShare(){
  try{ shareEmailInput.value = localStorage.getItem(STORE.shareEmail) || ''; }catch(e){}
  renderShare();
  open(shareOverlay);
}

/* The async clipboard needs a secure context, which file:// is not — so the old
   execCommand path stays as the fallback rather than the feature just failing
   for anyone who opened index.html by double-clicking it. */
function shareCopyFallback(text){
  try{
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly','');
    ta.style.cssText = 'position:fixed; top:-1000px; opacity:0';
    document.body.appendChild(ta);
    ta.select(); ta.setSelectionRange(0, text.length);     // iOS needs the range
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }catch(e){ return false; }
}
function shareCopy(text){
  if(navigator.clipboard && window.isSecureContext)
    return navigator.clipboard.writeText(text).then(()=>true, ()=>shareCopyFallback(text));
  return Promise.resolve(shareCopyFallback(text));
}

document.getElementById('shopShareBtn').addEventListener('click', openShare);
shareDone.addEventListener('change', renderShare);
document.getElementById('shareCopyBtn').addEventListener('click', ()=>{
  const text = shopListText(shareIncludeDone()); if(!text) return;
  shareCopy(text).then(ok=>shareStatus(t(ok?'share_copied':'share_copy_fail'), ok?'ok':'warn'));
});
document.getElementById('shareTxtBtn').addEventListener('click', ()=>{
  const text = shopListText(shareIncludeDone()); if(!text) return;
  const name = 'mealmap-shopping-' + dateStamp() + '.txt';
  downloadBlob(new Blob([text], {type:'text/plain;charset=utf-8'}), name);
  shareStatus(t('share_saved', {name}), 'ok');
});
/* Kept separate from the click so it can be checked without a mail client
   opening. The first line of the text doubles as the subject, so the body
   starts at the items rather than repeating the heading. The address is left
   un-encoded — it is the mailto: path, not a parameter, and percent-encoding
   the @ confuses some clients. */
function shareMailto(text, to){
  const [subject, ...rest] = String(text).split('\n');
  return 'mailto:' + (to || '') + '?subject=' + encodeURIComponent(subject) +
         '&body=' + encodeURIComponent(rest.join('\n').replace(/^\n+/, ''));
}
document.getElementById('shareEmailBtn').addEventListener('click', ()=>{
  const text = shopListText(shareIncludeDone()); if(!text) return;
  const to = shareEmailInput.value.trim();
  if(to && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)){ shareStatus(t('share_email_bad'), 'warn'); return; }
  try{ localStorage.setItem(STORE.shareEmail, to); }catch(e){}
  location.href = shareMailto(text, to);
  shareStatus(t('share_email_opened'));
});
/* navigator.share needs a secure context and, on desktop, an OS that offers a
   share sheet. Hidden rather than disabled — an unexplained dead button is
   worse than one less option. */
const shareSendBtn = document.getElementById('shareSendBtn');
if(navigator.share){
  shareSendBtn.addEventListener('click', ()=>{
    const text = shopListText(shareIncludeDone()); if(!text) return;
    navigator.share({ title: t('shop_list_title'), text })
      .then(()=>shareStatus(''), e=>{ if(e && e.name !== 'AbortError') shareStatus(t('share_send_fail'), 'warn'); });
  });
} else {
  shareSendBtn.hidden = true;
}
