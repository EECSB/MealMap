"use strict";
/* ============================================================
   AI ASSISTANT  —  auto-fill a meal from pasted text or a link.
   Key is stored only in this browser and sent directly to the provider;
   it is NOT included in export/import or OneDrive sync.
   ============================================================ */
const AI = {
  anthropic:{ url:'https://api.anthropic.com/v1/messages', defModel:'claude-opus-5' },
  openai:{ url:'https://api.openai.com/v1/chat/completions', defModel:'gpt-4o-mini' },
  // Gemini takes the model in the path: <url><model>:generateContent
  gemini:{ url:'https://generativelanguage.googleapis.com/v1beta/models/', defModel:'gemini-3.6-flash' }
};
// Models known to accept output_config.effort. Sending it to a model that does
// not support it is a 400, and the Model box is free text — so opt in only for
// IDs we recognise and silently omit it for anything the user types in.
const AI_EFFORT_OK = new Set(['claude-opus-5','claude-opus-4-8','claude-opus-4-7','claude-sonnet-5','claude-fable-5']);
const AI_SYS_BASE = "You extract a single recipe from the text the user provides and return ONLY a JSON object — no markdown, no code fences, no commentary. "
  + "Shape: {\"name\":string,\"category\":string,\"emoji\":string,\"time\":number|null,\"servings\":number|null,\"desc\":string,\"ingredients\":string[],\"steps\":string[],"
  + "\"image\":string|null,\"images\":string[],\"sourceUrl\":string|null,"
  + "\"nutrition\":{\"calories\":string|null,\"protein\":string|null,\"carbs\":string|null,\"fat\":string|null}|null}. "
  + "'image' = absolute URL of the main photo of the finished dish if the text contains one (markdown images look like ![alt](url)); prefer a large content image over a logo, icon, avatar, banner or ad. 'images' = up to 5 further absolute photo URLs of the dish, main one first, [] if none. "
  + "'sourceUrl' = the canonical URL of the recipe page if present, else null. "
  + "'nutrition' = per serving, only if the text actually states it — never estimate or invent it; use null for any value that is not given, and null for the whole object if none is given. Keep each value with its unit, e.g. \"320 kcal\", \"12 g\". "
  + "'time' = total minutes as an integer or null. 'servings' = integer or null. "
  + "'emoji' = one food emoji fitting the dish. 'category' = a short label (Breakfast, Main, Dessert, Side, Soup, Drink). 'desc' = one short sentence. "
  + "Each ingredient includes its quantity. 'steps' are clear ordered instructions. Unknown fields use null or []. Output JSON only. ";

const AI_LANG = { en:'English', sl:'Slovenian', es:'Spanish', fr:'French', de:'German', it:'Italian', pt:'Portuguese' };
/* The recipe is written into the app in whatever language the app is set to, not
   the language of the page it came from. The prompt used to say the opposite
   ("keep the recipe in its ORIGINAL language"), which predated the five extra
   languages and was wrong for two reasons: someone picks a language and stays in
   it, and — the part that actually breaks things — ingredient matching compares
   a recipe against a pantry written in that same language. A Slovenian pantry
   cannot cover an English ingredient list, so an untranslated import silently
   loses every ✓ in pantry badge and its whole contribution to the shopping list.
   Numbers and units are deliberately left alone; convUnits() converts them to
   the unit preference after parsing. */
function aiSystemPrompt(){
  const name = AI_LANG[lang] || AI_LANG.en;
  return AI_SYS_BASE
    + "Write every human-readable field — name, category, desc, ingredients and steps — in " + name
    + ", translating from the source text where it is in another language. Use the ordinary " + name
    + " names for ingredients, as they would be written on a shopping list. "
    + "Leave numbers, quantities, units and URLs exactly as the source gives them.";
}

/* max_tokens caps thinking AND response text together. Claude Opus 5 thinks by
   default when the `thinking` field is omitted (Opus 4.8 did not), so the old
   1500 could be spent reasoning and truncate the recipe JSON mid-object — which
   surfaces only as "could not read the recipe". 8000 leaves room; you are billed
   for tokens generated, not for the ceiling. Effort is dropped to `low` where
   supported: this is extraction, not reasoning. */
function anthropicBody(model, userText){
  const body = { model, max_tokens:8000, system:aiSystemPrompt(), messages:[{role:'user', content:userText}] };
  if(AI_EFFORT_OK.has(model)) body.output_config = { effort:'low' };
  return body;
}
function aiProviderVal(){ const v = odLS(STORE.aiProvider); return (v==='openai'||v==='gemini') ? v : 'anthropic'; }
/* The box wins over storage, and it matters.
   The field is type=password, so a browser password manager will fill it — and
   a saved password outlives "clear site data" and syncs between devices, while
   localStorage does neither. Reading only storage meant the box could show a
   key the app insisted it did not have: "Add your AI API key first" printed
   directly beneath a box full of dots, with nothing the user could do about it
   short of retyping. Whatever is visible is now what gets used. Storage is
   still where it persists, and is the fallback for a box not yet filled in. */
function aiKeyVal(){
  const box = $od('aiKey');
  return (box && box.value.trim()) || odLS(STORE.aiKey);
}
function aiModelVal(){ return odLS(STORE.aiModel).trim() || AI[aiProviderVal()].defModel; }

async function aiChat(userText){
  const provider = aiProviderVal(), key = aiKeyVal(), model = aiModelVal();
  if(!key) throw new Error(t('ai_need_key'));
  if(provider==='anthropic'){
    const r = await fetch(AI.anthropic.url, { method:'POST', headers:{
      'content-type':'application/json', 'x-api-key':key,
      'anthropic-version':'2023-06-01', 'anthropic-dangerous-direct-browser-access':'true'
    }, body: JSON.stringify(anthropicBody(model, userText)) });
    if(!r.ok) throw new Error('Claude '+r.status+': '+(await r.text()).slice(0,160));
    const d = await r.json();
    if(d.stop_reason==='refusal') throw new Error(t('ai_bad'));
    return (d.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('');
  } else if(provider==='gemini'){
    // Key goes in the x-goog-api-key header, not the ?key= query parameter the
    // quickstart shows — a key in the URL leaks into logs, history and referrers.
    const r = await fetch(AI.gemini.url + encodeURIComponent(model) + ':generateContent', { method:'POST', headers:{
      'content-type':'application/json', 'x-goog-api-key':key
    }, body: JSON.stringify({
      contents:[{ role:'user', parts:[{text:userText}] }],
      systemInstruction:{ parts:[{text:aiSystemPrompt()}] },
      // responseMimeType forces valid JSON, so no code fences to strip
      generationConfig:{ responseMimeType:'application/json', temperature:0, maxOutputTokens:8000 }
    }) });
    if(!r.ok) throw new Error('Gemini '+r.status+': '+(await r.text()).slice(0,160));
    const d = await r.json();
    if(d.promptFeedback && d.promptFeedback.blockReason) throw new Error(t('ai_bad'));
    const cand = (d.candidates||[])[0];
    if(!cand) throw new Error(t('ai_bad'));
    return (((cand.content||{}).parts)||[]).map(p=>p.text||'').join('');
  } else {
    const r = await fetch(AI.openai.url, { method:'POST', headers:{
      'content-type':'application/json', 'authorization':'Bearer '+key
    }, body: JSON.stringify({ model, temperature:0, response_format:{type:'json_object'}, messages:[{role:'system',content:aiSystemPrompt()},{role:'user',content:userText}] }) });
    if(!r.ok) throw new Error('OpenAI '+r.status+': '+(await r.text()).slice(0,160));
    const d = await r.json();
    return (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '';
  }
}
function parseRecipeJSON(text){
  let s = String(text||'').trim().replace(/^```(json)?/i,'').replace(/```\s*$/,'').trim();
  const a=s.indexOf('{'), b=s.lastIndexOf('}');
  if(a>=0 && b>a) s = s.slice(a,b+1);
  return JSON.parse(s);
}
function isUrl(s){ return /^https?:\/\/\S+$/i.test((s||'').trim()); }
async function fetchUrlText(url){
  const r = await fetch('https://r.jina.ai/'+url);
  if(!r.ok) throw new Error('Fetch '+r.status);
  return (await r.text()).slice(0,14000);
}
/* Every field auto-fill can write, and the label to name it by if it is kept.
   All labels are keys that already exist. */
const AI_FIELDS = {
  f_name:'f_name', f_category:'f_category', f_emoji:'f_emoji', f_time:'f_time',
  f_servings:'f_servings', f_desc:'f_desc', f_ingredients:'f_ingredients',
  f_steps:'f_steps', f_source:'f_source',
  f_kcal:'nut_calories', f_protein:'nut_protein', f_carbs:'nut_carbs', f_fat:'nut_fat'
};
function snapshotItemForm(){
  const s = { images: formImages.slice(), fields:{} };
  Object.keys(AI_FIELDS).forEach(id=>{ s.fields[id] = document.getElementById(id).value; });
  s.fields.f_image = document.getElementById('f_image').value;
  return s;
}
function restoreItemForm(s){
  if(!s) return;
  Object.entries(s.fields).forEach(([id,v])=>{ document.getElementById(id).value = v; });
  formImages = s.images.slice();
  renderImgStrip();
}
/* Turns a parsed recipe into {fieldId: text}. Units are converted here because
   an imported recipe arrives in whatever system its source used, and convUnits()
   always converts TOWARDS the current preference. This is the ONE place units
   are written into stored data — everywhere else conversion is display-only, so
   toggling units stays lossless. Time and servings are plain counts, not converted. */
function recipeToFields(d){
  const conv = v => (typeof v==='string' ? convUnits(v) : v);
  const f = {}, put = (id,v)=>{ if(v!=null && v!=='') f[id] = String(v); };
  put('f_name', conv(d.name));  put('f_category', d.category);  put('f_emoji', d.emoji);
  put('f_time', d.time);        put('f_servings', d.servings);  put('f_desc', conv(d.desc));
  put('f_source', d.sourceUrl);
  if(Array.isArray(d.ingredients) && d.ingredients.length) f.f_ingredients = d.ingredients.map(conv).join('\n');
  if(Array.isArray(d.steps) && d.steps.length)             f.f_steps       = d.steps.map(conv).join('\n');
  const n = (d.nutrition && typeof d.nutrition==='object') ? d.nutrition : {};
  put('f_kcal', n.calories); put('f_protein', n.protein); put('f_carbs', n.carbs); put('f_fat', n.fat);
  return f;
}
/* Fills the form from a recipe. By default it does NOT overwrite anything you
   have already typed — the auto-fill box sits inside the edit form too, so
   re-importing a saved recipe to pick up its photo and nutrition must not wipe
   the steps you corrected. Fields left alone are reported so you can take the
   imported version with one click instead. Photos always append; the gallery is
   additive and addFormImages() de-dupes. */
function fillItemFormFromRecipe(d, replace){
  if(!d || typeof d!=='object') throw new Error(t('ai_bad'));
  const fields = recipeToFields(d);
  let filled = 0; const kept = [];
  Object.entries(fields).forEach(([id, v])=>{
    const el = document.getElementById(id);
    const cur = (el.value||'').trim();
    if(cur && !replace){ if(cur !== v.trim()) kept.push(id); return; }
    el.value = v; filled++;
  });
  // Only absolute http(s) URLs — a page-relative path would not resolve here.
  const picked = [d.image].concat(Array.isArray(d.images) ? d.images : [])
    .filter(u=>typeof u==='string' && /^https?:\/\//i.test(u.trim())).map(u=>u.trim());
  filled += addFormImages(picked.slice(0,6));
  document.getElementById('f_image').value = '';
  updateImgPreview();
  return { filled, kept };
}
function aiFillStatus(msg, cls){ const el=document.getElementById('aiFillStatus'); el.textContent=msg||''; el.className='ai-status'+(cls?' '+cls:''); }

/* Result line after a fill. Undo is always offered — the imported recipe can
   simply be worse than what was there, which no amount of conflict detection
   catches. Replace all appears only when something was actually kept. */
let aiLastRecipe = null, aiFormSnapshot = null;
function aiFillResult(res){
  const el = document.getElementById('aiFillStatus');
  el.className = 'ai-status ok';
  const undoBtn = `<button type="button" class="linkbtn" id="aiUndoBtn">${esc(t('ai_undo'))}</button>`;
  if(res.kept.length){
    const names = res.kept.map(id=>t(AI_FIELDS[id])).join(', ');
    el.innerHTML = esc(t('ai_done_kept', {n:res.filled, kept:names})) + ' ' +
      `<button type="button" class="linkbtn" id="aiReplaceBtn">${esc(t('ai_replace_all'))}</button> ` + undoBtn;
    document.getElementById('aiReplaceBtn').addEventListener('click', ()=>{
      if(!aiLastRecipe) return;
      aiFillResult(fillItemFormFromRecipe(aiLastRecipe, true));   // snapshot stays the pre-fill one
    });
  } else {
    el.innerHTML = esc(t('ai_done')) + ' ' + undoBtn;
  }
  document.getElementById('aiUndoBtn').addEventListener('click', ()=>{
    restoreItemForm(aiFormSnapshot);
    aiFillStatus(t('ai_undone'));
  });
}
let aiBusyFlag=false;
async function aiAutofill(){
  if(aiBusyFlag) return;
  if(!aiKeyVal()){ aiFillStatus(t('ai_need_key'),'warn'); return; }
  const input = document.getElementById('aiInput').value.trim();
  if(!input){ aiFillStatus(t('ai_need_input'),'warn'); return; }
  aiBusyFlag=true;
  try{
    let text = input;
    if(isUrl(input)){ aiFillStatus(t('ai_fetching')); text = await fetchUrlText(input); }
    aiFillStatus(t('ai_working'));
    const raw = await aiChat(text.slice(0,14000));
    let data; try{ data = parseRecipeJSON(raw); }catch(e){ throw new Error(t('ai_bad')); }
    // We know the source exactly when a link was pasted — trust that over the model.
    if(isUrl(input)) data.sourceUrl = input;
    aiLastRecipe = data;
    aiFormSnapshot = snapshotItemForm();          // taken before anything is written
    aiFillResult(fillItemFormFromRecipe(data));
  }catch(e){ aiFillStatus('⚠ '+(e&&e.message||e),'warn'); }
  finally{ aiBusyFlag=false; }
}
document.getElementById('aiFillBtn').addEventListener('click', aiAutofill);

/* AI settings (Data panel) */
function aiStatus(msg, cls){ const el=document.getElementById('aiStatus'); el.textContent=msg||''; el.style.color = cls==='ok'?'#3f7d54' : cls==='warn'?'#c0392b' : 'var(--muted)'; }
function updateAiModelPlaceholder(){ $od('aiModel').placeholder = AI[$od('aiProvider').value].defModel; }
$od('aiProvider').addEventListener('change', ()=>{ odSaveLS(STORE.aiProvider, $od('aiProvider').value); updateAiModelPlaceholder(); });
/* Both events, deliberately. `change` alone only fires on blur, so a key that
   arrives another way — pasted then clicked straight through, or filled by a
   password manager — could sit in the box unsaved; `input` alone would miss a
   value committed without an edit. Emptying the box is what forgets a stored
   key now that the Disconnect button is gone, so an empty value drops the entry
   outright rather than leaving '' behind, and says so: without a button there
   is otherwise no sign that anything happened. */
function aiKeyChanged(){
  const v = $od('aiKey').value.trim();
  if(v){ odSaveLS(STORE.aiKey, v); return; }
  try{ localStorage.removeItem(STORE.aiKey); }catch(e){}
  aiStatus(t('ai_forgotten'), 'ok');
}
$od('aiKey').addEventListener('input', aiKeyChanged);
$od('aiKey').addEventListener('change', aiKeyChanged);
$od('aiModel').addEventListener('change', ()=>odSaveLS(STORE.aiModel, $od('aiModel').value.trim()));
document.getElementById('aiTestBtn').addEventListener('click', async ()=>{
  if(!aiKeyVal()){ aiStatus(t('ai_need_key'),'warn'); return; }
  aiStatus('…');
  try{ parseRecipeJSON(await aiChat('Extract this recipe: Toast. Ingredients: 1 slice bread. Steps: Toast the bread.')); aiStatus(t('ai_test_ok'),'ok'); }
  catch(e){ aiStatus('⚠ '+(e&&e.message||e),'warn'); }
});
// restore saved AI settings
$od('aiProvider').value = aiProviderVal();
$od('aiKey').value = aiKeyVal();
$od('aiModel').value = odLS(STORE.aiModel);
updateAiModelPlaceholder();

/* ---------- boot ---------- */
unitBtnsActive();
setLang(lang);
// First paint stays synchronous from localStorage; anything that overflowed to
// IndexedDB on a previous save is pulled in right after and repaints.
hydrateFromIdb().catch(()=>{});
