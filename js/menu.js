"use strict";
/* ============================================================
   TABS
   ============================================================ */
document.querySelectorAll('.tab').forEach(tab=>{
  tab.addEventListener('click', ()=>{
    document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
    tab.classList.add('active');
    const v = tab.dataset.view;
    document.getElementById('menuView').classList.toggle('active', v==='menu');
    document.getElementById('pantryView').classList.toggle('active', v==='pantry');
    document.getElementById('shoppingView').classList.toggle('active', v==='shopping');
    document.getElementById('calendarView').classList.toggle('active', v==='calendar');
    if(v==='calendar') renderCalendar();
    if(v==='pantry') renderPantry();
    if(v==='shopping') renderShopping();
  });
});

/* ============================================================
   MENU VIEW
   ============================================================ */
const menuGrid = document.getElementById('menuGrid');
const searchInput = document.getElementById('searchInput');
const categoryFilter = document.getElementById('categoryFilter');

function categories(){ return [...new Set(menu.map(m=>m.category).filter(Boolean))].sort((a,b)=>a.localeCompare(b, LOCALE[lang])); }

function refreshCategoryControls(){
  const cats = categories();
  const cur = categoryFilter.value;
  categoryFilter.innerHTML = `<option value="">${esc(t('all_categories'))}</option>` +
    cats.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
  if(cats.includes(cur)) categoryFilter.value = cur;
  document.getElementById('catList').innerHTML = cats.map(c=>`<option value="${esc(c)}">`).join('');
}

function thumbHtml(m, override){
  const emoji = m.emoji || '🍽️';
  const src = override || mealImages(m)[0] || '';
  const img = src ? `<img src="${esc(src)}" alt="" onerror="this.style.display='none'">` : '';
  const pill = m.category ? `<span class="pill">${esc(m.category)}</span>` : '';
  return `<span class="emoji">${esc(emoji)}</span>${img}${pill}`;
}

/* ---------- favourites & last cooked ----------
   Both live on the meal: `favourite` (bool) and `lastCooked` ('YYYY-MM-DD').
   lastCooked is set by hand from the recipe view rather than inferred from the
   calendar — a meal being scheduled is not evidence it got cooked. */
let favOnly = false;
function toggleFavourite(id){
  const m = byId(id); if(!m) return;
  m.favourite = !m.favourite;
  save(STORE.menu); renderMenu();
  if(currentRecipeId === id && document.getElementById('recipeOverlay').classList.contains('open')) renderRecipeMeta(m);
}
function markCookedToday(id){
  const m = byId(id); if(!m) return;
  m.lastCooked = (m.lastCooked === todayKey()) ? '' : todayKey();   // clicking again clears it
  save(STORE.menu); renderMenu(); renderRecipeMeta(m);
}
// "today" / "yesterday" / "5 days ago", falling back to a real date once that
// stops being useful. Days are compared as calendar days, not 24h spans.
function cookedAgo(key){
  if(!key) return '';
  const then = parseKey(key), now = new Date();
  then.setHours(0,0,0,0); now.setHours(0,0,0,0);
  const days = Math.round((now - then)/86400000);
  if(days <= 0) return t('when_today');
  if(days === 1) return t('when_yesterday');
  if(days < 30)  return t('when_days', {n:days});
  try{ return then.toLocaleDateString(LOCALE[lang]||'en-GB', {day:'numeric', month:'short', year:'numeric'}); }
  catch(e){ return key; }
}

/* ---------- recipe search ----------
   Name, description and category as before, plus the ingredient list, so
   "aubergine" finds the recipe that uses it rather than only ones with it in
   the title. Two passes, in order of how obvious the match is:
     1. accent-insensitive substring, so "mush" finds "mushrooms" and "cebula"
        finds "čebula" — this is what people expect from a search box;
     2. canonical word match through the same synonym table as pantry matching,
        so "aubergine" finds "eggplant" and "eggs" finds "1 egg".
   Steps are deliberately not searched — they are prose, and matching them turns
   up recipes for reasons the user cannot see on the card.
   Returns the matching ingredient when the hit came from one, so the card can
   show why the recipe is in the results. */
function searchMeal(m, q){
  if(!q) return { hit:true };
  const fq = foldText(q);
  const has = s => foldText(s).includes(fq);
  if(has(m.name) || has(m.desc||'') || has(m.category||'')) return { hit:true };
  const ings = m.ingredients || [];
  for(const i of ings) if(has(i)) return { hit:true, ing:i };
  const qw = normWords(q);
  if(qw.length){
    for(const i of ings){
      const iw = normWords(i);
      if(qw.every(w=>iw.some(x=>wordsMatch(x,w)))) return { hit:true, ing:i };
    }
  }
  return { hit:false };
}
function renderMenu(){
  refreshCategoryControls();
  const q = searchInput.value.trim();
  const cat = categoryFilter.value;
  const hits = new Map();
  let items = menu.filter(m=>{
    if(cat && m.category!==cat) return false;
    if(favOnly && !m.favourite) return false;
    const r = searchMeal(m, q);
    if(r.hit && r.ing) hits.set(m.id, r.ing);
    return r.hit;
  });

  if(menu.length===0){
    menuGrid.innerHTML = `<div class="empty" style="grid-column:1/-1">
      <div class="big">🍽️</div><h3>${esc(t('empty_title'))}</h3>
      <p>${esc(t('empty_sub'))}</p>
      <button class="btn" onclick="openItemForm()">${esc(t('empty_btn'))}</button></div>`;
    return;
  }
  if(items.length===0){
    menuGrid.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="big">🔍</div><h3>${esc(t('nomatch_title'))}</h3><p>${esc(t('nomatch_sub'))}</p></div>`;
    return;
  }

  menuGrid.innerHTML = items.map(m=>`
    <div class="card" data-id="${m.id}">
      <div class="thumb">${thumbHtml(m)}
        <button class="fav-btn ${m.favourite?'on':''}" data-action="fav"
                title="${esc(t(m.favourite?'fav_remove':'fav_add'))}">${m.favourite?'★':'☆'}</button>
      </div>
      <div class="card-body">
        <h3>${esc(m.name)}</h3>
        ${m.desc?`<p>${esc(m.desc)}</p>`:''}
        ${hits.has(m.id)?`<div class="match-hint">🔍 ${esc(convUnits(hits.get(m.id)))}</div>`:''}
        <div class="card-meta">
          ${m.time?`<span>⏱️ ${esc(m.time)} ${esc(t('min'))}</span>`:''}
          ${m.servings?`<span>🍴 ${esc(m.servings)} ${esc(t('servings'))}</span>`:''}
          ${m.lastCooked?`<span title="${esc(m.lastCooked)}">👩‍🍳 ${esc(cookedAgo(m.lastCooked))}</span>`:''}
        </div>
        <div class="card-actions">
          <button class="icon-btn" data-action="edit">${esc(t('edit'))}</button>
          <button class="icon-btn icon-only" data-action="dup" title="${esc(t('duplicate'))}">⧉</button>
          <button class="icon-btn danger" data-action="delete">🗑 ${esc(t('delete_btn'))}</button>
        </div>
      </div>
    </div>`).join('');
}

menuGrid.addEventListener('click', e=>{
  const card = e.target.closest('.card'); if(!card) return;
  const id = card.dataset.id;
  const action = e.target.closest('[data-action]');
  if(action){
    e.stopPropagation();
    if(action.dataset.action==='edit') openItemForm(id);
    else if(action.dataset.action==='fav') toggleFavourite(id);
    else if(action.dataset.action==='dup') duplicateMeal(id);
    else if(action.dataset.action==='delete') deleteItem(id);
    return;
  }
  openRecipe(id);
});

searchInput.addEventListener('input', renderMenu);
categoryFilter.addEventListener('change', renderMenu);
document.getElementById('favFilterBtn').addEventListener('click', e=>{
  favOnly = !favOnly;
  e.currentTarget.classList.toggle('on', favOnly);
  e.currentTarget.textContent = favOnly ? '★' : '☆';
  renderMenu();
});
document.getElementById('addItemBtn').addEventListener('click', ()=>openItemForm());

/* Copies a recipe and opens the copy for editing straight away — the point of
   duplicating is to change something, so landing in the form saves a step.
   `lastCooked` and `favourite` are deliberately not carried over: the copy has
   not been cooked, and a variation has not earned a star yet. */
function duplicateMeal(id){
  const m = byId(id); if(!m) return;
  const copy = JSON.parse(JSON.stringify(m));
  copy.id = uid();
  copy.name = t('copy_of', {name:m.name});
  delete copy.lastCooked;
  delete copy.favourite;
  menu.splice(menu.indexOf(m)+1, 0, copy);      // sits next to the original
  save(STORE.menu); renderMenu();
  close(document.getElementById('recipeOverlay'));
  openItemForm(copy.id);
  const nameBox = document.getElementById('f_name');
  nameBox.focus(); nameBox.select();             // the name is the first thing you'll change
}
document.getElementById('recipeDupBtn').addEventListener('click', ()=>duplicateMeal(currentRecipeId));

async function deleteItem(id){
  const m = byId(id); if(!m) return;
  if(!await askConfirm(t('confirm_delete', {name:m.name}), t('delete_btn'))) return;
  if(!byId(id)) return;                       // gone while the dialog was open
  menu = menu.filter(x=>x.id!==id);
  save(STORE.menu); renderMenu();     // scheduled days keep the id and render as "Removed meal"
}

/* ============================================================
   ITEM FORM
   ============================================================ */
const itemOverlay = document.getElementById('itemOverlay');
let formImages = [];
/* Older meals stored a single `image`. Read through this everywhere so those
   keep working without rewriting stored data. */
function mealImages(m){
  if(m && Array.isArray(m.images) && m.images.length) return m.images;
  return (m && m.image) ? [m.image] : [];
}
/* Brings a meal from any older export up to the current shape. Reading code
   already tolerates the old form via mealImages(); this makes what gets stored
   consistent so the difference stops mattering after one import. */
function normaliseMeal(m){
  if(!m || typeof m !== 'object') return m;
  const imgs = mealImages(m);
  return Object.assign({}, m, {
    images: imgs,
    image: imgs[0] || '',
    sourceUrl: m.sourceUrl || '',
    nutrition: m.nutrition || null
  });
}

function openItemForm(id){
  const editing = id ? byId(id) : null;
  document.getElementById('itemFormTitle').textContent = editing ? t('form_edit_title') : t('form_add_title');
  document.getElementById('itemId').value = editing ? editing.id : '';
  document.getElementById('f_name').value = editing ? editing.name : '';
  document.getElementById('f_category').value = editing ? (editing.category||'') : '';
  document.getElementById('f_emoji').value = editing ? (editing.emoji||'') : '';
  document.getElementById('f_time').value = editing ? (editing.time||'') : '';
  document.getElementById('f_servings').value = editing ? (editing.servings||'') : '';
  document.getElementById('f_image').value = '';
  document.getElementById('f_source').value = editing ? (editing.sourceUrl||'') : '';
  const nut = (editing && editing.nutrition) || {};
  document.getElementById('f_kcal').value    = nut.calories || '';
  document.getElementById('f_protein').value = nut.protein  || '';
  document.getElementById('f_carbs').value   = nut.carbs    || '';
  document.getElementById('f_fat').value     = nut.fat      || '';
  formImages = editing ? mealImages(editing).slice() : [];
  renderImgStrip();
  document.getElementById('f_desc').value = editing ? (editing.desc||'') : '';
  document.getElementById('f_ingredients').value = editing ? (editing.ingredients||[]).join('\n') : '';
  document.getElementById('f_steps').value = editing ? (editing.steps||[]).join('\n') : '';
  updateImgPreview();
  refreshCategoryControls();
  document.getElementById('aiInput').value = '';
  document.getElementById('aiFillStatus').textContent = '';
  document.getElementById('aiFillStatus').className = 'ai-status';
  aiLastRecipe = null; aiFormSnapshot = null;     // a previous form's undo must not leak in
  open(itemOverlay);
  document.getElementById('f_name').focus();
}

/* ---------- photo gallery ----------
   formImages is the single source of truth while the form is open; [0] is the
   main photo. Uploads become base64 data URLs (the storage layer spills to
   IndexedDB when they outgrow localStorage), links are kept as links. */
function addFormImages(list){
  let added = 0;
  (list||[]).forEach(src=>{
    src = String(src||'').trim();
    if(!src || formImages.includes(src)) return;
    formImages.push(src); added++;
  });
  if(added) renderImgStrip();
  return added;
}
function renderImgStrip(){
  const strip = document.getElementById('imgStrip');
  strip.innerHTML = formImages.map((src,i)=>
    `<div class="img-thumb ${i===0?'primary':''}" data-i="${i}" title="${esc(t(i===0?'img_is_main':'img_make_main'))}"
          style="background-image:url('${String(src).replace(/'/g,'%27')}')">
       <span class="x" data-rm="${i}" title="${esc(t('img_remove'))}">✕</span>
     </div>`).join('');
  updateImgPreview();
}
document.getElementById('recipeGallery').addEventListener('click', e=>{
  const img = e.target.closest('img[data-i]'); if(!img) return;
  const m = byId(currentRecipeId); if(!m) return;
  const src = mealImages(m)[Number(img.dataset.i)];
  document.getElementById('recipeHero').innerHTML = thumbHtml(m, src);
  [...e.currentTarget.querySelectorAll('img')].forEach(x=>x.classList.toggle('active', x===img));
});
document.getElementById('imgStrip').addEventListener('click', e=>{
  const rm = e.target.closest('[data-rm]');
  if(rm){ formImages.splice(Number(rm.dataset.rm),1); renderImgStrip(); return; }
  const th = e.target.closest('[data-i]');
  if(th){ const i=Number(th.dataset.i); if(i>0) formImages.unshift(formImages.splice(i,1)[0]); renderImgStrip(); }
});
function updateImgPreview(){
  const url = document.getElementById('f_image').value.trim() || formImages[0] || '';
  const prev = document.getElementById('imgPreview');
  if(url){ prev.style.backgroundImage = `url("${url.replace(/"/g,'%22')}")`; prev.textContent=''; }
  else { prev.style.backgroundImage=''; prev.textContent = document.getElementById('f_emoji').value || '🖼️'; }
}
// Typing a link previews it live; Enter or leaving the box commits it to the strip.
function commitImageUrl(){
  const box = document.getElementById('f_image');
  const v = box.value.trim();
  if(v){ addFormImages([v]); box.value=''; }
  updateImgPreview();
}
document.getElementById('f_image').addEventListener('input', updateImgPreview);
document.getElementById('f_image').addEventListener('blur', commitImageUrl);
document.getElementById('f_image').addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); commitImageUrl(); } });
document.getElementById('f_emoji').addEventListener('input', updateImgPreview);

/* ---------- shrink photos before storing ----------
   A photo straight off a phone is several MB, and base64 adds ~33% on top, so
   two uploads could fill localStorage on their own. Downscaling to a long edge
   of 1600px and re-encoding as JPEG typically cuts that by 10-20x with no
   visible loss at the sizes this app displays.
   Transparent source pixels are painted onto white first — without that, PNG
   transparency turns black when it becomes a JPEG. Animated GIFs keep only
   their first frame, which is the usual trade for canvas re-encoding. */
const IMG_MAX_EDGE = 1600, IMG_QUALITY = 0.85, IMG_ALWAYS_REENCODE_OVER = 500*1024;
function downscaleDataUrl(dataUrl){
  return new Promise(res=>{
    if(!/^data:image\//i.test(dataUrl) || /^data:image\/svg/i.test(dataUrl)) return res(dataUrl);
    const img = new Image();
    img.onerror = ()=>res(dataUrl);                 // undecodable — keep what we had
    img.onload = ()=>{
      try{
        const w = img.naturalWidth, h = img.naturalHeight;
        if(!w || !h) return res(dataUrl);
        const scale = Math.min(1, IMG_MAX_EDGE/Math.max(w,h));
        // leave small, already-light images completely alone
        if(scale === 1 && dataUrl.length < IMG_ALWAYS_REENCODE_OVER) return res(dataUrl);
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(w*scale));
        c.height = Math.max(1, Math.round(h*scale));
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0,0,c.width,c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        const out = c.toDataURL('image/jpeg', IMG_QUALITY);
        // never make a file bigger than it started
        res(out.length < dataUrl.length ? out : dataUrl);
      }catch(e){ res(dataUrl); }
    };
    img.src = dataUrl;
  });
}
function readFilesAsDataUrls(files){
  const imgs = [...files].filter(f=>f.type.startsWith('image/'));
  return Promise.all(imgs.map(f=>new Promise(res=>{
    const r = new FileReader();
    r.onload  = ()=>res(r.result);
    r.onerror = ()=>res('');
    r.readAsDataURL(f);
  }))).then(list=>Promise.all(list.filter(Boolean).map(downscaleDataUrl)));
}
document.getElementById('f_file').addEventListener('change', async e=>{
  const urls = await readFilesAsDataUrls(e.target.files);
  addFormImages(urls);
  e.target.value = '';            // let the same file be picked again later
});

/* ---------- drag & drop ----------
   Two very different payloads land here: files dragged from the desktop, and an
   image dragged out of a web page. The latter arrives as text/html (an <img>
   fragment) or text/uri-list — never as a File — so both paths are handled. */
const imgDrop = document.getElementById('imgDrop');
['dragenter','dragover'].forEach(ev=>imgDrop.addEventListener(ev, e=>{
  e.preventDefault(); e.stopPropagation(); imgDrop.classList.add('dragover');
}));
['dragleave','drop'].forEach(ev=>imgDrop.addEventListener(ev, e=>{
  e.preventDefault(); e.stopPropagation();
  if(ev==='drop' || !imgDrop.contains(e.relatedTarget)) imgDrop.classList.remove('dragover');
}));
imgDrop.addEventListener('drop', async e=>{
  const dt = e.dataTransfer; if(!dt) return;
  if(dt.files && dt.files.length){
    const urls = await readFilesAsDataUrls(dt.files);
    if(addFormImages(urls)) return;
  }
  const html = dt.getData('text/html');
  if(html){
    const m = html.match(/<img[^>]+src\s*=\s*["']([^"']+)["']/i);
    if(m && addFormImages([m[1]])) return;
  }
  const text = (dt.getData('text/uri-list') || dt.getData('text/plain') || '').trim();
  // a uri-list can hold several lines; comment lines start with '#'
  const urls = text.split(/[\r\n]+/).map(s=>s.trim()).filter(s=>s && !s.startsWith('#') && /^(https?:|data:image\/)/i.test(s));
  addFormImages(urls);
});

document.getElementById('saveItemBtn').addEventListener('click', ()=>{
  const name = document.getElementById('f_name').value.trim();
  if(!name){ alert(t('need_name')); document.getElementById('f_name').focus(); return; }
  const linesOf = id => document.getElementById(id).value.split('\n').map(s=>s.trim()).filter(Boolean);
  const id = document.getElementById('itemId').value;
  commitImageUrl();                       // don't lose a link typed but not entered
  const nutrition = {
    calories: document.getElementById('f_kcal').value.trim(),
    protein:  document.getElementById('f_protein').value.trim(),
    carbs:    document.getElementById('f_carbs').value.trim(),
    fat:      document.getElementById('f_fat').value.trim()
  };
  const data = {
    name,
    category: document.getElementById('f_category').value.trim(),
    emoji: document.getElementById('f_emoji').value.trim(),
    time: document.getElementById('f_time').value.trim(),
    servings: document.getElementById('f_servings').value.trim(),
    images: formImages.slice(),
    image: formImages[0] || '',           // kept in sync for older render paths + exports
    sourceUrl: document.getElementById('f_source').value.trim(),
    nutrition: Object.values(nutrition).some(Boolean) ? nutrition : null,
    desc: document.getElementById('f_desc').value.trim(),
    ingredients: linesOf('f_ingredients'),
    steps: linesOf('f_steps')
  };
  /* The meal can go away while the form is open — another tab, or the OneDrive
     poll replacing `menu` wholesale every 20s. `Object.assign(undefined, …)`
     threw, and took everything just typed with it.
     Re-adding is the right answer rather than bailing out: the user pressed
     Save, so losing their work to a race they never saw would be the worse
     outcome. Keeping the original id also repairs any calendar days still
     pointing at it, which would otherwise read "Removed meal" forever. */
  const existing = id ? byId(id) : null;
  if(existing) Object.assign(existing, data);
  else menu.push(Object.assign({ id: id || uid() }, data));
  save(STORE.menu); renderMenu(); close(itemOverlay);
});
