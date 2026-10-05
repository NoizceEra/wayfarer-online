# SYNC_PERSISTENCE — client ⇄ server save round trip

How a progression field travels from a client save, through server sanitize and
store, back to the client loader, and which clamps guard each hop.

## Paths

```
client                                   server                              client
──────                                   ──────                              ──────
saveProgress(name, rec)                  onSave -> validateSave(prev, prog)  welcome.save.progress
  -> localStorage (wayfarer.progress)      -> sanitizeProgress(p)              -> applyWelcome -> saveProgress
  -> saveHooks -> net.queueSave            -> validateSave rate/gain clamps      -> localStorage
     -> room.send('save', {progress})      -> saveChar(rec)                    -> loadProgress(name)
                                                (rec REPLACES the record)        -> normalizeGearState / normalizeExtras
                                                                                 -> ModularPlayer.applyProgression(rec.prog)
                                                                                    (= sanitizeProgression)
```

Client sanitizers: `src/core/save.js` (`sanitizeProgression`, `normalizeExtras`),
`src/data/stats.js` (`sanitizePaths`, `sanitizeSpecNodes`), `src/data/housing.js`
(`normalizeHousing`).
Server sanitizers: `server/validate.js` (`sanitizeProgress`, `sanitizeExtras`,
`sanitizeProgShape`, `sanitizeArena`, `sanitizeHousing`).

Because `validateSave` **replaces** the whole stored progress, any field the
client's outgoing payload omits is erased. The client's outgoing `ext` is
exactly `normalizeExtras(loadProgress().ext)` (WorldScene.saveNow `ext: this.meta`),
so **`normalizeExtras` must carry every field that must survive** — anything it
drops is deleted server-side on the next save.

## Round-trip status (proved by execution, realistic payloads)

| field | client write | server sanitize | client load | verdict |
|---|---|---|---|---|
| `prog.paths.{might,ward,spirit}` | int 0..999 | int 0..999 | int 0..999 | OK |
| `prog.nodes[]` | dedup string ids, ≤64 | dedup, ≤64, id sliced ≤96 | dedup, ≤64 | OK |
| `prog.respecs` | int 0..999 | int 0..999 | int 0..999 | OK |
| `prog.alloc/statPoints/skillPoints/skills/adv` | passthrough | passthrough (client re-clamps on load) | sanitized | OK |
| `ext.quests.active[tut_*/jk_*/jw_*/aw_*/fw_*]` | `{p:[…],t,cdone?}` | passthrough | passthrough | OK |
| `ext.quests.done.*` | flag | flagMap | flag | OK |
| `ext.quests.tracked` | ≤3 ids (MAX_TRACKED) | passthrough | filter strings, ≤3 | OK |
| `ext.quests.bounty` | object | passthrough | passthrough | OK |
| `ext.arena.{rating,wins,losses}` | mirror (fix) | **server-authoritative** (fix) | mirror | OK |
| `ext.housing.*` | normalizeHousing (drops unknown id) | shape+grid clamp (keeps unknown id) | normalizeHousing | OK |
| `ext.pets.*` | passthrough | passthrough | normalize (cap 6) | OK |
| `ext.stashTabs` | int 0..5 | int 0..5 | int 0..5 | OK |
| `ext.bridgeDailyClaimed` | `{date,amount}` | `{date≤10,amount≥0}` | same | OK |
| top-level `quest` (legacy) | passthrough | kept if JSON < 24 000 | kept | OK |

## Hostile-input clamping (correct behaviour, not a bug)

| field | hostile in | clamped to |
|---|---|---|
| `prog.paths.might` | 99999 / -5 / 'x' | 999 / 0 / 0 |
| `prog.nodes` | 90 entries | 64 (`SPEC_NODES_MAX`) |
| `prog.nodes[i]` len | 200 | 96 (server; see divergence) |
| `prog.respecs` | -5 | 0 (**fix**) |
| `ext.arena.rating` | 999999 | 3000 (floor 100) |
| `ext.arena.wins` | -3 | 0 |
| `ext.stashTabs` | 99 | 5 |

## Fixes (this change)

1. **`ext.arena` was silently dropped by the client loader** (`src/core/save.js`
   `normalizeExtras` had no `arena` key), so every client save uploaded an `ext`
   without arena and `validateSave` replaced the record → **the stored arena
   rating/wins/losses were erased** on the next periodic/exit save.
   Fix: `normalizeExtras` now mirrors `ext.arena` (`rating` clamp 100..3000
   default 1000; `wins`/`losses` ≥0), matching server `sanitizeArena`.
2. **Arena is server-authoritative** (`server/arena.js` writes it directly into
   the record); a client can only mirror the last value it saw. A stale client
   value must not overwrite an advanced rating. Fix: `validateSave`
   (`server/validate.js`) now keeps the **stored** arena whenever the previous
   record has one, so a client save can never erase or regress it. First save /
   no prior arena falls back to the clamped client value (or the arena default).
3. **`prog.respecs` was not clamped server-side** (`sanitizeProgShape` spread it
   through, so `-5` was stored verbatim). Fix: clamp to 0..999, mirroring the
   client `sanitizeProgression`.

## Cross-boundary notes for the parent

- **Node-id length divergence (latent, not triggered):** the client keeps node
  ids at full length; the server slices to 96 (`sanitizeProgNodes`). Current
  catalogue ids are far shorter, so no realistic id is mutated. If a future id
  exceeds 96 chars, tighten the client (`sanitizeSpecNodes` in `src/data/stats.js`)
  too.
- **Housing unknown-id asymmetry (by design):** the server keeps unknown
  furniture/trophy ids (it has no catalogue) while the client loader drops them.
  Unknown ids are therefore inert across a save, not lost data.
- **Everything else was already symmetric**; `prog.alloc/statPoints/skillPoints`
  are not clamped server-side but are re-sanitized by the client on load
  (`applyProgression` → `sanitizeProgression`), so hostile values never reach
  gameplay.
- `WorldScene.saveNow` / `NetworkManager` needed no change: carrying arena in
  `normalizeExtras` is sufficient for the client to stop erasing it.

## Merge gate

After any change to `server/validate.js`:

```
node tools/econ_test.mjs          # must stay 35/35
node tools/econ_audit_dupes.mjs   # must stay 13 probes / 0 exploited
```

Both run in the foreground (they abort with "stdin is not a tty" if backgrounded).
