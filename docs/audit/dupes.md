# Wayfarer Online — economy duplication & race audit

Auditor track: **duplication / race / inflation**. Repo `D:/ai-studio/wayfarer-online` @ `6fc0c35`.
Scope read: `server/economy.js`, `server/econStore.js`, `server/store.js`, `server/validate.js`,
`server/social.js`, `server/WayfarerRoom.js`, `src/systems/trade.js`, `src/net/economyNet.js`,
`src/core/save.js`, `src/systems/social/index.js`, `src/net/socialNet.js`, `src/ui/SocialPanels.js`.

Nothing in this report is inferred from reading code alone — every claim below comes from a probe
that was executed against a real relay on a private temp `DATA_DIR`, asserting on files the
**server** persisted (`DATA_DIR/players/*.json`, `DATA_DIR/economy/market.json`), never on what a
client claims.

## PoC runner

`tools/econ_audit_dupes.mjs` — self-contained, never writes to the repo, spawns its own relay on a
free port with its own temp `DATA_DIR`, drives it with real `colyseus.js` clients over the real
WebSocket protocol.

```
node tools/econ_audit_dupes.mjs                     # all 13 probes (~190s)
node tools/econ_audit_dupes.mjs --only <probe-id>   # one probe
node tools/econ_audit_dupes.mjs --race-iterations 200
node tools/econ_audit_dupes.mjs --keep              # keep DATA_DIR for inspection
```

Exit **1** if any critical/high probe fires (regression gate), **0** if none, **2** on harness
failure. Probes whose timing races produced no settled round are reported as `INCONCLU` and never
counted as safe (`--strict` makes them fail too).

Run used for this report:

```
cd /d/ai-studio/wayfarer-online && node tools/econ_audit_dupes.mjs
→ exit 1 ; relay pid 15400 on port 2718; 13 probes, 6 exploited, 5 at critical/high, 0 inconclusive (186s)
```

## Findings table

| # | Probe id | RANK | Result | Root cause |
|---|---|---|---|---|
| F1 | `save-first-upload-gold-mint` | **critical** | EXPLOITED | `server/validate.js:59-66` clamp skipped when no server record exists |
| F2 | `wildcard-forged-trade-done` | **critical** | EXPLOITED | `server/WayfarerRoom.js:121-131` `'*'` passthrough broadcasts unknown client types |
| F3 | `econout-equipped-bypass` | **high** | EXPLOITED | `server/economy.js:186-190` econOut strip only walks `progress.inventory` |
| F4 | `save-item-mint-to-gold` | **high** | EXPLOITED | `server/validate.js:34` + `server/validate.js:116-121` saves never whitelisted |
| F5 | `save-gold-rate-farm` | **high** | EXPLOITED | `server/validate.js:64` clamp is relative to the last save, not to wall time |
| F6 | `gift-path-shadowed-inert` | medium | blocked (dead code) | `server/economy.js:242/258` shadows `server/social.js:233/244` |
| F7 | `bag-overflow-40v30` | low | EXPLOITED | `server/validate.js:34` (40) vs `server/validate.js:84` (30) |
| R1 | `race-two-tabs` | critical | blocked 0/20 | `server/economy.js:612` lockRev is checked, + `hasItems` re-check |
| R2 | `race-double-confirm` | critical | blocked 0/20 | `server/economy.js:284-291` / `:623` one-shot `TRADES.delete` |
| R3 | `race-double-mail-claim` | critical | blocked 0/20 | `server/economy.js:408-422` mail fields zeroed before `await commit` |
| R4 | `race-confirm-then-leave` | critical | blocked 0/20 | `executeTrade` mutates both sides synchronously, then commits durably |
| R5 | `race-double-buy` | critical | blocked 0/20 | `server/economy.js:365` listing deleted before the first `await` |
| — | `forged-trade-respond` | low | blocked | `server/economy.js:242-249` REQUESTS gate (:238,:244) |

---

## F1 — `critical` — first save of a fresh token is never clamped (unbounded gold/item mint)

**Root cause** `server/validate.js:59-66`: the level/gold clamp is inside `if (pp)`. With no
previous server record (`pp === null`) the whole clamp is skipped, and `sanitizeProgress` only
bounds gold by the absolute `CAPS.GOLD_MAX`. `mutate()` (`server/economy.js:84-97`) writes the
record straight into the store and never runs `validateSave`, so the minted value is then an
authoritative server value.

**PoC** `node tools/econ_audit_dupes.mjs --only save-first-upload-gold-mint`

**Real output**

```
── [1/13] EXPLOITED [critical] First save of a fresh token is unclamped -> mint GOLD_MAX, launder it through the real trade
   A throwaway character stored 9,999,999 gold and 3 items on its first save (clamped=null); it then handed
   1,000,000g + angel_wings to a normal character through the server-checked trade, and that character's own save kept the laundered gold.
   · fresh-token save accepted: clamped=null, stored gold=9999999
   · stored bag: ["angel_wings","bandit_mask","bat_wings"] (validate.js:34 caps at 40 and never applies isGearId)
   · trade-results: A={"ok":1,"gold":8999999} B={"ok":1,"gold":1000000}
   · recipient server copy after the trade: gold=1000000 inventory=["angel_wings"]
   · recipient's own follow-up save kept it: saved={"savedAt":1790868254844,"clamped":null} -> gold=1000000
```

**Why it matters** This defeats the *entire* "play first, earn second" rule with two messages and no
gameplay: mint on a throwaway token, then launder into a real character through the
server-authoritative trade path (which legitimately moves the gold, so the recipient's own save is
never clamped — the value is now server-trusted). Repeatable forever with a new token per mint, so
the effective ceiling on the economy is unbounded.

## F2 — `critical` — any client can forge server→client messages to every peer (`'*'` passthrough)

**Root cause** `server/WayfarerRoom.js:121-131` broadcasts any client message whose type has no
registered handler, stamping the sender's `sessionId` on the payload. The economy's "swallow" list
(`server/economy.js:215-217`) registers no-op handlers only for the types it thought of, and a no-op
listener is the *only* way to suppress a type (colyseus keeps exactly one handler per type,
`@colyseus/core/build/Room.js:468`; `'*'` fires only for unregistered types, `Room.js:752`).
`trade-done` is not in that list, and the client sink `src/net/socialNet.js:23-30` — unlike the
economy sink `src/net/economyNet.js:74` — has **no** `sessionId` guard, so it accepts the forged
frame as its own and runs `onTradeDone` (`src/systems/social/index.js:365`), which persists via
`saveNow()`.

**PoC** `node tools/econ_audit_dupes.mjs --only wildcard-forged-trade-done`

**Real output**

```
── [2/13] EXPLOITED [critical] Any client can forge server->client messages to every peer via the "*" passthrough
   · peer received forged trade-done: {"gold":999999,"item":"angel_wings","sessionId":"thPD_fUXL"}
   · peer received forged duel-start: {"a":"thPD_fUXL","b":"ABnD2GdY8","sessionId":"thPD_fUXL"}
   · peer received forged party-update: {"id":"p1","leader":"thPD_fUXL","members":[...],"sessionId":"thPD_fUXL"}
   · peer received forged econ-sync (a REGISTERED type): null — the economy.js:215 swallow correctly stops this one
   · peer received forged pvp-hit: null — pvp-hit is registered by social.js:288 so '*' does not fire (third-party duel damage is NOT forgeable)
   · victim server copy after the client persisted it: gold=0 inventory=[]
```

**Why it matters** This is remote, unauthenticated griefing from any connected client: the victim's
own client applies the forged `trade-done` and then *saves the emptied character back*, so the loss
is permanent and server-side. `trade-done` is only the frame I weaponised — `duel-start`,
`party-update`, `trade-sent`, `whisper-sent` and `presence-gone` are all in the same
unregistered-but-consumed set (they are injected by the same wildcard, which is why they are the
default behaviour rather than an oversight in one handler). Any client→client type added later is
forged for free; the design must be an allowlist, not denylist-driven.

## F3 — `high` — the econOut dupe guard is defeated by re-uploading the item in `equipped`

**Root cause** `server/economy.js:180-191`: the guard computes the allowed count as
`inventory + equipped`, but when stripping the surplus it only walks `m.progress.inventory`
(`lastIndexOf`), and `if (i < 0) break;` abandons the item with an explicit comment assuming the
surplus must be in the bag. Uploading the traded item as `equipped.back` puts the surplus entirely
in `equipped`, so the loop breaks on the first iteration with nothing stripped and nothing reported.

**PoC** `node tools/econ_audit_dupes.mjs --only econout-equipped-bypass`

**Real output**

```
── [3/13] EXPLOITED [high] econOut dupe guard defeated by re-uploading the traded item in the equipped map
   · trade-result A: {"ok":1,"id":"T2","rev":1,...,"delta":{"gold":50,"add":[],"remove":["angel_wings"]}}
   · A server copy right after the trade: inventory=[] equipped={} econOut=["angel_wings"]
   · A server copy after the re-upload: inventory=[] equipped={"back":"angel_wings"}
   · stale/econ-sync refusal on that save: null (null = the save was accepted)
   · total angel_wings across A+B server copies: 2
```

**Why it matters** `econOut` exists precisely to stop the "trade it away, then re-upload it" dupe.
Bypassing it means every item that ever moved through the economy can be duplicated by the partner
that gave it away (and by the seller after a sale), one copy per save, with the equip slot as a
free extra carrying slot that the guard never inspects. Severity high rather than critical only
because it needs a modified client (the shipped UI always sends the real bag) and yields one copy
per traded item rather than an unbounded mint — but the copies are real, server-side, and tradable.

## F4 — `high` — the server stores item ids it has never heard of, and the economy then trusts them

**Root cause** `server/validate.js:34` filters the inventory by *string length only*; the comment at
`validate.js:73-75` says this is deliberate ("a stale whitelist must never delete items from a
character"). But `hasItems` (`server/validate.js:116-121`) then treats the stored bag as proof of
ownership for trade (`server/economy.js:265`), lock (`:275`) and market-post (`:341`), so an id the
server cannot even name becomes a real, sellable item.

**PoC** `node tools/econ_audit_dupes.mjs --only save-item-mint-to-gold`

**Real output**

```
── [4/13] EXPLOITED [high] Save upload accepts arbitrary gear ids (no whitelist) -> items minted and sold for gold
   · server copy after the mint save: ["bandit_mask","bat_wings","angel_wings","bandit_mask"]
   · A market-post result: {"text":"Listed Seraph Wings for 100g (fee 5g)."}
   · B market-buy result: {"text":"Bought Seraph Wings for 100g."}
   · A mailbox with gold attachment: {"id":"M1",...,"from":"Market Board","subject":"Sold: Seraph Wings",...,"gold":100,"items":[]}
   · A server copy afterwards: gold=195 inventory=["bandit_mask","bat_wings","angel_wings","bandit_mask"]; B: gold=900 inventory=["angel_wings"]
```

**Why it matters** It converts the F1 mint into an *advertised, purchasable* good: real players pay
real gold for items that were never dropped. It is also the inflation pump that gives the mint
liquidity. Note the correct fix must respect the owner's rule — do **not** filter unknown ids out of
saves (that deletes items); refuse to let them cross the economy boundary instead (D3).

## F5 — `high` — the gold clamp is relative, so an idle client farms gold by re-saving

**Root cause** `server/validate.js:64`: `maxGold = prev.gold + CAPS.goldBase + dt*goldPerSec`. The
ceiling is recomputed from the *last accepted* value, so every accepted save raises it by
`goldBase` (1500) plus wall-time. `CAPS.goldBase`/`goldPerSec` (`validate.js:20`) are a *margin* for
one plausible play session, not a per-save award; nothing bounds the total short of `CAPS.GOLD_MAX`.

**PoC** `node tools/econ_audit_dupes.mjs --only save-gold-rate-farm`

**Real output**

```
── [5/13] EXPLOITED [high] AFK save loop farms gold: the clamp is relative, so every save raises the ceiling
   An idle character with no gameplay gained 8 accepted +gold saves (12846 gold total, net +12846) purely by
   re-uploading a save every ~2.6s.
   · rounds that raised the stored gold: 8/8, gains per save: [1506,1620,1620,1620,1620,1620,1620,1620]
   · final server-side gold: 12846 (seeded at 0); 'saved' acks seen: 8
```

**Why it matters** ~620 gold/second with zero gameplay (the save rate bucket, 0.5/s burst 4, is the
only limiter) — about 2.2M gold/hour/character, 9.9M (the cap) in under 5 hours, from a script with
no client at all. Combined with F4 this is the mechanism that puts that gold into circulation.

## F6 — `medium` — the owner's trust-model `/gift` relay is inert today, and unsafe tomorrow

**Root cause** Two modules register the same message types. `server/economy.js:258` (`trade-offer`)
and `:242` (`trade-respond`) are installed after `server/social.js:233/244`, and colyseus keeps one
handler per type (`Room.js:468`), so the social relay — the code path behind the owner's
`/gift` / `socialTradeCmd` / `pendingTrade` / `acceptTrade` — is unreachable. The same shadowing kills
`social.js`'s guild-create/join/leave (`economy.js:450/464/493`).

**PoC** `node tools/econ_audit_dupes.mjs --only gift-path-shadowed-inert`

**Real output**

```
── [6/13] blocked   [medium] /gift quick-gift is dead code: economy.js shadows the social.js relay handler
   · recipient inbox trade-offer count: 0 (expected 0)
   · sender received: {"msg":"That trade is closed.","code":"closed"}
   · sender trade-sent count: 0
   · the same shadowing kills social.js guild-create/guild-join/guild-leave (economy.js:450/464/493)
```

**Why it matters** Two answers in one: (a) today `/gift` is **not** forgeable/replayable/self-giftable
because it never runs — the economy answers `econ-error` instead; but (b) `server/social.js:232-255`
is exactly the trust model the brief warns about — the responder's client is simply *told*
`trade-done {gold, item}` with the sender's identity, no ownership check anywhere, and the sender
deducts locally on `done`. One `git revert`/reload that drops `economy.js` makes `/gift` live with
that relay behind it. The fix must fold the gift into the economy's session/rev path (D5), not delete
the command.

## F7 — `low` — server accepts 40 bag items, the client bag holds 30

**Root cause** `server/validate.js:34` `slice(0, 40)` vs `ECON.BAG_SIZE = 30`
(`server/validate.js:84`, mirrored by `src/core/save.js:9`); the client truncates on ingest
(`src/net/economyNet.js:150`).

**PoC** `node tools/econ_audit_dupes.mjs --only bag-overflow-40v30`

**Real output**

```
── [8/13] EXPLOITED [low] Backpack overflow: the server keeps 40 items while the client bag is 30
   · server inventory length: 40
   · econ-state inventory length: 40
   · ECON.BAG_SIZE=30 (server/validate.js:84), client BAG_SIZE=30 (src/core/save.js:9)
```

**Why it matters** Up to 10 server-held items are invisible and unusable to their owner, and the
"bag full" gates in trade/market/mail (`economy.js:364/382/413`) disagree with what the player sees,
so a listing can be refused for a full bag the player believes has 10 free slots.

---

## Races that are genuinely safe (attempted, not reproduced)

All five were driven with **two or more independent sockets** and same-tick message pairs, 20 rounds
each with **fresh clients per round** (so no rate bucket was ever the limiting factor), asserting on
the server store. The invariant in each is a *conservation count* of real items read from
`DATA_DIR/players`, which is why a "both sides report ok" ack can be distinguished from an actual
duplication.

| Race | Method | Result |
|---|---|---|
| `race-two-tabs` | one character, **exactly 1 copy** of `angel_wings`, two tabs offer that same copy to two partners, all four confirms in the same tick | **0/20** duplicated; the world never held more than 1 copy |
| `race-double-confirm` | same session, duplicate `trade-confirm` sent twice in one tick | **0/20**; 30 copies in, 30 copies out |
| `race-double-mail-claim` | two sockets claiming the same `mail-claim` id with the same explicit `rev` in the same tick | **0/20** double claims (mail fields are zeroed before the `await commit`) |
| `race-confirm-then-leave` | both confirm in the same tick, then a **real disconnect** mid-window (plus the explicit single-shot case) | **0/20**; `disconnect-after-confirm: copies on the leaver=1, on the partner=0` — the swap is atomic, exactly one copy exists |
| `race-double-buy` | two buyers `market-buy` the same listing id in the same tick | **0/20** double sells (the listing is deleted synchronously before the first `await`) |
| `forged-trade-respond` | `trade-respond` with no pending request | rejected: `"That trade request has expired."` |

Raw summary line from the run: `13 probes, 6 exploited, 5 at critical/high, 0 inconclusive`.

## UNVERIFIED HYPOTHESES (not demonstrated, deliberately not claimed)

* **Guild-bank race / overflow.** `db.guilds` was reachable only through handlers that are shadowed
  by `economy.js` on the live path (see F6); I could not create a guild over the wire, so I could not
  drive a two-member same-tick withdraw. I did **not** verify a guild-bank dupe and I am not claiming
  one. Blocked by: no reachable guild-create/join path in this build.
* **Stale-client / old-save replay.** `econOut` is minted per item and the save path requires an
  explicit `rev`, so replaying an old save should be rejected — but I did not build a replayed-save
  probe, so this is untested in either direction. F3 is the demonstrated defect in that guard.
* **Duel reward duplication** (owner's priority 5). Out of my measured set: I confirmed third-party
  and non-opponent `pvp-hit` is **not** forgeable (registered by `social.js:288`, so `'*'` never
  fires — see F2 evidence), but I did not test duplicate win rewards, safe-zone or entry/exit
  invulnerability.
* **Market buyback/price loops.** `MARKET_TAX` 5% non-refunded on listing plus a 1-listing-per-tx
  rule makes the naive loop a gold sink rather than a pump; I did not find a profitable loop in the
  three flows I drove (post/buy/cancel). Not proven either way.

---

# Proposed fixes — unified diffs (NOT applied; the orchestrator applies and verifies)

## D1 — `server/validate.js`: clamp every save, including the first one (fixes F1)

```diff
--- a/server/validate.js
+++ b/server/validate.js
@@ -17,6 +17,9 @@ export const CAPS = {
   // a level every 20s of wall time + 1 is far above any legit pace
   levelPerSec: 1 / 20,
   // generous: quest rewards / boss / selling a bag of epics
   goldBase: 1500, goldPerSec: 60,
+  // a character with no server record yet gets one small purse, never a free GOLD_MAX,
+  // and the purse may only grow at a bounded lifetime rate from its first save on.
+  newCharGold: 2500, goldPerSecLifetime: 5,
 };
@@ -55,15 +58,22 @@ export function validateSave(prev, progress, now = Date.now()) {
   const clamped = [];
   const p = sanitizeProgress(progress);
   if (!p) return { rec: null, clamped: ['invalid'] };
   const pp = prev?.progress;
-  if (pp) {
-    const dt = Math.max(0, (now - (prev.savedAt || now)) / 1000);
-    const maxLevel = pp.level + 1 + Math.floor(dt * CAPS.levelPerSec);
-    if (p.level > maxLevel) { clamped.push(`level ${p.level}>${maxLevel}`); p.level = maxLevel; }
-    const maxGold = pp.gold + CAPS.goldBase + Math.floor(dt * CAPS.goldPerSec);
-    if (p.gold > maxGold) { clamped.push(`gold ${p.gold}>${maxGold}`); p.gold = maxGold; }
-  }
+  // The clamp must hold for EVERY save: `if (pp)` skipped it entirely for a token the
+  // server had never seen, so a throwaway character could store GOLD_MAX on save #1.
+  const prevGold = pp ? pp.gold | 0 : CAPS.newCharGold;
+  const dt = prev ? Math.max(0, (now - (prev.savedAt || now)) / 1000) : 0;
+  const maxLevel = (pp ? pp.level : 1) + 1 + Math.floor(dt * CAPS.levelPerSec);
+  if (p.level > maxLevel) { clamped.push(`level ${p.level}>${maxLevel}`); p.level = maxLevel; }
+  // Per-save allowance is a margin for ONE plausible session, not a tap: without a
+  // lifetime bound, re-saving every couple of seconds converts it into unlimited gold.
+  const lifetime = prev?.firstAt ? Math.max(0, (now - prev.firstAt) / 1000) : 0;
+  const maxGold = Math.min(
+    prevGold + CAPS.goldBase + Math.floor(dt * CAPS.goldPerSec),
+    CAPS.newCharGold + Math.floor(lifetime * CAPS.goldPerSecLifetime));
+  if (p.gold > maxGold) { clamped.push(`gold ${p.gold}>${maxGold}`); p.gold = maxGold; }
   return { rec: p, clamped };
 }
```

Companion stamp so the lifetime bound has a start point (in the save handler that owns the record):

```diff
--- a/server/WayfarerRoom.js
+++ b/server/WayfarerRoom.js
@@ async onSave(client, p, m) {
     const prev = loadChar(p.token, p.name);
+    // firstAt is the anchor for the lifetime gold bound (validate.js D1). Set once.
+    if (prev && !prev.firstAt) prev.firstAt = prev.savedAt || Date.now();
     const { rec, clamped } = validateSave(prev, m.progress);
```

Note for the orchestrator: `CAPS.newCharGold: 2500` must cover the real starting purse. If the
tutorial awards more, raise it — but not to `GOLD_MAX`.

## D2 — `server/economy.js`: make the econOut guard inspect `equipped` too (fixes F3)

```diff
--- a/server/economy.js
+++ b/server/economy.js
@@ -183,10 +183,18 @@
     for (const id of new Set(out.map((e) => e.id))) {
       const allowed = count(prev.progress.inventory, prev.progress.equipped, id);
       let extra = count(m.progress.inventory, m.progress.equipped, id) - allowed;
       while (extra > 0) {
         const i = m.progress.inventory.lastIndexOf(id);
-        if (i < 0) break; // equipped copy: leave it, it came from the bag we already checked
-        m.progress.inventory.splice(i, 1); extra--; stripped.push(id);
+        if (i >= 0) { m.progress.inventory.splice(i, 1); extra--; stripped.push(id); continue; }
+        // The surplus may be ENTIRELY in equipped (uploading the traded item as
+        // equipped.<slot> previously made lastIndexOf return -1, so the loop broke and
+        // stripped nothing: the guard was trivially defeatable).
+        const slot = Object.keys(m.progress.equipped || {}).find((k) => m.progress.equipped[k] === id);
+        if (slot) { m.progress.equipped[slot] = null; extra--; stripped.push(`equipped.${slot}:${id}`); continue; }
+        break;
       }
     }
```
(Keep the `stripped.length && suspicious(...)` line as is; the added entries make the log louder.)

## D3 — `server/validate.js`: never let an unknown id cross the economy boundary (fixes F4)

```diff
--- a/server/validate.js
+++ b/server/validate.js
@@ -115,9 +115,13 @@ export const revOf = (v) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);
 // multiset check: does `inv` contain every id of `want` (with multiplicity)?
 export function hasItems(inv, want) {
   const n = new Map();
   for (const id of inv || []) n.set(id, (n.get(id) || 0) + 1);
-  for (const id of want) { const c = n.get(id) || 0; if (c < 1) return false; n.set(id, c - 1); }
+  for (const id of want) {
+    // Saves deliberately keep unknown ids (a stale whitelist must never delete items),
+    // but ownership proof for trade/market/lock must require a known gear id, otherwise
+    // an uploaded/id-minted item is a real, sellable good the server cannot even name.
+    if (!isGearId(id)) return false;
+    const c = n.get(id) || 0; if (c < 1) return false; n.set(id, c - 1);
+  }
   return true;
 }
```

## D4 — `server/WayfarerRoom.js` + `src/net/socialNet.js`: allowlist instead of wildcard (fixes F2)

```diff
--- a/server/WayfarerRoom.js
+++ b/server/WayfarerRoom.js
@@ -118,14 +118,21 @@
       on('ping', (c, p, m) => { this.sendTo(c, 'pong', { c: m.c, t: Date.now(), n: this.clients.length, rn: this.displayName }); }, 'ping');
-    // Generic passthrough (social/party/emote modules add types without server edits).
+    // Generic passthrough for CLIENT->CLIENT presence chatter only. Anything a client
+    // may send that a client will ACT ON (trade-done, duel-*, party-update, ...) must be
+    // produced by the server, never relayed: the wildcard let any client forge frames
+    // from another player, and trade-done made victims donate their own gold.
+    const RELAYABLE = new Set(['emote', 'whisper', 'party-invite', 'party-leave', 'trade-sent',
+                               'resync-poke', 'sprite', 'typing']);
     this.onMessage('*', (client, type, m) => {
       STATS.msgsIn++;
       const p = this.players.get(client.sessionId);
       if (!p) return;
       if (!p.buckets.misc.take()) { this.flood(client, p); return; }
-      if (typeof type !== 'string' || type.length > 32) return;
+      if (typeof type !== 'string' || type.length > 32 || !RELAYABLE.has(type)) return;
       let size = 0; try { size = JSON.stringify(m ?? null).length; } catch { return; }
       if (size > 4096) return;
       const payload = m && typeof m === 'object' && !Array.isArray(m) ? { ...m, sessionId: client.sessionId } : { value: m, sessionId: client.sessionId };
       this.bcast(type, payload, client);
     });
```
The `RELAYABLE` set must be checked against the real client senders (grep `send(` in `src/net/` and
`src/systems/`) before merge — a type missing from it stops being relayed, which is the safe failure.

Defence in depth, same finding — the client sink must ignore frames it did not ask for:

```diff
--- a/src/net/socialNet.js
+++ b/src/net/socialNet.js
@@ -23,6 +23,8 @@
   room.onMessage('trade-done', (m) => {
+    // server->client frames the client acts on must come from the server: a relayed copy
+    // carries the forger's sessionId and is not ours to apply.
+    if (m && m.sessionId && m.sessionId !== room.sessionId) return;
     onTradeDone?.(m);
   });
```

## D5 — fold `/gift` into the server-authoritative trade (fixes F6, keeps the owner's UI)

Delete the trust relay's *semantics*, keep the command: `server/social.js:232-255` should not be a
second implementation. The client's `/gift <player> <item|gold>` should open the normal economy trade
with the offer pre-filled.

```diff
--- a/server/social.js
+++ b/server/social.js
@@ -229,27 +229,27 @@
-  // ── trade (1:1 offers, co-op trust model: sender deducts on 'done') ──
-  room.onMessage('trade-offer', (client, m) => {
-    const p = info(room, client.sessionId); if (!p) return;
-    if (!bucket(room, client.sessionId)) { err(client, 'You are trading too fast.'); return; }
-    const sid = room.social.players.has(m?.to) ? m.to : findByName(room, m?.to);
-    if (!sid || sid === client.sessionId) { err(client, 'No such player to trade with.'); return; }
-    const gold = Math.max(0, Math.min(9999, m?.gold | 0));
-    const item = typeof m?.item === 'string' ? m.item.slice(0, 40) : null;
-    if (!gold && !item) { err(client, 'Offer gold or an item.'); return; }
-    clientById(room, sid)?.send('trade-offer', { from: client.sessionId, fromName: p.name, gold, item });
-    client.send('trade-sent', { to: sid, toName: info(room, sid)?.name || '???' });
-  });
-  room.onMessage('trade-respond', (client, m) => {
-    const p = info(room, client.sessionId); if (!p) return;
-    const sid = m?.to;
-    if (!sid || !room.social.players.has(sid)) { err(client, 'That trader is gone.'); return; }
-    if (m?.accept) {
-      const gold = Math.max(0, Math.min(9999, m?.gold | 0));
-      const item = typeof m?.item === 'string' ? m.item.slice(0, 40) : null;
-      clientById(room, sid)?.send('trade-done', { from: client.sessionId, gold, item });
-    } else {
-      clientById(room, sid)?.send('trade-done', { from: client.sessionId, declined: true });
-    }
-  });
+  // ── trade (1:1 offers) ───────────────────────────────────────────────
+  // The co-op trust relay that used to live here (sender deducts locally on 'done',
+  // no ownership check, no rev, no session) is REMOVED. A "quick gift" is just a trade
+  // with one side pre-filled: route /gift into the economy's authoritative path so the
+  // server owns both sides of the swap, the revision numbers and the dupe guard.
+  // The economy installs 'trade-offer'/'trade-respond' (economy.js:242/258) and owns
+  // the whole session; a second listener can never run (colyseus keeps one handler per
+  // type, Room.js:468) — so keep the helpers used by guild/party and drop these two.
```

The matching client change keeps `/gift` and the panels working: in
`src/systems/social/index.js`, `socialTradeCmd`/`pendingTrade`/`acceptTrade` should call the
economy sender (`src/net/economyNet.js`) instead of `room.send('trade-offer', {to, gold, item})`, and
`src/ui/SocialPanels.js` should keep its existing rows (they already mirror the economy's
`trade-update` shape). The `trade-done`/`trade-sent` frames then disappear from the client, so
`src/net/socialNet.js:23-30` and `src/systems/social/index.js:365` (`onTradeDone`) must be deleted —
they are the sink F2 weaponises.

## D6 — `server/validate.js`: one bag size, not two (fixes F7)

```diff
--- a/server/validate.js
+++ b/server/validate.js
@@ -31,7 +31,9 @@ export function sanitizeProgress(p) {
     x: int(p.x, -20000, 40000, 0), y: int(p.y, -20000, 40000, 0),
-    inventory: (Array.isArray(p.inventory) ? p.inventory : []).filter((s) => typeof s === 'string' && s.length <= 48).slice(0, 40),
+    // the client bag is ECON.BAG_SIZE (30); storing 40 left up to 10 items held but
+    // unreachable, and the trade/market "bag full" gates disagreed with the UI.
+    inventory: (Array.isArray(p.inventory) ? p.inventory : []).filter((s) => typeof s === 'string' && s.length <= 48).slice(0, ECON.BAG_SIZE),
```
(`ECON` is declared later in the same module; this runs only when `sanitizeProgress` is called, after
module init, so the reference is safe. Prefer returning the overflow by mail if losing items is
unacceptable.)
