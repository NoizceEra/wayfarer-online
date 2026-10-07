# Wayfarer Online — Live Performance Audit

**Target:** https://www.wayfareronline.fun/ (the deployed Vercel static build)
**Method:** every number below comes from an actual request I made on 2026-10-07, either
`curl` against the live origin or a headless-Chrome (Puppeteer/CDP) load of the live page
with a **fresh browser profile (no service-worker cache)**. Nothing here is estimated,
computed from source, or derived from a local build. Where I could not measure something
I say so explicitly.
**Scope:** measurement only. No source file was changed. Scratch probes lived in `$TMPDIR`.

Live build fingerprint observed: entry chunk `/assets/index-CyMzRkdT.js`, vendor chunks
`phaser-BKRXJHP4.js` / `net-Cqgvgk2l.js`, lazy chunk `gameplay-CmpvJNhm.js`.

---

## 1. What a real visitor downloads on the login screen

Measurement: Puppeteer (headless Chrome), fresh profile, `Network.enable`, page
`https://www.wayfareronline.fun/`, observed for 15 s.

- **929 requests**, **10,070,754 bytes** on the wire in the first 15 s of a cold visit.
- Headless navigation timings from this host (not a visitor-bandwidth figure):
  TTFB 251 ms, DOMContentLoaded 1,692 ms, load 2,662 ms.

Bytes by asset group (from the same CDP run):

| Group | Requests | Bytes (wire) |
|---|---:|---:|
| `/trailer/*` (login background GIF) | 2 | 7,174,316 |
| `audio` (`mus_title.ogg` + warmed SFX) | 31 | 958,711 |
| JS chunks (4 chunks) | 4 | 895,801 |
| `assets/na/Actor/Character` sprite sheets | 110 | 432,656 |
| `assets/na` other | 160 | 211,626 |
| `assets/na/Actor/Monster` sprite sheets | 61 | 207,213 |
| `assets/custom` | 90 | 121,161 |
| fonts | 4 | 111,527 |
| everything else | — | 4,039 + 2,630 (index.html) |

The single login-background GIF accounts for **~71% of all bytes** the page moves.

### Entry JS that must be present before the login is interactive

The live `index.html` loads `index-CyMzRkdT.js` as the entry `<script type="module">`
and `modulepreload`s `phaser-BKRXJHP4.js` and `net-Cqgvgk2l.js`. The entry chunk statically
imports both:

```
$ curl -sS https://www.wayfareronline.fun/assets/index-CyMzRkdT.js | grep -oE 'from"\./[^"]+"'
from"./net-Cqgvgk2l.js"
from"./phaser-BKRXJHP4.js"
```

so all three must download before `main.js` can execute (Phaser + the network layer are
imported at module top-level). Measured per-chunk:

| Chunk (URL) | Raw bytes | Wire bytes (br) |
|---|---:|---:|
| `/assets/index-CyMzRkdT.js` | 400,100 | 136,272 |
| `/assets/phaser-BKRXJHP4.js` | 1,208,635 | 341,933 |
| `/assets/net-Cqgvgk2l.js` | 127,210 | 42,509 |
| **Critical-path JS total** | **1,735,945** | **520,714** |

Browser-measured `encodedDataLength` for the same three requests in one CDP run:
136,607 + 342,358 + 42,689 = **521,654 bytes over the wire** (differences of a few hundred
bytes are HTTP chunk/header overhead). So the login screen must pull **≈521 KB of
compressed JS (≈1.70 MB uncompressed)** before it is interactive.

`/assets/gameplay-CmpvJNhm.js` (1,140,806 B raw / ~374 KB wire) is **not** on that path:
the entry chunk pulls it via `import("./gameplay-CmpvJNhm.js")`, and in the live run the
browser requested it at **3,256 ms**, i.e. after `load` (2,662 ms). It is lazy — good.

---

## 2. Login video / trailer and music — are they fetched eagerly?

**Yes, both are fetched with no user interaction.**

**Background video — eager.** `index.html` contains
`<video id="bg-video" autoplay loop muted playsinline poster="/trailer/wayfarer_login_bg.gif">`
with `<source src="/trailer/wayfarer_login_bg.mp4">`. In the live CDP capture:

- `/trailer/wayfarer_login_bg.gif` → **Image, 200, requested at 283 ms, 7,174,342 bytes**
  (the poster GIF is fetched immediately to paint behind the canvas).
- `/trailer/wayfarer_login_bg.mp4` → **Media, 206 Partial Content**, streamed at login.
  Full size from the response: `Content-Range: bytes 0-0/10057373` → **10,057,373 bytes**.

So the login screen pulls **≈7.17 MB of GIF + up to 10.06 MB of MP4** of background
media before the player touches anything.

**Title music — eager.** `src/scenes/TitleScene.js` calls `audio.musicFor('title')` in
`create()`; `systems/audio.js` maps `title → mus_title` and `fetch()`es it via XHR. Live:

- `/assets/audio/music/mus_title.ogg` → **XHR, 200, requested at 2,683 ms, 958,687 bytes**.

**SFX — also prefetched, but slightly later.** `src/assets/loader.js` (`preloadWorld`,
`AUDIO.sfx`, served by `assets/audio/sfx/*.ogg`) queues 30 SFX oggs; the live run requested
them at **~5.6–5.8 s** (after the lazy gameplay chunk). They are not needed for the title
screen itself, but they are on the boot path to the world.

---

## 3. Cache headers observed (live, quoted verbatim)

Requested with `curl -sSI https://www.wayfareronline.fun<path>`:

| URL | `Cache-Control` (observed) |
|---|---|
| `/` (entry HTML) | `public, max-age=0, must-revalidate` |
| `/assets/index-CyMzRkdT.js` | `public, max-age=31536000, immutable` |
| `/assets/phaser-BKRXJHP4.js` | `public, max-age=31536000, immutable` |
| `/assets/net-Cqgvgk2l.js` | `public, max-age=31536000, immutable` |
| `/assets/gameplay-CmpvJNhm.js` | `public, max-age=31536000, immutable` |
| `/assets/fonts/*/*.ttf` | `public, max-age=2592000, stale-while-revalidate=604800` |
| `/assets/audio/music/mus_title.ogg` | `public, max-age=2592000, stale-while-revalidate=604800` |
| `/icons/icon-192.png` … `/icons/maskable-512.png` | `public, max-age=604800, stale-while-revalidate=86400` |
| `/manifest.webmanifest` | `public, max-age=86400` |
| `/sw.js` | `no-cache, max-age=0, must-revalidate` |
| `/favicon.svg` | `public, max-age=0, must-revalidate` |
| `/trailer/wayfarer_login_bg.gif` | `public, max-age=0, must-revalidate` |
| `/trailer/wayfarer_login_bg.mp4` | `public, max-age=0, must-revalidate` |
| `/trailer/wayfarer_agent_arena_promo.mp4` | `public, max-age=0, must-revalidate` |

Interpretation: the hashed `/assets/*.js|css` rule is correct (`immutable`, 1 year), and
`/assets/{fonts,audio,na,custom}/*` + `/icons/*` + the manifest are sensibly cached. But
**everything under `/trailer/` falls through to Vercel's default `public, max-age=0,
must-revalidate`** — the 7.17 MB GIF and 10.06 MB MP4 are cache-busted on **every visit**.
`favicon.svg` also gets `max-age=0` (tiny, minor).

---

## 4. 404s / missing files

**No 404s found.** I requested every asset referenced by the live `index.html`, plus the
likely browser side-requests, all returning **200**:
`/favicon.svg`, `/manifest.webmanifest`, `/icons/apple-touch-icon.png`,
`/assets/fonts/silkscreen/Silkscreen-Regular.ttf`,
`/assets/fonts/jacquard12/Jacquard12-Regular.ttf`, `/assets/index-CyMzRkdT.js`,
`/assets/phaser-BKRXJHP4.js`, `/assets/net-Cqgvgk2l.js`, `/assets/gameplay-CmpvJNhm.js`,
`/trailer/wayfarer_login_bg.mp4`, `/trailer/wayfarer_login_bg.gif`, `/sw.js`.
The CDP capture of the full live load recorded **zero** 4xx/5xx.

Two non-error anomalies worth knowing (not 404s):
- `/trailer/wayfarer_login_bg.mp4` returns **206** (Range) because the `<video>` streams it — expected.
- `/favicon.ico` and `/robots.txt` return **200 with `Content-Type: text/html`** — the SPA
  catch-all rewrite in `vercel.json` serves `index.html` for them. They are not real files.
  (The manifest/HTML already pin `/favicon.svg`, so this is cosmetic, not a 404.)

---

## 5. Recommended wins (NOT implemented)

Low-risk, high-leverage, in expected-impact order:

1. **Stop shipping the 7.17 MB GIF as the login background poster.**
   *File:* `index.html` — the `<video … poster="/trailer/wayfarer_login_bg.gif">`
   attribute (and the nested fallback `<img id="bg-gif" src="…gif">`).
   *Measured basis:* the GIF is fetched at 283 ms and is **7,174,316 bytes = ~71% of all
   bytes the page moves**. *Expected effect:* drops ~7.17 MB from every cold login; replace
   the poster with a tiny static still (or the existing `/trailer/` webp/png) or drop it —
   the MP4 paints the first frame anyway.

2. **Cache `/trailer/*` media.**
   *File:* `vercel.json` — add a headers entry for `/trailer/:path*` with
   `Cache-Control: public, max-age=31536000, immutable` (the filenames are stable content).
   *Measured basis:* both the GIF and MP4 are currently served `public, max-age=0,
   must-revalidate`, so the 10.06 MB MP4 (and the GIF until win #1 lands) re-download on
   every return visit. *Expected effect:* repeat visitors stop re-pulling ~10 MB per visit.

3. **Defer or shrink the title music.**
   *File:* `public/assets/audio/music/mus_title.ogg` (re-encode) **or**
   `src/scenes/TitleScene.js` (move the `audio.musicFor('title')` call behind the first
   pointer/key event).
   *Measured basis:* `mus_title.ogg` is fetched at 2,683 ms as a **958,687-byte** XHR before
   any interaction; browsers block-until-gesture audio anyway, so it can start on first tap.
   *Expected effect:* ~0.96 MB less on the login path with no lost functionality.

Secondary (noted, lower priority): `favicon.svg` is served `max-age=0` (trivial); the
world preload fires ~400 sprite-sheet requests (~1.0 MB) during login — deferring that
loader until the player commits would cut boot bandwidth, but that is behavior change, not
a header/markup tweak.

---

## 6. What I could NOT measure

- Real-world visitor timing (LCP/INP on real hardware/network). My timings are headless
  Chrome from this host and are **not** representative of a visitor's connection.
- Field/CrUX data for the live URL (no access to the owner's analytics).
- Whether mobile Safari fetches the poster GIF vs. the MP4 in the same order as headless
  Chrome (the eager *references* are in `index.html`; sizes are exact, fetch ordering is
  engine-specific).
- Full duration of the MP4 stream: the capture recorded the initial `206` but did not run
  long enough to confirm the entire 10,057,373 bytes were buffered; the file's total size
  is confirmed independently via `Content-Range`/`Content-Length`.
