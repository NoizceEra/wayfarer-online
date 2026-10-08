# Wayfarer Online — Login Payload Wins (measured)

**Scope:** the login/title screen only. No `src/` or `server/` file was touched.
Every number below comes from a real run on 2026-10-08 (headless Chrome via
puppeteer against a local `vite build` served by `python -m http.server`, plus
`curl` against the live origin). Nothing is estimated from source.

Baseline for the "before" numbers is the tree as it stood at the start of this
change (`index.html` still pointing `<video poster>` at the 7.17 MB GIF).

---

## 1. What changed

| File | Change |
|---|---|
| `index.html` | `<video poster>` now points at the small WebP still; the `<img id="bg-gif">` fallback points at the same still and is upgraded to the animated GIF **only if the video errors** |
| `vercel.json` | new `headers` rule: `/trailer/:path*` → `Cache-Control: public, max-age=31536000, immutable` (all existing rules untouched) |
| `public/trailer/wayfarer_login_poster.webp` | **new** — 27,416 B, 1920×1080 WebP still extracted from `wayfarer_login_bg.mp4` |
| `tools/make_login_poster.py` | **new** — reproducible generator for the still |
| `docs/PERF_WINS.md` | this file |

The animated GIF (`wayfarer_login_bg.gif`) and the MP4 are **not deleted**; the
GIF remains the true fallback and is still fetched whenever the trailer cannot
play. It is simply never fetched on a normal visit.

## 2. Before / after — measured

Puppeteer (Chrome, `Network.enable`), load `/`, observe 15 s, sum
`encodedDataLength` over all requests. Same build settings, same host, same
15 s window for both runs.

| Metric | Before | After | Δ |
|---|---:|---:|---:|
| Total bytes the login screen pulls | **11,902,571** | **4,823,249** | **−7,079,322 (−59.5 %)** |
| Requests | 928 | 928 | 0 |
| `/trailer/` image fetch | 7,170,370 B (`wayfarer_login_bg.gif`) | 27,605 B (`wayfarer_login_poster.webp`) | −7,142,765 |
| GIF fetched? | yes | **no** | — |
| `pageerror` events | 0 | 0 | — |

Poster: **27,416 B on disk**, 27,605 B over the wire (the extra ~189 B is the
response header block, consistent with the GIF's 7,170,180 → 7,170,370).

The live audit measured the same GIF at **7,174,316 B = ~71 % of all bytes the
page moved** (`docs/PERF_AUDIT.md`), so removing it is the single biggest
measured win for real visitors.

**Caveat on the totals:** the local static server (`python -m http.server`)
serves JS uncompressed, so the local totals are larger than production (which
serves brotli). The trailer media is uncompressed on both, so the
**−7.14 MB media delta is exact**; the percentage drop would be even larger on
the live origin.

## 3. The poster

`tools/make_login_poster.py` extracts one frame from the existing trailer and
encodes it as WebP:

```bash
python tools/make_login_poster.py
# -> public/trailer/wayfarer_login_poster.webp (27,416 bytes, 1920x1080 webp q82)
```

It is pinned (t=1.0 s, 1920×1080, libwebp q82) so it regenerates byte-for-byte
after a trailer re-render. t=1.0 s is the fully faded-in logo card: dark,
on-brand, HUD-free, and it is what the `<video>` itself paints first, so the
poster→video handoff does not flash.

Fallback behaviour (both verified by aborting requests in Chrome):

- **Poster missing** → video still plays (`readyState 4`, not paused), title
  scene renders, **0 pageerrors**.
- **Video missing** → the `<img id="bg-gif">` src is upgraded to
  `wayfarer_login_bg.gif` and the animated fallback loads (`naturalWidth 640`),
  title scene renders, **0 pageerrors**. The GIF is requested **only** in this
  case.

## 4. Cache headers

Added to `vercel.json`:

```json
{
  "source": "/trailer/:path*",
  "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }]
}
```

Why this is safe with stable (non-hashed) filenames:

- The trailer media is static, shipped artwork — not user- or request-specific.
- The only thing that references these URLs is `index.html`, which is itself
  served `public, max-age=0, must-revalidate`, so any change to *which* file the
  page points at takes effect on the next visit immediately.
- These filenames are stable, and the rule's one operational requirement is
  therefore: **never overwrite a trailer file in place.** If the login trailer is
  ever re-rendered, publish it under a new filename (or purge the CDN). Doing
  that keeps the 1-year immutable cache correct.
- Today both `/trailer/*` files are served `public, max-age=0, must-revalidate`,
  so the 10.06 MB MP4 re-downloads on **every** visit; after this rule, repeat
  visitors stop re-pulling it.

## 5. `.vercelignore`

Checked. It prunes only two **file-level** trailer entries —
`public/trailer/index.html` and `public/trailer/pure_gameplay_trailer.html` —
and has **no** directory-level `public/trailer/*` pattern, so the new
`public/trailer/wayfarer_login_poster.webp` is not pruned and ships in the
deploy. **No change was needed.**

If a `public/trailer/*` pattern is ever introduced, the poster must be
re-included alongside the existing media, e.g.:

```
public/trailer/*
!public/trailer/wayfarer_login_bg.mp4
!public/trailer/wayfarer_login_bg.gif
!public/trailer/wayfarer_login_poster.webp
```

## 6. Verification performed (real runs)

- `node -e JSON.parse(vercel.json)` → valid; 7 header rules; trailer rule present;
  the SPA rewrite is intact.
- `index.html` parsed with Python `html.parser` → no mismatched/unclosed tags;
  the one inline `<script>` parses under `new Function()`.
- `npm run build` → success; the poster is copied into `dist/trailer/`.
- Chrome boot: title scene active → `goCreator('solo')` → `creator` → `Enter` →
  `world, ui, character, overlay, combathud` all active, `combatRead.ready=true`,
  `hotbar.length=5`, **0 pageerrors / 0 console errors / 0 loaderrors**.
- Login screen screenshots: pixel text readable; buttons are
  `BEGIN YOUR JOURNEY`, `ENTER THE PUBLIC WORLD`, `INSTALL APP`, `DOCS` — **no**
  `Host Co-Op` / `Join Co-Op` / `Character Creator`.

### Cache-Control actually observed (quoted from real response headers)

`vercel dev` **does not apply the `headers` config in dev mode** — measured:
`/trailer/*`, `/assets/*.js` and `/sw.js` all return
`Cache-Control: public, max-age=0, must-revalidate` (Vercel's default), and
`/sw.js` does **not** get its configured `Service-Worker-Allowed: /`. So the
production rule cannot be observed through `vercel dev`.

Real headers from the **live production edge** (`curl -sI https://www.wayfareronline.fun/...`):

```
/trailer/wayfarer_login_bg.gif   -> Cache-Control: public, max-age=0, must-revalidate   (the before state)
/trailer/wayfarer_login_bg.mp4   -> Cache-Control: public, max-age=0, must-revalidate
/sw.js                           -> Cache-Control: no-cache, max-age=0, must-revalidate (configured rule applied)
/assets/<chunk>.js               -> Cache-Control: public, max-age=31536000, immutable   (configured rule + exact target value)
```

`/sw.js` and `/assets/*.js` prove the live Vercel edge applies this project's
configured `Cache-Control` rules; the `/trailer/:path*` rule uses the same
mechanism and value, so it takes effect on deploy.
