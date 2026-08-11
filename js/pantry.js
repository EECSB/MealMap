"use strict";
/* ============================================================
   PANTRY  —  ingredients currently available at home
   ============================================================ */
const pantryList = document.getElementById('pantryList');
const pantrySearch = document.getElementById('pantrySearch');
const pantryCatFilter = document.getElementById('pantryCategoryFilter');
const pantryOverlay = document.getElementById('pantryOverlay');

function pantryCategories(){ return [...new Set(pantry.map(p=>p.category).filter(Boolean))].sort((a,b)=>a.localeCompare(b, LOCALE[lang])); }
function refreshPantryCategories(){
  const cats = pantryCategories(); const cur = pantryCatFilter.value;
  pantryCatFilter.innerHTML = `<option value="">${esc(t('all_categories'))}</option>` + cats.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
  if(cats.includes(cur)) pantryCatFilter.value = cur;
  document.getElementById('pCatList').innerHTML = cats.map(c=>`<option value="${esc(c)}">`).join('');
}
function renderPantry(){
  refreshPantryCategories();
  const q = pantrySearch.value.trim().toLowerCase();
  const cat = pantryCatFilter.value;
  let items = pantry.filter(p=>{
    const mc = !cat || p.category===cat;
    const mq = !q || ((p.name||'')+' '+(p.category||'')+' '+(p.qty||'')).toLowerCase().includes(q);
    return mc && mq;
  });
  items.sort((a,b)=> (a.category||'').localeCompare(b.category||'', LOCALE[lang]) || (a.name||'').localeCompare(b.name||'', LOCALE[lang]));

  if(pantry.length===0){
    pantryList.innerHTML = `<div class="empty"><div class="big">🥫</div><h3>${esc(t('pantry_empty_title'))}</h3><p>${esc(t('pantry_empty_sub'))}</p><button class="btn" onclick="openPantryForm()">${esc(t('pantry_empty_btn'))}</button></div>`;
    return;
  }
  if(items.length===0){
    pantryList.innerHTML = `<div class="empty"><div class="big">🔍</div><h3>${esc(t('pantry_nomatch_title'))}</h3><p>${esc(t('pantry_nomatch_sub'))}</p></div>`;
    return;
  }
  pantryList.innerHTML = items.map(p=>`
    <div class="p-row ${p.low?'low':''}" data-id="${p.id}">
      <span class="p-emoji">${esc(p.emoji||'🥫')}</span>
      <div class="p-info">
        <div class="p-name">${esc(p.name)}</div>
        <div class="p-meta">${[p.qty?esc(convUnits(p.qty)):'', p.category?esc(p.category):''].filter(Boolean).join(' · ')||'—'}</div>
      </div>
      <button class="p-low-toggle ${p.low?'is-low':''}" data-action="low">${p.low?esc(t('p_low_short')):esc(t('p_instock'))}</button>
      <button class="p-ic" data-action="edit" title="${esc(t('edit'))}">✎</button>
      <button class="p-ic danger" data-action="del" title="✕">🗑</button>
    </div>`).join('');
}
pantryList.addEventListener('click', e=>{
  const row = e.target.closest('.p-row'); if(!row) return;
  const id = row.dataset.id;
  const act = e.target.closest('[data-action]');
  if(act){
    const a = act.dataset.action;
    if(a==='low'){ const p=pantry.find(x=>x.id===id); if(p){ p.low=!p.low; save(STORE.pantry); renderPantry(); } }
    else if(a==='edit') openPantryForm(id);
    else if(a==='del') deletePantryItem(id);
    return;
  }
  openPantryForm(id);
});
pantrySearch.addEventListener('input', renderPantry);
pantryCatFilter.addEventListener('change', renderPantry);
document.getElementById('addPantryBtn').addEventListener('click', ()=>openPantryForm());

function openPantryForm(id){
  const editing = id ? pantry.find(p=>p.id===id) : null;
  document.getElementById('pantryFormTitle').textContent = editing ? t('p_form_edit') : t('p_form_add');
  document.getElementById('pantryItemId').value = editing ? editing.id : '';
  document.getElementById('p_name').value = editing ? (editing.name||'') : '';
  document.getElementById('p_qty').value = editing ? (editing.qty||'') : '';
  document.getElementById('p_emoji').value = editing ? (editing.emoji||'') : '';
  document.getElementById('p_category').value = editing ? (editing.category||'') : '';
  document.getElementById('p_low').checked = editing ? !!editing.low : false;
  refreshPantryCategories();
  open(pantryOverlay);
  document.getElementById('p_name').focus();
}
document.getElementById('savePantryBtn').addEventListener('click', ()=>{
  const name = document.getElementById('p_name').value.trim();
  if(!name){ alert(t('need_pantry_name')); document.getElementById('p_name').focus(); return; }
  const id = document.getElementById('pantryItemId').value;
  const data = {
    name,
    qty: document.getElementById('p_qty').value.trim(),
    emoji: document.getElementById('p_emoji').value.trim(),
    category: document.getElementById('p_category').value.trim(),
    low: document.getElementById('p_low').checked
  };
  // Same race as the meal form above, same answer: re-add rather than throw.
  const existing = id ? pantry.find(p=>p.id===id) : null;
  if(existing) Object.assign(existing, data);
  else pantry.push(Object.assign({ id: id || uid() }, data));
  save(STORE.pantry); renderPantry(); close(pantryOverlay);
});
async function deletePantryItem(id){
  const p = pantry.find(x=>x.id===id); if(!p) return;
  if(!await askConfirm(t('p_confirm_delete', {name:p.name}), t('delete_btn'))) return;
  if(!pantry.find(x=>x.id===id)) return;
  pantry = pantry.filter(x=>x.id!==id);
  save(STORE.pantry); renderPantry();
}
/* ---------- ingredient ⇄ pantry matching ----------
   This was a plain substring test, which failed both ways: it MISSED plurals
   ("Eggs" never matched "1 egg") and it MATCHED across word boundaries
   ("Milk" and "Butter" both matched "300ml buttermilk").
   Now: normalise → split into words → compare word by word, with a small
   plural stemmer plus a shared-root rule so Slovenian case endings
   (jajce/jajca, maslo/masla) still match. A pantry item counts as present
   only when ALL of its words are found in the ingredient line, so "Olive oil"
   needs both words but "Tomatoes" still matches "200g cherry tomatoes". */
// Letters NFD does NOT decompose, so stripping combining marks alone loses them
// entirely: "masło"→"mas", "Weißmehl"→"wei mehl", "œuf"→"uf", "đumbir"→"umbir".
// Fold them by hand first — needed for fr/de/pl/hr ingredient names.
const CHAR_FOLD = {'ł':'l','ß':'ss','œ':'oe','æ':'ae','ø':'o','đ':'d','ð':'d','þ':'th','ı':'i'};
// Lowercase and strip accents without splitting into words — searching "cebula"
// has to find "čebula", and "Weissmehl" has to find "Weißmehl".
function foldText(str){
  return String(str||'')
    .toLowerCase()
    .replace(/[łßœæøđðþı]/g, c=>CHAR_FOLD[c])
    .normalize('NFD').replace(/\p{M}/gu,'');   // č→c, š→s, ž→z, é→e
}
function rawWords(str){
  return foldText(str)
    .replace(/[^a-z0-9]+/g,' ')
    .trim().split(' ')
    // drop empties, single letters ("g", "l", French "d'") and anything starting
    // with a digit ("200g", "3") — quantities are never the ingredient itself
    .filter(w=> w.length>1 && !/^\d/.test(w));
}
function stemWord(w){
  if(w.length>4 && w.endsWith('ies')) return w.slice(0,-3)+'y';        // berries→berry
  if(w.length>4 && /(ses|xes|zes|ches|shes|oes)$/.test(w)) return w.slice(0,-2); // tomatoes→tomato
  if(w.length>3 && w.endsWith('s') && !/(ss|us|is)$/.test(w)) return w.slice(0,-1); // eggs→egg
  return w;                                                             // glass, hummus stay put
}
// Endings a noun can pick up when it inflects: Slovenian cases (sol→soli,
// maslo→masla, krompir→krompirja) and German plurals (Zwiebel→Zwiebeln,
// Ei→Eier). Anything else after a shared root means it is a DIFFERENT word,
// not another form of the same one — that is what keeps sol/solata, pea/pear,
// chicken/chickpea and butter/buttermilk apart.
function isInflection(suffix){
  return suffix==='' || /^[aeiou]{1,2}$/.test(suffix)
      || /^(ov|om|em|mi|ih|ah|ja|je|ju|jo|jem|ega|ima|imi|n|en|er|es|ern)$/.test(suffix);
}
/* Same ingredient, different word. Keys are compared AFTER stemWord(), so the
   singular form is enough ("aubergines" → "aubergine" → "eggplant"). Multi-word
   entries use the collapsed `a_b` form produced by collapsePhrases(). */
const SYNONYMS = {
  aubergine:'eggplant', courgette:'zucchini', coriander:'cilantro', rocket:'arugula',
  prawn:'shrimp', garbanzo:'chickpea', beetroot:'beet', maize:'corn', swede:'rutabaga',
  yoghurt:'yogurt', chilli:'chili', chilly:'chili', chily:'chili',
  spring_onion:'scallion', green_onion:'scallion',
  cornflour:'corn_starch', corn_flour:'corn_starch', cornstarch:'corn_starch',
  icing_sugar:'powdered_sugar', tomato_puree:'tomato_paste',
  // UK ↔ US and other same-thing-different-name pairs
  mangetout:'snow_pea', sultana:'raisin', treacle:'molasses',
  caster_sugar:'superfine_sugar', double_cream:'heavy_cream', single_cream:'light_cream',
  gammon:'ham', linseed:'flaxseed', groundnut:'peanut', pak_choi:'bok_choy',
  chickpea_flour:'gram_flour', bicarbonate:'baking_soda', bicarb:'baking_soda',

  /* ---- cross-language staples ----
     These only do work when the pantry and the recipe are in *different*
     languages, which is the normal state of affairs here: the seed pantry is
     English while the recipes people import are not. Same-language matching
     never needed them — the words are simply equal.

     Keys are folded (lowercase, accents stripped) because that is what
     rawWords() produces, and they are looked up both stemmed and raw.
     Deliberately left out: words under 3 letters, and any word that is also a
     common English word meaning something else (Spanish "pan" for bread is the
     one that bites — it would collide with a pan). */
  moka:'flour', harina:'flour', farine:'flour', mehl:'flour', farinha:'flour',
  sladkor:'sugar', azucar:'sugar', sucre:'sugar', zucker:'sugar', zucchero:'sugar', acucar:'sugar',
  sol:'salt', sal:'salt', sel:'salt', salz:'salt', sale:'salt',
  /* česen→česna and poper→popra drop the vowel out of the root itself, so no
     ending rule can bridge them — both stems have to be listed. Every other
     Slovenian word here inflects by suffix alone (moka→moke, maslo→masla,
     sladkor→sladkorja) and is reached automatically. */
  poper:'pepper', popra:'pepper', pimienta:'pepper', poivre:'pepper', pfeffer:'pepper', pepe:'pepper', pimenta:'pepper',
  jajce:'egg', jajca:'egg', huevo:'egg', oeuf:'egg', uovo:'egg', uova:'egg', ovo:'egg',
  mleko:'milk', leche:'milk', lait:'milk', milch:'milk', latte:'milk', leite:'milk',
  maslo:'butter', mantequilla:'butter', beurre:'butter', burro:'butter', manteiga:'butter',
  smetana:'cream', nata:'cream', creme:'cream', sahne:'cream', panna:'cream',
  olje:'oil', aceite:'oil', huile:'oil', olio:'oil', oleo:'oil', azeite:'oil',
  voda:'water', agua:'water', wasser:'water', acqua:'water',
  cebula:'onion', cebolla:'onion', oignon:'onion', zwiebel:'onion', cipolla:'onion', cebola:'onion',
  cesen:'garlic', cesna:'garlic', ajo:'garlic', ail:'garlic', knoblauch:'garlic', aglio:'garlic', alho:'garlic',
  paradiznik:'tomato', pomodoro:'tomato',
  krompir:'potato', patata:'potato', kartoffel:'potato', batata:'potato',
  korenje:'carrot', zanahoria:'carrot', carotte:'carrot', karotte:'carrot', carota:'carrot', cenoura:'carrot',
  arroz:'rice', riso:'rice', reis:'rice',
  sir:'cheese', queso:'cheese', fromage:'cheese', kase:'cheese', formaggio:'cheese', queijo:'cheese',
  piscanec:'chicken', pollo:'chicken', poulet:'chicken', hahnchen:'chicken', frango:'chicken',
  govedina:'beef', ternera:'beef', boeuf:'beef', rindfleisch:'beef', manzo:'beef',
  kvas:'yeast', levadura:'yeast', levure:'yeast', hefe:'yeast', lievito:'yeast',
  kis:'vinegar', vinagre:'vinegar', vinaigre:'vinegar', essig:'vinegar', aceto:'vinegar',
  kruh:'bread', pain:'bread', brot:'bread', pane:'bread',
  med:'honey', miel:'honey', honig:'honey', miele:'honey',
  cokolada:'chocolate', schokolade:'chocolate', cioccolato:'chocolate',
  limona:'lemon', limon:'lemon', citron:'lemon', zitrone:'lemon', limone:'lemon',
  jabolko:'apple', manzana:'apple', pomme:'apple', apfel:'apple', mela:'apple',
  goba:'mushroom', gobe:'mushroom', champinones:'mushroom', champignon:'mushroom', funghi:'mushroom', cogumelo:'mushroom',
  petersilj:'parsley', perejil:'parsley', persil:'parsley', petersilie:'parsley', prezzemolo:'parsley',

  /* Compounds, in the collapsed `a_b` form collapsePhrases() produces. These are
     the ones that actually turn up in the English seed recipes, which is where
     cross-language grouping earns its keep now that imports arrive already
     translated: an English seed pancake wanting buttermilk and an imported
     Slovenian one wanting pinjenca should be one line on the shopping list.
     Deliberately NOT mapped: crème fraîche to sour cream. They are close
     relatives, not the same product, and merging them would put one line in the
     basket where two are needed. */
  oljcno_olje:'olive_oil', olivno_olje:'olive_oil', aceite_de_oliva:'olive_oil',
  huile_olive:'olive_oil', olio_di_oliva:'olive_oil', azeite_de_oliva:'olive_oil', olivenol:'olive_oil',
  kokosovo_mleko:'coconut_milk', leche_de_coco:'coconut_milk', lait_de_coco:'coconut_milk',
  latte_di_cocco:'coconut_milk', leite_de_coco:'coconut_milk', kokosmilch:'coconut_milk',
  pecilni_prasek:'baking_powder', pecilnega_praska:'baking_powder',
  levadura_en_polvo:'baking_powder', levure_chimique:'baking_powder',
  backpulver:'baking_powder', lievito_in_polvere:'baking_powder', fermento_em_po:'baking_powder',
  pinjenec:'buttermilk', pinjenca:'buttermilk', buttermilch:'buttermilk',
  babeurre:'buttermilk', latticello:'buttermilk', leitelho:'buttermilk',
  kisla_smetana:'sour_cream', nata_agria:'sour_cream', saure_sahne:'sour_cream',
  panna_acida:'sour_cream', natas_acidas:'sour_cream'
  /* Left out on purpose: Portuguese "salsa" (parsley) collides with Spanish and
     Italian "salsa" (sauce), and "maçã" folds to "maca", which is also a
     different ingredient in English. A wrong match is worse than a missing one. */
};
function canonWord(w){
  const s = stemWord(w);
  return SYNONYMS[s] || SYNONYMS[w] || s;
}
function sharesRoot(a, b){
  let i=0; const n=Math.min(a.length, b.length);
  while(i<n && a[i]===b[i]) i++;
  if(i<3) return false;                       // need a real shared root
  return isInflection(a.slice(i)) && isInflection(b.slice(i));
}
/* Every canonical form a word could stand for.
   A synonym can only be listed under one form, but inflected languages rarely
   use that form: Slovenian ingredient lists are written in the genitive —
   "480 g moke", "250 g masla", "3 žlice sladkorja" — so the nominative "moka"
   in the table is never what appears in the text. Anything sharing a root with a
   key therefore counts as that key, which is the same inflection rule used
   everywhere else and so inherits its safeguards: "solata" still does not reach
   "sol", because "ata" is not an ending a noun picks up. */
const _canonCache = new Map();
function canonSet(w){
  let set = _canonCache.get(w);
  if(set) return set;
  const s = stemWord(w);
  set = new Set([SYNONYMS[s] || SYNONYMS[w] || s]);
  for(const key in SYNONYMS){
    if(key === s || key === w) continue;
    if(sharesRoot(s, key)) set.add(SYNONYMS[key]);
  }
  _canonCache.set(w, set);
  return set;
}
function wordsMatch(a,b){
  if(a===b) return true;
  const ca = canonSet(a), cb = canonSet(b);
  for(const x of ca) if(cb.has(x)) return true;
  /* Falls back to comparing the raw stems, so two forms of a word with no
     synonym at all still match (moka/moke, maslo/masla) — and so that adding a
     synonym for one form can never take that away. */
  return sharesRoot(stemWord(a), stemWord(b));
}

/* Compounds that are a DIFFERENT ingredient from the words they contain. These
   get glued into one token before matching, which is the only way to stop pantry
   "Milk" matching "coconut milk" and pantry "Rice" matching "rice vinegar" —
   no general rule can, because "cherry tomatoes" IS tomatoes.
   Written as natural phrases and normalised with the same rawWords() as
   everything else, so "huile d'olive" becomes [huile, olive] automatically.
   Mostly English; the other languages carry their common ones. Extend freely —
   the only rule is that the phrase must not be a mere variety of its head noun. */
const PHRASE_SRC = [
  // milks, creams, butters
  'coconut milk','almond milk','soy milk','oat milk','rice milk','cashew milk','hazelnut milk',
    // (no single-word compounds here: rawWords leaves them as one token and the
  //  phrase list drops them. "buttermilk" needs no entry — it shares no prefix
  //  with "milk", so the shared-root rule already keeps them apart.)
  'macadamia milk','hemp milk','pea milk','flax milk','goat milk',
  'condensed milk','evaporated milk','powdered milk','coconut cream','sour cream','heavy cream',
  'double cream','single cream','whipping cream','whipped cream','clotted cream','ice cream',
  'cream cheese','cottage cheese','goat cheese','blue cheese',
  'peanut butter','almond butter','cashew butter','sunflower butter','cocoa butter','garlic butter',
  // oils
  'olive oil','sesame oil','coconut oil','sunflower oil','vegetable oil','rapeseed oil','canola oil',
  'avocado oil','walnut oil','peanut oil','grapeseed oil','corn oil','truffle oil','chilli oil','chili oil',
  // vinegars
  'rice vinegar','white vinegar','wine vinegar','red wine vinegar','white wine vinegar',
  'balsamic vinegar','cider vinegar','apple cider vinegar','sherry vinegar','malt vinegar',
  // sugars, powders, raising agents
  'brown sugar','icing sugar','powdered sugar','caster sugar','superfine sugar',
  'coconut sugar','palm sugar','demerara sugar','muscovado sugar','vanilla sugar',
  'baking powder','baking soda','garlic powder','onion powder','curry powder',
  'cocoa powder','chilli powder','chili powder','mustard powder',
  // flours that are not wheat flour (do NOT add "plain flour" — that IS flour)
  'almond flour','coconut flour','rice flour','chickpea flour','corn flour','corn starch','potato starch',
  // sauces and pastes
  'soy sauce','fish sauce','hot sauce','oyster sauce','tomato sauce','worcestershire sauce',
  'teriyaki sauce','hoisin sauce','barbecue sauce',
  'tomato paste','tomato puree','curry paste','chilli paste','miso paste','harissa paste',
  // stocks
  'chicken stock','beef stock','vegetable stock','fish stock','mushroom stock',
  'chicken broth','vegetable broth','beef broth','bone broth',
  // produce and pantry staples that are not their head noun
  'sweet potato','spring onion','green onion','bay leaf',
  'coconut water','desiccated coconut','maple syrup','corn syrup','golden syrup',
  'vanilla extract','almond extract','lemon zest','orange zest',
  /* --- Slovenian --- the one that matters most here, and the one with the most
     two-word compounds: "mleko" on its own must not satisfy "kokosovo mleko". */
  'kokosovo mleko','mandljevo mleko','sojino mleko','ovseno mleko','riževo mleko',
  'kislo mleko','kondenzirano mleko','mleko v prahu',
  'kisla smetana','sladka smetana','stepena smetana','kokosova smetana','smetana za stepanje',
  'arašidovo maslo','kakavovo maslo','čokoladni namaz',
  'oljčno olje','olivno olje','sončnično olje','bučno olje','sezamovo olje','repično olje',
  'kokosovo olje','rastlinsko olje',
  'jabolčni kis','vinski kis','balzamični kis','riževi kis',
  'sojina omaka','paradižnikova mezga','paradižnikov pire','paradižnikova omaka','worcester omaka',
  // "prašek" loses its vowel in the genitive ("praška"), which no ending rule can
  // bridge — and the genitive is the form a recipe actually uses ("1 žlička
  // pecilnega praška"), so both are listed and both map to baking_powder.
  'pecilni prašek','pecilnega praška','vaniljev sladkor','sladkor v prahu','rjavi sladkor','trsni sladkor',
  'koruzni škrob','krompirjev škrob','koruzna moka','ajdova moka','pirina moka','polnozrnata moka',
  'listnato testo','kvašeno testo','krhko testo',
  'kislo zelje','kisla repa','sladki krompir',
  'česen v prahu','čebula v prahu','mleta paprika','jedilna soda',
  'zeleni čaj','črni čaj','jušna kocka',
  /* --- German --- most German compounds close up into one word (Kokosmilch,
     Olivenöl, Backpulver) and are already safe, because a closed compound shares
     no prefix with its head noun. Only the ones written as separate words need
     listing. */
  'saure sahne','süße sahne','geschlagene sahne','saurer rahm','crème fraîche',
  'brauner zucker','grüner tee','schwarzer tee','rote bete','gemahlener kaffee',
  // es
  'leche de coco','leche de almendras','leche de soja','leche de avena','leche condensada','leche en polvo',
  'nata agria','nata montada','crema agria','crema batida',
  'mantequilla de cacahuete','manteca de cacao',
  'aceite de oliva','aceite de girasol','aceite de sésamo','aceite de coco','aceite vegetal',
  'vinagre de arroz','vinagre de manzana','vinagre balsámico','vinagre de vino',
  'salsa de soja','pasta de tomate','concentrado de tomate','tomate frito','tomate triturado',
  'levadura en polvo','bicarbonato de sodio','azúcar glas','azúcar moreno','almidón de maíz','harina de maíz','harina integral',
  'queso crema','queso de cabra','queso azul','caldo de pollo','caldo de verduras','patata dulce','té verde',
  // fr
  'lait de coco','lait d’amande','lait de soja','lait d’avoine','lait concentré','lait en poudre',
  'crème fraîche','crème aigre','crème fouettée','crème liquide','crème épaisse',
  'beurre de cacahuète','beurre de cacao',
  'huile d’olive','huile de tournesol','huile de sésame','huile de coco','huile de colza','huile végétale',
  'vinaigre de riz','vinaigre de cidre','vinaigre balsamique','vinaigre de vin',
  'sauce soja','concentré de tomates','purée de tomates','coulis de tomates',
  'levure chimique','bicarbonate de soude','sucre glace','sucre roux','sucre vanillé','fécule de maïs','farine de maïs','farine complète',
  'pâte feuilletée','pâte brisée','fromage frais','fromage de chèvre','bouillon de poule','patate douce','thé vert',
  // it
  'latte di cocco','latte di mandorla','latte di soia','latte di avena','latte condensato','latte in polvere',
  'panna acida','panna montata','panna da cucina','panna fresca',
  'burro di arachidi','burro di cacao',
  'olio di oliva','olio extravergine di oliva','olio di semi','olio di girasole','olio di sesamo','olio di cocco',
  'aceto di riso','aceto di mele','aceto balsamico','aceto di vino',
  'salsa di soia','concentrato di pomodoro','passata di pomodoro','polpa di pomodoro',
  'lievito in polvere','bicarbonato di sodio','zucchero a velo','zucchero di canna','amido di mais','farina di mais','farina integrale',
  'pasta sfoglia','pasta brisée','formaggio spalmabile','formaggio di capra','brodo di pollo','patata dolce','tè verde',
  // pt
  'leite de coco','leite de amêndoa','leite de soja','leite de aveia','leite condensado','leite em pó',
  'natas ácidas','natas batidas','creme de leite','nata azeda',
  'manteiga de amendoim','manteiga de cacau',
  'azeite de oliva','óleo de girassol','óleo de coco','óleo de sésamo','óleo vegetal',
  'vinagre de arroz','vinagre de maçã','vinagre balsâmico','vinagre de vinho',
  'molho de soja','extrato de tomate','polpa de tomate','concentrado de tomate',
  'fermento em pó','bicarbonato de sódio','açúcar em pó','açúcar mascavo','amido de milho','farinha de milho','farinha integral',
  'massa folhada','queijo creme','queijo de cabra','caldo de galinha','batata doce','chá verde'
];
/* Longest first, so "apple cider vinegar" wins over "cider vinegar".
   Deduplicated on the way in: Spanish and Portuguese in particular write a lot
   of the same compounds ("vinagre de arroz", "concentrado de tomate"), and after
   folding they are the same entry. The source list keeps both so each language
   section stays readable on its own; only the derived list has to be unique. */
const PHRASES = [...new Map(
  PHRASE_SRC.map(rawWords).filter(p=>p.length>1).map(p=>[p.join('_'), p])
).values()].sort((a,b)=>b.length-a.length);

// Glue any recognised compound into a single `a_b` token. Uses wordsMatch for the
// comparison, so inflected forms still register ("kokosovega mleka", "spring onions").
function collapsePhrases(words){
  if(words.length<2) return words;
  const out=[]; let i=0;
  scan: while(i<words.length){
    for(const p of PHRASES){
      if(i+p.length<=words.length && p.every((w,k)=>wordsMatch(words[i+k],w))){
        out.push(p.join('_')); i+=p.length; continue scan;
      }
    }
    out.push(words[i]); i++;
  }
  return out;
}

const _wordCache = new Map();
function normWords(str){
  const key = String(str||'');
  const hit = _wordCache.get(key);
  if(hit) return hit;
  const out = collapsePhrases(rawWords(key));
  _wordCache.set(key, out);
  return out;
}
// Canonical fingerprint of an ingredient line — used to spot the same ingredient
// written two ways ("2 cloves garlic" / "3 cloves garlic") when building lists.
/* ---------- one stable name per word, for grouping ----------
   `wordsMatch()` can afford to compare whole sets of candidate meanings, because
   it only ever answers yes/no about one pair. Grouping cannot: a shopping list
   needs a single key per ingredient, and it needs grouping to be an *equivalence*
   — if it were built on wordsMatch directly, which is deliberately fuzzy and
   therefore not transitive, which lines merged would depend on the order they
   arrived in.

   So this reduces a word to one name, in order of confidence:
     1. a synonym, direct or reached through an inflection ("moke" → "moka" → flour);
     2. failing that, an inflection of a canonical name itself, which is what
        pulls Spanish "tomate" onto English "tomato" without either being listed;
     3. otherwise the plain stem.
   Two ingredients that resolve to the same name are summed into one line, which
   is what makes an English seed recipe and a Slovenian imported one share a
   single "flour" entry instead of listing it twice. */
const CANON_NAMES = [...new Set(Object.values(SYNONYMS))].sort();
const _nameCache = new Map();
function canonName(w){
  let n = _nameCache.get(w);
  if(n !== undefined) return n;
  const stem = stemWord(w);
  const named = [...canonSet(w)].filter(v => v !== stem).sort();
  n = named.length ? named[0]
    : (CANON_NAMES.find(v => sharesRoot(stem, v)) || stem);
  _nameCache.set(w, n);
  return n;
}
function ingSignature(str){ return normWords(str).map(canonName).join(' '); }

function inPantry(ingredientStr){
  const ing = normWords(ingredientStr);
  if(!ing.length) return false;
  return pantry.some(p=>{
    const want = normWords(p.name);
    return want.length>0 && want.every(w=> ing.some(x=> wordsMatch(x,w)));
  });
}
