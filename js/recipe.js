"use strict";
/* ============================================================
   RECIPE VIEW
   ============================================================ */
/* ---------- servings scaling ----------
   Cooking for 6 when the recipe says 4. Only the recipe view changes — the
   stored recipe is never rewritten, so this is as lossless as the unit toggle.
   Reuses the quantity parser built for combining shopping lines. */
let recipeServings = null;                 // null = show it as written
function baseServings(m){ const n = parseFloat(String((m&&m.servings)||'').replace(',','.')); return (isFinite(n) && n>0) ? n : 0; }
function scaleIngredient(line, factor){
  if(factor === 1) return line;
  const p = parseQty(line);
  if(!p) return line;                      // "Salt to taste" has nothing to scale
  let q = { qty:p.qty*factor, unit:p.unit };
  // convert into the family's base unit so 500 g x3 can come back as 1.5 kg
  const fam = SUM_UNITS[q.unit];
  if(fam) q = tidyQty({ qty:q.qty*fam.f, unit:fam.base });
  // Keep the line's own word unless the family changed under it (g -> kg), so
  // doubling "2 žlici olja" gives "4 žlici olja" and not "4 tbsp olja".
  const unit = (p.unitText && q.unit === p.unit) ? p.unitText : pluralUnit(q.unit, q.qty);
  return (fmtQty(q.qty) + (unit ? ' ' + unit : '') + ' ' + p.rest).trim();
}
function renderRecipeMeta(m){
  const meta = [];
  if(m.category) meta.push(`<span>🏷️ <b>${esc(m.category)}</b></span>`);
  if(m.time) meta.push(`<span>⏱️ <b>${esc(m.time)} ${esc(t('min'))}</b></span>`);
  const base = baseServings(m);
  if(base){
    const cur = recipeServings || base;
    meta.push(`<span class="serv-step">🍴
      <button type="button" class="serv-btn" data-serv="-1" title="${esc(t('serv_less'))}">−</button>
      <b>${esc(fmtQty(cur))}</b> ${esc(t('servings'))}
      <button type="button" class="serv-btn" data-serv="1" title="${esc(t('serv_more'))}">+</button>` +
      (cur !== base ? ` <button type="button" class="linkbtn" data-serv="reset">${esc(t('serv_reset',{n:fmtQty(base)}))}</button>` : '') +
    `</span>`);
  } else if(m.servings){
    meta.push(`<span>🍴 <b>${esc(m.servings)} ${esc(t('servings'))}</b></span>`);
  }
  meta.push(`<button type="button" class="meta-btn ${m.favourite?'on':''}" data-meta="fav"
    title="${esc(t(m.favourite?'fav_remove':'fav_add'))}">${m.favourite?'★':'☆'}</button>`);
  meta.push(m.lastCooked
    ? `<button type="button" class="meta-btn on" data-meta="cooked" title="${esc(t('cooked_clear'))}">👩‍🍳 ${esc(t('last_cooked',{when:cookedAgo(m.lastCooked)}))}</button>`
    : `<button type="button" class="meta-btn" data-meta="cooked">👩‍🍳 ${esc(t('cooked_mark'))}</button>`);
  document.getElementById('recipeMeta').innerHTML = meta.join('');
}
function renderRecipeIngredients(m){
  const base = baseServings(m);
  const factor = (base && recipeServings) ? recipeServings/base : 1;
  const ing = m.ingredients||[];
  document.getElementById('recipeIngredients').innerHTML = ing.length
    // pantry match uses the original line — scaling changes only the number.
    // .tickable wraps the text alone: the pantry badge stays its own flex item
    // (so the gap survives) and never gets struck through in cook mode.
    ? ing.map(i=>`<li><span class="tickable">${esc(convUnits(scaleIngredient(i, factor)))}</span>${inPantry(i)?`<span class="ing-have">✓ ${esc(t('in_pantry'))}</span>`:''}</li>`).join('')
    : `<li style="color:var(--muted)">${esc(t('no_ingredients'))}</li>`;
}
document.getElementById('recipeMeta').addEventListener('click', e=>{
  const meta = e.target.closest('[data-meta]');
  if(meta){
    if(meta.dataset.meta === 'fav') toggleFavourite(currentRecipeId);
    else markCookedToday(currentRecipeId);
    return;
  }
  const b = e.target.closest('[data-serv]'); if(!b) return;
  const m = byId(currentRecipeId); if(!m) return;
  const base = baseServings(m); if(!base) return;
  if(b.dataset.serv === 'reset') recipeServings = null;
  else {
    const step = base < 4 ? 1 : Math.max(1, Math.round(base/4));   // scale the step to the recipe
    recipeServings = Math.min(200, Math.max(1, (recipeServings||base) + Number(b.dataset.serv)*step));
    if(recipeServings === base) recipeServings = null;
  }
  renderRecipeMeta(m); renderRecipeIngredients(m);
});

function openRecipe(id, isRandom){
  const m = byId(id); if(!m) return;
  if(id !== currentRecipeId) recipeServings = null;   // keep the scale when re-rendering the same recipe
  currentRecipeId = id;
  document.getElementById('recipeTitle').textContent = m.name;
  document.getElementById('recipeHero').innerHTML = thumbHtml(m);
  renderRecipeMeta(m);
  const desc = document.getElementById('recipeDesc');
  desc.textContent = m.desc||''; desc.style.display = m.desc?'block':'none';

  const nut = m.nutrition || {};
  const nutBits = [
    [nut.calories, '🔥', t('nut_calories')], [nut.protein, '🥩', t('nut_protein')],
    [nut.carbs,    '🌾', t('nut_carbs')],    [nut.fat,     '🧈', t('nut_fat')]
  ].filter(b=>b[0]);
  document.getElementById('recipeNutrition').innerHTML =
    nutBits.map(([v,icon,label])=>`<span>${icon} ${esc(label)} <b>${esc(v)}</b></span>`).join('');

  // Gallery: clicking a thumb swaps the hero, so the stored order is untouched.
  const imgs = mealImages(m);
  const gal = document.getElementById('recipeGallery');
  gal.innerHTML = imgs.length > 1
    ? imgs.map((src,i)=>`<img src="${esc(src)}" alt="" class="${i===0?'active':''}" data-i="${i}" onerror="this.remove()">`).join('')
    : '';

  const srcLink = document.getElementById('recipeSource');
  if(m.sourceUrl && /^https?:/i.test(m.sourceUrl)){
    srcLink.href = m.sourceUrl;
    srcLink.textContent = '🔗 ' + t('view_source');
    srcLink.hidden = false;
  } else { srcLink.hidden = true; srcLink.removeAttribute('href'); }

  renderRecipeIngredients(m);
  const steps = m.steps||[];
  document.getElementById('recipeSteps').innerHTML = steps.length
    ? steps.map(s=>`<li><span class="tickable">${esc(convUnits(s))}</span></li>`).join('')
    : `<li style="color:var(--muted)">${esc(t('no_instructions'))}</li>`;

  document.getElementById('r_date').value = todayKey();
  document.getElementById('r_feedback').textContent='';
  recipeIsRandom = !!isRandom;
  document.getElementById('rerollBtn').style.display = recipeIsRandom ? 'inline-flex' : 'none';
  renderCookHint();   // a language switch re-runs openRecipe; the hint is set from JS, not data-i18n
  open(document.getElementById('recipeOverlay'));
}

document.getElementById('recipeEditBtn').addEventListener('click', ()=>{
  const id = currentRecipeId;
  close(document.getElementById('recipeOverlay'));
  openItemForm(id);
});

/* ---------- cook mode ----------
   The recipe you already have open, full-screen and stripped to the two things
   you use with your hands busy: the ingredients and the steps. It restyles the
   same DOM instead of rendering a second copy, so whatever servings scale and
   unit toggle you set beforehand carry straight over and can still be changed
   mid-cook — there is no parallel view to drift out of sync.
   The screen is held awake, because the usual way a recipe vanishes halfway
   through is the phone locking with batter on your hands. */
let cooking = false, wakeLock = null;

async function holdScreenAwake(){
  if(!('wakeLock' in navigator) || wakeLock) return;
  // Rejects on an unsupported browser (Safari, mainly), a hidden tab, or low
  // battery. None of those are worth interrupting the cook over, so it fails
  // quietly and the hint just doesn't promise a lock we don't have.
  try{
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', ()=>{ wakeLock = null; });
  }catch(e){ wakeLock = null; }
}
function releaseScreen(){
  if(!wakeLock) return;
  wakeLock.release().catch(()=>{});
  wakeLock = null;
}
// The lock is dropped by the browser whenever the tab is hidden, and is not
// given back on return — so it has to be retaken by hand.
document.addEventListener('visibilitychange', ()=>{
  if(cooking && document.visibilityState === 'visible') holdScreenAwake().then(renderCookHint);
});

function renderCookHint(){
  document.getElementById('cookHint').textContent =
    t('cook_hint') + (wakeLock ? ' · ☀ ' + t('cook_awake') : '');
}
function enterCookMode(){
  if(!currentRecipeId) return;
  cooking = true;
  document.body.classList.add('cooking');
  document.getElementById('recipeOverlay').scrollTop = 0;
  renderCookHint();
  holdScreenAwake().then(renderCookHint);   // the hint firms up once we know
}
function exitCookMode(){
  if(!cooking) return;
  cooking = false;
  document.body.classList.remove('cooking');
  clearTicks();
  releaseScreen();
}
function clearTicks(){
  document.querySelectorAll('#recipeIngredients .ticked, #recipeSteps .ticked')
    .forEach(li=>li.classList.remove('ticked'));
}

document.getElementById('recipeCookBtn').addEventListener('click', enterCookMode);
document.getElementById('recipeCookExit').addEventListener('click', exitCookMode);
document.getElementById('recipePrintBtn').addEventListener('click', ()=>window.print());

/* Tick a line off as you go. Deliberately not saved: a half-finished cook is
   not state anyone wants restored three days later, and re-rendering (a
   servings change, a unit switch) clears it for the same reason. */
['recipeIngredients','recipeSteps'].forEach(id=>{
  document.getElementById(id).addEventListener('click', e=>{
    if(!cooking) return;
    const li = e.target.closest('li');
    if(li && li.querySelector('.tickable')) li.classList.toggle('ticked');
  });
});
document.getElementById('r_schedule').addEventListener('click', ()=>{
  const date = document.getElementById('r_date').value;
  const slot = document.getElementById('r_slot').value;
  if(!date){ document.getElementById('r_feedback').textContent=t('pick_date'); return; }
  addScheduled(date, currentRecipeId, slot);
  const m = byId(currentRecipeId);
  const dateStr = parseKey(date).toLocaleDateString(LOCALE[lang],{weekday:'long', month:'long', day:'numeric'});
  document.getElementById('r_feedback').textContent = t('sched_feedback', {name:m.name, slot:slotLabel(slot), date:dateStr});
});

/* random suggestion — pick a random meal (avoid repeating the current one) */
function pickRandom(excludeId){
  let pool = menu;
  if(excludeId && menu.length>1) pool = menu.filter(m=>m.id!==excludeId);
  return pool[Math.floor(Math.random()*pool.length)].id;
}
function surpriseMe(){
  if(menu.length===0){ alert(t('need_meals_random')); return; }
  openRecipe(pickRandom(currentRecipeId), true);
}
document.getElementById('randomBtn').addEventListener('click', surpriseMe);
document.getElementById('rerollBtn').addEventListener('click', surpriseMe);
