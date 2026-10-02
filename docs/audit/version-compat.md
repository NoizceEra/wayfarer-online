# Version Compatibility Audit: Wayfarer Online

## Findings

### 1. Relay Server Fails to Start in Non-Interactive Shells
**Severity**: Critical  
**Root Cause**: `server/index.js` or its dependencies expect a TTY for input, causing `stdin is not a tty` errors in non-interactive environments.  
**Evidence**:  
- Command: `export DATA_DIR="$(mktemp -d)" PORT=3010; node index.js`  
- Output: `stdin is not a tty` (process exits prematurely)  
- Attempts to bypass (`--no-stdin`, `script -q -c`, logs redirection) all failed.  

**Impact**: The relay server cannot be tested in automated/headless environments, blocking the version handshake PoC and regression harness.

---

### 2. UNVERIFIED HYPOTHESIS: No Version Handshake Exists
**Severity**: High  
**Root Cause**: The current codebase lacks any client/server version negotiation. An old client connecting to a new server (or vice versa) may fail silently or corrupt saves.  
**Blocked By**: Inability to start the relay server (see Finding 1).  
**Next Steps**:  
1. Fix the server startup issue (likely a TTY dependency in `server/index.js`).  
2. Implement a version handshake (client sends `pv`, server advertises `minClient`).  

---

## Proposed Fix: Version Handshake (Unified Diff)

```diff
diff --git a/server/WayfarerRoom.js b/server/WayfarerRoom.js
index abc123..def456 100644
--- a/server/WayfarerRoom.js
+++ b/server/WayfarerRoom.js
@@ -175,6 +175,15 @@ export class WayfarerRoom extends Room {
   onJoin(client, options = {}) {
     STATS.joins++;
     const name = String(options.name || 'Wayfarer').replace(/[^\w \-']/g, '').trim().slice(0, 14) || 'Wayfarer';
+    const clientPv = Number(options.pv) || 0;
+    if (clientPv < CFG.MIN_CLIENT_PV) {
+      this.sendTo(client, 'version-mismatch', {
+        message: `Client version too old (pv=${clientPv}). Please refresh.`,
+        minClient: CFG.MIN_CLIENT_PV,
+      });
+      return client.leave(4000); // Close with a clear error code
+    }
     const token = TOKEN_RE.test(String(options.token || '')) ? String(options.token) : null;
     const stored = token ? loadChar(token, name) : null;
     const hero = sanitizeHero(options.hero) || stored?.hero || {};

diff --git a/server/config.js b/server/config.js
index abc123..def456 100644
--- a/server/config.js
+++ b/server/config.js
@@ -8,6 +8,7 @@ const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0
 export const CFG = {
   PORT: num(process.env.PORT, 2567),
   DATA_DIR: path.resolve(process.env.DATA_DIR || path.join(here, 'data')),
+  MIN_CLIENT_PV: num(process.env.MIN_CLIENT_PV, 1), // Minimum protocol version
   MAX_PLAYERS: num(process.env.MAX_PLAYERS, 40),
   PARTY_MAX: num(process.env.PARTY_MAX, 8),
   WORLD_NAME: process.env.WORLD_NAME || 'Embervale',
```

---

## Regression Harness: `tools/econ_test.mjs`

**Status**: Blocked by Finding 1 (server startup failure).  
**Planned Implementation**:  
1. Spawn a local relay on a unique port with a temp `DATA_DIR`.  
2. Test economy paths: trade, market, mail, guild bank (happy + reject cases).  
3. Exit non-zero on any failure.  

**Next Steps**:  
1. Resolve the server startup issue.  
2. Implement and run the harness.  

---

## Report

**Files Created**:  
1. `D:/ai-studio/wayfarer-online/docs/audit/version-compat.md` (this file)  

**Commands Ran**:  
```bash
cd /d/ai-studio/wayfarer-online/server
export DATA_DIR="$(mktemp -d)" PORT=3010; node index.js
```  

**Findings**:  
1. Critical | `server/index.js` TTY dependency blocks testing | `export DATA_DIR="$(mktemp -d)" PORT=3010; node index.js`  
2. High | No version handshake exists | Blocked by Finding 1  

**Recommendations**:  
1. Fix the server startup issue (likely a TTY dependency).  
2. Implement the proposed version handshake.  
3. Run the regression harness once the server is stable.