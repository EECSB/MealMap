"use strict";
/* ============================================================
   CALENDAR
   ============================================================ */
const calendarGrid = document.getElementById('calendarGrid');
function renderWeekdays(){
  document.getElementById('weekdays').innerHTML = WEEKDAYS_I18N[lang].map(d=>`<div>${d}</div>`).join('');
}

function renderCalendar(){
  const year = calDate.getFullYear(), month = calDate.getMonth();
  document.getElementById('monthLabel').textContent =
    new Date(year,month,1).toLocaleDateString(LOCALE[lang],{month:'long', year:'numeric'});

  const first = new Date(year, month, 1);
  const offset = (first.getDay()+6)%7; // Monday-first
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const tKey = todayKey();
  let cells = '';
  for(let i=0;i<offset;i++) cells += `<div class="day blank"></div>`;
  for(let d=1; d<=daysInMonth; d++){
    const key = dateKey(new Date(year,month,d));
    const isToday = key===tKey;
    const items = (schedule[key]||[]);
    // data-i is the index into the *full* day list, which slice(0,3) preserves —
    // the drag needs to splice the real entry, not the position on screen.
    const chips = items.slice(0,3).map((s,idx)=>{
      const m = byId(s.mealId);
      const label = m ? m.name : t('removed_meal');
      const emoji = m && m.emoji ? m.emoji+' ' : '';
      const b = s.batchId ? batchById(s.batchId) : null;
      const left = isLeftover(s, key);
      const bits = [slotLabel(s.slot) + ': ' + label];
      if(b) bits.push(left ? t('batch_from', {date:niceDate(b.cookDate)}) : t('batch_cook_day', {n:b.portions}));
      bits.push(t('drag_to_move'));
      return `<div class="meal-chip ${s.slot}${left?' leftover':''}" data-i="${idx}" title="${esc(bits.join(' — '))}">${left?'♻ ':''}${esc(emoji)}${esc(label)}</div>`;
    }).join('');
    const more = items.length>3 ? `<div class="meal-chip" style="border-color:var(--muted);background:transparent;color:var(--muted)">${esc(t('more',{n:items.length-3}))}</div>` : '';
    cells += `<div class="day ${isToday?'today':''}" data-date="${key}">
      <span class="day-num">${d}</span>
      ${chips}${more}
      <span class="add-mini">${esc(t('add_meal_mini'))}</span>
    </div>`;
  }
  calendarGrid.innerHTML = cells;
}

/* ---------- drag a planned meal to another day ----------
   Pointer events rather than the native HTML5 drag API, because dragstart never
   fires on mobile browsers — using it would have meant the feature silently not
   existing on a phone, which is where a week's plan actually gets reshuffled.

   The two input types need opposite defaults. A mouse drag arms after 6px of
   movement, so a plain click still opens the day. A touch drag arms only after a
   300ms hold, so a swipe that starts on a chip still scrolls the calendar —
   arming on movement instead would make the month view impossible to scroll on a
   phone, since chips cover much of it. */
const DRAG = {chip:null, ghost:null, from:null, index:-1, target:null, armed:false, timer:0, pointer:null, sx:0, sy:0, offX:0, offY:0};
const DRAG_HOLD_MS = 300, DRAG_MOVE_PX = 6;
let suppressDayClick = false;

function dayUnder(x, y){
  const el = document.elementFromPoint(x, y);          // the ghost is pointer-events:none, so it never hits itself
  const day = el && el.closest('.day');
  return (day && !day.classList.contains('blank')) ? day : null;
}
function startDrag(){
  DRAG.armed = true;
  const r = DRAG.chip.getBoundingClientRect();
  DRAG.offX = DRAG.sx - r.left; DRAG.offY = DRAG.sy - r.top;
  const g = DRAG.chip.cloneNode(true);
  g.classList.add('drag-ghost');
  g.style.width = r.width + 'px';
  document.body.appendChild(g);
  DRAG.ghost = g;
  DRAG.chip.classList.add('lifted');
  document.body.classList.add('dragging-meal');
  dragTo(DRAG.sx, DRAG.sy);
}
function dragTo(x, y){
  DRAG.ghost.style.transform = `translate(${x - DRAG.offX}px, ${y - DRAG.offY}px) rotate(-2deg) scale(1.07)`;
  const day = dayUnder(x, y);
  const next = (day && day.dataset.date !== DRAG.from) ? day : null;   // dropping back home is a no-op, so don't light it
  if(next !== DRAG.target){
    if(DRAG.target) DRAG.target.classList.remove('drop-in');
    DRAG.target = next;
    if(DRAG.target) DRAG.target.classList.add('drop-in');
  }
}
function endDrag(drop){
  if(DRAG.timer){ clearTimeout(DRAG.timer); DRAG.timer = 0; }
  if(DRAG.armed){
    if(DRAG.ghost) DRAG.ghost.remove();
    if(DRAG.chip) DRAG.chip.classList.remove('lifted');
    if(DRAG.target) DRAG.target.classList.remove('drop-in');
    document.body.classList.remove('dragging-meal');
    if(drop && DRAG.target) moveScheduled(DRAG.from, DRAG.index, DRAG.target.dataset.date);
    // pointerup is followed by a click, which would open the day we dropped on.
    // The timeout clears the flag even if no click arrives, so it can never
    // swallow an unrelated one later.
    suppressDayClick = true;
    setTimeout(()=>{ suppressDayClick = false; }, 0);
  }
  DRAG.chip = DRAG.ghost = DRAG.target = DRAG.from = null;
  DRAG.index = -1; DRAG.armed = false; DRAG.pointer = null;
}
function cancelPending(){                 // a touch that moved before the hold completed
  if(DRAG.timer){ clearTimeout(DRAG.timer); DRAG.timer = 0; }
  DRAG.chip = null; DRAG.pointer = null;
}

function moveScheduled(fromKey, index, toKey){
  if(!fromKey || !toKey || fromKey === toKey) return;
  const from = schedule[fromKey];
  if(!from || !from[index]) return;
  const [item] = from.splice(index, 1);
  if(from.length === 0) delete schedule[fromKey];
  (schedule[toKey] = schedule[toKey] || []).push(item);
  // Dragging is the most repeated action in the app, so it declares exactly what
  // it touched: only a batch day can change `batches`, via a re-derived cookDate.
  const touched = [STORE.sched];
  if(item.batchId){ normaliseBatchDates(); touched.push(STORE.batches); }
  save(...touched);
  renderCalendar();
  if(document.getElementById('dayOverlay').classList.contains('open')) renderDayList();
}

calendarGrid.addEventListener('pointerdown', e=>{
  if(e.button > 0) return;                                   // left button (or any touch/pen)
  const chip = e.target.closest('.meal-chip[data-i]');
  if(!chip) return;
  const day = chip.closest('.day'); if(!day) return;
  DRAG.chip = chip; DRAG.from = day.dataset.date; DRAG.index = +chip.dataset.i;
  DRAG.sx = e.clientX; DRAG.sy = e.clientY; DRAG.pointer = e.pointerId; DRAG.armed = false;
  if(e.pointerType !== 'mouse') DRAG.timer = setTimeout(()=>{ DRAG.timer = 0; if(DRAG.chip) startDrag(); }, DRAG_HOLD_MS);
});
document.addEventListener('pointermove', e=>{
  if(!DRAG.chip || e.pointerId !== DRAG.pointer) return;
  if(DRAG.armed){ dragTo(e.clientX, e.clientY); return; }
  if(Math.hypot(e.clientX - DRAG.sx, e.clientY - DRAG.sy) <= DRAG_MOVE_PX) return;
  if(e.pointerType === 'mouse'){ DRAG.sx = e.clientX; DRAG.sy = e.clientY; startDrag(); }
  else cancelPending();                   // moved too soon: let the browser scroll instead
});
document.addEventListener('pointerup', e=>{ if(e.pointerId === DRAG.pointer) endDrag(true); });
document.addEventListener('pointercancel', e=>{ if(e.pointerId === DRAG.pointer) endDrag(false); });
// Only once armed — before that the browser must stay free to scroll the page.
document.addEventListener('touchmove', e=>{ if(DRAG.armed) e.preventDefault(); }, {passive:false});
document.addEventListener('contextmenu', e=>{ if(DRAG.armed) e.preventDefault(); });

calendarGrid.addEventListener('click', e=>{
  if(suppressDayClick) return;
  const cell = e.target.closest('.day');
  if(!cell || cell.classList.contains('blank')) return;
  openDay(cell.dataset.date);
});
document.getElementById('prevMonth').addEventListener('click', ()=>{ calDate.setMonth(calDate.getMonth()-1); renderCalendar(); });
document.getElementById('nextMonth').addEventListener('click', ()=>{ calDate.setMonth(calDate.getMonth()+1); renderCalendar(); });
document.getElementById('todayBtn').addEventListener('click', ()=>{ calDate=new Date(); renderCalendar(); });

/* ============================================================
   DAY MODAL
   ============================================================ */
function openDay(key){
  currentDayKey = key;
  document.getElementById('dayTitle').textContent =
    parseKey(key).toLocaleDateString(LOCALE[lang],{weekday:'long', month:'long', day:'numeric'});
  // Nothing is picked on open: with the meals shown as pictures, an Add button that
  // acts on a card you never chose is a mis-click waiting to happen.
  dayPickId = null;
  document.getElementById('d_search').value = '';
  renderMealPick();
  renderDayList();
  open(document.getElementById('dayOverlay'));
}

/* ---------- the meal gallery ----------
   The filter box is what the old <select> gave away for free: a native dropdown
   answers type-ahead, a grid of cards does not. It stays out of the way until
   there are enough meals for scrolling to be the slower way to find one. */
const PICK_SEARCH_FROM = 9;
let dayPickId = null;
function renderMealPick(){
  const box = document.getElementById('d_mealPick');
  const wrap = document.getElementById('d_searchWrap');
  wrap.hidden = menu.length < PICK_SEARCH_FROM;
  if(wrap.hidden) document.getElementById('d_search').value = '';
  if(menu.length===0){
    box.innerHTML = `<p class="pick-empty">${esc(t('no_meals_option'))}</p>`;
    return;
  }
  const q = document.getElementById('d_search').value.trim();
  const items = menu.filter(m=>searchMeal(m, q).hit)
    .sort((a,b)=>a.name.localeCompare(b.name, LOCALE[lang]));
  if(items.length===0){
    box.innerHTML = `<p class="pick-empty">${esc(t('nomatch_title'))}</p>`;
    return;
  }
  box.innerHTML = items.map(m=>{
    const img = mealImages(m)[0];
    return `<button type="button" class="pick-card" data-id="${esc(m.id)}" aria-pressed="${m.id===dayPickId}">
      <span class="pick-thumb">
        <span class="emoji">${esc(m.emoji||'🍽️')}</span>
        ${img?`<img src="${esc(img)}" alt="" loading="lazy" onerror="this.style.display='none'">`:''}
      </span>
      <span class="pick-body">
        <span class="pick-name">${esc(m.name)}</span>
        ${m.desc?`<span class="pick-desc">${esc(m.desc)}</span>`:''}
        ${m.time?`<span class="pick-meta">⏱️ ${esc(m.time)} ${esc(t('min'))}</span>`:''}
      </span>
    </button>`;
  }).join('');
}

function markPicked(id){          // repaints the ticks without losing the scroll or the filter
  dayPickId = id;
  document.querySelectorAll('#d_mealPick .pick-card').forEach(c=>
    c.setAttribute('aria-pressed', String(c.dataset.id === dayPickId)));
}
document.getElementById('d_mealPick').addEventListener('click', e=>{
  const card = e.target.closest('.pick-card'); if(!card) return;
  // clicking the chosen meal again clears it, so there is a way back to "nothing picked"
  markPicked(card.dataset.id === dayPickId ? null : card.dataset.id);
});
document.getElementById('d_search').addEventListener('input', renderMealPick);

function renderDayList(){
  const items = schedule[currentDayKey]||[];
  const box = document.getElementById('schedList');
  if(items.length===0){
    box.innerHTML = `<p style="color:var(--muted); text-align:center; padding:8px 0">${esc(t('no_plan'))}</p>`;
    return;
  }
  const order = {breakfast:0,lunch:1,dinner:2,snack:3};
  const sorted = items.map((s,i)=>({s,i})).sort((a,b)=>order[a.s.slot]-order[b.s.slot]);
  box.innerHTML = sorted.map(({s,i})=>{
    const m = byId(s.mealId);
    const name = m ? esc(m.name) : esc(t('removed_meal'));
    const b = s.batchId ? batchById(s.batchId) : null;
    const left = b && isLeftover(s, currentDayKey);
    const tag = b
      ? `<span class="batch-tag${left?' leftover':''}" title="${esc(left ? t('batch_from',{date:niceDate(b.cookDate)}) : t('batch_cook_day',{n:b.portions}))}">${esc(left?t('batch_leftover'):t('batch_cooked'))} ${esc(t('batch_n_of',{n:batchPortionOf(b.id,s), total:b.portions}))}</span>`
      : '';
    return `<div class="sched-item">
      <span class="slot-tag ${s.slot}">${esc(slotLabel(s.slot))}</span>
      <span class="name ${m?'':'gone'}">${name}</span>
      ${tag}
      ${b ? `<button class="del batch-del" data-batch="${esc(b.id)}" title="${esc(t('batch_remove_all'))}">🍲 ✕</button>` : ''}
      <button class="del" data-index="${i}" title="${esc(t('remove'))}">🗑</button>
    </div>`;
  }).join('');
}

document.getElementById('schedList').addEventListener('click', async e=>{
  const whole = e.target.closest('[data-batch]');
  if(whole){
    const b = batchById(whole.dataset.batch); if(!b) return;
    const m = byId(b.mealId);
    const n = batchEntries(b.id).length;
    if(!await askConfirm(t('batch_remove_confirm', {name: m ? m.name : t('removed_meal'), n}))) return;
    removeBatch(b.id);
    renderDayList();
    return;
  }
  const btn = e.target.closest('[data-index]'); if(!btn) return;
  const i = +btn.dataset.index;
  schedule[currentDayKey].splice(i,1);
  if(schedule[currentDayKey].length===0) delete schedule[currentDayKey];
  pruneBatches();          // that may have been a batch's last remaining day
  normaliseBatchDates();   // ...or its cook day, promoting the next one
  save(STORE.sched, STORE.batches);
  renderDayList(); renderCalendar();
});

document.getElementById('d_add').addEventListener('click', ()=>{
  if(menu.length===0){ alert(t('need_meal_alert')); return; }
  if(!dayPickId){ alert(t('need_pick_alert')); return; }
  addScheduled(currentDayKey, dayPickId, document.getElementById('d_slot').value);
  renderDayList();
});

document.getElementById('d_surprise').addEventListener('click', ()=>{
  if(menu.length===0){ alert(t('need_meals_random')); return; }
  const slot = document.getElementById('d_slot').value;
  const existing = (schedule[currentDayKey]||[]).map(s=>s.mealId);
  let pool = menu.filter(m=>!existing.includes(m.id));
  if(pool.length===0) pool = menu;  // all meals already on this day — allow repeats
  const pick = pool[Math.floor(Math.random()*pool.length)].id;
  addScheduled(currentDayKey, pick, slot);
  markPicked(pick);                 // tick what it landed on, so the roll is not a mystery
  renderDayList();
});

function addScheduledEntry(key, entry){
  if(!schedule[key]) schedule[key]=[];
  schedule[key].push(entry);
}
function addScheduled(key, mealId, slot){
  addScheduledEntry(key, {mealId, slot});
  save(STORE.sched); renderCalendar();
}

/* ============================================================
   BATCH COOKING  —  cook once, eat it across several days
   ------------------------------------------------------------
   A batch is {id, mealId, cookDate, portions}. It owns no dates: the days are
   ordinary schedule entries carrying a `batchId` back to the record. That means
   moving or deleting a day needs no bookkeeping beyond the entry itself, and
   there is no second list of dates that can fall out of step with the calendar.

   "Is this day a leftover?" is likewise *derived* — its date is after cookDate —
   rather than stored on the entry. A stored flag would go stale the moment a day
   got dragged across the cook date; a comparison cannot.
   ============================================================ */
function batchById(id){ return batches.find(b=>b.id===id); }
function batchEntries(id){                 // every scheduled day of a batch, oldest first
  const out = [];
  Object.keys(schedule).forEach(k=>{
    (schedule[k]||[]).forEach(s=>{ if(s.batchId===id) out.push({key:k, s}); });
  });
  return out.sort((a,b)=>a.key.localeCompare(b.key));
}
function batchPortionOf(id, entry){        // 1-based position of this day in its batch
  return batchEntries(id).findIndex(e=>e.s===entry) + 1;   // matched by identity, so two days at the same date stay distinct
}
function isLeftover(entry, key){
  const b = entry && entry.batchId && batchById(entry.batchId);
  return !!(b && key > b.cookDate);        // ISO dates sort lexicographically
}
/* The cook day is always the batch's *earliest* scheduled day — you cannot eat
   leftovers before you have cooked. Re-deriving it after every move and delete
   is what keeps that true: storing it and patching it on the cook day's own drag
   was not enough, because dragging the cook day past a leftover then left two
   days both reading as "cook day", and deleting the cook day left every
   remaining day reading as a leftover of a day that no longer existed. */
function normaliseBatchDates(){
  batches.forEach(b=>{
    const first = batchEntries(b.id)[0];
    if(first && first.key !== b.cookDate) b.cookDate = first.key;
  });
}
// Drop batch records nothing points at any more. Cheaper and more reliable than
// refcounting on every delete path, and it self-heals an imported file.
function pruneBatches(){
  const live = new Set();
  Object.values(schedule).forEach(arr=>(arr||[]).forEach(s=>{ if(s.batchId) live.add(s.batchId); }));
  const before = batches.length;
  batches = batches.filter(b=>live.has(b.id));
  return batches.length !== before;
}
function removeBatch(id){
  Object.keys(schedule).forEach(k=>{
    schedule[k] = (schedule[k]||[]).filter(s=>s.batchId !== id);
    if(schedule[k].length === 0) delete schedule[k];
  });
  batches = batches.filter(b=>b.id !== id);
  save(STORE.sched, STORE.batches); renderCalendar();
}
function createBatch(mealId, cookDate, cookSlot, days){
  const id = 'b' + uid().slice(1);
  batches.push({ id, mealId, cookDate, portions: 1 + days.length });
  addScheduledEntry(cookDate, {mealId, slot:cookSlot, batchId:id});
  days.forEach(d=>addScheduledEntry(d.date, {mealId, slot:d.slot, batchId:id}));
  save(STORE.sched, STORE.batches); renderCalendar();
  return id;
}
function niceDate(key){ return parseKey(key).toLocaleDateString(LOCALE[lang], {month:'short', day:'numeric'}); }
function shiftKey(key, n){ const d = parseKey(key); d.setDate(d.getDate()+n); return dateKey(d); }

/* ---------- the batch modal ---------- */
let batchMealId = null, batchPortions = 4;
const BATCH_MAX = 14;                       // a stepper, not a spreadsheet

function openBatchForm(mealId){
  const m = byId(mealId); if(!m) return;
  batchMealId = mealId;
  // Default to however many the recipe serves, so the common case is one click.
  const serves = Math.round(baseServings(m)) || 4;
  batchPortions = Math.min(BATCH_MAX, Math.max(2, serves));
  document.getElementById('batchMealName').textContent = (m.emoji ? m.emoji+' ' : '') + m.name;
  document.getElementById('b_date').value = todayKey();
  document.getElementById('b_slot').value = 'dinner';
  document.getElementById('b_portions').textContent = batchPortions;
  renderBatchDays(true);
  close(document.getElementById('recipeOverlay'));
  open(document.getElementById('batchOverlay'));
}

/* reset=true re-proposes every day from the cook date; otherwise rows the user
   has already edited are kept and only the tail grows or shrinks. Changing the
   cook date should move the whole run; nudging the count should not undo edits. */
function renderBatchDays(reset){
  const box = document.getElementById('batchDays');
  const n = batchPortions - 1;              // the cook day itself takes one
  const start = document.getElementById('b_date').value || todayKey();
  const slot = document.getElementById('b_slot').value;
  const prev = reset ? [] : [...box.querySelectorAll('.batch-day')]
    .map(r=>({date:r.querySelector('input').value, slot:r.querySelector('select').value}));
  if(n <= 0){
    box.innerHTML = `<p class="data-intro" style="margin:0">${esc(t('batch_no_days'))}</p>`;
    return;
  }
  const slots = ['breakfast','lunch','dinner','snack'];
  let rows = '';
  for(let i=0;i<n;i++){
    const d = prev[i] ? prev[i].date : shiftKey(start, i+1);
    const s = prev[i] ? prev[i].slot : slot;
    rows += `<div class="batch-day">
      <span class="idx">${i+2}</span>
      <input type="date" value="${esc(d)}">
      <select>${slots.map(x=>`<option value="${x}"${x===s?' selected':''}>${esc(slotLabel(x))}</option>`).join('')}</select>
    </div>`;
  }
  box.innerHTML = rows;
}

document.getElementById('recipeBatchBtn').addEventListener('click', ()=>openBatchForm(currentRecipeId));
document.getElementById('b_date').addEventListener('change', ()=>renderBatchDays(true));
document.getElementById('b_slot').addEventListener('change', ()=>renderBatchDays(true));
document.querySelectorAll('[data-batchp]').forEach(b=>b.addEventListener('click', ()=>{
  batchPortions = Math.min(BATCH_MAX, Math.max(1, batchPortions + Number(b.dataset.batchp)));
  document.getElementById('b_portions').textContent = batchPortions;
  renderBatchDays(false);
}));
document.getElementById('b_create').addEventListener('click', ()=>{
  const m = byId(batchMealId); if(!m) return;
  const cookDate = document.getElementById('b_date').value;
  if(!cookDate){ alert(t('pick_date')); return; }
  const days = [...document.querySelectorAll('#batchDays .batch-day')]
    .map(r=>({date:r.querySelector('input').value, slot:r.querySelector('select').value}))
    .filter(d=>d.date);                     // a day left blank is simply not scheduled
  createBatch(batchMealId, cookDate, document.getElementById('b_slot').value, days);
  close(document.getElementById('batchOverlay'));
  // Land on the month you just filled in. Seeing the run on the calendar is the
  // confirmation, so there is no dialog to dismiss.
  calDate = parseKey(cookDate);
  document.querySelector('.tab[data-view="calendar"]').click();
});

/* ============================================================
   MODAL plumbing
   ============================================================ */
function open(ov){ ov.classList.add('open'); document.body.style.overflow='hidden'; }
function close(ov){
  ov.classList.remove('open'); document.body.style.overflow='';
  // Escape / backdrop / ✕ all route through here, so a pending confirm must
  // settle from here too — otherwise the promise (and the caller) hangs.
  if(ov.id==='confirmOverlay') settleConfirm(false);
  // ...and cook mode must not outlive the recipe it was cooking, or the screen
  // stays locked awake against a modal that is no longer there.
  if(ov.id==='recipeOverlay') exitCookMode();
}

/* ---------- in-app confirm ----------
   Replaces window.confirm() for destructive actions. Native dialogs are not
   reliable here: once a browser shows "prevent this page from creating
   additional dialogs" and the user ticks it, every later confirm() returns
   false instantly and silently — the Delete button then does nothing at all,
   with no error to explain why. */
let _confirmResolve = null;
function settleConfirm(v){
  const r = _confirmResolve; _confirmResolve = null;
  if(r) r(v);
}
function askConfirm(message, okLabel){
  const ov = document.getElementById('confirmOverlay');
  settleConfirm(false);                       // never leave an earlier one pending
  document.getElementById('confirmText').textContent = message;
  document.getElementById('confirmYes').textContent = okLabel || t('delete_btn');
  open(ov);
  document.getElementById('confirmNo').focus();
  return new Promise(res=>{ _confirmResolve = res; });
}
document.getElementById('confirmYes').addEventListener('click', ()=>{
  const ov = document.getElementById('confirmOverlay');
  const r = _confirmResolve; _confirmResolve = null;   // take it before close() clears it
  ov.classList.remove('open'); document.body.style.overflow='';
  if(r) r(true);
});
document.getElementById('confirmNo').addEventListener('click', ()=>close(document.getElementById('confirmOverlay')));
document.querySelectorAll('.overlay').forEach(ov=>{
  /* A click event fires on the nearest common ancestor of where the button went
     down and where it came up. Select text in a field, drag past the edge of the
     dialog and let go, and that ancestor is the backdrop — so the old
     `e.target===ov` test read it as a click outside and threw the dialog away,
     taking a half-filled form with it. The press is what decides now: the
     backdrop has to be where the button went down, not merely where it came up. */
  let pressedOnBackdrop = false;
  ov.addEventListener('pointerdown', e=>{ pressedOnBackdrop = (e.target===ov); });
  ov.addEventListener('click', e=>{ if(e.target===ov && pressedOnBackdrop) close(ov); });
  ov.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click', ()=>close(ov)));
});
document.addEventListener('keydown', e=>{
  if(e.key!=='Escape') return;
  // Escape steps *out of* cook mode first rather than closing the recipe
  // outright — one key press should undo one layer, not two.
  if(cooking){ exitCookMode(); return; }
  document.querySelectorAll('.overlay.open').forEach(close);
});
