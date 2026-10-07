# Wayfarer Online — PWA (installable app)

Wayfarer Online ships as an installable **Progressive Web App**: players on Android/Chrome,
desktop Chrome/Edge and iOS Safari can "Add to Home Screen" and get a standalone,
chrome-less window with the game's own icon.

## What ships

| Piece | File | Notes |
|---|---|---|
| Web app manifest | `public/manifest.webmanifest` | name / short_name / description / start_url / scope / `display: standalone` / `background_color` / `theme_color` + icons. Copied verbatim into `dist/` by Vite (`publicDir: 'public'`). |
| Icons | `public/icons/*.png` | 192×192, 512×512 (`any`) + 192×192, 512×512 (`maskable`) + 180×180 apple-touch. Generated, not hand-drawn. |
| Icon generator | `tools/make_pwa_icons.py` | Pillow script; the reproducible source of truth for the PNGs. |
| Manifest link + theme colour | `index.html` `<head>` | `<link rel="manifest" href="/manifest.webmanifest">` and `<meta name="theme-color">`. |
| DOM install affordance | `src/ui/PwaInstall.js` | Captures `beforeinstallprompt`, shows a small Install pill, calls `prompt()`, hides on `appinstalled`. Initialised by one line in `src/main.js`. |
| Service worker (pre-existing) | `public/sw.js` | Offline app-shell + asset cache; already precaches `/manifest.webmanifest` and `/icons/icon-192.png` / `icon-512.png`. |

## Palette

The manifest and icons use the game's real Solana-inspired palette (see the `SOL` constants in
`src/scenes/TitleScene.js`):

- background `#0A0E1A` (navy) — also the manifest `background_color`
- green `#14F195` — primary accent, manifest `theme_color`
- purple `#9945FF` — secondary accent (the diagonal compass points)
- cyan `#03E1FF` — highlight (the compass hub)

## The install flow

1. The browser fires `beforeinstallprompt` once the site meets the install criteria
   (valid manifest, served over HTTPS, an active service worker). This event **only** fires
   when the app is genuinely installable, so the UI never nags.
2. `src/ui/PwaInstall.js` captures the event (`e.preventDefault()`), then reveals a small
   fixed "⬇ Install" pill.
3. Tapping the pill calls `deferred.prompt()` — a real user gesture, hence a real DOM element.
4. On acceptance the app is installed and `appinstalled` fires; the module tears the pill down.
5. The pill is a **DOM** element at `z-index: 8` (above the game canvas at `1`, below the boot
   splash at `10`) so it stays hidden until the splash clears.

The pill deliberately **does not show on the login/title screen**: `TitleScene` owns the
wayfarer-name field and the Play buttons and already draws its own Phaser install button, so
the DOM pill waits until the player is out of the login scene. It also never shows when the
app is already running installed (`@media (display-mode: standalone)`, or iOS
`navigator.standalone`).

## Regenerating the icons

Requires Pillow (already used across `tools/`).

```sh
python tools/make_pwa_icons.py
```

This rewrites every file in `public/icons/`:

```
icon-192.png        192×192  (purpose: any)
icon-512.png        512×512  (purpose: any)
maskable-192.png    192×192  (purpose: maskable)
maskable-512.png    512×512  (purpose: maskable)
apple-touch-icon.png 180×180 (linked from index.html)
```

The emblem is a pixel-art 8-point "wayfarer" compass rose (green cardinal arms, purple
diagonal arms, cyan hub). It is decided on a 32×32 master grid and then scaled by an exact
integer factor with NEAREST (192 = 32×6, 512 = 32×16), so the pixel edges stay crisp. The
`maskable` variants have no frame and the art is kept inside the ~80 % circular safe zone so
Android's adaptive masks never clip it.

After regenerating, sanity-check the real dimensions:

```sh
python -c "from PIL import Image; import glob, os; [print(os.path.basename(f), Image.open(f).size, os.path.getsize(f)) for f in sorted(glob.glob('public/icons/*.png'))]"
```

## Deploy notes (.vercelignore)

`public/manifest.webmanifest` and `public/icons/**` are **not** covered by any `.vercelignore`
pattern, so `vite build` copies them into `dist/` and Vercel serves them as static files. The
existing `.vercelignore` only prunes `public/assets/audio/music/*.wav`,
`public/trailer/index.html` and `public/trailer/pure_gameplay_trailer.html` (plus the
build-time-only `server/`, `tools/`, `videos/`). **No `.vercelignore` change was needed** — if
icons ever move under an ignored path, add a file-level negation (e.g. `public/trailer/*` +
`!public/trailer/icon-192.png`) rather than un-ignoring the whole directory.

## Verify

- Manifest is valid JSON with the required keys and every referenced icon exists at its real
  declared size.
- Booting the built client shows zero page errors and the world starts as before.
- Login (name field → Play → into the world) is unaffected by the install pill.
