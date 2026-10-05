# Persistence Audit — forged-progress hole (server/validate.js)

Date: 2026-10-05. Scope: `server/validate.js` targeted patches + this doc only.
Method: throwaway node probes importing `server/validate.js` directly
(`sanitizeProgress`), no relay. Probe script was deleted after use; raw logs
at `/tmp/probe_before.log` / `/tmp/probe_after.log`.

## Hole

`sanitizeProgress` passed `prog` through nearly raw (12 KB JSON cap only, no
field sanitize) and `ext` via `sanitizeExtras` (48 KB cap only). Client-declared
`prog.paths`, `prog.nodes`, `ext.arena`, `ext.pets`, `ext.housing` reached disk
unvalidated — any relay client could upload forged spec points, node unlocks,
arena rating, or oversized housing blobs.

## Before (all forged values survived to disk)

| Probe | Submitted | Stored (before) |
|---|---|---|
| prog.paths `{might:99}` | `{might:99,ward:0,spirit:0}` | identical (raw) |
| prog.paths wild | `{might:99999,ward:-5,spirit:'x'}` | identical (raw) |
| prog.nodes 200 ids | 200 entries | all 200 stored |
| prog.nodes mixed `[123,null,{},"ok-id","ok-id",""]` | 6 entries | all 6 stored verbatim |
| ext.arena | `{rating:999999,wins:5,losses:2}` | identical (raw) |
| ext.housing layout ×100 / trophies ×30 | 100 / 30 | 100 / 30 stored |
| unknown ext blobs `{evilBlob,foo}` | arbitrary JSON | identical (raw) |

## Fix (inline mirrors — the server imports no client modules)

In `server/validate.js` (`sanitizeProgShape` + `sanitizeArena` +
`sanitizeHousing`, wired into `sanitizeProgress`/`sanitizeExtras`):

- `prog.paths` → `{might,ward,spirit}` ints clamped 0..999 (mirrors
  `src/data/stats.js` `sanitizePaths`/`clampSpecInt`).
- `prog.nodes` → deduped non-empty string ids, cap 64 (mirrors
  `sanitizeSpecNodes`/`SPEC_NODES_MAX`), each id sliced to 96 chars.
- `ext.arena` → rebuilt as `{rating,wins,losses}` only;
  rating int 100..3000 (start 1000, floor 100 per `docs/ARENA.md`, K=32),
  wins/losses ints 0..999999. Non-object arena is dropped.
- `ext.housing` → rebuilt: `unlocked` bool, `plot` string-or-null,
  `layout` ≤40 / `trophies` ≤12 with string ids and coords clamped to grid
  12×9 / rot 0..3 (mirrors `src/data/housing.js` `LAYOUT_RULES` bounds),
  `yieldClaim` `{date≤10ch, amount≥0}`. Non-object housing is dropped.
- Everything else (rest of `prog`, `ext.pets`, unknown ext blobs) still passes
  through under the existing 12 KB / 48 KB caps — the client loaders
  (`normalizeExtras`/`normalizeHousing`/`ensureSpecState`) re-validate on load.

Known residuals (accepted, documented): `might:99` survives because 99 is
inside the legit 0..999 range (client accepts it too — no server-side point
budget exists to check against); unknown furniture/trophy ids are kept (the
server has no catalogue; the client loader drops them on load, so they are
inert); `ext.pets` and unknown ext blobs pass through size-capped.

File size: `server/validate.js` 11361 → 15274 bytes (+3913).

## After (forged values clamped, legit values byte-identical)

| Probe | Submitted | Stored (after) |
|---|---|---|
| prog.paths `{might:99}` | as-is | identical (within 0..999 cap) |
| prog.paths wild | `{might:99999,ward:-5,spirit:'x'}` | `{might:999,ward:0,spirit:0}` |
| prog.nodes 200 ids | 200 entries | first 64 kept |
| prog.nodes mixed | 6 entries | `["ok-id"]` (non-strings + dupe dropped) |
| ext.arena | `{rating:999999,...}` | `{rating:3000,wins:5,losses:2}` |
| ext.housing layout ×100 / trophies ×30 | 100 / 30 | 40 / 12 |
| unknown ext blobs | arbitrary JSON | pass through (by design, size-capped) |
| legit: paths 4/0/0, nodes `wayfarer.might.1`/`wayfarer.ward.2`, arena 1050/3/1, small housing | as-is | **byte-identical** (`diff` of P8 probe lines before/after: no output) |

## Merge gates (run foreground, after the patch)

- `node tools/econ_test.mjs` → **35/35 checks passed** (`ECON OK — 35 checks
  passed`, exit 0, log `/tmp/gate_econ.log`).
- `node tools/econ_audit_dupes.mjs` → **13 probes, 0 exploited**
  (0 critical/high, 0 inconclusive, exit 0, log `/tmp/gate_dupes.log`).
- No test expectations touched. No commit/push/deploy.
