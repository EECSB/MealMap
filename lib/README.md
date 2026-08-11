# Vendored libraries

Third-party code, copied in rather than pulled from a CDN. Both are loaded **on
demand** — nothing here is fetched unless you actually use the feature.

| File | Library | Version | Licence | Loaded when |
|---|---|---|---|---|
| `msal-browser.min.js` | [@azure/msal-browser](https://github.com/AzureAD/microsoft-authentication-library-for-js) | 3.30.0 | MIT | you press **Connect OneDrive** |
| `xlsx.full.min.js` | [SheetJS](https://sheetjs.com) | 0.20.3 | Apache-2.0 | you press **Export Excel** |

## Why they are here and not on a CDN

A host with a strict `Content-Security-Policy` blocks scripts from other origins,
and OneDrive sign-in would then fail with nothing on screen to explain it. Served
from the same origin as the app, both work behind any CSP, and offline.

The trade is that updates are manual. If a security fix lands, re-download the
file and update the version in this table.

```bash
# MSAL
curl -o lib/msal-browser.min.js https://cdn.jsdelivr.net/npm/@azure/msal-browser@3/lib/msal-browser.min.js
# SheetJS
curl -o lib/xlsx.full.min.js https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js
```

## Licensing

The rest of MealMap is released into the public domain (see [`../UNLICENSE`](../UNLICENSE)).
**These two files are not.** They keep their own licences, MIT and Apache-2.0 as
listed above, and both require that the copyright notice be preserved — which it
is, in the banner comment at the top of each minified file. Leave those banners
alone.
