# OneDrive live sync — setup guide

This makes everyone with the link share **one live copy** of your menu and meal‑plan,
stored as a `kitchen-menu.json` file in **your** OneDrive.

> You only do steps 1–3 **once** (you, the owner). Everyone else just does step 5.
> The manual **Export / Import** buttons keep working at all times as a backup — you
> don't need any of this if you're happy sharing the file by hand.

---

## What you need
- A Microsoft account (the one whose OneDrive will hold the data).
- The app available at a real web address (not a local file). OAuth sign‑in refuses
  to run from `file://`, so the app must be **hosted**.

---

## Step 1 — Host the app (get a link)
Anything that serves the file over `https://` works: your own blog, GitHub Pages,
Netlify Drop (`https://app.netlify.com/drop` — drag the `MealMap` folder on, no account
needed), Vercel, Cloudflare Pages.

**Then open the hosted page and copy the address bar exactly.** That string is your
redirect URI, and "exactly" is not a figure of speech — see the two traps below.

### Trap 1: the redirect URI must match the page's real URL, character for character
The app registers `location.origin + location.pathname`, so:

| You open | Redirect URI to register |
|---|---|
| `https://blog.example/mealmap/` | `https://blog.example/mealmap/` |
| `https://blog.example/mealmap/index.html` | `https://blog.example/mealmap/index.html` |
| `https://blog.example/mealmap` | `https://blog.example/mealmap` |

Those are **three different URIs** as far as Microsoft is concerned. If your blog serves
the page at more than one of them, register all of them — it costs nothing, and it saves
an hour of "why does sign-in say the redirect URI doesn't match".

> **For this deployment** the app lives at <https://eecs.blog/BlazorApps/MealMap>. Open it,
> see what the address bar actually settles on, and register **that** — a host may quietly
> redirect `/MealMap` to `/MealMap/`, or serve `/MealMap/index.html`. Whichever you land on
> is what MSAL will send. Registering all three removes the guesswork.

### Trap 2 — fixed 2026-07-25, but check the upload
This used to say that a blog's `Content-Security-Policy` could block the sign-in library, because
MSAL was loaded from a CDN. **It is now vendored in `lib/msal-browser.min.js`** and served from your
own origin, so no CSP can block it.

What replaces that trap is simpler: **`lib/` has to actually be uploaded.** If it is missing, Connect
fails with *"Could not load the Microsoft sign-in library — check that lib/msal-browser.min.js was
uploaded."* Deploy the whole folder, not just `index.html`.

<details>
<summary>The old CDN warning, kept for reference</summary>

Sign-in loaded MSAL from a CDN (`cdn.jsdelivr.net`). Plenty of blog platforms set a
**Content-Security-Policy**, and if its `script-src` did not allow `cdn.jsdelivr.net`,
the library never loaded and Connect failed with *"Could not load the Microsoft sign-in
library"*. Check with the browser console open — a CSP violation says so in red.

If your blog does set a CSP you cannot change, OneDrive sync will not work there. The
**Keep a file up to date** option in Settings has no such dependency and is the better
choice in that case.

</details>

## Step 2 — Register a Microsoft app (get a client ID)
1. Go to **https://entra.microsoft.com** → **Applications** → **App registrations**
   → **New registration**. (Or portal.azure.com → "Microsoft Entra ID" → App registrations.)
2. **Name:** `Kitchen Menu` (anything).
3. **Supported account types:** choose
   *"Accounts in any organizational directory and personal Microsoft accounts"*.
4. **Redirect URI:** platform **Single‑page application (SPA)**, value = your link
   from Step 1 (paste the exact page URL, e.g. `https://your-site.netlify.app/`).
5. Click **Register**, then copy the **Application (client) ID** (a GUID).

## Step 3 — Permissions
1. In the app registration → **API permissions** → **Add a permission**
   → **Microsoft Graph** → **Delegated permissions**.
2. Add **`Files.ReadWrite.All`** and **`User.Read`** → **Add permissions**.
   (Personal accounts consent themselves at first sign‑in; no admin needed.)

---

## Step 4 — Create the shared file (owner, once)
1. Open the hosted app, click **⚙️ Settings**.
2. Paste your **client ID** into "Microsoft app (client) ID".
3. Click **Connect OneDrive** and sign in / consent.
4. Click **Set up shared file**. This creates `KitchenMenu/kitchen-menu.json` in your
   OneDrive and an **edit link**, which appears in the "Shared file link" box.
5. **Copy that link** and send it to the other people (plus the app URL and client ID).
6. Tick **Auto‑sync changes**.

## Step 5 — Everyone else
1. Open the same app URL, click **⚙️ Settings**.
2. Paste the **client ID** (same one) and the **Shared file link** from the owner.
3. Click **Connect OneDrive**, sign in.
4. Tick **Auto‑sync changes**. Done — edits now flow to everyone.

---

## How it behaves
- **Auto‑sync on:** your changes upload ~1.5 s after you make them; the app pulls the
  latest every ~20 s. So it's *near*‑live, not instant.
- **Conflict rule:** last save wins. If two people edit the very same moment, one set of
  changes can be overwritten. Fine for a small, trusted group; not a database.
- **Manual buttons:** **Load now** / **Save now** force a sync immediately.
- **Privacy:** the data lives in *your* OneDrive. The edit link grants edit access to
  anyone who has it — treat it like a password and only share with people you trust.

---

## Testing it (nobody has, yet)

The automated suite covers this code **up to the network boundary** — which URL is
called, the bearer token, the request body, and how success and failure are unpicked —
by faking `fetch`. What it cannot cover is the far side: whether the app registration is
right, whether consent works, and whether Graph behaves as documented. As of
2026‑07‑25 **none of that has ever been run against real Microsoft servers.**

Once hosted, work through this in order. Each step fails differently, so stopping at the
first failure tells you which one is wrong.

1. **Page loads over https** — open it, check the console is clean.
2. **MSAL loads** — open Settings, then check the Network tab for `msal-browser.min.js`
   returning 200. A CSP block or a 404 shows here (Trap 2 above).
3. **Client ID accepted** — paste it, press **Connect OneDrive**. A popup should appear.
   *"Enter your Microsoft app (client) ID first"* means the box is empty.
4. **Sign-in and consent** — sign in; first time you should see a consent screen listing
   Files and Sign-in. A redirect-URI complaint here is Trap 1.
5. **Status line** — after consent it should read `✓ Connected as <you>`.
6. **Set up shared file** — press it. Then check OneDrive itself: there should be a
   `KitchenMenu/kitchen-menu.json`, and the **Shared file link** box should have filled in.
7. **Save now** — change a meal, press it, then open the file in OneDrive and confirm the
   change is in the JSON.
8. **Load now** — edit the JSON in OneDrive by hand (change a meal name), press it, and
   confirm the app updates.
9. **Auto-sync** — tick it, change something, wait ~2 s, confirm the file changed. Then
   change the file and wait ~20 s for the app to notice.
10. **Second person** — on another machine/browser: paste the same client ID *and* the
    shared link, Connect, then **Load now**. This is the only step that exercises the
    `/shares/` path, and the only one that proves sharing works at all.

If step 10 fails but 1–9 pass, the problem is the share link or `Files.ReadWrite.All`
consent, not the sync code.

## Troubleshooting
- *"Enter your Microsoft app (client) ID first"* — paste the GUID from Step 2.
- Sign‑in popup blocked — allow popups for the site, then click Connect again.
- `Graph 403 / 401` — re‑check the `Files.ReadWrite.All` permission (Step 3) and that
  you consented at sign‑in.
- Sign‑in error about redirect URI — the URL in Step 4 must **exactly** match the SPA
  redirect URI you registered in Step 1/2 (trailing slash matters). See Trap 1.
- *"Could not load the Microsoft sign-in library"* — either you are offline, or the page's
  Content-Security-Policy is blocking `cdn.jsdelivr.net`. See Trap 2.
- Nothing happens and the console is silent — check you are on `https://`, not `file://`.
  OAuth refuses to run from a local file, by design.

---

## If this is more trouble than it is worth

**Settings → 💾 Keep a file up to date** does the same job with none of the setup: pick a
file inside a folder OneDrive already syncs on your computer, and the OneDrive desktop app
does the syncing. No app registration, no client ID, no redirect URI, no CDN, and nothing
that breaks when your blog's URL changes.

The trade-off is reach: it needs Chrome, Edge or Opera **on a computer**. Phones and
Firefox and Safari cannot do it, and that is where this OneDrive path still earns its
keep.
