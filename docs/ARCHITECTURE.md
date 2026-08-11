# MealMap — Architecture &amp; decisions

_Last updated: 2026-07-27_

**Why this file exists.** The repo's history was squashed to a single commit, so the reasoning that
used to live in commit messages lives here instead. This is the record of *why* things are the way
they are — the decisions, the things that were tried and abandoned, and the bugs subtle enough to be
worth writing down. Read it before changing anything that looks arbitrary; a fair amount of it is not.

A dependency-free HTML/CSS/JS meal-planning app. No build step, no framework, no npm.

### Layout (split out of one file on 2026-07-25)
It began as a single `index.html` and was split into `css/` and `js/` for editing comfort. The split
was purely mechanical — every test passed unchanged afterwards, which is the evidence that nothing
moved semantically.

Two properties are load-bearing and easy to destroy by tidying:

- **Classic scripts, not modules.** No `type="module"`, no `defer`. Every top-level `let`/`const`
  therefore lives in the *one shared global lexical environment*, which is how the files see each
  other with no imports — and is what the test harness's proxy depends on. Switching to modules
  would isolate every file and break both at once.
- **Load order is the original code order.** Function declarations hoist within a file but not
  across files, so a file whose top level *calls* something needs that something defined earlier.
  `let menu = load(...)` sitting in the same file as `function load` is not a coincidence.

The order in `index.html` is:
`i18n → core → menu → recipe → calendar → pantry → qr → shopping → sync → ai`.
`ai.js` ends with the boot lines, so it must stay last. `qr.js` is a pure library with no top-level
dependency on anything else; it sits immediately before `shopping.js`, its only caller, so the
dependency reads top-down.

### No third-party requests (2026-07-25)
`lib/` holds MSAL and SheetJS, `fonts/` holds Fraunces and Inter — all four were CDN-loaded before.
Nothing is now fetched from another origin, so a strict `Content-Security-Policy` on the host cannot
break sign-in, and no visitor IP reaches Google or jsDelivr. Both libraries are still **loaded on
demand**, so the bytes only move if you use OneDrive or Excel export.

Two things learned doing it, both recorded in `lib/README.md` and `fonts/README.md`:

- **`loadScript()` compared `script.src` against a relative path**, and `.src` always reads back
  absolute — so with `lib/…` the check never matched and each library would be appended again on
  every call. It resolves through `new URL(src, location.href)` now.
- **Asking Google for discrete weights of a variable font wastes two thirds of the bytes.**
  `wght@…500;600;700` returns one `@font-face` per weight all pointing at the same file: 12
  downloads, 4 distinct, 762 KB for 254 KB of font. `wght@…500..700` returns one face per subset
  with a weight range — identical rendering.

Only latin and latin-ext are kept; latin-ext is what carries the Slovenian č/š/ž.

This is also why the QR encoder is written rather than fetched: the obvious implementations are a
CDN library or an image API, and the image API would additionally mean sending the shopping list to
somebody else's server. See "The QR code" below. The rule is worth restating because it is the kind
of thing a future feature quietly breaks — an Assembly test fails the build if anything at all is
loaded from another origin.

### Cache headers — `.htaccess` (added 2026-07-26)
Found by checking the live deployment: the host was serving `index.html`, the CSS and the JS with
`Cache-Control: public, max-age=7776000` — **90 days, and no ETag**, so a returning visitor would not
even ask the server for three months. None of the filenames are content-hashed, so there is no way to
bust that from inside the app.

Staleness is the obvious half. The dangerous half is **mixing**: `index.html` and the `js/` files are
fetched at slightly different moments, so their caches expire at different moments, and a visitor can
end up running a new `index.html` against stale `js/`. Today that is harmless. The first update that
adds a `<script>` tag or renames a translation key, it breaks silently — and the bug report will not
mention caching.

`.htaccess` therefore sets `no-cache, must-revalidate` on `.html`/`.css`/`.js` (a repeat visit costs
a 304, not a re-download) and a year on `.woff2`, the only files here that genuinely never change.
`lib/` is deliberately included in the revalidating group: those two files are large but load on
demand, and a stale MSAL is worse than one conditional request.

Two deliberate details:

- **Wrapped in `<IfModule mod_headers.c>`.** A host without the module answers an unknown directive
  with a 500 — that would take the whole app down rather than just skipping the policy.
- **The font rule is not `immutable`.** Those filenames are not hashed either, so a reload still has
  to be able to pick up a regenerated subset.

It only reaches Apache and LiteSpeed. Other hosts ignore the file and need the same policy their own
way (nginx `add_header`, S3 object metadata, Netlify `_headers`). If a host has `AllowOverride` set
so that `FileInfo` is not permitted, `Header` is a 500 rather than a no-op — so after the first
upload to a new host, load the page once before walking away.

- **App file:** [`../index.html`](../index.html) — markup only; the code is in `../js/`
- **Supporting files:** [`../README.md`](../README.md) (orientation, and the screenshot in `img/`),
  [`../tests.html`](../tests.html) (the test suite — open it in a browser),
  [`../.htaccess`](../.htaccess) (cache headers — ships with the app, see above),
  [`ONEDRIVE-SETUP.md`](ONEDRIVE-SETUP.md) (OneDrive setup guide),
  [`USER-GUIDE.md`](USER-GUIDE.md) (how to use the app),
  `../.claude/launch.json` (starts a local static server for previewing)
- **Tests:** serve the folder and open `http://localhost:8765/tests.html` — 313 unit + end-to-end
  tests, no dependencies. See "How to develop / verify" near the end of this file.
- **Run it:** double-click `index.html`, **or** serve the folder with `node serve.js` and open
  `http://localhost:8765`. A local server is recommended — browser storage behaves normally there,
  and the AI/OneDrive paths need `http://` rather than `file://`.
- **`serve.js`** is a ~25-line dependency-free static server (no npm install, works offline).
  `.claude/launch.json` runs it as the **`mealmap`** config.
- **`pack.ps1`** builds `mealmap-site.zip`, the archive attached to a GitHub release. See
  "Releasing" near the end of this file — it exists because two steps of doing it by hand are
  invisible when they go wrong.
- **Node.js 24 LTS was installed on this machine on 2026-07-25** (winget, `OpenJS.NodeJS.LTS`).
  There is still no Python — that is why `launch.json` no longer uses `python -m http.server`.
  `launch.json` calls node by **absolute path** (`C:\Program Files\nodejs\node.exe`) because the
  editor process inherits a PATH from before the install; once it has been restarted, plain
  `"node"` would work too.

---

## What it does (views / tabs)

Header: brand **MealMap** · tabs **Menu / Pantry / Shopping / Calendar** · **⚙️ Settings** button.
(The tabs pill and Settings button are a matched 40px tall.)

**Brand mark** — an inline 34px SVG in the header: a map pin (orange→terracotta gradient,
`--breakfast` → `--accent`) holding a fork and spoon. The *same* SVG is inlined again as a
`data:image/svg+xml` **favicon** in `<head>`, so the app stays one self-contained file. The
cutlery is drawn deliberately chunky (1.6/2.6 stroke widths) so the mark still reads at 16px
favicon size — earlier, finer strokes vanished. If you edit one copy, edit the other to match.

- **Favourites and last cooked** (added 2026-07-25) — `favourite` (bool) and `lastCooked`
  (`'YYYY-MM-DD'`) on the meal. The ★ toggles from the card corner or the recipe view and the two
  stay in sync; the toolbar ★ filters to favourites only. **Mark as cooked** stamps today and
  clicking it again clears it. `cookedAgo()` shows *today / yesterday / N days ago* and falls back
  to a localised date past 30 days, comparing calendar days rather than 24h spans.
  `lastCooked` is set **by hand, never inferred from the calendar** — a meal being scheduled is not
  evidence anyone cooked it.
- **Search covers ingredients** (`searchMeal()`, added 2026-07-25). Name, description and category
  as before, plus the ingredient list, in two passes: an **accent-insensitive substring** match
  (`foldText()`) so "mush" finds "mushrooms" and "plocevinke" finds "pločevinke" — what people
  expect from a search box — then a **canonical word** match through the same `SYNONYMS` table as
  pantry matching, so "aubergine" finds a recipe listing "eggplants" and "skuta" finds "skute".
  When the hit came from an ingredient rather than the title, the card shows which one, so a result
  is never unexplained. **Steps are deliberately not searched**: they are prose, and matching them
  surfaces recipes for reasons invisible on the card.
- **Servings scaling** (added 2026-07-25) — the recipe view's servings figure is a **− / + stepper**;
  changing it rescales every ingredient quantity, with a *reset to N* link once you are off the
  original. Like the units toggle it is **display-only** — the stored recipe is never rewritten, so
  it stays lossless. `scaleIngredient()` reuses `parseQty` / `tidyQty` / `pluralUnit` from the
  shopping-list summing, so `500 g ×3` becomes `1.5 kg` rather than `1500 g`, and `1 can` becomes
  `2 cans`. Lines with no leading number ("Salt to taste") are left alone. The step size follows the
  recipe (`base/4`, min 1), so an 8-serving recipe steps 8→10→12. A recipe with no servings figure
  gets no stepper.
- **Duplicate a recipe** (`duplicateMeal()`, added 2026-07-25) — from the card row (⧉, between Edit
  and Delete) or the recipe view footer. Deep-copies the meal, gives it a fresh `uid()`, and splices
  it in **directly after the original** so the pair sits together in the grid rather than at the end.
  `lastCooked` and `favourite` are deliberately **dropped**: the copy has never been cooked, and
  starring it is a fresh decision. It then opens the edit form with the name focused and
  pre-selected (`{name} (copy)` via the `copy_of` key), so typing replaces it immediately.
  The card button is `.icon-btn.icon-only` — a fixed 38px — because plain `.icon-btn` is `flex:1`
  and a third full-width button would squeeze Edit and Delete.
- **Cook mode + print** (added 2026-07-25) — **▤ Cook mode** in the recipe footer restyles the
  *same* modal full-bleed: no photo, description, nutrition, gallery or scheduling — just big
  ingredients and steps, tap any line to strike it off. Because it restyles the open DOM rather than
  rendering a second copy, the servings scale and unit toggle carry over and stay adjustable mid-cook;
  nothing can drift out of sync. Ticks are **never saved** (a half-finished cook is not state anyone
  wants back three days later) and a re-render clears them for the same reason.
  **Escape leaves cook mode, not the recipe** — one press, one layer.
  - `.tickable` wraps the ingredient/step *text only*, so the strikethrough skips the bullet, the
    step number and the ✓ in-pantry badge, and the badge keeps its flex gap.
  - Cook mode sets `overflow:visible` on `.modal`. `.modal` is normally `overflow:hidden` to clip
    its rounded corners, but that makes it a clipping container and the sticky footer has nothing
    to stick to — **Done** and **Print** would scroll off the bottom of a phone. Verified fixed.
  - **Screen stays awake** via the Wake Lock API. It's re-requested on `visibilitychange` because
    browsers drop the lock whenever the tab is hidden and never hand it back. A refusal
    (Safari, low battery, embedded webviews) is swallowed — and the hint only claims
    "screen stays awake" when a lock is genuinely held, so it never lies.
- **Print** (🖨 in cook mode, or plain Ctrl-P) — the `@media print` block is scoped with
  `body:has(#recipeOverlay.open)`, so it only fires when a recipe is open and printing from any
  other view is untouched. Drops the photo, gallery, scheduling and every control; black on white;
  `break-inside:avoid` on list items. Note `*{background:none}` **cannot reach `::before`**, so the
  step-number circles have to be cleared by name — they otherwise print as grey blobs.
- **🍽️ Menu** — CRUD meals. Each meal: name, category, emoji, prep time, servings, image
  (URL or uploaded data-URL), short description, ingredients[], steps[]. Click a card → recipe
  modal (hero image, ingredients, numbered steps, "add to calendar"). Search + category filter.
  **🎲 Random suggestion** opens a random recipe with an **Another** reroll. 4 sample meals are
  seeded on first run.
- **🥫 Pantry** — ingredients on hand: name, qty, category, emoji, and an **In-stock / Low**
  toggle. Search + filter. 11 sample items seeded. In any recipe, ingredients you already have
  get a green **✓ in pantry** badge.
- **🛒 Shopping** — two panels: (1) a **shopping list** (check-off, remove, manual add,
  **This week / Next week + ＋ From plan**, **Add low-stock**, **Clear checked**); (2) **Meals you
  can make** — per meal a "have/total in pantry" badge, an **All / Ready-to-cook** filter,
  missing-ingredient chips, and **Add missing**.
  - **＋ From plan** (`addFromPlan()`, added 2026-07-25) builds the list from a whole week of the
    calendar: it walks Monday→Sunday of the chosen week, collects every scheduled meal, drops what
    `inPantry()` already covers, and adds the rest. It is
    **idempotent** — pressing it again adds nothing, because candidates are compared by
    `ingSignature()` against both the existing list and each other, so "2 cloves garlic" from one
    meal and "3 cloves garlic" from another collapse to a single entry.
    Feedback lands in `#shopFeedback`; that line is plain text with no `data-i18n`, so `setLang()`
    clears it rather than leave a sentence in the previous language.
  - **It counts cooking sessions, not meals and not days** (fixed 2026-07-25). It used to dedupe by
    meal id, which quietly *under-bought* whenever you planned to cook the same thing twice in the
    range — two curries on two unrelated days shopped for one. The rule now is: a **batch counts
    once** however many days it spans (you cook it once), and every **non-batch entry counts
    separately**, with the amounts summed. Batch cooking is what made the right rule expressible;
    before it there was no way to tell "cooked twice" from "eaten twice". A batch counts once even
    when only part of it falls inside the range.
  - **Ranges** (`planRangeKeys()`): this week / next week (Monday-first, matching the calendar),
    next 7 or 14 days (rolling, from today), this or next calendar month, or a **custom range** —
    picking that reveals two date inputs, seeded with today→+6. A reversed range is swapped rather
    than rejected; an empty one asks for dates instead of silently doing nothing.
  - **Quantities are summed** (`combineIngredients()`, added 2026-07-25). Amounts are added only
    when genuinely addable: the same measurement family (g/kg/dag, ml/cl/dl/l, oz/lb) or the exact
    same unit word after singularising, so `2 cloves` + `3 cloves` → `5 cloves` and `200 g` + `1 kg`
    → `1.2 kg`. **Anything the parser is unsure about is left alone and listed separately** — cloves
    plus heads of garlic stay as two lines, because a wrong total is worse than two lines.
    **One line per ingredient, across languages** (`canonName()`, added 2026-07-25).
    `ingSignature()` reduces each word to a single canonical name, so an English seed recipe wanting
    `200g flour` and an imported Slovenian one wanting `480 g moke` produce **one** `680 g moke`
    line rather than two. The name is chosen in order of confidence: a synonym (direct, or reached
    through an inflection — `moke` → `moka` → flour); failing that, an inflection of a canonical
    name itself, which pulls Spanish `tomate` onto English `tomato` without either being listed;
    otherwise the plain stem. Compounds are covered by collapsed entries in `SYNONYMS`
    (`kokosovo_mleko` → `coconut_milk`, `pinjenca` → `buttermilk`, `oljcno_olje` → `olive_oil`).
    Grouping deliberately uses this single name rather than `wordsMatch()`: it must be an
    equivalence relation, and a fuzzy match is not transitive, so group membership would otherwise
    depend on the order lines arrived in. A test asserts no two root-sharing synonym keys disagree
    on meaning, which is what keeps the choice deterministic.

    **Measure words are not English-only** (added 2026-07-25). `parseQty`'s unit pattern was
    `[a-zA-Z]`, which silently **corrupted** any accented measure word: `3 pločevinke polovičk
    breskev` matched only `plo` and glued the remainder back on as `" čevinke"`, damaging both the
    shopping line and its signature. It is now `\p{L}`, and `UNIT_ALIASES` maps ~90 measure words
    across the six other languages onto the English name, so `2 žlici` and `2 tbsp` are the same
    unit and add up. Slovenian has a **dual**, so each feminine measure needs all four forms
    (žlica / žlici / žlice / žlic) — and `2 pločevinki` is exactly how a recipe writes two tins.
    German and Italian plurals do not end in `-s`, so `stemWord()` cannot reach them and both forms
    are listed. `parseQty` also returns **`unitText`**, the line's own word, set only when it differs
    from the canonical: a summed Slovenian line reads `5 pločevinke`, not `5 cans`, and English
    behaviour is byte-identical to before.

    `parseQty()` treats a word after the number as a unit only if it recognises it, so "2 eggs"
    parses as quantity 2 of "eggs" rather than 2 "eggs" of nothing. Identical lines from different
    meals still add up (two meals each wanting 1 slice of bread need 2) — the group counts
    contributions, not distinct strings. The wording follows the largest contributor so it reads
    "3 onions", not "3 onion", and counting units re-pluralise on output.
  - **⤴ Share** (added 2026-07-27) — the list is no use on the computer it was planned on. One
    panel, one string, five ways out: **Copy**, **Send to an app…** (`navigator.share`), **Email**,
    **Text file**, and a **QR code**. See "Sharing the shopping list" below for why each one is
    shaped the way it is.
- **📅 Calendar** — month grid (Monday-first), meals scheduled into Breakfast/Lunch/Dinner/Snack
  slots (colour-coded), today highlighted, prev/next/Today. Click a day → add/remove meals or
  **🎲 Surprise me** (drops a random meal into the slot).
- **Drag a meal to another day** (added 2026-07-25) — grab a chip in the month grid and drop it on
  a different day. The slot is kept; only the date changes. `moveScheduled()` splices the entry out
  and deletes the day key when it empties, so `schedule` never accumulates empty arrays.
  - **Pointer events, not the HTML5 drag API.** `dragstart` never fires on mobile browsers, so the
    native API would have meant the feature silently not existing on a phone — which is exactly
    where a week's plan gets reshuffled. One implementation covers both input types.
  - The two inputs need **opposite defaults**, and this is the crux of it: a **mouse** drag arms
    after 6px of movement (so a plain click still opens the day), but a **touch** drag arms only
    after a **300ms hold**. Arming touch on movement instead would make the month view impossible
    to scroll on a phone, because chips cover much of it. Moving before the hold completes abandons
    the drag and lets the browser scroll. Once armed, a non-passive `touchmove` listener calls
    `preventDefault()` so the page doesn't scroll out from under the drag.
  - `data-i` on a chip is its index in the **full** day list (`slice(0,3)` preserves indices), so
    the splice hits the real entry rather than the on-screen position.
  - The ghost is a clone moved with `transform` (not `left`/`top`) so the compositor can shift it
    without re-laying out the calendar each frame, and it is `pointer-events:none` or the hit test
    for the drop target would keep finding the ghost itself.
  - `pointerup` is followed by a `click`, which would open the day just dropped on — a
    `suppressDayClick` flag swallows it, cleared on a `setTimeout(…, 0)` so it can never eat an
    unrelated click later.
  - **Limits:** only the 3 visible chips are draggable (the "+N more" chip is not — you can't drag
    what you can't see), and there is no way to drag into another month; use the day modal for both.
- **The day modal picks meals from a gallery**, not a `<select>` (changed 2026-08-02). `openDay()`
  renders one `.pick-card` per meal — photo or emoji, name, description, prep time — into
  `#d_mealPick`; the choice lives in `dayPickId` and is shown with `aria-pressed` on a real
  `<button>`, so it is a toggle group the keyboard already understands rather than a hand-rolled
  listbox. Three consequences worth knowing:
  - **Nothing is selected on open.** The old `<select>` defaulted to its first option, so Add always
    scheduled *something*; with pictures under the cursor that is a mis-click waiting to happen, so
    Add says `need_pick_alert` instead. Clicking the chosen card again clears it.
  - **The filter box (`#d_search`) appears only past `PICK_SEARCH_FROM` meals** — it is buying back
    the type-ahead a native dropdown gave for free, which nothing needs at four meals. It reuses
    `searchMeal()`, so it finds ingredients as well as names, exactly as the Menu tab does.
  - `setLang()` already reopens an open day modal, which repaints the gallery — that is what keeps
    the prep-time unit and the empty states in the current language.
- **Batch cooking** (added 2026-07-25) — **🍲 Batch cook** in the recipe footer: pick a cook date,
  slot and how many meals it makes, and the following days are proposed automatically. Creates one
  batch plus one scheduled day per portion, all linked.
  - **The batch owns no dates.** It is `{id, mealId, cookDate, portions}`; the days are ordinary
    schedule entries carrying a `batchId` back to it. So moving or deleting a day needs no
    bookkeeping beyond the entry, and there is no second list of dates to fall out of step with
    the calendar.
  - **`cookDate` is re-derived, never patched.** The cook day is always the batch's *earliest*
    scheduled day — you cannot eat leftovers before you have cooked — and `normaliseBatchDates()`
    re-establishes that after every move and delete. The first attempt stored it and patched it
    when the cook day itself was dragged; that was not enough. Dragging the cook day *past* its own
    leftovers left two days both reading as "cook day", and deleting the cook day left every
    remaining day a leftover of a date that no longer existed. Deriving it deleted both bugs and
    the special case with them.
  - **"Leftover" is likewise derived** (`isLeftover()`: this day is after `cookDate`), not stored.
    A stored flag goes stale the moment a day is dragged across the cook date; a comparison cannot.
    ISO dates compare lexicographically, so it is a plain string compare.
  - `portions` is what the batch *makes*; scheduled days is what is *planned*. Deleting one day
    leaves `portions` alone, so the tag reads e.g. `2/4` with a portion spare — that is the
    intended meaning, not drift.
  - `pruneBatches()` drops records nothing references (cheaper than refcounting every delete path,
    and it self-heals an imported file). Both run on import and on OneDrive pull.
  - The stepper preserves rows you have already edited and only grows or shrinks the tail; changing
    the **cook date** re-proposes the whole run. Nudging a count should not undo edits; moving the
    start should move everything.
  - Leftover chips are hollow + dashed + ♻ so a glance at the month shows which meals you actually
    have to stand at the stove for. **No success dialog** — landing on the filled-in calendar is the
    confirmation (and avoids the dialog-suppression trap that once broke Delete).

### Saving a record that vanished under the form (fixed 2026-07-25)
Both `saveItemBtn` and `savePantryBtn` did `Object.assign(<find the record>, data)`. If the record
went away while the form was open — another tab, or the OneDrive poll replacing `menu` wholesale
every 20 seconds — the find returned `undefined` and the assign threw
`TypeError: Cannot convert undefined or null to object`, losing everything just typed.

Both now **re-add the record under its original id** instead. Bailing out silently would have been
the easy fix and the wrong one: the user pressed Save, so losing their work to a race they never saw
is the worse outcome. Keeping the id matters too — it repairs any calendar days still pointing at
that meal, which would otherwise read "Removed meal" forever. A genuinely new record still gets a
fresh `uid()`.

This resurrects a record deleted on another device, which is deliberate and consistent with the
last-write-wins model the OneDrive sync already uses.

---

### Keeping a file up to date (File System Access, added 2026-07-25)
**Settings → 💾 Keep a file up to date.** The user picks a file; the app holds the handle and
rewrites it. Point it at a file inside a folder OneDrive, Dropbox, Drive or iCloud already syncs and
their desktop client does the syncing — so this is **one code path that works with every provider at
once**: no OAuth, no app registration, no client ID in the page, nothing to re-verify annually, and
nothing that breaks when the site moves to a new URL.

The cost is reach: **Chromium desktop only.** Firefox and Safari implement the Origin Private File
System but not the pickers, and no mobile browser has it. The section hides itself and explains why
rather than offering something that cannot work.

- The handle is stored in **IndexedDB** (handles are serializable), so the link survives a reload.
  The *permission* granted with it may not, and `requestPermission()` needs a **user gesture** — so
  boot only calls `queryPermission()`, and re-granting waits for the next click. Everything on a
  timer passes `interactive:false` and quietly does nothing until then.
- **Picking a file that already holds a plan does not overwrite it.** That file is very likely the
  other half of the household; the app says how many meals are in it and lets the user choose which
  direction to go. Only an empty or new file is written on sight.
- The poll compares `lastModified` against `fsLastSeen`, which is **updated after our own write** —
  without that, the app reads its own save straight back and undoes whatever was typed next. A test
  covers exactly that.
- Conflict handling is the same last-write-wins as OneDrive, and just as blunt.

`syncPayload()` and `applyPayload()` are now the single build/parse pair shared by file export, file
sync and both OneDrive writes. The payload shape was spelled out in four places before, which is
four places to forget a new store in.

---

### Sharing the shopping list (added 2026-07-27)
**Shopping → ⤴ Share.** One panel, one string, five ways out. The multiplicity is the point:
"share the shopping list" means a different thing on a phone, at a desk, and to someone else in the
household, and each of these is the obvious answer to exactly one of those.

**One text, built from what is on screen.** `shopListText()` walks `shopping` in the same order
`renderShopList()` does and through the same `convUnits()`, so a list read in imperial cannot arrive
on the phone in metric. `renderShopping()` re-renders the panel while it is open, which is what makes
the language and unit toggles carry over for free — both of them already route through there.
Ticked items are **left out by default** (you have bought them) and marked `✓` rather than `-` when
included, which survives being pasted into a notes app; a separate section would not.

**Empty and all-ticked are different states.** Showing "your list is empty" when everything is
merely ticked off would be a lie with the fix sitting in a checkbox directly above it, so the two
have their own messages.

**Email is `mailto:`, and cannot be anything else.** There is no back end and there is not going to
be one, so the app cannot *send* mail — it fills in the user's own mail app and they press send.
Worth stating plainly in the UI, because "email it to me" sounds like it should mean a server did
it. Two details: the address is left un-encoded (it is the `mailto:` path, not a parameter, and
percent-encoding the `@` confuses some clients), and the text's first line becomes the subject so
the body starts at the items. `shareMailto()` is a separate pure function purely so a test can check
the URL without an OS mail client opening mid-run. The address is remembered in `localStorage`
(`kitchenMenu.shareEmail`) so mailing it to yourself is one click — and it is deliberately **not**
in `syncPayload()`, so it never travels in an export or to OneDrive.

**Copy keeps the `execCommand` fallback.** The async clipboard needs a secure context, and
`file://` is not one — the app is explicitly meant to work double-clicked. The modern path is tried
first and the old one catches everything else; if both fail the panel says to select and copy by
hand rather than silently doing nothing.

**`navigator.share` hides rather than disables.** It does not exist on most desktops. A dead button
with no explanation is worse than one fewer option.

#### The QR code — and why the encoder is ours (`js/qr.js`)
Every "QR code API" on the web means POSTing the list to a stranger's server to be handed a picture
back. A shopping list says where somebody shops, what they eat, and how many of them there are —
that is a poor trade, and it would be the only third-party request in the whole app (see "No
third-party requests"). Vendoring a full library into `lib/` was the alternative; ~200 lines of
arithmetic that runs offline was the smaller one, and it needs no annual re-verification.

Deliberately narrow: **byte mode (UTF-8)**, which encodes anything; **error-correction level M**,
the usual choice for a screen; **versions 1–20**. The version ceiling is a *scannability* limit, not
a format one — a v20 code is 97×97 modules, about as fine as a phone camera manages off a laptop
screen, and at the panel's 320px cap that is still ~3px a module. Past 666 bytes `qrEncode()`
returns `null` and the panel points at the text file. **It never truncates**: a QR that scans and
yields a plausible but incomplete list is worse than no QR.

Only two tables are stored — error-correction codewords per block, and blocks per version — because
those are the parts ISO/IEC 18004 does not let you derive. Everything else (total codewords, data
capacity, alignment-pattern centres) is computed from the version number, which is both shorter and
much harder to typo.

Three things that would each have been a silent, plausible-looking failure:

- **The character-count field is 8 bits below version 10.** So 256 bytes cannot be *counted* in
  version 9 however much room it has — unguarded, the length wraps to zero and the code scans as
  **empty**. `qrEncodeData()` refuses those versions outright.
- **Timing patterns must not be drawn over the finders.** Running row/column 6 the full width
  overwrites finder modules with the wrong parity; it runs only between them (index 8 to size−9).
- **Format info is drawn twice, in two places**, so a damaged corner does not cost the reader the
  mask number. Both copies have to agree — a test reads them back and checks they do.

**How it is verified, and what that is worth.** No scanner was available on this machine
(`BarcodeDetector` is not implemented in Chrome on Windows; checked, not assumed), so "it renders
something square" had to be replaced with something stronger. Two independent checks, both in
`tests.html`:

1. **The published tables.** Byte capacities and total codewords for all 20 versions at level M, and
   the alignment-pattern centres, are asserted against ISO/IEC 18004. The code derives these rather
   than storing them, so self-consistency cannot fake a match.
2. **A decoder that reads a finished grid back the way a scanner does.** It rebuilds the
   function-module map from the version number alone, checks the format info against its BCH(15,5)
   code and that both copies agree, un-masks, walks the placement, de-interleaves with independently
   derived block geometry, and requires **every block's Reed–Solomon syndromes to be zero** before
   it will return a string. All 20 versions are filled to the exact byte and round-tripped, along
   with accented Slovenian, emoji, and the 256-byte trap above. It shares the encoder's GF(256)
   arithmetic — that is just field maths — but none of its layout, padding or masking decisions.

Any error in placement, masking, interleaving or padding breaks at least one of those; the syndrome
check in particular is unforgiving. **What is still unproven is the last inch:** whether a real phone
camera and a real decoder implementation read it off a screen. That needs a phone, and so does the
touch-drag and cook mode — see "Hosting" under next steps.

The SVG is one `<path>` rather than a rect per module (thousands of elements are slow to lay out and
show hairline seams when scaled), carries the required **four-module quiet zone**, and is explicitly
`#000` on `#fff` — never themed, because the contrast is the whole point.

---

## ⚙️ Settings modal (opened by the header gear button)

**The modal header is the brand mark, the name and the tagline** (changed 2026-07-25) rather than a
heading reading "Settings", which only repeated the button just pressed to get there. The longer
description stays in the body. `settings_title` was deleted from all seven dictionaries;
`settings_btn`, the header button, stays.

Order below that: **description → Language/Units → AI assistant → Data & sharing → Keep a file up to
date → OneDrive**. The AI key sits above the data options as the thing people set up once and then
use daily; the sync options are occasional by comparison.

Three tests guard this. One pins the section order. One checks the header carries the brand and no
"Settings" heading survives. One measures, **in all seven languages and at phone width**, that the
tagline does not run into the ✕ or push it out of the header — the header is a flex row with a
translated string in it, which is exactly the shape that overflows quietly in one language only.
A fourth checks the earlier move did not leave a second copy of the AI controls behind, since a
duplicate id breaks `getElementById` wiring silently rather than loudly.

- **Preferences** — **Language** (EN / SL segmented toggle, inline SVG flags) and
  **Units** (Metric / Imperial).
- **Data & sharing** — **Export JSON** / **Import JSON** (full fidelity), **Export Excel** /
  **Import Excel** (Meals + Pantry + Shopping + Schedule sheets).
- **☁ OneDrive live sync** — see "Setup-required features" below.
- **✨ AI assistant** — see below.

---

## Cross-cutting systems

### Multilingual — 7 languages
**EN, SL, ES, FR, DE, IT, PT** (pt-BR wording). Added ES/FR/DE/IT/PT on 2026-07-25.
- `data-i18n` / `data-i18n-ph` / `data-i18n-title` attributes on elements; `I18N = {en:{}, sl:{}, …}`
  dictionary — **283 keys per language, all seven at exact parity**; `t(key, params)` with
  `{placeholder}` interpolation; `applyTranslations()` walks the attributes. `setLang(l)` validates
  against `I18N`, persists, re-renders and refreshes open modals.
  (This figure read 167 until 2026-07-27 and had been stale for a while — it was 260 before the
  share panel added 23. The number is prose; the *parity* is what a test enforces, so treat a
  mismatch here as a stale doc rather than a bug.)
- Dates localise via `LOCALE` (`en-GB`, `sl-SI`, `es-ES`, `fr-FR`, `de-DE`, `it-IT`, `pt-BR`);
  weekday abbreviations via `WEEKDAYS_I18N` (Monday-first for all seven).
- **Flags are inline SVG** on purpose — regional-indicator emoji render as "GB"/"SI" letters on
  Windows/Chromium. The Slovenian flag includes its coat of arms so it isn't mistaken for Russia's.
- `LANGS` holds `{code, label, flag(suffix)}`. **`flag` is a function, not a string**: the selected
  flag is rendered twice (dropdown trigger + list), so any flag using internal ids (`clipPath`,
  gradients) must fold the suffix into them or the duplicates collide. No current flag does — English
  uses the **US** flag (stars-and-stripes, plain shapes), not the Union Jack that needed clipPaths.
- The picker is a **custom dropdown** (`.langpick`), not a `<select>`: a native select cannot render
  inline SVG. It closes on outside-click and Escape. Built by `renderLangPick()`, which `setLang()`
  calls, so the trigger label always follows the active language.
- **Adding a language** = one `I18N` block (copy `en`, translate all 283), one `LOCALE` entry, one
  `WEEKDAYS_I18N` row, one `LANGS` entry with a flag. Nothing else. Verify parity by diffing
  `Object.keys(I18N.en)` against the new block — a missing key renders as the raw key name.
- **Caveat:** these five were machine-translated and have not been reviewed by native speakers.
- Non-Latin scripts (Cyrillic, Greek, CJK, Arabic) need more than a dictionary — see
  "Ingredient ⇄ pantry matching" and "Known limitations".

### Units (metric ⇄ imperial)
- `convUnits(str)` runs regex conversions on quantities inside free-text ingredients, steps,
  pantry qty, and shopping items. It is **bidirectional** — it always converts *towards* the
  current preference (metric→imperial when imperial is selected, imperial→metric otherwise).
- **Display-only, with exactly one exception.** Stored data is never rewritten by toggling, so
  switching back and forth is **lossless**. The one place a conversion is written into stored data
  is AI import — see `fillItemFormFromRecipe()` below.
- Handles: g, kg, dag/dkg, ml, dl, l, °C, cm, mm ⇄ oz, lb, cups, fl oz, °F, in.
- **Fractions** are understood: `1/2 cup`, `1 1/2 tsp`, and the glyphs `½ ¾ ⅓ …` (`deVulgar()`
  rewrites glyphs to `a/b`, `num()` parses mixed numbers and bare fractions). Before 2026-07-25 the
  number pattern matched only the digits after the slash, so `1/4 in` converted to `1/10.2 cm`.
  This affected the display toggle too, not just imports.
- Deliberately leaves tbsp/tsp and plain words alone (they're ~equal across systems or ambiguous).
- `setUnits(u)` persists + re-renders everything + re-opens the recipe if one is open.

### Ingredient ⇄ pantry matching
`inPantry(line)` decides whether an ingredient line is covered by the pantry. It drives the recipe
**✓ in pantry** badges and the whole Shopping "Meals you can make" panel.

It was a plain substring test until 2026-07-25, which failed in *both* directions: pantry "Eggs"
never matched `"1 egg"`, while "Milk" and "Butter" both matched `"300ml buttermilk"`. On the seeded
pancake recipe those two errors cancelled out to the same 4/7 score, which is why it looked fine.

Now: `normWords()` folds letters NFD can't decompose (`CHAR_FOLD`: ł→l, ß→ss, œ→oe, æ→ae, đ→d, ø→o),
strips diacritics (č→c, so `cebula` matches `Čebula`; also ä→a, so German `Äpfel` matches `Apfel`),
lowercases, splits on non-alphanumerics, and drops single letters and anything starting with a digit
(`200g`, `3`). Two words match if they're equal, or equal after `stemWord()` (a small English plural
stemmer: eggs→egg, tomatoes→tomato, berries→berry, while glass/hummus are left alone), or if they
share a root of ≥3 characters **and both leftovers are plausible inflection endings**
(`isInflection()` — Slovenian cases plus German plural `-n/-en/-er`). That last rule is what makes
sol→soli and Zwiebel→Zwiebeln work while keeping sol↛solata, chicken↛chickpea, butter↛buttermilk
and pea↛pear apart — a raw prefix-length threshold could not do both. A pantry item counts as
present only when **all** of its words appear in the line, so "Olive oil" needs both words but
"Tomatoes" still matches "200g cherry tomatoes".

Verified across all seven languages (60 cases): es `huevos`↔`huevo`, fr `œufs`↔`œuf`,
it `uova`↔`uovo`, pt `ovos`↔`ovo`, de `Zwiebel`↔`Zwiebeln` and `Apfel`↔`Äpfel`.

**Compound ingredients (`PHRASE_SRC` / `collapsePhrases()`, added 2026-07-25).** Word-level matching
alone could not tell "coconut milk" from "milk" or "rice vinegar" from "rice", because the shape is
identical to "cherry tomatoes", which *is* tomatoes. No rule separates them, so it takes a list.
`PHRASE_SRC` names compounds that are a **different ingredient from their parts**; they are glued
into one token (`coconut_milk`) on both the pantry and ingredient side before matching, so a bare
"Milk" can no longer find the `milk` inside it. Phrases are written naturally and normalised with
the same `rawWords()` as everything else — "huile d’olive" becomes `[huile, olive]` on its own —
and detected with `wordsMatch()`, so **inflected forms still register**: Slovenian "kokosovega
mleka" matches the phrase "kokosovo mleko". Longest phrases are tried first so "apple cider vinegar"
beats "cider vinegar". **The one rule: a phrase belongs in the list only if it is NOT merely a
variety of its head noun.** "cherry tomatoes" and "red onion" must stay out, or they stop matching.

The list now carries proper sections for all seven languages (349 entries). Two things to know before
extending it:
- **Single-word compounds do nothing and should not be added.** `PHRASES` drops anything that
  normalises to one token. They need no entry anyway: a closed compound shares no prefix with its
  head noun, so German `Kokosmilch`/`Milch` and English `buttermilk`/`milk` are already kept apart by
  the root rule. That is why German has only the handful written as separate words.
- **Duplicates across languages are fine in the source.** Spanish and Portuguese share a lot of
  compounds, and after folding `vinagre balsámico` and `vinagre balsâmico` are the same entry. Each
  language section stays complete and readable; `PHRASES` deduplicates on the way in.

**`SYNONYMS`** (175 words) maps same-meaning words to one canonical form — aubergine=eggplant,
courgette=zucchini, UK cornflour=US cornstarch — plus, since 2026-07-25, a **cross-language staples
layer**: `moka`/`harina`/`farine`/`mehl`→flour, `mleko`/`leche`/`lait`/`latte`→milk, and ~30 more
concepts across all six non-English languages. Multi-word entries use the collapsed `spring_onion`
form.

That layer only does work when the pantry and the recipe are in *different* languages, which is the
normal state here — the seed pantry is English while imported recipes are not. On the owner's own
Slovenian recipe against the English seed pantry it took matches from **1/15 to 5/15**.

Three things had to be got right for it to work at all, and each is pinned by a test:
- **`wordsMatch()` compares roots on the stems, not only the canonical forms.** A synonym can be
  listed under one form only, so in an inflected language it pulls the roots apart: with `sol→salt`,
  `sol` canonicalises to `salt` while `soli` stays `soli`, and the sol/soli match that used to work
  would have been lost.
- **`canonSet()` reaches a synonym through an inflection.** Slovenian ingredient lines are written in
  the genitive — "480 g mok**e**", "250 g masl**a**" — so the nominative `moka` in the table is never
  what appears in the text. Any word sharing a root with a key counts as that key, using the same
  inflection rule as everywhere else, so it inherits the same safeguards: `solata` still cannot reach
  `sol`. Results are memoised in `_canonCache`; measured at 0.26µs per `wordsMatch()` call.
- **Fleeting vowels have to be listed twice.** `česen`→`česna` and `poper`→`popra` change the root
  itself, not just the ending, so no rule bridges them. Every other Slovenian staple here inflects by
  suffix alone and is reached automatically.

Two entries were deliberately left out, and should stay out: Portuguese `salsa` (parsley) collides
with Spanish and Italian `salsa` (sauce), and `maçã` folds to `maca`, which is a different ingredient
in English. A wrong match is worse than a missing one.

**Hard blocker for non-Latin scripts:** the final `replace(/[^a-z0-9]+/g,' ')` is ASCII-only, so
Cyrillic/Greek/CJK/Arabic tokenise to `[]` and `inPantry()` then always returns false — every ✓
badge and the whole Shopping panel silently stop working. Adding ru/uk/el/hi means switching that
to a Unicode-aware class (`\p{L}\p{N}`) **in the same change**. Chinese and Japanese need more than
that: no spaces between words means word-based matching cannot apply at all.

`normWords()` results are memoised in `_wordCache` (a plain `Map`), since the shopping panel
re-tokenises the same strings on every render.

### AI assistant (recipe auto-fill)
- Settings → AI: pick **provider** — Claude (Anthropic) `claude-opus-5`, ChatGPT (OpenAI)
  `gpt-4o-mini`, or Gemini (Google) `gemini-3.6-flash` — paste an **API key**, optional **model**.
  The Model box is free text; leaving it blank uses the provider's default above.
- **Test connection sits next to the key box** (moved 2026-07-25). It is what you want the moment
  you have pasted a key, so it belongs there. **Disconnect was removed** from that spot: it was the
  more prominent of the two despite being much the rarer action, and clearing the field and tabbing
  out already drops the stored key — that path now removes the entry outright rather than saving an
  empty string, and reports it on the status line, since there is no longer a button to confirm it.
  The `ai_forget` label was deleted from all seven dictionaries; `ai_forgotten` stays for that
  status message.
- **The key box outranks storage** (`aiKeyVal()`, fixed 2026-07-26 after a live report). The field is
  `type=password`, so a browser password manager will fill it — and a saved password outlives
  "clear site data" and syncs between devices, while `localStorage` does neither. Reading only
  storage meant the two could disagree, and the app would print *"Add your AI API key first"*
  directly beneath a box full of dots, with no way out but retyping a key that was visibly already
  there. `aiKeyVal()` now returns the box's value and falls back to storage, so whatever the user can
  see is what gets used. Saving listens to **both `input` and `change`**: `change` alone only fires
  on blur, which misses a key that is pasted and clicked straight through, or filled by the manager.
  The regression is pinned by three tests, and `withAiKey()` had to start setting the box as well as
  storage — otherwise the suite would seed a fake key, pick up the author's real one from the box,
  and fail only on machines that have a key stored.
- The Add/Edit meal form has a **✨ Fill from a recipe** box: paste recipe **text** or a **URL**,
  click **Auto-fill** → the provider returns a JSON recipe that fills every field.
- **The recipe is written in the app's language, not the source page's** (`aiSystemPrompt()`, changed
  2026-07-25). The prompt used to say the opposite — *"keep the recipe in its ORIGINAL language
  (English or Slovenian)"* — which predated the five extra languages and was wrong for two reasons.
  Someone picks a language and stays in it; and, the part that actually breaks things, **ingredient
  matching compares a recipe against a pantry written in that same language**. A Slovenian pantry
  cannot cover an English ingredient list, so an untranslated import silently loses every
  ✓ in pantry badge and its whole contribution to the shopping list.
  `AI_LANG` maps the language code to the English name of the language (models understand
  "Slovenian"), and the clause is appended to `AI_SYS_BASE` at call time so it always reflects the
  current setting. Numbers, quantities, units and URLs are explicitly left alone — `convUnits()`
  converts them to the unit preference after parsing, and translating them would fight that.
  Tests assert the right language reaches the wire for all three providers, and it is **verified
  against live Gemini**: an English pancake recipe came back as `Klasične palačinke` / `Zajtrk` /
  `200 g gladke moke`, `300 ml pinjenca`, `1 žlička pecilnega praška`, and in German as
  `Klassische Pancakes` / `Frühstück` / `200 g Weizenmehl`, `300 ml Buttermilch`. Quantities and
  units came through untouched, as instructed.
- **Photo gallery + drag & drop** (added 2026-07-25). The Add/Edit form holds `formImages` as the
  single source of truth while open; `[0]` is the main photo. Thumbnails reorder (click) and remove
  (✕); typing a link commits on Enter or blur, and again on Save so a typed-but-not-entered link is
  never lost. Uploads accept several files at once.
  The drop target handles **two different payloads**: files dragged from the desktop (`dataTransfer.files`
  → base64 data URL) and an image dragged out of a **web page**, which arrives as `text/html` or
  `text/uri-list` and never as a File — the `text/html` branch pulls the `<img src>` out, because
  the accompanying `text/plain` is usually the *page* URL, not the image. Non-image drops are ignored.
- **The AI also extracts `image` / `images` / `sourceUrl` / `nutrition`** where the page has them.
  Only absolute `http(s)` URLs are accepted into the gallery — a page-relative path would not
  resolve. `sourceUrl` is **overwritten with the pasted URL** when importing from a link, since that
  is known exactly and is more reliable than asking the model. The prompt tells the model never to
  estimate nutrition — `null` unless the page states it.
  Verified end-to-end against `okusno.je` (Slovenian): hero image extracted and confirmed a live
  JPEG, source URL correct, real per-serving nutrition pulled from the page, Slovenian preserved.
- **Auto-fill never silently overwrites your work** (added 2026-07-25). The auto-fill box sits
  inside the **edit** form as well as the add form, so re-importing a saved recipe to pick up its
  photo and nutrition must not wipe steps you corrected. `fillItemFormFromRecipe(d, replace)` fills
  **empty fields only** by default and reports which ones it left alone; **Use imported instead**
  re-runs it with `replace=true`. **Undo** is always offered — the import can simply be worse than
  what was there, which no conflict detection catches. The snapshot is taken **once, before any
  fill**, so Undo after *Use imported instead* still returns to the true original. `openItemForm()`
  clears it so one form's undo can't leak into the next. Photos always append, never replace.
- **Imported recipes are converted to your unit preference** (`fillItemFormFromRecipe()`, added
  2026-07-25). A source recipe arrives in whatever units it used; `convUnits()` is run once over
  name/desc/ingredients/steps as they enter the form, so the recipe lands as though you had typed
  it in your own system. Time and servings are plain counts and are left alone. This is the **only**
  place units are written into stored data — everywhere else conversion is display-time, so toggling
  stays lossless afterwards. You review the converted values in the form before saving.
- **URLs** are fetched through the **`r.jina.ai`** reader proxy (returns clean page text; needed
  because browsers can't fetch most recipe sites cross-origin). That URL is sent to that service.
- **Anthropic** — header `anthropic-dangerous-direct-browser-access: true`. Opus 4.x/5 reject
  `temperature` and `budget_tokens`, so they are omitted. `max_tokens` is **8000**, not the original
  1500: on Claude Opus 5 thinking is **on by default** when the `thinking` field is omitted (Opus 4.8
  was not), and `max_tokens` caps thinking *and* answer together — 1500 could be spent reasoning and
  truncate the recipe JSON, surfacing only as "could not read the recipe". `output_config.effort` is
  set to `low` (extraction, not reasoning) but **only for model IDs in `AI_EFFORT_OK`** — the Model
  box is free text and sending `effort` to a model that doesn't support it is a 400.
- **Gemini** — `…/v1beta/models/<model>:generateContent`. The key goes in the **`x-goog-api-key`
  header**, deliberately not the `?key=` query parameter the quickstart shows: a key in the URL
  leaks into logs, history and referrers. `responseMimeType:'application/json'` makes the model
  return clean JSON, so nothing needs fence-stripping. Gemini also spends thinking tokens against
  `maxOutputTokens` (a test import used 623 thinking vs 165 answer), which is why that is 8000 too.
  Blocked prompts arrive as HTTP 200 with `promptFeedback.blockReason` — handled, not silent.
- **Verified live against the real Gemini API on 2026-07-25** (key from a git-ignored `.env`):
  `gemini-3.6-flash`, header auth, and JSON mode all work; a test recipe parsed with all 8 schema
  keys present. The Anthropic and OpenAI paths remain **untested** — no key on hand.
- Claude is the most browser-reliable of the three for CORS; Gemini also works directly from a page.
- The **API key is stored only in localStorage, sent directly to the provider, and is NOT included
  in export/import or OneDrive sync.**

---

## Data model & persistence

State lives in `localStorage` under `kitchenMenu.*` keys — every access is wrapped in try/catch
(see "Gotchas"). Keys: `items`, `schedule`, `pantry`, `shopping`, `batches`, `lang`, `units`,
`odClientId`, `odShareUrl`, `odAuto`, `fsName`, `fsAuto`, `aiProvider`, `aiKey`, `aiModel`,
`shareEmail`. Only the first five are data stores (`STORES`); the rest are settings, written
straight to `localStorage` rather than through `putKey()`, and none of them are in `syncPayload()`.

A schedule entry is `{mealId, slot}` plus an optional `batchId` linking it to a batch-cook run
(see "Batch cooking"). `batches[]` is `{id, mealId, cookDate, portions}`.

### localStorage first, IndexedDB as overflow (added 2026-07-25)
Photos are base64 data URLs and run through the ~5MB localStorage quota fast — a handful of uploads
is enough, and a meal can now hold several. `putKey()` writes each key to localStorage first; on a
`QuotaExceededError` it retries once after dropping the previous value (which sometimes frees just
enough), and failing that writes the string to **IndexedDB** (`mealmap` → `kv`) and **deletes the
localStorage copy** — so the two can never disagree about which one is current.
Reads stay synchronous from localStorage, so first paint is unchanged; `hydrateFromIdb()` runs
straight after boot, pulls back any key that is absent from localStorage but present in IndexedDB,
and repaints. A key is never in both.

**Every store is declared once, in `STORES`** — its key plus how to read and replace the in-memory
value. `saveLocalOnly()` and `hydrateFromIdb()` both walk that list, so a new store cannot end up
saved but never hydrated (or the reverse). A test asserts the list covers all five.

#### The boot race (fixed 2026-07-25) — this one could destroy the library
A key missing from localStorage means one of two things, and until IndexedDB answers you cannot tell
which: nothing was ever saved (first run), or it **overflowed** on an earlier save. In the second
case what is in memory during those first milliseconds is only the placeholder — SAMPLE meals, an
empty schedule — not the user's data.

Saving in that window was not merely racy, it was **destructive**. `putKey()` would write the
placeholder to localStorage *and* `idbDel()` the IndexedDB copy that held the real library; on the
next line `hydrateFromIdb()` would find the key present and skip it. Both copies gone, nothing to
recover from. Reproduced on a throwaway key: real library in IndexedDB → one `putKey` → localStorage
holds the placeholder, IndexedDB returns `undefined`.

The fix: `_awaitingIdb` is computed **synchronously at boot** (before any listener can fire) as the
set of store keys with no localStorage copy. `saveLocalOnly()` skips those stores and sets
`_saveDeferred`; `hydrateFromIdb()` releases each key as IndexedDB answers — in a `finally`, so a
failure cannot leave saving switched off for the session — then flushes the deferred save. First run
works unchanged: IndexedDB comes back empty, the keys release, the save goes through.

**Where the user did change something in that window, IndexedDB wins.** That is deliberate, not an
oversight: their change is at most a click or two made against placeholder data, while the IndexedDB
copy is the entire library. Losing the former is plainly better than losing the latter.
**Caveat:** the IndexedDB write is async and not awaited, so a tab closed in the same instant as an
overflowing save could lose that one write. Nothing is lost in the normal path.

**`save()` takes the stores that changed** (added 2026-07-25). `save(STORE.sched)`, `save(STORE.menu)`,
`save(STORE.sched, STORE.batches)` — anything not named is not even serialised. This matters because
`menu` carries the photos: with a 4MB library, a drag or a shopping tick went from **4.31ms to
0.00ms**, while editing a meal still pays the cost, which is correct.
**Saying nothing means "all"**, on purpose — a call site that forgets to declare what it touched
still persists everything, so a narrowing mistake can cost time but never data. `auditSave()` in
`tests.html` checks every narrowed call site by diffing all five stores around the action and failing
if anything changed that was not written; twelve tests use it.

**Identical values are not rewritten** (`_lastWritten`, added 2026-07-25). `save()` writes all five
stores whatever actually changed, and `localStorage.setItem` is synchronous — a 3MB `menu` (a few
uploaded photos will do it) costs ~7ms of blocked main thread, measured. Dragging a chip, ticking
off shopping, starring a recipe: none touch `menu`, but every one of them paid for it, and above the
quota each also threw, retried, threw again and rewrote the whole blob to IndexedDB. `putKey()` now
remembers what it last wrote per key and skips a byte-identical rewrite. Measured on ten
schedule-only saves with a ~2MB menu: **10 writes totalling 3KB, down from 50 writes totalling
~20MB.** The skip is deliberately *not* trusted blindly — it re-writes if the key has vanished from
localStorage (site data cleared mid-session), except for values it knows overflowed to IndexedDB,
where absence is the expected state. `JSON.stringify` still runs for every store on every save; if
that ever matters, the next step is passing which stores changed into `save()`.

**JSON export / sync payload:** `{ app:'kitchen-menu', version:SCHEMA_VERSION, exportedAt, menu, schedule, pantry, shopping, batches }`
(AI + OneDrive settings are intentionally excluded). `SCHEMA_VERSION` is a single constant used by
the export and both OneDrive writes — **bump it and note what changed** whenever the stored shape
changes. `1→2` predates this file; `2→3` (2026-07-25) added `images[]`, `sourceUrl` and `nutrition`;
`3→4` (2026-07-25) added `batches[]` and the optional `batchId` on schedule entries.
Every change so far has been additive, so an older file still imports: `normaliseMeal()` fills in
what it lacks on the way in, which means the difference stops mattering after one import. A v3 file
simply has no batch cooking in it, and a `batchId` pointing at a batch that isn't there renders as
an ordinary scheduled meal rather than breaking — `pruneBatches()` + `normaliseBatchDates()` run on
every import and OneDrive pull to tidy both directions. A file from a *newer* version imports too,
but warns first that unknown fields will be dropped on the next save.

**Uploaded photos are downscaled** (`downscaleDataUrl()`): long edge capped at 1600px and
re-encoded as JPEG at 0.85, which took a 10.7MB phone photo to 619KB in testing. Images already
small and light are passed through untouched, and the result is discarded if it came out bigger
than the original. Transparent pixels are painted onto **white** first — without that, PNG
transparency turns black in a JPEG. Animated GIFs keep only their first frame. Dropped *links* are
stored as links and never go through this.

- **menu item:** `{ id, name, category, emoji, time, servings, image, images:[], sourceUrl,
  nutrition:{calories,protein,carbs,fat}|null, desc, ingredients:[], steps:[] }`
  - `images[]` is the gallery, `[0]` is the main photo; entries are either `http(s)` links or base64
    data URLs. `image` is kept equal to `images[0]` purely so older render paths and existing
    exports keep working — **read through `mealImages(m)`**, which falls back to `image` for meals
    saved before the gallery existed. Never read `m.image` directly in new code.
  - `nutrition` is per serving and is `null` unless at least one value is set. Values keep their
    unit as text (`"919.3 kCal"`, `"21.1 g"`) — they are display strings, not numbers.
- **schedule:** `{ 'YYYY-MM-DD': [ { mealId, slot } ] }`, slot ∈ `breakfast|lunch|dinner|snack`
- **pantry item:** `{ id, name, qty, category, emoji, low }`
- **shopping item:** `{ id, name, done }`

**Naming note:** the app was renamed to **MealMap** in the *branding only* (header, tab title,
export download filenames → `mealmap-<date>.json/.xlsx`). Internal identifiers were **kept**:
`kitchenMenu.*` localStorage keys, the OneDrive path `/KitchenMenu/kitchen-menu.json`, and the
`app:'kitchen-menu'` JSON marker — so any saved data / existing OneDrive sync keeps working.

---

## Setup-required features (can't be tested without the user's accounts)

1. **OneDrive live sync** (Microsoft Graph + MSAL, loaded on demand).
   Needs: (a) the app **hosted at an https URL** (OAuth can't run from `file://`), and (b) a
   **Microsoft/Azure app registration** → client ID + `Files.ReadWrite.All` permission.
   Full step-by-step is in **[`ONEDRIVE-SETUP.md`](ONEDRIVE-SETUP.md)**. Behaviour: near-live (~20s poll),
   last-write-wins; the shared file is `kitchen-menu.json` in the owner's OneDrive.
2. **AI assistant** — paste a Claude, ChatGPT or Gemini API key in Settings → AI, then use the
   "✨ Fill from a recipe" box. Keys are billed per use and visible to anyone using that
   browser/file — use your own. A `.env` in the project holds a Gemini key for local testing; it is
   git-ignored and is **not** read by the app (the app only ever reads `localStorage`).

---

## Known limitations / caveats

- **Ingredient matching is word-based, not a dictionary** (`inPantry()` — rewritten 2026-07-25,
  see "Ingredient ⇄ pantry matching" below). What it still can't do:
  - **Compound nouns are handled by a list, not a rule** (`PHRASE_SRC` — 349 entries, 343 unique
    after folding), so coverage is only as good as the list. A compound that isn't in it still
    matches its head noun. Adding one is a one-line change.
  - **Irregular plurals** (leaf/leaves, knife/knives) are not linked.
  - **A 3-letter root plus a single-vowel ending still collides.** Italian `pane` matches English
    `pan`, because the root rule must accept a one-vowel difference — `maslo`/`masla` is exactly
    that shape. Pinned by a test rather than hidden. Fixing it properly means a morphology table,
    not a tweak.
  - **Grouping is coarser than matching, on purpose.** `canonName()` reduces a word to one name;
    `wordsMatch()` compares whole candidate sets. Two words can therefore match in the pantry
    without grouping on the shopping list. That is deliberate: grouping has to be an *equivalence*
    or which lines merged would depend on the order they arrived in, and `wordsMatch` is fuzzy and
    not transitive.
  - **Compound ingredient lines.** "Salt & black pepper" counts as *present* if you only have salt;
    the line is matched as a whole, never split.
  - Words with a **root under 3 letters** miss, because the shared-root rule needs ≥3 characters.
    German `Ei`/`Eier` is the notable one; `Eier`/`Eiern` is fine.
- **The 5 new languages are machine-translated** (2026-07-25) and unreviewed by native speakers.
  Key parity is verified, wording is not. **Accepted by the owner** — not a task.
- **Seed data is English-only.** A first run in any language shows English sample meals and pantry
  items. **Accepted by the owner** — not a task.
- **Only Latin-script languages are supported.** Adding Cyrillic/Greek/CJK/Arabic silently breaks
  ingredient matching — see "Ingredient ⇄ pantry matching" for what has to change first.
  **Accepted by the owner** — not a task, but read that section before adding such a language.
- **Unit conversion is best-effort regex** — unusual units or phrasings are left as-is.
- **The QR code has never been read by an actual phone** (2026-07-27). It is verified against the
  standard's published tables and round-tripped through a decoder written from the spec side, which
  between them catch any error in placement, masking, interleaving or padding — but no scanner ran.
  `BarcodeDetector` is not implemented in Chrome on Windows, so there was nothing on this machine to
  scan with. See "The QR code" for what the verification does and does not cover. **First thing to
  try once the app is hosted.**
- **The Shopping view overflows sideways at phone widths** (found 2026-07-27, **pre-existing** and
  not fixed here). In a 375px viewport `document.documentElement.scrollWidth` is 608; Menu, Pantry
  and Calendar all measure exactly 375. `.shop-panel` comes out 584px wide inside a 327px
  `.shop-grid`, so a grid track is being sized to its content rather than its container — the usual
  cause is an `auto`/`1fr` minimum resolving to min-content, wanting `minmax(0, 1fr)` and/or
  `min-width: 0`. Verified pre-existing by removing `#shopShareBtn` from the DOM and re-measuring:
  unchanged. Left alone deliberately rather than folded into an unrelated feature.
- **localStorage** may be blocked in some `file://`/sandbox contexts; the app still runs (guarded)
  but won't persist there. Opening in a normal browser or via a local server persists fine.
- **Excel is a lossy round trip.** A workbook cannot carry an uploaded photo (base64 data URLs run
  past Excel's ~32k cell limit, so the export writes `(uploaded photo)` and the import drops it) or
  a batch link (never exported — those days import as ordinary scheduled meals). Meal ids are not
  in the sheet either, so an Excel import mints new ones and re-links the Schedule rows **by meal
  name**; a plan row naming a meal the sheet does not contain is dropped and the count reported.
  JSON remains the faithful backup.
- **AI + OneDrive are tested up to the network boundary, not past it.** Since 2026-07-25 the suite
  drives both through a fake `fetch`, covering which URL is called, the headers, the request body,
  and how each provider's success and error shapes are unpicked. What it cannot cover is the far
  side: whether a real model obeys the prompt, and whether Graph behaves as documented. Those still
  need live credentials and, for OneDrive, an https origin. The AI half has been spot-checked
  manually against live Gemini using the `.env` key; OneDrive has not been exercised at all.

  **If a script says that key is invalid, suspect the script.** The `.env` carries a commented
  example line containing `GEMINI_API_KEY=AIza...`, so an un-anchored
  `/GEMINI_API_KEY\s*=\s*(.+)/` matches the *comment* and reads the 7-character placeholder
  `AIza...` instead of the real key — which fails with a confident and completely misleading
  "API key not valid". Anchor the match: `/^\s*GEMINI_API_KEY\s*=\s*(.+)$/m`.
- **No cross-tab coordination.** Two tabs open on the same browser will overwrite each other's
  `localStorage` on save; last write wins, silently. This is the same model OneDrive sync already
  uses between devices. **Accepted by the owner (2026-07-25)** — not a task.

## Gotcha that bit us (keep in mind)
**Don't use `window.confirm()` / `alert()` for anything load-bearing.** Once a browser shows
"Prevent this page from creating additional dialogs" and the user ticks it, every later `confirm()`
returns `false` **instantly and silently** for the rest of that tab. The Delete button then does
nothing at all, with no error — which is exactly how it was reported. Destructive actions now go
through `askConfirm()`, an in-app modal (`#confirmOverlay`) that returns a promise. `close()`
settles any pending confirm, so Escape / backdrop / ✕ resolve `false` instead of hanging the caller.

**Never call `localStorage` unguarded at startup.** An unguarded read in the language-init code
once threw in a sandbox and froze the whole app before any event listeners attached. Every
`localStorage` access is now in try/catch — keep it that way.

**`click` is not "where the user clicked".** It fires on the nearest common ancestor of the press and
the release. Dismissing a dialog on `e.target === overlay` therefore also fires when someone selects
text inside it, drags past the edge and lets go — the shared ancestor is the backdrop, and the dialog
vanished along with a half-filled form. The press is the deciding event now (fixed 2026-07-26): a
`pointerdown` handler records whether the press landed on the backdrop, and the `click` handler
closes only if it did. `pointerdown` rather than `mousedown` so touch and pen behave the same. If you
ever add a dialog that closes on a *synthetic* click, note that a bare dispatched `click` with no
preceding `pointerdown` no longer dismisses anything — which is the point.

**A test that says `$('.someClass')` is asserting "there is only one of these."** Reusing `.key-row`
(a two-line input-plus-button layout) in the share panel broke a passing AI test that had used
`$('.key-row')` to mean *the AI key row* — the share panel is earlier in the markup, so
`querySelector` started answering with the wrong one. The class was the right thing to reuse; the
selector was the weak part, and it now reaches the row from `#aiKey.closest('.key-row')`, which is
both unambiguous and a stronger assertion. Worth a glance whenever a shared layout class gains a
second user (2026-07-27).

**Don't mirror a value into a field and then read it from somewhere else.** The AI key box was
populated from `localStorage` at boot and read back from `localStorage` on use, so anything that
filled the box by another route — a password manager, which survives clearing site data — produced a
UI insisting there was no key while showing one. Whatever is on screen should be what the code reads.

---

## How to develop / verify
- No build. Edit the file in `js/` that owns the behaviour; `index.html` is markup only.
- **Serve it:** `node serve.js`, then open <http://localhost:8765>. (`.claude/launch.json` points at
  Node by absolute path, because the editor inherited a stale PATH.)
- **Syntax check every script:**
  `node -e "const fs=require('fs');for(const f of fs.readdirSync('js')){new Function(fs.readFileSync('js/'+f,'utf8'));console.log('OK '+f)}"`
  `new Function` **parses without executing**, which is the whole point — don't "simplify" it by
  commenting lines out first, that only introduces syntax errors of its own.
- **If you add a `js/` file, add its `<script>` tag to `index.html`** in the right position. Nothing
  discovers them automatically, and order matters (see "Layout" at the top of this file).

### Test suite — `tests.html` (added 2026-07-25)

Open <http://localhost:8765/tests.html>. **313 tests, no dependencies, no build step.** Green ticks
and a tally at the top; a failure prints the expected/actual inline. The page also sets
`window.__results = {total, pass, fail, failures[]}` and `window.__done`, so a script can poll it.

Roughly two thirds are **unit tests** over the pure logic — quantity parsing and arithmetic,
shopping-list combining, recipe scaling, unit conversion, the ingredient matcher (including the
`Eggs`/`1 egg` and `Milk`/`buttermilk` regressions that started all this), dates and plan ranges,
the batch model, storage, the **QR encoder**, and translation parity. The rest are **end-to-end**
tests that drive the real UI in an iframe: menu CRUD, the confirm modal, duplicate, favourites,
search, servings scaling, cook mode, the calendar, dragging chips between days with **both** mouse
and touch gestures, batch cooking, the pantry/shopping flows, and **sharing the shopping list**. The
**AI and OneDrive** paths are driven through a fake `fetch` (`withFetch()`, `withOneDrive()`,
`withAiKey()`) — request URLs, headers, bodies, and every success and error shape for all three
providers.

The **QR** group carries its own decoder (`qrDecode()` in `tests.html`), which is unusual enough to
flag: the encoder is ours, so a test that only re-ran the encoder's own logic would prove nothing.
It reads a finished grid the way a scanner does and refuses to return a string unless the format
info passes its BCH check in both copies and every block's Reed–Solomon syndromes are zero. See
"The QR code" for the full argument and for what it still does not cover.

Two buttons in the share panel are **deliberately never clicked** by a test: Copy would take over
the machine's real clipboard, and Email would ask the OS to launch a mail client mid-run. Both are
covered through the pure function underneath (`shopListText()`, `shareMailto()`), which is why
`shareMailto()` exists separately from its click handler at all. **Text file** *is* clicked, with
`downloadBlob` stubbed, so the filename and the blob's charset stay pinned.

The **Assembly** group is different in kind from the rest: it tests the *shape of the project* rather
than its behaviour. That the ten scripts are classic, undeferred and in the original order; that a
value from each file is reachable in the one shared global scope; that load-time derivations like
`PHRASES` and `CANON_NAMES` actually built; that `lib/` and `fonts/` are served from this origin and
nothing else is; and that `loadScript` resolves a relative path before deciding it is already loaded.
None of that is visible in normal use — it fails silently, or much later, which is exactly why it is
pinned. If one of those tests fails after a tidy-up, the tidy-up is what is wrong.

Three things about it are worth knowing before you add a test:

- **It cannot touch your data.** `putKey` — the single choke point for every write — is replaced
  with a recorder for the whole run, so no test can reach real `localStorage` or IndexedDB while the
  save logic *above* it stays under test (that is what lets the hydration hold-back be tested at
  all). Two tests assert the stub is in place and the real keys are unchanged. localStorage is also
  snapshotted and restored in a `finally` and on `beforeunload`, as a second line of defence. The
  few tests that want a genuine write use `REAL_PUT_KEY` against a throwaway key.
- **`A` is a proxy, not the iframe's window.** The app is a set of classic `<script>`s sharing one
  scope, so its `let`/`const`
  globals (`menu`, `schedule`, `batches`, `I18N`, `DRAG`, …) live in the global *lexical* environment
  and are **not** properties of `window` — `frame.contentWindow.menu` is `undefined`. Only `function`
  declarations land on the window object. `A` resolves each name by evaluating it inside the app's
  realm (`new win.Function('return menu')`), which also dodges a trap: any element with an `id`
  becomes a window property, so a plain `win.menuGrid` can hand back the element instead of the
  const that shadows it.
- **The AI tests borrow your settings, so they put them back.** `withAiKey()` saves the stored
  provider/key/model, installs a throwaway key, and restores them in a `finally`; a test asserts they
  came back unchanged. A stub that only replaced a *return value* is not enough either —
  `withOneDrive()` has to set the module-level `odItem` as well, because `odResolve()` assigns it and
  `odContentPath()` reads it.
- **A drag needs a visible calendar.** Drags are measured with `getBoundingClientRect` and resolved
  with `elementFromPoint`; while `#calendarView` is `display:none` every box is zero-sized and the
  drag silently lands nowhere. `showCalendar()` handles this and asserts the layout is real — three
  tests failed on exactly this before it existed, and they looked like app bugs.

Every test starts from a fixed fixture (`resetFixture()`), so tests cannot leak into one another,
and dates are pinned to **July 2026** so nothing depends on when the suite is run.

### Not a problem (measured, so it stays measured)
- **Search does not need debouncing.** `renderMenu()` re-runs on every keystroke, but at 120 meals a
  filtered render is **2.3ms** (1.2ms matching, 1.1ms DOM) — typing an 8-letter query costs ~19ms
  total. `normWords()` is memoised in `_wordCache`, which is what keeps the matcher cheap. If the
  library ever reaches thousands of meals, re-measure before adding complexity.
- **The QR code does not need caching or a worker.** Encoding is **0.8ms** for one item, **9.9ms**
  for a typical 14-item list (version 13), and **14.4ms** at the version-20 ceiling; a payload past
  the ceiling is refused in 2.2ms. A whole `renderShare()` for 14 items is **9.2ms**, essentially all
  of it the eight mask-penalty evaluations. That cost is paid when the panel opens and when the
  language or units change under it — not per keystroke — so it is comparable to one of the app's own
  localStorage writes. Re-measure before adding complexity; the obvious lever if it ever matters is
  scoring fewer masks.
- **No HTML-escaping holes.** Every template interpolation that lands in markup was audited; the
  seven that don't go through `esc()` are our own constants, computed numbers, or a CSS `url()` where
  a single-property setter cannot take a second declaration. `sourceUrl` is scheme-checked
  (`/^https?:/i`) before becoming an `href`.

### Releasing — `pack.ps1` (added 2026-08-04)

A release is a git tag, notes written by hand, and **`mealmap-site.zip`** — the app only, no tests,
docs, licence or build script. 1.0.0 through 1.2.0 were assembled by hand; `pack.ps1` is that
procedure written down, and it exists because two of the steps fail *invisibly on this machine*:

- **`Compress-Archive` writes backslashes into the zip's entry names.** Windows PowerShell 5.1 does
  this, the ZIP spec says forward slashes, and Windows opens the result perfectly — so the archive
  looks fine right up until someone on macOS or Linux unzips it and gets a top-level file literally
  named `css\app.css`. Every host the archive is aimed at is one of those. `pack.ps1` writes the
  entries itself through `ZipArchive.CreateEntry`, which takes the name verbatim. `git archive` also
  gets the slashes right, but adds directory entries the shipped archives do not have.
- **A hardcoded file list drops new files silently.** 1.1.0 added `js/qr.js`, and the release notes
  had to warn people to copy the whole `js/` folder. The patterns are globs (`js/*.js`,
  `lib/*.min.js`, `fonts/*.woff2`), so a new script ships without anyone remembering it — the same
  hazard as the `<script>` tag rule above, minus the person.

It refuses rather than warns, in four places: an uncommitted working tree (override with `-Force`),
a file that git does not track, a subresource `index.html` loads that is not in the archive, and a
third-party `<script src>`/`<link href>`/`<img src>` — the "no third-party requests" rule checked
once more at the point where it would ship. Anchor `href`s are exempt: a link to GitHub is a click,
not a request. Then it reads the finished zip back off disk and hashes every entry against the
working tree, because the interesting failures are the ones where what you wrote and what landed
differ.

The script is **ASCII-only on purpose.** PowerShell 5.1 reads a `.ps1` as the system codepage unless
it carries a UTF-8 BOM, and `.gitattributes` keeps this repo LF-and-no-BOM — so a single em dash in
a string is a parse error rather than a typo. It was, once, before this note existed.

```powershell
./pack.ps1          # prints the file count and size the notes quote; refuses a dirty tree
gh release create v1.3.0 mealmap-site.zip --title "MealMap 1.3.0" --notes-file notes.md --latest --verify-tag
```

`--verify-tag` is worth keeping: without it `gh` will invent a tag on the spot from whatever
`master` happens to be, which is not necessarily the tree you just packed. `mealmap-site.zip` is in
`.gitignore` — it is a build output, and a 780 KB binary that changes wholesale every release is the
last thing this repo's history needs.

Verified against the real thing: `pack.ps1` reproduces the published 1.2.0 asset byte for byte,
796,284 bytes, all 20 entries hash-identical.

## Possible next steps (offered, not yet done)
- ~~Smarter ingredient matching (singular/plural + synonyms)~~ — **done 2026-07-25**:
  plurals/declensions, then the compound + synonym lists. Still open: explicit pantry↔ingredient
  linking, and growing `PHRASE_SRC`/`SYNONYMS` beyond their English-heavy core.
- ~~Auto-build the shopping list from the week's scheduled meals.~~ — **done 2026-07-25**
  (**＋ From plan**), including **summed quantities** and **week / 7 / 14 day / month / custom
  ranges**. Still open: nothing planned here.
- ~~Convert AI-imported recipes to the current unit preference on import.~~ — **done 2026-07-25**
  (see "AI assistant"). Fixing it required teaching `convUnits()` about fractions first.
- ~~Swap the logo emoji (🍳) for a map-flavoured one; add a MealMap **favicon**.~~ — **done
  2026-07-25** (see "Brand mark" above).
- ~~Get the shopping list out of the browser and onto a phone.~~ — **done 2026-07-27**
  (**⤴ Share**: copy, share sheet, email, text file, QR). Still open: nothing planned. The QR could
  carry a *link* back into a hosted MealMap rather than plain text, which would let the phone import
  the list as data instead of showing it — that needs hosting first, and plain text has the large
  advantage of working from `file://` and needing no app on the other end.
- **Hosting and the GitHub push are the owner's** (stated 2026-07-25): the app goes on their blog and
  they will push manually. Not a task here. Hosting is still what unblocks OneDrive sync, and it is
  what would let cook mode, the touch-drag, `navigator.share` **and the QR code** be tried on a real
  phone for the first time.

**The agreed 7-feature run** (one at a time, confirming before each next one):
1. ~~Servings scaling~~ — **done 2026-07-25**
2. ~~Search inside ingredients~~ — **done 2026-07-25**
3. ~~Favourites + last cooked~~ — **done 2026-07-25** (scoped to a simple toggle + date, no ratings)
4. ~~Duplicate a recipe~~ — **done 2026-07-25**
5. ~~Print / cook mode~~ — **done 2026-07-25**
6. ~~Drag meals between calendar days~~ — **done 2026-07-25**
7. ~~Leftovers / batch cooking~~ — **done 2026-07-25** (linked instances, not scaled copies)

**All seven done.** Still open: hosting (Netlify Drop), which also unblocks OneDrive sync.

**From the 2026-07-25 review** (see "Known limitations" for the detail):
- ~~Pass which stores changed into `save()`~~ — **done 2026-07-25**. 4.31ms → 0.00ms for a drag or a
  shopping tick with a 4MB menu.
- ~~Grow `PHRASE_SRC` / `SYNONYMS` beyond their English-heavy core~~ — **done 2026-07-25**: full
  compound sections for all seven languages, plus a cross-language staples layer in `SYNONYMS`.
- ~~Extend the suite to the AI and OneDrive paths behind a fake `fetch`~~ — **done 2026-07-25**.
- Keep growing the vocabulary as real recipes turn up gaps — the cross-language layer covers ~30
  staple concepts, and anything past that is still a miss. Now that imports arrive already in the
  app's language, the layer mostly only has to cover the **English seed data**, so its job is
  smaller than it looks.
- ~~`ingSignature()` could use the cross-language canonical set~~ — **done 2026-07-25**, and it
  turned up a real corruption bug in `parseQty` on the way.
- Measure-word coverage is good for Slovenian and reasonable elsewhere; extend `UNIT_ALIASES` as
  real recipes turn up forms it does not know. Missing a Slovenian **dual** is the easy mistake.

---

## Project memory
Persistent notes for the current machine live at
`C:\Users\win11\.claude\projects\C--Users-win11-Desktop-Claude-Workspaces-MealMap\memory\`.
The older notes from the previous machine (`C:\Users\DTPC\.claude\projects\C--Users-DTPC-Desktop-menu\memory\`
— `MEMORY.md` index + `menu-app-project.md`, `user-timi-profile.md`) did **not** come across with
the project folder, so the new memory dir started empty.
