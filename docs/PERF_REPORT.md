# Performance report (bundle / load / runtime)

Baseline = master 61b786e. After = this branch. Tools: `tools/perf_measure.mjs` (Playwright + CDP, brotli static server,
network/CPU throttling) and `tools/sw_update_test.mjs`. Headless Chromium here has **software** WebGL (about 1 fps) and no H.264
decoder, so FPS numbers are only comparable run-to-run; use them for relative CPU cost, not as device FPS. Baseline runs were
partly disturbed by concurrent builds, so treat baseline FPS as indicative only. Byte/request counts are deterministic.

Throttle profiles: fast4g = 9 Mbit/s down, 170 ms RTT; slow4g = 1.6 Mbit/s down, 150 ms RTT; cache disabled, cold load.

## What regressed
1. Login trailer: `wayfarer_login_bg.mp4` was 1080p60 (9.8 MB) with `autoplay` and a **7 MB animated GIF as poster**, both fetched on
   first paint. Title-interactive transferred 8.5 MB, 99 percent of it trailer.
2. `@solana/web3.js` (315 KB raw / 91 KB gz) was statically imported by WalletPanel, so it sat in the gameplay chunk.
3. The title chunk carried Creator/Guild/Home scenes, skillVfx, wearArt, iconArt, the asset loader and the whole colyseus client.
4. LFG / season / guild panels, dungeon/season/guild systems were each constructed **twice** (UIScene and economyUI): duplicate
   Phaser containers and duplicate `room.onMessage('*')` listeners.
5. Title music (~1 MB) fetched at title create, competing with the world asset preload.
6. Phaser full build (includes Matter.js, unused).

## Chunks (raw / gzip-9 / brotli, bytes)
| chunk | before | after |
|---|---|---|
| phaser | 1,208,635 / 330,668 / 264,771 | 1,097,673 / 296,436 / 237,010 (arcade-only build) |
| index (title code) | 384,993 / 128,564 / 108,268 | 178,372 / 64,369 / 55,659 |
| net (colyseus) | 127,210 / 40,593 / 35,912 (startup) | 127,588 / 40,675 / 35,899 (on first connect) |
| gameplay | 1,120,938 / 360,465 / 295,480 | 915,058 / 301,447 / 246,331 |
| solana (web3) | inside gameplay | 315,064 / 90,768 / 76,824 (on first wallet balance fetch) |
| loader, npcs, gearArt | inside index | 89 KB raw / 27 KB gz, loaded after title paint |
| 8 lazy panels (LFG, season, arena, arena challenge, spec tree, leaderboard, party finder, token sinks, token bridge) | inside gameplay | 2-10 KB each, on first open |

JS needed for title: before 500 KB gz (brotli 409 KB) -> after 361 KB gz (brotli 293 KB), a 28 percent cut. Phaser is now 82 percent of it.

## Network (cold, cache off)
| run | metric | before | after |
|---|---|---|---|
| fast 4G | title-interactive | 3.09 s, 11 req, 2,523 KB (GIF still downloading) | 2.46 s, 8 req, 475 KB |
| fast 4G | world-ready | 21.3 s, 480 req, 10,160 KB | 17.8 s, 481 req, 1,370 KB |
| slow 4G | title-interactive | 7.58 s, 11 req, 1,250 KB (GIF still downloading) | 3.99 s, 8 req, 475 KB |
| slow 4G | world-ready | 37.7 s, 479 req, 6,420 KB (+1.5 MB more by +8 s) | 28.7 s, 481 req, 3,055 KB |
| no throttle | title-interactive | 1.99-2.02 s, 7.5-8.3 MB | 0.68-0.9 s, 475 KB |
| no throttle | long-task ms before title | 702-1014 | 247-500 |

(Title 475 KB = 3 js + html + 4 fonts + poster 49 KB.) World-ready on slow 4G is dominated by ~440 sprite/UI PNGs (~1.4 MB) plus
gameplay chunk; bytes at world-ready fell about 7x on fast 4G because the 9.8 MB mp4 and 7 MB GIF are no longer downloaded.
The trailer mp4 (1.4 MB) is requested only after world assets finish (or first key/pointer), only on a non-coarse pointer, not
Save-Data, effectiveType 4g, no reduced-motion. Verified: desktop requests it ~after world-ready, mobile never does (poster only).

## Memory / FPS (headless, canvas renderer, town, HUD open)
| | before | after |
|---|---|---|
| JS heap at title | 12.4 MB | 12.1 MB |
| JS heap in world (CDP) desktop canvas | 38.8 MB (webgl run) / 33.6 MB | 19.9 MB (canvas) / 38.4 MB (webgl) |
| DOM nodes in world | 2,300-2,340 | 1,620-1,630 (duplicate panels removed) |
| desktop canvas frame | 135.6 ms avg (disturbed run) | 36.8 ms avg, update 6.5 ms |
| mobile emu (390x844, 4x CPU, canvas) | 119.7 ms, quality low | 94.4 ms, quality low |
Texture memory unchanged (25 MB). Phone profile defaults to quality `low` (verified `fxSettings` quality = low on coarse pointer).
CPU profile in town (canvas): >90 percent is Phaser rendering/canvas calls; game-side top entries are the cull `willRender` hook
(71 ms/6 s), `aiTick` (39 ms) and scene updates (<35 ms each). No per-frame allocation or DOM thrash hotspot worth a code change was
found, so none was made beyond removing the duplicated systems/panels. The adaptive governor (`core/perf.js`) was exercised: it
lowered high -> med on the slow software-GL run (`governor.lowered = 1`).

## public/ assets
public/ went from about 33.1 MB to 17.4 MB. Trailer mp4 10.06 MB -> 1.43 MB (1280x720, 30 fps, CRF 29, +faststart; it is a 0.75
opacity background), GIF 7.17 MB deleted (replaced by a 49 KB WebP poster taken at t=9 s). Remaining: 2,109 PNG = 4.25 MB (pixel art,
left untouched: already tiny, lossless), music/ambience 11.3 MB OGG at about 100 kb/s VBR (lazy, not re-encoded to avoid
generation loss), fonts 0.34 MB. No unreferenced bundle-size offenders found; `.vercelignore` already drops dev-only trailer html.
Largest files: mus_forest 2.0 MB, trailer mp4 1.4 MB, mus_boss 1.4 MB, mus_crypt 1.1 MB, mus_village_alt 1.1 MB, amb_dungeon 1.0 MB, mus_title 0.96 MB.

## Service worker
- Hashed JS/CSS precached per build; `net-*` and `solana-*` chunks are excluded from precache (cached on first use by cache-first rule).
- Trailer/poster live outside `/assets/`, and range requests are bypassed: the SW never caches the video. Verified no `trailer`/`.mp4`/`.webp` in any cache.
- Update flow tested across two builds (`tools/sw_update_test.mjs`): load A -> serve B -> `reg.update()` -> "New version available" prompt shown -> RELOAD
  -> controlled by B, `wf-shell-A` deleted, `wf-assets-v1` retained.
- `vercel.json`: added 7-day cache header for `/trailer/*`. The SW stamp plugin now respects `--outDir`.

## Smoke
`node tools/smoke.mjs`: on master and on this branch the same two flaky failures occur, both caused by the `daily-reward` modal opening
during the panel loop (Esc does not close it; typing in chat then sees a leaked panel). Not touched here.
