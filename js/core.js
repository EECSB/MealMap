"use strict";
const LOCALE = { en:'en-GB', sl:'sl-SI', es:'es-ES', fr:'fr-FR', de:'de-DE', it:'it-IT', pt:'pt-BR' };
const WEEKDAYS_I18N = {
  en:['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],
  sl:['Pon','Tor','Sre','Čet','Pet','Sob','Ned'],
  es:['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'],
  fr:['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'],
  de:['Mo','Di','Mi','Do','Fr','Sa','So'],
  it:['Lun','Mar','Mer','Gio','Ven','Sab','Dom'],
  pt:['Seg','Ter','Qua','Qui','Sex','Sáb','Dom']
};
/* Language picker metadata. Flags are inline SVG on purpose — regional-indicator
   emoji render as bare letters ("GB", "SI") on Windows/Chromium. viewBox is 60x30.
   flag() takes a uniquifying suffix: the selected flag is drawn twice (dropdown
   trigger + list), so any flag using internal ids (clipPath, gradient) must fold
   the suffix into them. None currently do — keep the parameter for ones that will. */
const LANGS = [
  {code:'en', label:'English', flag:()=>`<svg class="flag" viewBox="0 0 60 30" aria-hidden="true"><rect width="60" height="30" fill="#B22234"/><g fill="#fff"><rect y="2.31" width="60" height="2.31"/><rect y="6.92" width="60" height="2.31"/><rect y="11.54" width="60" height="2.31"/><rect y="16.15" width="60" height="2.31"/><rect y="20.77" width="60" height="2.31"/><rect y="25.38" width="60" height="2.31"/></g><rect width="24" height="16.15" fill="#3C3B6E"/><g fill="#fff"><circle cx="2.4" cy="2" r=".9"/><circle cx="7.2" cy="2" r=".9"/><circle cx="12" cy="2" r=".9"/><circle cx="16.8" cy="2" r=".9"/><circle cx="21.6" cy="2" r=".9"/><circle cx="4.8" cy="6" r=".9"/><circle cx="9.6" cy="6" r=".9"/><circle cx="14.4" cy="6" r=".9"/><circle cx="19.2" cy="6" r=".9"/><circle cx="2.4" cy="10" r=".9"/><circle cx="7.2" cy="10" r=".9"/><circle cx="12" cy="10" r=".9"/><circle cx="16.8" cy="10" r=".9"/><circle cx="21.6" cy="10" r=".9"/><circle cx="4.8" cy="14" r=".9"/><circle cx="9.6" cy="14" r=".9"/><circle cx="14.4" cy="14" r=".9"/><circle cx="19.2" cy="14" r=".9"/></g></svg>`},
  {code:'sl', label:'Slovenščina', flag:()=>`<svg class="flag" viewBox="0 0 60 30" aria-hidden="true"><rect width="60" height="30" fill="#fff"/><rect y="10" width="60" height="10" fill="#1E5FA8"/><rect y="20" width="60" height="10" fill="#D81E2C"/><g transform="translate(8,3)"><path d="M0,1 H13 V8 C13,12 9.5,14 6.5,15 C3.5,14 0,12 0,8 Z" fill="#1E5FA8" stroke="#D81E2C" stroke-width="1"/><path d="M1.5,11 L3.5,6.5 L5,8.5 L6.5,5 L8,8.5 L9.5,6.5 L11.5,11 Z" fill="#fff"/><path d="M2,11.6 q1.4,-1 2.9,0 t2.9,0 t2.9,0" fill="none" stroke="#fff" stroke-width="0.8"/><g fill="#F5D000"><circle cx="3.6" cy="3" r=".95"/><circle cx="9.4" cy="3" r=".95"/><circle cx="6.5" cy="5.7" r=".95"/></g></g></svg>`},
  {code:'es', label:'Español', flag:()=>`<svg class="flag" viewBox="0 0 60 30" aria-hidden="true"><rect width="60" height="30" fill="#AA151B"/><rect y="7.5" width="60" height="15" fill="#F1BF00"/></svg>`},
  {code:'fr', label:'Français', flag:()=>`<svg class="flag" viewBox="0 0 60 30" aria-hidden="true"><rect width="60" height="30" fill="#fff"/><rect width="20" height="30" fill="#002395"/><rect x="40" width="20" height="30" fill="#ED2939"/></svg>`},
  {code:'de', label:'Deutsch', flag:()=>`<svg class="flag" viewBox="0 0 60 30" aria-hidden="true"><rect width="60" height="30" fill="#000"/><rect y="10" width="60" height="10" fill="#DD0000"/><rect y="20" width="60" height="10" fill="#FFCE00"/></svg>`},
  {code:'it', label:'Italiano', flag:()=>`<svg class="flag" viewBox="0 0 60 30" aria-hidden="true"><rect width="60" height="30" fill="#fff"/><rect width="20" height="30" fill="#008C45"/><rect x="40" width="20" height="30" fill="#CD212A"/></svg>`},
  {code:'pt', label:'Português', flag:()=>`<svg class="flag" viewBox="0 0 60 30" aria-hidden="true"><rect width="60" height="30" fill="#DA291C"/><rect width="24" height="30" fill="#046A38"/><circle cx="24" cy="15" r="6.4" fill="#FFE900"/><circle cx="24" cy="15" r="4.6" fill="#DA291C"/><circle cx="24" cy="15" r="2.6" fill="#fff"/></svg>`}
];
const SLOTS = ['breakfast','lunch','dinner','snack'];

let lang = 'en';
// Guarded on purpose — an unguarded localStorage read here once froze the whole
// app in a sandbox before any listeners attached. Keep the try/catch.
try{ const v=localStorage.getItem(STORE.lang); if(v && I18N[v]) lang=v; }catch(e){}
let units = 'metric';
try{ const v=localStorage.getItem(STORE.units); if(v==='metric'||v==='imperial') units=v; }catch(e){}
function t(key, params){
  let s = (I18N[lang] && I18N[lang][key]!=null) ? I18N[lang][key] : (I18N.en[key]!=null ? I18N.en[key] : key);
  if(params){ for(const k in params){ s = s.split('{'+k+'}').join(params[k]); } }
  return s;
}
function slotLabel(slot){ return t('slot_'+slot); }

/* ---------- sample data (first run only) ---------- */
const SAMPLE = [
  {
    id:uid(), name:'Fluffy Buttermilk Pancakes', category:'Breakfast', emoji:'🥞',
    time:25, servings:4, image:'https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?w=700&q=80',
    desc:'Light, stacked pancakes with a golden crust — perfect with maple syrup.',
    ingredients:['200g flour','2 tbsp sugar','1 tsp baking powder','1 egg','300ml buttermilk','2 tbsp melted butter','Pinch of salt'],
    steps:['Whisk the dry ingredients together.','Beat the egg with buttermilk and melted butter.','Fold wet into dry until just combined — leave it lumpy.','Cook on a buttered pan over medium heat until bubbles form, then flip.','Stack and serve with syrup and fruit.']
  },
  {
    id:uid(), name:'Creamy Mushroom Pasta', category:'Main', emoji:'🍝',
    time:30, servings:2, image:'https://images.unsplash.com/photo-1551183053-bf91a1d81141?w=700&q=80',
    desc:'Silky garlic-cream sauce clinging to ribbons of pasta and seared mushrooms.',
    ingredients:['250g tagliatelle','300g mushrooms, sliced','3 cloves garlic','200ml cream','Parmesan, grated','Olive oil','Salt & black pepper','Fresh parsley'],
    steps:['Cook pasta in salted water until al dente; reserve a cup of the water.','Sear mushrooms in olive oil until golden.','Add garlic, cook 1 minute, then pour in cream.','Toss pasta into the sauce with parmesan, loosening with pasta water.','Finish with pepper and parsley.']
  },
  {
    id:uid(), name:'Crunchy Garden Salad', category:'Side', emoji:'🥗',
    time:15, servings:4, image:'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=700&q=80',
    desc:'A bright, crisp salad with a sharp lemon-mustard dressing.',
    ingredients:['Mixed leaves','1 cucumber','200g cherry tomatoes','1 avocado','Red onion','Lemon juice','Dijon mustard','Olive oil'],
    steps:['Chop the vegetables into bite-size pieces.','Whisk lemon juice, mustard and olive oil for the dressing.','Toss everything together just before serving.']
  },
  {
    id:uid(), name:'Spiced Chickpea Curry', category:'Main', emoji:'🍛',
    time:40, servings:4, image:'https://images.unsplash.com/photo-1455619452474-d2be8b1e70cd?w=700&q=80',
    desc:'A warming, fragrant curry that gets better the next day.',
    ingredients:['2 cans chickpeas','1 onion','2 cloves garlic','Thumb of ginger','1 can chopped tomatoes','400ml coconut milk','2 tbsp curry powder','Rice, to serve'],
    steps:['Soften onion, then add garlic and ginger.','Stir in curry powder and toast for a minute.','Add tomatoes and coconut milk; simmer 10 minutes.','Add chickpeas and cook until thick.','Serve over rice.']
  }
];

/* ---------- sample pantry (first run only) ---------- */
const SAMPLE_PANTRY = [
  {id:uid(), name:'Flour', qty:'1 kg', category:'Baking', emoji:'🌾', low:false},
  {id:uid(), name:'Eggs', qty:'6', category:'Dairy & eggs', emoji:'🥚', low:false},
  {id:uid(), name:'Milk', qty:'1 L', category:'Dairy & eggs', emoji:'🥛', low:true},
  {id:uid(), name:'Butter', qty:'250 g', category:'Dairy & eggs', emoji:'🧈', low:false},
  {id:uid(), name:'Garlic', qty:'1 bulb', category:'Produce', emoji:'🧄', low:false},
  {id:uid(), name:'Onion', qty:'3', category:'Produce', emoji:'🧅', low:false},
  {id:uid(), name:'Tomatoes', qty:'5', category:'Produce', emoji:'🍅', low:false},
  {id:uid(), name:'Olive oil', qty:'500 ml', category:'Condiments', emoji:'🫒', low:false},
  {id:uid(), name:'Pasta', qty:'2 packs', category:'Grains & pasta', emoji:'🍝', low:false},
  {id:uid(), name:'Rice', qty:'2 kg', category:'Grains & pasta', emoji:'🍚', low:false},
  {id:uid(), name:'Salt', qty:'', category:'Spices & herbs', emoji:'🧂', low:false}
];

/* ---------- state ---------- */
let menu = load(STORE.menu, null) || SAMPLE.slice();
let schedule = load(STORE.sched, null) || {};
let pantry = load(STORE.pantry, null) || SAMPLE_PANTRY.slice();
let shopping = load(STORE.shopping, null) || [];
/* Batch cooking: one record per "cooked once, eaten over several days" run.
   {id, mealId, cookDate:'YYYY-MM-DD', portions:N}. The days themselves are
   ordinary schedule entries that carry a `batchId` back to here — the batch owns
   no dates of its own, so moving or deleting a day needs no bookkeeping beyond
   the entry itself. Whether a given day is a *leftover* is derived by comparing
   its date to cookDate rather than stored, so the two can never disagree. */
let batches = load(STORE.batches, null) || [];
let calDate = new Date();
let currentRecipeId = null;
let currentDayKey = null;
let recipeIsRandom = false;

/* ---------- helpers ---------- */
function uid(){ return 'm'+Math.random().toString(36).slice(2,9)+Date.now().toString(36).slice(-4); }
/* Export / sync payload version.
   1→2 predates this file. 2→3 (2026-07-25) added meal `images[]`, `sourceUrl`
   and `nutrition`. 3→4 (2026-07-25) added the top-level `batches[]` store and an
   optional `batchId` on schedule entries. Every change so far has been additive,
   so a v2 file still imports cleanly — normaliseMeal() fills in what an older
   file lacks, and a file with no `batches` simply has no batch cooking in it.
   Bump this whenever the stored shape changes, and say what changed here. */
const SCHEMA_VERSION = 4;

/* ---------- storage: localStorage first, IndexedDB as overflow ----------
   Photos are kept as base64 data URLs, which run through the ~5MB localStorage
   quota fast — a handful of uploads is enough. Every key is written to
   localStorage first; on a quota error the same string goes to IndexedDB
   instead and the localStorage copy is deleted, so the two can never disagree
   about which one holds the current value.
   Reads stay synchronous from localStorage (first paint is unchanged); whatever
   overflowed is pulled back in by hydrateFromIdb() right after boot. */
const IDB_NAME = 'mealmap', IDB_STORE = 'kv';
let _idb = null;
function idbOpen(){
  if(_idb) return _idb;
  _idb = new Promise((res, rej)=>{
    let rq; try{ rq = indexedDB.open(IDB_NAME, 1); }catch(e){ return rej(e); }
    rq.onupgradeneeded = ()=>{ rq.result.createObjectStore(IDB_STORE); };
    rq.onsuccess = ()=>res(rq.result);
    rq.onerror   = ()=>rej(rq.error);
  }).catch(e=>{ _idb = null; throw e; });   // let a later call retry
  return _idb;
}
function idbTx(mode, fn){
  return idbOpen().then(db=>new Promise((res, rej)=>{
    const tx = db.transaction(IDB_STORE, mode);
    const rq = fn(tx.objectStore(IDB_STORE));
    tx.oncomplete = ()=>res(rq && rq.result);
    tx.onerror    = ()=>rej(tx.error);
  }));
}
const idbGet = k      => idbTx('readonly',  s=>s.get(k));
const idbSet = (k, v) => idbTx('readwrite', s=>s.put(v, k));
const idbDel = k      => idbTx('readwrite', s=>s.delete(k));

function isQuotaError(e){
  return !!e && (e.name==='QuotaExceededError' || e.name==='NS_ERROR_DOM_QUOTA_REACHED' || e.code===22);
}
/* save() rewrites all five stores whatever changed, and localStorage.setItem is
   synchronous: a 3MB `menu` (a few uploaded photos will do it) costs ~7ms of
   blocked main thread. Dragging a chip, ticking off shopping, starring a recipe
   — none of those touch `menu`, but all of them paid for it. Past the ~5MB quota
   it was worse still: every save threw, retried, threw again, then rewrote the
   whole blob to IndexedDB.
   Remembering what was last written turns all of those back into no-ops. Only
   this file writes these keys, so the record cannot go stale underneath us. */
const _lastWritten = new Map();                     // key -> {str, where:'ls'|'idb'}
/* Skipping is only safe while the value is still where we left it. A key that
   overflowed is deliberately absent from localStorage, so we trust our own note
   for those; for the normal path we confirm the name is still present — which is
   a cheap lookup, unlike getItem, and catches the site-data-cleared case that
   would otherwise make saves silently stop persisting. */
function alreadyStored(key, str){
  const prev = _lastWritten.get(key);
  if(!prev || prev.str !== str) return false;
  return prev.where === 'idb' || Object.prototype.hasOwnProperty.call(localStorage, key);
}
// Returns false only when the value could not be stored anywhere at all.
function putKey(key, str){
  try{ if(alreadyStored(key, str)) return true; }catch(e){}
  const done = where => { _lastWritten.set(key, {str, where}); return true; };
  try{ localStorage.setItem(key, str); idbDel(key).catch(()=>{}); return done('ls'); }
  catch(e){
    if(!isQuotaError(e)) return false;
    // Dropping the previous value may free just enough room for the new one.
    try{ localStorage.removeItem(key); localStorage.setItem(key, str); idbDel(key).catch(()=>{}); return done('ls'); }catch(_){}
    try{ localStorage.removeItem(key); }catch(_){}
    idbSet(key, str).catch(()=>{});
    return done('idb');                             // overflowed to IndexedDB
  }
}
function load(key, fallback){ try{ const v=localStorage.getItem(key); return v?JSON.parse(v):fallback; }catch(e){ return fallback; } }

/* Every persisted store in one place: its key, and how to read and replace the
   in-memory value. saveLocalOnly() and hydrateFromIdb() both walk this list, so
   the two cannot drift apart as stores get added. */
const STORES = [
  { key:STORE.menu,     get:()=>menu,     set:v=>{ menu = v; } },
  { key:STORE.sched,    get:()=>schedule, set:v=>{ schedule = v; } },
  { key:STORE.pantry,   get:()=>pantry,   set:v=>{ pantry = v; } },
  { key:STORE.shopping, get:()=>shopping, set:v=>{ shopping = v; } },
  { key:STORE.batches,  get:()=>batches,  set:v=>{ batches = v; } }
];

/* ---------- the boot race ----------
   A key missing from localStorage means one of two things, and until IndexedDB
   answers we cannot tell which: either nothing was ever saved (first run), or it
   overflowed to IndexedDB on an earlier save. In the second case what is in
   memory right now is only the first-run placeholder — SAMPLE meals, an empty
   schedule — not the user's data.

   Saving in that window was destructive, not merely racy: putKey() would write
   the placeholder to localStorage AND delete the IndexedDB copy that held the
   real library, and hydrateFromIdb() would then find the key present and skip
   it. One click in the first few milliseconds could wipe everything.

   So a store with no localStorage copy is held back from saving until hydration
   has settled the question. The set is computed synchronously at boot, before
   any listener can fire. */
const _awaitingIdb = new Set(
  STORES.map(s=>s.key).filter(k=>{ try{ return localStorage.getItem(k) === null; }catch(e){ return false; } })
);
let _saveDeferred = false;

/* Serialises only the stores named, or all of them when told nothing.
   Skipping the localStorage write for an unchanged store was the expensive half
   and is handled in putKey(); this skips the JSON.stringify as well, which
   matters because `menu` carries the photos and is stringified even when the
   thing that changed was a shopping tick.
   **Saying nothing means "all"** on purpose: a call site that forgets to declare
   what it touched still persists everything, so a narrowing mistake can never
   silently lose data — it can only cost a little time. Narrow a call site only
   after checking what it actually writes; `auditSave` in tests.html verifies
   every narrowed one against what really changed. */
function saveLocalOnly(which){
  const targets = (which && which.length) ? STORES.filter(s=>which.includes(s.key)) : STORES;
  let ok = true;
  targets.forEach(s=>{
    if(_awaitingIdb.has(s.key)){ _saveDeferred = true; return; }   // flushed by hydrateFromIdb()
    if(!putKey(s.key, JSON.stringify(s.get()))) ok = false;
  });
  if(!ok) alert(t('save_fail'));
}
/* Pull back anything that overflowed to IndexedDB on an earlier save, repaint,
   and release the stores that saveLocalOnly() has been holding back. Runs once,
   right after first render.

   Where the user has managed to change something in the window, **IndexedDB
   wins**. That is deliberate: their change is at most a click or two made
   against placeholder data, while the IndexedDB copy is the entire library.
   Losing the former is plainly better than losing the latter.

   The whole loop is wrapped so that a key is released whatever happens — if a
   failure could leave a store stuck in _awaitingIdb, saving would be silently
   disabled for the rest of the session, which is the very thing this is meant
   to prevent. */
async function hydrateFromIdb(){
  let changed = false;
  try{
    for(const s of STORES){
      if(!_awaitingIdb.has(s.key)) continue;            // it was in localStorage all along
      try{
        const v = await idbGet(s.key);
        if(typeof v === 'string'){ s.set(JSON.parse(v)); changed = true; }
      }catch(e){}
      finally{ _awaitingIdb.delete(s.key); }            // answered either way: saving may resume
    }
  } finally {
    _awaitingIdb.clear();                               // belt and braces — never leave saving blocked
    if(changed){ renderMenu(); renderPantry(); renderShopping(); renderCalendar(); }
    if(_saveDeferred){ _saveDeferred = false; save(); } // persist whatever was held back
  }
}
function save(...which){ saveLocalOnly(which); scheduleAutoPush(); scheduleFsPush(); }
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function byId(id){ return menu.find(m=>m.id===id); }
function dateKey(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function parseKey(k){ const [y,m,d]=k.split('-').map(Number); return new Date(y,m-1,d); }
function todayKey(){ return dateKey(new Date()); }

/* ============================================================
   LANGUAGE
   ============================================================ */
function applyTranslations(){
  document.querySelectorAll('[data-i18n]').forEach(el=>{ el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-ph]').forEach(el=>{ el.setAttribute('placeholder', t(el.dataset.i18nPh)); });
  document.querySelectorAll('[data-i18n-title]').forEach(el=>{ el.setAttribute('title', t(el.dataset.i18nTitle)); });
  document.documentElement.lang = lang;
  document.title = t('brand_title') + ' — ' + t('brand_sub');
}

function setLang(l){
  if(!I18N[l]) l = 'en';
  if(l!==lang){ lang = l; try{ localStorage.setItem(STORE.lang, l); }catch(e){} }
  renderLangPick();
  applyTranslations();
  // plain-text status lines carry no data-i18n, so drop them rather than leave
  // a sentence stranded in the previous language
  const sfb = document.getElementById('shopFeedback'); if(sfb) sfb.textContent = '';
  renderWeekdays();
  renderMenu();
  renderPantry();
  renderShopping();
  renderCalendar();
  // refresh dynamic content in any open modals
  if(document.getElementById('recipeOverlay').classList.contains('open') && currentRecipeId) openRecipe(currentRecipeId, recipeIsRandom);
  if(document.getElementById('dayOverlay').classList.contains('open') && currentDayKey) openDay(currentDayKey);
  if(document.getElementById('itemOverlay').classList.contains('open')){
    document.getElementById('itemFormTitle').textContent = t(document.getElementById('itemId').value ? 'form_edit_title' : 'form_add_title');
  }
  if(document.getElementById('pantryOverlay').classList.contains('open')){
    document.getElementById('pantryFormTitle').textContent = t(document.getElementById('pantryItemId').value ? 'p_form_edit' : 'p_form_add');
  }
}

/* ---------- language dropdown ---------- */
const langPickBtn  = document.getElementById('langPickBtn');
const langPickMenu = document.getElementById('langPickMenu');

function renderLangPick(){
  const cur = LANGS.find(l=>l.code===lang) || LANGS[0];
  langPickBtn.innerHTML = `${cur.flag('_cur')}<span>${esc(cur.label)}</span><span class="caret">▼</span>`;
  langPickMenu.innerHTML = LANGS.map(l=>
    `<button type="button" class="langpick-opt" role="option" data-lang="${l.code}" aria-selected="${l.code===lang}">
       ${l.flag('_'+l.code)}<span>${esc(l.label)}</span><span class="tick">✓</span>
     </button>`).join('');
}
function closeLangPick(){ langPickMenu.hidden = true; langPickBtn.setAttribute('aria-expanded','false'); }

langPickBtn.addEventListener('click', e=>{
  e.stopPropagation();
  const willOpen = langPickMenu.hidden;
  langPickMenu.hidden = !willOpen;
  langPickBtn.setAttribute('aria-expanded', String(willOpen));
});
langPickMenu.addEventListener('click', e=>{
  const b = e.target.closest('.langpick-opt'); if(!b) return;
  closeLangPick();
  setLang(b.dataset.lang);
});
// close when clicking anywhere else, or on Escape
document.addEventListener('click', e=>{
  if(!langPickMenu.hidden && !e.target.closest('#langPick')) closeLangPick();
});
document.addEventListener('keydown', e=>{
  if(e.key==='Escape' && !langPickMenu.hidden){ closeLangPick(); langPickBtn.focus(); }
}, true);

/* ============================================================
   UNITS  —  metric <-> imperial (best-effort conversion of quantities
   in free-text ingredients/steps/pantry). Display-only; stored data
   is never rewritten, so switching back and forth is lossless.
   ============================================================ */
/* Recipe quantities are written as fractions far more often than decimals
   ("1/2 cup", "1 1/2 tsp", "¾ cup"). Before this, the number pattern matched only
   the digits after the slash, so "1/4 in" converted to "1/10.2 cm" — mangled.
   VULGAR maps the glyph forms to plain "a/b" so one pattern handles them all. */
const VULGAR = {'¼':'1/4','½':'1/2','¾':'3/4','⅐':'1/7','⅑':'1/9','⅒':'1/10','⅓':'1/3',
  '⅔':'2/3','⅕':'1/5','⅖':'2/5','⅗':'3/5','⅘':'4/5','⅙':'1/6','⅚':'5/6','⅛':'1/8',
  '⅜':'3/8','⅝':'5/8','⅞':'7/8'};
function deVulgar(s){
  // "1½" and "1 ½" both mean one and a half — insert the space so the mixed-number branch sees it
  return String(s).replace(/(\d)?\s*([¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])/g,
    (m,d,g)=> (d ? d+' ' : '') + VULGAR[g]);
}
function num(n){
  const s = String(n).trim().replace(',','.');
  const mixed = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);      // 1 1/2
  if(mixed) return parseFloat(mixed[1]) + parseFloat(mixed[2])/parseFloat(mixed[3]);
  const frac = s.match(/^(\d+)\s*\/\s*(\d+)$/);               // 1/2
  if(frac) return parseFloat(frac[1])/parseFloat(frac[2]);
  return parseFloat(s);
}
function fmtNum(x){ return String(Math.round(x*10)/10); }
function gToImp(g){ const oz=g/28.3495; return oz>=16 ? fmtNum(oz/16)+' lb' : fmtNum(oz)+' oz'; }
function mlToImp(ml){ return ml>=240 ? fmtNum(ml/236.588)+' cups' : fmtNum(ml/29.5735)+' fl oz'; }
function ozToMetric(oz){ const g=oz*28.3495; return g>=1000 ? fmtNum(g/1000)+' kg' : Math.round(g)+' g'; }
function volImpToMetric(ml){ return ml>=1000 ? fmtNum(ml/1000)+' l' : Math.round(ml)+' ml'; }
function convUnits(str){
  let s = deVulgar(String(str==null?'':str));
  // mixed number, then bare fraction, then decimal — longest form must win
  const N = '(\\d+\\s+\\d+\\s*\\/\\s*\\d+|\\d+\\s*\\/\\s*\\d+|\\d+(?:[.,]\\d+)?)';
  if(units==='imperial'){
    s = s.replace(new RegExp(N+'\\s?°?\\s?C\\b','gi'), (m,n)=> Math.round(num(n)*9/5+32)+'°F');
    s = s.replace(new RegExp(N+'\\s?(?:kg|kilograms?)\\b','gi'), (m,n)=> gToImp(num(n)*1000));
    s = s.replace(new RegExp(N+'\\s?(?:dag|dkg)\\b','gi'), (m,n)=> gToImp(num(n)*10));
    s = s.replace(new RegExp(N+'\\s?(?:g|grams?)\\b','gi'), (m,n)=> gToImp(num(n)));
    s = s.replace(new RegExp(N+'\\s?(?:dl|deciliters?|decilitres?)\\b','gi'), (m,n)=> mlToImp(num(n)*100));
    s = s.replace(new RegExp(N+'\\s?(?:ml|milliliters?|millilitres?)\\b','gi'), (m,n)=> mlToImp(num(n)));
    s = s.replace(new RegExp(N+'\\s?(?:l|liters?|litres?)\\b','gi'), (m,n)=> mlToImp(num(n)*1000));
    s = s.replace(new RegExp(N+'\\s?(?:cm|centimeters?|centimetres?)\\b','gi'), (m,n)=> fmtNum(num(n)/2.54)+' in');
    s = s.replace(new RegExp(N+'\\s?mm\\b','gi'), (m,n)=> fmtNum(num(n)/25.4)+' in');
  } else {
    s = s.replace(new RegExp(N+'\\s?°?\\s?F\\b','gi'), (m,n)=> Math.round((num(n)-32)*5/9)+'°C');
    s = s.replace(new RegExp(N+'\\s?(?:lbs?|pounds?)\\b','gi'), (m,n)=> ozToMetric(num(n)*16));
    s = s.replace(new RegExp(N+'\\s?(?:fl\\s?oz|fluid\\s?ounces?)\\b','gi'), (m,n)=> volImpToMetric(num(n)*29.5735));
    s = s.replace(new RegExp(N+'\\s?(?:oz|ounces?)\\b','gi'), (m,n)=> ozToMetric(num(n)));
    s = s.replace(new RegExp(N+'\\s?cups?\\b','gi'), (m,n)=> volImpToMetric(num(n)*236.588));
    s = s.replace(new RegExp(N+'\\s?(?:in|inch(?:es)?)\\b','gi'), (m,n)=> fmtNum(num(n)*2.54)+' cm');
  }
  return s;
}
function unitBtnsActive(){ document.querySelectorAll('.unit').forEach(b=>b.classList.toggle('active', b.dataset.unit===units)); }
function setUnits(u){
  if(u!==units){ units=u; try{ localStorage.setItem(STORE.units, u); }catch(e){} }
  unitBtnsActive();
  renderMenu(); renderPantry(); renderShopping(); renderCalendar();
  if(document.getElementById('recipeOverlay').classList.contains('open') && currentRecipeId) openRecipe(currentRecipeId, recipeIsRandom);
}
document.getElementById('unitToggle').addEventListener('click', e=>{ const b=e.target.closest('.unit'); if(b) setUnits(b.dataset.unit); });
