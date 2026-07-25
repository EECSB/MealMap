"use strict";
/* ============================================================
   DATA / SHARING  —  export & import (JSON + Excel)
   ============================================================ */
const dataOverlay = document.getElementById('dataOverlay');
document.getElementById('dataBtn').addEventListener('click', ()=>open(dataOverlay));

function dateStamp(){ return dateKey(new Date()); }
function downloadBlob(blob, name){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 0);
}

/* The one shape every route in and out of the app agrees on: file export, file
   sync, and both OneDrive writes. It was written out four times before, which is
   four places to forget a new store in. */
function syncPayload(){
  return { app:'kitchen-menu', version:SCHEMA_VERSION, exportedAt:new Date().toISOString(),
           menu, schedule, pantry, shopping, batches };
}
/* ...and the one way back in. Returns false for anything that is not a MealMap
   file, so callers can refuse it rather than half-applying it. */
function applyPayload(data){
  if(!data || !Array.isArray(data.menu)) return false;
  menu = data.menu.map(normaliseMeal);
  schedule = (data.schedule && typeof data.schedule==='object' && !Array.isArray(data.schedule)) ? data.schedule : {};
  if(Array.isArray(data.pantry)) pantry = data.pantry;
  if(Array.isArray(data.shopping)) shopping = data.shopping;
  // A pre-v4 file has no batches; a damaged one may have batchIds pointing at
  // records that aren't there. pruneBatches() drops records nothing references,
  // and a dangling batchId simply renders as a plain scheduled meal.
  batches = Array.isArray(data.batches) ? data.batches : [];
  pruneBatches(); normaliseBatchDates();
  return true;
}
function exportJSON(){
  downloadBlob(new Blob([JSON.stringify(syncPayload(),null,2)],{type:'application/json'}), 'mealmap-'+dateStamp()+'.json');
}
function importJSON(file){
  const reader = new FileReader();
  reader.onload = async ()=>{
    let data; try{ data = JSON.parse(reader.result); }catch(e){ alert(t('import_bad')); return; }
    if(!data || !Array.isArray(data.menu)){ alert(t('import_bad')); return; }
    // A file from a future version may carry fields this build drops on the next
    // save, so say so rather than silently discarding them.
    const v = Number(data.version) || 1;
    if(v > SCHEMA_VERSION && !await askConfirm(t('import_newer', {v:v, cur:SCHEMA_VERSION}), t('import_json'))) return;
    if(!await askConfirm(t('import_confirm'), t('import_json'))) return;
    if(!applyPayload(data)){ alert(t('import_bad')); return; }
    save(); renderMenu(); renderPantry(); renderShopping(); renderCalendar();
    close(dataOverlay);
    alert(t('import_done'));
  };
  reader.readAsText(file);
}
document.getElementById('exportJsonBtn').addEventListener('click', exportJSON);
document.getElementById('importJsonBtn').addEventListener('click', ()=>document.getElementById('importFile').click());
document.getElementById('importFile').addEventListener('change', e=>{ const f=e.target.files[0]; if(f) importJSON(f); e.target.value=''; });

function loadScript(src, ok, fail){
  // script.src always reads back as an absolute URL, so a relative `src` would
  // never match and the library would be appended again on every call. Resolving
  // first is what keeps the "already loaded" check working now that these come
  // from lib/ rather than a CDN.
  const href = new URL(src, location.href).href;
  if([...document.scripts].some(s=>s.src===href)){ ok(); return; }
  const s = document.createElement('script'); s.src=href; s.onload=ok; s.onerror=fail; document.head.appendChild(s);
}
function exportExcel(){
  loadScript('lib/xlsx.full.min.js', ()=>{
    const XLSX = window.XLSX;
    // Uploaded photos are base64 data URLs — often far past Excel's ~32k cell
    // limit — so only real links go in the sheet and uploads get a marker.
    const linkOnly = u => /^https?:\/\//i.test(u||'') ? u : (u ? '(uploaded photo)' : '');
    const meals = menu.map(m=>{
      const imgs = mealImages(m), n = m.nutrition||{};
      return {
        Name:m.name, Category:m.category||'', Emoji:m.emoji||'',
        'Prep (min)':m.time||'', Servings:m.servings||'', Description:m.desc||'',
        Ingredients:(m.ingredients||[]).join(' | '), Steps:(m.steps||[]).join(' | '),
        Image:linkOnly(imgs[0]), 'More photos':imgs.slice(1).map(linkOnly).join(' | '),
        Source:m.sourceUrl||'',
        Calories:n.calories||'', Protein:n.protein||'', Carbs:n.carbs||'', Fat:n.fat||''
      };
    });
    const rows = [];
    Object.keys(schedule).sort().forEach(d=>{
      (schedule[d]||[]).forEach(s=>{ const mm=byId(s.mealId); rows.push({Date:d, Slot:slotLabel(s.slot), Meal: mm?mm.name:t('removed_meal')}); });
    });
    const pan = pantry.map(p=>({ Name:p.name, Quantity:p.qty||'', Category:p.category||'', 'Running low':(p.low?'yes':'') }));
    const shop = shopping.map(s=>({ Item:s.name, Bought:(s.done?'yes':'') }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(meals.length?meals:[{}]), 'Meals');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(pan.length?pan:[{}]), 'Pantry');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(shop.length?shop:[{}]), 'Shopping');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length?rows:[{}]), 'Schedule');
    XLSX.writeFile(wb, 'mealmap-'+dateStamp()+'.xlsx');
  }, ()=>alert(t('excel_offline')));
}
document.getElementById('exportExcelBtn').addEventListener('click', exportExcel);

/* ============================================================
   FILE SYNC  —  keep one file up to date, wherever that file lives
   ------------------------------------------------------------
   The File System Access API lets the page hold on to a file the user picked and
   rewrite it later. Point it at a file inside a folder OneDrive, Dropbox, Drive,
   iCloud or anything else already syncs, and their desktop client does the
   syncing. So this is one code path that works with every provider at once —
   no OAuth, no app registration, no client ID in the page, nothing to re-verify
   every year, and nothing that breaks when the site moves to a new URL.

   The cost is reach: Chromium desktop only. Firefox and Safari implement the
   Origin Private File System but not the pickers, and no mobile browser has it,
   so the section hides itself rather than offering something that cannot work.

   Conflict handling is the same last-write-wins as OneDrive, and just as blunt:
   two devices editing at once means one of them loses. What makes it tolerable
   here is that the file is one document and the poll is short.
   ============================================================ */
const FS_HANDLE_KEY = 'kitchenMenu.syncFileHandle';
let fsHandle = null, fsLastSeen = 0, fsPushTimer = null, fsPollTimer = null, fsBusy = false;

function fsSupported(){ return typeof window.showSaveFilePicker === 'function'; }
function $fs(id){ return document.getElementById(id); }
function fsStatus(msg){ const el = $fs('fsStatus'); if(el) el.textContent = msg || ''; }
function fsAutoOn(){ const el = $fs('fsAuto'); return !!(el && el.checked); }
function fsStamp(){ return ' · ' + new Date().toLocaleTimeString(LOCALE[lang]); }

/* requestPermission() needs a user gesture, so it can only be asked for from a
   click. Everything on a timer passes interactive=false and quietly does nothing
   until the user comes back and presses something. */
async function fsPermitted(handle, interactive){
  if(!handle) return false;
  const opts = { mode:'readwrite' };
  try{
    if(await handle.queryPermission(opts) === 'granted') return true;
    if(!interactive) return false;
    return await handle.requestPermission(opts) === 'granted';
  }catch(e){ return false; }
}
async function fsWrite(){
  if(!await fsPermitted(fsHandle, false)) throw new Error(t('fs_permission'));
  const w = await fsHandle.createWritable();
  await w.write(JSON.stringify(syncPayload(), null, 2));
  await w.close();
  // Remember our own write, or the next poll reads it straight back as if
  // someone else had made it.
  fsLastSeen = (await fsHandle.getFile()).lastModified;
}
async function fsRead(){
  if(!await fsPermitted(fsHandle, false)) throw new Error(t('fs_permission'));
  const f = await fsHandle.getFile();
  const text = await f.text();
  let data; try{ data = JSON.parse(text); }catch(e){ throw new Error(t('import_bad')); }
  if(!applyPayload(data)) throw new Error(t('import_bad'));
  fsLastSeen = f.lastModified;
  saveLocalOnly(); renderMenu(); renderPantry(); renderShopping(); renderCalendar();
}
async function fsCheck(){
  if(!fsHandle || !fsAutoOn()) return;
  if(!await fsPermitted(fsHandle, false)) return;
  const f = await fsHandle.getFile();
  if(f.lastModified <= fsLastSeen) return;        // unchanged, or it was our own write
  await fsRead();
  fsStatus('⬇ ' + t('fs_loaded', {name:fsHandle.name}) + fsStamp());
}
async function fsRun(fn){
  if(fsBusy) return;
  fsBusy = true;
  try{ await fn(); }
  catch(e){ if(e && e.name !== 'AbortError') fsStatus('⚠ ' + (e && e.message || e)); }  // AbortError = picker dismissed
  finally{ fsBusy = false; }
}
function fsStartPolling(){
  fsStopPolling();
  if(fsAutoOn() && fsHandle) fsPollTimer = setInterval(()=>fsRun(fsCheck), 10000);
}
function fsStopPolling(){ if(fsPollTimer){ clearInterval(fsPollTimer); fsPollTimer = null; } }
function scheduleFsPush(){
  if(!fsHandle || !fsAutoOn()) return;
  clearTimeout(fsPushTimer);
  fsPushTimer = setTimeout(()=>fsRun(async ()=>{
    await fsWrite();
    fsStatus('⬆ ' + t('fs_saved', {name:fsHandle.name}) + fsStamp());
  }), 1500);
}
function fsReflect(){
  const linked = !!fsHandle;
  ['fsLoad','fsSave','fsForget'].forEach(id=>{ const b = $fs(id); if(b) b.disabled = !linked; });
}

if(fsSupported()){
  $fs('fsPick').addEventListener('click', ()=>fsRun(async ()=>{
    const handle = await window.showSaveFilePicker({
      suggestedName: 'mealmap.json',
      types: [{ description:'MealMap', accept:{ 'application/json':['.json'] } }]
    });
    fsHandle = handle;
    try{ await idbSet(FS_HANDLE_KEY, handle); }catch(e){}
    odSaveLS(STORE.fsName, handle.name);
    fsReflect();
    /* A file that already holds a plan is somebody's data — very likely the
       other half of the household. Overwriting it the instant it is picked
       would be the worst possible first impression, so say what is in it and
       let them choose which direction to go. */
    let existing = null;
    try{
      const f = await handle.getFile();
      if(f.size) existing = JSON.parse(await f.text());
    }catch(e){}
    if(existing && Array.isArray(existing.menu) && existing.menu.length){
      fsLastSeen = 0;
      fsStatus(t('fs_has_data', {name:handle.name, n:existing.menu.length}));
    } else {
      await fsWrite();
      fsStatus(t('fs_linked', {name:handle.name}));
    }
    fsStartPolling();
  }));
  $fs('fsSave').addEventListener('click', ()=>fsRun(async ()=>{
    if(!fsHandle) return fsStatus(t('fs_need_file'));
    if(!await fsPermitted(fsHandle, true)) return fsStatus(t('fs_permission'));
    await fsWrite();
    fsStatus('⬆ ' + t('fs_saved', {name:fsHandle.name}) + fsStamp());
  }));
  $fs('fsLoad').addEventListener('click', ()=>fsRun(async ()=>{
    if(!fsHandle) return fsStatus(t('fs_need_file'));
    if(!await fsPermitted(fsHandle, true)) return fsStatus(t('fs_permission'));
    if(!await askConfirm(t('fs_load_confirm', {name:fsHandle.name}), t('fs_load'))) return;
    await fsRead();
    fsStatus('⬇ ' + t('fs_loaded', {name:fsHandle.name}) + fsStamp());
  }));
  $fs('fsForget').addEventListener('click', ()=>fsRun(async ()=>{
    fsHandle = null; fsLastSeen = 0;
    fsStopPolling();
    try{ await idbDel(FS_HANDLE_KEY); }catch(e){}
    odSaveLS(STORE.fsName, '');
    fsReflect();
    fsStatus(t('fs_unlinked'));
  }));
  $fs('fsAuto').addEventListener('change', ()=>{
    odSaveLS(STORE.fsAuto, fsAutoOn() ? '1' : '0');
    fsAutoOn() ? fsStartPolling() : fsStopPolling();
  });
  $fs('fsAuto').checked = odLS(STORE.fsAuto) === '1';
  // The handle survives a reload, but the permission granted with it may not —
  // so this restores the link and leaves re-granting to the next click.
  (async ()=>{
    try{ fsHandle = (await idbGet(FS_HANDLE_KEY)) || null; }catch(e){ fsHandle = null; }
    fsReflect();
    if(fsHandle){
      fsStatus(t(await fsPermitted(fsHandle, false) ? 'fs_linked' : 'fs_permission', {name:fsHandle.name}));
      fsStartPolling();
    }
  })();
} else {
  // Nothing here can work — say why, and point at what does.
  const note = $fs('fsUnsupported'); if(note) note.hidden = false;
  const acts = $fs('fsActions');     if(acts) acts.hidden = true;
  const auto = $fs('fsAutoLabel');   if(auto) auto.hidden = true;
}

/* ============================================================
   ONEDRIVE LIVE SYNC  (Microsoft Graph + MSAL, loaded on demand)
   Requires the app hosted at a URL + an Azure app (client) ID.
   See docs/ONEDRIVE-SETUP.md in the repo. Manual export/import always works as a fallback.
   ============================================================ */
const OD = {
  scopes:['Files.ReadWrite.All','User.Read'],
  authority:'https://login.microsoftonline.com/common',
  graph:'https://graph.microsoft.com/v1.0',
  // Served from lib/, not a CDN: a host with a strict Content-Security-Policy
  // would block the CDN and sign-in would fail with nothing to explain it.
  msalSrc:'lib/msal-browser.min.js'
};
let msalApp=null, odAccount=null, odItem=null, odPollTimer=null, odPushTimer=null, odBusy=false;

const $od = id => document.getElementById(id);
function odLS(k){ try{ return localStorage.getItem(k)||''; }catch(e){ return ''; } }
function odSaveLS(k,v){ try{ localStorage.setItem(k,v); }catch(e){} }
function odClientId(){ return $od('odClientId').value.trim(); }
function odAutoOn(){ return $od('odAuto').checked; }
function odStatus(msg){ $od('odStatus').textContent = msg||''; }

async function ensureMsal(){
  if(msalApp) return msalApp;
  const cid = odClientId();
  if(!cid) throw new Error(t('od_need_client'));
  await new Promise((res,rej)=>loadScript(OD.msalSrc, res, ()=>rej(new Error('Could not load the Microsoft sign-in library — check that lib/msal-browser.min.js was uploaded.'))));
  msalApp = new msal.PublicClientApplication({
    auth:{ clientId:cid, authority:OD.authority, redirectUri: location.origin + location.pathname },
    cache:{ cacheLocation:'localStorage' }
  });
  await msalApp.initialize();
  const accts = msalApp.getAllAccounts();
  if(accts.length) odAccount = accts[0];
  return msalApp;
}
async function odToken(){
  const app = await ensureMsal();
  if(!odAccount){ const r = await app.loginPopup({scopes:OD.scopes}); odAccount = r.account; }
  try{ return (await app.acquireTokenSilent({scopes:OD.scopes, account:odAccount})).accessToken; }
  catch(e){ const r = await app.acquireTokenPopup({scopes:OD.scopes}); odAccount=r.account; return r.accessToken; }
}
async function graph(path, opts){
  const token = await odToken();
  const r = await fetch(OD.graph+path, Object.assign({}, opts||{}, {
    headers: Object.assign({Authorization:'Bearer '+token}, (opts&&opts.headers)||{})
  }));
  if(!r.ok) throw new Error('Graph '+r.status+': '+(await r.text()).slice(0,160));
  return r;
}
function encodeShare(url){
  const b = btoa(unescape(encodeURIComponent(url)));
  return 'u!' + b.replace(/=+$/,'').replace(/\//g,'_').replace(/\+/g,'-');
}
async function odResolve(){
  const share = $od('odShareUrl').value.trim();
  if(share){
    const it = await (await graph('/shares/'+encodeShare(share)+'/driveItem?$select=id,parentReference')).json();
    odItem = { driveId: it.parentReference.driveId, itemId: it.id };
  } else {
    odItem = { ownPath:true };
  }
  return odItem;
}
function odContentPath(){
  return odItem.itemId ? '/drives/'+odItem.driveId+'/items/'+odItem.itemId+'/content'
                       : '/me/drive/root:/KitchenMenu/kitchen-menu.json:/content';
}
async function odPull(){
  await odResolve();
  const data = await (await graph(odContentPath())).json();
  if(!applyPayload(data)) throw new Error(t('import_bad'));
  saveLocalOnly(); renderMenu(); renderPantry(); renderShopping(); renderCalendar();
  odStatus('⬇ '+t('od_pulled')+' · '+new Date().toLocaleTimeString(LOCALE[lang]));
}
async function odPush(){
  await odResolve();
  const body = JSON.stringify(syncPayload(), null, 2);
  await graph(odContentPath(), {method:'PUT', headers:{'Content-Type':'application/json'}, body});
  odStatus('⬆ '+t('od_pushed')+' · '+new Date().toLocaleTimeString(LOCALE[lang]));
}
async function odSetupSharedFile(){
  await odToken();
  const body = JSON.stringify(syncPayload(), null, 2);
  const item = await (await graph('/me/drive/root:/KitchenMenu/kitchen-menu.json:/content', {method:'PUT', headers:{'Content-Type':'application/json'}, body})).json();
  const link = await (await graph('/me/drive/items/'+item.id+'/createLink', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({type:'edit', scope:'anonymous'})})).json();
  const url = link.link.webUrl;
  $od('odShareUrl').value = url; odSaveLS(STORE.odShare, url);
  odItem = { driveId:item.parentReference.driveId, itemId:item.id };
  odStatus('🔗 '+t('od_setup_done'));
}
function scheduleAutoPush(){
  if(!odAutoOn() || !odAccount) return;
  clearTimeout(odPushTimer);
  odPushTimer = setTimeout(()=>odPush().catch(e=>odStatus('⚠ '+e.message)), 1500);
}
function odStartPolling(){
  odStopPolling();
  if(odAutoOn() && odAccount) odPollTimer = setInterval(()=>odPull().catch(()=>{}), 20000);
}
function odStopPolling(){ if(odPollTimer){ clearInterval(odPollTimer); odPollTimer=null; } }

async function odRun(fn){
  if(odBusy) return; odBusy=true; odStatus('…');
  try{ await fn(); }
  catch(e){ odStatus('⚠ '+(e&&e.message||e)); }
  finally{ odBusy=false; }
}
$od('odConnect').addEventListener('click', ()=>odRun(async ()=>{
  await odToken();
  odSaveLS(STORE.odClient, odClientId());
  odStatus('✓ '+t('od_connected', {name:(odAccount&&(odAccount.username||odAccount.name))||''}));
  odStartPolling();
  try{ await odPull(); }catch(e){ /* member without a link yet, or no file — that's fine */ }
}));
$od('odSetup').addEventListener('click', ()=>odRun(odSetupSharedFile));
$od('odPull').addEventListener('click', ()=>odRun(odPull));
$od('odPush').addEventListener('click', ()=>odRun(odPush));
$od('odClientId').addEventListener('change', ()=>odSaveLS(STORE.odClient, odClientId()));
$od('odShareUrl').addEventListener('change', ()=>odSaveLS(STORE.odShare, $od('odShareUrl').value.trim()));
$od('odAuto').addEventListener('change', ()=>{ odSaveLS(STORE.odAuto, odAutoOn()?'1':'0'); odAutoOn()?odStartPolling():odStopPolling(); });
// warm the sign-in library when the Data panel opens (so the sign-in popup isn't blocked)
document.getElementById('dataBtn').addEventListener('click', ()=>{ if(odLS(STORE.odClient)) loadScript(OD.msalSrc, ()=>{}, ()=>{}); });
// restore saved OneDrive settings
$od('odClientId').value = odLS(STORE.odClient);
$od('odShareUrl').value = odLS(STORE.odShare);
$od('odAuto').checked = odLS(STORE.odAuto)==='1';
