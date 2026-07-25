# Vendored fonts

The two typefaces the app uses, served from here rather than from Google.

| File | Family | Subset | Size |
|---|---|---|---|
| `Fraunces-latin.woff2` | [Fraunces](https://fonts.google.com/specimen/Fraunces) | latin | 66 KB |
| `Fraunces-latin-ext.woff2` | Fraunces | latin-ext | 58 KB |
| `Inter-latin.woff2` | [Inter](https://fonts.google.com/specimen/Inter) | latin | 47 KB |
| `Inter-latin-ext.woff2` | Inter | latin-ext | 83 KB |

`../css/fonts.css` declares them, with the `unicode-range` values Google
generated, so the browser only downloads the subset a page actually needs.

## Why these four and not more

Google offers each family in seven subsets — latin, latin-ext, cyrillic,
cyrillic-ext, greek, greek-ext, vietnamese. Every language MealMap supports is
Latin-script, and **latin-ext is what carries the Slovenian č, š and ž**, so the
other five are dead weight here. Add one back if you ever add a language that
needs it.

Both are **variable** fonts. Asking Google for discrete weights
(`wght@...500;600;700`) makes it emit one `@font-face` per weight all pointing at
the same file — 12 downloads, 4 distinct, 762 KB for 254 KB of actual font.
Asking for the range (`500..700`) gives one face per subset with a weight range:
identical rendering, a third of the bytes.

## Refreshing them

```bash
# Fetch the stylesheet as a modern browser (a plain curl gets ttf, not woff2),
# then download the woff2 URLs it lists and repoint them at ../fonts/.
curl -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36" \
  "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500..700&family=Inter:wght@400..600&display=swap"
```

## Licensing

The rest of MealMap is public domain (see [`../UNLICENSE`](../UNLICENSE)).
**These files are not.** Fraunces and Inter are both licensed under the
[SIL Open Font License 1.1](https://openfontlicense.org), which permits
redistribution and embedding but requires the licence to travel with the fonts.
If you strip everything else out, keep this file.
